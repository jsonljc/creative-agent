// PCD slice SP13 — selector version constant (17th PCD pinned constant).
// Single-source pin: this literal must appear in exactly ONE non-test
// source file (this one). Every consumer imports PCD_SELECTOR_VERSION;
// none repeats the literal. The SP13 anti-pattern test enforces both.
export const PCD_SELECTOR_VERSION = "pcd-selector@1.0.0";
