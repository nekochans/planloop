import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleConfig } from "../__fixtures__/sample-config.js";
import { createRawFinding } from "../__fixtures__/sample-findings.js";
import type { ReviewAdapter, RevisionAdapter } from "../adapters/types.js";
import type { Finding, LoopState } from "../types/index.js";
import {
  filterByBlockingCategories,
  isStagnating,
  needsHumanGate,
  runLoop,
} from "./loop-runner.js";

const createMockReviewAdapter = (
  findingsPerRound: ReturnType<typeof createRawFinding>[][]
): ReviewAdapter => {
  let callCount = 0;
  return {
    review: vi.fn(() => {
      const findings = findingsPerRound[callCount] ?? [];
      callCount++;
      return Promise.resolve({ findings, toolsUsed: [], rawOutput: "{}" });
    }),
    reviewWithFeedback: vi.fn(() =>
      Promise.resolve({
        findings: [],
        toolsUsed: [],
        rawOutput: "{}",
      })
    ),
  };
};

const createMockRevisionAdapter = (): RevisionAdapter => ({
  revise: vi.fn(() =>
    Promise.resolve({
      reflectedFindings: ["finding-1"],
      summary: "修正完了",
      rawOutput: "{}",
      timestamp: new Date().toISOString(),
    })
  ),
});

describe("runLoop", () => {
  let testDir: string;
  let planFile: string;
  let promptFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `planloop-loop-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    planFile = join(testDir, "plan.md");
    promptFile = join(testDir, "prompt.md");
    await writeFile(planFile, "# Test Plan", "utf-8");
    await writeFile(promptFile, "# Test Prompt", "utf-8");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should complete immediately when no blocking findings", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
      policy: {
        requireHumanOnFirstRound: false,
        requireHumanOnNewHighSeverity: false,
      },
    });
    const reviewAdapter = createMockReviewAdapter([[]]);
    const revisionAdapter = createMockRevisionAdapter();

    const result = await runLoop({
      planFile,
      promptFile,
      config,
      reviewAdapter,
      revisionAdapter,
    });

    expect(result.status).toBe("completed");
    expect(result.stopReason).toBe("no_blocking_findings");
    expect(result.rounds).toHaveLength(1);
  });

  it("should run multiple rounds until no blocking findings", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
      policy: {
        requireHumanOnFirstRound: false,
        requireHumanOnNewHighSeverity: false,
      },
    });
    const reviewAdapter = createMockReviewAdapter([
      [createRawFinding({ id: "f1", category: "correctness" })],
      [],
    ]);
    const revisionAdapter = createMockRevisionAdapter();

    const result = await runLoop({
      planFile,
      promptFile,
      config,
      reviewAdapter,
      revisionAdapter,
    });

    expect(result.status).toBe("completed");
    expect(result.rounds).toHaveLength(2);
    expect(revisionAdapter.revise).toHaveBeenCalledTimes(1);
  });

  it("should stop at maxRounds", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
      policy: {
        maxRounds: 2,
        requireHumanOnFirstRound: false,
        requireHumanOnNewHighSeverity: false,
      },
    });
    const finding = createRawFinding({ id: "f1", category: "correctness" });
    const reviewAdapter = createMockReviewAdapter([
      [finding],
      [finding],
      [finding],
    ]);
    const revisionAdapter = createMockRevisionAdapter();

    const result = await runLoop({
      planFile,
      promptFile,
      config,
      reviewAdapter,
      revisionAdapter,
    });

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("max_rounds");
  });

  it("should stop on stagnation when same findings repeat", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
      policy: {
        maxRounds: 10,
        stagnationRounds: 2,
        requireHumanOnFirstRound: false,
        requireHumanOnNewHighSeverity: false,
      },
    });
    const finding = createRawFinding({ id: "f1", category: "correctness" });
    const reviewAdapter = createMockReviewAdapter([
      [finding],
      [finding],
      [finding],
    ]);
    const revisionAdapter = createMockRevisionAdapter();

    const result = await runLoop({
      planFile,
      promptFile,
      config,
      reviewAdapter,
      revisionAdapter,
    });

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("stagnation");
  });

  it("should throw on missing plan file", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
    });
    await expect(
      runLoop({
        planFile: "/nonexistent/plan.md",
        promptFile,
        config,
        reviewAdapter: createMockReviewAdapter([]),
        revisionAdapter: createMockRevisionAdapter(),
      })
    ).rejects.toThrow("実装計画ファイルが見つかりません");
  });

  it("should throw on missing prompt file", async () => {
    const config = createSampleConfig({
      paths: { reviewDir: testDir, runDir: join(testDir, "runs") },
    });
    await expect(
      runLoop({
        planFile,
        promptFile: "/nonexistent/prompt.md",
        config,
        reviewAdapter: createMockReviewAdapter([]),
        revisionAdapter: createMockRevisionAdapter(),
      })
    ).rejects.toThrow("プロンプトファイルが見つかりません");
  });
});

describe("needsHumanGate", () => {
  const config = createSampleConfig();
  const emptyState: LoopState = {
    runId: "test",
    planFile: "",
    promptFile: "",
    rounds: [],
    waivers: [],
    status: "in_progress",
    startedAt: "",
    updatedAt: "",
  };

  it("should return true on first round when requireHumanOnFirstRound", () => {
    expect(needsHumanGate(1, [], emptyState, config)).toBe(true);
  });

  it("should return false on first round when not requireHumanOnFirstRound", () => {
    const cfg = createSampleConfig({
      policy: { ...config.policy, requireHumanOnFirstRound: false },
    });
    expect(needsHumanGate(1, [], emptyState, cfg)).toBe(false);
  });

  it("should return true when new HIGH severity finding appears", () => {
    const finding: Finding = {
      id: "new",
      summary: "new high",
      detail: "d",
      severity: "high",
      category: "correctness",
      fingerprint: "new-fp",
    };
    expect(needsHumanGate(2, [finding], emptyState, config)).toBe(true);
  });

  it("should return false when HIGH finding already seen", () => {
    const finding: Finding = {
      id: "old",
      summary: "old high",
      detail: "d",
      severity: "high",
      category: "correctness",
      fingerprint: "existing-fp",
    };
    const stateWithPrevious: LoopState = {
      ...emptyState,
      rounds: [
        {
          round: 1,
          review: {
            round: 1,
            timestamp: "",
            findings: [finding],
            toolsUsed: [],
            rawOutputPath: "",
          },
          actionableFindings: [finding],
        },
      ],
    };
    expect(needsHumanGate(2, [finding], stateWithPrevious, config)).toBe(false);
  });
});

describe("isStagnating", () => {
  const findingA: Finding = {
    id: "a",
    summary: "A",
    detail: "",
    severity: "high",
    category: "correctness",
    fingerprint: "fp-a",
  };

  it("should return false when not enough rounds", () => {
    const state: LoopState = {
      runId: "test",
      planFile: "",
      promptFile: "",
      rounds: [],
      waivers: [],
      status: "in_progress",
      startedAt: "",
      updatedAt: "",
    };
    expect(isStagnating(state, [findingA], 2)).toBe(false);
  });

  it("should return true when same fingerprints for threshold rounds", () => {
    const state: LoopState = {
      runId: "test",
      planFile: "",
      promptFile: "",
      rounds: [
        {
          round: 1,
          review: {
            round: 1,
            timestamp: "",
            findings: [],
            toolsUsed: [],
            rawOutputPath: "",
          },
          actionableFindings: [findingA],
        },
        {
          round: 2,
          review: {
            round: 2,
            timestamp: "",
            findings: [],
            toolsUsed: [],
            rawOutputPath: "",
          },
          actionableFindings: [findingA],
        },
      ],
      waivers: [],
      status: "in_progress",
      startedAt: "",
      updatedAt: "",
    };
    expect(isStagnating(state, [findingA], 2)).toBe(true);
  });

  it("should return false when fingerprints change", () => {
    const findingB: Finding = { ...findingA, id: "b", fingerprint: "fp-b" };
    const state: LoopState = {
      runId: "test",
      planFile: "",
      promptFile: "",
      rounds: [
        {
          round: 1,
          review: {
            round: 1,
            timestamp: "",
            findings: [],
            toolsUsed: [],
            rawOutputPath: "",
          },
          actionableFindings: [findingA],
        },
        {
          round: 2,
          review: {
            round: 2,
            timestamp: "",
            findings: [],
            toolsUsed: [],
            rawOutputPath: "",
          },
          actionableFindings: [findingB],
        },
      ],
      waivers: [],
      status: "in_progress",
      startedAt: "",
      updatedAt: "",
    };
    expect(isStagnating(state, [findingA], 2)).toBe(false);
  });
});

describe("filterByBlockingCategories", () => {
  const config = createSampleConfig();

  it("should keep findings in blocking categories", () => {
    const findings = [
      createRawFinding({ category: "correctness" }),
      createRawFinding({ category: "code_quality" }),
      createRawFinding({ category: "spec_mismatch" }),
    ];
    const result = filterByBlockingCategories(findings, config);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.category)).toEqual([
      "correctness",
      "spec_mismatch",
    ]);
  });

  it("should return empty when no findings match blocking categories", () => {
    const findings = [
      createRawFinding({ category: "code_quality" }),
      createRawFinding({ category: "performance" }),
    ];
    const result = filterByBlockingCategories(findings, config);
    expect(result).toHaveLength(0);
  });
});
