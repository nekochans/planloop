import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pc from "picocolors";
import type { ReviewAdapter } from "../adapters/types.js";
import type {
  PlanloopConfig,
  RawFinding,
  TriageResult,
  Waiver,
} from "../types/index.js";

const TRIAGE_HEADER_REGEX = /^[\s\S]*?# フィードバック\s*/;
const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;
const LIST_MARKER_REGEX = /^[-・*]\s*/;
const QUOTED_TEXT_REGEX = /[「『]([^」』]+)[」』]/;

const stripHtmlComments = (text: string): string =>
  text.replace(HTML_COMMENT_REGEX, "");

export const runNaturalLanguageTriage = async (
  findings: RawFinding[],
  round: number,
  planContent: string,
  promptContent: string,
  reviewAdapter: ReviewAdapter,
  _config: PlanloopConfig,
  roundDir: string
): Promise<TriageResult> => {
  const triageContent = buildTriageFileContent(findings, round);
  await mkdir(roundDir, { recursive: true });
  const triageFilePath = join(roundDir, `triage-round-${round}.md`);
  await writeFile(triageFilePath, triageContent, "utf-8");

  printTriageSummary(findings, round, triageFilePath);
  await waitForUserInput(
    `\nトリアージファイルにフィードバックを記入し、保存したら ${pc.bold("Enter")} を押してください（空のままEnterで全指摘を受け入れ）: `
  );

  const editedContent = await readFile(triageFilePath, "utf-8");
  const humanFeedback = extractFeedback(editedContent);

  if (!humanFeedback.trim()) {
    console.error(
      pc.dim("  フィードバックなし — 全指摘をそのまま受け入れます")
    );
    return {
      adjustedFindings: findings,
      humanFeedback: "",
      newWaivers: [],
    };
  }

  console.error(pc.cyan("  フィードバックをCodexに送信中..."));

  const feedbackResult = await reviewAdapter.reviewWithFeedback(
    planContent,
    promptContent,
    {
      round,
      originalFindings: findings,
      humanFeedback,
    }
  );

  const newWaivers = extractWaiversFromFeedback(humanFeedback);

  return {
    adjustedFindings: feedbackResult.findings,
    humanFeedback,
    newWaivers,
  };
};

const printTriageSummary = (
  findings: RawFinding[],
  round: number,
  triageFilePath: string
): void => {
  console.error("");
  console.error(pc.bold(`════ Round ${round}: トリアージ ════`));
  console.error("");
  for (const f of findings) {
    const label = `[${f.severity.toUpperCase()}]`;
    const sev = severityLabel(label, f.severity);
    console.error(`  ${sev} ${pc.bold(f.id)} ${pc.dim(f.category)}`);
    console.error(`    ${f.summary}`);
  }
  console.error("");
  console.error(`  トリアージファイル: ${pc.underline(triageFilePath)}`);
  console.error(
    pc.dim(
      "  上記ファイルの「# フィードバック」セクションにフィードバックを記入してください。"
    )
  );
};

const severityLabel = (label: string, severity: string): string => {
  if (severity === "high") {
    return pc.red(label);
  }
  if (severity === "medium") {
    return pc.yellow(label);
  }
  return pc.dim(label);
};

const waitForUserInput = (prompt: string): Promise<void> => {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
};

export const buildTriageFileContent = (
  findings: RawFinding[],
  round: number
): string => {
  const findingsSection = findings
    .map(
      (f) =>
        `## ${f.id} [${f.severity.toUpperCase()}] ${f.category}\n${f.summary}\n${f.detail}`
    )
    .join("\n\n");

  return `# Codex レビュー結果 (Round ${round})

${findingsSection}

---

# フィードバック

<!-- 以下にフィードバックを記入してください。 -->
<!-- この行から下に自由に書いてください。上の指摘はそのまま残してください。 -->
<!-- フィードバックが空の場合、全ての指摘をそのまま受け入れます。 -->
<!-- 保存後、ターミナルに戻ってEnterを押してください。 -->
<!--
書き方の例（この行は削除して、以下を参考に記入）:
- finding-2はこのリポジトリの運用ルール上対象外
- finding-3の受け入れ基準の追加は方向性だけ採用。詳細なテスト項目までは不要
- 以後、「将来必要になるかもしれない拡張性」だけの指摘は無視
-->

`;
};

export const extractFeedback = (content: string): string => {
  const separatorIndex = content.indexOf("---");
  if (separatorIndex === -1) {
    return "";
  }

  const afterSeparator = content.slice(separatorIndex + 3);
  const headerRemoved = afterSeparator.replace(TRIAGE_HEADER_REGEX, "");
  const withoutComments = stripHtmlComments(headerRemoved);
  const lines = withoutComments.split("\n");
  const filtered = lines.filter((line) => line.trim() !== "");

  return filtered.join("\n").trim();
};

export const extractWaiversFromFeedback = (feedback: string): Waiver[] => {
  const waivers: Waiver[] = [];
  const lines = feedback.split("\n");
  const permanentKeywords = ["以後", "今後", "今回以降", "以降"];

  for (const line of lines) {
    const trimmed = line.replace(LIST_MARKER_REGEX, "").trim();
    if (!trimmed) {
      continue;
    }

    const isPermanent = permanentKeywords.some((kw) => trimmed.includes(kw));
    if (!isPermanent) {
      continue;
    }

    const quotedMatch = trimmed.match(QUOTED_TEXT_REGEX);
    const matchText = quotedMatch ? quotedMatch[1] : trimmed;

    waivers.push({
      match: matchText,
      action: "ignore",
      reason: trimmed,
    });
  }

  return waivers;
};
