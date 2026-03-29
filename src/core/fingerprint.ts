import { createHash } from "node:crypto";
import type { Finding } from "../types/index.js";

export const generateFingerprint = (
  finding: Omit<Finding, "fingerprint">
): string => {
  const normalized = finding.summary
    .toLowerCase()
    .replace(/\d+/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();

  const input = `${finding.category}:${normalized}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
};
