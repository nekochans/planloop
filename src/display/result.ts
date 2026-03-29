import pc from "picocolors";
import type { LoopState } from "../types/index.js";

export const displayResult = (
  state: LoopState,
  stdout: NodeJS.WritableStream
): void => {
  const statusText = formatStatus(state);
  const duration = `${state.startedAt} ~ ${state.updatedAt}`;
  const waiverCount = state.waivers.length;

  const lines = [
    "",
    pc.bold("════════════════════════════════════════"),
    pc.bold("  planloop 完了"),
    pc.bold("════════════════════════════════════════"),
    `  ステータス: ${statusText}`,
    `  ラウンド数: ${state.rounds.length}`,
    `  実行時間:   ${duration}`,
    `  適用Waiver: ${waiverCount}件`,
    "────────────────────────────────────────",
    "  ラウンド別サマリー:",
    ...state.rounds.map((r) => {
      const findingCount = r.review.findings.length;
      const actionableCount = r.actionableFindings.length;
      const triageLabel = r.humanFeedback === undefined ? "auto" : "triage";
      const revisionLabel = r.revision ? "Claude修正" : "";

      if (actionableCount === 0 && !r.revision) {
        return `    Round ${r.round}: ${findingCount}件 → 完了`;
      }
      return `    Round ${r.round}: ${findingCount}件 → ${triageLabel} → ${actionableCount}件blocking → ${revisionLabel}`;
    }),
    "────────────────────────────────────────",
    `  状態ファイル: ${state.rounds.length > 0 ? `${state.runId}/state.json` : "なし"}`,
    pc.bold("════════════════════════════════════════"),
    "",
  ];

  stdout.write(lines.join("\n"));
};

const formatStatus = (state: LoopState): string => {
  const reason = state.stopReason ? ` (${state.stopReason})` : "";
  const label = `${state.status}${reason}`;

  switch (state.status) {
    case "completed":
      return pc.green(label);
    case "stopped":
      if (state.stopReason === "human_abort") {
        return pc.red(label);
      }
      return pc.yellow(label);
    default:
      return label;
  }
};
