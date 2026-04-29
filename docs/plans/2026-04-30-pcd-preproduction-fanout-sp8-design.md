---
date: 2026-04-30
tags: [creativeagent, pcd, design, sp8, preproduction-fanout, branching-tree, identity-context, production-fanout-gate, synergy]
status: active
---

# SP8 — Branching Tree State + Production-Fanout Hardening — Design Spec

**Project:** CreativeAgent / PCD (Performance Creative Director)
**Sprint:** SP8 — second synergy slice (branching tree state for the pre-production layer)
**Created:** 2026-04-30
**Status:** Design approved, pending implementation plan

## Goal

Turn each pre-production stage's length-1 output into a length-N branching tree, replace the SP7 single-script gate with an N-script auto-approve-all gate, harden two SP7 code-review carry-overs (deep-freeze of the identity context, forensic gate-version pinning), and ship one new pinned version constant so SP10's tree-budget enforcement can land without re-versioning the chain. SP8 is a **widening** of SP7 — same chain shape, same five stages, same one human gate at the cost cliff. What changes:

1. **Stage outputs grow from length-1 to length-N**, with parent-ID lineage already present in SP7 schemas now actually populated for every branch (no schema fields added for lineage — they were forward-compat in SP7).
2. **Gate adapter contract narrows** — `ProductionFanoutGate.requestSelection` now returns just the operator-decision tuple (`selectedScriptIds`, `decidedBy`, `decidedAt`), not the full forensic decision struct. The **composer** assembles `PcdProductionFanoutDecision` from imports + identity context + brief input, pinning all four versions itself. The gate cannot forge versions, identity carry-through, or `briefId`.
3. **`PcdIdentityContext` is now deep-frozen at runtime** via a new `deepFreeze` helper, AND its arrays / sub-objects gain `.readonly()` in zod for compile-time TS enforcement. Closes SP7's I-1 hole where `ctx.allowedShotTypes.push(...)` would mutate.
4. **One new pinned version constant** — `PCD_PREPRODUCTION_FANOUT_VERSION = "preproduction-fanout@1.0.0"` — added to `PcdProductionFanoutDecision`. This isolates the fanout/decision-shape audit trail from `PCD_PREPRODUCTION_CHAIN_VERSION`, so SP10 can bump fanout without bumping chain.
5. **`PcdIdentityContext` gains `treeBudget: PreproductionTreeBudget | null`** — schema field nullable in SP8, populated by `buildPcdIdentityContext` as `null`. SP10 widens enforcement; no version bump on widen.
6. **Heterogeneous stub fanout (2-2-3-2 → 24 scripts)** — non-square cardinality so cardinality bugs are catchable; exported per-stage constants drive the numbers.

The SP7 chain shape (`build identity context → trends → motivators → hooks → creator scripts → production fanout gate → return`), the four stage-runner interface signatures, the `runStageWrapped` error-wrapping helper, and the version constants `PCD_PREPRODUCTION_CHAIN_VERSION` / `PCD_IDENTITY_CONTEXT_VERSION` are unchanged. SP1–SP6 source bodies are untouched.

## Scope

### In scope

- **Schema widenings** in `packages/schemas/src/pcd-preproduction.ts`:
  - New `PreproductionTreeBudgetSchema`.
  - `PcdIdentityContextSchema` widens with `treeBudget: PreproductionTreeBudgetSchema.nullable()` and `.readonly()` on every array (`allowedShotTypes`, `allowedOutputIntents`, `ugcStyleConstraints`) and on the `tier3Rules` sub-object.
  - `PcdProductionFanoutDecisionSchema` widens with two new fields — `preproductionFanoutVersion: z.string()` and `decisionNote: z.string().nullable()` — and `.readonly()` on `selectedScriptIds` / `availableScriptIds`.
  - New `ProductionFanoutGateOperatorDecisionSchema` for the narrow gate-return tuple. Validated by composer at runtime to defend against malformed merge-back Inngest payload.
- **One new pinned version constant** in `packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts`: `PCD_PREPRODUCTION_FANOUT_VERSION = "preproduction-fanout@1.0.0"`. Co-located test asserts the constant value.
- **New `deepFreeze` helper** at `packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts`: recursive freeze for arrays + plain objects, idempotent on already-frozen, leaves primitives alone. Co-located test asserts deep-freeze of nested arrays + nested objects + idempotency.
- **`production-fanout-gate.ts` widens**:
  - `ProductionFanoutGate.requestSelection` return type changes from `Promise<PcdProductionFanoutDecision>` to `Promise<ProductionFanoutGateOperatorDecision>`.
  - `AutoApproveOnlyScriptGate` is **deleted**.
  - `AutoApproveAllScriptsGate` is the new default in-tree implementer. Selects every available script (length-N out of length-N), sorts ascending, returns the operator-decision tuple. `// MERGE-BACK:` marker retargets to the new class name.
- **`preproduction-chain.ts` (composer) widens**:
  - Composer calls the gate, receives the narrow tuple, parses via `ProductionFanoutGateOperatorDecisionSchema.parse(raw)` inside `runStageWrapped` (so parse failure becomes `PreproductionChainError({ stage: "production_fanout_gate" })`).
  - Composer asserts `selectedScriptIds ⊆ availableScriptIds`; violation throws `InvariantViolationError` inside the same `runStageWrapped` wrapper (also becomes a `PreproductionChainError`).
  - Composer assembles `PcdProductionFanoutDecision` literally: pins all four versions from imports, fills `briefId` / `creatorIdentityId` / `productIdentityId` / `consentRecordId` / `effectiveTier` from its own `brief` + `identityContext`, sorts both selection arrays defensively, sets `decisionNote: null` and `costForecast: null`.
  - The five-step chain shape (build → trends → motivators → hooks → scripts → gate → return) is preserved verbatim. `runStageWrapped` is unchanged. The four stage-runner calls are unchanged.
- **`build-pcd-identity-context.ts` widens**:
  - Replaces `Object.freeze(context)` with `deepFreeze(context)`.
  - Stamps `treeBudget: null`. In-line code comment: `// treeBudget is reserved for SP10 enforcement; SP8 always emits null.`
- **Stub stage runners widen** to length-N, parameterized by exported constants:
  - `stub-trends-stage-runner.ts`: `STUB_TRENDS_FANOUT = 2`. Two trend signals per brief.
  - `stub-motivators-stage-runner.ts`: `STUB_MOTIVATORS_PER_TREND = 2`. Two motivators per trend → 4 total at fanout=2.
  - `stub-hooks-stage-runner.ts`: `STUB_HOOKS_PER_MOTIVATOR = 3`. Three hooks per motivator → 12 total. Hook-type rotates across `["direct_camera", "mid_action", "reaction"]`.
  - `stub-creator-scripts-stage-runner.ts`: `STUB_SCRIPTS_PER_HOOK = 2`. Two scripts per hook → 24 total.
  - All stub IDs follow parent-traceable shape: `trend-${briefId}-N`, `motivator-${parentTrendId}-N`, `hook-${parentMotivatorId}-N`, `script-${parentHookId}-N`.
- **Co-located tests for every new and widened source file.** Test counts: composer test grows from ~17 cases (SP7) to ~24 cases (SP8); gate test rewrites from SP7's single-script cases to ~7 N-script auto-approve cases; stub tests widen to ~5 cases each (asserting tree shape + parent-ID lineage); two new test files (`deep-freeze.test.ts` ~10 cases, `preproduction-fanout-version.test.ts` 1 case).
- **New `sp8-anti-patterns.test.ts`** sibling to SP7's anti-pattern test:
  - **No `PCD_PREPRODUCTION_CHAIN_VERSION` / `PCD_IDENTITY_CONTEXT_VERSION` / `PCD_APPROVAL_LIFECYCLE_VERSION` / `PCD_PREPRODUCTION_FANOUT_VERSION` literal** in `production-fanout-gate.ts` source. Forces composer-only pinning.
  - **Composer source contains all four pinned-version literal references** (one per pinned constant), structurally proving the composer is the assembly point.
  - **Composer source literally references `ProductionFanoutGateOperatorDecisionSchema.parse(`** — the runtime-defense parse is real, not theater.
  - **No `if (stage ===`, `if (intent ===`, `if (effectiveTier ===`, `if (shotType ===`** in any SP7-or-SP8 source. Inherited; SP8's test asserts the SP7 invariant continues to hold across the widened chain.
  - **No `prisma.`, `assetRecord.update`, `WorkTrace`** literals in any SP7-or-SP8 source.
  - **No SP1–SP6 source-body imports of SP7 / SP8 symbols.** Direction lock: pre-production depends on SP1–SP6; SP1–SP6 must not depend on pre-production.
- **Cleanup of `sp7-anti-patterns.test.ts`**: remove the dead `if (file.endsWith("sp7-anti-patterns.test.ts")) continue;` skip on line 99 — line 17's `.test.ts` filter already prevents the file from entering the walk. (The user's prompt explicitly invited this cleanup. Test files are not "SP7 source bodies" per guardrail #2.)
- **`packages/creative-pipeline/src/pcd/preproduction/index.ts` widens**:
  - Drops `AutoApproveOnlyScriptGate` export.
  - Adds `AutoApproveAllScriptsGate`, `PCD_PREPRODUCTION_FANOUT_VERSION`, `deepFreeze` exports.
  - Adds `STUB_TRENDS_FANOUT`, `STUB_MOTIVATORS_PER_TREND`, `STUB_HOOKS_PER_MOTIVATOR`, `STUB_SCRIPTS_PER_HOOK` exports for tests.
- **`packages/schemas/src/index.ts` widens**: re-exports `PreproductionTreeBudgetSchema`, `PreproductionTreeBudget`, `ProductionFanoutGateOperatorDecisionSchema`, `ProductionFanoutGateOperatorDecision`. Existing exports (`PcdIdentityContextSchema`, `PcdProductionFanoutDecisionSchema`) automatically carry the new fields through their inferred types.

### Out of scope

- **Per-stage tier validators.** Still deferred (SP7 Q7=A inheritance). SP8 trusts each runner.
- **Tree-budget enforcement.** SP10 territory. SP8 ships `treeBudget` schema field as nullable; builder always emits `null`; composer never reads it.
- **Cost forecast computation.** `PcdCostForecastSchema` stays a placeholder; SP8 always emits `costForecast: null`. SP10 fills.
- **Real Claude-driven stage runners.** Stubs only in this repo. Merge-back ships real runners; the stub-vs-real swap is by injection, not refactor.
- **Real human-approval gate UX.** `AutoApproveAllScriptsGate` is the only in-tree implementer. Merge-back ships the Inngest-`step.waitForEvent`-backed implementer.
- **Refusal-reason enum on the decision struct (Q1=B locked).** SP8's gate is a *prioritization* gate against budget, not a *blocking* gate against legal/safety. Refusal-reason taxonomy is meaningful for SP6 final-export-gate (legal) but adds no audit value to SP8 (operator preference). The `decisionNote: string | null` field provides a free-text seam for any merge-back UX that wants operator commentary.
- **Per-script `decisionTags` (Q1 option C rejected).** Same reasoning.
- **Nested-tree `stageOutputs` shape (Q3=A locked).** Stage outputs stay flat arrays; tree shape is recoverable by joining `parent*Id` fields. If a downstream caller wants the nested view, ship a derivation helper later as cheap pure code.
- **Per-stage `targetFanout` parameter on `run()` (Q5=B locked).** Stage-runner interfaces stay SP7-shape. Stub fanout is hardcoded via exported constants; real merge-back runners derive fanout from prompt context.
- **Sibling `pcd/preproduction-tree/` subdir (Q6=A locked).** SP8 source is siblings in the existing `pcd/preproduction/` subdir.
- **Backwards compatibility with `AutoApproveOnlyScriptGate`.** It is deleted. SP7 tests that referenced it migrate to `AutoApproveAllScriptsGate`. Per CLAUDE.md "no backwards-compatibility hacks for unused code."
- **Edits to SP1–SP6 source bodies.** Zero edits. SP8 consumes their exports only.
- **Edits to SP7 pure functions.** `mapProductQualityTier`, `mapCreatorQualityTier`, `computeEffectiveTier`, `projectAllowedShotTypes`, `projectAllowedOutputIntents`, `projectTier3Rules`, `runStageWrapped`, the four stage-runner interface signatures — all unchanged. The composer body widens (Q8=B explicitly accepted) and the builder body widens (deep-freeze + treeBudget) — these are widenings of existing adapters, not mutations of pure functions.
- **Prisma migration.** SP8 is pure orchestration / schema widening. No DB changes.
- **`apps/api` wiring, real `WorkTrace` emit, lifecycle wiring.** Markers only; merge-back work.
- **Performance back-flow into pre-production.** SP10+ territory. SP8 is forward-flow only.
- **Schema widenings to `ProductIdentity` / `CreatorIdentity` / `ConsentRecord`.** Not needed. SP7's reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) cover the surface.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SP8 widens SP7's preproduction chain — same shape, branched tree, hardened   │
│ forensic surface                                                              │
│                                                                               │
│   runIdentityAwarePreproductionChain(brief, stores)                          │
│     ──→ buildPcdIdentityContext (deepFreeze + treeBudget:null)               │
│           ──→ PcdIdentityContext (immutable, deep-frozen)                    │
│     ──→ trendsRunner.run                  → 2 trends                          │
│     ──→ motivatorsRunner.run              → 4 motivators (×2 per trend)       │
│     ──→ hooksRunner.run                   → 12 hooks (×3 per motivator)       │
│     ──→ creatorScriptsRunner.run          → 24 scripts (×2 per hook)          │
│     ──→ productionFanoutGate.requestSelection                                 │
│           returns { selectedScriptIds, decidedBy, decidedAt }   ← NARROW      │
│     ──→ COMPOSER: parse via                                                   │
│           ProductionFanoutGateOperatorDecisionSchema.parse                    │
│     ──→ COMPOSER: assert selectedScriptIds ⊆ availableScriptIds               │
│     ──→ COMPOSER: assemble PcdProductionFanoutDecision                        │
│           pins all 4 versions from imports                                    │
│           identity carry-through from brief + identityContext                 │
│           selection arrays sorted ascending                                   │
│           decisionNote: null, costForecast: null                              │
│     ──→ PcdPreproductionChainResult { decision, stageOutputs }               │
│                                                                               │
│   stageOutputs = flat arrays with parent*Id lineage                           │
│   (motivators carry parentTrendId; hooks carry parentMotivatorId/parentTrendId│
│    scripts carry parentHookId; tree shape recoverable by join)                │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ unchanged from SP7
                                    ▼
                  ┌──────────────────────────────────┐
                  │ Existing SP1–SP6 surface         │
                  │   resolvePcdRegistryContext      │ (unused — SP7 readers)  │
                  │   assertConsentNotRevokedForGen  │ (used by builder)       │
                  │   IdentityTierSchema             │
                  │   PcdShotTypeSchema              │
                  │   OutputIntentSchema             │
                  │   PCD_TIER_POLICY_VERSION        │
                  │   PCD_PROVIDER_CAPABILITY_VERSION│
                  │   PCD_APPROVAL_LIFECYCLE_VERSION │ (pinned by composer)    │
                  │   ConsentRevokedRefusalError     │
                  │   InvariantViolationError        │
                  └──────────────────────────────────┘
                                    │
                                    │ injected via stores bundle (SP7-shape)
                                    ▼
                  ┌──────────────────────────────────┐
                  │ Stage runners (SP7 interfaces)   │
                  │   TrendsStageRunner              │
                  │   MotivatorsStageRunner          │
                  │   HooksStageRunner               │
                  │   CreatorScriptsStageRunner      │
                  │                                  │
                  │ SP8 stub defaults (length-N):    │
                  │   StubTrendsStageRunner          │ (× 2)
                  │   StubMotivatorsStageRunner      │ (× 2 per trend)
                  │   StubHooksStageRunner           │ (× 3 per motivator)
                  │   StubCreatorScriptsStageRunner  │ (× 2 per hook)
                  └──────────────────────────────────┘
                                    │
                                    ▼
                  ┌──────────────────────────────────┐
                  │ ProductionFanoutGate adapter     │
                  │ Default: AutoApproveAllScriptsGate│ (replaces SP7 default)  │
                  │ Returns: { selectedScriptIds,    │
                  │            decidedBy,            │
                  │            decidedAt }           │
                  └──────────────────────────────────┘

Injected store bundle (unchanged from SP7):
  stores.sp7ProductRegistryReader            (SP7)
  stores.sp7CreatorRegistryReader            (SP7)
  stores.consentRecordReader                 (SP6)
  stores.creatorIdentityReader               (SP6)
  stores.trendsRunner                        (SP7 interface; SP8 stub default widened)
  stores.motivatorsRunner                    (SP7 interface; SP8 stub default widened)
  stores.hooksRunner                         (SP7 interface; SP8 stub default widened)
  stores.creatorScriptsRunner                (SP7 interface; SP8 stub default widened)
  stores.productionFanoutGate                (return type narrowed; default class replaced)
  stores.clock?: () => Date                  (SP7)
```

### File layout (additions and widenings)

```
packages/creative-pipeline/src/pcd/preproduction/
  deep-freeze.ts                            # NEW: recursive freeze helper
  deep-freeze.test.ts                       # NEW
  preproduction-fanout-version.ts           # NEW: PCD_PREPRODUCTION_FANOUT_VERSION
  preproduction-fanout-version.test.ts      # NEW
  production-fanout-gate.ts                 # WIDENED: gate returns operator tuple; AutoApproveAllScriptsGate
  production-fanout-gate.test.ts            # WIDENED
  preproduction-chain.ts                    # WIDENED: composer assembles decision struct, parses gate output, asserts subset
  preproduction-chain.test.ts               # WIDENED
  build-pcd-identity-context.ts             # WIDENED: deepFreeze + treeBudget:null
  build-pcd-identity-context.test.ts        # WIDENED
  index.ts                                  # WIDENED: drop AutoApproveOnlyScriptGate, add new exports
  sp7-anti-patterns.test.ts                 # CLEANUP: dead `if` removed
  sp8-anti-patterns.test.ts                 # NEW: SP8-specific anti-pattern grep
  stages/
    stub-trends-stage-runner.ts             # WIDENED: STUB_TRENDS_FANOUT=2
    stub-trends-stage-runner.test.ts        # WIDENED
    stub-motivators-stage-runner.ts         # WIDENED: STUB_MOTIVATORS_PER_TREND=2
    stub-motivators-stage-runner.test.ts    # WIDENED
    stub-hooks-stage-runner.ts              # WIDENED: STUB_HOOKS_PER_MOTIVATOR=3
    stub-hooks-stage-runner.test.ts         # WIDENED
    stub-creator-scripts-stage-runner.ts    # WIDENED: STUB_SCRIPTS_PER_HOOK=2
    stub-creator-scripts-stage-runner.test.ts # WIDENED

packages/schemas/src/pcd-preproduction.ts   # WIDENED: tree budget, decision struct widening, .readonly() additions, gate operator-decision schema
packages/schemas/src/index.ts               # WIDENED: re-export new schemas + types
packages/creative-pipeline/src/index.ts     # WIDENED: re-export only what changes; SP7 barrel re-exports SP8's widened symbols transitively
```

### Boundary discipline

- **Composer-only version pinning.** All four pinned versions on `PcdProductionFanoutDecision` are filled by the composer from imports. Gate cannot forge them — its return type doesn't include them. SP8 anti-pattern grep enforces no `PCD_*_VERSION` literal in `production-fanout-gate.ts` source.
- **Composer-only identity carry-through.** `briefId`, `creatorIdentityId`, `productIdentityId`, `consentRecordId`, `effectiveTier` on the decision struct are filled by the composer from `brief` + `identityContext`. Structurally enforced — gate-return type doesn't include them.
- **Composer-only `decisionNote` and `costForecast`.** Both `null` in SP8; pinned by composer literal. Gate cannot pollute.
- **Runtime gate-output validation.** Composer parses gate return via `ProductionFanoutGateOperatorDecisionSchema.parse(raw)` inside `runStageWrapped`. Bad merge-back wire payload → `ZodError` raw → wrapped in `PreproductionChainError({ stage: "production_fanout_gate" })`.
- **Subset invariant.** Composer asserts `selectedScriptIds ⊆ availableScriptIds`. Violation → `InvariantViolationError` thrown inside `runStageWrapped` → wrapped in `PreproductionChainError`.
- **Defense-in-depth sort.** Both gate and composer sort the selection arrays ascending. Gate sorts (deterministic in-tree); composer re-sorts (defends against malicious or buggy merge-back gate that returns unsorted IDs).
- **Deep-frozen identity context.** `deepFreeze` recurses arrays + plain objects at runtime; `.readonly()` schema annotations enforce at TS compile time. Both layers active simultaneously — TS catches honest authors, runtime catches casted bypasses.
- **Heterogeneous stub fanout.** 2 trends → 4 motivators → 12 hooks → 24 scripts. Non-square, non-uniform. Cardinality bugs (squaring instead of multiplying, off-by-one tree-size assertions) are catchable.
- **Parent-ID propagation.** Each stub child ID carries its parent's full ID (`motivator-${parentTrendId}-N`), so any tree position can be reconstructed from a leaf script ID by string-suffix manipulation. Tests assert structural lineage.
- **No SP7 source mutation.** SP7 stage-runner interface signatures are unchanged. SP7 schema fields are unchanged (only widened, never narrowed or repurposed). SP7 composer body widens but the chain shape (5 stages → gate → return) is preserved verbatim. Pure helper functions inside `build-pcd-identity-context.ts` are unchanged. SP1–SP6 source bodies are zero-edit.

### Type-boundary discipline (`PcdIdentityContext` immutability — SP7 I-1 carry-over)

SP7 froze the context shallowly. SP8 closes the hole on two layers:

1. **Schema-level (`.readonly()`).** Every array field in `PcdIdentityContextSchema` (`allowedShotTypes`, `allowedOutputIntents`, `ugcStyleConstraints`) and the `tier3Rules` sub-object gain `.readonly()`. The inferred TS type is `readonly PcdShotType[]` etc. Stage-runner authors who write `ctx.allowedShotTypes.push(...)` get a TS error.

2. **Runtime (`deepFreeze`).** A new helper `deepFreeze<T>(obj: T): T` recurses through arrays and plain objects calling `Object.freeze` on each. `buildPcdIdentityContext` replaces `Object.freeze(context)` with `deepFreeze(context)`. Stage-runner authors who cast their way past the TS check (`(ctx as { allowedShotTypes: PcdShotType[] }).allowedShotTypes.push(...)`) get a runtime `TypeError` in strict mode.

`deepFreeze` skips primitives, `null`, and already-frozen values (idempotent). Tests assert depth-2 freezing of a populated context.

Selection arrays on `PcdProductionFanoutDecision` (`selectedScriptIds`, `availableScriptIds`) get the same `.readonly()` treatment for symmetry — same I-1 risk surface (a downstream consumer mutating the audit subject is the same hole). The composer constructs these arrays via `.slice().sort()` so the inputs are mutable arrays that get assigned to readonly fields (TS allows; runtime is fine because nothing mutates after assignment).

### Refusal vs. happy-path semantics (unchanged from SP7)

- `ZodError` from `PcdBriefInputSchema.parse` (in builder) — propagates raw.
- `ConsentRevokedRefusalError` from `assertConsentNotRevokedForGeneration` (in builder) — propagates raw.
- `InvariantViolationError` from any structural-integrity check (`product/creator not found` in builder, malformed `effectiveTier` post-tier-projection) — propagates raw.
- Stage-runner runtime errors → wrapped in `PreproductionChainError({ stage })`.
- Gate runtime errors, gate-output schema parse failure, gate-output subset-violation invariant — all wrapped in `PreproductionChainError({ stage: "production_fanout_gate" })`. (Three failure modes converge on the same wrapper because they all happen during the gate stage.)

PII bounds inherit from SP7: `PreproductionChainError` carries identifiers + stage names only; `cause` is non-enumerable so `JSON.stringify(err)` does not leak the original error content.

## Schema additions

### `PreproductionTreeBudgetSchema` (new)

```ts
export const PreproductionTreeBudgetSchema = z
  .object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
  })
  .readonly();
export type PreproductionTreeBudget = z.infer<typeof PreproductionTreeBudgetSchema>;
```

Both fields required when the budget exists. Both are `int().positive()` because zero or negative caps make no semantic sense. SP8 always emits `null` for the field on `PcdIdentityContext`. SP10 widens enforcement: composer reads `identityContext.treeBudget` (if non-null) and asserts after each stage that `output.length <= treeBudget.maxBranchFanout` and that the running tree size does not exceed `maxTreeSize`. Schema unchanged on widen — just enforcement.

### `PcdIdentityContextSchema` widening

```diff
 export const PcdIdentityContextSchema = z.object({
   creatorIdentityId: z.string().min(1),
   productIdentityId: z.string().min(1),
   consentRecordId: z.string().nullable(),

   effectiveTier: IdentityTierSchema,
   productTierAtResolution: IdentityTierSchema,
   creatorTierAtResolution: IdentityTierSchema,
-  allowedShotTypes: z.array(PcdShotTypeSchema),
-  allowedOutputIntents: z.array(OutputIntentSchema),
+  allowedShotTypes: z.array(PcdShotTypeSchema).readonly(),
+  allowedOutputIntents: z.array(OutputIntentSchema).readonly(),

-  tier3Rules: z.object({
+  tier3Rules: z
+    .object({
       firstLastFrameRequired: z.boolean(),
       performanceTransferRequired: z.boolean(),
       editOverRegenerateRequired: z.boolean(),
-  }),
+    })
+    .readonly(),

   voiceId: z.string().nullable(),
   productCanonicalText: z.string(),
   productHeroPackshotAssetId: z.string().nullable(),
   brandPositioningText: z.string().nullable(),

-  ugcStyleConstraints: z.array(UgcStyleConstraintSchema),
+  ugcStyleConstraints: z.array(UgcStyleConstraintSchema).readonly(),

   consentRevoked: z.boolean(),

+  // SP10 forward-compat: tree-budget enforcement is SP10's job.
+  // SP8 always emits null.
+  treeBudget: PreproductionTreeBudgetSchema.nullable(),

   identityContextVersion: z.string(),
 });
```

### `PcdProductionFanoutDecisionSchema` widening

```diff
 export const PcdProductionFanoutDecisionSchema = z.object({
   briefId: z.string().min(1),
   creatorIdentityId: z.string().min(1),
   productIdentityId: z.string().min(1),
   consentRecordId: z.string().nullable(),
   effectiveTier: IdentityTierSchema,

-  selectedScriptIds: z.array(z.string().min(1)).min(1),
-  availableScriptIds: z.array(z.string().min(1)).min(1),
+  selectedScriptIds: z.array(z.string().min(1)).min(1).readonly(),
+  availableScriptIds: z.array(z.string().min(1)).min(1).readonly(),

   preproductionChainVersion: z.string(),
   identityContextVersion: z.string(),
   approvalLifecycleVersion: z.string(),
+  preproductionFanoutVersion: z.string(),

   decidedAt: z.string().datetime(),
   decidedBy: z.string().nullable(),

+  // Q1 free-text seam — operator commentary at merge-back UX. SP8 always emits null.
+  decisionNote: z.string().nullable(),

   costForecast: PcdCostForecastSchema.nullable(),
 });
```

Field order: kept stable apart from inserting `preproductionFanoutVersion` adjacent to the other version fields and `decisionNote` adjacent to `decidedBy`.

### `ProductionFanoutGateOperatorDecisionSchema` (new)

```ts
export const ProductionFanoutGateOperatorDecisionSchema = z.object({
  selectedScriptIds: z.array(z.string().min(1)).min(1).readonly(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime(),
});
export type ProductionFanoutGateOperatorDecision = z.infer<
  typeof ProductionFanoutGateOperatorDecisionSchema
>;
```

This is the gate-return shape. The composer parses gate output via `.parse(raw)` to defend against bad merge-back Inngest payload. The schema does NOT include `briefId`, `creatorIdentityId`, `productIdentityId`, `consentRecordId`, `effectiveTier`, or any pinned-version field — the composer fills those from its own context. (`availableScriptIds` is also not in the gate's return; the composer derives it from `scripts.scripts.map(s => s.id).slice().sort()`.)

### Stage output schemas (SP7 — unchanged)

`TrendStageOutputSchema`, `MotivatorsStageOutputSchema`, `HooksStageOutputSchema`, `CreatorScriptsStageOutputSchema` are unchanged. Each carries a `.min(1)` array; SP7 stubs emitted length-1; SP8 stubs emit length-N. The schemas already accept length-N — that was the SP7 "forward-compat" choice. Same for `parent*Id` fields, which SP7 populated with the only-parent's ID and SP8 populates with each branch parent.

### Decision/result schema unchanged at the result-wrapper level

`PcdPreproductionChainResultSchema` is unchanged structurally — it still wraps `decision: PcdProductionFanoutDecisionSchema` and `stageOutputs: { trends, motivators, hooks, scripts }`. The widening is fully on `PcdProductionFanoutDecisionSchema`.

## Function contracts

### `deepFreeze<T>(obj: T): T` (new)

```ts
export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  const o = obj as unknown as Record<PropertyKey, unknown> | unknown[];
  if (Array.isArray(o)) {
    for (const item of o) deepFreeze(item);
  } else {
    for (const key of Object.keys(o)) deepFreeze(o[key]);
  }
  return Object.freeze(obj);
}
```

**Logic:**
1. Primitives + `null` → return as-is.
2. Already-frozen → return as-is (idempotency).
3. Recurse into array elements / object own-property values.
4. Freeze the outer container last.

PII bounds: `deepFreeze` does not log, reflect, or stringify the input. It does not throw. It is safe on user content.

Tests:
- Primitive input → returns input unchanged.
- Plain object with nested array → both outer and inner are frozen (`Object.isFrozen` true at each level).
- Plain object with nested object → both are frozen.
- Already-frozen input → returned as-is, no double-freeze error.
- Null → returns null.
- Array of primitives → frozen.
- Mixed nesting (`{ a: [{ b: { c: [1, 2] } }] }`) → all three levels frozen.

### `buildPcdIdentityContext` (widened)

Signature unchanged from SP7. Body changes:

1. (steps 1–6 unchanged from SP7)
2. **Step 7 widens:** the constructed `context` object includes `treeBudget: null` immediately before `identityContextVersion`.
3. **Step 8 widens:** `Object.freeze(context)` becomes `deepFreeze(context)`.

`// MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.` marker is unchanged in position.

### `runIdentityAwarePreproductionChain` (widened — composer)

Signature unchanged from SP7. Body changes (steps 1–5 unchanged):

```ts
// 6. Production fanout gate — gate returns narrow operator tuple; composer assembles.
const operatorDecision = await runStageWrapped("production_fanout_gate", async () => {
  const raw = await stores.productionFanoutGate.requestSelection({
    scripts: scripts.scripts,
    identityContext,
    briefId: brief.briefId,
    clock,
  });
  // Runtime defense for merge-back-time wire payload.
  const parsed = ProductionFanoutGateOperatorDecisionSchema.parse(raw);
  // Subset invariant — gate cannot select an unknown script id.
  const availableSet = new Set(scripts.scripts.map((s) => s.id));
  for (const id of parsed.selectedScriptIds) {
    if (!availableSet.has(id)) {
      throw new InvariantViolationError("gate selected unknown script id", {
        scriptId: id,
      });
    }
  }
  return parsed;
});
// MERGE-BACK: emit WorkTrace here at production fanout gate decision.

// 7. Composer assembles PcdProductionFanoutDecision — pins versions, identity carry-through.
const availableScriptIds = scripts.scripts.map((s) => s.id).slice().sort();
const selectedScriptIds = [...operatorDecision.selectedScriptIds].sort();

const decision: PcdProductionFanoutDecision = {
  briefId: brief.briefId,
  creatorIdentityId: identityContext.creatorIdentityId,
  productIdentityId: identityContext.productIdentityId,
  consentRecordId: identityContext.consentRecordId,
  effectiveTier: identityContext.effectiveTier,
  selectedScriptIds,
  availableScriptIds,
  preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
  approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  preproductionFanoutVersion: PCD_PREPRODUCTION_FANOUT_VERSION,
  decidedAt: operatorDecision.decidedAt,
  decidedBy: operatorDecision.decidedBy,
  decisionNote: null,
  costForecast: null,
};

// MERGE-BACK: wire UGC production handoff here.
return {
  decision,
  stageOutputs: { trends, motivators, hooks, scripts },
};
```

The previously-existing `// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload.` marker is widened to read `// MERGE-BACK: include all four pinned versions (chain, identity-context, approval-lifecycle, fanout) in WorkTrace decision payload.` Same position (near the version-pin import line).

The composer **must** literally call `productionFanoutGate.requestSelection(`, `ProductionFanoutGateOperatorDecisionSchema.parse(`, and reference all four `PCD_*_VERSION` constants. Anti-pattern grep tests enforce all four literals.

### `ProductionFanoutGate` adapter (return-type narrowing + new default)

```ts
export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<ProductionFanoutGateOperatorDecision>;
}

// MERGE-BACK: replace AutoApproveAllScriptsGate with Switchboard Inngest waitForEvent + dashboard UI.
export class AutoApproveAllScriptsGate implements ProductionFanoutGate {
  async requestSelection(input: RequestSelectionInput): Promise<ProductionFanoutGateOperatorDecision> {
    const ids = input.scripts.map((s) => s.id).slice().sort();
    return {
      selectedScriptIds: ids,
      decidedBy: null,
      decidedAt: input.clock().toISOString(),
    };
  }
}
```

`AutoApproveOnlyScriptGate` is **deleted** from the file and from the package barrel.

`AutoApproveAllScriptsGate` selects every available script and trusts the upstream `CreatorScriptsStageOutputSchema.scripts.min(1)` to ensure non-empty input. If the input is somehow zero-length, the gate returns an empty `selectedScriptIds`, the composer's `.parse(raw)` call against `ProductionFanoutGateOperatorDecisionSchema`'s `.min(1)` constraint throws `ZodError`, `runStageWrapped` wraps it as `PreproductionChainError({ stage: "production_fanout_gate" })`. The empty-input failure mode is caught structurally without the gate having to validate.

`RequestSelectionInput.clock` is preserved for the in-tree default. The merge-back Inngest-`waitForEvent`-backed gate uses the operator-event timestamp instead, ignoring the injected clock; same input shape, different time source. This is acceptable and intentional.

`RequestSelectionInput.scripts` is typed as mutable `CreatorScript[]` (not `readonly CreatorScript[]`). The gate may reorder or filter freely; defensive sort by gate + by composer covers either way.

### Stage runner interfaces (unchanged)

The four interface signatures from SP7 are unchanged. Stub implementers widen to length-N.

### Stub stage runner implementers (widened)

Each stub exports its fanout constant + the stub class.

```ts
// stages/stub-trends-stage-runner.ts
export const STUB_TRENDS_FANOUT = 2;

// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    const signals = Array.from({ length: STUB_TRENDS_FANOUT }, (_, i) => ({
      id: `trend-${brief.briefId}-${i + 1}`,
      summary: `Stub trend signal ${i + 1} for ${brief.productDescription}`,
      audienceFit: brief.targetAudience,
      evidenceRefs: [],
    }));
    return { signals };
  }
}
```

```ts
// stages/stub-motivators-stage-runner.ts
export const STUB_MOTIVATORS_PER_TREND = 2;

// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.
export class StubMotivatorsStageRunner implements MotivatorsStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput> {
    const motivators: Motivator[] = [];
    for (const trend of trends.signals) {
      for (let i = 1; i <= STUB_MOTIVATORS_PER_TREND; i++) {
        motivators.push({
          id: `motivator-${trend.id}-${i}`,
          frictionOrDesire: `Stub motivator ${i} linked to ${trend.id}`,
          audienceSegment: brief.targetAudience,
          evidenceRefs: [],
          parentTrendId: trend.id,
        });
      }
    }
    return { motivators };
  }
}
```

```ts
// stages/stub-hooks-stage-runner.ts
export const STUB_HOOKS_PER_MOTIVATOR = 3;
const STUB_HOOK_TYPE_ROTATION: PreproductionHookType[] = ["direct_camera", "mid_action", "reaction"];

// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.
export class StubHooksStageRunner implements HooksStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    _trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput> {
    const hooks: PreproductionHook[] = [];
    for (const motivator of motivators.motivators) {
      for (let i = 1; i <= STUB_HOOKS_PER_MOTIVATOR; i++) {
        hooks.push({
          id: `hook-${motivator.id}-${i}`,
          text: `Stub hook ${i} for ${brief.productDescription}`,
          hookType: STUB_HOOK_TYPE_ROTATION[(i - 1) % STUB_HOOK_TYPE_ROTATION.length]!,
          parentMotivatorId: motivator.id,
          parentTrendId: motivator.parentTrendId,
        });
      }
    }
    return { hooks };
  }
}
```

```ts
// stages/stub-creator-scripts-stage-runner.ts
export const STUB_SCRIPTS_PER_HOOK = 2;

// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.
export class StubCreatorScriptsStageRunner implements CreatorScriptsStageRunner {
  async run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    _trends: TrendStageOutput,
    _motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput> {
    const scripts: CreatorScript[] = [];
    for (const hook of hooks.hooks) {
      for (let i = 1; i <= STUB_SCRIPTS_PER_HOOK; i++) {
        scripts.push({
          id: `script-${hook.id}-${i}`,
          hookText: hook.text,
          creatorAngle: `first-person operator angle ${i}`,
          visualBeats: ["show the problem", "show the product moment", "show the result"],
          productMoment: `${brief.productDescription} solving the friction`,
          cta: `Try it (variant ${i})`,
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: identityContext.creatorIdentityId,
            productIdentityId: identityContext.productIdentityId,
            voiceId: identityContext.voiceId,
          },
          parentHookId: hook.id,
          scriptStyle: "talking_points",
          talkingPoints: [
            `Hook: ${hook.text}`,
            `Friction: stub motivator description ${i}`,
            `Outcome: ${brief.productDescription}`,
          ],
        });
      }
    }
    return { scripts };
  }
}
```

Stubs do not call Claude. Stubs are deterministic functions of input. Each stub's output schema is validated in the co-located test (`Schema.parse(returned)` succeeds). Each stub's parent-ID propagation is asserted (each child's `parent*Id` matches a real parent in the upstream stage).

## Injected interfaces

Unchanged from SP7. `PreproductionChainStores` carries the same store bundle. The four stage-runner interface signatures are unchanged. `RequestSelectionInput` is unchanged structurally; `requestSelection` return type narrows from `Promise<PcdProductionFanoutDecision>` to `Promise<ProductionFanoutGateOperatorDecision>`.

## Version constants

```ts
// packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts
export const PCD_PREPRODUCTION_FANOUT_VERSION = "preproduction-fanout@1.0.0";
```

| Function / Struct | Pinned constants |
|---|---|
| `buildPcdIdentityContext` | `PCD_IDENTITY_CONTEXT_VERSION` |
| `runIdentityAwarePreproductionChain` | `PCD_PREPRODUCTION_CHAIN_VERSION`, `PCD_IDENTITY_CONTEXT_VERSION`, `PCD_APPROVAL_LIFECYCLE_VERSION`, `PCD_PREPRODUCTION_FANOUT_VERSION` (all four pinned via decision struct assembly) |
| `PcdProductionFanoutDecision.preproductionChainVersion` | `PCD_PREPRODUCTION_CHAIN_VERSION` |
| `PcdProductionFanoutDecision.identityContextVersion` | `PCD_IDENTITY_CONTEXT_VERSION` |
| `PcdProductionFanoutDecision.approvalLifecycleVersion` | `PCD_APPROVAL_LIFECYCLE_VERSION` |
| `PcdProductionFanoutDecision.preproductionFanoutVersion` | `PCD_PREPRODUCTION_FANOUT_VERSION` (new) |

Eleven pinned constants total in the PCD slice after SP8. Ten existed pre-SP8: `PCD_TIER_POLICY_VERSION` (SP2), `PCD_SHOT_SPEC_VERSION` (SP3), `PCD_PROVIDER_CAPABILITY_VERSION` (SP4), `PCD_PROVIDER_ROUTER_VERSION` (SP4), `PCD_QC_EVALUATION_VERSION` (SP5), `PCD_QC_GATE_MATRIX_VERSION` (SP5), `PCD_APPROVAL_LIFECYCLE_VERSION` (SP6), `PCD_CONSENT_REVOCATION_VERSION` (SP6), `PCD_PREPRODUCTION_CHAIN_VERSION` (SP7), `PCD_IDENTITY_CONTEXT_VERSION` (SP7). SP8 adds one: `PCD_PREPRODUCTION_FANOUT_VERSION`.

## Errors

### `PreproductionChainError` (unchanged from SP7)

Constructor + fields unchanged. SP8 introduces three new ways for the gate stage to fail (gate runtime error, schema parse failure on gate output, subset-invariant violation), but all three converge on the same wrapper via `runStageWrapped`.

### Existing error classes (re-used, unmodified)

- `ConsentRevokedRefusalError` (SP6) — propagates raw from `assertConsentNotRevokedForGeneration`.
- `InvariantViolationError` — thrown by structural checks, including the new SP8 subset-invariant check inside the gate `runStageWrapped`. The raw throw becomes `PreproductionChainError({ stage: "production_fanout_gate", cause })` because it happens inside the wrapper.

## Testing strategy

### Per-function invariant tests

Co-located `*.test.ts` for each new and widened source file.

**`deep-freeze.test.ts` (new):**

D1. Primitive input (`5`, `"x"`, `true`, `null`) → returns input unchanged.
D2. Empty plain object → frozen.
D3. Empty array → frozen.
D4. Plain object with primitives → outer frozen.
D5. Nested plain object → outer + inner frozen.
D6. Plain object with nested array → outer + inner frozen.
D7. Array of plain objects → outer + each element frozen.
D8. Mixed `{ a: [{ b: { c: [1, 2] } }] }` → all four nesting levels frozen.
D9. Already-frozen input → returned as-is, no double-freeze throw.
D10. Idempotency: `deepFreeze(deepFreeze(x)) === deepFreeze(x)`.

**`preproduction-fanout-version.test.ts` (new):**

V1. `PCD_PREPRODUCTION_FANOUT_VERSION === "preproduction-fanout@1.0.0"`.

**`build-pcd-identity-context.test.ts` (widened — adds to SP7 cases):**

B1–B11. (SP7 cases retained, asserting unchanged behavior.)
B12. Returned context is **deep-frozen**: `Object.isFrozen(ctx)` true; `Object.isFrozen(ctx.allowedShotTypes)` true; `Object.isFrozen(ctx.allowedOutputIntents)` true; `Object.isFrozen(ctx.ugcStyleConstraints)` true; `Object.isFrozen(ctx.tier3Rules)` true.
B13. `ctx.treeBudget === null` always in SP8.
B14. Mutation-via-cast on `(ctx as { allowedShotTypes: PcdShotType[] }).allowedShotTypes.push(...)` throws `TypeError` in strict mode.

**`production-fanout-gate.test.ts` (widened — full rewrite of the gate cases):**

G1. `AutoApproveAllScriptsGate.requestSelection` with one script → returns `{ selectedScriptIds: [theId], decidedBy: null, decidedAt: clock().toISOString() }`.
G2. With three scripts → returns sorted `selectedScriptIds` of length 3, `decidedBy: null`, `decidedAt: clock().toISOString()`.
G3. With unsorted input scripts (IDs `["c", "a", "b"]`) → returns `["a", "b", "c"]`.
G4. Returned shape parses cleanly via `ProductionFanoutGateOperatorDecisionSchema.parse`.
G5. **Gate return does NOT include `briefId`, `creatorIdentityId`, `productIdentityId`, `consentRecordId`, `effectiveTier`, or any pinned-version field** (structural — gate-return type doesn't include them; test asserts via `Object.keys(returned).sort()` deep-equal to `["decidedAt", "decidedBy", "selectedScriptIds"]`).
G6. Empty input scripts (`[]`) → gate returns `{ selectedScriptIds: [], decidedBy: null, decidedAt: ... }`. (NOT the gate's job to throw on empty — schema parse upstream catches it.)
G7. `ProductionFanoutGateOperatorDecisionSchema.parse({ selectedScriptIds: [], decidedBy: null, decidedAt: ... })` throws `ZodError` (the `.min(1)` enforcement check).

**`preproduction-chain.test.ts` (widened — full rewrite of length-1 assumptions; SP7's 17 cases evolve to 22):**

C1. Happy path with stubs → returns `{ decision, stageOutputs }` with all stages populated. Stage outputs match heterogeneous fanout: trends.signals.length === 2, motivators.motivators.length === 4, hooks.hooks.length === 12, scripts.scripts.length === 24.
C2. Stages called in fixed order: trends, motivators, hooks, creator_scripts (assert via call-recording stubs).
C3. `buildPcdIdentityContext` throws `ConsentRevokedRefusalError` → propagates raw (not wrapped).
C4. `buildPcdIdentityContext` throws `InvariantViolationError` → propagates raw.
C5. Trends runner throws → wrapped in `PreproductionChainError({ stage: "trends" })`. Cause preserved.
C6. Motivators runner throws → wrapped with `stage: "motivators"`.
C7. Hooks runner throws → wrapped with `stage: "hooks"`.
C8. Creator scripts runner throws → wrapped with `stage: "creator_scripts"`.
C9. Production fanout gate throws → wrapped with `stage: "production_fanout_gate"`.
C10. Wrapped error preserves `cause`.
C11. **Decision carries all four pinned versions:**
   - `decision.preproductionChainVersion === PCD_PREPRODUCTION_CHAIN_VERSION`
   - `decision.identityContextVersion === PCD_IDENTITY_CONTEXT_VERSION`
   - `decision.approvalLifecycleVersion === PCD_APPROVAL_LIFECYCLE_VERSION`
   - `decision.preproductionFanoutVersion === PCD_PREPRODUCTION_FANOUT_VERSION`
C12. **Composer-only version pinning (forensic-integrity test):** swap in a malicious gate that returns `decidedBy: "attacker"` + `selectedScriptIds: [knownId]` + a fabricated `decidedAt`; the composer-assembled decision's four `*Version` fields still match the import constants exactly. (Gate's return type doesn't include version fields, so the gate cannot even attempt this — but the test asserts the composer assembles them correctly regardless of what the gate said.)
C13. **Composer-only identity carry-through:** swap in a gate that the test verifies cannot pollute `briefId` / `creatorIdentityId` / `productIdentityId` / `consentRecordId` / `effectiveTier` (structural — same reasoning as C12).
C14. Decision `decidedAt` flows from gate's return (NOT from composer's clock). Test: gate returns `decidedAt: "2030-01-01T00:00:00.000Z"`; decision's `decidedAt` matches.
C15. Decision `decidedBy === null` when default `AutoApproveAllScriptsGate` is used.
C16. Decision `decisionNote === null` always in SP8.
C17. Decision `costForecast === null` always in SP8.
C18. `selectedScriptIds` and `availableScriptIds` are sorted ascending.
C19. `selectedScriptIds.length === 24` and `availableScriptIds.length === 24` and they are equal arrays under default `AutoApproveAllScriptsGate`.
C20. Identity context flows verbatim through every stage runner (reference equality via spy stubs).
C21. **Subset invariant:** swap in a gate that returns `selectedScriptIds: ["unknown-script-id"]` → composer throws `InvariantViolationError("gate selected unknown script id", { scriptId: "unknown-script-id" })`, wrapped in `PreproductionChainError({ stage: "production_fanout_gate" })`.
C22. **Gate output schema parse failure:** swap in a gate that returns malformed shape (e.g. `decidedAt: "not-a-datetime"`) → composer throws `ZodError` wrapped in `PreproductionChainError({ stage: "production_fanout_gate" })`.
C23. **Defensive composer sort:** swap in a gate that returns unsorted `selectedScriptIds: ["c", "a", "b"]` → composer's decision.selectedScriptIds is `["a", "b", "c"]`.
C24. **Tree shape lineage:** for the heterogeneous-fanout happy path, every motivator's `parentTrendId` matches a real trend; every hook's `parentMotivatorId` matches a real motivator; every script's `parentHookId` matches a real hook. (Joinability test.)

**`stub-trends-stage-runner.test.ts` (widened):**

S1. Returns `STUB_TRENDS_FANOUT` (= 2) signals.
S2. IDs follow `trend-${briefId}-1` and `trend-${briefId}-2` shape.
S3. Output schema validates.
S4. Different `briefId` produces different IDs (mechanical determinism).
S5. Same `briefId` produces same IDs (idempotency).

**`stub-motivators-stage-runner.test.ts` (widened):**

S6. Returns `trends.signals.length × STUB_MOTIVATORS_PER_TREND` motivators (e.g., 2 × 2 = 4).
S7. Each motivator's `parentTrendId` matches a real trend ID from the input.
S8. ID shape: `motivator-${parentTrendId}-1` and `motivator-${parentTrendId}-2`.
S9. Output schema validates.

**`stub-hooks-stage-runner.test.ts` (widened):**

S10. Returns `motivators.motivators.length × STUB_HOOKS_PER_MOTIVATOR` hooks (e.g., 4 × 3 = 12).
S11. Each hook's `parentMotivatorId` matches a real motivator ID.
S12. Each hook's `parentTrendId` matches the `parentTrendId` of its parent motivator (transitive lineage).
S13. ID shape: `hook-${parentMotivatorId}-1`, `hook-${parentMotivatorId}-2`, `hook-${parentMotivatorId}-3`.
S14. Hook types rotate `["direct_camera", "mid_action", "reaction"]` across the three children of one motivator.
S15. Output schema validates.

**`stub-creator-scripts-stage-runner.test.ts` (widened):**

S16. Returns `hooks.hooks.length × STUB_SCRIPTS_PER_HOOK` scripts (e.g., 12 × 2 = 24).
S17. Each script's `parentHookId` matches a real hook ID.
S18. ID shape: `script-${parentHookId}-1`, `script-${parentHookId}-2`.
S19. Each script's `identityConstraints.creatorIdentityId` matches `identityContext.creatorIdentityId`.
S20. Each script's `identityConstraints.voiceId` matches `identityContext.voiceId`.
S21. Output schema validates (discriminator `talking_points` round-trips).

### Anti-pattern grep tests

#### `sp7-anti-patterns.test.ts` (cleanup only)

Remove the dead `if (file.endsWith("sp7-anti-patterns.test.ts")) continue;` skip on line 99. Line 17's `.test.ts` filter already prevents test files from entering the source-walk. No other changes to SP7's anti-pattern test.

#### `sp8-anti-patterns.test.ts` (new — siblings to SP7's file)

The new test inlines its own `listSp7AndSp8SourceFiles()` walker that includes the same `pcd/preproduction/` subdir.

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PREPRODUCTION_DIR = join(import.meta.dirname);

function listSourceFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".test.ts")) continue;
      if (!full.endsWith(".ts")) continue;
      out.push(full);
    }
  }
  walk(PREPRODUCTION_DIR);
  return out;
}

function readCodeOnly(file: string): string {
  const src = readFileSync(file, "utf8");
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const allSources = listSourceFiles();

describe("SP8 anti-pattern grep", () => {
  it("no PCD_*_VERSION literal in production-fanout-gate.ts (composer-only pinning)", () => {
    const path = join(PREPRODUCTION_DIR, "production-fanout-gate.ts");
    const code = readCodeOnly(path);
    expect(code).not.toMatch(/PCD_PREPRODUCTION_CHAIN_VERSION/);
    expect(code).not.toMatch(/PCD_IDENTITY_CONTEXT_VERSION/);
    expect(code).not.toMatch(/PCD_APPROVAL_LIFECYCLE_VERSION/);
    expect(code).not.toMatch(/PCD_PREPRODUCTION_FANOUT_VERSION/);
  });

  it("composer references all four pinned versions", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("PCD_PREPRODUCTION_CHAIN_VERSION");
    expect(src).toContain("PCD_IDENTITY_CONTEXT_VERSION");
    expect(src).toContain("PCD_APPROVAL_LIFECYCLE_VERSION");
    expect(src).toContain("PCD_PREPRODUCTION_FANOUT_VERSION");
  });

  it("composer literally calls ProductionFanoutGateOperatorDecisionSchema.parse", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("ProductionFanoutGateOperatorDecisionSchema.parse(");
  });

  it("AutoApproveOnlyScriptGate is fully removed", () => {
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} still references AutoApproveOnlyScriptGate`).not.toMatch(
        /AutoApproveOnlyScriptGate/,
      );
    }
  });
});
```

The "no `if (stage ===`" / "no `prisma.`" / "no `ApprovalLifecycle` import" / forbidden-imports rules are enforced once by `sp7-anti-patterns.test.ts` across the whole `pcd/preproduction/` subdir (which now includes SP8 files). SP8 files inherit those rules without re-asserting.

### Determinism / clock injection (unchanged from SP7)

Every test that asserts on `decidedAt` injects a fixed clock:

```ts
const fixedClock = () => new Date("2026-04-30T12:00:00.000Z");
const result = await runIdentityAwarePreproductionChain(brief, {
  ...stores,
  clock: fixedClock,
});
expect(result.decision.decidedAt).toBe("2026-04-30T12:00:00.000Z");
```

The composer passes the clock to the gate; the in-tree default `AutoApproveAllScriptsGate` uses it via `input.clock().toISOString()`; the merge-back Inngest gate ignores it and uses event timestamp.

### PII bounds (unchanged from SP7)

- `PreproductionChainError.cause` is non-enumerable. `JSON.stringify(err)` reveals only `name` + `stage`.
- `PcdIdentityContext` carries identifiers + tier integers + registry-owned text only.
- `PcdProductionFanoutDecision` carries IDs + versions + timestamps + `decisionNote: null` (in SP8). No script content, no brief content. Forensic-clean.

## SP1–SP7 invariant inheritance

| Existing invariant | SP8 enforcement |
|---|---|
| **SP3 store-injected purity** | Maintained. SP8 adds no Prisma access. |
| **SP4 declarative dispatch** | Maintained. No `if (stage ===`, `if (effectiveTier ===`, `if (shotType ===`, `if (intent ===` in any SP8 source. |
| **SP4 version-pin discipline** | **Hardened.** SP7 had the gate pinning versions; SP8 moves pinning to the composer + structurally prevents the gate from forging by removing version fields from the gate-return type. Anti-pattern test enforces no `PCD_*_VERSION` literal in `production-fanout-gate.ts`. |
| **SP5 matrix-driven dispatch** | Maintained. No new tier-/shot-/intent-keyed dispatch in SP8 source. |
| **SP6 adapter-with-default seam** | Maintained. `ProductionFanoutGate` still uses the adapter-with-default pattern; default class swaps name (`AutoApproveOnlyScriptGate` → `AutoApproveAllScriptsGate`). Anti-pattern test asserts the seam is genuinely called. |
| **SP6 collect-all refusal-reason discipline** | Not applicable to SP8 — gate is prioritization, not blocking (Q1 lock). The structurally similar surface (subset-invariant violation) collects via `InvariantViolationError.context`, not via a refusal-reason enum. |
| **SP6 forbidden-imports per source file** | Maintained verbatim. Same five forbidden tokens. |
| **SP7 single-script invariant** | **Removed (intentionally).** SP8 IS the branching world; the bridge guard from SP7 (`AutoApproveOnlyScriptGate` requiring exactly one script) is no longer needed. |
| **SP7 PII bounds (refusal payloads carry IDs only)** | Maintained. `PreproductionChainError.cause` is still non-enumerable. Decision struct carries no creative content. |
| **SP7 immutable identity context (Object.freeze)** | **Hardened.** Shallow `Object.freeze` is replaced by recursive `deepFreeze`; arrays + sub-objects also gain `.readonly()` schema annotations for compile-time TS guard. |
| **SP7 anti-pattern grep + forbidden-imports per source file** | Maintained verbatim across the now-widened `pcd/preproduction/` subdir. SP8 adds three new structural assertions; SP7's existing assertions continue to apply. |

## Merge-back surface

SP8 changes one existing marker (the `AutoApproveOnlyScriptGate` → `AutoApproveAllScriptsGate` rename) and widens the text of one (the chain-version WorkTrace marker → all four pinned versions). No new MERGE-BACK markers added; no markers removed. SP7's 13-marker total carries through unchanged in count.

| # | File | Marker text after SP8 | Resolution at merge-back |
|---|---|---|---|
| 1 | `build-pcd-identity-context.ts` | `// MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.` | Unchanged. |
| 2 | `preproduction-chain.ts` (after trends runner) | `// MERGE-BACK: emit WorkTrace here after trends stage returns.` | Unchanged. |
| 3 | `preproduction-chain.ts` (after motivators runner) | `// MERGE-BACK: emit WorkTrace here after motivators stage returns.` | Unchanged. |
| 4 | `preproduction-chain.ts` (after hooks runner) | `// MERGE-BACK: emit WorkTrace here after hooks stage returns.` | Unchanged. |
| 5 | `preproduction-chain.ts` (after creator scripts runner) | `// MERGE-BACK: emit WorkTrace here after creator scripts stage returns.` | Unchanged. |
| 6 | `production-fanout-gate.ts` (on `AutoApproveAllScriptsGate`) | `// MERGE-BACK: replace AutoApproveAllScriptsGate with Switchboard Inngest waitForEvent + dashboard UI.` | **Class rename only; same merge-back resolution.** Inngest `waitForEvent` adapter consumes operator-event payload; populates `selectedScriptIds`, `decidedBy`, `decidedAt` from the payload. Composer assembles the rest. |
| 7 | `preproduction-chain.ts` (after composer assembles decision) | `// MERGE-BACK: emit WorkTrace here at production fanout gate decision.` | Unchanged. |
| 8 | `preproduction-chain.ts` (return statement) | `// MERGE-BACK: wire UGC production handoff here.` | Unchanged. |
| 9 | `stub-trends-stage-runner.ts` | `// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.` | Unchanged. |
| 10 | `stub-motivators-stage-runner.ts` | `// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.` | Unchanged. |
| 11 | `stub-hooks-stage-runner.ts` | `// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.` | Unchanged. |
| 12 | `stub-creator-scripts-stage-runner.ts` | `// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.` | Unchanged. |
| 13 | `preproduction-chain.ts` (version-pinning import block) | `// MERGE-BACK: include all four pinned versions (chain, identity-context, approval-lifecycle, fanout) in WorkTrace decision payload.` | **Text widened** to mention four versions. Switchboard's WorkTrace emit includes all four pinned versions verbatim. |

### Stub-strategy summary

Unchanged from SP7. Stubs are deterministic black boxes producing canned length-N (now non-trivially N) outputs. Replaced at merge-back by Switchboard's Claude-driven runners. The default `AutoApproveAllScriptsGate` is replaced by the Inngest-`waitForEvent`-backed implementer.

### Stored row reconciliation at merge-back

- **No new tables.** SP8 ships zod schemas only. No Prisma migration.
- **No column additions.** All schema widenings are zod-only on `PcdIdentityContext` and `PcdProductionFanoutDecision`, both of which are in-memory orchestration types (not Prisma rows).
- **Existing column adequacy.** `PcdIdentitySnapshot.consentRecordId` (SP1) and `AssetRecord.consentRevokedAfterGeneration` (SP6) remain sufficient for SP8's purposes (SP8 doesn't write to the snapshot).

## Acceptance criteria

SP8 is locally complete when:

- ✅ `PcdIdentityContext` is **deep-frozen** and arrays/sub-objects are `.readonly()` typed; mutation attempts fail at TS compile time AND at runtime.
- ✅ `PcdIdentityContext.treeBudget: PreproductionTreeBudget | null` ships; SP8 builder always emits `null`.
- ✅ `PcdProductionFanoutDecision.preproductionFanoutVersion` ships; pinned by composer from import.
- ✅ `PcdProductionFanoutDecision.decisionNote: string | null` ships; SP8 composer always emits `null`.
- ✅ `ProductionFanoutGate.requestSelection` returns the narrow `ProductionFanoutGateOperatorDecision` tuple; composer parses it via `Schema.parse(raw)` and assembles the full decision struct itself.
- ✅ Composer pins all four `*Version` fields from imports; gate cannot forge them (gate-return type doesn't include them).
- ✅ Composer asserts `selectedScriptIds ⊆ availableScriptIds` after gate return.
- ✅ Both selection arrays are sorted ascending in the composer's assembled decision.
- ✅ `AutoApproveOnlyScriptGate` is deleted; `AutoApproveAllScriptsGate` is the new default; selects every available script.
- ✅ Stub stage runners produce heterogeneous fanout via exported constants: `STUB_TRENDS_FANOUT = 2`, `STUB_MOTIVATORS_PER_TREND = 2`, `STUB_HOOKS_PER_MOTIVATOR = 3`, `STUB_SCRIPTS_PER_HOOK = 2`. Stub IDs propagate parent IDs structurally.
- ✅ The chain happy path produces 24 scripts; auto-approve-all selects all 24; decision struct's `selectedScriptIds.length === 24`.
- ✅ Anti-pattern grep tests enforce: no `PCD_*_VERSION` literal in gate source; composer references all four version constants; composer literally calls the parse function; `AutoApproveOnlyScriptGate` is fully removed from source.
- ✅ Dead `if` skip in `sp7-anti-patterns.test.ts` is removed.
- ✅ `// MERGE-BACK:` marker count unchanged at 13; one renamed-class-marker, one widened-text marker.
- ✅ All schema additions are zod-only. No Prisma migration. No `apps/api` wiring.
- ✅ Zero edits to SP1–SP6 source bodies. No edits to SP7 pure functions (mappers, projectors, `runStageWrapped`, the four interface signatures).
- ✅ All tests green (typecheck + vitest + `pnpm exec prettier --check`); the SP5-baseline two prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` carry through.

## What's deliberately out of scope

- **Per-stage tier validators.** Q7=A (SP7 inheritance). Future slice.
- **Tree-budget enforcement.** SP10. SP8 ships the schema field; SP10 enforces.
- **Cost forecast computation.** SP10.
- **Real Claude-driven stage runners.** Merge-back.
- **Real human-approval gate UX.** Merge-back.
- **Production handoff envelope.** SP7's `// MERGE-BACK: wire UGC production handoff here.` marker is unchanged. Caller composes.
- **Performance back-flow.** SP10+.
- **Creative-source provenance fields on `PcdIdentitySnapshot`.** SP9 / SP12 territory.
- **`apps/api` HTTP routes, Inngest functions, `PlatformIngress` integration.**
- **Real `WorkTrace` emit, real approval / export lifecycle wiring.** Markers only.
- **Refusal-reason enum on `PcdProductionFanoutDecision` (Q1=B locked).** Decision is selection-only.
- **Per-script `decisionTags` on the decision struct (Q1 option C rejected).**
- **Nested-tree `stageOutputs` shape (Q3=A locked).** Flat lists with parent IDs.
- **`targetFanout` parameter on stage-runner `run()` (Q5=B locked).** Stub fanout is hardcoded.
- **Sibling `pcd/preproduction-tree/` subdir (Q6=A locked).** Extend existing subdir.
- **SP1–SP6 source body changes.** Zero edits.
- **SP7 pure-function source changes.** Zero edits to mappers / projectors / `runStageWrapped` / interface signatures.

## Non-obvious conclusions

- **Branching tree state is not a new architecture; it is a widening of SP7's primitives.** Stage-runner interfaces are unchanged. Schema fields for parent-ID lineage are already present from SP7. The chain shape is unchanged. What SP8 changes structurally is (a) the gate return contract and (b) the identity-context immutability layer. Everything else is widening of existing widenable pieces (stubs that emit length-1 → length-N; schema fields that are already nullable-or-optional → populated for real; arrays that were lazily mutable → readonly + frozen). The smallness of SP8 relative to SP7 is intentional and is the whole point of SP7's forward-compat design.
- **Pinning all forensic versions in the composer, not the gate, is the structural form of the SP4 invariant ("caller cannot override pinned versions").** SP7 implemented it correctly in the in-tree default gate, but the contract surface accepted any string. A merge-back Inngest gate could pull versions off an operator-event payload and the schema would not catch it. SP8 closes this by removing version fields from the gate-return shape entirely. The gate is structurally incapable of forging versions; it can only return what an operator decided. The composer assembles.
- **`AutoApproveAllScriptsGate` is a real product call, not a fixture.** The merge-back-time human gate UX will let an operator deselect scripts; the in-tree default is "select all" because it's the closest deterministic stand-in for "the operator approves everything in front of them." Tests use this default for happy-path; tests for partial selection use a fixture-injected gate that returns a subset.
- **Heterogeneous stub fanout (2-2-3-2) is a test-quality choice, not a product call.** Square fanout (`N × N × N × N`) silently passes when the implementation accidentally squares: 3 motivators per trend × 3 trends = 9 motivators, but a buggy implementation might produce 3 × 3 = 9 motivators per trend, producing 27 total — and a uniform-N test would still see 27 = 3³ and might pass an "exact fanout" assertion if not careful. Heterogeneous numbers (2 trends × 2 motivators per trend × 3 hooks per motivator × 2 scripts per hook = 24 scripts) only multiply correctly under one specific cardinality story; any other story produces a different total. The number 24 is the canary.
- **`treeBudget` lives on `PcdIdentityContext` despite the type's name.** `PcdIdentityContext` is a misnomer for what it carries — it already holds tier rules, UGC style constraints, and tier-derived projections, none of which are pure identity. The pragmatic name for the carrier would be `PcdPreproductionContext`, but renaming would be a SP1–SP7 source body change to multiple files. Keeping the existing name and treating it as the per-job pre-stage immutable substrate (which is what it actually is) is the right call.
- **The composer's runtime parse of gate output (`ProductionFanoutGateOperatorDecisionSchema.parse(raw)`) looks like overkill for in-tree usage but is necessary at merge-back.** The merge-back Inngest gate consumes operator-event payload from the wire; that payload is untrusted input by definition. Validating at the composer means SP8 already has the parse seam in place — merge-back doesn't have to add it later. Cost in SP8: one extra function call per chain run. Benefit at merge-back: zero retrofitting required.
- **SP8 does not need a refusal-reason taxonomy on the decision struct, because the SP6 taxonomy is for legal-blocking gates.** SP6's `PcdLifecycleRefusalReason` enum exists because final-export must be auditable against legal/safety rules ("approved with revoked consent" can only happen via legal override; the audit log must say so). SP8's gate is a budget-prioritization gate — the operator's reasons are preference, not legal record. The two arrays (`selectedScriptIds`, `availableScriptIds`) carry the audit fact ("12 available, 4 selected"); a free-text `decisionNote: string | null` carries any operator commentary. Importing the SP6 enum here would be premature coupling.
- **Subset invariant + parse failure + gate runtime error all collapse to the same `PreproductionChainError` wrapper.** This is a deliberate convergence. The composer doesn't distinguish between "the gate threw", "the gate returned malformed data", and "the gate selected a script that doesn't exist" because all three are "the gate stage failed." Downstream consumers of `PreproductionChainError` see `stage: "production_fanout_gate"` and treat the failure uniformly. The original `cause` is preserved on the wrapper for forensic depth without requiring downstream consumers to fan out their handling.
- **Eleven pinned constants is a feature, not a code smell.** Each pin captures a separable forensic dimension: tier policy, shot spec, provider capability, provider router, QC evaluation, QC matrix, approval lifecycle, consent revocation, preproduction chain, identity context, preproduction fanout. WorkTrace audit at merge-back will carry all eleven; downstream consumers (legal review, regulator response, model-version reproducibility) can answer questions like "what was the QC matrix at the time this asset was approved?" by reading one field. Conflating multiple dimensions into one bumped version (e.g., bumping `PCD_PREPRODUCTION_CHAIN_VERSION` to `2.0.0` to capture SP8's changes) would lose that separability for no real gain.
