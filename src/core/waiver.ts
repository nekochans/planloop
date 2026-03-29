import type { Finding, FindingCategory, Waiver } from "../types/index.js";

export interface WaiverResult {
  active: Finding[];
  downgraded: Array<{ finding: Finding; from: "blocking"; to: "non_blocking" }>;
  waived: Array<{ finding: Finding; reason: string }>;
}

export const applyWaivers = (
  findings: Finding[],
  waivers: Waiver[],
  autoWaiveCategories: FindingCategory[]
): WaiverResult => {
  const active: Finding[] = [];
  const waived: WaiverResult["waived"] = [];
  const downgraded: WaiverResult["downgraded"] = [];

  for (const finding of findings) {
    if (autoWaiveCategories.includes(finding.category)) {
      waived.push({
        finding,
        reason: `カテゴリ "${finding.category}" は自動waive対象`,
      });
      continue;
    }

    const matchedWaiver = waivers.find((w) => matchesWaiver(finding, w));

    if (!matchedWaiver) {
      active.push(finding);
      continue;
    }

    if (matchedWaiver.action === "ignore") {
      waived.push({ finding, reason: matchedWaiver.reason });
    } else if (matchedWaiver.action === "downgrade") {
      downgraded.push({ finding, from: "blocking", to: "non_blocking" });
    }
  }

  return { active, waived, downgraded };
};

const matchesWaiver = (finding: Finding, waiver: Waiver): boolean => {
  if (waiver.category && waiver.category !== finding.category) {
    return false;
  }
  const text = `${finding.summary} ${finding.detail}`;
  return text.includes(waiver.match);
};
