// PCD slice SP16/SP17 — 20th pinned PCD constant.
// Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION
// (which versions the pairing data, not the routing logic).
//
// SP17 bumped this from 1.0.0 → 1.1.0 because the router body now branches
// on videoProviderChoice (new required input) and adds the direction-authored
// check (Step 4) emitting NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment (a future slice will
// persist it onto the identity-snapshot row).
export const PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.1.0";
