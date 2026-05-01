# SP10B — Tree-Budget Enforcement (Design)

**Slice:** PCD vertical SP10B
**Date:** 2026-05-01
**Status:** Design — awaiting plan + implementation
**Predecessor:** SP10A (cost-forecast wiring, squash `afa16de`, PR #9)
**Successor (planned):** SP10C (cost-budget enforcement — `maxEstimatedUsd` gate using a coarse pre-routing estimator; out of scope here)

---

## 0. User-accepted risks

These were named, weighed, and accepted during brainstorming. They are scope locks. Future readers (especially merge-back implementers and the SP10C author) should treat them as load-bearing.

1. **Cost-budget enforcement (`maxEstimatedUsd`) deferred to SP10C.** The `PreproductionTreeBudgetSchema` widens with `maxEstimatedUsd: z.number().positive().nullable()` in SP10B, but the field is **always populated as `null`** by `StaticDefaultBudgetReader` and the orchestrator structurally asserts it is `null` at gate time (throws `InvariantViolationError` if non-null). SP10B is count-only enforcement (`maxBranchFanout` + `maxTreeSize`). SP10C will introduce the coarse pre-routing estimator (the second contract slot SP10A reserved per design §0 risk #11) and light up the field. **Why deferred:** the cost-gate path needs an entirely new injection contract (`CoarseCostEstimator`) — provider/model/shotType/outputIntent are unknown at gate time, so SP10A's per-asset estimator is unusable upstream of routing. That is its own slice.

2. **Tree-budget gate is post-chain, not mid-chain.** The chain runs to completion before the gate fires. Stage runners (which at merge-back will make real Claude/LLM calls) cost real compute even when the resulting tree blows the budget. **Why accepted:** mid-chain enforcement requires either editing SP7's `runIdentityAwarePreproductionChain` body (forbidden by guardrail #2) or wrapping each injected stage runner in a budget-aware decorator. The decorator path was rejected because (a) it introduces partial-tree semantics where stages 1-2 succeed but stage 3 throws, leaving the caller with a thrown error and no `PcdPreproductionChainResult`; (b) on the success path, mid-chain saves nothing since the chain still runs to completion; (c) on the failure path, mid-chain saves only one stage's worth of LLM compute, which is bounded by `maxBranchFanout` itself (operator-chosen). Post-chain is the correct gate point because **SP10B's job is to stop production fanout, not to stop brainstorming compute**. The argument for this is that operator brief breadth bounds chain compute by `maxBranchFanout` choice; production-asset count is the real cost-explosion vector.

3. **`PcdIdentityContext.treeBudget` reserved slot stays `null` in SP10B.** SP8 reserved `PcdIdentityContext.treeBudget: PreproductionTreeBudgetSchema.nullable()`, populated as `null` by `buildPcdIdentityContext`. SP10B does NOT populate this slot — populating it would require editing `buildPcdIdentityContext.ts` (forbidden). Instead, the budget lives in SP10B's orchestrator runtime closure (resolved via injected reader, passed to the validator). **Consequence:** stage runners cannot read the budget during chain execution. They have no need to today (no stage-internal budget-aware behavior is in scope), but a future slice that wants stage-aware budgets (e.g. "stop generating motivators once branch fanout would exceed X") would need to either edit `buildPcdIdentityContext` (still forbidden) or thread the budget through stage-runner injection (a new SP10D-shaped seam). Reserved slot stays reserved.

4. **`StaticDefaultBudgetReader` defaults are operator-arbitrary.** The stub reader returns `{ maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null }` for all calls. These numbers are placeholders for local development and tests; production wiring at merge-back swaps in a Switchboard-side reader that fetches per-organization (with brief-level override) from a real `OrganizationBudget` table. **Why accepted:** picking real defaults is a Switchboard product decision, not a PCD-vertical-engineering decision. The numbers are loud-stub values that test-deterministic and obviously-not-production.

5. **No Prisma migration; no per-asset persistence change.** SP10B is pure orchestration. A successful budget gate is silent (chain proceeds; SP10A/SP9/SP4 stamping unchanged). A failed budget gate throws before any per-asset write — there is no row to stamp. Forensic trail at merge-back lives in WorkTrace via `// MERGE-BACK: emit WorkTrace here` markers (success-with-budget-snapshot AND violation-with-observed-tree-shape both recorded). Trade-off: there is no in-tree persistence of "campaign X passed budget Y at time Z" — that lives entirely in WorkTrace. SP10C may add a flat `treeBudgetVersionAtGate` column once the cost-gate is settled and analytics needs emerge.

6. **`StaticDefaultBudgetReader.resolveBudget()` returns the same budget regardless of `briefId` or `organizationId`.** Brief-level overrides and per-org budgets are merge-back concerns. The reader contract surfaces both inputs so the production reader can use them; the stub ignores both. **Why accepted:** mirrors SP10A `StubCostEstimator`'s ignore-most-inputs posture. Loud-stub values are clearer than fake-realism.

7. **Refused-decision (return value) refusal semantics rejected; throw is the only path.** SP6's lifecycle gates use refused-decision return values because rejection is a normal lifecycle state (operator approves, operator rejects). Budget violation is a _configuration_ error or _brief-too-broad_ error — throw is the right shape. Caller catches `TreeBudgetExceededError`, surfaces to dashboard, operator either raises budget or trims brief and retries. **Why accepted:** matches SP6/SP7/SP9 throw-and-propagate-raw discipline. No try/catch in any prior PCD source. SP10B continues that.

8. **Pruning (silently truncate selectedScriptIds to fit budget) rejected.** "Which N of M scripts do you keep?" is not orchestrator-deterministic — needs operator review or scoring (creator-fit, predicted CTR, brand-safety). SP10B has none of those signals locked. Pruning silently would mask configuration errors and produce non-reproducible chain runs. **Why accepted:** throwing is reversible at the operator layer; pruning is irreversible at the data layer.

9. **Anti-pattern test #5 carry-over from SP10A: 27-field row spot-check.** SP10B has no new persistence row, so this finding is non-applicable to SP10B. SP10B's anti-pattern tests focus on orchestration purity (no edits to SP1-SP10A bodies, throw-not-mutate selection, composer-only version pinning, no forbidden imports).

10. **`fanoutDecisionId` convention (SP9 risk #4 / SP10A risk #4 carry-over) NOT resolved by SP10B.** SP10B's gate fires before fanout, so the convention is not load-bearing for this slice. Inherited unchanged. SP10C may need to lock it if the cost-gate writes a per-decision forensic record; SP10B does not.

11. **3-way invariant duplication (SP4/SP9/SP10A lock-step) does NOT extend to SP10B.** SP10B is a chain-level gate, not a per-asset writer. It does not call `assertTier3RoutingDecisionCompliant` and does not persist a `PcdIdentitySnapshot`. The lock-step assertion in `sp10a-anti-patterns.test.ts` continues to apply only to the three writer paths; SP10B is structurally outside that scope.

12. **Bare `writePcdIdentitySnapshot` callsite (SP9 risk #4 / SP10A risk #2 carry-over) NOT closed by SP10B.** SP10B gates the chain, not per-asset writes. Bare-writer callsites continue to be valid for tests and ad-hoc backfills. SP10B does not enforce "production callsites must include cost data" — that remains a runner-discipline concern at merge-back.

13. **`PcdProductionFanoutDecision.costForecast` slot stays `null` (SP10A risk #1 carry-over).** SP10B does not populate this gate-time cost slot. SP10C, with its coarse pre-routing estimator, is the natural slice to fill it.

14. **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts` continues as baseline noise (now 10 slices deferred).** SP10B does not fix it. The line is "this slice changes only its own files."

15. **Throw-on-violation produces a non-resumable chain.** A budget-exceeded error means the operator has to revise the brief or raise the budget and re-run from scratch. Mid-chain checkpointing (resume from last-good stage with a higher budget) is not in scope. **Why accepted:** chain runs are minutes, not hours, in the merge-back-time real-runner world; resumability adds substantial state-machine complexity for marginal value. SP10B keeps it simple.

16. **Dual-mode operation (gated vs. ungated) is permitted.** A `null` budget return from `Sp10bBudgetReader.resolveBudget()` bypasses the gate; a non-null return enforces. In production this means some orgs run gated and some don't, depending on what the merge-back-time reader returns. **Why accepted:** rollout-friendly — orgs that haven't opted in continue to behave identically to pre-SP10B. **Mitigation:** WorkTrace marker `budget resolved (value or null)` records which mode each chain ran in; analytics can reconcile bypass rate per org. If global enforcement becomes a requirement, a future slice can flip null-return semantics from "bypass" to "throw `BudgetUnconfiguredError`" — that's a one-line orchestrator change, not a re-design.

17. **`treeSize` includes trends (operator-mental-model gap).** The validator counts every chain node (`trends + motivators + hooks + scripts`) toward `maxTreeSize`. Operators may intuitively read `maxTreeSize: 50` as "50 final scripts/assets" but the actual semantics are "50 chain nodes total." A budget of `{maxTreeSize: 50}` against the SP8 stub chain (2 trends + 4 motivators + 12 hooks + 24 scripts = 42) leaves only 8 nodes of headroom, not 26. **Why accepted:** all nodes incur LLM compute cost at merge-back; counting only leaves would let upstream stages (which can be expensive on real models) escape the budget. **Mitigation:** the ValidateTreeShapeOutput exposes `observedTreeSize` and per-stage counts (see §4.6 below) so dashboard UX can render the breakdown explicitly. Operator-facing UI at merge-back must label the field as "max chain nodes (trends + motivators + hooks + scripts)" rather than "max scripts."

18. **Compute-waste post-chain assumption load-bearing.** The post-chain enforcement choice rests on the assumption that **fanout cost >> brainstorming cost**. A 24-script tree might cost ~$50 to brainstorm at merge-back-time real-runner cost but ~$5,000 to fanout into production assets. If upstream stages become expensive (multi-agent stages, longer contexts, agentic-search runners), this assumption can break. **Why accepted:** valid for the current single-shot LLM stage-runner architecture. **Mitigation:** a future slice that invalidates the assumption (e.g. SP12 multi-agent stages) is the trigger to revisit mid-chain enforcement via the decorator path. SP10B does not foreclose that future; it just defers it.

---

## 1. Mission

Land tree-shape enforcement for the PCD pre-production chain so brief breadth cannot silently produce production fanout that exceeds operator-set ceilings. SP10B is the **first slice with abort/prune authority** in the PCD vertical — every prior slice (SP1–SP10A) was forecast-only. SP10B WILL throw on budget violation. Cost is observability (SP10A); count is enforcement (SP10B).

Today the gap is structural:

- **SP7** runs `trends → motivators → hooks → creator scripts` and ends at a `ProductionFanoutGate` that selects scripts. There is no upper bound on the number of scripts the chain can produce. A poorly-constrained brief could surface 1,000 scripts and proceed to fanout-write 1,000 `PcdIdentitySnapshot` rows.
- **SP8** widened stub fanout to `2 → 4 → 12 → 24 scripts` and reserved `PreproductionTreeBudgetSchema { maxBranchFanout, maxTreeSize }` as a slot on `PcdIdentityContext`, populated `null`. The SP10B-shaped enforcement contract was named there but unimplemented.
- **SP10A** stamped per-asset cost forensically. Operators can now answer _"what did this asset cost?"_ in retrospect but cannot answer _"will this campaign fanout exceed our ceiling?"_ prospectively.
- **SP10C (planned)** will close the dollar-gate gap with a coarse pre-routing estimator. SP10B is the count-gate predecessor.

SP10B closes the count-gap with one widened schema (`maxEstimatedUsd: z.number().positive().nullable()` slot reserved for SP10C), one new pinned constant (`PCD_TREE_BUDGET_VERSION` — the 14th), one new error class (`TreeBudgetExceededError`), one new injected reader (`Sp10bBudgetReader`), one pure validator (`validateTreeShapeAgainstBudget`), and one new top-level orchestrator (`runIdentityAwarePreproductionChainWithBudget`). No Prisma migration. No edits to SP1-SP10A source bodies.

---

## 2. Hard guardrails (inherited from SP1–SP10A — not negotiable)

1. **Pure orchestration in `packages/creative-pipeline/src/pcd/`.** Persistence (none in SP10B) goes through injected store interfaces with concrete Prisma implementers in `packages/db/`.
2. **No edits to SP1–SP10A source bodies.** SP10B widens schemas additively. SP7's `runIdentityAwarePreproductionChain`, SP8's `buildPcdIdentityContext`, and every SP4/SP9/SP10A writer/orchestrator body are NOT mutated. SP10B ships a new top-level orchestrator (`runIdentityAwarePreproductionChainWithBudget`) that COMPOSES SP7's chain (calls it as a pure function — does not duplicate stage execution).
3. **Pinned version constant per new decision surface.** SP10B adds `PCD_TREE_BUDGET_VERSION = "pcd-tree-budget@1.0.0"` (14th constant in the PCD slice).
4. **`// MERGE-BACK:` markers** at every new state transition / external-system seam.
5. **Anti-pattern grep tests + forbidden-imports tests** on every new module. Ship `sp10b-anti-patterns.test.ts` (extends SP7/SP8/SP9/SP10A patterns).
6. **Composer-only version pinning (SP8 lock).** The validator imports `PCD_TREE_BUDGET_VERSION` from a sibling const file. No reader, error class, or orchestrator file may contain the literal `"pcd-tree-budget@"` — anti-pattern grep enforces.
7. **Identity context immutability (SP8 lock).** SP10B does NOT populate `PcdIdentityContext.treeBudget` (would require editing `buildPcdIdentityContext`). Slot stays null.
8. **Forecast-only invariant (SP10A lock) does NOT extend to SP10B.** SP10B is the FIRST slice with abort/prune authority. The SP10A anti-pattern test #4 (no `throw new` followed by budget-related error class) explicitly does NOT apply to `pcd/budget/` — `TreeBudgetExceededError` is the canonical SP10B-introduced exception. SP10B's own anti-pattern tests assert this asymmetry: throw is _required_, mutation of selectedScriptIds is _forbidden_.
9. **3-way SP4/SP9/SP10A invariant lock-step does NOT extend to SP10B.** SP10B is chain-level, not per-asset. It does not call `assertTier3RoutingDecisionCompliant`.
10. **Per CLAUDE.md:** ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft limit, `pnpm exec prettier --check`. `pnpm lint` is structurally broken on origin/main per SP5 baseline note — use prettier as the practical style gate.

---

## 3. Architectural locks (Q1–Q16)

### Q1 — Scope: count-only enforcement (`maxBranchFanout` + `maxTreeSize`); cost-gate (`maxEstimatedUsd`) deferred to SP10C

The original SP10 plan listed both concerns together, then SP10A split off cost-forecast wiring. Locked decision: **SP10B is count-only; SP10C will land the cost-gate**.

**Why split again:** count is structurally answerable post-chain (the chain produces a tree of known shape; counting children-per-parent and total nodes is pure arithmetic on the result). Cost is structurally NOT answerable at gate time under SP10A's locked contract — provider/model/shotType/outputIntent are unknown until SP4 routing runs, which is downstream of fanout. A cost-gate needs a _coarse pre-routing estimator_ (SP10A §0 risk #11), which is a whole new contract surface worth its own slice.

**Hard SP10B guardrail (inherits to all sub-decisions):** SP10B records budget-resolved-and-enforced facts via WorkTrace markers and the orchestrator's success/failure path. No cost-numeric comparisons. The schema slot is widened with `maxEstimatedUsd: z.number().positive().nullable()` always-null in SP10B, populated by SP10C.

**Rejected alternatives:**

- (A) Tree-shape only, no schema widen — punts SP10C to also widen the schema, which is fine but loses SP10B's chance to forward-declare the slot. The slot widening is one line; eating it now is cheaper than a second `pcd-preproduction.ts` edit later.
- (B) Full enforcement (count + cost) in SP10B — needs the coarse-estimator contract surface, which would balloon the slice. Coupled version pins (`PCD_TREE_BUDGET_VERSION` + `PCD_COARSE_COST_ESTIMATOR_VERSION`) evolving at different cadences in one squash is the same anti-pattern that drove SP10A/SP10B split.

### Q2 — Enforcement point: post-chain validator (option C)

The chain runs to completion. The orchestrator validates the resulting tree shape against the budget. Throw on violation; otherwise return the unchanged `PcdPreproductionChainResult`.

**Why post-chain (not mid-chain decorators or pre-chain feasibility):**

| Option                      | Choice | Rationale                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-chain feasibility gate  | ❌     | Tree size is unknown pre-chain. Real Claude-driven runners produce variable fanout. Pre-chain gate could only validate `budget.maxBranchFanout >= 1 && budget.maxTreeSize >= 1` — useless for actual enforcement. Theater.                                                                                                                                                                                      |
| Mid-chain decorator runners | ❌     | Wrapping each injected `TrendsStageRunner`/`MotivatorsStageRunner`/etc with a budget-aware decorator is structurally clean (composer body untouched) but introduces partial-tree semantics. Stages 1-2 succeed, stage 3 throws → caller sees error and no `PcdPreproductionChainResult`. Sunk LLM cost is the same as post-chain on success path; saves only one stage on failure path; breaks chain atomicity. |
| Post-chain validator        | ✅     | Composer body untouched (orchestrator wraps composer call). Chain runs to completion or not at all (atomic). Validation is pure arithmetic on the tree shape. Matches SP9/SP10A "validate at the boundary" precedent.                                                                                                                                                                                           |
| Hybrid (mid + post)         | ❌     | Two enforcement paths; coherence overhead; no proportional benefit.                                                                                                                                                                                                                                                                                                                                             |

**Where SP10B sits in the call chain:**

```
Caller (merge-back-time production runner)
  └─> runIdentityAwarePreproductionChainWithBudget(brief, stores)   [SP10B — NEW]
        ├─> budgetReader.resolveBudget(briefId, organizationId)
        ├─> runIdentityAwarePreproductionChain(brief, stores)       [SP7 — UNCHANGED]
        │     └─> trends → motivators → hooks → scripts → gate
        └─> validateTreeShapeAgainstBudget(result, budget)
              └─> throw TreeBudgetExceededError | return ok
```

### Q3 — Source of budget value: injected `Sp10bBudgetReader` interface, per-org default + brief-level override slot

Locked contract:

```ts
// MERGE-BACK: replace with Switchboard org-budget reader (production reads
// per-organization defaults with brief-level overrides from OrganizationBudget table).
export type Sp10bBudgetReaderInput = {
  briefId: string;
  organizationId: string | null;
};

export type Sp10bBudgetReader = {
  resolveBudget(input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null>;
};
```

**Why injection (not hardcoded global default, not new Prisma table in SP10B):**

| Option                                         | Choice | Rationale                                                                                                                                                                                                                                |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded global default constant              | ❌     | Useless for production. Per-org budgets are inevitable; pretending they're not delays the inevitable schema work.                                                                                                                        |
| New `OrganizationBudget` Prisma table in SP10B | ❌     | Production schema for budget tables is a Switchboard product decision (column shape, FK to organization, override semantics). Building it here would force merge-back-time reconciliation of a table whose shape we picked unilaterally. |
| Injected `Sp10bBudgetReader` interface         | ✅     | Mirrors SP4 `CampaignTakeStore`, SP5 QC providers, SP10A `CostEstimator` precedent exactly. Switchboard owns the table. SP10B owns the contract.                                                                                         |

**Why `briefId` AND `organizationId` (both nullable for organizationId only):**

- `briefId` is always present (`PcdBriefInput.briefId` is required).
- `organizationId` is nullable because not every callsite has org context (SP7 stub tests don't; ad-hoc tools may not). The reader's production implementation can require it; the stub reader and SP10B's tests work with `null`.
- Per-org default + brief-level override is implementable inside the production reader — SP10B's contract surfaces both inputs without locking the resolution semantics.

**Why `null` return (not throw):**

Returning `null` means "no budget configured for this brief/org." The orchestrator interprets `null` as "no gate" and proceeds without enforcement. This is the correct behavior for legacy briefs and pre-SP10B-rollout scenarios — a budget reader that returns `null` makes the orchestrator behaviorally equivalent to calling `runIdentityAwarePreproductionChain` directly.

The ONLY path to enforcement is a non-null budget. The orchestrator does not synthesize defaults. **`StaticDefaultBudgetReader` always returns a non-null budget** (the loud-stub values), so tests and local dev exercise the enforcement path; production wiring at merge-back may return `null` for orgs that haven't opted in.

### Q4 — Skipped (was cost-gate enforcement — out of SP10B scope per Q1=C lock)

The schema slot widening (`maxEstimatedUsd`) is the only cost-related touch in SP10B. The orchestrator structurally asserts `budget.maxEstimatedUsd === null` at gate time and throws `InvariantViolationError("maxEstimatedUsd is reserved for SP10C", { budget })` if non-null.

**Why the explicit assertion (not silent ignore):** loud-fail on misconfiguration. A reader that returns a non-null `maxEstimatedUsd` in SP10B-time is either a future-bug (SP10C reader wired before SP10C ships) or a misconfiguration. Throwing is more discoverable than silently ignoring.

### Q5 — Skipped (was budget source — covered by Q3)

### Q6 — Refusal semantics: throw `TreeBudgetExceededError`

New error class (`pcd/budget/tree-budget-exceeded-error.ts`). Carries the validator's full output (lossless): the budget in effect, the priority-ordered reason, every level's observed fanout, every level whose fanout exceeded the budget, and per-stage counts.

```ts
import type { PreproductionTreeBudget } from "@creativeagent/schemas";
import type { FanoutLevelObservation, TreeShapeMeta } from "./tree-shape-validator.js";

export class TreeBudgetExceededError extends Error {
  readonly reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
  readonly budget: PreproductionTreeBudget;
  readonly violations: readonly FanoutLevelObservation[];
  readonly meta: TreeShapeMeta;

  constructor(args: {
    reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
    budget: PreproductionTreeBudget;
    violations: readonly FanoutLevelObservation[];
    meta: TreeShapeMeta;
  }) {
    super(`tree budget exceeded: ${args.reason}`);
    this.name = "TreeBudgetExceededError";
    this.reason = args.reason;
    this.budget = args.budget;
    this.violations = args.violations;
    this.meta = args.meta;
  }
}
```

The error carries enough operator-forensic context to surface to a dashboard: which budget was in effect (`budget`), which dimension blew (`reason`), per-stage counts (`meta.perStageCounts`), all three fanout levels with their top parents (`meta.fanoutLevels`), and the specific levels that exceeded the budget on `max_branch_fanout_exceeded` (`violations`).

**Why throw (not refused-decision return value, not prune):** see §0 risks #7 and #8.

### Q7 — Module placement: `pcd/budget/` sibling subdir

Files land in `packages/creative-pipeline/src/pcd/budget/`. Sibling to `pcd/preproduction/` (SP7/SP8), `pcd/provenance/` (SP9), `pcd/cost/` (SP10A). Rationale:

- Tree-budget enforcement is structurally an additive, isolated concern with its own version constant, anti-pattern test, and barrel.
- Sibling subdir matches every prior synergy-slice precedent.
- No circular dependency: `pcd/budget/` imports from `pcd/preproduction/` (chain types, composer call) and from `pcd/` top-level (`InvariantViolationError`). Reverse direction does not exist.

### Q8 — Backfill / migration: schema widen only (no Prisma migration)

- **`PreproductionTreeBudgetSchema`** in `packages/schemas/src/pcd-preproduction.ts` widens from:

  ```ts
  z.object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
  }).readonly();
  ```

  to:

  ```ts
  z.object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
    maxEstimatedUsd: z.number().positive().nullable(), // SP10C populates; null in SP10B
  }).readonly();
  ```

- **No new column on `PcdIdentitySnapshot`, `PcdProductionFanoutDecision`, or any other Prisma model.** SP10B is pure orchestration. WorkTrace at merge-back captures the gate decision; in-tree persistence captures only successful chain results, which already flow through SP9/SP10A stamping unchanged.

- **No edits to `PcdIdentityContextSchema`.** The `treeBudget: PreproductionTreeBudgetSchema.nullable()` slot stays as it is. Pre-existing rows that emit `null` parse cleanly under the widened schema (zod treats absent optional inner-fields as `undefined`, but `maxEstimatedUsd` is not optional — it's nullable).

  **Schema-evolution audit (performed at design time):** `PreproductionTreeBudgetSchema` is `.readonly()` and now adds a non-optional `maxEstimatedUsd: z.number().positive().nullable()`.
  - **`src/`:** zero literal-construction sites. `buildPcdIdentityContext` writes literal `null` for the outer `PcdIdentityContext.treeBudget`; no inner `PreproductionTreeBudget` literal exists anywhere in `packages/creative-pipeline/src/`.
  - **`packages/schemas/src/__tests__/pcd-preproduction.test.ts`:** **4 existing test fixtures** at approximately lines 437, 443, 446, 452 construct `{ maxBranchFanout: N, maxTreeSize: N }` literals and call `PreproductionTreeBudgetSchema.safeParse(...)` on them. These tests WILL break under the widen because the new field is non-optional. The plan task that performs the schema widen MUST update these fixtures in the same commit — adding `maxEstimatedUsd: null` to each, and adding 2-3 NEW tests asserting the new field's nullable+positive contract (per Q14).
  - **One existing test at ~line 457** asserts "rejects missing maxTreeSize" — that test continues to pass under the widen (incomplete-input rejection is preserved). No change needed beyond schema-driven re-parse semantics.

  The widening is structurally safe — it forces every constructor to acknowledge SP10C's reserved field. Schema changes and the corresponding test-fixture updates ship in the same commit per CLAUDE.md ("Schema changes require a Prisma migration in the same commit"; analogous discipline applies to zod-schema changes that break call sites).

### Q9 — Reader composition with SP7 stores: PreproductionChainStores intersection

The orchestrator's stores type is:

```ts
export type RunIdentityAwarePreproductionChainWithBudgetStores = PreproductionChainStores & {
  budgetReader: Sp10bBudgetReader;
  organizationId?: string | null;
};
```

Intersection, not extension or replacement. Caller passes one stores object with all SP7 fields PLUS `budgetReader` PLUS optional `organizationId`. The orchestrator forwards SP7 stores to the inner `runIdentityAwarePreproductionChain(brief, stores)` call unchanged.

**Why intersection (not extension via `extends`):**

`PreproductionChainStores` is a `type =` alias, not an interface. Intersection is the idiomatic TS pattern for type-alias composition. Mirrors `WritePcdIdentitySnapshotWithCostForecastStores = StampPcdProvenanceStores & StampPcdCostForecastStores` precedent in SP10A.

**Why `organizationId` lives on the stores object (not on `PcdBriefInput` and not as a third positional parameter):**

`PcdBriefInput` cannot be widened — guardrail #2 forbids edits to SP7 schemas. A third positional parameter would diverge from SP7's `(brief, stores)` shape. Hanging `organizationId` off the SP10B stores extension is the least-disruptive seam: it's optional (nullable via `?` and `null`), it's SP10B-only, and it does not leak into the SP7 chain call (the orchestrator doesn't forward it to SP7's stage runners). Documented here so the plan stage doesn't second-guess; merge-back-time refactor (e.g. introducing a top-level `OrgContext` type carried alongside brief in all chain calls) would be a separate, post-SP10B concern.

### Q10 — Validator interface: pure function, no stores, no async; rich per-level reporting

```ts
// pcd/budget/tree-shape-validator.ts
export type ValidateTreeShapeInput = {
  result: PcdPreproductionChainResult;
  budget: PreproductionTreeBudget;
};

// Per-fanout-level observed maximum (always populated, success or fail).
// Lossless — neither path collapses information.
export type FanoutLevelObservation = {
  level: "motivators_per_trend" | "hooks_per_motivator" | "scripts_per_hook";
  parentId: string;
  fanout: number;
};

// Always-populated tree-shape facts. Surfaced on both ok and fail paths so
// callers (and dashboard UX) can render the breakdown without a second walk.
export type TreeShapeMeta = {
  treeBudgetVersion: string;
  observedTreeSize: number;
  observedMaxBranchFanout: number;
  perStageCounts: {
    trends: number;
    motivators: number;
    hooks: number;
    scripts: number;
  };
  // All three fanout levels, sorted by fanout desc (ties broken by stable
  // level order: motivators_per_trend → hooks_per_motivator → scripts_per_hook).
  // Length always 3 (one entry per fanout level).
  fanoutLevels: readonly FanoutLevelObservation[];
};

export type ValidateTreeShapeOutput =
  | {
      ok: true;
      meta: TreeShapeMeta;
    }
  | {
      ok: false;
      // Validation priority lock: tree size is checked FIRST. If both
      // dimensions are exceeded, reason is always "max_tree_size_exceeded".
      reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
      // For "max_branch_fanout_exceeded": all fanout-level violations, sorted
      // by fanout desc (length 1-3). For "max_tree_size_exceeded": empty
      // (operator-relevant violations are at the size dimension, not per-parent).
      violations: readonly FanoutLevelObservation[];
      meta: TreeShapeMeta;
    };

export function validateTreeShapeAgainstBudget(
  input: ValidateTreeShapeInput,
): ValidateTreeShapeOutput;
```

Pure synchronous function. Zero I/O, zero stores. Sole import site for `PCD_TREE_BUDGET_VERSION` (composer-only version pinning lock #6 — anti-pattern test enforces).

**Validation priority lock (explicit):**

> **Tree size is checked first; branch fanout second. If both dimensions are exceeded, the reason is always `"max_tree_size_exceeded"`.**

Rationale: `maxTreeSize` is the operator-facing total-cost ceiling; `maxBranchFanout` is a shape constraint that prevents a single parent from dominating the tree. The total-cost ceiling is the more important constraint to surface — operators reading a violation will see the headline cost issue first. Documented here, asserted by anti-pattern test #9 (new), and unit-tested in `tree-shape-validator.test.ts` with a fixture that violates both dimensions and asserts `reason === "max_tree_size_exceeded"`.

**Lossless fanout reporting (replaces single `parentIdAtViolation`):**

The original draft collapsed "which level had the highest fanout" into a single `parentIdAtViolation` string, which is lossy when two levels have the same maximum AND when multiple levels exceed the budget simultaneously. The revised contract returns:

- `meta.fanoutLevels`: ALWAYS three entries (motivators_per_trend, hooks_per_motivator, scripts_per_hook), each with the top-fanout parent at that level. Surfaced on success AND failure paths so dashboard UX can render full per-level breakdown.
- `violations` (failure path only, populated only when `reason === "max_branch_fanout_exceeded"`): every level whose top-fanout exceeded `budget.maxBranchFanout`, sorted by fanout desc. Length 1-3. Operator can see ALL failing levels, not just the arbitrarily-picked first.
- `meta.observedMaxBranchFanout`: scalar — the max across all three levels. Convenience for callers that just want one number.

**Always-populated `meta` exposes computed shape on success path** (Q-tightening from review): callers can log the tree breakdown, render UI previews, or feed analytics WITHOUT walking the tree themselves. The orchestrator forwards this `meta` to the caller (see Q-extension-Q16 below).

**Tree-shape arithmetic:**

```
const { trends, motivators, hooks, scripts } = result.stageOutputs;
const perStageCounts = {
  trends: trends.signals.length,
  motivators: motivators.motivators.length,
  hooks: hooks.hooks.length,
  scripts: scripts.scripts.length,
};
const observedTreeSize =
  perStageCounts.trends + perStageCounts.motivators +
  perStageCounts.hooks + perStageCounts.scripts;

// Compute top-fanout parent per level.
const motivatorsPerTrend = topFanout(motivators.motivators, m => m.parentTrendId);
const hooksPerMotivator  = topFanout(hooks.hooks,           h => h.parentMotivatorId);
const scriptsPerHook     = topFanout(scripts.scripts,       s => s.parentHookId);

const fanoutLevels: FanoutLevelObservation[] = [
  { level: "motivators_per_trend", parentId: motivatorsPerTrend.parentId, fanout: motivatorsPerTrend.fanout },
  { level: "hooks_per_motivator",  parentId: hooksPerMotivator.parentId,  fanout: hooksPerMotivator.fanout  },
  { level: "scripts_per_hook",     parentId: scriptsPerHook.parentId,     fanout: scriptsPerHook.fanout     },
].sort((a, b) => b.fanout - a.fanout);

const observedMaxBranchFanout = fanoutLevels[0].fanout;
const meta = { treeBudgetVersion: PCD_TREE_BUDGET_VERSION, observedTreeSize,
               observedMaxBranchFanout, perStageCounts, fanoutLevels };

// Priority: size first, fanout second.
if (observedTreeSize > budget.maxTreeSize) {
  return { ok: false, reason: "max_tree_size_exceeded", violations: [], meta };
}
const violations = fanoutLevels.filter(f => f.fanout > budget.maxBranchFanout);
if (violations.length > 0) {
  return { ok: false, reason: "max_branch_fanout_exceeded", violations, meta };
}
return { ok: true, meta };
```

The validator returns a structured result (not throwing directly) so the orchestrator can decide how to surface it. Orchestrator throws `TreeBudgetExceededError` on `ok: false` (carrying `meta` + `reason` + `violations` for operator forensics). The validator's output shape is testable in isolation — pure-function unit tests assert tree-counting, sorting, and priority correctness.

**Edge cases:**

- Empty arrays: chain output min-1 length per stage (SP7 schemas enforce). Validator does NOT defensively re-check; trusts SP7.
- Trends are top-level (no parent in fanout context); they count toward `observedTreeSize` and `perStageCounts.trends`, but do NOT contribute a `FanoutLevelObservation`. The branch-fanout dimension is per-parent — root has no parent.
- `observedTreeSize` includes trends. **Decision:** include them. Reason: operator setting `maxTreeSize: 50` means "I will not pay for more than 50 generated artifacts in this chain," and trends are generated artifacts (LLM tokens at merge-back). See §0 risk #17 for the operator-mental-model trade-off and dashboard-labeling guidance.
- All three fanout levels tied at the same max value: `meta.fanoutLevels` sort is stable so insertion order (motivators_per_trend → hooks_per_motivator → scripts_per_hook) breaks the tie. Documented and unit-tested.

### Q11 — Orchestrator failure semantics

| Failure mode                                           | Throws                                                                                         | Caught by orchestrator?                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `budgetReader.resolveBudget()` throws                  | Whatever the reader throws                                                                     | No — propagated raw                                          |
| `budgetReader.resolveBudget()` returns null            | (no throw — gate is skipped)                                                                   | N/A — orchestrator returns `{ result, budgetMeta: null }`    |
| `budget.maxEstimatedUsd !== null`                      | `InvariantViolationError`                                                                      | No — propagated raw                                          |
| `runIdentityAwarePreproductionChain()` throws          | `PreproductionChainError`, `ConsentRevokedRefusalError`, `ZodError`, `InvariantViolationError` | No — propagated raw                                          |
| `validateTreeShapeAgainstBudget()` returns `ok: false` | `TreeBudgetExceededError` thrown by orchestrator (carries `meta` + `violations`)               | N/A — orchestrator throws after pure validator returns false |
| `validateTreeShapeAgainstBudget()` returns `ok: true`  | (no throw — `{ result, budgetMeta: validation.meta }` returned)                                | N/A                                                          |

**No try/catch in any SP10B source.** Same propagation rule as SP9, SP10A. Anti-pattern test could be extended to enforce, but SP9/SP10A don't add this assertion explicitly; SP10B doesn't either. Style baseline.

### Q12 — Public surface

```ts
// packages/creative-pipeline/src/pcd/budget/index.ts
export { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
export { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
export type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";
export {
  StaticDefaultBudgetReader,
  STATIC_DEFAULT_BUDGET_READER_VERSION,
  STATIC_DEFAULT_BUDGET,
} from "./static-default-budget-reader.js";
export {
  validateTreeShapeAgainstBudget,
  type ValidateTreeShapeInput,
  type ValidateTreeShapeOutput,
  type TreeShapeMeta,
  type FanoutLevelObservation,
} from "./tree-shape-validator.js";
export {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "./run-identity-aware-preproduction-chain-with-budget.js";
```

Re-exported from package barrel `packages/creative-pipeline/src/index.ts`.

### Q13 — Anti-pattern grep tests (SP10B-specific)

Ship `sp10b-anti-patterns.test.ts` with 9 structural assertions:

1. **Composer-only version pinning.** Only `tree-budget-version.ts` AND `tree-shape-validator.ts` (the importer) contain the literal `"pcd-tree-budget@"`. No reader, error class, or orchestrator file contains the literal.
2. **Throw-not-mutate selection.** No SP10B source contains `selectedScriptIds =`, `availableScriptIds =`, `.push(`, `.splice(`, or `.pop(` against either array. SP10B asserts the SP10A forecast-only mutation prohibition without inheriting the no-throw prohibition.
3. **Throw discipline — SP10B source DOES contain `throw new TreeBudgetExceededError`** in the orchestrator (positive assertion: catches accidental "return false" refactors that lose the throw).
4. **No edits to SP1–SP10A source bodies.** Read-only `git diff afa16de HEAD` against the SP1–SP10A source-body file list returns empty diffs (allowlist for barrels, schema widen, prisma store, package.json, etc.).
5. **Forbidden imports.** No SP10B source imports `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `node:http`, `node:https`, `crypto` (test exempts itself; the SP10B-baseline anti-pattern test reads file contents via `node:fs` — same pattern as SP10A test).
6. **Schema slot widening.** `pcd-preproduction.ts` `PreproductionTreeBudgetSchema` contains the literal `maxEstimatedUsd: z.number().positive().nullable()` (regex assertion). Catches accidental field removal during refactor.
7. **`maxEstimatedUsd === null` invariant.** Orchestrator file contains the literal `budget.maxEstimatedUsd !== null` followed by an `InvariantViolationError` throw. Catches accidental SP10C-bleed where someone removes the assertion.
8. **Reader contract immutability.** `sp10b-budget-reader.ts` source contains all required-shape declarations (`briefId`, `organizationId`, `resolveBudget`). Catches accidental field removal in the contract.
9. **Validation priority lock.** `tree-shape-validator.ts` source contains the literal `observedTreeSize > budget.maxTreeSize` BEFORE (by line number) any reference to `budget.maxBranchFanout`. Catches accidental priority reordering during refactor — the size-first contract is documented in Q10 and load-bearing for the operator-mental-model alignment.

### Q14 — Co-located tests

| File                                                         | Test count | What it asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tree-budget-version.test.ts`                                | 1          | Constant equals exact literal `"pcd-tree-budget@1.0.0"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tree-budget-exceeded-error.test.ts`                         | 5          | Construction, name, message format, `meta` carry-through, `violations` carry-through (length 0 for size-violation, length 1-3 for fanout-violation).                                                                                                                                                                                                                                                                                                                                                                                              |
| `static-default-budget-reader.test.ts`                       | 4–5        | Determinism (any input → same default), STATIC_DEFAULT_BUDGET shape (3 fields including `maxEstimatedUsd: null`), ignores briefId/organizationId, returns non-null budget always, version constant.                                                                                                                                                                                                                                                                                                                                               |
| `tree-shape-validator.test.ts`                               | 12–14      | Happy path (within budget — asserts `meta` populated with all 3 fanout levels), max_tree_size_exceeded (asserts `violations: []`), max_branch_fanout_exceeded for each level (motivators-per-trend, hooks-per-motivator, scripts-per-hook), multi-level fanout violation (asserts `violations` length=2 sorted desc), priority lock (BOTH dimensions exceeded → `reason === "max_tree_size_exceeded"`), tied-fanout stable sort, SP8-stub-shape passes default budget (2→4→12→24 with {5, 50, null} → ok), exact-limit edge, exactly-1-over edge. |
| `run-identity-aware-preproduction-chain-with-budget.test.ts` | 10–12      | Full orchestrator happy path returns `{ result, budgetMeta }` with `budgetMeta` populated, null-budget bypass returns `{ result, budgetMeta: null }`, non-null `maxEstimatedUsd` throws InvariantViolationError, chain throws propagated raw (each of 4 chain error classes), validator ok-path forwards `validation.meta` to outcome, validator fail-path throws `TreeBudgetExceededError` with `meta` + `violations` carried, reader call ordering (called before chain), reader throw propagated raw.                                          |
| `pcd-preproduction.test.ts` (schemas, widened)               | +5–6       | Existing 4 fixtures updated with `maxEstimatedUsd: null`. New: widened schema accepts `maxEstimatedUsd: null`, accepts `maxEstimatedUsd: 100`, rejects `maxEstimatedUsd: -1`, rejects `maxEstimatedUsd: 0` (positive excludes zero), rejects missing field (non-optional).                                                                                                                                                                                                                                                                        |
| `sp10b-anti-patterns.test.ts`                                | 9          | Nine structural assertions above (8 original + new validation-priority lock).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Estimated net SP10B test count:** ~46–56. (Net up from the original ~35–45 because Q16's outcome wrapper, Q10's lossless violations, and the priority-lock assertion all need direct test coverage. Still smaller than SP10A's ~40 plus its db adapter tests.)

### Q15 — `// MERGE-BACK:` markers

Six markers, mirroring SP10A's pattern density:

1. `// MERGE-BACK: replace with Switchboard org-budget reader` — on `StaticDefaultBudgetReader` class declaration.
2. `// MERGE-BACK: emit WorkTrace here (budget resolved)` — in orchestrator after `resolveBudget` returns.
3. `// MERGE-BACK: emit WorkTrace here (budget gate passed)` — in orchestrator after validator returns ok.
4. `// MERGE-BACK: emit WorkTrace here (budget gate violated)` — in orchestrator immediately before `throw new TreeBudgetExceededError`.
5. `// MERGE-BACK: surface TreeBudgetExceededError to dashboard with retry-with-raised-budget UI` — on `TreeBudgetExceededError` class declaration.
6. `// MERGE-BACK: SP10C will populate budget.maxEstimatedUsd; SP10B asserts null here` — on the `maxEstimatedUsd !== null` invariant assertion in orchestrator.

### Q16 — Orchestrator return type widens to expose budget meta

The orchestrator does NOT return `Promise<PcdPreproductionChainResult>` directly. Instead it returns a wrapper:

```ts
export type RunPreproductionChainWithBudgetOutcome = {
  result: PcdPreproductionChainResult;
  budgetMeta: TreeShapeMeta | null; // null when reader returned null (gated bypass)
};

export async function runIdentityAwarePreproductionChainWithBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithBudgetStores,
): Promise<RunPreproductionChainWithBudgetOutcome>;
```

**Why widen the return type (Q-tightening from review):**

- **Logging without WorkTrace dependency.** Pre-merge-back, callers want to log "budget resolved at X, observed Y" without needing the WorkTrace markers wired up. The wrapped return surfaces enough to do this.
- **UI preview without a second walk.** Dashboard renders a per-stage breakdown of a successful chain — `budgetMeta.perStageCounts` is already computed; making the caller re-walk the tree to render it would be wasteful.
- **Analytics without WorkTrace.** Test fixtures and ad-hoc analytics get a structured handle on observed shape without parsing log lines.
- **`null` discriminates the gated-bypass case.** Caller can distinguish "ran with no budget" from "ran with budget {X} and was within limits" — useful for rollout monitoring (§0 risk #16 mitigation).
- **Failure path unchanged.** Throw still throws (`TreeBudgetExceededError`); only the success path adds the wrapper. Callers that catch the throw get the same `error.meta` they would have gotten — symmetry with the success-path `outcome.budgetMeta`.

**Trade-off:** the new wrapper is a breaking change for any caller that had treated `runIdentityAwarePreproductionChainWithBudget` as a drop-in for `runIdentityAwarePreproductionChain`. There are zero such callers in-tree (SP10B is net-new); merge-back integration MUST adopt the wrapped shape. Documented in §8 merge-back surfaces.

**Migration note:** if a future caller wants the bare result, they destructure: `const { result } = await runIdentityAwarePreproductionChainWithBudget(...)`. One-line idiom; no helper needed.

---

## 4. What ships

### 4.1 Schema widen (`packages/schemas/src/pcd-preproduction.ts`)

ONE field added to `PreproductionTreeBudgetSchema`:

```ts
export const PreproductionTreeBudgetSchema = z
  .object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
    // SP10B forward-declared; SP10C populates. Always null in SP10B.
    maxEstimatedUsd: z.number().positive().nullable(),
  })
  .readonly();
```

The widening is the only schema edit in SP10B. `PcdIdentityContextSchema.treeBudget` continues to be `PreproductionTreeBudgetSchema.nullable()` — no change to that line.

### 4.2 New pinned constant (`packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts`)

```ts
export const PCD_TREE_BUDGET_VERSION = "pcd-tree-budget@1.0.0";
```

14th pinned constant in the PCD slice. Single import site: `tree-shape-validator.ts`. Anti-pattern test asserts no other source contains the literal `"pcd-tree-budget@"`.

### 4.3 Error class (`packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts`)

See Q6 above. Class extends `Error`. Carries `reason`, `budget`, `violations`, and `meta` (full `TreeShapeMeta`) for operator forensics — symmetric with the success-path `outcome.budgetMeta` so caller's `try`/`catch` can render the same per-stage breakdown as the happy path.

### 4.4 Reader contract (`packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts`)

```ts
import type { PreproductionTreeBudget } from "@creativeagent/schemas";

export type Sp10bBudgetReaderInput = {
  briefId: string;
  organizationId: string | null;
};

export type Sp10bBudgetReader = {
  resolveBudget(input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null>;
};
```

Type-only file. No runtime export.

### 4.5 Stub reader (`packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts`)

```ts
// MERGE-BACK: replace with Switchboard org-budget reader (production reads
// per-organization defaults with brief-level overrides from OrganizationBudget).
// Stub is deterministic for tests + local development. DO NOT add config flags
// or environment-driven fan-in — the swap is by injection, not by feature flag.
import type { PreproductionTreeBudget } from "@creativeagent/schemas";
import type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";

export const STATIC_DEFAULT_BUDGET_READER_VERSION = "static-default-budget-reader@1.0.0";

export const STATIC_DEFAULT_BUDGET: PreproductionTreeBudget = Object.freeze({
  maxBranchFanout: 5,
  maxTreeSize: 50,
  maxEstimatedUsd: null,
});

export class StaticDefaultBudgetReader implements Sp10bBudgetReader {
  async resolveBudget(_input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null> {
    return STATIC_DEFAULT_BUDGET;
  }
}
```

`STATIC_DEFAULT_BUDGET` exported separately for tests + introspection. `STATIC_DEFAULT_BUDGET_READER_VERSION` mirrors SP10A's `STUB_COST_ESTIMATOR_VERSION` precedent.

**Note: SP8-stub fanout (2→4→12→24, total 42) PASSES STATIC_DEFAULT_BUDGET (5, 50)** — observed maxBranchFanout = 3 (hooks-per-motivator) ≤ 5; observed treeSize = 42 ≤ 50. Default-stub-vs-default-budget compatibility is intentional: local dev runs the SP7+SP8 stub chain through SP10B with no budget violation. Tests that exercise the fail path use a tighter test-only budget.

### 4.6 Pure validator (`packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts`)

See Q10 above for the contract definition (`FanoutLevelObservation`, `TreeShapeMeta`, `ValidateTreeShapeOutput`). Pure synchronous function. Sole import site for `PCD_TREE_BUDGET_VERSION`.

```ts
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
import type { PcdPreproductionChainResult, PreproductionTreeBudget } from "@creativeagent/schemas";

// (Type exports — see Q10 for full contract: FanoutLevelObservation,
// TreeShapeMeta, ValidateTreeShapeInput, ValidateTreeShapeOutput.)

export function validateTreeShapeAgainstBudget(
  input: ValidateTreeShapeInput,
): ValidateTreeShapeOutput {
  const { result, budget } = input;
  const { trends, motivators, hooks, scripts } = result.stageOutputs;

  const perStageCounts = {
    trends: trends.signals.length,
    motivators: motivators.motivators.length,
    hooks: hooks.hooks.length,
    scripts: scripts.scripts.length,
  };
  const observedTreeSize =
    perStageCounts.trends +
    perStageCounts.motivators +
    perStageCounts.hooks +
    perStageCounts.scripts;

  // Per-parent top-fanout, one per fanout level.
  const motivatorsPerTrend = topFanout(motivators.motivators, (m) => m.parentTrendId);
  const hooksPerMotivator = topFanout(hooks.hooks, (h) => h.parentMotivatorId);
  const scriptsPerHook = topFanout(scripts.scripts, (s) => s.parentHookId);

  // Stable insertion order; sort by fanout desc preserves it on ties.
  const fanoutLevels: FanoutLevelObservation[] = [
    {
      level: "motivators_per_trend",
      parentId: motivatorsPerTrend.parentId,
      fanout: motivatorsPerTrend.fanout,
    },
    {
      level: "hooks_per_motivator",
      parentId: hooksPerMotivator.parentId,
      fanout: hooksPerMotivator.fanout,
    },
    {
      level: "scripts_per_hook",
      parentId: scriptsPerHook.parentId,
      fanout: scriptsPerHook.fanout,
    },
  ].sort((a, b) => b.fanout - a.fanout);

  const observedMaxBranchFanout = fanoutLevels[0].fanout;

  const meta: TreeShapeMeta = {
    treeBudgetVersion: PCD_TREE_BUDGET_VERSION,
    observedTreeSize,
    observedMaxBranchFanout,
    perStageCounts,
    fanoutLevels,
  };

  // Validation priority lock: tree size FIRST, branch fanout SECOND.
  // If both are exceeded, reason is always "max_tree_size_exceeded".
  if (observedTreeSize > budget.maxTreeSize) {
    return { ok: false, reason: "max_tree_size_exceeded", violations: [], meta };
  }

  const violations = fanoutLevels.filter((f) => f.fanout > budget.maxBranchFanout);
  if (violations.length > 0) {
    return { ok: false, reason: "max_branch_fanout_exceeded", violations, meta };
  }

  return { ok: true, meta };
}

// Internal helper (not exported). Returns the parent id with the highest
// child count, plus that count. Empty arrays return { parentId: "", fanout: 0 } —
// not reachable in SP10B because SP7 schemas enforce min-1 length per stage.
function topFanout<T>(
  xs: readonly T[],
  key: (x: T) => string,
): { parentId: string; fanout: number } {
  // ... deterministic by-key counting + iteration order; ties broken by first-seen parentId
}
```

The `topFanout` helper is non-exported. Tree-size precedence is enforced before branch-fanout precedence, locking the operator-mental-model alignment from Q10.

### 4.7 New top-level orchestrator (`packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts`)

```ts
// SP10B — Production callsite that wraps SP7's chain with a tree-budget gate.
//
// Returns RunPreproductionChainWithBudgetOutcome { result, budgetMeta } so callers
// get computed tree shape on the success path without re-walking the tree (Q16).
//
// Calls budgetReader.resolveBudget(); if null, returns { result, budgetMeta: null }
// (gated bypass). If non-null and maxEstimatedUsd is non-null, throws
// InvariantViolationError (SP10C-bleed protection — SP10B is count-only).
// Otherwise runs SP7's chain to completion, then validates tree shape against budget.
// Throws TreeBudgetExceededError on violation; returns the wrapped outcome on pass.
//
// MERGE-BACK: dashboard surfaces TreeBudgetExceededError with retry-with-raised-budget UI.

import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "../preproduction/preproduction-chain.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { PcdBriefInput, PcdPreproductionChainResult } from "@creativeagent/schemas";
import type { Sp10bBudgetReader } from "./sp10b-budget-reader.js";
import { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
import { validateTreeShapeAgainstBudget, type TreeShapeMeta } from "./tree-shape-validator.js";

export type RunIdentityAwarePreproductionChainWithBudgetStores = PreproductionChainStores & {
  budgetReader: Sp10bBudgetReader;
  organizationId?: string | null;
};

export type RunPreproductionChainWithBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when reader returned null (gated bypass); populated otherwise.
  budgetMeta: TreeShapeMeta | null;
};

export async function runIdentityAwarePreproductionChainWithBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithBudgetStores,
): Promise<RunPreproductionChainWithBudgetOutcome> {
  // 1. Resolve budget. Reader throws → propagated raw.
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved — value or null)

  // 2. SP10C-bleed protection: SP10B is count-only.
  if (budget !== null && budget.maxEstimatedUsd !== null) {
    // MERGE-BACK: SP10C will populate budget.maxEstimatedUsd; SP10B asserts null here.
    throw new InvariantViolationError(
      "maxEstimatedUsd is reserved for SP10C; SP10B is count-only",
      { budget },
    );
  }

  // 3. Run SP7 chain to completion. Errors propagated raw.
  const result = await runIdentityAwarePreproductionChain(brief, stores);

  // 4. Skip gate if no budget configured (legacy / pre-rollout paths).
  if (budget === null) return { result, budgetMeta: null };

  // 5. Validate tree shape against budget.
  const validation = validateTreeShapeAgainstBudget({ result, budget });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (budget gate passed)
    return { result, budgetMeta: validation.meta };
  }

  // 6. Throw on violation.
  // MERGE-BACK: emit WorkTrace here (budget gate violated)
  throw new TreeBudgetExceededError({
    reason: validation.reason,
    budget,
    violations: validation.violations,
    meta: validation.meta,
  });
}
```

The orchestrator is **deliberately small** (~55 LOC excluding imports). All complexity lives in the validator. Composer body untouched (it's a pure function call to SP7's chain).

### 4.8 Public surface (`packages/creative-pipeline/src/pcd/budget/index.ts`)

See Q12 above. Re-exported from the package barrel.

### 4.9 No Prisma migration

SP10B is pure orchestration. No `packages/db/prisma/schema.prisma` edit. No new migration directory.

### 4.10 No db-package adapter

SP10B does not introduce a Prisma store contract. Reader is a pure interface; production adapter at merge-back lives in Switchboard's package, not in `packages/db/`.

### 4.11 Anti-pattern test (`packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`)

See Q13 above — 9 structural assertions. Implementation note for the plan: assertion #9 (validation priority lock — `observedTreeSize > budget.maxTreeSize` must appear before `budget.maxBranchFanout` by line number) needs the SP5-precedent `codeOnly` filter (strip line-comments before regex matching) so that JSDoc / inline comments mentioning `maxBranchFanout` don't trigger false positives.

### 4.12 Co-located tests

See Q14 above — ~46–56 net new tests (table breakdown there is authoritative).

---

## 5. Data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Caller (merge-back-time production runner)                             │
│  Calls runIdentityAwarePreproductionChainWithBudget(brief,              │
│    { ...preproductionChainStores, budgetReader, organizationId })       │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1 — budgetReader.resolveBudget({briefId, organizationId})        │
│  - Returns PreproductionTreeBudget | null                               │
│  - StaticDefaultBudgetReader returns STATIC_DEFAULT_BUDGET                │
│  - Production reader returns per-org / brief-override budget or null   │
│  Throws: whatever the reader throws (raw)                              │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2 — Assert maxEstimatedUsd === null                               │
│  - SP10C-bleed protection                                                │
│  Throws: InvariantViolationError if non-null                           │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ ok
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3 — runIdentityAwarePreproductionChain(brief, stores)             │
│  (SP7 — UNCHANGED)                                                       │
│  - trends → motivators → hooks → scripts → fanout gate                  │
│  - Returns PcdPreproductionChainResult                                  │
│  Throws: PreproductionChainError, ConsentRevokedRefusalError, ZodError, │
│          InvariantViolationError (raw)                                  │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 4 — Bypass if budget === null (legacy path)                       │
│  - Returns { result, budgetMeta: null }                                  │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ budget !== null
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 5 — validateTreeShapeAgainstBudget({result, budget})              │
│  - Pure synchronous arithmetic on tree shape                            │
│  - Counts perStageCounts, observedTreeSize, all 3 fanoutLevels         │
│  - Validation priority: maxTreeSize first, maxBranchFanout second      │
│  - Returns ValidateTreeShapeOutput { ok, meta, violations? }           │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ ok: true   →  return { result, budgetMeta: validation.meta }
              │ ok: false  →  throw TreeBudgetExceededError(reason, budget,
              │                       violations, meta)
              ▼
        (caller destructures success outcome OR catches the error)
```

**No mutation, no prune, no partial result.** Every step either succeeds or throws. Chain runs to completion or not at all (atomic).

---

## 6. Failure semantics

See Q11 above. Summary:

- **Reader throws** → propagated raw.
- **Reader returns null** → no gate; orchestrator returns `{ result, budgetMeta: null }`.
- **`maxEstimatedUsd !== null`** → `InvariantViolationError` (SP10C-bleed protection).
- **Chain throws** → propagated raw (preserves SP7 error semantics).
- **Validator returns `ok: false`** → orchestrator throws `TreeBudgetExceededError` carrying `{ reason, budget, violations, meta }`.
- **Validator returns `ok: true`** → orchestrator returns `{ result, budgetMeta: validation.meta }`.

No try/catch anywhere in SP10B source.

---

## 7. Module layout

```
packages/creative-pipeline/src/pcd/budget/
├── tree-budget-version.ts                                       [14th pinned constant]
├── tree-budget-exceeded-error.ts                                [error class]
├── sp10b-budget-reader.ts                                       [reader contract]
├── static-default-budget-reader.ts                              [stub default + STATIC_DEFAULT_BUDGET_READER_VERSION + STATIC_DEFAULT_BUDGET]
├── tree-shape-validator.ts                                      [pure validator — sole importer of version constant]
├── run-identity-aware-preproduction-chain-with-budget.ts        [orchestrator]
├── index.ts                                                     [public surface]
├── tree-budget-version.test.ts
├── tree-budget-exceeded-error.test.ts
├── static-default-budget-reader.test.ts
├── tree-shape-validator.test.ts
├── run-identity-aware-preproduction-chain-with-budget.test.ts
└── sp10b-anti-patterns.test.ts

packages/schemas/src/
└── pcd-preproduction.ts                                          [widened — one field added to PreproductionTreeBudgetSchema]

packages/schemas/src/__tests__/
└── pcd-preproduction.test.ts                                     [widened — 4 existing fixtures updated with `maxEstimatedUsd: null` + 5-6 new tests for the new field]
```

7 new source files in `pcd/budget/` + 6 new test files + 1 schema widen. Comparable to SP10A's footprint minus the Prisma adapter.

**Files outside `pcd/budget/` that change:**

- `packages/schemas/src/pcd-preproduction.ts` — schema widen (1 field added)
- `packages/schemas/src/__tests__/pcd-preproduction.test.ts` — 4 existing fixtures updated + 5-6 new tests
- `packages/creative-pipeline/src/index.ts` — re-export SP10B surface
- `docs/SWITCHBOARD-CONTEXT.md` — add SP10B merge-back surface section

**Files NOT changed (verified by anti-pattern test #4):**

- `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts` (treeBudget slot stays null)
- `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts`
- `packages/creative-pipeline/src/pcd/cost/*` (any file)
- `packages/creative-pipeline/src/pcd/provenance/*` (any file)
- `packages/db/prisma/schema.prisma`
- `packages/db/src/stores/*` (no new method, no new adapter)

---

## 8. Merge-back surfaces

**SP10B-declared merge-back surfaces (production wiring at merge-back):**

- **`Sp10bBudgetReader` injection** — Switchboard owns the production budget reader. Real reader fetches per-organization defaults with brief-level override from a Switchboard-side `OrganizationBudget` table. SP10B ships only the contract + a deterministic stub. `// MERGE-BACK: replace with Switchboard org-budget reader` marker on stub class declaration.
- **`WorkTrace` emit** — every SP10B state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `run-identity-aware-preproduction-chain-with-budget.ts`: budget resolved (value or null), budget gate passed, budget gate violated. WorkTrace payload should include `budgetMeta` on success and `meta` + `violations` on failure (both shapes are stable per SP10B).
- **Production runner discipline** — at merge-back, all production callsites should call `runIdentityAwarePreproductionChainWithBudget` to get budget enforcement. Legacy SP7 `runIdentityAwarePreproductionChain` callsites remain valid for tests + ad-hoc uses but bypass the gate. If a future invariant requires "all production chains must go through SP10B," it will need a structural test (defining "production callsite" reliably is the hard part — same blocker SP10A risk #2 hit).
- **Dashboard UX for `TreeBudgetExceededError`** — operator-facing surface for retrying with a raised budget. SP10B emits the structured error context (`reason`, `budget`, `violations`, full `meta` with `perStageCounts` + `fanoutLevels`) sufficient for a dashboard form.
- **Outcome-wrapper consumption at merge-back** — production runners must destructure the SP10B return: `const { result, budgetMeta } = await runIdentityAwarePreproductionChainWithBudget(...)`. The `budgetMeta` field can populate analytics dashboards directly (per-stage counts, top fanout parents) without re-walking the tree. `budgetMeta === null` means "ran in gated-bypass mode" (org has no budget configured); analytics queries should filter on this to compute opt-in rate.
- **`OrganizationBudget` Prisma table** — Switchboard owns the schema. SP10B does not constrain shape; reader contract is the only PCD-vertical commitment.

**Schema reconciliation at merge-back:**

- `PreproductionTreeBudgetSchema.maxEstimatedUsd` — one new field added by SP10B. SP10C populates non-null values. If Switchboard `main` has not added an equivalent independently, the SP10B widen applies cleanly. If Switchboard added a same-semantic field with a different name, reconcile by renaming SP10B's field before merge-back.
- No Prisma columns added by SP10B. Zero migration reconciliation overhead.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10B orchestrator + validator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/budget/` changes at merge-back — only the injected reader swaps (real Switchboard reader replaces `StaticDefaultBudgetReader`) and the `// MERGE-BACK:` markers get implementations.
- `PCD_TREE_BUDGET_VERSION` is the 14th pinned constant. The PCD slice carries 14 total pinned constants after SP10B.
- SP10B introduces NO circular dependency. `pcd/budget/` imports from `pcd/preproduction/` (chain composer, types) and from `pcd/` top-level (`InvariantViolationError`). Reverse direction does not exist; `sp10b-anti-patterns.test.ts` enforces the source-freeze.
- The SP7 composer body (`runIdentityAwarePreproductionChain`) is untouched. SP10B added a parallel orchestrator (`runIdentityAwarePreproductionChainWithBudget`) that calls SP7's chain as a pure function and adds budget gating around the call. Anti-pattern test #4 enforces SP1-SP10A source-body freeze.

**Anti-pattern test baseline coordination with SP11:**

SP10B's `sp10b-anti-patterns.test.ts` baselines against `afa16de` (SP10A squash). Allowlist includes `packages/creative-pipeline/src/pcd/budget/`, `packages/schemas/src/pcd-preproduction.ts`, `packages/schemas/src/__tests__/pcd-preproduction.test.ts`, `packages/creative-pipeline/src/index.ts`, `docs/`. If SP11 (synthetic-creator roster) merges first, the SP10B rebase swaps the baseline ref to SP11's squash and adds `pcd/synthetic/` (or whatever SP11's territory is named) to the freeze allowlist. ~5-line edit to the test file.

---

## 9. Estimated work

| Slice     | New source files | New schemas                          | New tests            | Migration                  | Pinned constants added |
| --------- | ---------------- | ------------------------------------ | -------------------- | -------------------------- | ---------------------- |
| SP9       | 5                | 1 schema file (3 schemas)            | 38 net               | 1 (6 cols, 2 indexes)      | 1 (12th)               |
| SP10A     | 8                | 1 schema file (3 schemas)            | ~40 net              | 1 (1 col, 0 indexes)       | 1 (13th)               |
| **SP10B** | **7**            | **1 field added to existing schema** | **~46–56 estimated** | **0 (pure orchestration)** | **1 (14th)**           |

SP10B is structurally smaller than SP10A (no Prisma migration, no db-package adapter, no new schema file). Surface area is dominated by the validator (~80 LOC of pure arithmetic on tree shape, plus the `topFanout` helper) and the orchestrator (~55 LOC).

---

## 10. What is NOT in scope (SP10B)

- **Cost-budget enforcement (`maxEstimatedUsd` gate).** Reserved for SP10C. Field widened in SP10B as `nullable`, populated `null`. SP10B asserts null at gate time and throws `InvariantViolationError` if non-null (SP10C-bleed protection).
- **Coarse pre-routing cost estimator.** SP10A's per-asset estimator is unusable upstream of routing. The new contract is SP10C's domain.
- **Mid-chain enforcement / partial-tree pruning.** Rejected per Q2 lock. Partial-tree semantics are out of scope; SP10B is post-chain only.
- **`PcdIdentityContext.treeBudget` populated.** Slot stays null per Q3 lock. Stage runners cannot read budget. Future slice may light it up.
- **Per-asset persistence change.** SP10B is pure orchestration; no `PcdIdentitySnapshot` or `PcdProductionFanoutDecision` widen.
- **Resumable / checkpointed chain runs.** Throw-on-violation produces a non-resumable chain (operator revises brief or raises budget and re-runs from scratch). Resumability is out of scope.
- **Dashboard / UI / operator-facing budget editor.** Reserved for Switchboard at merge-back.
- **`OrganizationBudget` Prisma table.** Switchboard owns the schema.
- **`fanoutDecisionId` convention lock.** Inherited from SP9 / SP10A as caller-supplied. SP10B's gate fires before fanout, so the convention is not load-bearing for this slice.
- **Bare `writePcdIdentitySnapshot` callsite invariant.** SP9/SP10A risk carry-over; SP10B does not close it.
- **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts`.** Continues as baseline noise. SP10B changes only its own files.

---

## 11. References

- Memory: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` — SP1–SP10A state including SP10A implementation notes.
- `~/creativeagent/CLAUDE.md` — repo invariants.
- `~/creativeagent/docs/SWITCHBOARD-CONTEXT.md` — merge-back contract.
- `~/creativeagent/docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md` — SP10A design (predecessor; SP10B inherits its accepted-risks list at §0 and matches its module-layout pattern).
- `~/creativeagent/docs/plans/2026-04-30-pcd-cost-forecast-sp10a-plan.md` — SP10A implementation reference.
- `~/creativeagent/packages/schemas/src/pcd-preproduction.ts` — `PreproductionTreeBudgetSchema` (widened by SP10B with `maxEstimatedUsd`).
- `~/creativeagent/packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts` — SP7 composer (called as pure function by SP10B orchestrator; body untouched).
- `~/creativeagent/packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts` — `treeBudget: null` slot (untouched by SP10B).
- `~/creativeagent/packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` — anti-pattern test pattern that SP10B's test mirrors structurally.
