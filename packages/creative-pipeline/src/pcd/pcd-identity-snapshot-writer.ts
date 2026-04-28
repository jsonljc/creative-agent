import {
  type IdentityTier,
  type OutputIntent,
  type PcdIdentitySnapshot,
  type PcdRoutingDecisionReason,
  type PcdShotType,
  type PcdSp4IdentitySnapshotInput,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "./tier-policy.js";
import {
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "./provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "./tier3-routing-rules.js";

// Note: this module deliberately does NOT import the current shot-spec
// version constant. shotSpecVersion is carried through from input
// (SP3-stamped on the job); re-importing the current value would
// forensically misrepresent the spec version the job was actually
// planned under. The forbidden-imports test enforces this absence.

export type PcdIdentitySnapshotStoreInput = {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: IdentityTier;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: IdentityTier;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  policyVersion: string;
  providerCapabilityVersion: string;
  selectedProvider: string;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  shotSpecVersion: string | null;
  routerVersion: string | null;
  routingDecisionReason: PcdRoutingDecisionReason | null;
};

export type PcdIdentitySnapshotStore = {
  createForShot(input: PcdIdentitySnapshotStoreInput): Promise<PcdIdentitySnapshot>;
};

export type PcdIdentitySnapshotWriterStores = {
  pcdIdentitySnapshotStore: PcdIdentitySnapshotStore;
};

export type WritePcdIdentitySnapshotInput = PcdSp4IdentitySnapshotInput & {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  editOverRegenerateRequired: boolean;
};

export async function writePcdIdentitySnapshot(
  input: WritePcdIdentitySnapshotInput,
  stores: PcdIdentitySnapshotWriterStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Validate input shape against PcdSp4IdentitySnapshotInputSchema.
  // Throws ZodError on bad input. Strips unknown keys (e.g. caller-supplied
  // policyVersion / providerCapabilityVersion).
  const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
    assetRecordId: input.assetRecordId,
    productIdentityId: input.productIdentityId,
    productTierAtGeneration: input.productTierAtGeneration,
    productImageAssetIds: input.productImageAssetIds,
    productCanonicalTextHash: input.productCanonicalTextHash,
    productLogoAssetId: input.productLogoAssetId,
    creatorIdentityId: input.creatorIdentityId,
    avatarTierAtGeneration: input.avatarTierAtGeneration,
    avatarReferenceAssetIds: input.avatarReferenceAssetIds,
    voiceAssetId: input.voiceAssetId,
    consentRecordId: input.consentRecordId,
    selectedProvider: input.selectedProvider,
    providerModelSnapshot: input.providerModelSnapshot,
    seedOrNoSeed: input.seedOrNoSeed,
    rewrittenPromptText: input.rewrittenPromptText,
    shotSpecVersion: input.shotSpecVersion,
    routerVersion: input.routerVersion,
    routingDecisionReason: input.routingDecisionReason,
  });

  // Step 2 — Tier 3 second line of defense. Recompute-based assertion;
  // throws Tier3RoutingViolationError or Tier3RoutingMetadataMismatchError
  // before persistence. createForShot is NEVER called if this throws.
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.effectiveTier,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
    selectedCapability: input.selectedCapability,
    tier3RulesApplied: input.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.editOverRegenerateRequired,
  });

  // Step 3 — Pin version constants from imports (NOT from input).
  // shotSpecVersion is carried forward from parsed input (SP3 stamp).
  const payload: PcdIdentitySnapshotStoreInput = {
    assetRecordId: parsed.assetRecordId,
    productIdentityId: parsed.productIdentityId,
    productTierAtGeneration: parsed.productTierAtGeneration,
    productImageAssetIds: parsed.productImageAssetIds,
    productCanonicalTextHash: parsed.productCanonicalTextHash,
    productLogoAssetId: parsed.productLogoAssetId,
    creatorIdentityId: parsed.creatorIdentityId,
    avatarTierAtGeneration: parsed.avatarTierAtGeneration,
    avatarReferenceAssetIds: parsed.avatarReferenceAssetIds,
    voiceAssetId: parsed.voiceAssetId,
    consentRecordId: parsed.consentRecordId,
    selectedProvider: parsed.selectedProvider,
    providerModelSnapshot: parsed.providerModelSnapshot,
    seedOrNoSeed: parsed.seedOrNoSeed,
    rewrittenPromptText: parsed.rewrittenPromptText,
    policyVersion: PCD_TIER_POLICY_VERSION,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    shotSpecVersion: parsed.shotSpecVersion,
    routingDecisionReason: parsed.routingDecisionReason,
  };

  // Step 4 — Persist.
  return stores.pcdIdentitySnapshotStore.createForShot(payload);
}
