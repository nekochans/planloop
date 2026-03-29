import { describe, expect, it } from "vitest";
import { createRawFinding } from "../__fixtures__/sample-findings.js";
import { generateFingerprint } from "./fingerprint.js";

describe("generateFingerprint", () => {
  it("should return the same fingerprint for identical findings", () => {
    const finding = createRawFinding({ summary: "API path mismatch" });
    const fp1 = generateFingerprint(finding);
    const fp2 = generateFingerprint(finding);
    expect(fp1).toBe(fp2);
  });

  it("should return the same fingerprint for different numeric values in summary", () => {
    const finding1 = createRawFinding({ summary: "Error on line 42" });
    const finding2 = createRawFinding({ summary: "Error on line 99" });
    expect(generateFingerprint(finding1)).toBe(generateFingerprint(finding2));
  });

  it("should return the same fingerprint for case differences", () => {
    const finding1 = createRawFinding({ summary: "API Path Mismatch" });
    const finding2 = createRawFinding({ summary: "api path mismatch" });
    expect(generateFingerprint(finding1)).toBe(generateFingerprint(finding2));
  });

  it("should return different fingerprints for different categories", () => {
    const finding1 = createRawFinding({
      summary: "Same summary",
      category: "correctness",
    });
    const finding2 = createRawFinding({
      summary: "Same summary",
      category: "security",
    });
    expect(generateFingerprint(finding1)).not.toBe(
      generateFingerprint(finding2)
    );
  });

  it("should return different fingerprints for different summaries", () => {
    const finding1 = createRawFinding({ summary: "API mismatch" });
    const finding2 = createRawFinding({ summary: "Missing validation" });
    expect(generateFingerprint(finding1)).not.toBe(
      generateFingerprint(finding2)
    );
  });

  it("should handle empty summary without error", () => {
    const finding = createRawFinding({ summary: "" });
    const fp = generateFingerprint(finding);
    expect(fp).toHaveLength(16);
  });

  it("should return 16 character hex string", () => {
    const finding = createRawFinding();
    const fp = generateFingerprint(finding);
    expect(fp).toHaveLength(16);
    expect(fp).toBe(fp.toLowerCase());
  });
});
