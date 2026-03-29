import { describe, expect, it } from "vitest";
import { createFinding } from "../__fixtures__/sample-findings.js";
import { applyWaivers } from "./waiver.js";

describe("applyWaivers", () => {
  it("should auto-waive findings in autoWaiveCategories", () => {
    const findings = [
      createFinding({ category: "speculative_future", fingerprint: "a" }),
      createFinding({ category: "correctness", fingerprint: "b" }),
    ];
    const result = applyWaivers(findings, [], ["speculative_future"]);
    expect(result.waived).toHaveLength(1);
    expect(result.waived[0].finding.category).toBe("speculative_future");
    expect(result.active).toHaveLength(1);
    expect(result.active[0].category).toBe("correctness");
  });

  it("should match waiver by partial text in summary", () => {
    const findings = [
      createFinding({ summary: "API互換性の問題", fingerprint: "a" }),
    ];
    const waivers = [
      { match: "互換性", action: "ignore" as const, reason: "互換性は対象外" },
    ];
    const result = applyWaivers(findings, waivers, []);
    expect(result.waived).toHaveLength(1);
    expect(result.active).toHaveLength(0);
  });

  it("should match waiver by partial text in detail", () => {
    const findings = [
      createFinding({
        summary: "Some issue",
        detail: "将来の拡張性に関する指摘",
        fingerprint: "a",
      }),
    ];
    const waivers = [
      { match: "拡張性", action: "ignore" as const, reason: "拡張性は無視" },
    ];
    const result = applyWaivers(findings, waivers, []);
    expect(result.waived).toHaveLength(1);
  });

  it("should filter by category when waiver has category", () => {
    const findings = [
      createFinding({
        summary: "拡張性の問題",
        category: "correctness",
        fingerprint: "a",
      }),
      createFinding({
        summary: "拡張性の問題",
        category: "speculative_future",
        fingerprint: "b",
      }),
    ];
    const waivers = [
      {
        match: "拡張性",
        category: "speculative_future" as const,
        action: "ignore" as const,
        reason: "将来の話は無視",
      },
    ];
    const result = applyWaivers(findings, waivers, []);
    expect(result.waived).toHaveLength(1);
    expect(result.waived[0].finding.category).toBe("speculative_future");
    expect(result.active).toHaveLength(1);
    expect(result.active[0].category).toBe("correctness");
  });

  it("should handle downgrade action", () => {
    const findings = [
      createFinding({ summary: "パフォーマンスの懸念", fingerprint: "a" }),
    ];
    const waivers = [
      {
        match: "パフォーマンス",
        action: "downgrade" as const,
        downgradeTo: "non_blocking" as const,
        reason: "パフォーマンスはnon-blocking",
      },
    ];
    const result = applyWaivers(findings, waivers, []);
    expect(result.downgraded).toHaveLength(1);
    expect(result.downgraded[0].to).toBe("non_blocking");
    expect(result.active).toHaveLength(0);
  });

  it("should keep all findings active when no waivers match", () => {
    const findings = [
      createFinding({ summary: "Issue A", fingerprint: "a" }),
      createFinding({ summary: "Issue B", fingerprint: "b" }),
    ];
    const waivers = [
      { match: "unrelated", action: "ignore" as const, reason: "no match" },
    ];
    const result = applyWaivers(findings, waivers, []);
    expect(result.active).toHaveLength(2);
    expect(result.waived).toHaveLength(0);
  });

  it("should return all findings as active with empty waivers", () => {
    const findings = [
      createFinding({ fingerprint: "a" }),
      createFinding({ fingerprint: "b" }),
    ];
    const result = applyWaivers(findings, [], []);
    expect(result.active).toHaveLength(2);
    expect(result.waived).toHaveLength(0);
    expect(result.downgraded).toHaveLength(0);
  });
});
