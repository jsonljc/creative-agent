// PCD — Product/Creator Definition primitives
// SP1: registry-backfill (Inngest function)
// SP2: tier-policy (pure deterministic gate)
// SP3: registry-resolver (per-job identity context resolver) + shot-spec-version constant
export * from "./pcd/registry-backfill.js";
export { decidePcdGenerationAccess, PCD_TIER_POLICY_VERSION } from "./pcd/tier-policy.js";
export type { DecidePcdGenerationAccessInput } from "./pcd/tier-policy.js";
export {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
  type ResolvedPcdContext,
} from "./pcd/registry-resolver.js";
export { PCD_SHOT_SPEC_VERSION } from "./pcd/shot-spec-version.js";
