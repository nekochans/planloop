import { describe, expect, it } from "vitest";
import { analyzeEvidenceRequirements } from "./analyzer.js";

describe("analyzeEvidenceRequirements", () => {
  it("should detect GitHub Issue URL as required gh evidence", () => {
    const plan = "参照: https://github.com/nekochans/planloop/issues/3";
    const result = analyzeEvidenceRequirements(plan, "");
    expect(result.required).toHaveLength(1);
    expect(result.required[0].source).toBe("gh");
  });

  it("should detect GitHub PR URL from prompt as required", () => {
    const prompt = "PR: https://github.com/nekochans/planloop/pull/2";
    const result = analyzeEvidenceRequirements("", prompt);
    expect(result.required).toHaveLength(1);
    expect(result.required[0].source).toBe("gh");
  });

  it("should detect Figma URL as required", () => {
    const plan = "デザイン: https://figma.com/file/abc123";
    const result = analyzeEvidenceRequirements(plan, "");
    expect(result.required).toHaveLength(1);
    expect(result.required[0].source).toBe("figma_mcp");
  });

  it("should detect doc keywords as suggested context7", () => {
    const prompt = "ドキュメントで確認してください";
    const result = analyzeEvidenceRequirements("", prompt);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0].source).toBe("context7_mcp");
  });

  it("should detect web search keywords as suggested", () => {
    const prompt = "不明点はWeb検索で確認";
    const result = analyzeEvidenceRequirements("", prompt);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0].source).toBe("web_search");
  });

  it("should return empty arrays when no evidence needed", () => {
    const result = analyzeEvidenceRequirements(
      "シンプルな計画",
      "シンプルな要件"
    );
    expect(result.required).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
  });

  it("should detect multiple evidence sources simultaneously", () => {
    const plan =
      "Issue: https://github.com/nekochans/planloop/issues/3\nデザイン: https://figma.com/file/abc";
    const prompt = "ドキュメントで確認してください\nWeb検索も活用";
    const result = analyzeEvidenceRequirements(plan, prompt);
    expect(result.required).toHaveLength(2);
    expect(result.suggested).toHaveLength(2);
  });

  it("should not duplicate gh evidence for multiple GitHub URLs", () => {
    const plan =
      "https://github.com/nekochans/planloop/issues/3\nhttps://github.com/nekochans/planloop/pull/2";
    const result = analyzeEvidenceRequirements(plan, "");
    expect(result.required).toHaveLength(1);
  });
});
