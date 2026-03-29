import type { EvidenceRequirement } from "../types/index.js";

export interface EvidenceAnalysisResult {
  required: EvidenceRequirement[];
  suggested: EvidenceRequirement[];
}

const GITHUB_URL_PATTERN = /github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/gi;
const FIGMA_URL_PATTERN = /figma\.com\//gi;
const GH_COMMAND_PATTERN = /gh\s+(issue|pr)\s+(view|list)/gi;
const DOC_KEYWORDS = [
  "ドキュメントで確認",
  "公式ドキュメント",
  "ドキュメントを参照",
];
const WEB_SEARCH_KEYWORDS = ["Web検索", "Webで確認", "web検索", "webで確認"];

export const analyzeEvidenceRequirements = (
  planContent: string,
  promptContent: string
): EvidenceAnalysisResult => {
  const text = `${planContent}\n${promptContent}`;
  const required: EvidenceRequirement[] = [];
  const suggested: EvidenceRequirement[] = [];
  const addedSources = new Set<string>();

  GITHUB_URL_PATTERN.lastIndex = 0;
  GH_COMMAND_PATTERN.lastIndex = 0;
  if (
    (GITHUB_URL_PATTERN.test(text) || GH_COMMAND_PATTERN.test(text)) &&
    !addedSources.has("gh")
  ) {
    required.push({
      source: "gh",
      reason: "GitHub Issue/PR の確認",
      matchPatterns: ["gh issue", "gh pr"],
    });
    addedSources.add("gh");
  }

  FIGMA_URL_PATTERN.lastIndex = 0;
  if (FIGMA_URL_PATTERN.test(text) && !addedSources.has("figma_mcp")) {
    required.push({
      source: "figma_mcp",
      reason: "Figma デザインの確認",
      matchPatterns: ["figma"],
    });
    addedSources.add("figma_mcp");
  }

  if (
    DOC_KEYWORDS.some((kw) => text.includes(kw)) &&
    !addedSources.has("context7_mcp")
  ) {
    suggested.push({
      source: "context7_mcp",
      reason: "ライブラリドキュメントの確認",
      matchPatterns: ["context7", "resolve-library"],
    });
    addedSources.add("context7_mcp");
  }

  if (
    WEB_SEARCH_KEYWORDS.some((kw) => text.includes(kw)) &&
    !addedSources.has("web_search")
  ) {
    suggested.push({
      source: "web_search",
      reason: "Web検索",
      matchPatterns: ["web_search", "search"],
    });
    addedSources.add("web_search");
  }

  return { required, suggested };
};
