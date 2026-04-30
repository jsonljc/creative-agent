import {
  type PcdIdentitySnapshot,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "../tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "../provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "../provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "../tier3-routing-rules.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import {
  stampPcdProvenance,
  type StampPcdProvenanceInput,
  type StampPcdProvenanceStores,
} from "./stamp-pcd-provenance.js";
import type { PcdSp9IdentitySnapshotStore } from "./pcd-sp9-identity-snapshot-store.js";

/**
 * SP9 — Production callsite that bridges SP7/SP8's pre-production tree to
 * SP4's per-asset PcdIdentitySnapshot. Stamps lineage, runs the SP4 invariant
 * assertion + Zod parse + version-pin path (duplicated from SP4 writer body
 * because we need to persist a 25-field row, not a 19-field row), then calls
 * the SP9 store.
 *
 * The SP4 writer body (writePcdIdentitySnapshot) is preserved verbatim and
 * continues to serve legacy callsites that write null lineage. SP9 is the
 * NEW callsite; merge-back-time production runner is required to call this
 * one when generating assets from a fanout-selected script.
 *
 * MERGE-BACK: pick fanoutDecisionId convention (Inngest event id vs. synth hash).
 */

export type WritePcdIdentitySnapshotWithProvenanceInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
};

export type WritePcdIdentitySnapshotWithProvenanceStores = {
  pcdSp9IdentitySnapshotStore: PcdSp9IdentitySnapshotStore;
} & StampPcdProvenanceStores;

export async function writePcdIdentitySnapshotWithProvenance(
  input: WritePcdIdentitySnapshotWithProvenanceInput,
  stores: WritePcdIdentitySnapshotWithProvenanceStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance. May throw ConsentRevokedRefusalError /
  // InvariantViolationError / ZodError. All propagated raw.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError.
  // Store is never called if this throws.
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 3 — Defense-in-depth Zod parse on the SP4 input subset (allowlist
  // forwarding mirrors SP4 writer body). Throws ZodError on bad input.
  const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
    assetRecordId: input.snapshot.assetRecordId,
    productIdentityId: input.snapshot.productIdentityId,
    productTierAtGeneration: input.snapshot.productTierAtGeneration,
    productImageAssetIds: input.snapshot.productImageAssetIds,
    productCanonicalTextHash: input.snapshot.productCanonicalTextHash,
    productLogoAssetId: input.snapshot.productLogoAssetId,
    creatorIdentityId: input.snapshot.creatorIdentityId,
    avatarTierAtGeneration: input.snapshot.avatarTierAtGeneration,
    avatarReferenceAssetIds: input.snapshot.avatarReferenceAssetIds,
    voiceAssetId: input.snapshot.voiceAssetId,
    consentRecordId: input.snapshot.consentRecordId,
    selectedProvider: input.snapshot.selectedProvider,
    providerModelSnapshot: input.snapshot.providerModelSnapshot,
    seedOrNoSeed: input.snapshot.seedOrNoSeed,
    rewrittenPromptText: input.snapshot.rewrittenPromptText,
    shotSpecVersion: input.snapshot.shotSpecVersion,
    routerVersion: input.snapshot.routerVersion,
    routingDecisionReason: input.snapshot.routingDecisionReason,
  });

  // Step 4 — Pin version constants from imports + carry shotSpecVersion
  // (SP3 stamp). Same four imports + same allowlist payload shape as the SP4
  // writer's version-pinning step. Step ordering differs intentionally — SP9
  // runs the Tier 3 assert before the Zod parse so the cheaper invariant
  // check fails fast on the common path. The anti-pattern test enforces
  // structural equivalence (same constants imported + same six-arg
  // assertTier3RoutingDecisionCompliant call), not source-line ordering.
  const payload = {
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
    // SP9 lineage
    briefId: provenance.briefId,
    trendId: provenance.trendId,
    motivatorId: provenance.motivatorId,
    hookId: provenance.hookId,
    scriptId: provenance.scriptId,
    lineageDecisionReason: provenance.lineageDecisionReason,
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 5 — Persist via SP9 store. SP4 store path is NOT called.
  return stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance(payload);
}
