// SP22 — Helper for the synthetic-pairing write path's snapshot-input
// synthesis (§11.3 resolution).
//
// Step 5a recomputes the SP4 tier-3 "required" set using the same
// predicates the SP18 writer's invariant uses, so the forensic-consistency
// check passes by construction. Step 5b synthesizes SP4-shaped
// selectedCapability (consumed by invariant, NOT persisted) +
// routingDecisionReason (shim — authoritative SP16 record lives in
// syntheticRoutingDecisionReason column).
//
// Private to the SP22 composer; not surfaced via the generation/ barrel.

import type {
  PcdRoutingDecisionReason,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import type { PcdProviderCapability } from "../provider-capability-matrix.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import {
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type Tier3Rule,
} from "../tier3-routing-rules.js";
import type {
  ComposeGenerationRoutingInput,
  ComposeGenerationRoutingStores,
} from "./compose-generation-routing.js";

export async function buildSyntheticPairingSnapshotInput(
  routingDecision: SyntheticPcdRoutingDecision & {
    allowed: true;
    kind: "synthetic_pairing";
  },
  input: ComposeGenerationRoutingInput,
  stores: ComposeGenerationRoutingStores,
): Promise<WritePcdIdentitySnapshotInput> {
  // Step 5a — Recompute the SP4 tier-3 "required" set using the same
  // predicates the SP18 writer's invariant uses, so the forensic-consistency
  // check passes by construction (§11.3 resolution).
  let editOverRegenerateRequired = false;
  if (
    input.routing.resolvedContext.effectiveTier === 3 &&
    input.routing.approvedCampaignContext.kind === "campaign"
  ) {
    editOverRegenerateRequired = await requiresEditOverRegenerate(
      {
        effectiveTier: 3,
        organizationId: input.routing.approvedCampaignContext.organizationId,
        campaignId: input.routing.approvedCampaignContext.campaignId,
      },
      { campaignTakeStore: stores.campaignTakeStore },
    );
  }
  const tier3RulesApplied: Tier3Rule[] = [];
  if (
    requiresFirstLastFrameAnchor({
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
    })
  ) {
    tier3RulesApplied.push("first_last_frame_anchor");
  }
  if (
    requiresPerformanceTransfer({
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
    })
  ) {
    tier3RulesApplied.push("performance_transfer");
  }
  if (editOverRegenerateRequired) {
    tier3RulesApplied.push("edit_over_regenerate");
  }

  // Step 5b — Build synthesized SP4-shaped values (per §11.3).
  const selectedProvider = `${routingDecision.imageProvider}+${routingDecision.videoProvider}`;
  const selectedCapability: PcdProviderCapability = {
    // SYNTHESIZED — not persisted by SP18 writer (verified §11.3). All
    // support flags TRUE because synthetic pairings supersede capability
    // filtering by SP16 design (line 22-24 of route-synthetic-pcd-shot.ts).
    provider: selectedProvider,
    tiers: [input.routing.resolvedContext.effectiveTier],
    shotTypes: [input.routing.shotType],
    outputIntents: [input.routing.outputIntent],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: true,
  };
  const routingDecisionReason: PcdRoutingDecisionReason = {
    // SYNTHESIZED shim (§11.4). capabilityRefIndex carries pairingRefIndex —
    // a re-labeling acknowledged as a shim; authoritative SP16 record lives
    // in the syntheticRoutingDecisionReason column written by SP18's own
    // stamper. tier3RulesApplied IS honest (recomputed in Step 5a).
    capabilityRefIndex: routingDecision.pairingRefIndex,
    matchedShotType: input.routing.shotType,
    matchedEffectiveTier: input.routing.resolvedContext.effectiveTier,
    matchedOutputIntent: input.routing.outputIntent,
    tier3RulesApplied,
    candidatesEvaluated: 1,
    candidatesAfterTier3Filter: 1,
    selectionRationale: routingDecision.decisionReason.selectionRationale,
  };
  return {
    ...input.snapshotPersistence,
    effectiveTier: input.routing.resolvedContext.effectiveTier,
    shotType: input.routing.shotType,
    outputIntent: input.routing.outputIntent,
    selectedCapability,
    selectedProvider,
    routerVersion: routingDecision.syntheticRouterVersion,
    routingDecisionReason,
    editOverRegenerateRequired,
  };
}
