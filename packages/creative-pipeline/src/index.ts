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

// SP4: provider routing + identity snapshot writer
export {
  PCD_PROVIDER_CAPABILITY_VERSION,
  PCD_PROVIDER_CAPABILITY_MATRIX,
  type PcdProviderCapability,
} from "./pcd/provider-capability-matrix.js";

export {
  PCD_PROVIDER_ROUTER_VERSION,
  routePcdShot,
  type ApprovedCampaignContext,
  type PcdRoutingDecision,
  type ProviderRouterStores,
  type RoutePcdShotInput,
} from "./pcd/provider-router.js";

export {
  writePcdIdentitySnapshot,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotStoreInput,
  type PcdIdentitySnapshotWriterStores,
  type WritePcdIdentitySnapshotInput,
} from "./pcd/pcd-identity-snapshot-writer.js";

export {
  Tier3RoutingMetadataMismatchError,
  Tier3RoutingViolationError,
  assertTier3RoutingDecisionCompliant,
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type CampaignTakeStore,
  type Tier3Rule,
  type Tier3RoutingRuleStores,
} from "./pcd/tier3-routing-rules.js";
