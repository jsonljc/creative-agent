// SP22 — Generation-routing composer. Second impure orchestrator in the
// PCD vertical (SP21 was the first).
//
// Routes per shot: synthetic-selection present → SP16; otherwise → SP4.
// Maps the routing decision to the matching writer:
//   SP4 allowed                                      → writeGenericRoute (SP10A writer, once)
//   SP16 delegated_to_generic_router + sp4 allowed   → writeGenericRoute (SP10A writer, once)
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
import { routeSyntheticPcdShot } from "../synthetic-router/route-synthetic-pcd-shot.js";
import { writePcdIdentitySnapshotWithSyntheticRouting } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";
import type { WritePcdIdentitySnapshotWithSyntheticRoutingStores } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";
import { buildSyntheticPairingSnapshotInput } from "./synthesize-synthetic-pairing-snapshot.js";

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

/**
 * Generic-route persistence path shared between Case A (pure SP4 success)
 * and Case B (SP16 delegation with allowed sp4Decision). Builds the
 * SP4-shaped WritePcdIdentitySnapshotInput + post-routing cost-forecast
 * input, then invokes the SP10A writer exactly once.
 *
 * Centralized so design §7 #5 (writer import + call each appear once) holds.
 */
async function writeGenericRoute(
  sp4Decision: PcdRoutingDecision & { allowed: true },
  input: ComposeGenerationRoutingInput,
  stores: ComposeGenerationRoutingStores,
): Promise<PcdIdentitySnapshot> {
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
  return writePcdIdentitySnapshotWithCostForecast(
    { snapshot: snapshotInput, provenance: input.provenance, costForecast },
    {
      pcdSp10IdentitySnapshotStore: stores.pcdSp10IdentitySnapshotStore,
      costEstimator: stores.costEstimator,
      creatorIdentityReader: stores.creatorIdentityReader,
      consentRecordReader: stores.consentRecordReader,
      clock: stores.clock,
    },
  );
}

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

  // Step 3 — Map routing decision shape to write path. Case ordering:
  // A (generic SP4 allowed) → C (SP16 synthetic-pairing allowed) →
  // B (SP16 delegation with allowed sp4Decision) → any denial fallthrough.

  // Case A: SP4 allowed (generic route).
  if (
    !("kind" in routingDecision) &&
    routingDecision.allowed === true
  ) {
    const snapshot = await writeGenericRoute(routingDecision, input, stores);
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

  // Case B: SP16 delegated_to_generic_router with allowed sp4Decision.
  // INVARIANT: delegation is NEVER a synthetic-provenance write — the
  // wrapped sp4Decision IS a generic-route decision, routed via the shared
  // writeGenericRoute helper (SP10A writer, same as Case A).
  if (
    "kind" in routingDecision &&
    routingDecision.kind === "delegated_to_generic_router" &&
    routingDecision.sp4Decision.allowed === true
  ) {
    // TS cannot propagate sp4Decision.allowed === true back to the outer
    // routingDecision union; narrow via const-and-cast so the return type
    // satisfies ComposeGenerationRoutingResult.
    const narrowedDecision = routingDecision as SyntheticPcdRoutingDecision & {
      kind: "delegated_to_generic_router";
      sp4Decision: PcdRoutingDecision & { allowed: true };
    };
    const snapshot = await writeGenericRoute(narrowedDecision.sp4Decision, input, stores);
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithCostForecast",
      decision: narrowedDecision,
      snapshot,
    };
  }

  // Any denial — verbatim pass-through. Covers SP4 ACCESS_POLICY,
  // SP4 NO_PROVIDER_CAPABILITY, SP16 ACCESS_POLICY,
  // SP16 NO_DIRECTION_AUTHORED, and delegation envelopes wrapping a
  // denied sp4Decision.
  return { outcome: "denied", decision: routingDecision };
}


