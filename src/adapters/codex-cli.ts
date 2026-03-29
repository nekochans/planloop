import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { z } from "zod";
import {
  generateCodexFeedbackReviewPrompt,
  generateCodexReviewPrompt,
} from "../prompts/codex-review.js";
import type { PlanloopConfig, RawFinding } from "../types/index.js";
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from "../types/index.js";
import type {
  FeedbackReviewContext,
  ReviewAdapter,
  ReviewAdapterResult,
  ReviewContext,
} from "./types.js";

const CODEX_TIMEOUT = 5 * 60 * 1000;

const codexFindingSchema = z.object({
  id: z.string(),
  summary: z.string(),
  detail: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  category: z.enum(FINDING_CATEGORIES),
  lineRef: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? undefined),
});

const codexReviewOutputSchema = z.object({
  findings: z.array(codexFindingSchema),
});

const OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "summary",
          "detail",
          "severity",
          "category",
          "lineRef",
        ],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          detail: { type: "string" },
          severity: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          category: {
            type: "string",
            enum: [
              "correctness",
              "spec_mismatch",
              "missing_acceptance_criteria",
              "migration_risk",
              "speculative_future",
              "unnecessary_fallback",
              "code_quality",
              "security",
              "performance",
              "other",
            ],
          },
          lineRef: { type: ["string", "null"] },
        },
      },
    },
  },
};

export const createCodexCliAdapter = (
  config: PlanloopConfig
): ReviewAdapter => {
  return {
    review: (
      planContent: string,
      promptContent: string,
      context: ReviewContext
    ): Promise<ReviewAdapterResult> => {
      const prompt = generateCodexReviewPrompt(
        planContent,
        promptContent,
        context,
        config
      );
      return executeCodexReview(prompt, planContent);
    },

    reviewWithFeedback: (
      planContent: string,
      promptContent: string,
      context: FeedbackReviewContext
    ): Promise<ReviewAdapterResult> => {
      const prompt = generateCodexFeedbackReviewPrompt(
        planContent,
        promptContent,
        context,
        config
      );
      return executeCodexReview(prompt, planContent);
    },
  };
};

const executeCodexReview = async (
  prompt: string,
  _planContent: string
): Promise<ReviewAdapterResult> => {
  const tmpDir = await mkdtemp(join(tmpdir(), "planloop-codex-"));
  const schemaPath = join(tmpDir, "review-schema.json");
  const outputPath = join(tmpDir, "last-message.txt");
  await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA), "utf-8");

  const args = [
    "exec",
    "--json",
    "--full-auto",
    "--ephemeral",
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-",
  ];

  try {
    const { rawOutput, toolsUsed } = await spawnCodex(args, prompt);

    let findings: RawFinding[];
    try {
      const outputContent = await readFile(outputPath, "utf-8");
      findings = parseFindings(outputContent);
    } catch (err) {
      console.error(
        pc.yellow(
          `  警告: -o出力のパース失敗、JSONLフォールバック: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      findings = parseFindingsFromJsonl(rawOutput);
    }

    return { findings, toolsUsed, rawOutput };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const spawnCodex = (
  args: string[],
  stdinData: string
): Promise<{ rawOutput: string; toolsUsed: string[] }> => {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let rawOutput = "";
    let stderr = "";
    const toolsUsed: string[] = [];
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      rawOutput += text;

      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          const event = JSON.parse(line);
          collectToolUsage(event, toolsUsed);
          renderProgressEvent(event);
        } catch {
          // skip non-JSON lines
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "Codex CLIがインストールされていません。`npm install -g @openai/codex` でインストールしてください。"
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ rawOutput, toolsUsed });
      } else {
        const lastOutput = rawOutput.slice(-500);
        const detail = stderr || lastOutput || "(出力なし)";
        reject(
          new Error(
            `Codex CLIがエラーで終了しました (exit code: ${code}):\n${detail}`
          )
        );
      }
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Codex CLIがタイムアウトしました（5分）"));
    }, CODEX_TIMEOUT);

    child.stdin?.write(stdinData);
    child.stdin?.end();
  });
};

const collectToolUsage = (
  event: Record<string, unknown>,
  toolsUsed: string[]
): void => {
  if (event.type === "command_execution" && typeof event.command === "string") {
    toolsUsed.push(event.command);
  } else if (event.type === "mcp_tool_call" && typeof event.tool === "string") {
    const inputSummary =
      typeof event.input === "object" && event.input
        ? Object.values(event.input as Record<string, unknown>)
            .slice(0, 1)
            .join(", ")
        : "";
    toolsUsed.push(
      inputSummary ? `${event.tool}: ${inputSummary}` : event.tool
    );
  } else if (event.type === "web_search" && typeof event.query === "string") {
    toolsUsed.push(`web_search: ${event.query}`);
  }
};

export const parseFindings = (output: string): RawFinding[] => {
  const jsonStr = extractJson(output);
  const parsed = JSON.parse(jsonStr);
  const result = codexReviewOutputSchema.safeParse(parsed);

  if (result.success) {
    return result.data.findings;
  }

  console.error(
    pc.yellow(`  警告: Codex出力のスキーマ検証失敗: ${result.error.message}`)
  );

  if (Array.isArray(parsed?.findings)) {
    const valid = parsed.findings.filter(
      (f: unknown) => codexFindingSchema.safeParse(f).success
    );
    if (valid.length < parsed.findings.length) {
      console.error(
        pc.yellow(
          `  警告: ${parsed.findings.length}件中${valid.length}件のfindingsのみ有効`
        )
      );
    }
    return valid;
  }

  throw new Error(`Codex出力のパースに失敗しました: ${result.error.message}`);
};

export const parseFindingsFromJsonl = (jsonl: string): RawFinding[] => {
  const lines = jsonl.split("\n").filter((l) => l.trim());
  for (const line of [...lines].reverse()) {
    try {
      const event = JSON.parse(line);
      if (
        event.type === "message" &&
        event.role === "assistant" &&
        typeof event.content === "string"
      ) {
        try {
          return parseFindings(event.content);
        } catch {
          // continue to next message
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return [];
};

const CODE_BLOCK_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

const extractJson = (text: string): string => {
  const codeBlockMatch = text.match(CODE_BLOCK_REGEX);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const jsonMatch = text.match(JSON_OBJECT_REGEX);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return text;
};

const renderProgressEvent = (event: Record<string, unknown>): void => {
  if (event.type === "command_execution" && typeof event.command === "string") {
    process.stderr.write(`  ${pc.cyan("[tool]")} ${event.command}\n`);
  } else if (event.type === "mcp_tool_call" && typeof event.tool === "string") {
    process.stderr.write(`  ${pc.cyan("[mcp]")} ${event.tool}\n`);
  } else if (event.type === "web_search" && typeof event.query === "string") {
    process.stderr.write(`  ${pc.cyan("[search]")} ${event.query}\n`);
  } else if (
    event.type === "message" &&
    event.role === "assistant" &&
    typeof event.content === "string"
  ) {
    const preview = event.content.slice(0, 80).replace(/\n/g, " ");
    if (preview.trim()) {
      process.stderr.write(`  ${pc.dim("...")} ${pc.dim(preview)}\n`);
    }
  }
};
