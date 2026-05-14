// PCD slice SP14 — placeholder disclosure-text detection contract.
//
// MERGE-BACK: Production render paths MUST guard with this predicate.
// Any rendered ad emitting text where this returns true is a compliance
// bug. SP14 publishes the predicate; render-time throw is SP21+'s
// responsibility (whichever slice owns the render path).
//
// Single-source literal: PLACEHOLDER_DISCLOSURE_PREFIX appears in exactly
// this one non-test source file across packages/. The seed and any future
// consumer import the symbol. Anti-pattern test enforces.
export const PLACEHOLDER_DISCLOSURE_PREFIX = "[DISCLOSURE_PENDING_LEGAL_REVIEW:";

export function isPlaceholderDisclosureText(text: string): boolean {
  return text.startsWith(PLACEHOLDER_DISCLOSURE_PREFIX);
}
