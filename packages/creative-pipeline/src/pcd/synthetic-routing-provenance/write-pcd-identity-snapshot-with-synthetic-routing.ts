// SP18 — Production callsite that bridges SP9's lineage stamp with the SP18
// synthetic-routing-decision stamp. Composes SP9's pure stamper (which itself
// does the consent re-check), composes SP18's pure stamper, runs the SP4
// invariant path (4-way lock-step with SP4 + SP9 + SP10A), then persists.
//
// The SP4 writer body, SP9 orchestrator body, and SP10A orchestrator body are
// preserved verbatim. SP18 is the NEW callsite; merge-back-time production
// runner is required to call this one when persisting a synthetic-pairing
// success decision's provenance. Delegation cases continue via SP4/SP9/SP10A;
// denial cases produce no asset.
//
// MERGE-BACK: pick fanoutDecisionId convention (inherited from SP9/SP10A).
// MERGE-BACK: production runner discipline — all synthetic-pairing success
//             callsites should call this orchestrator at merge-back.

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
} from "../provenance/stamp-pcd-provenance.js";
import {
  stampPcdSyntheticRoutingDecision,
  type StampPcdSyntheticRoutingDecisionInput,
  type StampPcdSyntheticRoutingDecisionStores,
} from "./stamp-pcd-synthetic-routing-decision.js";
import type { PcdSp18IdentitySnapshotStore } from "./pcd-sp18-identity-snapshot-store.js";

export type WritePcdIdentitySnapshotWithSyntheticRoutingInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  syntheticRouting: StampPcdSyntheticRoutingDecisionInput;
};

export type WritePcdIdentitySnapshotWithSyntheticRoutingStores = {
  pcdSp18IdentitySnapshotStore: PcdSp18IdentitySnapshotStore;
} & StampPcdProvenanceStores &
  StampPcdSyntheticRoutingDecisionStores;

export async function writePcdIdentitySnapshotWithSyntheticRouting(
  input: WritePcdIdentitySnapshotWithSyntheticRoutingInput,
  stores: WritePcdIdentitySnapshotWithSyntheticRoutingStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance via SP9 pure compose. SP9 stamper does:
  //   (a) lineage walk (script→hook→motivator→trend→brief)
  //   (b) consent re-check via SP6 assertConsentNotRevokedForGeneration
  //   (c) payload assembly with PCD_PREPRODUCTION_CHAIN_VERSION + PCD_PROVENANCE_VERSION
  // Throws ConsentRevokedRefusalError / InvariantViolationError / ZodError.
  // All propagated raw; SP18 stamper NOT called on failure.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — Stamp synthetic-routing decision via SP18 pure compose. Defense-
  // in-depth Zod parse + success-branch refine + sha256(dallePromptLocked) +
  // version-pinned forensic record. Throws ZodError on bad input. All
  // propagated raw; Tier 3 invariant NOT run on failure.
  const syntheticRouting = await stampPcdSyntheticRoutingDecision(input.syntheticRouting, {
    clock: stores.clock,
  });

  // Step 3 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError. Store is
  // never called if this throws. Six-argument call shape structurally
  // identical to SP4 writer + SP9 orchestrator + SP10A orchestrator
  // (sp18-anti-patterns.test.ts enforces 4-way lock-step).
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 4 — Defense-in-depth Zod parse on the SP4 input subset. Mirrors SP4
  // writer + SP9 orchestrator + SP10A orchestrator allowlist forwarding.
  // Throws ZodError.
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

  // Step 5 — Pin version constants from imports + carry shotSpecVersion (SP3 stamp).
  // Same four imports as SP4 + SP9 + SP10A. PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION
  // is NOT imported here — it lives inside the SP18 stamper and is carried via
  // syntheticRouting.syntheticRoutingDecisionReason (composer-only version
  // pinning lock — Guardrail C).
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
    // SP18 synthetic-routing provenance
    imageProvider: syntheticRouting.imageProvider,
    videoProvider: syntheticRouting.videoProvider,
    videoProviderChoice: syntheticRouting.videoProviderChoice,
    syntheticRouterVersion: syntheticRouting.syntheticRouterVersion,
    syntheticPairingVersion: syntheticRouting.syntheticPairingVersion,
    promptHash: syntheticRouting.promptHash,
    syntheticRoutingDecisionReason: syntheticRouting.syntheticRoutingDecisionReason,
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 6 — Persist via SP18 store. SP4/SP9/SP10A store paths NOT called.
  return stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting(payload);
}
