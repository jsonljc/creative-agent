// PCD slice SP16 — Synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling pairing).
//
// Composition (one inline `Step N` comment per body step, filled in
// across Tasks 6–8):
//   1. Look up pairing matrix row by (shotType, outputIntent).
//   2. If no row matches → delegate to SP4's routePcdShot and wrap.
//   3. Tier policy gate (SP2's decidePcdGenerationAccess) — denial path.
//   4. Build synthetic pairing decision (locked artifacts read verbatim
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
  OutputIntent,
  PcdShotType,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { routePcdShot } from "../provider-router.js";
import type { ApprovedCampaignContext, ProviderRouterStores } from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision> {
  // Skeleton — Tasks 6/7/8 fill in the body. Always delegate for now.
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
