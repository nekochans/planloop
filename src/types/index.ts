// ---- Finding categories ----
export const FINDING_CATEGORIES = [
  "correctness",
  "spec_mismatch",
  "missing_acceptance_criteria",
  "migration_risk",
  "speculative_future",
  "unnecessary_fallback",
  "code_quality",
  "security",
  "performance",
  "other",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

// ---- Finding severity ----
export const FINDING_SEVERITIES = ["high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

// ---- A single review finding ----
export interface Finding {
  category: FindingCategory;
  detail: string;
  fingerprint: string;
  id: string;
  lineRef?: string;
  severity: FindingSeverity;
  summary: string;
}

// ---- Triage result ----
export interface TriageResult {
  adjustedFindings: RawFinding[];
  humanFeedback: string;
  newWaivers: Waiver[];
}

// ---- Raw finding (fingerprint未設定、アダプターからの生出力) ----
export type RawFinding = Omit<Finding, "fingerprint">;

// ---- Persistent waiver rule ----
export interface Waiver {
  action: "ignore" | "downgrade";
  category?: FindingCategory;
  downgradeTo?: "non_blocking";
  match: string;
  reason: string;
}

// ---- Codex review result ----
export interface ReviewResult {
  findings: Finding[];
  rawOutputPath: string;
  round: number;
  timestamp: string;
  toolsUsed: string[];
}

// ---- Claude revision result ----
export interface RevisionResult {
  rawOutput: string;
  reflectedFindings: string[];
  summary: string;
  timestamp: string;
}

// ---- State for a single round ----
export interface RoundState {
  actionableFindings: Finding[];
  humanFeedback?: string;
  review: ReviewResult;
  revision?: RevisionResult;
  round: number;
}

// ---- Overall loop state ----
export type LoopStatus = "in_progress" | "completed" | "stopped";

export interface LoopState {
  planFile: string;
  promptFile: string;
  rounds: RoundState[];
  runId: string;
  startedAt: string;
  status: LoopStatus;
  stopReason?: StopReason;
  updatedAt: string;
  waivers: Waiver[];
}

// ---- Stop reason ----
export type StopReason =
  | "no_blocking_findings"
  | "stagnation"
  | "max_rounds"
  | "human_abort";

// ---- Evidence verification ----
export const EVIDENCE_SOURCES = [
  "gh",
  "figma_mcp",
  "context7_mcp",
  "web_search",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface EvidenceRequirement {
  matchPatterns: string[];
  reason: string;
  source: EvidenceSource;
}

export interface EvidenceVerificationResult {
  allRequiredSatisfied: boolean;
  required: Array<
    EvidenceRequirement & { satisfied: boolean; matchedTools: string[] }
  >;
  suggested: Array<
    EvidenceRequirement & { satisfied: boolean; matchedTools: string[] }
  >;
}

// ---- Config ----
export interface PlanloopConfig {
  engines: {
    claude: {
      mode: "inherited" | "bare";
    };
  };
  paths: {
    reviewDir: string;
    runDir: string;
  };
  policy: {
    requireHumanOnFirstRound: boolean;
    requireHumanOnNewHighSeverity: boolean;
    maxRounds: number;
    stagnationRounds: number;
    blockingCategories: FindingCategory[];
    autoWaiveCategories: FindingCategory[];
  };
  review: {
    perspectives: string[];
    additionalInstructions?: string;
  };
  version: 1;
}
