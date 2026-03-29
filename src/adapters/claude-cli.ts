import { spawn } from "node:child_process";
import { generateClaudeRevisionPrompt } from "../prompts/claude-revision.js";
import type {
  Finding,
  PlanloopConfig,
  RevisionResult,
} from "../types/index.js";
import type { RevisionAdapter } from "./types.js";

const CLAUDE_TIMEOUT = 10 * 60 * 1000;

const REVISION_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reflectedFindings: {
      type: "array",
      items: { type: "string" },
    },
    summary: { type: "string" },
  },
  required: ["reflectedFindings", "summary"],
});

export const createClaudeCliAdapter = (
  _config: PlanloopConfig
): RevisionAdapter => {
  return {
    revise: async (
      planFile: string,
      promptFile: string,
      findings: Finding[]
    ): Promise<RevisionResult> => {
      const prompt = generateClaudeRevisionPrompt(
        planFile,
        promptFile,
        findings
      );

      const args = [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--json-schema",
        REVISION_JSON_SCHEMA,
        "--no-session-persistence",
        "--allowedTools",
        "Edit,Read,Glob,Grep",
        "--permission-mode",
        "acceptEdits",
      ];

      const { output } = await spawnClaude(args, prompt);
      const result = extractRevisionResult(output);

      return {
        reflectedFindings: result.reflectedFindings,
        summary: result.summary,
        rawOutput: output,
        timestamp: new Date().toISOString(),
      };
    },
  };
};

const spawnClaude = (
  args: string[],
  stdinData: string
): Promise<{ output: string }> => {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
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
            "Claude Code CLIがインストールされていません。https://claude.ai/code を参照してください。"
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
        resolve({ output });
      } else {
        const lastOutput = output.slice(-500);
        const detail = stderr || lastOutput || "(出力なし)";
        reject(
          new Error(
            `Claude Code CLIがエラーで終了しました (exit code: ${code}):\n${detail}`
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
      reject(new Error("Claude Code CLIがタイムアウトしました（10分）"));
    }, CLAUDE_TIMEOUT);

    child.stdin?.write(stdinData);
    child.stdin?.end();
  });
};

export const extractRevisionResult = (
  output: string
): { reflectedFindings: string[]; summary: string } => {
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === "result" && typeof parsed.result === "string") {
        try {
          const inner = JSON.parse(parsed.result);
          if (Array.isArray(inner.reflectedFindings)) {
            return {
              reflectedFindings: inner.reflectedFindings,
              summary: inner.summary || "",
            };
          }
        } catch {
          // not parseable inner JSON
        }
      }

      if (Array.isArray(parsed.reflectedFindings)) {
        return {
          reflectedFindings: parsed.reflectedFindings,
          summary: parsed.summary || "",
        };
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return { reflectedFindings: [], summary: "" };
};
