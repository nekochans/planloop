import type {
  FeedbackReviewContext,
  ReviewContext,
} from "../adapters/types.js";
import type { PlanloopConfig, Waiver } from "../types/index.js";

export const generateCodexReviewPrompt = (
  planContent: string,
  promptContent: string,
  context: ReviewContext,
  config: PlanloopConfig
): string => {
  const perspectivesSection = config.review.perspectives
    .map((p) => `   - ${p}`)
    .join("\n");

  let instructions = `1. 以下の観点でレビューを行ってください:\n${perspectivesSection}`;

  if (config.review.additionalInstructions) {
    instructions += `\n\n2. 追加指示:\n${config.review.additionalInstructions}`;
  }

  instructions += `\n\n${config.review.additionalInstructions ? "3" : "2"}. 以下の種類の指摘は避けてください:
   - speculative_future: 「将来必要になるかもしれない」だけの指摘
   - unnecessary_fallback: 不要なフォールバック実装の要求`;

  const waiverSection = buildWaiverSection(context.previousWaivers);

  return `あなたは実装計画のレビュアーです。以下の実装計画をレビューしてください。

## レビュー対象の実装計画

${planContent}

## 実装計画の元となった要件（プロンプト）

${promptContent}

## レビュー指示

${instructions}
${waiverSection}
## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

\`\`\`json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明（複数行可）",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other"
    }
  ]
}
\`\`\``;
};

export const generateCodexFeedbackReviewPrompt = (
  planContent: string,
  promptContent: string,
  context: FeedbackReviewContext,
  _config: PlanloopConfig
): string => {
  const findingsSection = context.originalFindings
    .map(
      (f) =>
        `### ${f.id} [${f.severity.toUpperCase()}] ${f.category}\n${f.summary}\n${f.detail}`
    )
    .join("\n\n");

  return `あなたは実装計画のレビュアーです。前回のレビューに対して人間からフィードバックがあったため、調整後のレビュー結果を出力してください。

## レビュー対象の実装計画

${planContent}

## 実装計画の元となった要件（プロンプト）

${promptContent}

## 前回のレビュー指摘

${findingsSection}

## 人間からのフィードバック

${context.humanFeedback}

## 指示

上記のフィードバックを踏まえ、以下の条件で再レビューしてください:
1. waiveまたは対象外と指示された指摘は含めないでください
2. フィードバックで修正方針が示された指摘は、その方針を反映して調整してください
3. フィードバックで言及されていない指摘はそのまま残してください
4. 新たに気づいた指摘があれば追加してください

## 出力形式

以下のJSON形式で出力してください。JSON以外のテキストは出力しないでください。

\`\`\`json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "指摘の要約（1行）",
      "detail": "指摘の詳細説明（複数行可）",
      "severity": "high | medium | low",
      "category": "correctness | spec_mismatch | missing_acceptance_criteria | migration_risk | security | performance | code_quality | other"
    }
  ]
}
\`\`\``;
};

const buildWaiverSection = (waivers: Waiver[]): string => {
  if (waivers.length === 0) {
    return "";
  }

  const waiverLines = waivers
    .map(
      (w) =>
        `- ${w.reason} (カテゴリ: ${w.category ?? "全て"}, パターン: ${w.match})`
    )
    .join("\n");

  return `
## 前回のレビューでの調整事項

以下の観点は前回のレビューで対象外と判断されています。これらに該当する指摘は出力しないでください。

${waiverLines}
`;
};
