import type { Finding } from "../types/index.js";

export const generateClaudeRevisionPrompt = (
  planFile: string,
  promptFile: string,
  findings: Finding[]
): string => {
  const findingsSection = findings
    .map(
      (f) =>
        `### ${f.id} [${f.severity.toUpperCase()}] ${f.category}\n${f.summary}\n${f.detail}`
    )
    .join("\n\n");

  return `以下の実装計画に対するレビュー指摘を反映してください。

## 対象ファイル

実装計画: ${planFile}
元の要件: ${promptFile}

## 反映すべきレビュー指摘

${findingsSection}

## 指示

1. 上記の指摘内容を実装計画ファイル（${planFile}）に反映してください
2. 実装計画ファイルを直接編集してください
3. 元の要件（${promptFile}）の内容に矛盾しないように注意してください
4. 反映結果を以下のJSON形式で標準出力に出力してください

\`\`\`json
{
  "reflectedFindings": ["finding-1", "finding-2"],
  "summary": "変更内容の概要"
}
\`\`\``;
};
