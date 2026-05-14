// PCD slice SP14 — 18th pinned PCD constant.
// Resolver-logic version. Distinct from per-tuple registry row `version: int`.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
//
// Single-source pin: the literal "pcd-disclosure-resolver@" appears in
// exactly this one non-test source file across packages/. All consumers
// import PCD_DISCLOSURE_RESOLVER_VERSION as a symbol.
export const PCD_DISCLOSURE_RESOLVER_VERSION = "pcd-disclosure-resolver@1.0.0";
