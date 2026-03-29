import { describe, expect, it } from "vitest";
import { verifyEvidence } from "./verifier.js";

describe("verifyEvidence", () => {
  it("should return allRequiredSatisfied true when all required are met", () => {
    const result = verifyEvidence(
      ["gh issue view 3", "context7: commander.js"],
      [
        {
          source: "gh",
          reason: "GH確認",
          matchPatterns: ["gh issue", "gh pr"],
        },
      ],
      [
        {
          source: "context7_mcp",
          reason: "ドキュメント確認",
          matchPatterns: ["context7"],
        },
      ]
    );
    expect(result.allRequiredSatisfied).toBe(true);
    expect(result.required[0].satisfied).toBe(true);
    expect(result.required[0].matchedTools).toContain("gh issue view 3");
    expect(result.suggested[0].satisfied).toBe(true);
  });

  it("should return allRequiredSatisfied false when required not met", () => {
    const result = verifyEvidence(
      ["context7: commander.js"],
      [
        {
          source: "gh",
          reason: "GH確認",
          matchPatterns: ["gh issue", "gh pr"],
        },
      ],
      []
    );
    expect(result.allRequiredSatisfied).toBe(false);
    expect(result.required[0].satisfied).toBe(false);
    expect(result.required[0].matchedTools).toHaveLength(0);
  });

  it("should match with partial patterns", () => {
    const result = verifyEvidence(
      ["gh issue view 3 --repo nekochans/planloop"],
      [{ source: "gh", reason: "GH確認", matchPatterns: ["gh issue"] }],
      []
    );
    expect(result.required[0].satisfied).toBe(true);
  });

  it("should handle empty toolsUsed", () => {
    const result = verifyEvidence(
      [],
      [{ source: "gh", reason: "GH確認", matchPatterns: ["gh issue"] }],
      [
        {
          source: "web_search",
          reason: "Web検索",
          matchPatterns: ["web_search"],
        },
      ]
    );
    expect(result.allRequiredSatisfied).toBe(false);
    expect(result.suggested[0].satisfied).toBe(false);
  });

  it("should handle empty required and suggested", () => {
    const result = verifyEvidence(["gh issue view 3"], [], []);
    expect(result.allRequiredSatisfied).toBe(true);
    expect(result.required).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
  });

  it("should satisfy with any matching pattern", () => {
    const result = verifyEvidence(
      ["gh pr view 5"],
      [
        {
          source: "gh",
          reason: "GH確認",
          matchPatterns: ["gh issue", "gh pr"],
        },
      ],
      []
    );
    expect(result.required[0].satisfied).toBe(true);
  });
});
