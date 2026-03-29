import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import pc from "picocolors";
import type { ReviewAdapter, RevisionAdapter } from "../adapters/types.js";
import type {
  Finding,
  LoopState,
  PlanloopConfig,
  RawFinding,
  RoundState,
  TriageResult,
} from "../types/index.js";
import { generateFingerprint } from "./fingerprint.js";
import { runNaturalLanguageTriage } from "./triage.js";
import { applyWaivers } from "./waiver.js";

export interface RunLoopOptions {
  config: PlanloopConfig;
  planFile: string;
  promptFile: string;
  reviewAdapter: ReviewAdapter;
  revisionAdapter: RevisionAdapter;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export const runLoop = async (options: RunLoopOptions): Promise<LoopState> => {
  const { planFile, promptFile, config, reviewAdapter, revisionAdapter } =
    options;
  const runId = generateRunId();
  const state: LoopState = {
    runId,
    planFile,
    promptFile,
    rounds: [],
    waivers: [],
    status: "in_progress",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await validateInputFiles(planFile, promptFile);

  const handleSigint = () => {
    state.status = "stopped";
    state.stopReason = "human_abort";
    state.updatedAt = new Date().toISOString();
    persistState(state, config.paths.runDir)
      .catch(() => {
        // best-effort save; proceed to exit regardless
      })
      .then(() => process.exit(1));
  };
  process.on("SIGINT", handleSigint);

  try {
    for (let round = 1; round <= config.policy.maxRounds; round++) {
      console.error(
        `\n${pc.bold(`════ Round ${round}/${config.policy.maxRounds}: Codex レビュー実行中 ════`)}`
      );

      const planContent = await readFile(planFile, "utf-8");
      const promptContent = await readFile(promptFile, "utf-8");

      const reviewResult = await reviewAdapter.review(
        planContent,
        promptContent,
        {
          round,
          previousWaivers: state.waivers,
          previousFindings: getPreviousFindings(state),
        }
      );

      const findings: Finding[] = reviewResult.findings.map((f) => ({
        ...f,
        fingerprint: generateFingerprint(f),
      }));

      console.error(
        `\n  ${pc.bold("レビュー完了")}: ${findings.length}件の指摘`
      );
      for (const f of findings) {
        const label = `[${f.severity.toUpperCase()}]`;
        const sev = formatSeverity(label, f.severity);
        console.error(`    ${sev} ${f.id}: ${f.summary}`);
      }

      const waiverResult = applyWaivers(
        findings,
        state.waivers,
        config.policy.autoWaiveCategories
      );

      let activeFindingsForRevision: RawFinding[] = waiverResult.active;
      let triageResult: TriageResult | undefined;

      const roundDir = getRoundDir(config.paths.runDir, state.runId, round);

      if (
        waiverResult.active.length > 0 &&
        needsHumanGate(round, waiverResult.active, state, config)
      ) {
        triageResult = await runNaturalLanguageTriage(
          waiverResult.active,
          round,
          planContent,
          promptContent,
          reviewAdapter,
          config,
          roundDir
        );
        activeFindingsForRevision = triageResult.adjustedFindings;
        state.waivers.push(...triageResult.newWaivers);
      }

      const actionable = filterByBlockingCategories(
        activeFindingsForRevision,
        config
      );

      const actionableWithFingerprint: Finding[] = actionable.map((f) => ({
        ...f,
        fingerprint: generateFingerprint(f),
      }));

      const rawOutputPath = await saveArtifact(
        roundDir,
        "codex-review.jsonl",
        reviewResult.rawOutput
      );

      const buildRoundState = (
        revision?: RoundState["revision"]
      ): RoundState => ({
        round,
        review: {
          round,
          timestamp: new Date().toISOString(),
          findings,
          toolsUsed: reviewResult.toolsUsed,
          rawOutputPath,
        },
        humanFeedback: triageResult?.humanFeedback,
        actionableFindings: actionableWithFingerprint,
        revision,
      });

      if (actionableWithFingerprint.length === 0) {
        state.rounds.push(buildRoundState());
        state.status = "completed";
        state.stopReason = "no_blocking_findings";
        state.updatedAt = new Date().toISOString();
        await persistState(state, config.paths.runDir);
        break;
      }

      if (
        isStagnating(
          state,
          actionableWithFingerprint,
          config.policy.stagnationRounds
        )
      ) {
        state.rounds.push(buildRoundState());
        state.status = "stopped";
        state.stopReason = "stagnation";
        state.updatedAt = new Date().toISOString();
        await persistState(state, config.paths.runDir);
        break;
      }

      console.error(
        `\n${pc.bold(`════ Round ${round}/${config.policy.maxRounds}: Claude Code 修正中 ════`)}`
      );

      const revision = await revisionAdapter.revise(
        planFile,
        promptFile,
        actionableWithFingerprint
      );

      await saveArtifact(roundDir, "claude-revision.json", revision.rawOutput);

      state.rounds.push(buildRoundState(revision));
      state.updatedAt = new Date().toISOString();
      await persistState(state, config.paths.runDir);
    }

    if (state.status === "in_progress") {
      state.status = "stopped";
      state.stopReason = "max_rounds";
      state.updatedAt = new Date().toISOString();
      await persistState(state, config.paths.runDir);
    }
  } finally {
    process.removeListener("SIGINT", handleSigint);
  }

  return state;
};

export const needsHumanGate = (
  round: number,
  activeFindings: Finding[],
  state: LoopState,
  config: PlanloopConfig
): boolean => {
  if (round === 1 && config.policy.requireHumanOnFirstRound) {
    return true;
  }
  if (config.policy.requireHumanOnNewHighSeverity) {
    const previousFingerprints = new Set(
      state.rounds.flatMap((r) => r.review.findings.map((f) => f.fingerprint))
    );
    const hasNewHigh = activeFindings.some(
      (f) => f.severity === "high" && !previousFingerprints.has(f.fingerprint)
    );
    return hasNewHigh;
  }
  return false;
};

export const isStagnating = (
  state: LoopState,
  currentActionable: Finding[],
  threshold: number
): boolean => {
  if (state.rounds.length < threshold) {
    return false;
  }

  const currentSet = new Set(currentActionable.map((f) => f.fingerprint));
  let consecutiveMatch = 0;

  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const prevSet = new Set(
      state.rounds[i].actionableFindings.map((f) => f.fingerprint)
    );
    if (setsAreEqual(currentSet, prevSet)) {
      consecutiveMatch++;
    } else {
      break;
    }
  }

  return consecutiveMatch >= threshold;
};

const setsAreEqual = <T>(a: Set<T>, b: Set<T>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
};

export const filterByBlockingCategories = (
  findings: RawFinding[],
  config: PlanloopConfig
): RawFinding[] => {
  return findings.filter((f) =>
    config.policy.blockingCategories.includes(f.category)
  );
};

const getPreviousFindings = (state: LoopState): Finding[] => {
  return state.rounds.flatMap((r) => r.review.findings);
};

const generateRunId = (): string => {
  return new Date().toISOString().replace(/[:.]/g, "-");
};

const validateInputFiles = async (
  planFile: string,
  promptFile: string
): Promise<void> => {
  try {
    await access(planFile);
  } catch {
    throw new Error(`実装計画ファイルが見つかりません: ${planFile}`);
  }
  try {
    await access(promptFile);
  } catch {
    throw new Error(`プロンプトファイルが見つかりません: ${promptFile}`);
  }
  for (const file of [planFile, promptFile]) {
    if (extname(file) !== ".md") {
      console.warn(`警告: ${file} はMarkdownファイルではありません`);
    }
  }
};

const getRoundDir = (runDir: string, runId: string, round: number): string =>
  resolve(runDir, runId, `round-${round}`);

const saveArtifact = async (
  roundDir: string,
  filename: string,
  content: string
): Promise<string> => {
  await mkdir(roundDir, { recursive: true });
  const filePath = resolve(roundDir, filename);
  await writeFile(filePath, content, "utf-8");
  return filePath;
};

const persistState = async (
  state: LoopState,
  runDir: string
): Promise<void> => {
  const dir = resolve(runDir, state.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
};

const formatSeverity = (label: string, severity: string): string => {
  if (severity === "high") {
    return pc.red(label);
  }
  if (severity === "medium") {
    return pc.yellow(label);
  }
  return pc.dim(label);
};
