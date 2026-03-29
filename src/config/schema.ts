import { z } from "zod";
import { FINDING_CATEGORIES } from "../types/index.js";

const findingCategorySchema = z.enum(FINDING_CATEGORIES);

export const configSchema = z.object({
  version: z.literal(1),
  paths: z
    .object({
      reviewDir: z.string().default("design-docs-for-ai"),
      runDir: z.string().default(".planloop/runs"),
    })
    .prefault({}),
  policy: z
    .object({
      requireHumanOnFirstRound: z.boolean().default(true),
      requireHumanOnNewHighSeverity: z.boolean().default(true),
      maxRounds: z.number().int().min(1).max(20).default(8),
      stagnationRounds: z.number().int().min(1).max(10).default(2),
      blockingCategories: z
        .array(findingCategorySchema)
        .default([
          "correctness",
          "spec_mismatch",
          "missing_acceptance_criteria",
          "migration_risk",
        ]),
      autoWaiveCategories: z
        .array(findingCategorySchema)
        .default(["speculative_future", "unnecessary_fallback"]),
    })
    .prefault({}),
  review: z
    .object({
      perspectives: z
        .array(z.string())
        .default([
          "correctness: 実装計画の内容が要件と一致しているか",
          "spec_mismatch: 仕様との不一致がないか",
          "missing_acceptance_criteria: 受け入れ基準の漏れがないか",
          "migration_risk: マイグレーションリスクがないか",
          "security: セキュリティ上の懸念がないか",
          "performance: パフォーマンス上の懸念がないか",
        ]),
      additionalInstructions: z.string().optional(),
    })
    .prefault({}),
  engines: z
    .object({
      claude: z
        .object({
          mode: z.enum(["inherited", "bare"]).default("inherited"),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type ConfigInput = z.input<typeof configSchema>;
