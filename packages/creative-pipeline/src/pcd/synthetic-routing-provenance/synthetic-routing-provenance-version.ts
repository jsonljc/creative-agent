// PCD slice SP18 — 22nd pinned PCD constant. Versions the SP18 forensic-record
// shape. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (router logic) and
// PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION (matrix data) — those values are
// persisted as forensic data (read off the decision), not pinned by SP18.
// Bumped independently when the SP18 forensic-record shape evolves.
//
// Guardrail C (two parts):
//   1. Sole literal site — the literal "pcd-synthetic-routing-provenance@"
//      appears in exactly ONE non-test source file: this one.
//   2. Sole runtime import site — among non-test runtime sources, this
//      constant is imported by exactly ONE file: stamp-pcd-synthetic-routing-
//      decision.ts. Tests are explicitly carved out and may import the
//      constant from this file for literal-pin assertions.
//
// MERGE-BACK: Switchboard merge does not change this literal. Bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION = "pcd-synthetic-routing-provenance@1.0.0";
