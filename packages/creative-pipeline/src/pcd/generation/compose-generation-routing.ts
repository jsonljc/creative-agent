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
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { ApprovedCampaignContext, ProviderRouterStores, PcdRoutingDecision } from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import type { StampPcdProvenanceInput } from "../provenance/stamp-pcd-provenance.js";
import type { WritePcdIdentitySnapshotWithCostForecastStores } from "../cost/write-pcd-identity-snapshot-with-cost-forecast.js";
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
    shotSpecVersion: string | null;
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

  // Step 2-5 — implemented in Tasks 5-9.
  throw new Error("composeGenerationRouting: body not yet implemented past Step 1");

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void stores;
}

