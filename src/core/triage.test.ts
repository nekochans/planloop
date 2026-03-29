import { describe, expect, it } from "vitest";
import { createRawFinding } from "../__fixtures__/sample-findings.js";
import {
  buildTriageFileContent,
  extractFeedback,
  extractWaiversFromFeedback,
} from "./triage.js";

describe("buildTriageFileContent", () => {
  it("should generate markdown with all findings", () => {
    const findings = [
      createRawFinding({
        id: "finding-1",
        summary: "Issue A",
        severity: "high",
      }),
      createRawFinding({
        id: "finding-2",
        summary: "Issue B",
        severity: "low",
      }),
    ];
    const content = buildTriageFileContent(findings, 1);
    expect(content).toContain("# Codex レビュー結果 (Round 1)");
    expect(content).toContain("## finding-1 [HIGH]");
    expect(content).toContain("Issue A");
    expect(content).toContain("## finding-2 [LOW]");
    expect(content).toContain("Issue B");
    expect(content).toContain("# フィードバック");
  });

  it("should include the separator", () => {
    const content = buildTriageFileContent([createRawFinding()], 2);
    expect(content).toContain("---");
    expect(content).toContain("Round 2");
  });

  it("should include instructions as HTML comments", () => {
    const content = buildTriageFileContent([createRawFinding()], 1);
    expect(content).toContain("<!--");
    expect(content).toContain("-->");
  });
});

describe("extractFeedback", () => {
  it("should extract user feedback and ignore HTML comments", () => {
    const content = `# Codex レビュー結果
some findings

---

# フィードバック

<!-- 以下にフィードバックを記入してください。 -->
<!-- 書き方の例:
- finding-2は対象外
-->

- finding-1は修正済みなので対象外
- 以後、パフォーマンスに関する指摘は無視`;

    const feedback = extractFeedback(content);
    expect(feedback).toContain("finding-1は修正済みなので対象外");
    expect(feedback).toContain("以後、パフォーマンスに関する指摘は無視");
    expect(feedback).not.toContain("<!--");
    expect(feedback).not.toContain("書き方の例");
  });

  it("should return empty string when only HTML comments remain", () => {
    const content = `# Findings

---

# フィードバック

<!-- 以下にフィードバックを記入してください。 -->
<!-- 書き方の例:
- finding-2は対象外
-->

`;
    const feedback = extractFeedback(content);
    expect(feedback).toBe("");
  });

  it("should return empty string when no separator", () => {
    const content = "No separator here";
    const feedback = extractFeedback(content);
    expect(feedback).toBe("");
  });
});

describe("extractWaiversFromFeedback", () => {
  it("should extract waiver from line with 以後", () => {
    const feedback = "以後、「将来の拡張性」に関する指摘は無視";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers).toHaveLength(1);
    expect(waivers[0].match).toBe("将来の拡張性");
    expect(waivers[0].action).toBe("ignore");
  });

  it("should extract waiver from line with 今後", () => {
    const feedback = "今後、互換性の指摘は対象外";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers).toHaveLength(1);
    expect(waivers[0].reason).toContain("今後");
  });

  it("should extract waiver from line with 今回以降", () => {
    const feedback = "今回以降、セキュリティの指摘は無視";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers).toHaveLength(1);
  });

  it("should not create waiver for one-time feedback", () => {
    const feedback = "- 指摘2はスコープ外\n- 指摘4は方向性だけ採用";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers).toHaveLength(0);
  });

  it("should extract quoted text as match", () => {
    const feedback = "以後、「パフォーマンス最適化」に関する指摘は不要";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers[0].match).toBe("パフォーマンス最適化");
  });

  it("should use full line as match when no quoted text", () => {
    const feedback = "以後、パフォーマンスに関する指摘は不要";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers[0].match).toBe("以後、パフォーマンスに関する指摘は不要");
  });

  it("should handle list marker prefixes", () => {
    const feedback = "- 以後、「拡張性」の指摘は不要";
    const waivers = extractWaiversFromFeedback(feedback);
    expect(waivers).toHaveLength(1);
    expect(waivers[0].match).toBe("拡張性");
  });
});
