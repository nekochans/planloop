import type { Finding, RawFinding } from "../types/index.js";

export const createRawFinding = (
  overrides: Partial<RawFinding> = {}
): RawFinding => ({
  id: "finding-1",
  summary: "Test finding summary",
  detail: "Test finding detail",
  severity: "high",
  category: "correctness",
  ...overrides,
});

export const createFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "finding-1",
  summary: "Test finding summary",
  detail: "Test finding detail",
  severity: "high",
  category: "correctness",
  fingerprint: "abc123",
  ...overrides,
});

export const sampleFindings: RawFinding[] = [
  createRawFinding({
    id: "finding-1",
    summary: "API endpoint path mismatch",
    detail:
      "The plan references /api/v2/users but the spec defines /api/v1/users.",
    severity: "high",
    category: "correctness",
  }),
  createRawFinding({
    id: "finding-2",
    summary: "Missing error handling for network timeout",
    detail:
      "The error handling strategy doesn't cover network timeout scenarios.",
    severity: "medium",
    category: "spec_mismatch",
  }),
  createRawFinding({
    id: "finding-3",
    summary: "Consider adding pagination support",
    detail: "Consider adding pagination support for future scaling needs.",
    severity: "low",
    category: "speculative_future",
  }),
];
