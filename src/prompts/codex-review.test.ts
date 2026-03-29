import { describe, expect, it } from "vitest";
import { createSampleConfig } from "../__fixtures__/sample-config.js";
import { createRawFinding } from "../__fixtures__/sample-findings.js";
import {
  generateCodexFeedbackReviewPrompt,
  generateCodexReviewPrompt,
} from "./codex-review.js";

describe("generateCodexReviewPrompt", () => {
  const config = createSampleConfig();
  const planContent = "# 実装計画\nAPIの実装";
  const promptContent = "# 要件\nユーザー管理API";

  it("should include default review perspectives", () => {
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      config
    );
    expect(prompt).toContain(
      "correctness: 実装計画の内容が要件と一致しているか"
    );
    expect(prompt).toContain("security: セキュリティ上の懸念がないか");
  });

  it("should include custom review perspectives", () => {
    const customConfig = createSampleConfig({
      review: { perspectives: ["custom: カスタム観点"] },
    });
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      customConfig
    );
    expect(prompt).toContain("custom: カスタム観点");
  });

  it("should include additionalInstructions when set", () => {
    const customConfig = createSampleConfig({
      review: {
        perspectives: config.review.perspectives,
        additionalInstructions: "追加の指示内容",
      },
    });
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      customConfig
    );
    expect(prompt).toContain("追加指示");
    expect(prompt).toContain("追加の指示内容");
  });

  it("should not include additionalInstructions section when not set", () => {
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      config
    );
    expect(prompt).not.toContain("追加指示:");
  });

  it("should not include waiver section when no waivers", () => {
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      config
    );
    expect(prompt).not.toContain("前回のレビューでの調整事項");
  });

  it("should include waiver section when waivers exist", () => {
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      {
        round: 2,
        previousWaivers: [
          {
            match: "拡張性",
            category: "speculative_future",
            action: "ignore",
            reason: "将来の拡張性に関する指摘は対象外",
          },
        ],
        previousFindings: [],
      },
      config
    );
    expect(prompt).toContain("前回のレビューでの調整事項");
    expect(prompt).toContain("将来の拡張性に関する指摘は対象外");
    expect(prompt).toContain("speculative_future");
  });

  it("should embed planContent and promptContent correctly", () => {
    const prompt = generateCodexReviewPrompt(
      planContent,
      promptContent,
      { round: 1, previousWaivers: [], previousFindings: [] },
      config
    );
    expect(prompt).toContain(planContent);
    expect(prompt).toContain(promptContent);
  });
});

describe("generateCodexFeedbackReviewPrompt", () => {
  const config = createSampleConfig();
  const planContent = "# 実装計画\nAPIの実装";
  const promptContent = "# 要件\nユーザー管理API";

  it("should include original findings", () => {
    const findings = [
      createRawFinding({ id: "finding-1", summary: "API path mismatch" }),
      createRawFinding({
        id: "finding-2",
        summary: "Missing error handling",
        severity: "medium",
      }),
    ];
    const prompt = generateCodexFeedbackReviewPrompt(
      planContent,
      promptContent,
      {
        round: 1,
        originalFindings: findings,
        humanFeedback: "指摘1は修正済み",
      },
      config
    );
    expect(prompt).toContain("finding-1");
    expect(prompt).toContain("API path mismatch");
    expect(prompt).toContain("finding-2");
    expect(prompt).toContain("Missing error handling");
  });

  it("should include human feedback", () => {
    const prompt = generateCodexFeedbackReviewPrompt(
      planContent,
      promptContent,
      {
        round: 1,
        originalFindings: [createRawFinding()],
        humanFeedback: "指摘2はスコープ外です",
      },
      config
    );
    expect(prompt).toContain("指摘2はスコープ外です");
  });

  it("should include plan and prompt content", () => {
    const prompt = generateCodexFeedbackReviewPrompt(
      planContent,
      promptContent,
      {
        round: 1,
        originalFindings: [],
        humanFeedback: "",
      },
      config
    );
    expect(prompt).toContain(planContent);
    expect(prompt).toContain(promptContent);
  });
});
