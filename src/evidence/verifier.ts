import type {
  EvidenceRequirement,
  EvidenceVerificationResult,
} from "../types/index.js";

export const verifyEvidence = (
  toolsUsed: string[],
  required: EvidenceRequirement[],
  suggested: EvidenceRequirement[]
): EvidenceVerificationResult => {
  const checkRequirements = (reqs: EvidenceRequirement[]) =>
    reqs.map((req) => {
      const matchedTools = toolsUsed.filter((tool) =>
        req.matchPatterns.some((pattern) =>
          tool.toLowerCase().includes(pattern.toLowerCase())
        )
      );
      return {
        ...req,
        satisfied: matchedTools.length > 0,
        matchedTools,
      };
    });

  const requiredResults = checkRequirements(required);
  const suggestedResults = checkRequirements(suggested);

  return {
    required: requiredResults,
    suggested: suggestedResults,
    allRequiredSatisfied: requiredResults.every((r) => r.satisfied),
  };
};
