// SP8 — pinned version constant for the production fanout decision shape.
// 11th pinned constant in the PCD slice. Caller cannot override; pinned by
// the composer from import. Bumped independently of PCD_PREPRODUCTION_CHAIN_VERSION
// so SP10's tree-budget enforcement can land without re-versioning the chain.
export const PCD_PREPRODUCTION_FANOUT_VERSION = "preproduction-fanout@1.0.0";
