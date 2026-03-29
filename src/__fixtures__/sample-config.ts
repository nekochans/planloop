import type { PlanloopConfig } from "../types/index.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U>
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const defaults: PlanloopConfig = {
  version: 1,
  paths: {
    reviewDir: "design-docs-for-ai",
    runDir: ".planloop/runs",
  },
  policy: {
    requireHumanOnFirstRound: true,
    requireHumanOnNewHighSeverity: true,
    maxRounds: 8,
    stagnationRounds: 2,
    blockingCategories: [
      "correctness",
      "spec_mismatch",
      "missing_acceptance_criteria",
      "migration_risk",
    ],
    autoWaiveCategories: ["speculative_future", "unnecessary_fallback"],
  },
  review: {
    perspectives: [
      "correctness: 実装計画の内容が要件と一致しているか",
      "spec_mismatch: 仕様との不一致がないか",
      "missing_acceptance_criteria: 受け入れ基準の漏れがないか",
      "migration_risk: マイグレーションリスクがないか",
      "security: セキュリティ上の懸念がないか",
      "performance: パフォーマンス上の懸念がないか",
    ],
  },
  engines: {
    claude: {
      mode: "inherited",
    },
  },
};

export const createSampleConfig = (
  overrides: DeepPartial<PlanloopConfig> = {}
): PlanloopConfig => ({
  version: 1,
  paths: { ...defaults.paths, ...overrides.paths },
  policy: { ...defaults.policy, ...overrides.policy },
  review: { ...defaults.review, ...overrides.review },
  engines: {
    claude: { ...defaults.engines.claude, ...overrides.engines?.claude },
  },
});
