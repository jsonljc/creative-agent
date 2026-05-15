# PCD SP20 — Performance-Overlay Re-rank — Design Spec

**Date:** 2026-05-16
**Status:** Draft (awaiting user review of written spec)
**Authors:** Jason + Claude (batched-recommendation brainstorming per user's "no clarifying questions" instruction; three amendments applied post first-pass review)
**Predecessor slice:** SP19 (PcdPerformanceSnapshot — net-new Prisma table 1:1 with AssetRecord, post-completion observability per attempt; squash `1d22d61` on 2026-05-16)
**Successor slices reserved by name:**
- **SP20.1** — Performance-overlay refinement (e.g. "known data beats cold-start", per-`(creator, shotType)` grain). Reserved by name only. NOT in SP20 scope.
- **SP20.5** — Cost-variance analytics (joins SP10A `costForecastReason` ⨯ SP19 `actualCostUsd`). Reserved by name only. NOT in SP20 scope.
- **SP21+** — Composer / runner integration that materializes `performanceHistory` from the metrics reader and threads it into the selector call site. NOT in SP20 scope.

---

## 1. Scope & Strategy

SP20 widens SP13's synthetic-creator selector with an optional **performance overlay** that re-ranks contractually-equivalent candidates by historical success rate and median latency drawn from SP19's `PcdPerformanceSnapshot` table. The selector body remains pure-deterministic; the overlay is a NEW optional input (`performanceHistory: ReadonlyMap<creatorIdentityId, CreatorPerformanceMetrics> | undefined`) supplied by the caller (the composer/runner — `// MERGE-BACK:` to Switchboard). When the overlay is absent or empty, SP20 produces **byte-identical** decisions to current SP13.

**Mental model (user-affirmed at design time):**

- **SP10A** = forecast per-asset cost at generation-decision time.
- **SP18** = stamp synthetic-routing decision at generation-decision time.
- **SP19** = capture actual performance at terminal-state time (success, failure, or manual skip).
- **SP20** = consume SP19 history in the SP13 selector to re-rank candidates **within contractually-equivalent SP12 buckets**.
- **SP21+** = runner/composer wires SP19 reader → metrics aggregation → selector input.

SP20 is the first PCD slice to **read SP19's table for ranking**. It is also the first slice to widen a forward-declared SP13 reservation slot (`metricsSnapshotVersion: z.null()` → `z.string().min(1).nullable()`).

**Key inflection (SP19 → SP20):** SP19 wrote the first post-completion forensic table. SP20 closes the observability → selection loop by feeding that table back into the decision surface. Until SP21+ wires the runner-side data pipeline, the table is empty and SP20 produces SP13-equivalent decisions (verified by an explicit test).

**Structural analog:** SP10C's relationship to SP10B (compose a chain-level concern on top of a frozen lower-level orchestrator without editing it). SP20 differs in one respect: SP13 **forward-declared** the reservation slots specifically for this slice (`metricsSnapshotVersion: z.null() // SP19/20 will widen`). Therefore SP20 directly widens SP13 at exactly those three reserved sites, rather than wrapping. The carve-out is bounded and explicit (Guardrail B-1 below).

**Locked invariant (user-stipulated, §2.1 below):** Performance MUST NEVER override SP12 contractual/license ordering. The overlay is a sub-tiebreaker that sorts WITHIN the bucket created by SP12's `(lockType, priorityRank, effectiveFrom)` ordering — it never re-orders across that boundary. A `hard_exclusive` license always outranks a `priority_access` license, regardless of historical performance.

**What SP20 deliberately does NOT do:**

- **No Prisma migration.** SP20 is pure orchestration plus an additive schema widen. SP19's table is read; no columns added, no new tables.
- **No widen of SP19's `PrismaPcdPerformanceSnapshotReader`.** That reader stays at `findByAssetRecordId` (per-asset). SP20 ships a NEW reader at per-creator aggregation grain. SP19 surface is frozen (Guardrail B-3).
- **No `// MERGE-BACK:` mutation of SP12 license-gate or SP18 router.** Only SP13 schema + selector + selector tests are touched (Guardrail B-1).
- **No per-`(creator, shotType)` grain.** Reserved as SP20.1. v1 ships per-creator overall — at SP20-land traffic levels (zero rows), shotType partitioning would only fragment empty data.
- **No cost-variance metric.** SP20 ships `successRate + medianLatencyMs` only. Cost-variance requires SP10A ⨯ SP19 join + per-creator forecast/actual reconciliation — that's SP20.5.
- **No widen of `selectorRank: z.literal(0)`.** SP20 changes ordering; it does not record forensic pre-overlay rank. Defer to a future slice if a consumer materializes.
- **No real provider API calls.** No Kling, no Seedance, no DALL-E. SP20 is a read-side selector concern.
- **No composer wiring (SP21+).** The call site that materializes the `performanceHistory` Map from the reader and threads it into the selector lives at the runner boundary, which is Switchboard-side. `// MERGE-BACK:` markers note the seam.
- **No stub seeder for local dev.** The SP19 table is empty at SP20 land; the empty-history path is the steady-state production path until SP21+ ships. Tests use in-memory fixtures.
- **No backfill of pre-SP19 attempts.** Pre-SP19 `AssetRecord` rows have no companion performance snapshot (per SP19 Guardrail G). The reader returns metrics computed only over rows that exist; pre-SP19 era is transparently excluded.
- **No selector-side aggregation.** The metrics reader computes `successRate` and `medianLatencyMs` at the database boundary (raw SQL allowed; Postgres `percentile_cont` is the canonical choice). The selector consumes a ready `Map<string, CreatorPerformanceMetrics>`. Aggregation logic never lives in `selector.ts`.
- **No `crypto` import in SP20 surface.** SP20 captures aggregated runtime values; it does not hash. Anti-pattern test enforces (SP19 precedent).

---

## 2. Locked decisions

### 2.1 Scope guardrails (user-approved)

**Guardrail A — performance overlay NEVER overrides SP12 contractual ordering (user-stipulated explicit invariant):**

> The SP13 comparator's first three positions (SP12 `lockType` rank → SP12 `priorityRank` for `priority_access` → SP12 `effectiveFrom`) stay unchanged and dominate ordering. The SP20 performance score is inserted at position 4, before the final `creatorIdentityId` ASC tiebreaker. Performance is therefore a sub-tiebreaker WITHIN license-equivalent buckets, never an eligibility gate and never a cross-bucket re-rank.

**Guardrail B — bounded source-body carve-out (user-approved exception to standing "no SP1–SPN source body edits" rule):**

> SP20 may edit ONLY the following three sites, all of which were forward-declared by SP13 specifically for this slice:
>
> 1. `packages/schemas/src/pcd-synthetic-selector.ts` — widen `metricsSnapshotVersion: z.null()` to `z.string().min(1).nullable()`; widen `performanceOverlayApplied: z.literal(false)` to `z.boolean()`. `selectorRank: z.literal(0)` stays as-is (not widened in SP20).
> 2. `packages/creative-pipeline/src/pcd/selector/selector.ts` — extend `SelectSyntheticCreatorInput` with optional `performanceHistory?: ReadonlyMap<string, CreatorPerformanceMetrics>`; extend `compareCandidates` with a position-4 performance sub-tiebreaker; populate the two widened fields on the success branch using `metrics.metricsVersion` from the supplied map.
> 3. `packages/creative-pipeline/src/pcd/selector/selector.test.ts` — extend coverage for the new optional input + cold-start + empty-history-equivalence.
>
> **No other source edits.** SP12 license-gate, SP18 router, SP19 reader/writer/store/stamper, SP10A stamper, SP10B/C orchestrators, SP14 disclosure, SP15 script, SP16 router, SP17 widening, Prisma schema, and existing migrations are all preserved verbatim. Anti-pattern test #1 enforces via diff against the SP19 squash SHA `1d22d61`, with an explicit allowlist for the three SP13 edit sites above.

**Guardrail C — composer-only version pinning + reader-stamped metricsVersion (user-clarified):**

> Two parts (mirrors SP9/SP10A/SP18/SP19 lock with one SP20-specific clarification):
>
> 1. **Sole literal site.** Among non-test source files, the literal `"pcd-performance-overlay@"` appears in exactly one file: `performance-overlay-version.ts`. No reader, schema, builder, fixture, or selector source may inline the literal. Anti-pattern test #2 enforces.
> 2. **Sole runtime import site.** Among non-test runtime sources, the symbol `PCD_PERFORMANCE_OVERLAY_VERSION` is imported by **exactly one file: the metrics reader/builder** (`packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts`). The selector does NOT import the version constant; it reads `metrics.metricsVersion` from the supplied map and writes that string into `metricsSnapshotVersion` on the decision. Tests are explicitly permitted to import the constant for literal-pin assertions; this is not a violation. Anti-pattern test #3 enforces both halves.
>
> Rationale (user-supplied): the metrics object IS the snapshot of the aggregation logic + window. The selector consumes the snapshot; it does not author one. Putting the version pin on the reader (the authoring boundary) and having the selector read-through prevents two writers stamping divergent versions on the same decision.

**Guardrail D — no `crypto` in SP20:**

> The SP20 surface (subdir, schema file, store file, reader file, version constant, fixture helper, anti-pattern test) MUST NOT import `node:crypto` or any `crypto` symbol. SP20 captures aggregated runtime values; it does not derive hashes. Anti-pattern test #4 enforces. (SP18 had a single `crypto.createHash` site for `promptHash`; SP19 had none; SP20 has none.)

**Guardrail E — no Prisma migration, no DB column widen, no model add:**

> SP20 is pure orchestration + schema widen + new reader. The `PcdPerformanceSnapshot` table (SP19) provides the input rows; no DDL is needed. No `ALTER TABLE`, no new model. Anti-pattern test #5 verifies `packages/db/prisma/migrations/` contains no SP20-dated migration directory.

**Guardrail F — selector body stays pure deterministic:**

> No `Date.now()`, no `new Date()`, no DB reads, no I/O of any kind inside `selector.ts`. The new `performanceHistory` input is a pure data structure threaded in from the caller. Test: vary `now`, identical decision (SP15 J8 / SP19 anti-pattern test precedent extended to cover the new overlay code path).

**Guardrail G — empty-history is SP13-equivalent (user-sharpened amendment to Q6):**

> When the supplied `performanceHistory` map is `undefined`, OR is defined but no entry exists for either candidate being compared, OR an entry exists for one or both candidates with `sampleSize === 0`, the SP20 sub-tiebreaker MUST return `0`. This guarantees:
>
> - SP20 at land time (table empty) produces byte-identical decisions to SP13 — verified by an explicit "empty-history is SP13-equivalent" test that runs the full selector test suite twice (once with `performanceHistory: undefined`, once with `performanceHistory` an empty map) and asserts byte-identical decisions.
> - A known weak performer is never penalized below a never-tested creator (deferred to SP20.1 if that policy is desired).
>
> Encoded in the comparator as:
> ```ts
> // Cold-start no-op rule (Guardrail G):
> if (am === undefined || bm === undefined) return 0;
> if (am.sampleSize === 0 || bm.sampleSize === 0) return 0;
> // Both candidates have real samples; apply sub-tiebreakers.
> if (am.successRate !== bm.successRate) return bm.successRate - am.successRate;
> if (am.medianLatencyMs !== bm.medianLatencyMs) {
>   // Both are non-null when sampleSize > 0 (reader contract).
>   return am.medianLatencyMs! - bm.medianLatencyMs!;
> }
> return 0;
> ```

**Guardrail H — median computed at DB boundary, never selector-side (user-sharpened amendment to Q3):**

> `medianLatencyMs` MUST be computed in the metrics reader (`packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts`) at the database boundary. Raw SQL is permitted: Postgres `percentile_cont(0.5) WITHIN GROUP (ORDER BY latencyMs)` is the canonical choice. If `Prisma.sql` raw is required to express it cleanly, that is acceptable in this one reader. Anti-pattern test #6 verifies `selector.ts` contains no `.sort(`, no `.reduce(`, and no statistical-aggregation symbols (`percentile`, `median`, `quantile`). The selector receives a ready `Map<string, CreatorPerformanceMetrics>` and treats `medianLatencyMs` as a precomputed scalar.

**Guardrail I — schemas barrel widened upfront:**

> `packages/schemas/src/index.ts` re-exports `./pcd-creator-performance-metrics.js` in the first implementation task, not at the end. SP14 lesson, codified by SP15 / SP19. Subsequent tasks import from `@creativeagent/schemas` without deep-path workarounds.

**Guardrail J — no widen of `selectorRank`:**

> `selectorRank: z.literal(0)` stays as-is in SP13. SP20 does not record forensic pre-overlay rank; the question "did the overlay move the pick?" is answered by reading the `performanceOverlayApplied: true` flag alongside running the selector twice in test (with and without the map). If a future slice needs persistent pre-overlay rank capture, it widens this slot then.

### 2.2 Architectural locks (Q1–Q12)

All twelve open questions raised in brainstorming are answered above. For traceability:

| Q | Answer | Driving guardrail |
|---|---|---|
| Q1 reader shape | New per-creator reader; SP19 reader untouched | B-3 |
| Q2 grain | Per-creator overall; per-`(creator, shotType)` reserved as SP20.1 | scope |
| Q3 aggregation shape | Pre-computed `CreatorPerformanceMetrics`; aggregation in reader | H |
| Q4 time window | 30 days, reader-side default; `since: Date` input for SP21+ flex | scope |
| Q5 re-rank semantics | Soft sort within SP12 buckets; comparator position 4 | A |
| Q6 cold-start | Comparator returns 0; SP13-equivalent at empty | G |
| Q7 determinism | Selector body stays pure; `now` insensitivity test | F |
| Q8 metricsSnapshotVersion | Widen; reader stamps `metricsVersion`, selector reads-through | C-2 |
| Q9 constant count | 23 → 24 (`PCD_PERFORMANCE_OVERLAY_VERSION`) | C |
| Q10 cost variance | Deferred to SP20.5 | scope |
| Q11 composer integration | `// MERGE-BACK:` markers; no stub seeder | scope |
| Q12 test data strategy | In-memory reader stub + fixture helper | test pattern |

---

## 3. Surface inventory

### 3.1 New files (SP20 surface — 6 files)

```
packages/schemas/src/
  pcd-creator-performance-metrics.ts          # NEW — CreatorPerformanceMetrics schema + type

packages/db/src/stores/
  prisma-pcd-creator-performance-metrics-reader.ts   # NEW — SQL-aggregating reader; sole runtime importer of PCD_PERFORMANCE_OVERLAY_VERSION
  in-memory-pcd-creator-performance-metrics-reader.ts # NEW — test double (matches SP12/13 in-memory store precedent)

packages/creative-pipeline/src/pcd/selector/
  performance-overlay-version.ts              # NEW — sole literal site for PCD_PERFORMANCE_OVERLAY_VERSION

packages/creative-pipeline/src/pcd/selector/
  build-creator-performance-metrics.fixture.ts # NEW — test fixture helper

packages/creative-pipeline/test/pcd/
  sp20-anti-patterns.test.ts                  # NEW — 6 anti-pattern tests + allowlist for 3 SP13 edit sites
```

### 3.2 Widened files (SP20 surface — exactly 3 files per Guardrail B-1)

```
packages/schemas/src/pcd-synthetic-selector.ts       # widen metricsSnapshotVersion + performanceOverlayApplied
packages/creative-pipeline/src/pcd/selector/selector.ts  # signature + comparator position 4 + decision population
packages/creative-pipeline/src/pcd/selector/selector.test.ts  # extend coverage
```

### 3.3 Updated allowlists (SP9–SP19 anti-pattern tests + barrel re-export)

```
packages/creative-pipeline/test/pcd/sp9-anti-patterns.test.ts   # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp10a-anti-patterns.test.ts # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp10b-anti-patterns.test.ts # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp10c-anti-patterns.test.ts # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp14-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp15-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp16-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp17-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp18-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/creative-pipeline/test/pcd/sp19-anti-patterns.test.ts  # allowlist 3 SP13 edit sites
packages/schemas/src/index.ts                                   # add `export * from "./pcd-creator-performance-metrics.js"` (Guardrail I, first task)
```

(11 anti-pattern allowlist updates + 1 schemas barrel widen. The selector body's pcd-synthetic-selector test file is implicitly covered.)

### 3.4 Frozen (must not change)

Everything else in `packages/schemas/`, `packages/db/`, `packages/creative-pipeline/`, `packages/db/prisma/`, including (non-exhaustive): all SP1–SP12 source files, SP14–SP19 source files, all SP1–SP18 Prisma migrations, the SP19 reader, the SP19 writer, the SP19 stamper, the SP19 store contract.

---

## 4. Data shapes

### 4.1 `CreatorPerformanceMetrics` (new schema)

```ts
// packages/schemas/src/pcd-creator-performance-metrics.ts
import { z } from "zod";

export const CreatorPerformanceMetricsSchema = z
  .object({
    creatorIdentityId: z.string().min(1),
    sampleSize: z.number().int().min(0),
    successCount: z.number().int().min(0),
    failureCount: z.number().int().min(0),
    manualSkipCount: z.number().int().min(0),
    // successRate is success / sampleSize; 0 when sampleSize === 0.
    successRate: z.number().min(0).max(1),
    // medianLatencyMs is null iff sampleSize === 0 (reader contract).
    medianLatencyMs: z.number().int().min(0).nullable(),
    windowStart: z.date(),
    windowEnd: z.date(),
    // Stamped by the reader; selector reads-through onto the decision.
    metricsVersion: z.string().min(1),
  })
  .strict()
  .readonly();
export type CreatorPerformanceMetrics = z.infer<typeof CreatorPerformanceMetricsSchema>;
```

**Invariants (reader contract, defense-in-depth Zod parse at the reader boundary):**

- `successCount + failureCount + manualSkipCount === sampleSize`.
- `sampleSize === 0` ⇒ `medianLatencyMs === null` AND `successRate === 0`.
- `sampleSize > 0` ⇒ `medianLatencyMs !== null`.
- `windowEnd > windowStart`.
- `metricsVersion === PCD_PERFORMANCE_OVERLAY_VERSION`.

### 4.2 `PCD_PERFORMANCE_OVERLAY_VERSION` (new pinned constant — 24th)

```ts
// packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts
export const PCD_PERFORMANCE_OVERLAY_VERSION = "pcd-performance-overlay@1.0.0";
```

Sole literal site. Sole runtime importer is the metrics reader (`packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts`).

### 4.3 SP13 schema widen

```ts
// packages/schemas/src/pcd-synthetic-selector.ts — SuccessDecisionSchema
{
  // ... unchanged fields ...
  selectorRank: z.literal(0),                                  // UNCHANGED
  metricsSnapshotVersion: z.string().min(1).nullable(),        // WIDENED from z.null()
  performanceOverlayApplied: z.boolean(),                      // WIDENED from z.literal(false)
  // ... unchanged fields ...
}
```

### 4.4 SP13 selector input widen

```ts
// packages/creative-pipeline/src/pcd/selector/selector.ts
export type SelectSyntheticCreatorInput = {
  brief: CreativeBrief;
  now: Date;
  roster: readonly RosterEntry[];
  leases: readonly CreatorIdentityLicensePayload[];
  // NEW (optional — undefined ⇒ no overlay; equivalent to SP13 behavior):
  performanceHistory?: ReadonlyMap<string, CreatorPerformanceMetrics>;
};
```

### 4.5 SP13 comparator widen

```ts
// packages/creative-pipeline/src/pcd/selector/selector.ts
function compareCandidates(
  a: AllowedCandidate,
  b: AllowedCandidate,
  performanceHistory: ReadonlyMap<string, CreatorPerformanceMetrics> | undefined,
): number {
  // Positions 1-3 (SP12 contractual ordering) UNCHANGED:
  const ra = LOCK_TYPE_RANK[a.gate.license.lockType];
  const rb = LOCK_TYPE_RANK[b.gate.license.lockType];
  if (ra !== rb) return ra - rb;
  if (a.gate.license.lockType === "priority_access" && b.gate.license.lockType === "priority_access") {
    const pa = a.gate.license.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const pb = b.gate.license.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
  }
  if (a.gate.license.effectiveFrom.getTime() !== b.gate.license.effectiveFrom.getTime()) {
    return a.gate.license.effectiveFrom.getTime() - b.gate.license.effectiveFrom.getTime();
  }

  // NEW position 4 — SP20 performance sub-tiebreaker:
  if (performanceHistory !== undefined) {
    const am = performanceHistory.get(a.entry.creatorIdentity.id);
    const bm = performanceHistory.get(b.entry.creatorIdentity.id);
    // Cold-start no-op rule (Guardrail G).
    if (am !== undefined && bm !== undefined && am.sampleSize > 0 && bm.sampleSize > 0) {
      if (am.successRate !== bm.successRate) return bm.successRate - am.successRate;
      if (am.medianLatencyMs !== bm.medianLatencyMs) {
        return am.medianLatencyMs! - bm.medianLatencyMs!;
      }
    }
  }

  // Position 5 (final determinism tiebreak) UNCHANGED:
  const cidA = a.entry.creatorIdentity.id;
  const cidB = b.entry.creatorIdentity.id;
  return cidA < cidB ? -1 : cidA > cidB ? 1 : 0;
}
```

### 4.6 SP13 decision population (success branch only)

```ts
// packages/creative-pipeline/src/pcd/selector/selector.ts — within selectSyntheticCreator
const overlayApplied = input.performanceHistory !== undefined;
const overlayVersionFromMap = overlayApplied
  ? (() => {
      // Pull from any entry in the map (all entries share the same metricsVersion by reader contract).
      const firstEntry = input.performanceHistory!.values().next();
      return firstEntry.done ? null : firstEntry.value.metricsVersion;
    })()
  : null;

return {
  // ... unchanged fields ...
  selectorRank: 0,                                  // UNCHANGED
  metricsSnapshotVersion: overlayVersionFromMap,    // populated when overlay applied AND map non-empty
  performanceOverlayApplied: overlayApplied,        // true iff caller supplied a map (even empty)
  // ... unchanged fields ...
};
```

**Edge case (called out for the implementer):** an empty `performanceHistory` Map (caller signals "overlay applied but no data yet") yields `performanceOverlayApplied: true, metricsSnapshotVersion: null`. This is a valid state and is preserved through the schema widen (`z.string().min(1).nullable()` allows null). A non-empty map always yields a string version.

### 4.7 Metrics reader contract

```ts
// packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts
export type FindMetricsForCreatorsInput = {
  creatorIdentityIds: readonly string[];
  window: { since: Date };  // windowStart; windowEnd is "now" at read time (DB-side NOW()).
};

export class PrismaPcdCreatorPerformanceMetricsReader {
  constructor(private readonly client: Pick<PrismaClient, "$queryRaw" | "pcdPerformanceSnapshot">) {}

  async findMetricsForCreators(
    input: FindMetricsForCreatorsInput,
  ): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>>;
}
```

**Implementation note (Guardrail H):**
- Aggregation is `GROUP BY creatorIdentityId` with `COUNT(*) FILTER (WHERE terminal_kind = 'success')`, parallel COUNTs for `failure` and `manual_skip`, and `percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)`.
- Filter: `captured_at >= $since`.
- **Creator linkage:** `PcdPerformanceSnapshot` rows are 1:1 with `AssetRecord`. Reader joins `PcdPerformanceSnapshot → AssetRecord → PcdIdentitySnapshot → creatorIdentityId` to resolve the creator for each performance row. (Verify this chain exists at implementation time; if `PcdIdentitySnapshot.creatorIdentityId` is not directly reachable from an `AssetRecord`, the plan's first task is to confirm the join path against the Prisma schema. Reader is the right place to bear this complexity per Guardrail H.)
- Creators with zero rows in the window appear in the returned Map with `sampleSize: 0, successRate: 0, medianLatencyMs: null` — explicit cold-start entries, not absent entries. This is a reader contract choice that makes "no entry vs. zero samples" the same comparator no-op via Guardrail G.
- `metricsVersion` is stamped from `PCD_PERFORMANCE_OVERLAY_VERSION` on every returned entry.

---

## 5. Data flow

```
┌────────────────────────────────────────────────────────────────────────┐
│  Composer / Runner (Switchboard-side, // MERGE-BACK:)                  │
│                                                                        │
│    1. Build SelectSyntheticCreatorInput (brief, roster, leases, now).  │
│    2. Extract candidate creatorIds from roster.filter(isCompatible).   │
│    3. perfMap = await reader.findMetricsForCreators({                  │
│          creatorIdentityIds: candidateIds,                             │
│          window: { since: subDays(new Date(), 30) },                   │
│       });                                                              │
│    4. decision = selectSyntheticCreator({ ...input,                    │
│                                            performanceHistory: perfMap │
│                                          });                           │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SP13 selector (pure deterministic) — SP20-widened body                │
│                                                                        │
│  - Step 1: compatible filter (unchanged from SP13).                    │
│  - Step 2: license-gate per candidate (unchanged from SP13).           │
│  - Step 3: rank survivors with NEW position-4 performance subtiebreak. │
│  - Step 4: emit decision; populate metricsSnapshotVersion +            │
│    performanceOverlayApplied from the supplied map.                    │
└────────────────────────────────────────────────────────────────────────┘
```

At SP20 land time, step 3 in the runner returns an empty map (table is empty). Step 4 calls the selector with an empty `performanceHistory`. Guardrail G makes the comparator a no-op; the decision is byte-identical to SP13 except `performanceOverlayApplied: true` and `metricsSnapshotVersion: null`. (Caller may instead pass `performanceHistory: undefined` to opt out of overlay entirely — `performanceOverlayApplied: false`, same as SP13 today. Tests verify both shapes.)

---

## 6. Test surface

### 6.1 Selector tests (`selector.test.ts` — extend)

Building on the existing SP13 suite:

1. **Empty-history equivalence (Guardrail G).** Run every existing SP13 test case twice: once with `performanceHistory: undefined`, once with `performanceHistory: new Map()`. Assert byte-identical decision bodies in both passes (`overlayApplied` flag and `metricsSnapshotVersion` slot differ predictably; all other fields identical).
2. **Cold-start no-op (Guardrail G, both `sampleSize === 0` sides).** Three creators, license-equivalent; only one has metrics with `sampleSize > 0`. Comparator returns 0 between cold-start pairs → `creatorIdentityId` ASC tiebreak survives.
3. **Performance sub-tiebreaker fires WITHIN bucket.** Two creators, identical lockType / priorityRank / effectiveFrom. Creator B has higher `successRate`. Assert B is selected.
4. **Latency sub-sub-tiebreaker.** Two creators, identical `successRate` (e.g. both 1.0 with sampleSize ≥ 5). Lower `medianLatencyMs` wins.
5. **Performance NEVER crosses contractual bucket (Guardrail A).** Creator A holds `hard_exclusive`, Creator B holds `priority_access`. Creator B has 100% success rate; Creator A has 0%. Assert Creator A is selected (license dominates).
6. **Performance NEVER crosses `priorityRank` (Guardrail A).** Both `priority_access`. A has `priorityRank: 1`, 0% success. B has `priorityRank: 5`, 100% success. A wins.
7. **Performance NEVER crosses `effectiveFrom` (Guardrail A).** Same lockType, same `priorityRank`, A's lease started earlier. A wins regardless of perf.
8. **`now` insensitivity (Guardrail F).** Vary `input.now` over a wide range; assert identical decisions. Selector body is `now`-pure.
9. **`metricsVersion` read-through (Guardrail C-2).** Build a fixture map where every entry's `metricsVersion` is the pinned constant. Assert `decision.metricsSnapshotVersion === PCD_PERFORMANCE_OVERLAY_VERSION`.
10. **Empty-map yields `metricsSnapshotVersion: null`.** Caller signals "overlay applied but no data". `performanceOverlayApplied: true, metricsSnapshotVersion: null` (Guardrail C-2 edge case).
11. **Rejection-path decisions unchanged.** SP13 rejection branches (`no_compatible_candidates`, `all_blocked_by_license`) do not carry overlay fields; assert the rejection branch is structurally identical to SP13.

### 6.2 Reader tests (`prisma-pcd-creator-performance-metrics-reader.test.ts`)

Integration tests against a real Postgres (existing project pattern from SP19 reader tests):

1. **Empty table returns empty Map.** Zero rows in `PcdPerformanceSnapshot` → returned Map is empty.
2. **Zero rows for a queried creatorId yield `sampleSize: 0` entry, not absent.** Pre-seeds 3 creators; queries 4. The fourth appears with `sampleSize: 0`.
3. **Mixed terminal kinds aggregate correctly.** Insert 3 success + 2 failure + 1 manual_skip for one creator. Assert counts; assert `successRate === 0.5`; assert `medianLatencyMs` is the SQL-computed median.
4. **Window filter excludes pre-window rows.** Insert 5 rows within window + 3 rows before `since`. Returned `sampleSize === 5`.
5. **`metricsVersion` stamp.** Every returned entry has `metricsVersion === PCD_PERFORMANCE_OVERLAY_VERSION`.
6. **`windowStart` / `windowEnd` reflect the query window.** Returned `windowStart === input.since`; `windowEnd` ≈ DB `NOW()` at query time.

### 6.3 In-memory reader stub (`in-memory-pcd-creator-performance-metrics-reader.ts`)

Used by selector consumers in tests at SP21+. Ships in SP20 for parity with SP12/13 store-double precedent. Single test verifies it returns a frozen view of the seeded map.

### 6.4 Anti-pattern tests (`sp20-anti-patterns.test.ts` — new, 6 tests)

1. **No source-body edits beyond the allowlist.** Diff against SP19 squash `1d22d61`. Allowlisted paths: the three sites in Guardrail B-1 plus the new SP20 files in §3.1 plus the 11 anti-pattern allowlist updates plus the schemas barrel widen. Any other changed source file fails.
2. **Sole literal site for `"pcd-performance-overlay@"`.** Grep all non-test source files; assert hit count === 1 (`performance-overlay-version.ts`).
3. **Sole runtime import site for `PCD_PERFORMANCE_OVERLAY_VERSION`.** Grep all non-test runtime source files; assert hit count === 1 (`prisma-pcd-creator-performance-metrics-reader.ts`). `selector.ts` must NOT import the constant.
4. **No `crypto` in SP20 surface.** Grep the SP20 subdir + schema file + reader file for `from "crypto"` / `from "node:crypto"` / `createHash` / `randomUUID`. Zero hits.
5. **No SP20-dated Prisma migration directory.** `ls packages/db/prisma/migrations/` returns no `2026-05-{16,17,18,...}` directory created by SP20.
6. **Selector body contains no aggregation / median / sort symbols.** Grep `selector.ts` for `.sort(`, `.reduce(`, `percentile`, `median`, `quantile`. Zero hits. (`.filter` and `.map` are permitted — already used by SP13 compatible-filter and decision-population.)

### 6.5 Allowlist updates to SP9–SP19 anti-pattern tests (11 files)

Each existing slice's anti-pattern test diffs against a pinned SHA and asserts "no source body edits to SP1–SP{N-1} files." SP20's three carved-out SP13 edits must be added to each of those 11 allowlists, with a per-test comment pointing at SP20's design doc (this file) for the rationale.

---

## 7. `// MERGE-BACK:` markers

SP20 lays down these markers in source (each is a single comment line above the call site / contract):

1. **Metrics reader call site** (does not exist in this repo — runner-side). Marker in the reader file's header doc: `// MERGE-BACK: composer/runner instantiates this reader and threads its output into selectSyntheticCreator via performanceHistory`.
2. **Window default** (`since: subDays(new Date(), 30)`). Marker in the reader: `// MERGE-BACK: SP21+ composer may override the 30-day default per brief or per tier`.
3. **`PcdIdentitySnapshot.creatorIdentityId` join path** (verify at impl time; see §4.7). Marker in the reader SQL: `// MERGE-BACK: Switchboard may have a richer denormalized join — reconcile`.
4. **Per-`(creator, shotType)` extension hook**. Marker on the `CreatorPerformanceMetrics` schema: `// MERGE-BACK: SP20.1 may add byShotType?: Record<PcdShotType, CreatorPerformanceMetrics>`.
5. **Cost-variance extension hook**. Marker on the `CreatorPerformanceMetrics` schema: `// MERGE-BACK: SP20.5 may add costVarianceUsd?: number — joins SP10A forecast × SP19 actual`.
6. **Selector input optionality**. Marker on the `SelectSyntheticCreatorInput.performanceHistory` field: `// MERGE-BACK: Switchboard's composer always supplies this once runner integration ships; optionality is a SP20-land-time accommodation`.

---

## 8. Out-of-scope (deferred, explicit)

- **SP20.1** — Per-`(creator, shotType)` grain.
- **SP20.x** — "Known data always beats cold-start" comparator change (policy choice; SP20 ships the neutral default).
- **SP20.5** — Cost-variance metric (SP10A ⨯ SP19 join).
- **SP21+** — Runner/composer wiring that materializes the `performanceHistory` map and threads it through.
- **Forensic pre-overlay rank capture** (widening `selectorRank`).
- **Configurable time window as selector input** (currently a reader-side default; selector consumes the map regardless of how the window was chosen).
- **Selector-side aggregation** (forbidden by Guardrail H; SQL boundary always).
- **Backfill of pre-SP19 attempts** (forbidden by SP19 Guardrail G; reader silently excludes them via `captured_at >= since`).

---

## 9. Risks & known issues

1. **`PcdPerformanceSnapshot → PcdIdentitySnapshot` join path may need verification.** The reader joins through `AssetRecord → PcdIdentitySnapshot → creatorIdentityId`. If the chain breaks (e.g., `PcdIdentitySnapshot` does not directly carry `creatorIdentityId` reachable from an `AssetRecord`), the plan's first task verifies and adjusts. Mitigation: the join lives in the reader (Guardrail H), so a complexity surprise is bounded.

2. **`percentile_cont` is Postgres-specific.** Test/CI database must be Postgres (matches existing project setup — SP19 reader already uses Postgres). If a future port to SQLite ships (no current plan), this reader needs a different median strategy.

3. **`metricsVersion` consistency across map entries.** The reader stamps every entry with the same constant. If two readers with different pinned versions ever coexist (e.g., SP20 + SP20.5 both writing), the selector's "pull from first entry" approach would prefer one arbitrarily. Mitigation: anti-pattern test #3 keeps the constant single-import — only one reader stamps in this repo. SP20.5 would re-evaluate.

4. **`onDelete: Restrict` on SP19** means deleting an `AssetRecord` referenced by a `PcdPerformanceSnapshot` row fails. This is inherited from SP19 (Guardrail H there); SP20 is read-only, so no new exposure. Documented for the SP20 reader test cleanup order (delete performance rows first).

5. **Performance overlay is structurally a no-op at SP20 land time.** Anyone running the system pre-SP21+ will see SP13-equivalent decisions. This is by design (Guardrail G); the slice ships the data foundation and the selector hook, leaving the wire-up to SP21+. Test #1 in §6.1 verifies the equivalence.

6. **Selector-body widen breaks Guardrail B precedent.** SP9–SP19 standing rule was "no SP1–SP{N-1} source body edits." SP20 widens SP13 at three explicitly forward-declared sites. **Mitigation:** Guardrail B-1 is precise about what's allowed. The 11 prior anti-pattern tests each add an explicit allowlist entry pointing at this design doc. Future slices' anti-pattern tests inherit the same allowlist.

---

## 10. Pinned constant census

23 → 24:

| # | Constant | Owner slice | Pinned literal site |
|---|---|---|---|
| 1–23 | (existing) | SP4–SP19 | (per memory) |
| 24 | `PCD_PERFORMANCE_OVERLAY_VERSION = "pcd-performance-overlay@1.0.0"` | SP20 | `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts` |

---

## 11. Open questions for the plan (none architectural — all impl-detail)

1. The Postgres `percentile_cont` raw-SQL form (Prisma 5 supports `$queryRaw` with tagged-template parameters — verify the project's existing usage pattern).
2. Whether the SQL aggregator JOINs through `AssetRecord` or whether `PcdPerformanceSnapshot` already exposes `creatorIdentityId` via denorm (§9 risk #1). Plan task 1 verifies against the Prisma schema.
3. Where the 30-day default is named (reader-internal constant vs. caller-supplied with a documented default). Recommendation: caller-supplied, reader has no time-default — keeps the reader pure and lets SP21+ vary without a reader edit.

These do not block design lock; they are normal plan-time concerns.

---

## 12. Done definition

- All 6 new files exist and pass typecheck / lint / prettier.
- All 3 widened files pass typecheck / lint / prettier.
- All 11 prior anti-pattern tests pass with new SP13 allowlist entries.
- New `sp20-anti-patterns.test.ts` passes (6 anti-pattern assertions).
- New selector tests pass (11 cases per §6.1).
- New reader integration tests pass (6 cases per §6.2).
- `PCD_PERFORMANCE_OVERLAY_VERSION` appears as a literal in exactly one source file.
- `PCD_PERFORMANCE_OVERLAY_VERSION` is imported by exactly one runtime source file (the metrics reader).
- `selector.ts` does not import `PCD_PERFORMANCE_OVERLAY_VERSION`.
- No new Prisma migration created.
- No `crypto` imports added.
- Branch `pcd/sp20-performance-overlay-rerank` ready for squash-merge to `main` as `feat(pcd): SP20 — performance-overlay re-rank (synthetic-creator selector widening)`.
