// PCD — Product/Creator Definition primitives
// SP1: registry-backfill (Inngest function)
// SP2: tier-policy (pure deterministic gate)
export * from "./pcd/registry-backfill.js";
export { decidePcdGenerationAccess, PCD_TIER_POLICY_VERSION } from "./pcd/tier-policy.js";
export type { DecidePcdGenerationAccessInput } from "./pcd/tier-policy.js";
