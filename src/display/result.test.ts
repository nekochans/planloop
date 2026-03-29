import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { LoopState } from "../types/index.js";
import { displayResult } from "./result.js";

const createLoopState = (overrides: Partial<LoopState> = {}): LoopState => ({
  runId: "2026-03-28T21-40-00-000Z",
  planFile: "plan.md",
  promptFile: "prompt.md",
  rounds: [],
  waivers: [],
  status: "completed",
  stopReason: "no_blocking_findings",
  startedAt: "2026-03-28T21:40:00Z",
  updatedAt: "2026-03-28T21:55:00Z",
  ...overrides,
});

describe("displayResult", () => {
  it("should display completed status", () => {
    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    displayResult(createLoopState(), stdout);
    expect(output).toContain("planloop 完了");
    expect(output).toContain("completed");
    expect(output).toContain("no_blocking_findings");
  });

  it("should display round summaries", () => {
    const state = createLoopState({
      rounds: [
        {
          round: 1,
          review: {
            round: 1,
            timestamp: "t1",
            findings: [
              {
                id: "f1",
                summary: "s",
                detail: "d",
                severity: "high",
                category: "correctness",
                fingerprint: "fp1",
              },
            ],
            toolsUsed: [],
            rawOutputPath: "/tmp/raw.jsonl",
          },
          humanFeedback: "feedback",
          actionableFindings: [
            {
              id: "f1",
              summary: "s",
              detail: "d",
              severity: "high",
              category: "correctness",
              fingerprint: "fp1",
            },
          ],
          revision: {
            reflectedFindings: ["f1"],
            summary: "Fixed",
            timestamp: "t2",
          },
        },
      ],
    });

    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    displayResult(state, stdout);
    expect(output).toContain("Round 1");
    expect(output).toContain("1件");
    expect(output).toContain("triage");
  });

  it("should display waiver count", () => {
    const state = createLoopState({
      waivers: [
        { match: "test", action: "ignore", reason: "test" },
        { match: "test2", action: "ignore", reason: "test2" },
      ],
    });

    const stdout = new PassThrough();
    let output = "";
    stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    displayResult(state, stdout);
    expect(output).toContain("2件");
  });
});
