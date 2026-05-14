// PCD slice SP15 — placeholder script-text detection contract.
//
// MERGE-BACK: Production render paths MUST guard with this predicate.
// Any rendered ad emitting text where this returns true is a content-
// review bug. SP15 publishes the predicate; render-time throw is
// SP21+'s responsibility.
//
// Single-source literal: PLACEHOLDER_SCRIPT_PREFIX appears in exactly
// this one non-test source file. Seed and consumers import the symbol.
export const PLACEHOLDER_SCRIPT_PREFIX = "[SCRIPT_PENDING_CREATIVE_REVIEW:";

export function isPlaceholderScriptText(text: string): boolean {
  return text.startsWith(PLACEHOLDER_SCRIPT_PREFIX);
}
