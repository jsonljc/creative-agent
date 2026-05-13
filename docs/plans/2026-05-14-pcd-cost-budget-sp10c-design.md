# SP10C — Cost-Budget Enforcement (Design)

**Slice:** PCD vertical SP10C
**Date:** 2026-05-14
**Status:** Design — awaiting plan + implementation
**Predecessor:** SP10B (tree-budget enforcement, squash `6ddd736`, PR #10)
**Successor (none planned):** the SP10 trilogy completes with SP10C; future enforcement work (mid-chain decorators, resumable runs, multi-currency) is unscoped.

---

## 0. User-accepted risks

These were named, weighed, and accepted during brainstorming. They are scope locks. Future readers (especially merge-back implementers) should treat them as load-bearing.

1. **Coarse pre-routing estimator is provably less accurate than SP10A's per-asset routed estimator.** At gate time, the chain has produced N scripts but no script has been routed to a provider/model. The coarse estimator works from `{briefId, identityContext, scriptCount}` and produces a worst-case-or-average estimate over the provider-capability matrix. **Why accepted:** a gate-time forecast IS the SP10C deliverable; waiting for routing means giving up the gate (and producing 100s of routed assets before SP10A stamping reveals the bill). Operator-facing dashboards at merge-back should label the estimate as "pre-routing forecast" and surface the SP10A per-asset stamps as the canonical post-hoc cost record.

2. **identityContext is built twice on the SP10C-gated success path.** SP10C orchestrator calls `buildPcdIdentityContext` at entry (to feed the coarse estimator). It then calls SP10B, which calls SP7's chain, which calls `buildPcdIdentityContext` internally. Two builds per gated chain run. **Why accepted:** building is pure registry reads (no LLM, no chain compute). Threading identityContext through SP7's chain return would require editing SP7 (guardrail #2 — forbidden). **Mitigation:** merge-back-time refactor may widen SP7's chain return to include identityContext; SP10C's estimator call site is a one-line swap if that lands. Documented as a known surface at §8.

3. **SP10C does NOT populate `PcdProductionFanoutDecision.costForecast`.** The SP7 forward-declared slot stays `null`. Populating it would require editing SP7's composer body (forbidden). Cost data flows through SP10C's outcome wrapper (`RunPreproductionChainWithCostBudgetOutcome.costMeta`) instead. **Consequence:** in-tree, the `decision.costForecast` slot is dead — read by zero consumers. At merge-back, Switchboard may either (a) leave the slot null and consume `costMeta` instead, or (b) widen SP7's composer to thread costMeta into the decision struct. SP10C does not lock the choice.

4. **`StubCoarseCostEstimator` defaults are operator-arbitrary.** The stub returns a deterministic `$1.50 × scriptCount` (or similar loud-stub value with no merge-back claim of realism). Real per-tier, per-shot-type pricing tables are a Switchboard ad-optimizer concern. **Why accepted:** mirrors SP10A `StubCostEstimator` and SP10B `StaticDefaultBudgetReader` precedent — loud-stub values are clearer than fake-realism.

5. **No Prisma migration; no per-asset persistence change.** SP10C is pure orchestration. A successful cost gate is silent (chain proceeds; SP10A/SP9/SP4 per-asset stamping unchanged). A failed cost gate throws before any per-asset write — there is no row to stamp. Forensic trail at merge-back lives in WorkTrace via `// MERGE-BACK: emit WorkTrace here` markers. Per-asset cost stamps continue to come from SP10A at fanout-write time; SP10C's gate-time estimate is recorded only in WorkTrace + outcome wrapper.

6. **`Sp10bBudgetReader` is reused; no new reader contract.** SP10B's reader already returns `PreproductionTreeBudget` which already carries `maxEstimatedUsd: number | null`. SP10C consumes the same contract and reads the same field. **Why accepted:** prevents a parallel reader surface for the same `OrganizationBudget` Prisma table at merge-back. One reader, one schema slot, one budget.

7. **Refused-decision (return value) refusal semantics rejected; throw is the only path.** Same precedent as SP10B (and SP6's lifecycle-state vs. configuration-error distinction). Operator either raises `maxEstimatedUsd` or trims the brief and retries.

8. **No edits to SP10B orchestrator body.** Guardrail #2 (no edits to SP1–SP10B source bodies). SP10C ships a parallel top-level orchestrator that COMPOSES SP10B's `runIdentityAwarePreproductionChainWithBudget` by calling it with a count-only budget (i.e. `{...budget, maxEstimatedUsd: null}`). SP10B's count-only invariant is preserved structurally: SP10B sees a stripped budget and its `maxEstimatedUsd === null` assertion holds.

9. **3-way SP4/SP9/SP10A invariant lock-step does NOT extend to SP10C.** SP10C is chain-level (like SP10B), not per-asset. It does not call `assertTier3RoutingDecisionCompliant` and does not persist a `PcdIdentitySnapshot`. The SP4/SP9/SP10A writer lock-step continues to apply only to the three writer paths.

10. **Single-currency lock (SP10A risk #6 carry-over).** `currency: "USD"` literal. Multi-currency is a future `PCD_COST_BUDGET_VERSION@2.0.0` bump.

11. **Bare `writePcdIdentitySnapshot` callsite (SP9 risk #4 / SP10A risk #2 carry-over) NOT closed by SP10C.** SP10C is a chain-gate, not a per-asset writer. Runner-discipline at merge-back continues to govern which writer callsite ships.

12. **`fanoutDecisionId` convention (SP9 / SP10A / SP10B carry-over) NOT resolved by SP10C.** SP10C's gate fires before fanout. Inherited unchanged. If the cost-gate ever needs to write a per-decision forensic record, that's a future-slice concern.

13. **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts` continues as baseline noise (now 12 slices deferred).** SP10C does not fix it.

14. **Throw-on-violation produces a non-resumable chain (SP10B risk #15 carry-over).** Same accepted trade-off. Resumable / checkpointed chain runs are out of scope.

15. **Dual-mode operation (gated vs. ungated) is permitted (SP10B risk #16 carry-over).** A `null` budget return bypasses the entire SP10C orchestrator (no cost check, no count check, no SP10B call). A non-null budget with `maxEstimatedUsd === null` enforces count only (delegates to SP10B). A non-null budget with `maxEstimatedUsd !== null` enforces both count and cost.

16. **Coarse estimator accuracy drift between SP10C-gate-time and SP10A-fanout-time is structurally unresolvable.** The coarse estimator (no provider/model picked) and the SP10A per-asset routed estimator (provider/model known) WILL produce different numbers for the same scripts. **Why accepted:** they answer different questions — "will this chain blow my budget if I proceed to fanout?" vs. "what did asset X actually cost?" Operator dashboards at merge-back should surface both numbers explicitly and not pretend either is a single source of truth.

17. **Anti-pattern test #6 in `sp10b-anti-patterns.test.ts` STAYS unchanged.** SP10B's `budget.maxEstimatedUsd !== null → throw InvariantViolationError` assertion remains valid because SP10C calls SP10B with a stripped budget. SP10B's count-only invariant is load-bearing for the SP10C architecture, NOT inverted by SP10C. Removing or inverting that test would break the structural contract that lets SP10C compose SP10B without editing it.

18. **Cost-overhead pre-SP10B failure path.** If SP10B throws `TreeBudgetExceededError` (count gate fails), the coarse estimator is never called. SP10C catches nothing — SP10B's throw propagates raw. Trade-off: count violations are cheaper to surface than cost violations (no estimator call). **Why accepted:** count is structurally simpler and operator-mental-model maps to count first. If the chain has 1000 scripts, the operator sees "too many scripts" before "too expensive."

---

## 1. Mission

Land cost-budget enforcement for the PCD pre-production chain so brief breadth cannot silently produce production fanout that exceeds operator-set dollar ceilings. SP10C is the **second slice with abort/prune authority** (SP10B introduced the pattern) and the FINAL slice of the SP10 trilogy:

- **SP10A** stamped per-asset cost forensically (observability only — no abort).
- **SP10B** enforced tree-shape ceilings (count only — abort on violation).
- **SP10C** enforces tree-cost ceilings (dollar amount — abort on violation).

Today the gap is structural:

- `PreproductionTreeBudgetSchema.maxEstimatedUsd: z.number().positive().nullable()` was widened in SP10B but always populated as `null`. The schema slot is forward-declared; SP10C lights it up.
- SP10A's `CostEstimator` interface takes `{provider, model, shotType, outputIntent}` per-asset, but provider/model are unknown at gate time (SP4 routing is downstream of fanout). SP10A's estimator is structurally **unusable** as a gate-time pre-routing estimator.
- SP10B asserts `budget.maxEstimatedUsd === null` and throws `InvariantViolationError` on non-null — explicit SP10C-bleed protection. That assertion is load-bearing for SP10C's architecture (see §0 risk #17).

SP10C closes the dollar-gate gap with one new pinned constant (`PCD_COST_BUDGET_VERSION` — the 15th), one new injected contract (`CoarseCostEstimator`), one deterministic stub (`StubCoarseCostEstimator`), one pure validator (`validateCostAgainstBudget`), one new error class (`CostBudgetExceededError`), and one new top-level orchestrator (`runIdentityAwarePreproductionChainWithCostBudget`). No Prisma migration. No edits to SP1–SP10B source bodies. No new schema file (SP10C reuses SP10B's widened `PreproductionTreeBudgetSchema`).

---

## 2. Hard guardrails (inherited from SP1–SP10B — not negotiable)

1. **Pure orchestration in `packages/creative-pipeline/src/pcd/`.** Persistence (none in SP10C) goes through injected store interfaces with concrete Prisma implementers in `packages/db/`.
2. **No edits to SP1–SP10B source bodies.** SP10C adds files; SP7's chain composer, SP8's identity-context builder, SP10A's writer/stamper/orchestrator, and SP10B's orchestrator/validator/reader/error are NOT mutated. SP10C ships a new top-level orchestrator (`runIdentityAwarePreproductionChainWithCostBudget`) that COMPOSES SP10B's orchestrator (calls it as a pure async function with a stripped budget — does not duplicate count-gate logic).
3. **Pinned version constant per new decision surface.** SP10C adds `PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0"` (15th constant in the PCD slice). The `CoarseCostEstimatorOutput.estimatorVersion` field stays orthogonal (set by the estimator implementer — SP10A precedent).
4. **`// MERGE-BACK:` markers** at every new state transition / external-system seam.
5. **Anti-pattern grep tests + forbidden-imports tests** on every new module. Ship `sp10c-anti-patterns.test.ts` (extends SP7/SP8/SP9/SP10A/SP10B patterns).
6. **Composer-only version pinning (SP8 lock).** The validator imports `PCD_COST_BUDGET_VERSION` from a sibling const file. No estimator, reader, error class, or orchestrator file may contain the literal `"pcd-cost-budget@"` — anti-pattern grep enforces.
7. **Identity context immutability (SP8 lock).** SP10C does NOT populate `PcdIdentityContext.treeBudget`. Slot stays null. SP10C builds identityContext at orchestrator entry but does NOT thread it back into a populated SP7 surface.
8. **SP10B count-only invariant (SP10B Q4 lock) STAYS in force.** SP10C does NOT edit `sp10b-anti-patterns.test.ts`. SP10C orchestrator calls SP10B with `{...budget, maxEstimatedUsd: null}` to preserve the invariant structurally.
9. **3-way SP4/SP9/SP10A invariant lock-step does NOT extend to SP10C.** SP10C is chain-level, not per-asset.
10. **Per CLAUDE.md:** ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft limit, `pnpm exec prettier --check`. `pnpm lint` is structurally broken on origin/main per SP5 baseline note — use prettier as the practical style gate.

---

## 3. Architectural locks (Q1–Q16)

### Q1 — Coarse estimator contract: `{briefId, identityContext, scriptCount}` only

The estimator interface ships as:

```ts
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). SP10C ships only the contract + a deterministic stub.
export type CoarseCostEstimatorInput = {
  briefId: string;
  identityContext: PcdIdentityContext;
  scriptCount: number;
};

export type CoarseCostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  lineItems: Array<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CoarseCostEstimator = {
  estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput>;
};
```

**Why these inputs (and no others):**

- **`briefId`** — identifier for forensic traceability (estimator may want to log per-brief; merge-back-time real estimator may want to fetch a per-brief override pricing table).
- **`identityContext`** — carries tier projection (`effectiveTier`, `productTierAtResolution`, `creatorTierAtResolution`), allowed shot/intent universe (`allowedShotTypes`, `allowedOutputIntents`), UGC constraints, and tier-3 rule flags. The estimator uses these to compute a tier/intent-weighted worst-case-or-average estimate over the provider-capability matrix. Without identityContext, the estimator would have to read the brief and recompute tier projection — duplicating SP3/SP7 logic.
- **`scriptCount`** — the per-asset multiplier. From `chainResult.stageOutputs.scripts.scripts.length`.

**Why NOT in the contract:**

- **`provider` / `model`** — unknown at gate time. SP4 routing is downstream of fanout.
- **`shotTypeMix` / `outputIntentMix`** — scripts don't carry per-script shotType/outputIntent in the current schema (`CreatorScriptSchema` has `scriptStyle` discriminator but not shot type). The estimator can fold `identityContext.allowedShotTypes` and `identityContext.allowedOutputIntents` to compute a mix-weighted estimate; passing them separately would be double-information. YAGNI rejected.
- **Full chain result** — the estimator does not need per-script content. Only the count matters. Passing the full result couples the estimator to chain-result shape (a stability liability).
- **`organizationId`** — the budget reader already used it. The estimator doesn't need it (the budget value already encodes org-level pricing concerns by the time the reader returned).

**Why output shape mirrors SP10A's `CostEstimatorOutput`:**

The four-field output (`estimatedUsd`, `currency`, `lineItems`, `estimatorVersion`) matches SP10A so dashboards / merge-back analytics that already handle the SP10A shape can render SP10C output with the same code path. `estimatorVersion` is orthogonal to `PCD_COST_BUDGET_VERSION` — same precedent as SP10A risk #9.

**Schema for the estimator output:** ship a new zod schema `CoarseCostEstimatorOutputSchema` in `packages/schemas/src/pcd-cost-budget.ts` for defense-in-depth parsing inside the validator. Structurally similar to SP10A's `PcdSp10CostForecastReasonSchema` minus `costForecastVersion` / `estimatedAt` (SP10C's validator handles version pinning + timestamping itself).

```ts
// packages/schemas/src/pcd-cost-budget.ts (NEW)
import { z } from "zod";

export const CoarseCostEstimatorOutputSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatorVersion: z.string().min(1),
});
export type CoarseCostEstimatorOutputSchemaType = z.infer<typeof CoarseCostEstimatorOutputSchema>;

export const CostBudgetMetaSchema = z.object({
  costBudgetVersion: z.string().min(1),
  estimatorVersion: z.string().min(1),
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  threshold: z.number().positive(),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatedAt: z.string().datetime(),
});
export type CostBudgetMeta = z.infer<typeof CostBudgetMetaSchema>;
```

**Why a new schema file (not widening `pcd-cost-forecast.ts`):** SP10A's schema file ships `PcdSp10CostForecastReasonSchema` keyed to the per-asset/post-routing forensic record. SP10C's records are gate-time/pre-routing and not persisted — different lifecycle, different consumers. Separate file = separate version cadence and clearer barrel surface.

### Q2 — Enforcement point: post-chain, after SP10B's count gate

The SP10C orchestrator:

1. Builds identityContext at entry (for the estimator).
2. Resolves budget via `Sp10bBudgetReader.resolveBudget()`.
3. If budget is null → bypass everything; call SP7 chain directly. Return `{result, budgetMeta: null, costMeta: null}`.
4. Else: split budget into count-only `{...budget, maxEstimatedUsd: null}` and cost-threshold `budget.maxEstimatedUsd`.
5. Call SP10B with the count-only budget. SP10B throws `TreeBudgetExceededError` on count violation (propagated raw — no try/catch). On success, SP10B returns `{result, budgetMeta}`.
6. If cost-threshold is null → return `{result, budgetMeta, costMeta: null}` (operator opted in to count enforcement but not cost enforcement).
7. Else: call `coarseCostEstimator.estimate({briefId, identityContext, scriptCount: result.stageOutputs.scripts.scripts.length})`. Defense-in-depth zod parse.
8. Compare `estimate.estimatedUsd > threshold`. If exceeded → throw `CostBudgetExceededError`. Else → return `{result, budgetMeta, costMeta}`.

**Why post-chain (not mid-chain decorators, not pre-chain feasibility):**

| Option                      | Choice | Rationale                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-chain feasibility gate  | ❌     | Script count is unknown pre-chain. Real Claude-driven runners produce variable fanout. Pre-chain estimator could only validate `budget.maxEstimatedUsd >= 0` — theater. Same SP10B Q2 rationale.                                                                                                                    |
| Mid-chain decorator runners | ❌     | Wrapping injected stage runners with cost-aware decorators introduces partial-tree semantics. Same SP10B Q2 rejection.                                                                                                                                                                                              |
| Post-chain validator        | ✅     | SP10B precedent. Chain runs to completion or not at all (atomic). Validation is pure arithmetic (`estimate.estimatedUsd > threshold`). Composer body untouched.                                                                                                                                                     |
| Post-SP10B validator        | ✅     | SP10C's actual choice. Composes SP10B's post-chain count gate, then adds a post-SP10B cost gate. Operator sees count violations first (cheaper to surface — no estimator call required); cost violations second (estimator runs only when count passed).                                                            |

**Where SP10C sits in the call chain:**

```
Caller (merge-back-time production runner)
  └─> runIdentityAwarePreproductionChainWithCostBudget(brief, stores)   [SP10C — NEW]
        ├─> buildPcdIdentityContext(brief, stores)                       [SP7 — UNCHANGED]
        ├─> budgetReader.resolveBudget(briefId, organizationId)          [Sp10bBudgetReader — REUSED]
        ├─> runIdentityAwarePreproductionChainWithBudget(               [SP10B — UNCHANGED]
        │       brief, {...stores, budgetReader: stripMaxUsdReader})
        │   └─> runIdentityAwarePreproductionChain(brief, stores)       [SP7 — UNCHANGED]
        │         └─> trends → motivators → hooks → scripts → gate
        ├─> coarseCostEstimator.estimate({briefId, identityContext, scriptCount})
        └─> validateCostAgainstBudget(estimate, threshold)
              └─> throw CostBudgetExceededError | return ok
```

**Stripping `maxEstimatedUsd` before calling SP10B:**

The SP10C orchestrator does NOT pass `stores.budgetReader` to SP10B directly. Instead it wraps the reader in a closure (`stripMaxUsdReader`) that calls the original reader and returns `{...budget, maxEstimatedUsd: null}` (or `null` if the original returned null). This guarantees SP10B's count-only invariant holds at SP10B's gate — SP10C does NOT depend on SP10B's source-level invariant being preserved by future refactors.

```ts
const stripMaxUsdReader: Sp10bBudgetReader = {
  async resolveBudget(input) {
    const raw = await stores.budgetReader.resolveBudget(input);
    if (raw === null) return null;
    return { ...raw, maxEstimatedUsd: null };
  },
};
```

**Trade-off:** the budget reader is called once at SP10C level (to fetch the original budget including `maxEstimatedUsd`) and then again via `stripMaxUsdReader` inside SP10B (which calls the original reader again). Two reader calls per gated run. **Why accepted:** reader calls are pure (no LLM, no chain compute). Production readers cache. The alternative (passing the resolved budget to SP10B directly) would require widening SP10B's interface — forbidden by guardrail #2.

Actually — let's lock the cleaner variant: **the wrapped reader is constructed once and PASSED TO SP10B**; the original reader is also called once at SP10C entry to fetch the full budget. That's two reader calls (one direct, one via wrapper) per gated run. The wrapper re-uses the cached value if the production reader caches; otherwise it's a duplicate fetch. SP10C does not optimize this; documented in §0 risk #2 alongside the double-identityContext-build.

### Q3 — Source of cost budget: `Sp10bBudgetReader` REUSED

No new reader contract. The existing `Sp10bBudgetReader` returns `PreproductionTreeBudget | null` where `PreproductionTreeBudget.maxEstimatedUsd: number | null` is the cost threshold. SP10C reads the same field.

**Why reuse (not parallel `Sp10cCostBudgetReader`):**

- The Switchboard-side `OrganizationBudget` table at merge-back ships ONE budget row per org/brief. Splitting it into `OrganizationCountBudget` + `OrganizationCostBudget` would force Switchboard to model two tables for one logical config object.
- The schema slot already exists (`maxEstimatedUsd` widened by SP10B). A parallel reader contract would duplicate the surface.
- The reader returns one struct; SP10C and SP10B both read the relevant fields. Clean separation.

**Why `null` semantics differ between count and cost:**

- `budget === null` (top-level) — no gate at all. Skip SP10B, skip SP10C, run SP7 directly.
- `budget !== null && budget.maxEstimatedUsd === null` — count enforcement only. Operator opted in to count but not cost. SP10B runs; SP10C cost gate is skipped.
- `budget !== null && budget.maxEstimatedUsd !== null` — both gates active.

Documented inline in the orchestrator and tested explicitly.

### Q4 — `PcdProductionFanoutDecision.costForecast` stays null

SP7's composer constructs `PcdProductionFanoutDecision` internally with `costForecast: null` (forward-declared by SP7, untouched since). SP10C runs POST-chain — the decision struct is already constructed by the time SP10C sees `result`. Options:

| Option                                                | Choice | Rationale                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutate `result.decision.costForecast` post-hoc        | ❌     | `result` is structurally readonly (zod `.readonly()` and chain composer never mutates). Mutation would break SP9/SP10A invariants that depend on the result being immutable.                                                                                                                                    |
| Edit SP7 composer to take cost forecast as input      | ❌     | Forbidden by guardrail #2.                                                                                                                                                                                                                                                                                      |
| Wrap result with augmented decision                   | ❌     | Would diverge from SP7/SP10B return shape; downstream consumers expecting `result.decision.costForecast === null` would break.                                                                                                                                                                                  |
| Outcome wrapper carries cost data separately          | ✅     | SP10B precedent. SP10C's `RunPreproductionChainWithCostBudgetOutcome.costMeta` is the SP10C-introduced surface for cost data. SP7 decision slot stays null; merge-back consumers read `costMeta` instead. Documented at §0 risk #3.                                                                            |

### Q5 — Pinned constant: `PCD_COST_BUDGET_VERSION` (15th)

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts
export const PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0";
```

**Why only one new pinned constant (no `PCD_COARSE_COST_ESTIMATOR_VERSION`):**

The user's brief suggested ONE additional constant for the estimator. SP10A precedent is that estimator-version is ORTHOGONAL (carried in `CostEstimatorOutput.estimatorVersion`, not a pinned PCD constant). The stub estimator ships its own internal constant (`STUB_COARSE_COST_ESTIMATOR_VERSION`) but this is a STUB-internal version string, not part of the PCD pinned-constants count.

By that precedent, SP10C ships:

- **`PCD_COST_BUDGET_VERSION`** — pinned, schema/validator/orchestrator version. 15th in the PCD slice. Imported only by the validator (composer-only pinning lock).
- **`STUB_COARSE_COST_ESTIMATOR_VERSION`** — stub-internal, parallel to SP10A's `STUB_COST_ESTIMATOR_VERSION`. Not counted in the PCD pinned-constants total.

**Why one constant, not two:**

Two constants imply two cadences — but `PCD_COST_BUDGET_VERSION` and a hypothetical `PCD_COARSE_COST_ESTIMATOR_VERSION` would evolve together. The schema, validator, and estimator-contract shape live in one slice. Multi-currency or threshold-semantics changes bump `PCD_COST_BUDGET_VERSION`. Estimator-implementation changes bump the orthogonal `estimatorVersion` string from the implementer. No structural reason for a third constant.

### Q6 — Allowlist maintenance

The SP9, SP10A, and SP10B anti-pattern tests each contain a source-body-freeze assertion that runs `git diff <baseline> HEAD` and rejects any file change outside the allowlist. SP10C requires three small edits (one per test) to add `packages/creative-pipeline/src/pcd/cost-budget/` to the freeze allowlist.

**Same SP10A → SP10B precedent (the SP10B PR chore commit allowlisted `pcd/budget/` in SP9 and SP10A tests). SP10C continues the pattern.**

Test files edited in SP10C (allowed by SP10C's own freeze allowlist):

- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` — add `pcd/cost-budget/` to its allowlist
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` — add `pcd/cost-budget/` to its allowlist
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` — add `pcd/cost-budget/` to its allowlist

**Three-line edits each.** SP10C's own freeze allowlist (test #N in `sp10c-anti-patterns.test.ts`) baselines against SP10B's squash `6ddd736` and includes those three test files as legitimate-maintenance edits.

### Q7 — Compose, do not edit, SP10B

**Locked: option (c) — keep SP10B, ship SP10C as parallel orchestrator.**

The SP10C orchestrator calls SP10B's `runIdentityAwarePreproductionChainWithBudget` as a pure async function with a stripped budget (via `stripMaxUsdReader`). This:

- Honors guardrail #2 (no edits to SP10B source body).
- Preserves SP10B's `budget.maxEstimatedUsd === null` invariant assertion as a load-bearing structural lock (see §0 risk #17).
- Lets `sp10b-anti-patterns.test.ts` stay unchanged (no test inversion).
- Lets operators run SP10B directly (count-only) without SP10C wrapping. SP10C is opt-in; callers that want count-only continue to call SP10B's orchestrator.

**Why NOT edit SP10B's body to remove the InvariantViolationError assertion (option a):**

Editing SP10B's orchestrator would:
- Violate guardrail #2.
- Invert SP10B's load-bearing count-only invariant (the assertion documents the SP10B contract).
- Force `sp10b-anti-patterns.test.ts` test #6 to be removed or inverted — a regression in structural protection.
- Mean SP10C is no longer an independently-squashable slice (it edits a previously-shipped body).

**Why NOT replace SP10B with a new orchestrator (option b):**

Replacement would require duplicating SP10B's count-gate logic in SP10C, which is the opposite of composition. SP10B becomes dead code. Worse for merge-back diff readability.

### Q8 — Module placement: `pcd/cost-budget/` sibling subdir

Files land in `packages/creative-pipeline/src/pcd/cost-budget/`. Sibling to `pcd/preproduction/` (SP7/SP8), `pcd/provenance/` (SP9), `pcd/cost/` (SP10A), `pcd/budget/` (SP10B). Rationale:

- Cost-budget enforcement is structurally an additive, isolated concern with its own version constant, anti-pattern test, and barrel.
- Sibling subdir matches every prior synergy-slice precedent.
- Subdir name `cost-budget` (hyphenated) distinguishes from `cost/` (SP10A — per-asset forensics) and `budget/` (SP10B — count enforcement). Two-word subdir is the first in the PCD vertical; the underscore form (`cost_budget`) was rejected because TypeScript/Node module paths conventionally use hyphens.
- No circular dependency: `pcd/cost-budget/` imports from `pcd/preproduction/` (chain types, identity-context builder), `pcd/budget/` (SP10B orchestrator + types), and `pcd/` top-level (InvariantViolationError). Reverse direction does not exist.

### Q9 — Reader composition with SP10B + SP7 stores: PreproductionChainStores intersection

```ts
export type RunIdentityAwarePreproductionChainWithCostBudgetStores =
  RunIdentityAwarePreproductionChainWithBudgetStores & {
    coarseCostEstimator: CoarseCostEstimator;
  };
```

Intersection over SP10B's stores type (which itself intersects SP7's `PreproductionChainStores`). One stores object carries: all SP7 stores + `Sp10bBudgetReader` + `organizationId?` + `CoarseCostEstimator`.

**Why intersection (not extension):**

Type-alias composition — same SP10A precedent (`WritePcdIdentitySnapshotWithCostForecastStores = StampPcdProvenanceStores & StampPcdCostForecastStores & {...}`).

**`organizationId` continues to live on the stores object** (carried by SP10B's stores type). SP10C does not introduce a new placement.

### Q10 — Validator interface: pure function, no stores, no async; lightweight

```ts
// pcd/cost-budget/cost-budget-validator.ts
export type ValidateCostAgainstBudgetInput = {
  estimate: CoarseCostEstimatorOutput;
  threshold: number; // budget.maxEstimatedUsd — non-null by precondition
  estimatedAt: string; // ISO timestamp from clock() at orchestrator level
};

export type ValidateCostAgainstBudgetOutput =
  | { ok: true; meta: CostBudgetMeta }
  | { ok: false; meta: CostBudgetMeta };

export function validateCostAgainstBudget(
  input: ValidateCostAgainstBudgetInput,
): ValidateCostAgainstBudgetOutput;
```

Pure synchronous function. Zero I/O, zero stores. Sole import site for `PCD_COST_BUDGET_VERSION` (composer-only pinning lock #6 — anti-pattern test enforces).

**Validator logic:**

```ts
const meta: CostBudgetMeta = {
  costBudgetVersion: PCD_COST_BUDGET_VERSION,
  estimatorVersion: input.estimate.estimatorVersion,
  estimatedUsd: input.estimate.estimatedUsd,
  currency: input.estimate.currency,
  threshold: input.threshold,
  lineItems: input.estimate.lineItems,
  estimatedAt: input.estimatedAt,
};
return input.estimate.estimatedUsd > input.threshold
  ? { ok: false, meta }
  : { ok: true, meta };
```

The validator returns a structured result (not throwing directly) so the orchestrator can decide how to surface it. Orchestrator throws `CostBudgetExceededError` on `ok: false` (carrying `meta` for operator forensics). The validator's output shape is testable in isolation.

**Why both ok and fail paths return `meta` (lossless reporting):**

Same SP10B precedent. The CostBudgetMeta is forensic record material — dashboard renders it on success (preview) and on failure (operator decides whether to raise budget or trim brief). Symmetry with SP10B's `TreeShapeMeta` on `budgetMeta` field.

**Edge cases:**

- `estimate.estimatedUsd === threshold`: this is NOT a violation. Strict `>` semantics. Operator setting `maxEstimatedUsd: 100` means "no more than $100"; an estimate of exactly $100 passes.
- `estimate.estimatedUsd === 0`: passes (zero ≤ any positive threshold). Stub estimator may return zero for empty scripts.
- `estimate.lineItems` empty: validator does not require non-empty. Operator-facing UI at merge-back must handle empty line items gracefully.
- `threshold` is `null` at the type level — but the orchestrator only calls the validator when `threshold` is non-null. Validator's `number` type assumes non-null; orchestrator's call site enforces.

### Q11 — Orchestrator failure semantics

| Failure mode                                                  | Throws                                                                                          | Caught by orchestrator?                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `buildPcdIdentityContext()` throws                            | Whatever the builder throws (`InvariantViolationError`, `ConsentRevokedRefusalError`, `ZodError`) | No — propagated raw                                                |
| `budgetReader.resolveBudget()` throws (top-level)             | Whatever the reader throws                                                                      | No — propagated raw                                                |
| `budgetReader.resolveBudget()` returns null                   | (no throw — entire SP10C orchestrator bypassed)                                                  | N/A — returns `{result, budgetMeta: null, costMeta: null}`         |
| SP10B throws `TreeBudgetExceededError`                        | `TreeBudgetExceededError`                                                                       | No — propagated raw                                                |
| SP10B throws any chain error (forwarded raw)                  | `PreproductionChainError`, `ConsentRevokedRefusalError`, `ZodError`, `InvariantViolationError`   | No — propagated raw                                                |
| `budget.maxEstimatedUsd === null` (count-only)                | (no throw — cost gate skipped)                                                                   | N/A — returns `{result, budgetMeta, costMeta: null}`                |
| `coarseCostEstimator.estimate()` throws                       | Whatever the estimator throws                                                                   | No — propagated raw                                                |
| Estimator output fails zod parse                              | `ZodError`                                                                                      | No — propagated raw                                                |
| `validateCostAgainstBudget()` returns `ok: false`             | `CostBudgetExceededError` thrown by orchestrator (carries `meta`)                                | N/A — orchestrator throws after pure validator returns false       |
| `validateCostAgainstBudget()` returns `ok: true`              | (no throw — `{result, budgetMeta, costMeta: validation.meta}` returned)                          | N/A                                                                |

**No try/catch in any SP10C source.** Same propagation rule as SP9, SP10A, SP10B. Style baseline.

### Q12 — Public surface

```ts
// packages/creative-pipeline/src/pcd/cost-budget/index.ts
export { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";
export { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
export type {
  CoarseCostEstimator,
  CoarseCostEstimatorInput,
  CoarseCostEstimatorOutput,
} from "./coarse-cost-estimator.js";
export {
  StubCoarseCostEstimator,
  STUB_COARSE_COST_ESTIMATOR_VERSION,
} from "./stub-coarse-cost-estimator.js";
export {
  validateCostAgainstBudget,
  type ValidateCostAgainstBudgetInput,
  type ValidateCostAgainstBudgetOutput,
} from "./cost-budget-validator.js";
export {
  runIdentityAwarePreproductionChainWithCostBudget,
  type RunIdentityAwarePreproductionChainWithCostBudgetStores,
  type RunPreproductionChainWithCostBudgetOutcome,
} from "./run-identity-aware-preproduction-chain-with-cost-budget.js";
```

Re-exported from package barrel `packages/creative-pipeline/src/index.ts`. `CostBudgetMeta` is re-exported from `@creativeagent/schemas` (already in the schemas barrel via `pcd-cost-budget.ts`).

### Q13 — Anti-pattern grep tests (SP10C-specific)

Ship `sp10c-anti-patterns.test.ts` with 9 structural assertions:

1. **Composer-only version pinning.** Only `cost-budget-version.ts` AND `cost-budget-validator.ts` (the importer) contain the literal `"pcd-cost-budget@"`. No estimator, reader, error class, or orchestrator file contains the literal.
2. **Throw-not-mutate selection.** No SP10C source contains `selectedScriptIds =`, `availableScriptIds =`, `.push(`, `.splice(`, or `.pop(` against either array.
3. **Throw discipline — SP10C source DOES contain `throw new CostBudgetExceededError`** in the orchestrator (positive assertion: catches accidental "return false" refactors that lose the throw).
4. **No edits to SP1–SP10B source bodies.** Read-only `git diff 6ddd736 HEAD` against the SP1–SP10B source-body file list returns empty diffs (allowlist for new barrel re-export, the new schema file, three anti-pattern test allowlist edits, package.json deps if any).
5. **Forbidden imports.** No SP10C source imports `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `node:http`, `node:https`, `crypto` (test exempts itself; SP10B-baseline pattern for the freeze-test that reads file contents via `node:fs`).
6. **`maxEstimatedUsd` schema slot unchanged.** `pcd-preproduction.ts` `PreproductionTreeBudgetSchema` continues to declare `maxEstimatedUsd: z.number().positive().nullable()` exactly as SP10B left it. SP10C does NOT widen the schema further (positive assertion that the field is unchanged — catches accidental field removal or type change).
7. **SP10B invariant preserved (load-bearing).** The literal `budget.maxEstimatedUsd !== null` followed by `throw new InvariantViolationError` continues to exist in `run-identity-aware-preproduction-chain-with-budget.ts`. SP10C structurally asserts that SP10B's count-only invariant has NOT been edited (defensive — same lock as test #4 but at finer granularity).
8. **Estimator contract immutability.** `coarse-cost-estimator.ts` source contains all required-shape declarations (`briefId`, `identityContext`, `scriptCount`, `estimate`, `estimatedUsd`, `currency`, `lineItems`, `estimatorVersion`). Catches accidental field removal in the contract.
9. **`stripMaxUsdReader` invariant (SP10C structural).** Orchestrator source contains a closure that wraps `stores.budgetReader.resolveBudget` and returns `{...raw, maxEstimatedUsd: null}` for non-null returns. Regex assertion: orchestrator file contains `maxEstimatedUsd: null` in code (not just comment — codeOnly filter). Catches accidental removal of the stripping that would make SP10C call SP10B with the original budget and trip SP10B's invariant assertion.

### Q14 — Co-located tests

| File                                                              | Test count | What it asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cost-budget-version.test.ts`                                     | 1          | Constant equals exact literal `"pcd-cost-budget@1.0.0"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `cost-budget-exceeded-error.test.ts`                              | 5          | Construction, name, message format, `meta` carry-through (full `CostBudgetMeta` round-trip), defensive zod parse on construction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `stub-coarse-cost-estimator.test.ts`                              | 5–6        | Determinism (same scriptCount → same estimate), STUB_COARSE_COST_ESTIMATOR_VERSION literal, scriptCount-scaling line item, currency `"USD"`, ignores briefId / identityContext fields beyond scriptCount, zero-script edge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `cost-budget-validator.test.ts`                                   | 8–10       | Happy path (estimate < threshold → ok with meta populated), exact-threshold (estimate === threshold → ok), one-cent-over (estimate === threshold + 0.01 → fail), zero-estimate happy, meta version pin equals `PCD_COST_BUDGET_VERSION`, meta carries `estimatorVersion` from input, meta carries `lineItems` from input, meta carries `threshold` from input, meta carries `estimatedAt` from input.                                                                                                                                                                                                                                                                                                                          |
| `run-identity-aware-preproduction-chain-with-cost-budget.test.ts` | 14–16      | Full orchestrator happy path returns `{result, budgetMeta, costMeta}` all populated, null-budget bypass returns all three null with chain ran (NOT via SP10B), count-only budget (maxEstimatedUsd null) returns `{budgetMeta, costMeta: null}` with SP10B called, full count+cost happy returns all three meta populated, cost gate fails throws `CostBudgetExceededError` with meta carried, SP10B throws TreeBudgetExceededError propagated raw, SP10B throws chain error propagated raw, estimator throws propagated raw, estimator output zod parse fails → ZodError raw, stripMaxUsdReader is called inside SP10B (not the original — assertion via spy on the original reader), reader called exactly once at top level. |
| `pcd-cost-budget.test.ts` (schemas, new file)                     | 8–10       | `CoarseCostEstimatorOutputSchema` validates happy / rejects negative / rejects non-USD / rejects missing field; `CostBudgetMetaSchema` validates happy / rejects negative estimatedUsd / rejects negative threshold / rejects missing field / rejects bad ISO timestamp.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `sp10c-anti-patterns.test.ts`                                     | 9          | Nine structural assertions above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Estimated net SP10C test count:** ~50–60. Comparable to SP10B (~46–56). Smaller than SP10A (~40 + db adapter tests + 11 schema tests).

### Q15 — `// MERGE-BACK:` markers

Seven markers:

1. `// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator` — on `StubCoarseCostEstimator` class declaration.
2. `// MERGE-BACK: emit WorkTrace here (budget resolved at SP10C top level)` — in orchestrator after top-level `resolveBudget` returns.
3. `// MERGE-BACK: emit WorkTrace here (count gate passed via SP10B)` — in orchestrator after SP10B returns `{result, budgetMeta}`.
4. `// MERGE-BACK: emit WorkTrace here (cost gate skipped — maxEstimatedUsd null)` — in orchestrator on the count-only branch.
5. `// MERGE-BACK: emit WorkTrace here (cost gate passed)` — in orchestrator after validator returns ok.
6. `// MERGE-BACK: emit WorkTrace here (cost gate violated)` — in orchestrator immediately before `throw new CostBudgetExceededError`.
7. `// MERGE-BACK: surface CostBudgetExceededError to dashboard with retry-with-raised-budget UI` — on `CostBudgetExceededError` class declaration.

### Q16 — Orchestrator outcome wrapper widens SP10B's

```ts
export type RunPreproductionChainWithCostBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when top-level budget was null (whole orchestrator bypassed).
  // Populated when SP10B ran (count gate succeeded). Inherits SP10B's
  // `TreeShapeMeta | null` semantics — SP10B may itself return null
  // budgetMeta if its inner budget call returned null (won't happen on
  // the SP10C path since SP10C always passes a non-null stripped budget
  // to SP10B when the top-level budget is non-null).
  budgetMeta: TreeShapeMeta | null;
  // null when top-level budget was null OR budget.maxEstimatedUsd was null.
  // Populated when the cost gate ran and passed. (When the cost gate fails,
  // CostBudgetExceededError is thrown — caller catches the error which itself
  // carries `meta: CostBudgetMeta` for symmetric forensics.)
  costMeta: CostBudgetMeta | null;
};
```

**Three-state matrix for the outcome wrapper:**

| top-level budget       | maxEstimatedUsd | Outcome (on success path)                                  |
| ---------------------- | --------------- | ---------------------------------------------------------- |
| `null`                 | N/A             | `{result, budgetMeta: null, costMeta: null}`               |
| non-null               | `null`          | `{result, budgetMeta: <SP10B meta>, costMeta: null}`       |
| non-null               | non-null        | `{result, budgetMeta: <SP10B meta>, costMeta: <SP10C meta>}` |

**Why the wider wrapper (not refactoring SP10B's wrapper):**

- SP10B's `RunPreproductionChainWithBudgetOutcome { result, budgetMeta }` stays unchanged (guardrail #2).
- SP10C's wrapper is a SUPERSET of SP10B's structure with one extra field.
- Callers that already consume SP10B's wrapper destructure `{result, budgetMeta}` and ignore `costMeta`. SP10C's wrapper is backward-compatible at the consumer level (extra-field tolerance).

**`CostBudgetExceededError.meta` mirror:**

Same symmetry as SP10B: success path carries `costMeta` on the outcome; failure path carries `error.meta` on the thrown error. Caller's `try/catch` gets the same `CostBudgetMeta` it would have gotten on success. Dashboard renders the same fields either way.

---

## 4. What ships

### 4.1 New schema file (`packages/schemas/src/pcd-cost-budget.ts`)

```ts
import { z } from "zod";

export const CoarseCostEstimatorOutputSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatorVersion: z.string().min(1),
});

export const CostBudgetMetaSchema = z.object({
  costBudgetVersion: z.string().min(1),
  estimatorVersion: z.string().min(1),
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  threshold: z.number().positive(),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatedAt: z.string().datetime(),
});

export type CoarseCostEstimatorOutputSchemaType = z.infer<typeof CoarseCostEstimatorOutputSchema>;
export type CostBudgetMeta = z.infer<typeof CostBudgetMetaSchema>;
```

New file. Re-exported via `packages/schemas/src/index.ts`. Test file at `packages/schemas/src/__tests__/pcd-cost-budget.test.ts` (~8-10 tests).

### 4.2 New pinned constant (`packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts`)

```ts
export const PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0";
```

15th pinned constant in the PCD slice. Single import site: `cost-budget-validator.ts`. Anti-pattern test #1 asserts no other source contains the literal `"pcd-cost-budget@"`.

### 4.3 Error class (`packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts`)

```ts
import type { CostBudgetMeta } from "@creativeagent/schemas";

// MERGE-BACK: surface CostBudgetExceededError to dashboard with retry-with-raised-budget UI.
export class CostBudgetExceededError extends Error {
  readonly meta: CostBudgetMeta;

  constructor(args: { meta: CostBudgetMeta }) {
    super(
      `cost budget exceeded: estimated $${args.meta.estimatedUsd.toFixed(2)} > threshold $${args.meta.threshold.toFixed(2)}`,
    );
    this.name = "CostBudgetExceededError";
    this.meta = args.meta;
  }
}
```

### 4.4 Estimator contract (`packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts`)

See §3 Q1 above. Type-only file. No runtime export.

### 4.5 Stub estimator (`packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts`)

```ts
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). Stub is deterministic for tests + local
// development. DO NOT add config flags or environment-driven fan-in — the swap
// is by injection, not by feature flag.
import type {
  CoarseCostEstimator,
  CoarseCostEstimatorInput,
  CoarseCostEstimatorOutput,
} from "./coarse-cost-estimator.js";

export const STUB_COARSE_COST_ESTIMATOR_VERSION = "stub-coarse-cost-estimator@1.0.0";

const STUB_USD_PER_SCRIPT = 1.5;

export class StubCoarseCostEstimator implements CoarseCostEstimator {
  async estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput> {
    const estimatedUsd = input.scriptCount * STUB_USD_PER_SCRIPT;
    return {
      estimatedUsd,
      currency: "USD",
      lineItems: [
        {
          label: `${input.scriptCount} × $${STUB_USD_PER_SCRIPT.toFixed(2)} per-script (stub)`,
          estimatedUsd,
        },
      ],
      estimatorVersion: STUB_COARSE_COST_ESTIMATOR_VERSION,
    };
  }
}
```

Deterministic. Ignores `briefId` and `identityContext` beyond the scriptCount multiplier — loud-stub posture per §0 risk #4.

### 4.6 Pure validator (`packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts`)

See §3 Q10 above. Pure synchronous function. Sole import site for `PCD_COST_BUDGET_VERSION`.

### 4.7 New top-level orchestrator (`packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts`)

```ts
// SP10C — Production callsite that wraps SP10B's count-gated chain with a
// post-chain cost-budget gate.
//
// Returns RunPreproductionChainWithCostBudgetOutcome { result, budgetMeta, costMeta }
// so callers get computed tree shape + cost on the success path without
// re-walking the tree or re-calling the estimator (Q16).
//
// Composition order:
//   1. buildPcdIdentityContext (for estimator input)
//   2. budgetReader.resolveBudget (top-level, full budget including maxEstimatedUsd)
//   3. null budget → bypass SP10C entirely (run SP7 chain directly, return all null meta)
//   4. SP10B (count gate) called with stripped budget (maxEstimatedUsd: null)
//   5. maxEstimatedUsd null → cost gate skipped, return {result, budgetMeta, costMeta: null}
//   6. coarseCostEstimator.estimate → defense-in-depth zod parse
//   7. validateCostAgainstBudget → throw CostBudgetExceededError on fail
//
// MERGE-BACK: dashboard surfaces CostBudgetExceededError with retry-with-raised-
// budget UI alongside SP10B's TreeBudgetExceededError UI.

import type { PcdBriefInput, PcdPreproductionChainResult } from "@creativeagent/schemas";
import { CoarseCostEstimatorOutputSchema } from "@creativeagent/schemas";
import {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "../preproduction/build-pcd-identity-context.js";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "../preproduction/preproduction-chain.js";
import {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "../budget/run-identity-aware-preproduction-chain-with-budget.js";
import type { Sp10bBudgetReader } from "../budget/sp10b-budget-reader.js";
import type { TreeShapeMeta } from "../budget/tree-shape-validator.js";
import type { CoarseCostEstimator } from "./coarse-cost-estimator.js";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
import {
  validateCostAgainstBudget,
} from "./cost-budget-validator.js";
import type { CostBudgetMeta } from "@creativeagent/schemas";

export type RunIdentityAwarePreproductionChainWithCostBudgetStores =
  RunIdentityAwarePreproductionChainWithBudgetStores & {
    coarseCostEstimator: CoarseCostEstimator;
  };

export type RunPreproductionChainWithCostBudgetOutcome = {
  result: PcdPreproductionChainResult;
  budgetMeta: TreeShapeMeta | null;
  costMeta: CostBudgetMeta | null;
};

export async function runIdentityAwarePreproductionChainWithCostBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithCostBudgetStores,
): Promise<RunPreproductionChainWithCostBudgetOutcome> {
  // Step 1 — build identityContext at SP10C entry (for estimator). SP7 will
  // build it again internally; double-build accepted per §0 risk #2.
  const identityContext = await buildPcdIdentityContext(brief, stores);

  // Step 2 — resolve full budget at SP10C top level.
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved at SP10C top level)

  // Step 3 — null budget bypass: run SP7 chain directly without SP10B/SP10C gates.
  if (budget === null) {
    const result = await runIdentityAwarePreproductionChain(brief, stores);
    return { result, budgetMeta: null, costMeta: null };
  }

  // Step 4 — call SP10B with stripped budget (maxEstimatedUsd: null) to preserve
  // SP10B's count-only invariant. Stripping is done via a wrapper reader so
  // SP10B sees a fully-stripped budget value, not the original.
  const stripMaxUsdReader: Sp10bBudgetReader = {
    async resolveBudget(input) {
      const raw = await stores.budgetReader.resolveBudget(input);
      if (raw === null) return null;
      return { ...raw, maxEstimatedUsd: null };
    },
  };
  const sp10bStores: RunIdentityAwarePreproductionChainWithBudgetStores = {
    ...stores,
    budgetReader: stripMaxUsdReader,
  };
  const sp10bOutcome: RunPreproductionChainWithBudgetOutcome =
    await runIdentityAwarePreproductionChainWithBudget(brief, sp10bStores);
  // MERGE-BACK: emit WorkTrace here (count gate passed via SP10B)

  const { result, budgetMeta } = sp10bOutcome;

  // Step 5 — cost gate skipped if maxEstimatedUsd is null.
  if (budget.maxEstimatedUsd === null) {
    // MERGE-BACK: emit WorkTrace here (cost gate skipped — maxEstimatedUsd null)
    return { result, budgetMeta, costMeta: null };
  }

  // Step 6 — coarse cost estimator. Errors propagated raw.
  const scriptCount = result.stageOutputs.scripts.scripts.length;
  const rawEstimate = await stores.coarseCostEstimator.estimate({
    briefId: brief.briefId,
    identityContext,
    scriptCount,
  });
  // Defense-in-depth zod parse on the estimator output.
  const estimate = CoarseCostEstimatorOutputSchema.parse(rawEstimate);

  // Step 7 — validator. Pure synchronous; assembles meta with version pin.
  const estimatedAt = (stores.clock?.() ?? new Date()).toISOString();
  const validation = validateCostAgainstBudget({
    estimate,
    threshold: budget.maxEstimatedUsd,
    estimatedAt,
  });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (cost gate passed)
    return { result, budgetMeta, costMeta: validation.meta };
  }

  // Step 8 — throw on violation.
  // MERGE-BACK: emit WorkTrace here (cost gate violated)
  throw new CostBudgetExceededError({ meta: validation.meta });
}
```

The orchestrator is ~75 LOC (excluding imports). All complexity lives in the validator and the stripping closure. Composer body untouched.

**`BuildPcdIdentityContextStores` is a subset of `PreproductionChainStores`** — SP10C's stores type already covers it (intersection). The `buildPcdIdentityContext(brief, stores)` call works because TS narrows the stores object to the relevant subset at the call site.

**`stores.clock` is inherited from `StampPcdProvenanceStores` via `PreproductionChainStores` intersection.** SP10A precedent. Defaults to `new Date()` if not provided.

### 4.8 Public surface (`packages/creative-pipeline/src/pcd/cost-budget/index.ts`)

See §3 Q12 above. Re-exported from the package barrel.

### 4.9 No Prisma migration

SP10C is pure orchestration. No `packages/db/prisma/schema.prisma` edit. No new migration directory.

### 4.10 No db-package adapter

SP10C does not introduce a Prisma store contract. Same as SP10B.

### 4.11 Anti-pattern test (`packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`)

See §3 Q13 above — 9 structural assertions. Implementation note: assertion #9 (stripMaxUsdReader invariant) needs the SP5-precedent `codeOnly` filter (strip line-comments before regex matching) so doc-comments mentioning `maxEstimatedUsd: null` don't trigger false positives.

Test #4 (source-body freeze) baselines against `6ddd736` (SP10B squash, current `main` HEAD).

### 4.12 Co-located tests

See §3 Q14 above — ~50–60 net new tests.

### 4.13 Schemas barrel re-export (`packages/schemas/src/index.ts`)

```ts
export * from "./pcd-cost-budget.js";
```

One-line addition.

### 4.14 Creative-pipeline barrel re-export (`packages/creative-pipeline/src/index.ts`)

```ts
export * from "./pcd/cost-budget/index.js";
```

One-line addition.

### 4.15 Anti-pattern allowlist maintenance (3 small edits)

Three test files get `pcd/cost-budget/` added to their freeze allowlists:

- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`

Same SP10A → SP10B precedent. ~3-line edits each. Allowed by SP10C's own freeze test #4.

---

## 5. Data flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Caller (merge-back-time production runner)                                │
│  Calls runIdentityAwarePreproductionChainWithCostBudget(brief, {           │
│    ...preproductionChainStores, budgetReader, coarseCostEstimator,         │
│    organizationId })                                                       │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 1 — buildPcdIdentityContext(brief, stores)                           │
│  - Pure registry reads via sp7ProductRegistryReader / sp7CreatorRegistryReader │
│  - Identity context cached at SP10C level for the estimator call.          │
│  - SP7 will build it again internally (double-build, §0 risk #2).          │
│  Throws: InvariantViolationError / ConsentRevokedRefusalError / ZodError (raw) │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 2 — budgetReader.resolveBudget({briefId, organizationId})            │
│  - Returns PreproductionTreeBudget | null                                  │
│  - Full budget including maxEstimatedUsd.                                  │
│  Throws: whatever the reader throws (raw)                                  │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 3 — Null-budget bypass                                                │
│  budget === null → call SP7 chain directly,                                │
│  return {result, budgetMeta: null, costMeta: null}                         │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │ budget !== null
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 4 — runIdentityAwarePreproductionChainWithBudget(brief, sp10bStores)│
│  - sp10bStores carries stripMaxUsdReader (wraps stores.budgetReader and   │
│    returns {...raw, maxEstimatedUsd: null})                               │
│  - SP10B's invariant assertion sees maxEstimatedUsd === null → passes.    │
│  - SP10B runs chain → validates tree shape → returns {result, budgetMeta} │
│  Throws: TreeBudgetExceededError / PreproductionChainError / etc. (raw)   │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 5 — Cost-skip if budget.maxEstimatedUsd === null                     │
│  Returns {result, budgetMeta, costMeta: null}                              │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │ budget.maxEstimatedUsd !== null
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 6 — coarseCostEstimator.estimate({briefId, identityContext,         │
│             scriptCount: result.stageOutputs.scripts.scripts.length})      │
│  - Defense-in-depth zod parse via CoarseCostEstimatorOutputSchema.parse   │
│  Throws: estimator-thrown / ZodError (raw)                                 │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Step 7 — validateCostAgainstBudget({estimate, threshold, estimatedAt})    │
│  - Pure synchronous arithmetic: estimate.estimatedUsd > threshold          │
│  - Assembles CostBudgetMeta with PCD_COST_BUDGET_VERSION pin               │
│  - Returns ValidateCostAgainstBudgetOutput { ok, meta }                    │
└─────────────┬──────────────────────────────────────────────────────────────┘
              │ ok: true   →  return {result, budgetMeta, costMeta: validation.meta}
              │ ok: false  →  throw CostBudgetExceededError({meta: validation.meta})
              ▼
        (caller destructures success outcome OR catches the error)
```

**No mutation, no prune, no partial result.** Every step either succeeds or throws. Chain runs to completion or not at all (atomic).

---

## 6. Failure semantics

See §3 Q11 above. Summary:

- **identityContext builder throws** → propagated raw.
- **Reader throws** → propagated raw.
- **Reader returns null** → no gate; orchestrator returns all-null outcome.
- **SP10B throws** (TreeBudgetExceededError, PreproductionChainError, etc.) → propagated raw.
- **`budget.maxEstimatedUsd === null`** → cost gate skipped; orchestrator returns `{result, budgetMeta, costMeta: null}`.
- **Estimator throws / zod parse fails** → propagated raw.
- **Validator returns `ok: false`** → orchestrator throws `CostBudgetExceededError` carrying `meta`.
- **Validator returns `ok: true`** → orchestrator returns `{result, budgetMeta, costMeta: validation.meta}`.

No try/catch anywhere in SP10C source.

---

## 7. Module layout

```
packages/creative-pipeline/src/pcd/cost-budget/
├── cost-budget-version.ts                                          [15th pinned constant]
├── cost-budget-exceeded-error.ts                                   [error class]
├── coarse-cost-estimator.ts                                        [estimator contract — types only]
├── stub-coarse-cost-estimator.ts                                   [stub estimator + STUB_COARSE_COST_ESTIMATOR_VERSION]
├── cost-budget-validator.ts                                        [pure validator — sole importer of version constant]
├── run-identity-aware-preproduction-chain-with-cost-budget.ts      [orchestrator]
├── index.ts                                                        [public surface]
├── cost-budget-version.test.ts
├── cost-budget-exceeded-error.test.ts
├── stub-coarse-cost-estimator.test.ts
├── cost-budget-validator.test.ts
├── run-identity-aware-preproduction-chain-with-cost-budget.test.ts
└── sp10c-anti-patterns.test.ts

packages/schemas/src/
└── pcd-cost-budget.ts                                              [NEW — CoarseCostEstimatorOutputSchema + CostBudgetMetaSchema]

packages/schemas/src/__tests__/
└── pcd-cost-budget.test.ts                                         [NEW — 8-10 tests]
```

7 new source files in `pcd/cost-budget/` + 6 new test files + 1 new schema file + 1 new schema test file. Comparable to SP10B's footprint (7 source + 6 test) plus a new schema file.

**Files outside `pcd/cost-budget/` that change:**

- `packages/schemas/src/pcd-cost-budget.ts` — NEW
- `packages/schemas/src/__tests__/pcd-cost-budget.test.ts` — NEW
- `packages/schemas/src/index.ts` — re-export the new schema file (1 line)
- `packages/creative-pipeline/src/index.ts` — re-export SP10C surface (1 line)
- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` — allowlist edit (3 lines)
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` — allowlist edit (3 lines)
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` — allowlist edit (3 lines)
- `docs/SWITCHBOARD-CONTEXT.md` — add SP10C merge-back surface section
- `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` — update SP10C status (final task only)

**Files NOT changed (verified by anti-pattern test #4):**

- `packages/schemas/src/pcd-preproduction.ts` — `PreproductionTreeBudgetSchema` stays unchanged since SP10B (positive freeze assertion via anti-pattern test #6)
- `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts` (treeBudget slot stays null)
- `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts`
- `packages/creative-pipeline/src/pcd/cost/*` (any file)
- `packages/creative-pipeline/src/pcd/provenance/*` (any file except the allowlist edit)
- `packages/creative-pipeline/src/pcd/budget/*` (any file except the allowlist edit)
- `packages/db/prisma/schema.prisma`
- `packages/db/src/stores/*` (no new method, no new adapter)

---

## 8. Merge-back surfaces

**SP10C-declared merge-back surfaces (production wiring at merge-back):**

- **`CoarseCostEstimator` injection** — Switchboard ad-optimizer team owns the production coarse pre-routing estimator. Real estimator reads per-tier × per-allowed-shot-type pricing tables, FX rates, volume tiers, contract pricing. SP10C ships only the contract + a deterministic stub. `// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator` marker on stub class declaration. **Different team / different model from SP10A's per-asset estimator** — coarse vs routed answer different questions (§0 risk #16).
- **`Sp10bBudgetReader` reuse** — SP10C does NOT ship a parallel reader contract. SP10B's reader returns `PreproductionTreeBudget` which carries `maxEstimatedUsd: number | null`. Switchboard's production `OrganizationBudget` table at merge-back populates the field. One reader, one schema slot. (See §3 Q3.)
- **`WorkTrace` emit** — every SP10C state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Five markers in `run-identity-aware-preproduction-chain-with-cost-budget.ts`: budget resolved at top, count gate passed via SP10B, cost gate skipped (maxEstimatedUsd null), cost gate passed, cost gate violated. WorkTrace payload should include `costMeta` on success and `error.meta` on failure (both are `CostBudgetMeta`).
- **Production runner discipline** — at merge-back, all production callsites that want cost enforcement should call `runIdentityAwarePreproductionChainWithCostBudget`. Callers that want count-only continue to use SP10B's orchestrator. Callers that want no gate continue to use SP7's chain directly. Three tiers; opt-in by injection.
- **Dashboard UX for `CostBudgetExceededError`** — operator-facing surface for retrying with a raised cost budget (separate UI from SP10B's tree-budget retry UI, though shared form fields possible). SP10C emits `error.meta` carrying enough context to render the violation breakdown (estimatedUsd vs threshold, lineItems, estimatorVersion, costBudgetVersion, estimatedAt).
- **Outcome-wrapper consumption at merge-back** — production runners must destructure the SP10C return: `const { result, budgetMeta, costMeta } = await runIdentityAwarePreproductionChainWithCostBudget(...)`. The three meta fields populate analytics dashboards directly. The three-state matrix (Q16) lets analytics queries compute opt-in rates per gate independently.
- **`PcdProductionFanoutDecision.costForecast` slot** — STAYS null. Merge-back consumers should NOT read this slot; read `outcome.costMeta` (or `error.meta` on failure) instead. SP7's composer is untouched.
- **identityContext threading optimization** — SP10C builds identityContext twice (once at SP10C entry, once inside SP7). Merge-back may widen SP7's chain return to include identityContext, after which SP10C's call site is a one-line swap (drop the `buildPcdIdentityContext` call; read `result.identityContext`). Marker on the SP10C orchestrator's identityContext call.

**Schema reconciliation at merge-back:**

- `packages/schemas/src/pcd-cost-budget.ts` — NEW schema file added by SP10C. Reconciles cleanly if Switchboard `main` has not added an equivalent. If Switchboard added same-semantic schemas under different names, reconcile by renaming SP10C's schemas before merge-back.
- `PreproductionTreeBudgetSchema.maxEstimatedUsd` — already widened in SP10B. SP10C does NOT touch this. Anti-pattern test #6 freeze-asserts.
- No Prisma columns added by SP10C. Zero migration reconciliation overhead.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10C orchestrator + validator + stub estimator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/cost-budget/` changes at merge-back — only the injected estimator + reader swap (real Switchboard ad-optimizer estimator replaces `StubCoarseCostEstimator`; real Switchboard `OrganizationBudget` reader replaces `StaticDefaultBudgetReader`) and the `// MERGE-BACK:` markers get implementations.
- `PCD_COST_BUDGET_VERSION` is the 15th pinned constant. The PCD slice carries 15 total pinned constants after SP10C.
- SP10C introduces NO circular dependency. `pcd/cost-budget/` imports from `pcd/preproduction/` (chain composer, identity-context builder, types), `pcd/budget/` (SP10B orchestrator + types), and `pcd/` top-level. Reverse direction does not exist; `sp10c-anti-patterns.test.ts` enforces the source-freeze.
- The SP10B orchestrator body (`runIdentityAwarePreproductionChainWithBudget`) is untouched. SP10C added a parallel orchestrator (`runIdentityAwarePreproductionChainWithCostBudget`) that calls SP10B as a pure function with a stripped budget. SP10B's count-only invariant is preserved structurally.
- SP10C is the SECOND slice with abort/prune authority (SP10B was the first). The SP10B-introduced asymmetry (throw is _required_, mutation is _forbidden_) continues to apply; SP10C's own anti-pattern tests assert it.

**Anti-pattern test baseline coordination with future slices:**

SP10C's `sp10c-anti-patterns.test.ts` baselines against `6ddd736` (SP10B squash, current `main` HEAD at design time). Allowlist includes:
- `packages/creative-pipeline/src/pcd/cost-budget/` (SP10C net-new — always allowed)
- `packages/schemas/src/pcd-cost-budget.ts` (new schema file)
- `packages/schemas/src/__tests__/pcd-cost-budget.test.ts` (new schema test)
- `packages/schemas/src/index.ts` (barrel re-export)
- `packages/creative-pipeline/src/index.ts` (barrel re-export)
- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` (allowlist edit per SP10A precedent)
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` (allowlist edit per SP10B precedent)
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` (allowlist edit — first time, SP10C precedent)
- `docs/`

If SP11 (synthetic-creator roster) lands before SP10C, the rebase swaps the baseline ref to SP11's squash and adds `pcd/<sp11-subdir>/` to the freeze allowlist. ~5-line edit at the merge step.

---

## 9. Estimated work

| Slice     | New source files | New schemas                                       | New tests            | Migration                  | Pinned constants added |
| --------- | ---------------- | ------------------------------------------------- | -------------------- | -------------------------- | ---------------------- |
| SP9       | 5                | 1 schema file (3 schemas)                         | 38 net               | 1 (6 cols, 2 indexes)      | 1 (12th)               |
| SP10A     | 8                | 1 schema file (3 schemas)                         | ~40 net              | 1 (1 col, 0 indexes)       | 1 (13th)               |
| SP10B     | 7                | 1 field added to existing schema                  | ~46–56               | 0 (pure orchestration)     | 1 (14th)               |
| **SP10C** | **7**            | **1 new schema file (2 schemas) + 0 widenings**   | **~50–60 estimated** | **0 (pure orchestration)** | **1 (15th)**           |

SP10C is structurally similar to SP10B (no Prisma migration, no db-package adapter) plus one new schema file. Surface area is dominated by the orchestrator (~75 LOC including the stripping closure) and the validator (~25 LOC of pure arithmetic).

---

## 10. What is NOT in scope (SP10C)

- **Mid-chain enforcement / partial-tree pruning.** Rejected per Q2 lock (SP10B precedent). SP10C is post-chain only.
- **Multi-currency support.** Single-currency `"USD"` lock; future `PCD_COST_BUDGET_VERSION@2.0.0` bump.
- **Per-asset cost reconciliation at merge-back.** SP10A stamps per-asset cost forensically at fanout-write time; SP10C's gate-time estimate may diverge from SP10A's post-routing actual. Reconciling the two is a Switchboard analytics concern.
- **Editing SP10B body to remove the InvariantViolationError assertion.** Rejected per Q7 lock — SP10B's count-only invariant is load-bearing.
- **Populating `PcdProductionFanoutDecision.costForecast`.** Stays null per Q4 lock.
- **`PcdIdentityContext.treeBudget` populated.** Slot stays null per Q3 / SP10B Q3 lock.
- **identityContext threading optimization.** Building identityContext twice is accepted per §0 risk #2. Future-slice / merge-back concern.
- **Per-asset persistence change.** SP10C is pure orchestration; no `PcdIdentitySnapshot` or `PcdProductionFanoutDecision` widen.
- **Resumable / checkpointed chain runs.** Throw-on-violation is non-resumable per §0 risk #14 (SP10B precedent).
- **Dashboard / UI / operator-facing cost-budget editor.** Reserved for Switchboard at merge-back.
- **`OrganizationBudget` Prisma table.** Switchboard owns the schema. SP10C reuses SP10B's reader contract.
- **`fanoutDecisionId` convention lock.** Inherited from SP9 / SP10A / SP10B as caller-supplied.
- **Bare `writePcdIdentitySnapshot` callsite invariant.** SP9/SP10A risk carry-over.
- **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts`.** Continues as baseline noise (now 12 slices deferred).
- **Per-stage cost attribution.** Coarse estimator returns one number for the whole tree; per-stage breakdown is a real-estimator concern at merge-back, not a contract concern.
- **Cost-overhead retries (estimator runs once per chain run).** No memoization at SP10C level — production callers cache if needed.

---

## 11. References

- Memory: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` — SP1–SP10B state.
- `~/creativeagent/CLAUDE.md` — repo invariants.
- `~/creativeagent/docs/SWITCHBOARD-CONTEXT.md` — merge-back contract.
- `~/creativeagent/docs/plans/2026-05-01-pcd-tree-budget-sp10b-design.md` — SP10B design (predecessor; SP10C inherits its accepted-risks list at §0 and matches its module-layout pattern).
- `~/creativeagent/docs/plans/2026-05-01-pcd-tree-budget-sp10b-plan.md` — SP10B implementation reference (task structure to mirror).
- `~/creativeagent/docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md` — SP10A design (per-asset estimator precedent for the orthogonal-version-string pattern).
- `~/creativeagent/packages/schemas/src/pcd-preproduction.ts` — `PreproductionTreeBudgetSchema` (read by SP10C; not edited).
- `~/creativeagent/packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts` — SP10B orchestrator (called as pure function by SP10C orchestrator; body untouched).
- `~/creativeagent/packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts` — `Sp10bBudgetReader` (reused by SP10C; not edited).
- `~/creativeagent/packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` — anti-pattern test pattern that SP10C's test mirrors structurally; allowlist updated (+1 entry) by SP10C.
- `~/creativeagent/packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts` — called by SP10C orchestrator at entry for the estimator input.
