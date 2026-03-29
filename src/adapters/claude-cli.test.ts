import { describe, expect, it } from "vitest";
import { extractRevisionResult } from "./claude-cli.js";

describe("extractRevisionResult", () => {
  it("should parse result from stream-json output", () => {
    const output = `{"type":"message","role":"assistant","content":"Analyzing..."}
{"type":"tool_use","tool":"Read","path":"plan.md"}
{"type":"result","result":"{\\"reflectedFindings\\":[\\"finding-1\\",\\"finding-2\\"],\\"summary\\":\\"APIパスを修正しました\\"}"}`;

    const result = extractRevisionResult(output);
    expect(result.reflectedFindings).toEqual(["finding-1", "finding-2"]);
    expect(result.summary).toBe("APIパスを修正しました");
  });

  it("should parse direct JSON result", () => {
    const output = `{"reflectedFindings":["finding-1"],"summary":"修正完了"}`;
    const result = extractRevisionResult(output);
    expect(result.reflectedFindings).toEqual(["finding-1"]);
    expect(result.summary).toBe("修正完了");
  });

  it("should return empty result for unparseable output", () => {
    const output = "Some non-JSON text\nAnother line";
    const result = extractRevisionResult(output);
    expect(result.reflectedFindings).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("should handle empty output", () => {
    const result = extractRevisionResult("");
    expect(result.reflectedFindings).toEqual([]);
    expect(result.summary).toBe("");
  });
});
