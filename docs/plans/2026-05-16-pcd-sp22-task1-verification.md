# SP22 Task 1 — §11.3 Resolution Verification

**Date:** 2026-05-16
**Scope:** Verify that the three properties assumed by §11.3 of the SP22 design hold
against the current SP18 + tier3-routing-rules surface, before any composer code is written.

---

## 1. SP18 writer payload construction (lines 89–151 of `write-pcd-identity-snapshot-with-synthetic-routing.ts`)

`selectedCapability` is consumed by the invariant assertion at lines 77–84 (before the parse
block) and then **completely absent** from both allowlists below.

### First allowlist — `PcdSp4IdentitySnapshotInputSchema.parse({...})` (lines 89–108)

```typescript
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
  // ← selectedCapability: ABSENT
});
```

`PcdSp4IdentitySnapshotInputSchema` (defined in `packages/schemas/src/pcd-identity.ts` lines
232–259) also has no `selectedCapability` field — so even if a caller attempted to inject it,
the schema-level parse would strip it as an unrecognised key (Zod strips unknown keys by
default).

### Second allowlist — `payload` object (lines 115–151)

```typescript
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
  routingDecisionReason: parsed.routingDecisionReason,   // ← tier3RulesApplied lives here
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
  // ← selectedCapability: ABSENT
};
```

**`selectedCapability` does not appear in either allowlist.** It is used only at lines 77–84:

```typescript
assertTier3RoutingDecisionCompliant({
  effectiveTier: input.snapshot.effectiveTier,
  shotType: input.snapshot.shotType,
  outputIntent: input.snapshot.outputIntent,
  selectedCapability: input.snapshot.selectedCapability,   // ← consumed here only
  tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
  editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
});
```

---

## 2. `assertTier3RoutingDecisionCompliant` (lines 98–156 of `tier3-routing-rules.ts`)

```typescript
export function assertTier3RoutingDecisionCompliant(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  tier3RulesApplied: ReadonlyArray<Tier3Rule>;
  editOverRegenerateRequired: boolean;
}): void {
  if (input.effectiveTier !== 3) return;   // line 106: short-circuit on non-Tier-3

  // Step A — recompute required-rule set
  const required: Tier3Rule[] = [];
  if (
    requiresFirstLastFrameAnchor({           // line 113
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
    })
  ) {
    required.push("first_last_frame_anchor");
  }
  if (
    requiresPerformanceTransfer({            // line 121
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
    })
  ) {
    required.push("performance_transfer");
  }
  if (input.editOverRegenerateRequired) {   // line 129: boolean flag (pre-computed by caller)
    required.push("edit_over_regenerate");
  }

  // Step B — capability flag check
  for (const rule of required) {
    if (rule === "first_last_frame_anchor" && !input.selectedCapability.supportsFirstLastFrame) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (rule === "performance_transfer" && !input.selectedCapability.supportsPerformanceTransfer) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (rule === "edit_over_regenerate" && !input.selectedCapability.supportsEditExtend) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
  }

  // Step C — forensic consistency
  const reqSet = new Set<Tier3Rule>(required);
  const actSet = new Set<Tier3Rule>(input.tier3RulesApplied);
  if (reqSet.size !== actSet.size || ![...reqSet].every((r) => actSet.has(r))) {
    throw new Tier3RoutingMetadataMismatchError(required, input.tier3RulesApplied);
  }
}
```

---

## 3. Confirmation table

| Property | Expected (§11.3) | Observed | Match? |
|---|---|---|---|
| `selectedCapability` persisted? | NO | NO — absent from `PcdSp4IdentitySnapshotInputSchema` (schema-level) AND from the `payload` object; consumed only by the pre-persist invariant call at lines 77–84 | ✅ |
| `tier3RulesApplied` persisted via `routingDecisionReason`? | YES | YES — `payload.routingDecisionReason = parsed.routingDecisionReason`; `PcdRoutingDecisionReasonSchema` (pcd-identity.ts:185–196) includes `tier3RulesApplied` as a required field; SP22's recomputed value supplied inside `routingDecisionReason` will be persisted verbatim | ✅ |
| Invariant predicates match SP22's recompute plan? | `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`, `editOverRegenerateRequired` boolean | Same three paths in `assertTier3RoutingDecisionCompliant` lines 112–131 — two pure-function calls + one explicit boolean flag | ✅ |

---

## 4. Additional flag for future readers

**`requiresEditOverRegenerate` is async and requires a store.** The third predicate exported
from `tier3-routing-rules.ts` (`requiresEditOverRegenerate`, lines 83–96) is an `async`
function that takes an `organizationId`, `campaignId`, and a `CampaignTakeStore`. It is
**not** called inside `assertTier3RoutingDecisionCompliant`. Instead, the invariant consumes
the pre-computed result as an `editOverRegenerateRequired: boolean` parameter (line 104 /
line 129).

Implication for SP22: the generation composer must call `requiresEditOverRegenerate(...)` with
a real `CampaignTakeStore` and pass the boolean result into both (a) the SP22-assembled
`tier3RulesApplied` array (for `routingDecisionReason`) and (b) the
`assertTier3RoutingDecisionCompliant` call. The composer will need `CampaignTakeStore` as a
port in its `stores` parameter — this is a dependency not explicitly called out in §11.3 but
structurally required to produce a correct `editOverRegenerateRequired` value.

This does not block Task 3 (the composer skeleton does not yet wire the store), but the
SP22 ports interface (Task 2) should account for `CampaignTakeStore`.

---

## 5. Sign-off

§11.3 resolution verified against current SP18 + tier3-routing-rules surface; no deviations.
Task 3 may proceed.
