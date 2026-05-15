// PCD slice SP16 — Synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling pairing).
//
// Composition (one inline `Step N` comment per body step):
//   1. Look up pairing matrix row by (shotType, outputIntent).
//   2. If no row matches → delegate to SP4's routePcdShot and wrap.
//   3. Tier policy gate (SP2's decidePcdGenerationAccess) — denial path. [Task 7]
//   4. Build synthetic pairing decision (locked artifacts read verbatim
//      from input.syntheticIdentity). [Task 8]
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
import { PCD_SYNTHETIC_PROVIDER_PAIRING } from "./synthetic-provider-pairing.js";
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
  // Step 1 — Pairing matrix lookup. Find a row whose shotTypes contains
  // input.shotType AND outputIntents contains input.outputIntent.
  // First-match wins (v1 has only one row).
  const pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(
    (p) => p.shotTypes.includes(input.shotType) && p.outputIntents.includes(input.outputIntent),
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

  // Steps 3 + 4 land in Tasks 7 + 8. For now, still delegate so existing
  // tests keep passing while we incrementally fill in the synthetic path.
  // `pairing` and `pairingRefIndex` are used above in the lookup +
  // undefined-check; TypeScript's noUnusedLocals is satisfied. Task 7
  // will replace this fall-through with the tier-policy gate and Task 8
  // will replace it with the success-branch return.
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
