# SP10A — Cost-Forecast Wiring (Design)

**Slice:** PCD vertical SP10A
**Date:** 2026-04-30
**Status:** Design — awaiting plan + implementation
**Predecessor:** SP9 (creative-source provenance, squash `f30da16`, PR #8)
**Successor (planned):** SP10B (tree-budget enforcement — distinct slice; out of scope here)

---

## 0. User-accepted risks

These were named, weighed, and accepted during brainstorming. They are not bugs; they are scope locks. Future readers (especially merge-back implementers) should treat them as load-bearing.

1. **`PcdProductionFanoutDecision.costForecast` stays `null` in SP10A.** The locked `CostEstimator.estimate()` contract requires `provider`, `model`, `shotType`, `outputIntent` — all unknown at gate time, since provider routing is downstream of fanout. A coarse pre-routing estimator variant would need a second contract surface. SP10A defers that to a future slice; the schema slot remains reserved exactly as SP7/SP8 left it.
2. **Bare `writePcdIdentitySnapshot` callsite remains valid (SP9 risk #4 doubled).** SP10A adds a third writer path (`writePcdIdentitySnapshotWithCostForecast`) that always stamps cost. Legacy callsites (tests, ad-hoc backfills, and even the SP9 `writePcdIdentitySnapshotWithProvenance` path) continue to write `costForecastReason = null`. Production runner discipline at merge-back is required to use the SP10A path; runtime invariants enforcing "production callsites must include cost data" are out of scope (would require a structural definition of "production callsite") and are reserved for SP10B's policy slice where abort/prune authority makes the invariant meaningful.
3. **SP4/SP9/SP10A invariant duplication grows to a 3-way lock-step.** SP10A's orchestrator duplicates the SP4 + SP9 invariant logic (same four version imports, same six-arg `assertTier3RoutingDecisionCompliant` call). This is a maintenance smell; a future Tier 3 rule edit must be replicated in three places. Mitigated by `sp10a-anti-patterns.test.ts` lock-step assertion. Accepted because un-duplicating would require editing SP4 or SP9 source bodies — strictly forbidden.
4. **`fanoutDecisionId` convention still caller-supplied.** SP10A inherits SP9's `// MERGE-BACK: pick fanoutDecisionId convention` marker without resolving it. The SP10A path needs a stable id per gate decision (for cost-aggregation queries that group across asset stamps from the same campaign), but defining the convention in this slice would lock a Switchboard-side decision prematurely. Two acceptable conventions documented: Inngest event id (preferred) or `sha256(briefId + decidedAt + sorted(selectedScriptIds))`.
5. **Estimator-version drift across asset stamps within one campaign.** Two assets stamped from the same fanout decision but at different wall-clock times may receive different `estimatorVersion` strings if Switchboard rolls the cost model mid-campaign. SP10A captures `estimatorVersion` per stamp (forensic fidelity) rather than pinning at fanout time. Reconciliation is a Switchboard-side analytical concern; SP10A records the truth as observed.
6. **No flat numeric column on `PcdIdentitySnapshot` for query-friendly cost rollups.** SP10A persists the full forensic struct as `costForecastReason Json?` only. Range queries like `WHERE estimatedUsdCents > N` require Postgres JSON operators (e.g. `(cost_forecast_reason->>'estimatedUsd')::numeric > N`). Flattening into a `Decimal?` or `Int?` column is a merge-back analytics concern. Accepted because SP10A is observability-only and adding flat columns now anticipates query patterns SP10B and Switchboard analytics will own.
7. **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts` continues as baseline noise (now 9 slices deferred).** SP10A does not fix it. The line is "this slice changes only its own files."

8. **3-way invariant duplication is structural debt for SP11+.** SP4 writer body + SP9 orchestrator + SP10A orchestrator all duplicate `assertTier3RoutingDecisionCompliant` + 4-version-pin + Zod parse. Anti-pattern test holds today; an `applySnapshotInvariants(input)` extraction is the natural fix but requires breaking the "no edits to SP1–SP9" rule. Track as future-slice debt; do NOT extract in SP10A.

9. **Cost-by-range queries are awkward without a flat numeric column.** Postgres JSON operators (`(cost_forecast_reason->>'estimatedUsd')::numeric > N`) work but are slow on large tables and hostile to dashboards. A future slice (or merge-back analytics) will add `estimatedUsdCents Int?` + index on `(scriptId, estimatedUsdCents)`. Deferred, not optional long-term.

10. **Estimator-version drift forces mixed-version analytics.** Two assets stamped from the same campaign at different times can carry different `estimatorVersion` strings. Switchboard analytics must `GROUP BY estimatorVersion` or normalize. SP10A records truth as observed; reconciliation is downstream.

11. **No SP10A campaign-level forecast preview.** Cost only materializes at per-asset write time (post-routing). Pre-generation campaign cost preview ("what would this brief cost?") is structurally impossible under the locked Q2 contract and Q3 aggregation point. SP10B's pre-chain budget gate will need a *different* coarse estimator surface for this; SP10A intentionally does not attempt it.

12. **`costForecastReason` and `lineageDecisionReason` are not transactionally tied.** Both columns are populated by the SP10A orchestrator in one row write, but there is no shared join key beyond the row's `assetRecordId`. Cross-asset cost-by-fanout queries rely on `lineageDecisionReason.fanoutDecisionId` (Json field). Caller-supplied `fanoutDecisionId` discipline (risk #4) becomes more load-bearing in SP10A: it is now the de-facto join key for every cost analytic. SP10B or merge-back may promote `fanoutDecisionId` to a flat indexed column.

---

## 1. Mission

Land observability for the per-asset cost of every PCD-generated asset by stamping a cost-forecast forensic struct on each `PcdIdentitySnapshot` at provenance-write time. Forecast-only — no abort, no prune, no budget gate. Pure observability substrate for future SP10B (tree-budget enforcement) and merge-back-time Switchboard cost analytics.

Today the gap is structural:

- **SP4** writes a `PcdIdentitySnapshot` per generated asset with provider + four pinned versions. It carries no cost record — neither expected nor actual.
- **SP7/SP8** reserve `PcdProductionFanoutDecision.costForecast` as a schema slot (non-null `PcdCostForecastSchema`) but always emit `null`. The fanout decision flows through with cost as a forever-null promise.
- **SP9** stamps lineage on the snapshot (`briefId → trendId → motivatorId → hookId → scriptId`) but says nothing about what each asset cost to make.
- The slice plan earmarked SP10 for both cost-forecast wiring AND tree-budget enforcement together. **SP10A is the cost half only;** SP10B is the budget half.

SP10A closes the per-asset cost gap with one new nullable Json column (`costForecastReason`) on `PcdIdentitySnapshot`, an injected `CostEstimator` interface (production model lives in Switchboard), a 13th pinned version constant (`PCD_COST_FORECAST_VERSION`), a new pure store-injected stamper (`stampPcdCostForecast`), and a new top-level orchestrator (`writePcdIdentitySnapshotWithCostForecast`) that composes SP9's `stampPcdProvenance`, runs the SP4 invariant assertion, and persists via a new SP10A Prisma store method.

---

## 2. Hard guardrails (inherited from SP1–SP9 — not negotiable)

1. **Pure orchestration in `packages/creative-pipeline/src/pcd/`.** Persistence goes through injected store interfaces with concrete Prisma implementers in `packages/db/`.
2. **No edits to SP1–SP9 source bodies.** SP10A widens schemas additively. SP4's `writePcdIdentitySnapshot` and SP9's `writePcdIdentitySnapshotWithProvenance` are NOT mutated; SP10A ships a new top-level orchestrator (`writePcdIdentitySnapshotWithCostForecast`) that COMPOSES SP9's `stampPcdProvenance` (calls it as a pure function — does not duplicate the lineage walk).
3. **Pinned version constants per new decision surface.** SP10A adds `PCD_COST_FORECAST_VERSION` (13th constant).
4. **`// MERGE-BACK:` markers** at every new state transition / external-system seam.
5. **Anti-pattern grep tests + forbidden-imports tests** on every new module. Ship `sp10a-anti-patterns.test.ts` (extends SP7/SP8/SP9 patterns).
6. **Composer-only version pinning (SP8 lock).** The cost-forecast stamper imports `PCD_COST_FORECAST_VERSION` from a sibling const file. No estimator, store, or orchestrator file may contain the literal `"pcd-cost-forecast@"` — anti-pattern grep enforces.
7. **Identity context immutability (SP8 lock).** SP10A widens neither `PcdIdentityContext` nor the gate operator-decision tuple. Cost is forensics on the per-asset snapshot, not state on the in-flight identity context.
8. **SP4/SP9 invariant lock-step extends to SP4/SP9/SP10A 3-way (SP9 lock).** SP10A's orchestrator imports the same four version constants as SP4/SP9 writers and calls `assertTier3RoutingDecisionCompliant` with the same six-argument shape. Anti-pattern test enforces structural equivalence across all three files.
9. **Forecast-only invariant (SP10A lock — new).** No SP10A source mutates `selectedScriptIds` / `availableScriptIds`, throws on cost thresholds, compares `estimatedUsd` against any literal, or aborts/prunes any chain. Anti-pattern grep enforces. Budget enforcement is SP10B's domain.
10. **Per CLAUDE.md:** ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft limit, `pnpm exec prettier --check`. `pnpm lint` is structurally broken on origin/main per SP5 baseline note — use prettier as the practical style gate.

---

## 3. Architectural locks (Q1–Q8)

### Q1 — Scope: cost-forecast wiring only (SP10A); tree-budget enforcement deferred to SP10B

The original SP10 plan listed both concerns together. Locked decision: **split into SP10A (cost) + SP10B (budget) sequentially** — one squash per concern, separate version pins, separate review surfaces.

**Why split:** cost is substrate; budget is policy. Forecasting answers *"what will this likely cost?"*; budget enforcement answers *"should we allow it?"* Conflating measurement and governance into one slice would produce two coupled version pins that evolve at different cadences and a single squash that mixes observability code with abort/prune control flow. Cost shape settles first because budget enforcement will need real cost numbers to gate on.

**Hard SP10A guardrail (inherits to all sub-decisions):** SP10A records estimates only. No abort, no prune, no budget gate. Anti-pattern test #5 enforces structurally.

**Rejected alternatives:**

- (B) Cost + budget as one slice — coupled version pins, ~2× surface area, mixes observability with control flow.
- (C) Budget first — needs cost shape settled to gate on a `maxEstimatedUsd`. Sequencing wrong.
- (D) Real-runner integration / ad-optimizer hooks — out of PCD vertical scope; merge-back wiring concern.

### Q2 — Source of estimated cost: injected `CostEstimator` interface

Locked contract:

```ts
type CostEstimator = {
  estimate(input: {
    provider: string;
    model: string;
    shotType: string;
    outputIntent: string;
    durationSec?: number;
    tokenCount?: number;
  }): Promise<{
    estimatedUsd: number;
    currency: "USD";
    lineItems: Array<{ label: string; estimatedUsd: number }>;
    estimatorVersion: string;
  }>;
};
```

**Why injection (not matrix-extension):**

| Option | Choice | Rationale |
|---|---|---|
| Extend SP4 `PcdProviderCapabilityMatrix` with cost columns | ❌ | Forces a bump to `PCD_PROVIDER_CAPABILITY_VERSION` — touches SP4 shipped state (forbidden by guardrail #2). Bakes pricing into this repo, where production cost models do not belong. |
| Static estimates per shot type / output intent | ❌ | Wrong abstraction — cost varies by *provider* (Sora vs Veo), not by shot type. Static-by-shot-type either lies or picks worst-case ceiling. |
| Injected `CostEstimator` interface | ✅ | Mirrors SP4's `CampaignTakeStore` and SP5's QC provider precedent exactly. Doesn't touch SP4 matrix. Lets Switchboard's ad-optimizer team own cost-model evolution. |

**Why `provider` AND `model` (not just `provider`):** cost typically differs by model/provider tier (e.g. Sora-1.0 vs Sora-Pro). Including both at the contract surface lets the estimator price precisely without re-versioning when Switchboard adds a new tier per provider.

**Why `provider`/`model`/`shotType`/`outputIntent` are typed as `string` (not enums):** SP4's `PcdProviderProfile` and `PcdShotTypeSchema` enums stay out of the contract surface so merge-back can plug in any Switchboard provider naming without re-versioning the SP10A contract. The estimator validates inputs internally (Switchboard's responsibility); the test stub accepts any string.

**Why `currency: "USD"` (literal):** SP10A is single-currency by design — multi-currency adds FX-rate concerns that belong with Switchboard's billing layer. Future multi-currency work bumps `PCD_COST_FORECAST_VERSION` to `@2.0.0`.

**Why `lineItems` (not `breakdown`):** consistency with the existing `PcdCostForecastSchema.lineItems` field shipped by SP7. The brainstorming-locked spelling was `breakdown`; renamed to `lineItems` at the schema-naming-consistency level. The estimator return type uses `lineItems`.

**Why `estimatorVersion: string` is a free-form string from the estimator:** orthogonal to SP10A's `PCD_COST_FORECAST_VERSION`. Two distinct version concerns:
- `PCD_COST_FORECAST_VERSION` — version of the SP10A *forensic record shape* (pinned constant).
- `estimatorVersion` — version of the *cost model* that produced the numbers (returned by estimator at runtime; pre-SP10A models, model-A vs model-B, or even per-asset model rollouts can all coexist in the persisted record).

### Q3 — Aggregation point: per-asset only

`PcdProductionFanoutDecision.costForecast` stays `null` in SP10A. Per-asset stamp at provenance-stamp time only.

**Why not gate-time:** the locked Q2 contract requires `provider`, `model`, `shotType`, `outputIntent` — all unknown at gate time, since provider routing is downstream of fanout (SP4 is what picks provider+model per shot). A gate-time forecast under this contract would either lie or need a second estimator surface. Deferred to a future slice.

**Why not both:** "both" presumed gate-time was answerable. It isn't, given the locked contract. Locking per-asset-only preserves a single accurate forensic record per asset.

**Where it lands:** new `costForecastReason Json?` column on `PcdIdentitySnapshot`. Separate from SP9's `lineageDecisionReason` so SP9's source body and reader stay untouched (guardrail #2). Each slice having its own forensic column is the SP1–SP9 precedent.

### Q4 — Skipped (was budget enforcement — out of SP10A scope per Q1 lock)

### Q5 — Skipped (was budget source — out of SP10A scope per Q1 lock)

### Q6 — Version pin: new `PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0"`

13th pinned constant in the PCD slice. Reasons not to reuse `PCD_PROVENANCE_VERSION`:

- Cost-shape evolution (e.g. multi-currency, per-shot itemization) is independent of provenance-shape evolution (e.g. adding a `templateId` rung).
- SP10B's tree-budget version (when it ships as 14th) needs to bump independently of cost-shape version.
- The composer-only version pinning lock means `stamp-pcd-cost-forecast.ts` is the single import site. No estimator, store, or orchestrator file may contain the literal `"pcd-cost-forecast@"` — `sp10a-anti-patterns.test.ts` enforces.

`costForecastReason.costForecastVersion` carries the value forensically. Future cost-version bumps mean pre-bump rows record the prior version; readers must treat the column as schema-fixed but the Json value as version-tagged.

### Q7 — Backfill: additive nullable widen

Pre-SP10A `PcdIdentitySnapshot` rows have `costForecastReason = null`. No backfill function. No hard-cutover. SP10A-and-later writes via `writePcdIdentitySnapshotWithCostForecast` always populate the column; the SP4-only and SP9-only callsites remain valid for tests and back-compat callers but emit `null`.

**Conservative-compatibility precedent:** SP1, SP4, SP5, SP9 all widened additively with nullable columns. SP10A follows the same pattern.

**One column added:**

```
costForecastReason Json?
```

**No new indexes.** Cost-rollup queries are merge-back analytical work; flat numeric columns and indexes can be added by a future slice once query patterns are observed.

### Q8 — Module placement: top-level `pcd/cost/` sibling subdir

Files land in `packages/creative-pipeline/src/pcd/cost/`. Sibling to `pcd/preproduction/` (SP7/SP8) and `pcd/provenance/` (SP9). Rationale:

- Cost-forecast is structurally **between** SP9 (provenance stamper, returns lineage payload) and SP4 (snapshot writer, persists). It composes the former and reuses the latter's invariant logic.
- Sibling subdir matches SP7's `pcd/preproduction/` and SP9's `pcd/provenance/` precedents — synergy slice with its own surface area, version constant, anti-pattern test, and barrel.
- Schemas land in a new file `packages/schemas/src/pcd-cost-forecast.ts` (sibling to `pcd-provenance.ts`) re-exported from the schemas barrel.

---

## 4. What ships

### 4.1 New zod schemas (`packages/schemas/src/pcd-cost-forecast.ts`)

```ts
// PCD slice SP10A — Cost-forecast forensic record. Bridges the injected
// CostEstimator's runtime output to the per-asset PcdIdentitySnapshot's
// new costForecastReason Json column.
//
// Shape: full forensic struct; one record per asset; pinned costForecastVersion
// orthogonal to the runtime estimatorVersion the estimator returned.
import { z } from "zod";

export const PcdSp10CostLineItemSchema = z
  .object({
    label: z.string().min(1),
    estimatedUsd: z.number().nonnegative(),
  })
  .readonly();
export type PcdSp10CostLineItem = z.infer<typeof PcdSp10CostLineItemSchema>;

export const PcdSp10CostForecastReasonSchema = z
  .object({
    estimatedUsd: z.number().nonnegative(),
    currency: z.literal("USD"),
    lineItems: z.array(PcdSp10CostLineItemSchema).readonly(),
    costForecastVersion: z.string().min(1),
    estimatorVersion: z.string().min(1),
    estimatedAt: z.string().datetime(),
  })
  .readonly();
export type PcdSp10CostForecastReason = z.infer<typeof PcdSp10CostForecastReasonSchema>;
```

Two schemas only. The orchestrator composes the SP10A `PcdSp10CostForecastReason` with the SP9 `PcdSp9ProvenancePayload` at the **type level** (in the store contract input shape — see §4.7), not as a third zod schema. Mirrors SP9's pattern (SP9 ships `PcdSp9ProvenancePayloadSchema` as the stamper return type; the orchestrator-assembled row is type-only).

`pcd-preproduction.ts`'s existing `PcdCostForecastSchema` (gate-time slot) is **not** edited — SP10A doesn't touch the gate-time slot per Q3 lock. That schema stays where SP7/SP8 left it; populating it is reserved for a future slice with a coarse pre-routing estimator variant.

Schemas barrel (`packages/schemas/src/index.ts`) re-exports the new file.

### 4.2 New pinned constant (`packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts`)

```ts
export const PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0";
```

Single import site: `stamp-pcd-cost-forecast.ts`. Anti-pattern test asserts no other source contains the literal `"pcd-cost-forecast@"`.

### 4.3 New `CostEstimator` interface (`packages/creative-pipeline/src/pcd/cost/cost-estimator.ts`)

```ts
// MERGE-BACK: replace with Switchboard cost estimator (ad-optimizer team owns the
// production cost model — FX rates, volume tiers, contract pricing).
export type CostEstimatorInput = {
  provider: string;
  model: string;
  shotType: string;
  outputIntent: string;
  durationSec?: number;
  tokenCount?: number;
};

export type CostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  lineItems: Array<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CostEstimator = {
  estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput>;
};
```

Type-only file. No runtime export beyond the `CostEstimator` symbol if a class form is ever added (it isn't in SP10A — interface only).

### 4.4 Stub estimator (`packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts`)

```ts
// MERGE-BACK: real Switchboard cost estimator replaces this in production.
// Stub is deterministic for tests + local development. DO NOT add config flags
// or environment-driven fan-in — the swap is by injection, not by feature flag.
export class StubCostEstimator implements CostEstimator {
  async estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput> {
    // Deterministic synthetic numbers keyed on (provider, model, shotType, outputIntent).
    // Duration and tokenCount fold linearly into the base price.
    // Returns the literal stubVersion so test assertions can check version carry.
    ...
  }
}

export const STUB_COST_ESTIMATOR_VERSION = "stub-cost-estimator@1.0.0";
```

The stub estimator's lookup table is small (~5 rows, one per known provider×model×shotType combination from SP4's `PcdProviderCapabilityMatrix`), with a default fallback that returns a fixed `1.00 USD` stub price. Used by tests and as the local default.

### 4.5 Pure stamper (`packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts`)

```ts
// SP10A — Pure store-injected stamper. Calls the injected CostEstimator
// once per asset, pins PCD_COST_FORECAST_VERSION from import, and returns
// the forensic record for the SP10A orchestrator's persistence path.
//
// FORECAST-ONLY: this function does NOT mutate selection, prune branches,
// or compare estimatedUsd against any threshold. sp10a-anti-patterns.test.ts
// enforces structurally.

export type StampPcdCostForecastInput = {
  provider: string;
  model: string;
  shotType: string;
  outputIntent: string;
  durationSec?: number;
  tokenCount?: number;
};

export type StampPcdCostForecastStores = {
  costEstimator: CostEstimator;
  clock?: () => Date;
};

export async function stampPcdCostForecast(
  input: StampPcdCostForecastInput,
  stores: StampPcdCostForecastStores,
): Promise<PcdSp10CostForecastReason> {
  // Step 1 — defense-in-depth zod parse on the input.
  // Step 2 — call injected estimator. Errors propagate raw.
  // MERGE-BACK: emit WorkTrace here (estimator returned)
  // Step 3 — assemble forensic record, pinning PCD_COST_FORECAST_VERSION
  //          from import. estimatedAt from clock() at call time.
  // MERGE-BACK: emit WorkTrace here (cost forecast assembled)
  // Step 4 — defense-in-depth zod parse on the assembled record.
}
```

Sole import of `PCD_COST_FORECAST_VERSION` in the SP10A surface.

### 4.6 New orchestrator (`packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts`)

Composes SP9's `stampPcdProvenance` (pure function — returns lineage payload) with SP10A's `stampPcdCostForecast`, runs the SP4 invariant assertion + Zod parse + version-pin path (duplicated structurally — 3-way lock-step), and persists via the new SP10A Prisma store method.

```ts
// SP10A — Production callsite that bridges SP9's lineage stamp with the
// SP10A cost-forecast stamp. Calls SP9's pure stamper (which itself does
// the consent re-check), calls SP10A's pure stamper, runs the SP4 invariant
// path (3-way lock-step with SP4 + SP9), then persists a 26-field row.
//
// The SP4 writer body and the SP9 orchestrator body are preserved verbatim.
// SP10A is the NEW callsite; merge-back-time production runner is required
// to call this one when cost observability is desired (and at merge-back, all
// production callsites should call this one).
//
// MERGE-BACK: pick fanoutDecisionId convention (Inngest event id vs synth hash).
// MERGE-BACK: cost estimator injection — Switchboard ad-optimizer team owns
//             the production CostEstimator implementer.

export type WritePcdIdentitySnapshotWithCostForecastInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  costForecast: StampPcdCostForecastInput;
};

export type WritePcdIdentitySnapshotWithCostForecastStores = {
  pcdSp10IdentitySnapshotStore: PcdSp10IdentitySnapshotStore;
} & StampPcdProvenanceStores
  & StampPcdCostForecastStores;

export async function writePcdIdentitySnapshotWithCostForecast(...) {
  // Step 1 — Stamp provenance (SP9 pure compose). Throws ConsentRevokedRefusalError /
  //          InvariantViolationError / ZodError. Propagated raw. Consent check happens here.
  // Step 2 — Stamp cost forecast (SP10A pure compose). Throws on estimator errors / ZodError.
  //          Propagated raw. Estimator runs only if Step 1 succeeded.
  // Step 3 — SP4 Tier 3 invariant. Same six-arg call as SP4 + SP9 — anti-pattern test enforces.
  // Step 4 — Defense-in-depth Zod parse on the SP4 input subset (mirrors SP4 + SP9 allowlist).
  // Step 5 — Pin version constants from imports (4 imports — same as SP9 + 1 SP10A constant
  //          carried via cost forecast payload).
  // Step 6 — Assemble final 27-field row.
  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)
  // Step 7 — Persist via SP10A store.
}
```

The four version-constant imports match SP4 + SP9 exactly:
1. `PCD_TIER_POLICY_VERSION`
2. `PCD_PROVIDER_CAPABILITY_VERSION`
3. `PCD_PROVIDER_ROUTER_VERSION`
4. `PCD_PREPRODUCTION_CHAIN_VERSION` (transitive via SP9 stamper)

`PCD_COST_FORECAST_VERSION` is **not** imported by the orchestrator — it's pinned inside the SP10A stamper and carried in the `costForecastReason.costForecastVersion` field. Composer-only version pinning lock #6.

### 4.7 New SP10A store contract (`packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts`)

```ts
export type PcdSp10IdentitySnapshotStore = {
  createForShotWithCostForecast(input: {
    // 19 SP4 fields (same as SP9)
    ...
    // 4 SP4-pinned versions (same as SP9)
    policyVersion: string;
    providerCapabilityVersion: string;
    routerVersion: string;
    shotSpecVersion: string | null;
    routingDecisionReason: ...;
    // 6 SP9 lineage fields
    briefId: string;
    trendId: string;
    motivatorId: string;
    hookId: string;
    scriptId: string;
    lineageDecisionReason: PcdProvenanceDecisionReason;
    // 1 SP10A field
    costForecastReason: PcdSp10CostForecastReason;
  }): Promise<PcdIdentitySnapshot>;
};
```

**27 fields total** (15 SP4 base + 4 SP4 versions + 1 SP4 routingDecisionReason + 5 SP9 lineage ids + 1 SP9 lineageDecisionReason + 1 SP10A costForecastReason). Method name mirrors SP9's `createForShotWithProvenance`.

### 4.8 Public surface (`packages/creative-pipeline/src/pcd/cost/index.ts`)

```ts
// SP10A — Cost-forecast public surface.
export { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";
export type {
  CostEstimator,
  CostEstimatorInput,
  CostEstimatorOutput,
} from "./cost-estimator.js";
export {
  StubCostEstimator,
  STUB_COST_ESTIMATOR_VERSION,
} from "./stub-cost-estimator.js";
export {
  stampPcdCostForecast,
  type StampPcdCostForecastInput,
  type StampPcdCostForecastStores,
} from "./stamp-pcd-cost-forecast.js";
export {
  writePcdIdentitySnapshotWithCostForecast,
  type WritePcdIdentitySnapshotWithCostForecastInput,
  type WritePcdIdentitySnapshotWithCostForecastStores,
} from "./write-pcd-identity-snapshot-with-cost-forecast.js";
export type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";
```

Re-exported from the package barrel.

### 4.9 Prisma migration

Single additive migration: `packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/migration.sql`

```sql
ALTER TABLE "PcdIdentitySnapshot"
ADD COLUMN "costForecastReason" JSONB;
```

One nullable Json column. No new index. Pre-SP10A rows remain readable (column defaults to NULL). The `schema.prisma` model gets one line:

```prisma
// SP10A — per-asset cost forecast. Nullable for historical compatibility
// (pre-SP10A rows remain readable). No flat numeric column; range queries
// use Postgres JSON operators.
costForecastReason     Json?
```

### 4.10 Db-package adapter (`packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`)

Widen the existing file with a new method `createForShotWithCostForecast` (mirrors SP9's `createForShotWithProvenance` shape) and a new adapter `adaptPcdSp10IdentitySnapshotStore(prismaStore): PcdSp10IdentitySnapshotStore`. Existing SP4 `create()` and SP9 `createForShotWithProvenance()` bodies preserved byte-equivalent.

### 4.11 Anti-pattern test (`packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`)

8 structural assertions:

1. **Composer-only version pinning.** Only `stamp-pcd-cost-forecast.ts` contains the literal `"pcd-cost-forecast@"`. No estimator, store, or orchestrator file contains the literal.
2. **3-way lock-step with SP4/SP9.** `write-pcd-identity-snapshot-with-cost-forecast.ts` imports the same four version constants as `pcd-identity-snapshot-writer.ts` and `write-pcd-identity-snapshot-with-provenance.ts`, AND calls `assertTier3RoutingDecisionCompliant` with the same six-argument shape. (Test reads all three files and asserts structural equivalence.)
3. **No SP1–SP9 source body edits.** Read-only `git diff f30da16 HEAD` against the SP1–SP9 source-body file list (writer, stamper, orchestrator, gate, chain, builder, deep-freeze, consent pre-checks, six SP6 lifecycle decisions, SP4 capability matrix, SP4 router) returns empty diffs. Test runs the diff and asserts each path is empty.
4. **Forecast-only invariant — no mutation.** No SP10A source contains `selectedScriptIds =`, `availableScriptIds =`, `.push(`, `.splice(`, or `.pop(` against either array.
5. **Forecast-only invariant — no abort/prune control flow.** No SP10A source contains `throw new` followed by any cost-related error class (`Budget`, `OverLimit`, `CostExceeded`, etc.) AND no SP10A source contains `if (estimatedUsd` or any literal numeric comparison against `estimatedUsd` / `costForecastReason.estimatedUsd`.
6. **Forbidden imports.** No SP10A source imports `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `node:http`, `node:https`, `crypto` (test exempts itself).
7. **Single-currency lock.** Schema file's `currency` field is the literal `z.literal("USD")` (regex assertion). Multi-currency is a future-version concern.
8. **Estimator contract immutability — provider AND model AND four required fields.** `cost-estimator.ts` source contains all five required-field declarations (`provider`, `model`, `shotType`, `outputIntent`, plus the return-type `estimatorVersion`). Catches accidental field removal.

### 4.12 Co-located tests

| File | Test count | What it asserts |
|---|---|---|
| `cost-forecast-version.test.ts` | 1 | Constant equals exact literal `"pcd-cost-forecast@1.0.0"`. |
| `stub-cost-estimator.test.ts` | 5–8 | Determinism (same input → same output), version-string carry, all required fields populated, USD literal, fallback path. |
| `stamp-pcd-cost-forecast.test.ts` | 6–8 | Estimator invocation, version pinning, payload shape, datetime stamp, ZodError on bad input, propagation of estimator errors. |
| `write-pcd-identity-snapshot-with-cost-forecast.test.ts` | 8–10 | Full orchestrator path, SP9 stamper composition (consent revoked → no estimator call), Tier 3 invariant fires before persist, store called with 27-field payload, error propagation, ZodError on bad input, full happy-path. |
| `prisma-pcd-identity-snapshot-store.test.ts` (widened) | +3–4 | New `createForShotWithCostForecast` mocked-prisma round-trip, adapter shape, byte-equivalent legacy `create()` body. |
| `pcd-cost-forecast.test.ts` (schemas) | 6–8 | Each schema parses valid input, rejects invalid input, `currency: "USD"` literal lock, readonly enforcement (TS-level test). |
| `sp10a-anti-patterns.test.ts` | 8 | Eight structural assertions above. |

**Estimated net SP10A test count:** ~40–55. (SP9 plan estimated ~80 and shipped 38 — projection error favors over-counting; SP10A's narrower scope should land in the 40-range.)

---

## 5. Data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Production runner (merge-back)                                         │
│  Calls writePcdIdentitySnapshotWithCostForecast({snapshot, provenance,  │
│  costForecast}, {pcdSp10IdentitySnapshotStore, creatorIdentityReader,   │
│  consentRecordReader, costEstimator, clock})                            │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1 — stampPcdProvenance({...provenance}, {readers, clock})         │
│  - Walks chain output (script→hook→motivator→trend→brief)              │
│  - Re-checks consent via SP6 assertConsentNotRevokedForGeneration       │
│  - Returns PcdSp9ProvenancePayload                                      │
│  Throws: ConsentRevokedRefusalError, InvariantViolationError, ZodError │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ success
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2 — stampPcdCostForecast({...costForecast}, {costEstimator, clock})│
│  - Calls injected costEstimator.estimate()                              │
│  - Pins PCD_COST_FORECAST_VERSION from import                          │
│  - Returns PcdSp10CostForecastReason                                    │
│  Throws: ZodError, estimator errors propagated raw                     │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ success
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3 — assertTier3RoutingDecisionCompliant(...)                      │
│  Same six-argument call as SP4 writer + SP9 orchestrator.              │
│  Throws: Tier3RoutingViolationError, Tier3RoutingMetadataMismatchError │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ success
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 4 — PcdSp4IdentitySnapshotInputSchema.parse(...)                  │
│  Same allowlist forwarding as SP4 + SP9. Throws: ZodError.             │
└─────────────┬───────────────────────────────────────────────────────────┘
              │ success
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 5 — Pin version constants + assemble 27-field payload             │
│  Imports: PCD_TIER_POLICY_VERSION, PCD_PROVIDER_CAPABILITY_VERSION,     │
│           PCD_PROVIDER_ROUTER_VERSION, PCD_PREPRODUCTION_CHAIN_VERSION  │
│           (PCD_COST_FORECAST_VERSION carried via cost payload).        │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 6 — pcdSp10IdentitySnapshotStore.createForShotWithCostForecast()  │
│  Persists 27-field row to PcdIdentitySnapshot.                          │
│  costForecastReason column populated; lineageDecisionReason populated;  │
│  SP4 columns populated.                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**No mutation, no abort, no prune.** Every step either succeeds or throws raw. Forecast is recorded as observed at stamp time.

---

## 6. Failure semantics

| Failure mode | Throws | Caught by orchestrator? |
|---|---|---|
| Bad provenance input (zod) | `ZodError` | No — propagated raw |
| Consent revoked at stamp time | `ConsentRevokedRefusalError` (from SP6) | No — propagated raw |
| Lineage walk fails (script id not in chain) | `InvariantViolationError` (from SP9) | No — propagated raw |
| Bad cost-forecast input (zod) | `ZodError` | No — propagated raw |
| Estimator rejects | Whatever the estimator throws | No — propagated raw |
| Bad estimator output (zod re-parse) | `ZodError` | No — propagated raw |
| Tier 3 routing violation | `Tier3RoutingViolationError` (from SP4) | No — propagated raw |
| Tier 3 metadata mismatch | `Tier3RoutingMetadataMismatchError` (from SP4) | No — propagated raw |
| SP4 input zod re-parse fails | `ZodError` | No — propagated raw |
| Persistence fails | Whatever the Prisma store throws | No — propagated raw |

**No `try`/`catch` in any SP10A source.** Same propagation rule as SP9. Anti-pattern test could be extended to enforce, but SP9 didn't add this assertion explicitly; SP10A doesn't either. Style baseline.

---

## 7. Module layout

```
packages/creative-pipeline/src/pcd/cost/
├── cost-estimator.ts                                    [interface only]
├── cost-forecast-version.ts                             [13th pinned constant]
├── stub-cost-estimator.ts                               [test/local default + STUB_COST_ESTIMATOR_VERSION]
├── stamp-pcd-cost-forecast.ts                           [pure stamper — sole import site for version]
├── pcd-sp10-identity-snapshot-store.ts                  [SP10A store contract]
├── write-pcd-identity-snapshot-with-cost-forecast.ts    [orchestrator — 3-way lock-step]
├── index.ts                                             [public surface barrel]
├── cost-forecast-version.test.ts
├── stub-cost-estimator.test.ts
├── stamp-pcd-cost-forecast.test.ts
├── write-pcd-identity-snapshot-with-cost-forecast.test.ts
└── sp10a-anti-patterns.test.ts

packages/schemas/src/
├── pcd-cost-forecast.ts                                 [new — SP10A schemas]
└── __tests__/pcd-cost-forecast.test.ts                  [schemas package convention]

packages/db/src/stores/
└── prisma-pcd-identity-snapshot-store.ts                [widened with SP10A method + adapter]

packages/db/prisma/migrations/
└── 20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/
    └── migration.sql                                     [single ALTER TABLE]
```

8 new source files in `pcd/cost/` + 1 new schemas file + 1 widened db file + 1 new migration. Plus the schemas barrel and creative-pipeline barrel re-exports (single-line edits).

**Files outside `pcd/cost/` that change:**
- `packages/schemas/src/index.ts` — re-export new schemas file
- `packages/creative-pipeline/src/index.ts` — re-export SP10A surface
- `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` — widened (existing SP4 + SP9 bodies preserved byte-equivalent)
- `packages/db/prisma/schema.prisma` — one line added (`costForecastReason Json?`)
- `docs/SWITCHBOARD-CONTEXT.md` — add SP10A merge-back surface section

---

## 8. Merge-back surfaces

**SP10A-declared merge-back surfaces (production wiring at merge-back):**

- **`CostEstimator` injection** — Switchboard ad-optimizer team owns the production `CostEstimator` implementer. Real estimator reads FX rates, volume tiers, contract pricing. SP10A ships only the contract + a deterministic stub. `// MERGE-BACK: replace with Switchboard cost estimator` marker on stub class declaration.
- **`adaptPcdSp10IdentitySnapshotStore(prismaStore)`** ships in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` and returns the SP10A contract shape. Wire as:
  ```ts
  writePcdIdentitySnapshotWithCostForecast(input, {
    pcdSp10IdentitySnapshotStore: adaptPcdSp10IdentitySnapshotStore(prismaStore),
    costEstimator: switchboardCostEstimator,
    creatorIdentityReader, consentRecordReader, clock,
  })
  ```
- **`WorkTrace` emit** — every SP10A state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `stamp-pcd-cost-forecast.ts` (after estimator return, after assembly), one in `write-pcd-identity-snapshot-with-cost-forecast.ts` (orchestrator pre-persist).
- **Production runner discipline** — at merge-back, all production callsites should call `writePcdIdentitySnapshotWithCostForecast` to get cost observability. Legacy SP4 `writePcdIdentitySnapshot` and SP9 `writePcdIdentitySnapshotWithProvenance` callsites remain valid for tests + ad-hoc backfills but write `costForecastReason = null`.
- **`fanoutDecisionId` convention** — still caller-supplied, inherited from SP9. Same `// MERGE-BACK: pick fanoutDecisionId convention` marker. SP10A does not lock this; SP10B or merge-back team picks.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.costForecastReason` — one new column added by SP10A migration `20260430130000_pcd_identity_snapshot_sp10a_cost_forecast`. If Switchboard `main` has not added an equivalent independently, the SP10A migration applies cleanly. If Switchboard added a same-semantic column with a different name, reconcile by renaming SP10A's column in the migration before merge-back.
- No FK constraints. The cost record is a self-contained Json struct.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10A stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/cost/` changes at merge-back — only the injected estimator + readers swap (Prisma-backed via `adaptPcdSp10IdentitySnapshotStore`, real cost estimator via Switchboard ad-optimizer) and the `// MERGE-BACK:` markers get implementations.
- `PCD_COST_FORECAST_VERSION` is the 13th pinned constant. The PCD slice carries 13 total pinned constants after SP10A.
- SP10A introduces NO circular dependency. `pcd/cost/` imports from `pcd/provenance/` (SP9 stamper, version constant) and from `pcd/` top-level (SP4 invariant, writer types, SP6 reader types). Reverse direction does not exist; `sp10a-anti-patterns.test.ts` enforces the source-freeze.
- The SP9 orchestrator body (`writePcdIdentitySnapshotWithProvenance`) is untouched. SP10A added a parallel orchestrator (`writePcdIdentitySnapshotWithCostForecast`) that COMPOSES SP9's pure stamper (calls `stampPcdProvenance` directly) and adds SP10A cost stamping. Anti-pattern test enforces SP4/SP9/SP10A invariant logic stays in 3-way lock-step.

---

## 9. Estimated work

| Slice | New source files | New schemas | New tests | Migration | Pinned constants added |
|---|---|---|---|---|---|
| SP9 | 5 | 1 schema file (3 schemas) | 38 net | 1 (6 cols, 2 indexes) | 1 (12th) |
| **SP10A** | **8** | **1 schema file (3 schemas)** | **~40–55 estimated** | **1 (1 col, 0 indexes)** | **1 (13th)** |

SP10A is structurally smaller than SP9 (one column, no indexes, narrower stamper) but adds slightly more source files because the estimator + stub + interface live as separate units. Total surface area is comparable to SP9.

---

## 10. What is NOT in scope (SP10A)

- **Tree-budget enforcement.** Reserved for SP10B. The `PreproductionTreeBudgetSchema { maxBranchFanout, maxTreeSize }` slot on `PcdIdentityContext` continues to be populated as `null` by `buildPcdIdentityContext`. SP10A does not enforce, prune, or abort.
- **Gate-time cost forecast.** `PcdProductionFanoutDecision.costForecast` stays `null` in SP10A. A future slice with a coarse pre-routing estimator variant fills this slot.
- **Multi-currency.** `currency` is the literal `"USD"` in SP10A schemas. Multi-currency is a future `PCD_COST_FORECAST_VERSION` bump (`@2.0.0`).
- **Flat numeric column on `PcdIdentitySnapshot` for cost analytics.** Range queries and group-by-script aggregations use Postgres JSON operators on the Json column. Analytics flattening is a merge-back concern.
- **Runtime invariant on bare `writePcdIdentitySnapshot` callsite.** No "production callsites must include cost data" runtime check. Reserved for SP10B's policy slice.
- **`fanoutDecisionId` convention lock.** Inherited from SP9; deferred to merge-back.
- **Pre-existing prettier issue on `tier-policy.ts` / `tier-policy.test.ts`.** Continues as baseline noise. SP10A changes only its own files.

---

## 11. References

- Memory: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` — SP1–SP9 state including SP9 implementation notes (`fanoutDecisionId` still caller-supplied, bare-writer callsite still exported).
- `~/creativeagent/CLAUDE.md` — repo invariants.
- `~/creativeagent/docs/SWITCHBOARD-CONTEXT.md` — merge-back contract.
- `~/creativeagent/docs/plans/2026-04-30-pcd-creative-source-provenance-sp9-design.md` — SP9 design (predecessor; SP10A inherits its accepted-risks list at §0).
- `~/creativeagent/docs/plans/2026-04-30-pcd-creative-source-provenance-sp9-plan.md` — SP9 implementation reference.
- `~/creativeagent/packages/creative-pipeline/src/pcd/provenance/index.ts` — SP9 public surface (SP10A pattern parallel).
- `~/creativeagent/packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts` — SP9 stamper that SP10A composes.
- `~/creativeagent/packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts` — SP9 orchestrator that SP10A's orchestrator parallels.
- `~/creativeagent/packages/schemas/src/pcd-preproduction.ts` — `PcdCostForecastSchema` (existing gate-time slot; not edited by SP10A).
- `~/creativeagent/packages/db/prisma/schema.prisma` — `PcdIdentitySnapshot` model (SP10A widens with `costForecastReason Json?`).
