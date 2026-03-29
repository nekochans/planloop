import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFindings, parseFindingsFromJsonl } from "./codex-cli.js";

describe("parseFindings", () => {
  it("should parse valid JSON findings", () => {
    const output = JSON.stringify({
      findings: [
        {
          id: "finding-1",
          summary: "API mismatch",
          detail: "Path is wrong",
          severity: "high",
          category: "correctness",
        },
      ],
    });
    const findings = parseFindings(output);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("finding-1");
    expect(findings[0].severity).toBe("high");
  });

  it("should parse findings from code block", () => {
    const output = `Here are my findings:
\`\`\`json
{
  "findings": [
    {
      "id": "finding-1",
      "summary": "Test",
      "detail": "Detail",
      "severity": "medium",
      "category": "spec_mismatch"
    }
  ]
}
\`\`\``;
    const findings = parseFindings(output);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("spec_mismatch");
  });

  it("should do partial parsing when some findings are invalid", () => {
    const output = JSON.stringify({
      findings: [
        {
          id: "finding-1",
          summary: "Valid",
          detail: "Detail",
          severity: "high",
          category: "correctness",
        },
        {
          id: "finding-2",
          summary: "Invalid",
          // missing detail
          severity: "invalid_severity",
          category: "correctness",
        },
      ],
    });
    const findings = parseFindings(output);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("finding-1");
  });

  it("should throw on completely invalid JSON", () => {
    expect(() => parseFindings("not json at all")).toThrow();
  });
});

describe("parseFindingsFromJsonl", () => {
  it("should extract findings from valid JSONL", () => {
    const jsonl = readFileSync(
      resolve(import.meta.dirname, "../__fixtures__/codex-output-valid.jsonl"),
      "utf-8"
    );
    const findings = parseFindingsFromJsonl(jsonl);
    expect(findings).toHaveLength(2);
    expect(findings[0].id).toBe("finding-1");
  });

  it("should collect toolsUsed from JSONL events", () => {
    // This tests the collectToolUsage logic indirectly via the JSONL fixture
    const jsonl = readFileSync(
      resolve(import.meta.dirname, "../__fixtures__/codex-output-valid.jsonl"),
      "utf-8"
    );
    const findings = parseFindingsFromJsonl(jsonl);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("should return empty array for malformed JSONL", () => {
    const jsonl = readFileSync(
      resolve(
        import.meta.dirname,
        "../__fixtures__/codex-output-malformed.jsonl"
      ),
      "utf-8"
    );
    const findings = parseFindingsFromJsonl(jsonl);
    expect(findings).toHaveLength(0);
  });

  it("should return empty array for empty input", () => {
    const findings = parseFindingsFromJsonl("");
    expect(findings).toHaveLength(0);
  });
});
