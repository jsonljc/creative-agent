# SP22 — Generation Composer (design)

**Date:** 2026-05-16
**Predecessor:** SP21 (synthetic-creator selection composer, squash `ece1347`)
**Slice type:** Second impure orchestrator in the PCD vertical
**Output unit:** Async per-shot router-of-routers + writer-selection composer that
ties SP4/SP16 routing to `writePcdIdentitySnapshotWithCostForecast` (SP10A) /
`writePcdIdentitySnapshotWithSyntheticRouting` (SP18) persistence.

---

## 1. Purpose

SP22 is the per-shot **generation routing composer**. It receives the per-shot
inputs plus — for the synthetic path — the upstream SP21 synthetic-creator
selection result and the already-loaded synthetic identity payload, makes a
routing decision via SP4 or SP16, then persists the resulting snapshot via
`writePcdIdentitySnapshotWithCostForecast` (for generic / delegated-to-generic
paths) or `writePcdIdentitySnapshotWithSyntheticRouting` (for synthetic-pairing
success paths). It returns the routing decision alongside the written snapshot
(or just the decision, on denial).

SP22 is structurally the second impure orchestrator in the PCD vertical after
SP21. The shape it lands locks the composer-with-write-side-effect pattern for
future PCD composers — SP23+ (terminal-state writer composer), SP24+ (QC
composer).

### 1.1 Out of scope (hard locks)

- SP21 (synthetic-creator selection) invocation — happens upstream once per
  brief; SP22 does NOT re-select per shot.
- Synthetic identity payload fetch — happens upstream once per selected creator;
  SP22 does NOT introduce a payload-reader port.
- Real provider API call (DALL-E / Kling / Runway / Seedance) — happens
  downstream, runner owns. SP22 only routes and persists the routing snapshot.
- SP5 QC — post-generation, owned by SP24+.
- SP6 consent gates — consent re-check happens inside SP9 `stampPcdProvenance`,
  which the writers SP22 calls invoke. SP22 itself does NOT invoke consent gates
  directly.
- SP19 terminal-state writer (`PcdPerformanceSnapshot`) — post-generation, owned
  by SP23+.
- SP10C cost-budget — chain-level upstream of SP22. SP22 is downstream of
  SP10C, **not** nested inside. Directional note only; no test/code linkage.
- SP7 pre-production chain — already executed before SP22 fires.

### 1.2 Hard rules carried forward

- No edits to SP1–SP21 source bodies. SP22 is strictly additive.
- No new pinned constant. PCD constant tally stays at **24**.
- Additive-only Prisma changes; **no migration in SP22**.
- Three-layer rule preserved: `creative-pipeline` depends on `schemas` only; DB
  readers/writers are wired in at the runner/app layer.
- The composer file MUST NOT import `@creativeagent/db`. SP21 lock carried
  forward.
- No imports outside the PCD scope.

---

## 2. Composer surface

Free-standing async function. Matches every prior PCD orchestrator that takes a
`stores` argument (SP4, SP9, SP10A, SP10B, SP10C, SP16, SP18, SP21).

```ts
// packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts

export type SyntheticSelectionContext = {
  // Must equal input.routing.resolvedContext.creatorIdentityId.
  // Step 1 of the composer body asserts this — InvariantViolationError on mismatch.
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
  // Caller-supplied snapshot fields. The routing decision fills:
  //   selectedProvider, selectedCapability, effectiveTier, shotType, outputIntent,
  //   routerVersion, providerCapabilityVersion, routingDecisionReason,
  //   editOverRegenerateRequired.
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
  // SP9 lineage stamp input — required for every write (both generic and
  // synthetic paths persist lineage via SP9).
  provenance: StampPcdProvenanceInput;
  // Optional cost-estimator hints. Construction of the full
  // StampPcdCostForecastInput is done INSIDE SP22 post-routing because
  // `provider` (the routing decision's selectedProvider) is not known
  // pre-routing.
  costHints?: { durationSec?: number; tokenCount?: number };
  now: Date;
};

export type ComposeGenerationRoutingStores =
  ProviderRouterStores &
  WritePcdIdentitySnapshotWithCostForecastStores &
  WritePcdIdentitySnapshotWithSyntheticRoutingStores;

// Result type. Discriminated union; "outcome" tag preserves the
// "snapshot present iff a write happened" invariant at the type level.
// writerKind values are the literal exported function names so there is zero
// translation step between SP22's result and the runner's understanding of
// which writer ran.
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
): Promise<ComposeGenerationRoutingResult>;
```

**No new pinned constant.** Composer-level versions ride on the writers' existing
pins: `PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`,
`PCD_PROVIDER_ROUTER_VERSION` (via SP4 invariant pattern); `PCD_PROVENANCE_VERSION`
+ `PCD_PREPRODUCTION_CHAIN_VERSION` (via SP9); `PCD_COST_FORECAST_VERSION` (via
SP10A stamper, generic path only); `PCD_SYNTHETIC_ROUTER_VERSION` +
`PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION` + `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION`
(via SP16/SP18, synthetic-pairing path only).

### 2.1 Layering — composer must not import `@creativeagent/db`

The composer file imports only:

- `@creativeagent/schemas` — types: `CreatorIdentitySyntheticPayload`,
  `IdentityTier`, `OutputIntent`, `PcdIdentitySnapshot`, `PcdRoutingDecision`,
  `PcdRoutingDecisionReason`, `PcdShotType`, `SyntheticPcdRoutingDecision`.
- `../provider-router.js` — `routePcdShot`, `ProviderRouterStores`,
  `ApprovedCampaignContext`.
- `../provider-capability-matrix.js` — `PcdProviderCapability` type (used as
  the synthesized-capability shape on the synthetic-pairing write path).
- `../tier3-routing-rules.js` — `Tier3Rule` type plus three pure predicates:
  `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`,
  `requiresEditOverRegenerate`. Used in §3 Step 5a to recompute the same
  tier-3 required set the SP18 writer's invariant uses.
- `../synthetic-router/route-synthetic-pcd-shot.js` — `routeSyntheticPcdShot`.
- `../cost/write-pcd-identity-snapshot-with-cost-forecast.js` —
  `writePcdIdentitySnapshotWithCostForecast`,
  `WritePcdIdentitySnapshotWithCostForecastStores`.
- `../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js`
  — `writePcdIdentitySnapshotWithSyntheticRouting`,
  `WritePcdIdentitySnapshotWithSyntheticRoutingStores`.
- `../registry-resolver.js` — `ResolvedPcdContext` type.
- `../invariant-violation-error.js` — Step 1 consistency assert.
- `../provenance/stamp-pcd-provenance.js` — `StampPcdProvenanceInput` type.

Concrete Prisma stores live in `@creativeagent/db` and are instantiated by the
app/runner layer (Switchboard wiring at merge-back). The composer depends only on
the store types — it does not know that Prisma exists. This is the rule SP20
caught, SP21 locked, and SP22 must not regress.

---

## 3. Composition flow

```
Step 1 — Optional consistency assert.
           if (input.routing.syntheticSelection !== undefined) {
             if (input.routing.syntheticSelection.creatorIdentityId
                 !== input.routing.resolvedContext.creatorIdentityId) {
               throw new InvariantViolationError(
                 "synthetic selection creatorIdentityId mismatch with resolvedContext",
                 { syntheticSelectionId: …, resolvedContextId: … },
               );
             }
           }
         (SP16 source comment line 28-31 says the caller is responsible for this
          assertion; SP22 IS the caller. Throw before any reader/writer fires.)

Step 2 — Route. Branch only on syntheticSelection presence.
           if (input.routing.syntheticSelection !== undefined) {
             routingDecision = await routeSyntheticPcdShot(
               {
                 resolvedContext,
                 syntheticIdentity: input.routing.syntheticSelection.syntheticIdentity,
                 shotType, outputIntent,
                 videoProviderChoice: input.routing.syntheticSelection.videoProviderChoice,
                 approvedCampaignContext,
               },
               { campaignTakeStore: stores.campaignTakeStore },
             );
           } else {
             routingDecision = await routePcdShot(
               { resolvedContext, shotType, outputIntent, approvedCampaignContext },
               { campaignTakeStore: stores.campaignTakeStore },
             );
           }
         SP16 is the source of truth for synthetic eligibility. SP22 does NOT
         duplicate SP16's matrix lookup or delegation rules. SP16 may return:
           (a) synthetic_pairing allowed (kling or seedance)
           (b) synthetic_pairing denied (ACCESS_POLICY, NO_DIRECTION_AUTHORED)
           (c) delegated_to_generic_router (envelope with sp4Decision)
         SP22 interprets that decision; SP22 does NOT decide synthetic legality.

Step 3 — Map decision shape to write path.
           Case A: routingDecision is a SP4 decision and allowed.
             → call writePcdIdentitySnapshotWithCostForecast.
             → writerKind: "writePcdIdentitySnapshotWithCostForecast".

           Case B: routingDecision is a SyntheticPcdRoutingDecision with
                   kind === "delegated_to_generic_router" AND
                   sp4Decision.allowed === true.
             → call writePcdIdentitySnapshotWithCostForecast using
               sp4Decision fields (not the delegation envelope's metadata).
             → writerKind: "writePcdIdentitySnapshotWithCostForecast".
             → INVARIANT: delegation NEVER writes via
               writePcdIdentitySnapshotWithSyntheticRouting. (§7 anti-pattern
               + §8 unit-test enforces.)

           Case C: routingDecision is a SyntheticPcdRoutingDecision with
                   kind === "synthetic_pairing" AND allowed === true.
             → call writePcdIdentitySnapshotWithSyntheticRouting.
             → writerKind: "writePcdIdentitySnapshotWithSyntheticRouting".

           Any denial (SP4 ACCESS_POLICY/NO_PROVIDER_CAPABILITY; SP16
           ACCESS_POLICY/NO_DIRECTION_AUTHORED; delegation envelope with
           denied sp4Decision):
             → return { outcome: "denied", decision: routingDecision }.
             → NO writer call. NO snapshot.

Step 4 — On Case A or B (generic write path).
         Reconstruct WritePcdIdentitySnapshotInput from input.snapshotPersistence
         plus routing-decision-derived fields:

           const sp4Decision = (routingDecision.kind === "delegated_to_generic_router")
             ? routingDecision.sp4Decision  // narrowed: allowed === true
             : routingDecision;             // narrowed: allowed === true

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

         Construct StampPcdCostForecastInput post-routing:

           const costForecast: StampPcdCostForecastInput = {
             provider: sp4Decision.selectedProvider,
             model: input.snapshotPersistence.providerModelSnapshot,
             shotType: input.routing.shotType,
             outputIntent: input.routing.outputIntent,
             durationSec: input.costHints?.durationSec,
             tokenCount: input.costHints?.tokenCount,
           };

         Call writePcdIdentitySnapshotWithCostForecast:

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

         Return:
           { outcome: "routed_and_written",
             writerKind: "writePcdIdentitySnapshotWithCostForecast",
             decision: routingDecision,
             snapshot }.

Step 5 — On Case C (synthetic-pairing write path).
         Reconstruct WritePcdIdentitySnapshotInput as in Step 4, but with
         synthesized SP4-shaped fields to satisfy the SP18 writer's existing
         Tier 3 invariant assertion (see §11 for the full rationale; the
         invariant only inspects selectedCapability + editOverRegenerateRequired
         + tier3RulesApplied, none of which are persisted in their raw form
         except tier3RulesApplied inside routingDecisionReason).

         5a. Compute the SP4 tier-3 "required" set with the same predicates
             the invariant uses (so the forensic-consistency check passes):

           let editOverRegenerateRequired = false;
           if (input.routing.resolvedContext.effectiveTier === 3 &&
               input.routing.approvedCampaignContext.kind === "campaign") {
             editOverRegenerateRequired = await requiresEditOverRegenerate(
               { effectiveTier: 3,
                 organizationId: input.routing.approvedCampaignContext.organizationId,
                 campaignId: input.routing.approvedCampaignContext.campaignId },
               { campaignTakeStore: stores.campaignTakeStore },
             );
           }
           const tier3RulesApplied: Tier3Rule[] = [];
           if (requiresFirstLastFrameAnchor({
                 effectiveTier: input.routing.resolvedContext.effectiveTier,
                 shotType: input.routing.shotType,
                 outputIntent: input.routing.outputIntent })) {
             tier3RulesApplied.push("first_last_frame_anchor");
           }
           if (requiresPerformanceTransfer({
                 effectiveTier: input.routing.resolvedContext.effectiveTier,
                 shotType: input.routing.shotType })) {
             tier3RulesApplied.push("performance_transfer");
           }
           if (editOverRegenerateRequired) {
             tier3RulesApplied.push("edit_over_regenerate");
           }

         5b. Build the synthesized SP4-shaped values.

           const selectedProvider = `${routingDecision.imageProvider}+${routingDecision.videoProvider}`;
             // Composite. Both legal values: "dalle+kling", "dalle+seedance".
             // Matches the existing buildSyntheticSelectionRationale vocabulary.

           const selectedCapability: PcdProviderCapability = {
             // SYNTHESIZED — not persisted by SP18 writer (verified: SP18's
             // writer body line 95-151 has no selectedCapability in its
             // payload allowlist; the value is only used for the invariant
             // assertion in Step 2 of the writer). All support flags TRUE
             // because synthetic pairings supersede capability filtering by
             // SP16 design (line 22-24).
             provider: selectedProvider,
             tiers: [input.routing.resolvedContext.effectiveTier],
             shotTypes: [input.routing.shotType],
             outputIntents: [input.routing.outputIntent],
             supportsFirstLastFrame: true,
             supportsEditExtend: true,
             supportsPerformanceTransfer: true,
           };

           const routingDecisionReason: PcdRoutingDecisionReason = {
             // SYNTHESIZED. tier3RulesApplied is honest (recomputed required).
             // capabilityRefIndex carries the SP16 pairingRefIndex (the
             // "which row of the synthetic-pairing matrix" identifier).
             // The full SP16 decision is preserved verbatim in the SP18-stamped
             // syntheticRoutingDecisionReason column — this SP4-shaped reason
             // is the shim required by the existing writer schema.
             capabilityRefIndex: routingDecision.pairingRefIndex,
             matchedShotType: input.routing.shotType,
             matchedEffectiveTier: input.routing.resolvedContext.effectiveTier,
             matchedOutputIntent: input.routing.outputIntent,
             tier3RulesApplied,
             candidatesEvaluated: 1,
             candidatesAfterTier3Filter: 1,
             selectionRationale: routingDecision.decisionReason.selectionRationale,
           };

           const snapshotInput: WritePcdIdentitySnapshotInput = {
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

         Call writePcdIdentitySnapshotWithSyntheticRouting:

           const snapshot = await writePcdIdentitySnapshotWithSyntheticRouting(
             { snapshot: snapshotInput,
               provenance: input.provenance,
               syntheticRouting: { syntheticDecision: routingDecision } },
             {
               pcdSp18IdentitySnapshotStore: stores.pcdSp18IdentitySnapshotStore,
               creatorIdentityReader: stores.creatorIdentityReader,
               consentRecordReader: stores.consentRecordReader,
               clock: stores.clock,
             },
           );

         Return:
           { outcome: "routed_and_written",
             writerKind: "writePcdIdentitySnapshotWithSyntheticRouting",
             decision: routingDecision,
             snapshot }.
```

**Clock discipline.** SP22 body MUST NOT call `new Date()` (zero-arg form). All
"now" references thread through `input.now` and `stores.clock`. Anti-pattern test
#2 enforces with the narrow regex `/new\s+Date\s*\(\s*\)/`.

**No I/O parallelism.** Read-route-then-write is inherently sequential — routing
blocks writer-selection blocks writer-call.

---

## 4. Stores

`ComposeGenerationRoutingStores` is the intersection of three existing store
types. SP22 introduces zero new ports.

```ts
export type ComposeGenerationRoutingStores =
  ProviderRouterStores &                                // { campaignTakeStore }
  WritePcdIdentitySnapshotWithCostForecastStores &      // { pcdSp10IdentitySnapshotStore,
                                                        //   costEstimator,
                                                        //   creatorIdentityReader,
                                                        //   consentRecordReader,
                                                        //   clock? }
  WritePcdIdentitySnapshotWithSyntheticRoutingStores;   // { pcdSp18IdentitySnapshotStore,
                                                        //   creatorIdentityReader,
                                                        //   consentRecordReader,
                                                        //   clock? }
```

Shared store keys (`creatorIdentityReader`, `consentRecordReader`, `clock`) are
intersected — the runner wires each once. The two snapshot-store keys are
distinct (SP10 vs SP18 tables) and both are required because either writer can
be called depending on the routing decision. On a denial path neither write
store is touched.

---

## 5. Error handling

**Returned (business outcomes — not thrown):**
- Any denial branch of either router union, verbatim. The runner sees the
  underlying router's vocabulary (`ACCESS_POLICY`, `NO_PROVIDER_CAPABILITY`,
  `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER`, or a delegation envelope wrapping
  a denied `sp4Decision`).

**Thrown raw (infra failures — propagated to caller):**
- Step 1 consistency assertion mismatch → `InvariantViolationError` (matches
  SP9 / SP18 invariant precedent).
- Step 2 router throws (`campaignTakeStore` failure) → propagate.
- Step 4/5 writer throws (any of: SP9 `stampPcdProvenance` errors —
  `ConsentRevokedRefusalError`, `InvariantViolationError`, `ZodError`;
  SP10A `stampPcdCostForecast` errors — `ZodError`, estimator errors;
  SP4 Tier 3 invariant errors — `Tier3RoutingViolationError`,
  `Tier3RoutingMetadataMismatchError`; snapshot store errors) → propagate.

Selector returns business decisions; composer throws infrastructure failures.
SP21 / SP10C lock; SP22 carries forward.

If a Switchboard caller needs to surface throws as user-visible refusals, that
wrapping happens at the runner boundary (// MERGE-BACK), not in the SP22
composer body.

---

## 6. Cost-forecast asymmetry & SP22.1 reserved

**Known asymmetry SP22 ships with:** generic-path writes (Cases A + B) persist a
`costForecastReason` via `writePcdIdentitySnapshotWithCostForecast`;
synthetic-pairing writes (Case C) do NOT, because the only existing
synthetic-aware writer (`writePcdIdentitySnapshotWithSyntheticRouting`) does not
have a cost-forecast field — no SP10A+SP18 combined writer exists yet.

This asymmetry is documented on the SP22 source as a `// MERGE-BACK:` marker.

**SP22.1 reserved** — a combined writer (SP10A + SP18) that persists lineage +
cost-forecast + synthetic-routing on a single ≥30-field row. When that writer
lands, SP22's Case C call site updates to invoke it instead of
`writePcdIdentitySnapshotWithSyntheticRouting`. Out of SP22 scope.

---

## 7. Anti-pattern assertions (`sp22-anti-patterns.test.ts`)

Keyed against SP21 squash SHA `ece1347`.

Behavior-side invariants are enforced in §8 unit tests (which exercise actual
branches with mocked writers). Anti-pattern tests stay light and source-text-
based, focused on **what the composer must / must not import or reference**.

1. Composer file imports do NOT include `@creativeagent/db`.
2. Composer body contains NO zero-arg `new Date()` — regex
   `/new\s+Date\s*\(\s*\)/`. (Narrow per SP21 lesson — does not catch the
   legitimate `new Date(input.now.getTime() - …)` derivation form. The composer
   does not currently need such derivation, but the narrow regex future-proofs
   against false-positives if it does.)
3. Composer file does NOT import from:
   - `../selector/*` — SP21 selection is upstream.
   - `../synthetic-creator/*` — synthetic-payload fetch is upstream.
   - `../qc-*`, `../qc-providers.js` — QC is post-generation (SP24+).
   - `../consent-*` — consent re-check happens inside SP9, called by the
     writers; SP22 does NOT invoke directly.
   - `../performance-snapshot/*` — terminal-state write is post-generation
     (SP23+).
   - `../preproduction/*` — chain has already run.
   - `../cost-budget/*` — SP10C is chain-level, upstream.
4. Composer file does NOT reference identifiers: `Inngest`, `process.env`,
   `console.log`, `console.info`, `fetch(`, `selectSyntheticCreator`,
   `assertConsentNotRevokedForGeneration`, `runIdentityAwarePreproductionChain`.
5. **Writer-import singularity:**
   `writePcdIdentitySnapshotWithCostForecast` is imported exactly once and
   referenced (called) exactly once. Same for
   `writePcdIdentitySnapshotWithSyntheticRouting`. No other identity-snapshot
   writer (`writePcdIdentitySnapshot`, `writePcdIdentitySnapshotWithProvenance`)
   is imported.
6. **Router-import singularity:** `routePcdShot` imported once, called once;
   `routeSyntheticPcdShot` imported once, called once.
7. PCD pinned-constant tally test confirms count remains **24**.
8. Composer file size under **300 lines** (SP21 was ~100; SP22 carries more
   branching but should stay tight).

**Plan Task N–2** (anti-pattern test writing) must cross-check this list
line-by-line against the §7 assertions before finalizing — per the lesson in
`feedback_design_plan_antipattern_reconciliation.md`. The Task 13 allowlist
sweep across prior `sp*-anti-patterns.test.ts` should NOT pre-emptively widen;
extend each failing prior test with the narrowest matcher possible.

---

## 8. Test cases (`compose-generation-routing.test.ts`)

Mocked `vi.fn()` stores throughout. Matches SP4 / SP9 / SP10A / SP18 / SP21
unit-test convention. No real Postgres in SP22.

**Branch coverage — decision × write:**
1. Generic SP4 allowed → `writePcdIdentitySnapshotWithCostForecast` called
   once with the expected reconstructed `snapshot` + `provenance` + `costForecast`
   args; `writePcdIdentitySnapshotWithSyntheticRouting` NOT called; result
   `{ outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithCostForecast", … }`.
2. Generic SP4 ACCESS_POLICY denial → neither writer called; result
   `{ outcome: "denied", decision: { allowed: false, denialKind: "ACCESS_POLICY", … } }`.
3. Generic SP4 NO_PROVIDER_CAPABILITY denial → neither writer called.
4. Synthetic + in-pairing + kling allowed →
   `writePcdIdentitySnapshotWithSyntheticRouting` called once;
   `writePcdIdentitySnapshotWithCostForecast` NOT called; result
   `writerKind: "writePcdIdentitySnapshotWithSyntheticRouting"`;
   `snapshot.selectedProvider` set to `"dalle+kling"` (verified by inspecting
   the writer's recorded call args).
5. Synthetic + in-pairing + seedance allowed → mirror of (4), `"dalle+seedance"`.
6. Synthetic + ACCESS_POLICY denial → neither writer called.
7. Synthetic + NO_DIRECTION_AUTHORED denial → neither writer called.
8. **Synthetic delegation + sp4Decision allowed →
   `writePcdIdentitySnapshotWithCostForecast` called once;
   `writePcdIdentitySnapshotWithSyntheticRouting` NOT called.** (The key §3 Case
   B invariant. The composer pulls fields from `routingDecision.sp4Decision`,
   not from the delegation envelope.)
9. Synthetic delegation + sp4Decision denied → neither writer called; full
   delegation envelope returned verbatim in `result.decision`.

**Input plumbing:**
10. Step 1 consistency assert mismatch:
    `syntheticSelection.creatorIdentityId !== resolvedContext.creatorIdentityId`
    → throws `InvariantViolationError`; no router/writer called.
11. `costForecast` input constructed post-routing carries:
    - `provider === routingDecision.selectedProvider` (or `sp4Decision.selectedProvider`
      for delegation Case B).
    - `model === input.snapshotPersistence.providerModelSnapshot`.
    - `shotType === input.routing.shotType`.
    - `outputIntent === input.routing.outputIntent`.
    - `durationSec === input.costHints?.durationSec`.
    - `tokenCount === input.costHints?.tokenCount`.
12. `editOverRegenerateRequired` derivation: passes through
    `routingDecisionReason.tier3RulesApplied.includes("edit_over_regenerate")`
    on the generic path.
13. `now` plumbing: composer body has no zero-arg `new Date(` (cross-checked
    by anti-pattern test #2). Behavioral check: composer accepts a fixed
    `input.now`, writers receive consistent fakes.
14. `selectedProvider` composite construction: synthetic-pairing decisions
    write `${imageProvider}+${videoProvider}`. Verified for both kling and
    seedance branches.

**Tier-3 synthetic invariant interaction (the §11 resolution):**
15. **Tier-3 + talking_head + final_export + synthetic-pairing kling allowed →
    `writePcdIdentitySnapshotWithSyntheticRouting` called once;** the writer's
    `assertTier3RoutingDecisionCompliant` invocation does NOT throw (verified
    by spying on the snapshot store's `createForShotWithSyntheticRouting` and
    observing it was called). Recorded call args show:
    - `selectedCapability.supportsFirstLastFrame === true`,
      `selectedCapability.supportsPerformanceTransfer === true`,
      `selectedCapability.supportsEditExtend === true` (all synthesized true).
    - `tier3RulesApplied` is set-equal to
      `["first_last_frame_anchor", "performance_transfer"]`.
    - `editOverRegenerateRequired === false` (no campaign context in this test).
16. **Tier-3 + product_demo + final_export + synthetic-pairing seedance +
    campaign context with `hasApprovedTier3TakeForCampaign === true` →**
    composer calls `campaignTakeStore.hasApprovedTier3TakeForCampaign` (the
    Step 5a side-call), `tier3RulesApplied` includes `"edit_over_regenerate"`,
    `editOverRegenerateRequired === true`, writer is called with
    `selectedCapability.supportsEditExtend === true`, no throw.
17. **Tier ≤ 2 synthetic-pairing →** Step 5a recompute produces empty
    `tier3RulesApplied`; `campaignTakeStore` is NOT called; writer succeeds.

**Error propagation:**
18. Router throws → composer rethrows; no writer called.
19. `writePcdIdentitySnapshotWithCostForecast` throws → composer rethrows.
20. `writePcdIdentitySnapshotWithSyntheticRouting` throws → composer rethrows.
21. `campaignTakeStore.hasApprovedTier3TakeForCampaign` throws (during Step 5a
    on tier 3 + synthetic) → composer rethrows; no writer called.

---

## 9. Files SP22 adds / touches

**New files:**
- `packages/creative-pipeline/src/pcd/generation/index.ts`
- `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`
- `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- `packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts`

**Modified files:**
- Any prior `sp*-anti-patterns.test.ts` whose allowlist needs a narrow extension
  for the new `generation/` directory or `compose-generation-routing.ts` file
  (discovered during Task 13, not pre-listed). Per SP21 lesson #9: prefer
  tightening prior tests' grep scope to import-scope (e.g. wrap regex patterns
  with `/from\s+["'][^"']*…["']/i`) over product-code comment workarounds.

**Untouched (hard guarantee):**
- SP4 `provider-router.ts`, `pcd-identity-snapshot-writer.ts`.
- SP9 `stamp-pcd-provenance.ts`, `write-pcd-identity-snapshot-with-provenance.ts`.
- SP10A `stamp-pcd-cost-forecast.ts`, `write-pcd-identity-snapshot-with-cost-forecast.ts`.
- SP16 `route-synthetic-pcd-shot.ts`, `synthetic-provider-pairing.ts`,
  `synthetic-router-version.ts`.
- SP18 `stamp-pcd-synthetic-routing-decision.ts`,
  `write-pcd-identity-snapshot-with-synthetic-routing.ts`,
  `synthetic-routing-provenance-version.ts`.
- SP21 `compose-synthetic-creator-selection.ts`, all selector source.
- All schema files; no new constant; no migration.

---

## 10. `// MERGE-BACK:` markers reserved on SP22 source

1. Inngest step wrapping at the call site (Switchboard runner owns).
2. WorkTrace emission at composer entry / writer-call boundary / composer exit
   (forensic record-keeping).
3. Operator-facing per-shot routing-decision dashboards.
4. Real provider invocation downstream of SP22 (runner owns; post-snapshot).
5. Runner-side per-brief caching of the loaded synthetic identity payload (one
   read per brief feeds N SP22 calls).
6. **SP22.1 reserved** — combined SP10A+SP18 writer to close the
   cost-forecast asymmetry on the synthetic-pairing write path. When that
   writer lands, the Case C call site updates to invoke it.
7. SP10C cost-budget enforcement remains chain-level upstream of SP22.
   Directional note only; no code linkage in this slice.
8. Step 1 consistency assert may migrate to a runner-side brief-scope contract
   at merge-back if Switchboard wires its own.

---

## 11. Synthetic-pairing snapshot field mapping — fully resolved during design

The SP16 success decision carries:
- `imageProvider: "dalle"`
- `videoProvider: "kling" | "seedance"`
- `pairingRefIndex: number`
- `decisionReason: { matchedShotType, matchedOutputIntent, selectionRationale }`

These have no direct counterpart in `WritePcdIdentitySnapshotInput`'s
`selectedCapability` (a `PcdProviderCapability` shape from SP4's matrix),
`selectedProvider` (a single string), `editOverRegenerateRequired` (a boolean
fed to the invariant), or `routingDecisionReason` (a `PcdRoutingDecisionReason`
shape). The synthetic-pairing decision is structurally distinct from a SP4
generic decision.

### 11.1 Investigation summary

`write-pcd-identity-snapshot-with-synthetic-routing.test.ts` was inspected;
its fixture (line 91-174) uses **generic SP4-shaped values** for
`selectedProvider: "sora"`, `selectedCapability`, and `routingDecisionReason`,
combined with a kling synthetic-pairing decision passed to the synthetic-routing
stamp. The fixture deliberately uses `effectiveTier: 2` so the Tier 3 invariant
short-circuits (line 106 of `tier3-routing-rules.ts`: `if (input.effectiveTier !== 3) return;`).
**No existing convention** for synthetic-pairing-specific values of these
SP4-shaped fields is encoded — the SP18 writer test treats them as generic
fixture inputs.

This means SP22 is the first orchestrator that must map an actual SP16
synthetic-pairing decision into these fields **and** handle the Tier 3
interaction surfaced by tier-3 + publishable-intent + video-shot synthetic
pairings (which the SP18 writer fixture never exercises).

### 11.2 Discovered Tier 3 invariant interaction

The SP18 writer runs `assertTier3RoutingDecisionCompliant` unconditionally
(line 77-84 of `write-pcd-identity-snapshot-with-synthetic-routing.ts`).
The synthetic-pairing matrix (`PCD_SYNTHETIC_PROVIDER_PAIRING`) accepts all
7 video shot types at all 4 output intents at all tiers — including tier 3 +
`talking_head` (which requires `performance_transfer` per
`requiresPerformanceTransfer`) and tier 3 + publishable video shot types
(which require `first_last_frame_anchor`).

SP16's own design (line 22-24 of `route-synthetic-pcd-shot.ts`) says
"algorithm is intentionally tier3-rule-free for the synthetic path: the
locked pairing supersedes generic capability filtering by design". But the
SP18 writer's invariant does NOT know SP16's intent — it just checks
capabilities against the recomputed required set, and a forensic mismatch
between supplied `tier3RulesApplied` and recomputed `required` throws
`Tier3RoutingMetadataMismatchError`.

A naive SP22 implementation that passed `tier3RulesApplied: []` for synthetic
writes would throw on tier-3 + talking_head shots (which is currently a
legal SP16 route).

### 11.3 Locked resolution

Adopt the synthesis approach already coded into §3 Step 5:

**`selectedProvider`** — composite `${imageProvider}+${videoProvider}`. Two
legal values: `"dalle+kling"`, `"dalle+seedance"`. Consistent with
`buildSyntheticSelectionRationale`'s existing vocabulary; no new symbol
invented; `selectedProvider` schema is `z.string().min(1)` — accepts.
**Persisted** by SP18 writer (in payload allowlist).

**`selectedCapability`** — synthesized in SP22 (Step 5b). All support flags
set to `true`. **NOT persisted** by SP18 writer (verified: SP18's body line
95-151 has no `selectedCapability` in its payload allowlist; the value is
consumed only by `assertTier3RoutingDecisionCompliant` and then discarded).
The "all-true" synthesis is forensically inconsequential because the value
isn't stored; it serves solely to make the invariant's capability check pass
unconditionally for the synthetic path — matching SP16's design intent that
"synthetic pairings supersede capability filtering".

**`tier3RulesApplied`** — honestly recomputed by SP22 (Step 5a) using the
same predicates the invariant uses (`requiresFirstLastFrameAnchor`,
`requiresPerformanceTransfer`, `editOverRegenerateRequired`). Carried into
`routingDecisionReason.tier3RulesApplied` (which IS persisted). The forensic
consistency check inside `assertTier3RoutingDecisionCompliant` (Step C of
its body) passes because supplied == recomputed by construction.

**`editOverRegenerateRequired`** — computed honestly. For tier 3 + campaign
context, SP22 calls `requiresEditOverRegenerate` (which queries
`campaignTakeStore`) — the same query SP4 router makes for its own path.
For tier ≠ 3 or no campaign, defaults to `false`. This means SP22 calls
`campaignTakeStore` for tier-3 synthetic shots that SP16 itself does not
query — asymmetric, but necessary to satisfy SP18's writer invariant
without source edits to SP18 or SP4 / tier3-routing-rules.

**`routingDecisionReason`** — synthesized to the `PcdRoutingDecisionReason`
shape. `capabilityRefIndex` carries SP16's `pairingRefIndex` (a re-labeling
acknowledged as a shim — the authoritative SP16 record lives in the
separately-persisted `syntheticRoutingDecisionReason` column written by SP18's
own stamper). `tier3RulesApplied` carries the recomputed value (honest).
Other fields (`candidatesEvaluated: 1`, `candidatesAfterTier3Filter: 1`)
reflect that synthetic pairing is single-row matrix lookup; not "wrong" so
much as a different kind of candidate-counting from SP4's matrix scan.
`selectionRationale` copies SP16's verbatim string (already in the
"synthetic-pairing tier=X shot=Y intent=Z → dalle+W" form).

### 11.4 Forensic transparency

The arrangement above creates two persisted reason columns on every
synthetic-pairing snapshot row:
- `routingDecisionReason` (SP4-shaped) — the shim required by the SP4-shaped
  writer input schema. Honest about tier3RulesApplied + selectionRationale;
  a label-shim about capabilityRefIndex (really a pairingRefIndex).
- `syntheticRoutingDecisionReason` (SP18-shaped) — the authoritative SP16
  record. Written by SP18's own stamper, includes `pairingRefIndex`,
  `decisionReason: { matchedShotType, matchedOutputIntent, selectionRationale }`,
  `decidedAt`, `syntheticRoutingProvenanceVersion`, plus the per-provider
  direction block (klingDirection or seedanceDirection).

Future readers reconciling these two columns must understand the SP4 column
on a synthetic row is a shim. Documented here so the reconciliation is
discoverable.

### 11.5 What Task 1 still owns

The full resolution above is **locked at design time**. Plan Task 1 becomes a
verification-and-document step rather than a discovery step:
- Re-read SP18's writer + stamper to confirm the field-set list (in case any
  field was overlooked).
- Write a brief findings note (matches SP20 + SP21 Task 1 pattern) that
  states "Resolution from §11.3 was verified against current SP18 surface;
  no deviations found" — or, if a deviation IS found, redesign.
- Then the composer body proceeds to Task 3 (type definitions) with the
  Step 5 pseudocode as authoritative.

---

## 12. Plan shape preview (writing-plans skill input)

~15 TDD-paced tasks, in order. Mirrors SP21 plan structure; one extra task
versus SP21 because of the tier-3 synthetic invariant interaction surfaced
in §11.2.

1. **Plan Task 1 — verification of §11.3 resolution.** Re-read
   `write-pcd-identity-snapshot-with-synthetic-routing.test.ts` +
   `stamp-pcd-synthetic-routing-decision.ts` + `tier3-routing-rules.ts` to
   confirm: (a) `selectedCapability` is NOT in the SP18 writer payload
   allowlist; (b) `tier3RulesApplied` IS persisted via `routingDecisionReason`;
   (c) the SP4 Tier 3 invariant's recompute logic exactly matches the three
   predicates listed in §3 Step 5a. Write a brief findings note (matches
   SP20 + SP21 Task 1 pattern). If any deviation from §11.3 is found, halt
   and redesign before any composer code.
2. SP22 anti-pattern test freeze baseline — empty test file in
   `generation/sp22-anti-patterns.test.ts` so the suite turns red on the
   composer's first commit.
3. Define `ComposeGenerationRoutingInput`, `SyntheticSelectionContext`,
   `ComposeGenerationRoutingStores`, `ComposeGenerationRoutingResult` types
   (compile-only, no body).
4. Step 1 consistency assert test (red) + impl (green) — mismatch throws
   `InvariantViolationError`, no router/writer called.
5. Generic-route happy-path test (Case A) — `routePcdShot` returns allowed;
   `writePcdIdentitySnapshotWithCostForecast` called with the exact
   reconstructed args (`snapshot`, `provenance`, `costForecast`).
6. Composer body green-bar through Case A.
7. Synthetic-route kling happy-path test (Case C, tier ≤ 2) →
   `writePcdIdentitySnapshotWithSyntheticRouting` called once with
   `snapshot.selectedProvider === "dalle+kling"`,
   `snapshot.selectedCapability.supportsFirstLastFrame === true`, etc.;
   `routingDecisionReason.tier3RulesApplied === []`.
8. Synthetic-route seedance happy-path test (Case C, seedance branch, tier ≤ 2).
9. **Tier-3 synthetic invariant interaction tests** (§8 tests 15-17 + 21) —
   the §11.2/§11.3 resolution under test. Includes the `campaignTakeStore`
   side-call on tier 3 + campaign context.
10. **Synthetic-delegation-with-allowed-sp4 test (Case B) — the
    SP10A-not-SP18 invariant.** `writePcdIdentitySnapshotWithCostForecast`
    called, NOT `writePcdIdentitySnapshotWithSyntheticRouting`.
11. Denial-no-write tests (6 cases): SP4 ACCESS_POLICY, SP4
    NO_PROVIDER_CAPABILITY, SP16 ACCESS_POLICY, SP16 NO_DIRECTION_AUTHORED,
    delegation envelope with denied sp4Decision (two sub-cases by sp4
    denialKind).
12. Cost-forecast input construction tests — `provider`/`model`/`shotType`/
    `outputIntent`/`durationSec`/`tokenCount` plumbed correctly post-routing.
13. `editOverRegenerateRequired` derivation test (generic path AND synthetic
    path on tier 3 with campaign context).
14. SP22 anti-pattern assertions filled in green. **Cross-check against §7
    line-by-line per `feedback_design_plan_antipattern_reconciliation.md`
    before declaring green.**
15. Allowlist sweep across prior `sp*-anti-patterns.test.ts` for the new
    `generation/` directory + new composer file. Final verification gate
    inside the worktree:
    `pnpm typecheck && pnpm test && pnpm lint && git diff --name-only main...HEAD | xargs pnpm prettier --check`.

---

## 13. Lessons carried forward (from SP19 / SP20 / SP21 — see
`project_pcd_slice_progress.md`)

1. **Design ↔ plan ↔ anti-pattern test reconciliation.** Plan Task 13
   cross-checks design §7 line-by-line before green-barring.
2. **Schema verification / convention discovery before code.** Plan Task 1
   resolves §11 by reading existing SP18 tests, documents in a findings
   note, updates §3 Step 5. No composer code is written until Task 1
   lands.
3. **Anti-pattern regex narrowness.** `/new\s+Date\s*\(\s*\)/` (zero-arg only)
   not `/new\s+Date\s*\(/` (catches legitimate `new Date(input.now.getTime() - …)`).
4. **Prior-slice anti-pattern grep tightening.** Prefer fixing prior tests'
   import-scope grep over product-code comment workarounds (SP12 → SP21
   pattern).
5. **Mock-based vs live-Postgres test convention.** SP22 composer tests are
   `vi.fn()`-mocked throughout. No real Postgres.
6. **Read-only review subagent instructions** required if any reviewer agents
   are dispatched in the SP22 worktree.
7. **Worktree-side prettier.** Never run `prettier --check .` from parent repo
   against worktree files; use `git diff --name-only main...HEAD | xargs pnpm prettier --check`.
8. **Branch reconciliation post-squash-merge.** From main repo root:
   `git fetch origin && git reset --hard origin/main` if local-main drifts.
9. **Task 13 allowlist cascade.** Later commits in the slice can re-break the
   sweep; budget one fix-up commit at the final verification gate.
