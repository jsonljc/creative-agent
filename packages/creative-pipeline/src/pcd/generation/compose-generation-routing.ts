// SP22 — Generation-routing composer. Second impure orchestrator in the
// PCD vertical (SP21 was the first).
//
// Routes per shot: synthetic-selection present → SP16; otherwise → SP4.
// Maps the routing decision to the matching writer:
//   SP4 allowed                                      → writePcdIdentitySnapshotWithCostForecast
//   SP16 delegated_to_generic_router + sp4 allowed   → writePcdIdentitySnapshotWithCostForecast
//   SP16 synthetic_pairing allowed                   → writePcdIdentitySnapshotWithSyntheticRouting
//   any denial                                       → no write
//
// LAYERING GUARDRAIL — this file MUST NOT import from @creativeagent/db.
// Concrete Prisma stores live in @creativeagent/db and are wired in by the
// runner/app layer (// MERGE-BACK).
//
// CLOCK DISCIPLINE — composer MUST NOT call zero-arg new Date(). All "now"
// flows through input.now + stores.clock. SP22 anti-pattern #3 enforces.
//
// INVARIANT — delegation-to-SP4 is NEVER a synthetic-provenance write. SP22
// anti-pattern + unit-test enforces.
//
// COST-FORECAST ASYMMETRY — generic-path writes persist costForecastReason;
// synthetic-pairing writes do not (no SP18+SP10A combined writer exists).
// SP22.1 reserved.
//
// MERGE-BACK markers:
//   1. Inngest step wrapping at the call site (Switchboard runner owns).
//   2. WorkTrace emission at composer entry / writer-call / composer exit.
//   3. Operator-facing per-shot routing-decision dashboards.
//   4. Real provider invocation downstream of SP22 (runner owns).
//   5. Runner-side per-brief caching of the loaded synthetic identity payload.
//   6. SP22.1 — SP18+SP10A combined writer closes the cost-forecast asymmetry.
//   7. SP10C cost-budget remains chain-level upstream of SP22 (directional only).
//   8. Step 1 consistency assert may migrate to runner-side at merge-back.

import type {
  CreatorIdentitySyntheticPayload,
  IdentityTier,
  OutputIntent,
  PcdIdentitySnapshot,
  PcdShotType,
  PcdRoutingDecisionReason,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { routePcdShot } from "../provider-router.js";
import type { ApprovedCampaignContext, ProviderRouterStores, PcdRoutingDecision } from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import type { StampPcdProvenanceInput } from "../provenance/stamp-pcd-provenance.js";
import { writePcdIdentitySnapshotWithCostForecast } from "../cost/write-pcd-identity-snapshot-with-cost-forecast.js";
import type { WritePcdIdentitySnapshotWithCostForecastStores } from "../cost/write-pcd-identity-snapshot-with-cost-forecast.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import type { PcdProviderCapability } from "../provider-capability-matrix.js";
import { routeSyntheticPcdShot } from "../synthetic-router/route-synthetic-pcd-shot.js";
import {
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type Tier3Rule,
} from "../tier3-routing-rules.js";
import { writePcdIdentitySnapshotWithSyntheticRouting } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";
import type { WritePcdIdentitySnapshotWithSyntheticRoutingStores } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";

export type SyntheticSelectionContext = {
  // MUST equal input.routing.resolvedContext.creatorIdentityId. Step 1 of the
  // composer body asserts this; mismatch throws InvariantViolationError.
  creatorIdentityId: string;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  videoProviderChoice: "kling" | "seedance";
};

export type ComposeGenerationRoutingInput = {
  routing: {
    resolvedContext: ResolvedPcdContext;
    shotType: PcdShotType;
    outputIntent: OutputIntent;
    approvedCampaignContext: ApprovedCampaignContext;
    syntheticSelection?: SyntheticSelectionContext;
  };
  snapshotPersistence: {
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
    providerModelSnapshot: string;
    seedOrNoSeed: string;
    rewrittenPromptText: string | null;
    shotSpecVersion: string;
  };
  provenance: StampPcdProvenanceInput;
  costHints?: { durationSec?: number; tokenCount?: number };
  now: Date;
};

export type ComposeGenerationRoutingStores = ProviderRouterStores &
  WritePcdIdentitySnapshotWithCostForecastStores &
  WritePcdIdentitySnapshotWithSyntheticRoutingStores;

export type ComposeGenerationRoutingResult =
  | {
      outcome: "routed_and_written";
      writerKind:
        | "writePcdIdentitySnapshotWithCostForecast"
        | "writePcdIdentitySnapshotWithSyntheticRouting";
      decision:
        | (PcdRoutingDecision & { allowed: true })
        | (SyntheticPcdRoutingDecision & { allowed: true; kind: "synthetic_pairing" })
        | (SyntheticPcdRoutingDecision & {
            kind: "delegated_to_generic_router";
            sp4Decision: PcdRoutingDecision & { allowed: true };
          });
      snapshot: PcdIdentitySnapshot;
    }
  | {
      outcome: "denied";
      // Verbatim — any denial branch of either router union, including a
      // delegation envelope wrapping a denied sp4Decision.
      decision: PcdRoutingDecision | SyntheticPcdRoutingDecision;
    };

export async function composeGenerationRouting(
  input: ComposeGenerationRoutingInput,
  stores: ComposeGenerationRoutingStores,
): Promise<ComposeGenerationRoutingResult> {
  // Step 1 — Optional consistency assert.
  if (input.routing.syntheticSelection !== undefined) {
    if (
      input.routing.syntheticSelection.creatorIdentityId !==
      input.routing.resolvedContext.creatorIdentityId
    ) {
      throw new InvariantViolationError(
        "synthetic selection creatorIdentityId mismatch with resolvedContext",
        {
          syntheticSelectionId: input.routing.syntheticSelection.creatorIdentityId,
          resolvedContextId: input.routing.resolvedContext.creatorIdentityId,
        },
      );
    }
  }

  // Step 2 — Route. Branch only on syntheticSelection presence.
  let routingDecision: PcdRoutingDecision | SyntheticPcdRoutingDecision;
  if (input.routing.syntheticSelection !== undefined) {
    routingDecision = await routeSyntheticPcdShot(
      {
        resolvedContext: input.routing.resolvedContext,
        syntheticIdentity: input.routing.syntheticSelection.syntheticIdentity,
        shotType: input.routing.shotType,
        outputIntent: input.routing.outputIntent,
        videoProviderChoice: input.routing.syntheticSelection.videoProviderChoice,
        approvedCampaignContext: input.routing.approvedCampaignContext,
      },
      { campaignTakeStore: stores.campaignTakeStore },
    );
  } else {
    routingDecision = await routePcdShot(
      {
        resolvedContext: input.routing.resolvedContext,
        shotType: input.routing.shotType,
        outputIntent: input.routing.outputIntent,
        approvedCampaignContext: input.routing.approvedCampaignContext,
      },
      { campaignTakeStore: stores.campaignTakeStore },
    );
  }

  // Step 3 — Map decision shape to write path.
  // Case A: SP4 allowed.
  if (
    !("kind" in routingDecision) &&
    routingDecision.allowed === true
  ) {
    // Step 4 — Generic write path.
    const sp4Decision = routingDecision;
    const snapshotInput: WritePcdIdentitySnapshotInput = {
      ...input.snapshotPersistence,
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      selectedCapability: sp4Decision.selectedCapability,
      selectedProvider: sp4Decision.selectedProvider,
      routerVersion: sp4Decision.routerVersion,
      routingDecisionReason: sp4Decision.decisionReason,
      editOverRegenerateRequired:
        sp4Decision.decisionReason.tier3RulesApplied.includes("edit_over_regenerate"),
    };
    const costForecast = {
      provider: sp4Decision.selectedProvider,
      model: input.snapshotPersistence.providerModelSnapshot,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      durationSec: input.costHints?.durationSec,
      tokenCount: input.costHints?.tokenCount,
    };
    const snapshot = await writePcdIdentitySnapshotWithCostForecast(
      { snapshot: snapshotInput, provenance: input.provenance, costForecast },
      {
        pcdSp10IdentitySnapshotStore: stores.pcdSp10IdentitySnapshotStore,
        costEstimator: stores.costEstimator,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithCostForecast",
      decision: routingDecision,
      snapshot,
    };
  }

  // Case C: SP16 synthetic-pairing allowed.
  if (
    "kind" in routingDecision &&
    routingDecision.kind === "synthetic_pairing" &&
    routingDecision.allowed === true
  ) {
    const snapshotInput = await buildSyntheticPairingSnapshotInput(
      routingDecision,
      input,
      stores,
    );
    const snapshot = await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: snapshotInput,
        provenance: input.provenance,
        syntheticRouting: { syntheticDecision: routingDecision },
      },
      {
        pcdSp18IdentitySnapshotStore: stores.pcdSp18IdentitySnapshotStore,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithSyntheticRouting",
      decision: routingDecision,
      snapshot,
    };
  }

  // Cases B + denials — implemented in Tasks 8, 9, 10.
  throw new Error("decision-shape mapping not yet implemented for this branch");
}

// Step 5a + 5b for the synthetic-pairing happy path. Extracted from the Case C
// inline block to keep composeGenerationRouting under the file-size cap. Logic
// is unchanged from the inline version: tier-3 recompute mirrors SP18 writer
// invariant (§11.3 resolution), then synthesizes SP4-shaped fields (§11.3/§11.4).
async function buildSyntheticPairingSnapshotInput(
  routingDecision: SyntheticPcdRoutingDecision & { allowed: true; kind: "synthetic_pairing" },
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

