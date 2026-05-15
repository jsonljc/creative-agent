// PCD slice SP16 — Synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling pairing).
//
// Composition (one inline `Step N` comment per body step):
//   0. Normalize undefined seedanceDirection → null (J1).
//   1. Look up pairing matrix row by 3-tuple (shotType, outputIntent,
//      videoProviderChoice). SP17 widened the key from a 2-tuple to a
//      3-tuple when the matrix grew to two rows partitioned by videoProvider.
//   2. If no row matches → delegate to SP4's routePcdShot and wrap.
//   3. Tier policy gate (SP2's decidePcdGenerationAccess) — denial path. [Task 7]
//   4. Direction-authored check (NEW, SP17) — NO_DIRECTION_AUTHORED denial
//      if the chosen-provider direction is null.
//   5. Build synthetic pairing decision (locked artifacts read verbatim
//      from input.syntheticIdentity).
//
// Algorithm is intentionally tier3-rule-free for the synthetic path: the
// locked pairing supersedes generic capability filtering by design
// (umbrella §4 line 92, line 238). For the delegation path, SP4's own
// tier3 logic fires inside the delegated call.
//
// MERGE-BACK: Caller (SP21 composer) supplies the synthetic identity
// payload via PrismaCreatorIdentitySyntheticReader.findByCreatorIdentityId
// (SP11 reader). SP16 itself never reads. SP21 is responsible for
// asserting `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`.
// Mirrors SP12 / SP13 / SP14 / SP15 snapshot pattern.

import type {
  CreatorIdentitySyntheticPayload,
  IdentityTier,
  OutputIntent,
  PcdShotType,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { routePcdShot } from "../provider-router.js";
import type { ApprovedCampaignContext, ProviderRouterStores } from "../provider-router.js";
import { decidePcdGenerationAccess } from "../tier-policy.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
} from "./synthetic-provider-pairing.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

export function buildSyntheticSelectionRationale(
  effectiveTier: IdentityTier,
  shotType: PcdShotType,
  outputIntent: OutputIntent,
): string {
  const out = `synthetic-pairing tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → dalle+kling`;
  return out.length > 200 ? out.slice(0, 200) : out;
}

export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  // SP17 — end-user selection of the video provider, supplied by the SP21
  // composer (or equivalent caller). Matrix gates legality; the chosen
  // provider must have an authored direction on the synthetic identity or
  // the router denies with NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER.
  videoProviderChoice: "kling" | "seedance";
  approvedCampaignContext: ApprovedCampaignContext;
};

export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision> {
  // Step 0 — Normalize undefined seedanceDirection to null per design J1.
  // Schema accepts nullish(); domain logic treats null as the single
  // missing-state.
  const seedanceDirection = input.syntheticIdentity.seedanceDirection ?? null;

  // Step 1 — Pairing matrix lookup keyed by 3-tuple
  // (shotType, outputIntent, videoProviderChoice). SP17: matrix grew to two
  // rows partitioned by videoProvider; first-match across all rows.
  const pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(
    (p) =>
      p.shotTypes.includes(input.shotType) &&
      p.outputIntents.includes(input.outputIntent) &&
      p.videoProvider === input.videoProviderChoice,
  );
  const pairing =
    pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined;

  // Step 2 — Out-of-pairing shot type → delegate to SP4.
  if (pairing === undefined) {
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: input.resolvedContext,
        shotType: input.shotType,
        outputIntent: input.outputIntent,
        approvedCampaignContext: input.approvedCampaignContext,
      },
      stores,
    );
    return {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: input.shotType,
      sp4Decision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 3 — Tier policy gate. SP4 also runs this for its own path; we run
  // it here independently because Step 4 short-circuits before any
  // routePcdShot call.
  const accessDecision = decidePcdGenerationAccess({
    avatarTier: input.resolvedContext.creatorTierAtResolution,
    productTier: input.resolvedContext.productTierAtResolution,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
  });
  if (!accessDecision.allowed) {
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 4 — Direction-authored check (NEW, SP17). The chosen provider must
  // have an authored direction on the synthetic identity. Distinct denial
  // kind — NEVER conflated with ACCESS_POLICY, NEVER silently degraded.
  // klingDirection is non-nullable on the SP11 payload schema; only the
  // seedance path can hit this denial in v1.1.0.
  const direction =
    input.videoProviderChoice === "kling"
      ? input.syntheticIdentity.klingDirection
      : seedanceDirection;
  if (direction === null) {
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: input.videoProviderChoice,
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 5 — Build synthetic pairing decision. Locked artifacts read
  // verbatim from input.syntheticIdentity. No transformation, no hashing
  // (SP17 owns dallePromptLocked → hash at persistence time).
  const matchedShotType = input.shotType;
  const matchedOutputIntent = input.outputIntent;
  return {
    allowed: true,
    kind: "synthetic_pairing",
    accessDecision,
    imageProvider: pairing.imageProvider,
    videoProvider: pairing.videoProvider,
    dallePromptLocked: input.syntheticIdentity.dallePromptLocked,
    klingDirection: input.syntheticIdentity.klingDirection,
    pairingRefIndex,
    pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    decisionReason: {
      matchedShotType,
      matchedOutputIntent,
      selectionRationale: buildSyntheticSelectionRationale(
        input.resolvedContext.effectiveTier,
        matchedShotType,
        matchedOutputIntent,
      ),
    },
  };
}
