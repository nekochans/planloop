import { describe, expect, it } from "vitest";
import { createFinding } from "../__fixtures__/sample-findings.js";
import { generateClaudeRevisionPrompt } from "./claude-revision.js";

describe("generateClaudeRevisionPrompt", () => {
  it("should generate basic prompt", () => {
    const prompt = generateClaudeRevisionPrompt("plan.md", "prompt.md", [
      createFinding({ id: "finding-1", summary: "API mismatch" }),
    ]);
    expect(prompt).toContain("plan.md");
    expect(prompt).toContain("prompt.md");
    expect(prompt).toContain("finding-1");
    expect(prompt).toContain("API mismatch");
  });

  it("should format multiple findings correctly", () => {
    const findings = [
      createFinding({
        id: "finding-1",
        summary: "Issue A",
        severity: "high",
        category: "correctness",
      }),
      createFinding({
        id: "finding-2",
        summary: "Issue B",
        severity: "medium",
        category: "spec_mismatch",
      }),
    ];
    const prompt = generateClaudeRevisionPrompt(
      "plan.md",
      "prompt.md",
      findings
    );
    expect(prompt).toContain("### finding-1 [HIGH] correctness");
    expect(prompt).toContain("### finding-2 [MEDIUM] spec_mismatch");
  });

  it("should embed file paths correctly", () => {
    const prompt = generateClaudeRevisionPrompt(
      "design-docs/plan.md",
      "prompts/req.md",
      [createFinding()]
    );
    expect(prompt).toContain("実装計画: design-docs/plan.md");
    expect(prompt).toContain("元の要件: prompts/req.md");
    expect(prompt).toContain("実装計画ファイル（design-docs/plan.md）");
  });
});
