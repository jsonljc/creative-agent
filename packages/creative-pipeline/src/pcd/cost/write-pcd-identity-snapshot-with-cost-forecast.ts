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
  stampPcdCostForecast,
  type StampPcdCostForecastInput,
  type StampPcdCostForecastStores,
} from "./stamp-pcd-cost-forecast.js";
import type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";

/**
 * SP10A — Production callsite that bridges SP9's lineage stamp with the
 * SP10A cost-forecast stamp. Composes SP9's pure stamper (which itself does
 * the consent re-check), composes SP10A's pure stamper, runs the SP4 invariant
 * path (3-way lock-step with SP4 + SP9), then persists a 27-field row.
 *
 * The SP4 writer body and the SP9 orchestrator body are preserved verbatim.
 * SP10A is the NEW callsite; merge-back-time production runner is required
 * to call this one when cost observability is desired (and at merge-back, all
 * production callsites should call this one).
 *
 * MERGE-BACK: pick fanoutDecisionId convention (Inngest event id vs synth hash).
 * MERGE-BACK: cost estimator injection — Switchboard ad-optimizer team owns
 *             the production CostEstimator implementer.
 */

export type WritePcdIdentitySnapshotWithCostForecastInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  costForecast: StampPcdCostForecastInput;
};

export type WritePcdIdentitySnapshotWithCostForecastStores = {
  pcdSp10IdentitySnapshotStore: PcdSp10IdentitySnapshotStore;
} & StampPcdProvenanceStores &
  StampPcdCostForecastStores;

export async function writePcdIdentitySnapshotWithCostForecast(
  input: WritePcdIdentitySnapshotWithCostForecastInput,
  stores: WritePcdIdentitySnapshotWithCostForecastStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance via SP9 pure compose. SP9 stamper does:
  //   (a) lineage walk (script→hook→motivator→trend→brief)
  //   (b) consent re-check via SP6 assertConsentNotRevokedForGeneration
  //   (c) payload assembly with PCD_PREPRODUCTION_CHAIN_VERSION + PCD_PROVENANCE_VERSION
  // Throws ConsentRevokedRefusalError / InvariantViolationError / ZodError.
  // All propagated raw; cost estimator NOT called on failure.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — Stamp cost forecast via SP10A pure compose. Calls injected
  // CostEstimator; pins PCD_COST_FORECAST_VERSION; defense-in-depth zod-parses
  // input + output. Estimator NOT called if Step 1 threw.
  // Throws ZodError or estimator errors. All propagated raw.
  const costForecastReason = await stampPcdCostForecast(input.costForecast, {
    costEstimator: stores.costEstimator,
    clock: stores.clock,
  });

  // Step 3 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError.
  // Store is never called if this throws. Six-argument call shape
  // structurally identical to SP4 writer + SP9 orchestrator
  // (sp10a-anti-patterns.test.ts enforces).
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 4 — Defense-in-depth Zod parse on the SP4 input subset. Mirrors
  // SP4 writer + SP9 orchestrator allowlist forwarding. Throws ZodError.
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
  // Same four imports as SP4 + SP9. PCD_COST_FORECAST_VERSION is NOT imported here —
  // it lives inside the SP10A stamper and is carried via costForecastReason.
  // (Composer-only version pinning lock — sp10a-anti-patterns.test.ts enforces.)
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
    // SP10A cost forecast
    costForecastReason,
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 6 — Persist via SP10A store. SP4 store path NOT called.
  return stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast(payload);
}
