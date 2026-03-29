import type {
  Finding,
  RawFinding,
  RevisionResult,
  Waiver,
} from "../types/index.js";

/** レビューアダプターへの入力コンテキスト */
export interface ReviewContext {
  previousFindings: Finding[];
  previousWaivers: Waiver[];
  round: number;
}

/** レビューアダプターの出力 */
export interface ReviewAdapterResult {
  findings: RawFinding[];
  rawOutput: string;
  toolsUsed: string[];
}

/** トリアージ付き再レビューの入力コンテキスト */
export interface FeedbackReviewContext {
  humanFeedback: string;
  originalFindings: RawFinding[];
  round: number;
}

/** レビュー実行アダプター（Codex等） */
export interface ReviewAdapter {
  review: (
    planContent: string,
    promptContent: string,
    context: ReviewContext
  ) => Promise<ReviewAdapterResult>;

  reviewWithFeedback: (
    planContent: string,
    promptContent: string,
    context: FeedbackReviewContext
  ) => Promise<ReviewAdapterResult>;
}

/** プラン修正アダプター（Claude等） */
export interface RevisionAdapter {
  revise: (
    planFile: string,
    promptFile: string,
    findings: Finding[]
  ) => Promise<RevisionResult>;
}
