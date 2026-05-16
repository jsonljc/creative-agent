# SP21 — Synthetic-Creator Selection Composer (design)

**Date:** 2026-05-16
**Predecessor:** SP20 (performance-overlay re-rank, squash `06ba0ac`)
**Slice type:** First impure orchestrator in the PCD vertical
**Output unit:** Async composer that closes the SP20 "caller supplies `performanceHistory`" loop

---

## 1. Purpose

SP20 widened the SP13 pure selector with an optional `performanceHistory` overlay
input. Nothing in the repo calls it. SP21 is the **composer** that:

1. Reads the synthetic-creator roster (SP11 seed for now).
2. Reads active leases scoped to the brief.
3. Reads SP20 performance metrics over a 30-day window.
4. Invokes the pure `selectSyntheticCreator` and returns its decision unchanged.

SP21 is structurally analogous to **SP10C** (a composing orchestrator wrapping a
pure lower-level function with impure I/O at the boundary), but unlike SP10C it
is the **first composer in the PCD vertical**. The shape it lands locks the
pattern for future composers (generation SP22+, terminal-state-write SP23+, QC
SP24+).

### 1.1 Out of scope (hard locks)

- SP4 routing (`routePcdShot`) — that is the generation composer, SP22+.
- PcdIdentitySnapshot writes — SP22+.
- SP5 QC, SP6 consent gates — post-generation, separate composers.
- SP16/17/18 synthetic-router stamping — SP22+.
- SP10C cost-budget — chain-level, already in place.
- SP19 terminal-state writer — post-generation, owned by a future runner composer.
- Inngest step wrapping — Switchboard-side, // MERGE-BACK.
- New Prisma synthetic-creator roster reader — reserved SP21.1.

### 1.2 Hard rules carried forward

- No edits to SP1–SP20 source bodies; SP20's carve-out of SP13 is closed.
- No reopening of SP13's rejection union — store failures are infra errors, not
  selector refusals.
- No new pinned constants; count stays at **24**.
- Additive-only Prisma changes; no migrations in SP21.
- Three-layer rule preserved: `creative-pipeline` depends on `schemas` only; DB
  readers are wired in at the runner/app layer.
- **NEW guardrail:** the composer file MUST NOT import `@creativeagent/db`.

---

## 2. Composer surface

Free-standing async function. Matches every prior PCD composer (SP4, SP9, SP10A,
SP10B, SP10C, SP16, SP18). SP19's class-shape is justified by Prisma-client
constructor injection at the **reader** layer; the SP21 composer receives
already-injected readers via its `stores` argument and therefore stays a
function.

```ts
// packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts
export type ComposeSyntheticCreatorSelectionInput = {
  brief: CreativeBrief;
  now: Date; // SP13 J8 precedent — never read the clock inside the composer.
};

export type ComposeSyntheticCreatorSelectionStores = {
  rosterReader: SyntheticCreatorRosterReader;
  leaseReader: SyntheticCreatorLeaseReader;
  metricsReader: SyntheticCreatorMetricsReader;
};

export async function composeSyntheticCreatorSelection(
  input: ComposeSyntheticCreatorSelectionInput,
  stores: ComposeSyntheticCreatorSelectionStores,
): Promise<SyntheticCreatorSelectionDecision>;
```

**Return type is SP13's existing `SyntheticCreatorSelectionDecision`, unchanged.**
The composer does not introduce a new decision union, does not extend any schema,
and does not pin a new version. Provenance already rides on
`selectorVersion` (SP13) and `metricsSnapshotVersion` (SP20 read-through).

### 2.1 Layering — composer must not import `@creativeagent/db`

The composer file imports only:

- `@creativeagent/schemas` — `CreativeBrief`, `CreatorIdentityLicensePayload`,
  `CreatorPerformanceMetrics`, `Market`, `SyntheticCreatorSelectionDecision`,
  `TreatmentClass`.
- `../synthetic-creator/seed.js` — the `RosterEntry` type.
- `./selector.js` — `selectSyntheticCreator`.

Concrete Prisma readers live in `@creativeagent/db` and are instantiated by the
app/runner layer (Switchboard wiring at merge-back). The composer depends on the
three port interfaces defined alongside it; it does not know that Prisma exists.

This is the rule SP20 caught and fixed once; SP21 must not regress it.

---

## 3. Store port interfaces

Three narrow ports, defined in the composer file (or in a sibling `ports.ts` if
size grows). Each concrete reader satisfies one port. In-memory test fakes are
`vi.fn()` shaped to the port.

```ts
export interface SyntheticCreatorRosterReader {
  // v1 returns SP11_SYNTHETIC_CREATOR_ROSTER pre-filtered by compatibility scope.
  // MERGE-BACK: replaced by a real Prisma reader at SP21.1.
  listActiveCompatibleRoster(input: {
    market: Market;
    treatmentClass: TreatmentClass;
  }): Promise<readonly RosterEntry[]>;
}

export interface SyntheticCreatorLeaseReader {
  // DB-side filter — composer never fetches "all leases for clinic" and trims.
  // SP13 selector still license-gates each candidate against this narrow pool.
  findActiveLeasesForBriefScope(input: {
    clinicId: string;
    market: Market;
    treatmentClass: TreatmentClass;
    now: Date;
  }): Promise<readonly CreatorIdentityLicensePayload[]>;
}

export interface SyntheticCreatorMetricsReader {
  // Port shape matches SP20's PrismaPcdCreatorPerformanceMetricsReader EXACTLY
  // so the existing reader satisfies the port without an adapter.
  findMetricsForCreators(input: {
    creatorIdentityIds: readonly string[];
    window: { since: Date };
  }): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>>;
}
```

### 3.1 Concrete reader work in SP21

| Port | Concrete impl | Status |
|---|---|---|
| `SyntheticCreatorRosterReader` | `Sp11SeedSyntheticCreatorRosterReader` (in-memory, reads `SP11_SYNTHETIC_CREATOR_ROSTER`) | **NEW** in `creative-pipeline`. Explicitly named as the temporary seed bridge. Replaced at SP21.1 / merge-back. |
| `SyntheticCreatorLeaseReader` | `PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope` | **NEW method** on the existing reader in `@creativeagent/db`. Additive only. |
| `SyntheticCreatorMetricsReader` | `PrismaPcdCreatorPerformanceMetricsReader.findMetricsForCreators` (SP20) + `InMemoryPcdCreatorPerformanceMetricsReader` (SP20) | **Existing.** Port shape is set to match these readers verbatim. Zero adapter work. |

**Guardrail:** SP21 must not create a Prisma synthetic-creator roster reader.
That belongs to SP21.1 or merge-back. If a Prisma synthetic-creator query is
needed in production wiring before then, that wiring is Switchboard-side and out
of this slice.

---

## 4. Composition flow

```
Step 1 — roster = await stores.rosterReader.listActiveCompatibleRoster({
             market: input.brief.market,
             treatmentClass: input.brief.treatmentClass,
           });

Step 2 — Empty-roster short-circuit. If roster.length === 0:
           return selectSyntheticCreator({
             brief: input.brief,
             now: input.now,
             roster: [],
             leases: [],
             performanceHistory: undefined,
           });
         (Skips lease + metrics reads. SP13 returns
          { allowed: false, reason: "no_compatible_candidates" } anyway.)

Step 3 — leases = await stores.leaseReader.findActiveLeasesForBriefScope({
             clinicId: input.brief.clinicId,
             market: input.brief.market,
             treatmentClass: input.brief.treatmentClass,
             now: input.now,
           });

Step 4 — metricsSince = input.now - SP21_PERFORMANCE_WINDOW_DAYS days
         performanceHistory = await stores.metricsReader.findMetricsForCreators({
             creatorIdentityIds: roster.map((r) => r.creatorIdentity.id),
             window: { since: metricsSince },
           });

Step 5 — return selectSyntheticCreator({
             brief: input.brief,
             now: input.now,
             roster,
             leases,
             performanceHistory,
           });
```

No I/O parallelism. Three small sequential reads dominated by network roundtrip,
not by composer logic. Simplicity beats `Promise.all` here.

### 4.1 Empty-roster behavior — locked

When roster is empty the composer **does not** call the lease reader and **does
not** call the metrics reader. The selector is invoked with `roster: []`,
`leases: []`, `performanceHistory: undefined` and returns the SP13
`no_compatible_candidates` rejection. This is the test-asserted behavior.

### 4.2 Cold-start (empty metrics) — selector handles

When the metrics reader returns an empty Map (PcdPerformanceSnapshot table
empty at SP21 land time), the composer passes that empty Map to the selector
unchanged. SP20 Guardrail G makes the selector's comparator a no-op when either
side has `sampleSize === 0`, so empty-history is SP13-equivalent at land. No
composer-side short-circuit on this path.

---

## 5. The 30-day performance window

Module-private constant in the composer file:

```ts
const SP21_PERFORMANCE_WINDOW_DAYS = 30;
```

Not pinned (pinned-constant count stays 24). Module-private literal — same
pattern as the selector's `LOCK_TYPE_RANK`. Single source of truth in the
composer file.

`metricsSince` is computed from `input.now`, **never** from `new Date()`. The
anti-pattern test enforces this with a regex sweep on the composer file.

```ts
// SP21 composer body — correct.
const metricsSince = new Date(input.now.getTime() - SP21_PERFORMANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
```

// MERGE-BACK: Switchboard may convert this to a config knob (per-tier window,
per-clinic override). Composer-internal at land time keeps the surface small.

---

## 6. Error handling

The composer throws raw on any reader failure. Rationale:

- SP10C precedent — orchestration-layer infra failures throw; the runner / app
  catches them and surfaces operator errors.
- SP13's rejection union (`no_compatible_candidates`, `all_blocked_by_license`)
  is **closed** post-SP20 carve-out. Reopening it for store errors is forbidden
  by CLAUDE.md.
- Clear separation: **selector returns business decisions; composer throws
  infrastructure failures.**

If a Switchboard caller needs to surface read failures as user-visible refusals,
that wrapping happens at the runner boundary (// MERGE-BACK), not in the SP21
composer body.

---

## 7. Test strategy

Mocked stores via `vi.fn()`. Matches SP4 / SP9 / SP10A / SP19 precedent. No real
Postgres at SP21 — composer wiring is store-shape-driven and DB-agnostic.

### 7.1 Unit test cases (`compose-synthetic-creator-selection.test.ts`)

1. **Happy path** — non-empty roster, non-empty leases, non-empty metrics; all
   three readers called once; selector receives the assembled input; decision
   passed through unchanged.
2. **Empty roster short-circuit** — roster reader returns `[]`; lease reader
   and metrics reader **not called**; selector invoked with empty roster and
   returns `no_compatible_candidates`.
3. **Empty leases** — roster non-empty, leases empty; metrics reader still
   called; selector returns `all_blocked_by_license`.
4. **Empty metrics (cold-start)** — roster non-empty, leases non-empty, metrics
   returns empty Map; selector invoked with empty `performanceHistory` Map;
   decision identical to SP13 modulo `metricsSnapshotVersion = null` /
   `performanceOverlayApplied = true` (SP20 Guardrail C-2 read-through).
5. **30-day window math** — metrics reader called with
   `window.since === input.now - 30 days` exactly. Use a fixed `input.now` for
   determinism.
6. **`creatorIdentityIds` passed to metrics reader** match the roster.
7. **Roster reader throws** — composer rethrows; lease / metrics not called.
8. **Lease reader throws** — composer rethrows; metrics not called.
9. **Metrics reader throws** — composer rethrows; selector not called.

### 7.2 Sp11SeedSyntheticCreatorRosterReader unit test

- Returns SP11 entries whose `synthetic.status === "active"` AND whose
  `synthetic.market === input.market` AND
  `synthetic.treatmentClass === input.treatmentClass`.
- All other compatibility dimensions (vibe, ethnicityFamily, ageBand,
  pricePositioning) are deliberately **NOT** filtered here — the SP13 selector
  applies the full SP13 `isCompatible` predicate. The roster reader narrows on
  market/treatmentClass only because those are the SP11 schema-level fields the
  Prisma successor will index on at SP21.1.

### 7.3 PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope test

- Returns leases where `clinicId === input.clinicId`, `market`,
  `treatmentClass` match, and `now` falls inside `[effectiveFrom, effectiveTo)`.
- Excludes revoked leases.
- Existing reader test file extended; no new file.

### 7.4 Anti-pattern test (`sp21-anti-patterns.test.ts`)

Keyed against SP20 squash SHA `06ba0ac`. Assertions:

1. Composer file imports do **not** include `@creativeagent/db`.
2. Composer body does **not** contain `new Date(` (the anti-pattern test reads
   the composer source as text and regex-checks).
3. Composer file does **not** reference: `PcdIdentitySnapshot`, `routePcdShot`,
   `qcEvaluator`, `consentPreCheck`, `syntheticRouter`, `Inngest`, `process.env`.
4. Composer file does **not** import from `../provider-router*`,
   `../synthetic-router/*`, `../qc-*`, `../consent-*`,
   `../pcd-identity-snapshot-*`, `../performance-snapshot/*`.
5. Composer file size under **250 lines** (selector is ~230; composer should be
   smaller).
6. No new pinned constant introduced — the PCD constant tally test confirms
   count remains **24**.

### 7.5 Allowlist sweep across prior anti-pattern tests

Plan task discovers the live set:

```bash
find packages -name "sp*-anti-patterns.test.ts"
```

Each is run; any failures triggered by the SP21 composer file or the new
`Sp11SeedSyntheticCreatorRosterReader` are resolved by **narrow** allowlist
additions in only the failing tests. Do not pre-emptively widen.

---

## 8. Files SP21 will add / touch

**New files:**

- `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts`
- `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts`
- `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts`
- `packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts`

**Modified files:**

- `packages/db/src/stores/prisma-creator-identity-license-reader.ts`
  (add `findActiveByClinicAndScope(...)`)
- `packages/db/src/stores/prisma-creator-identity-license-reader.test.ts`
  (cover the new method)
- Any prior `sp*-anti-patterns.test.ts` whose allowlist needs narrow extension
  (discovered, not pre-listed).

**Untouched (hard guarantee):**

- All SP13/SP20 selector source. The composer is a strict superset of SP20's
  caller surface; the selector itself is byte-identical.
- `packages/schemas/*`. No schema change. No new constant.
- Prisma schema and `migrations/`. No migration in SP21.

---

## 9. // MERGE-BACK markers reserved

Inline `// MERGE-BACK:` comments in the SP21 source for Switchboard wiring:

1. Replace `Sp11SeedSyntheticCreatorRosterReader` with a real
   `PrismaCreatorIdentitySyntheticReader.findActive(...)` at SP21.1.
2. Inngest step wrapping at the call site (Switchboard runner owns).
3. WorkTrace emission at composer entry / exit (forensic record-keeping).
4. Operator-facing dashboards for composer-level selection metrics.
5. `SP21_PERFORMANCE_WINDOW_DAYS` becomes a Switchboard-side config knob
   (per-tier or per-clinic).

---

## 10. SP21 plan shape preview (writing-plans skill input)

~14 TDD-paced tasks, in order:

1. SP21 anti-pattern freeze baseline (red test first — no composer files exist
   yet; test currently empty).
2. Add `findActiveByClinicAndScope` to `PrismaCreatorIdentityLicenseReader`
   (red test on existing test file → green).
3. Define the three port interfaces (compile-only).
4. `Sp11SeedSyntheticCreatorRosterReader` (red test → green).
5. Composer happy-path test (red).
6. Composer implementation (green).
7. Empty-roster short-circuit test (asserts lease + metrics readers not called).
8. Empty-leases test.
9. Empty-metrics (cold-start) test.
10. Reader-throw propagation tests (3 cases).
11. 30-day window math test (deterministic `input.now`).
12. SP21 anti-pattern assertions filled in (green).
13. Allowlist sweep across prior `sp*-anti-patterns.test.ts`.
14. Verification gate inside the worktree: `pnpm typecheck && pnpm test && pnpm lint && pnpm prettier --check $(git diff --name-only main...HEAD)`.

---

## 11. Lessons carried forward (from SP19 / SP20)

1. **Schema verification before SQL.** Task 2 (lease reader new method) must
   verify the actual Prisma model columns before writing the query. SP20's
   Task 1 caught a wrong join assumption; SP21 lease reader join path is
   straightforward but the verification step is still mandatory.
2. **Read-only review subagents.** Any reviewer agent dispatched in the SP21
   worktree must be told "READ-ONLY — Read / Grep / Glob only; Bash for
   non-mutating commands only; no Edit, no Write, no prettier --write."
3. **Worktree-side prettier.** Controller `prettier --check .` from the parent
   repo against worktree-only files silently returns clean. Run from inside the
   worktree OR use `git diff --name-only main...HEAD | xargs prettier --check`.
4. **Branch reconciliation.** After `gh pr merge --squash --delete-branch` from
   inside the worktree, the parent repo's local `main` may diverge from
   `origin/main` if any docs commits were authored on `main` pre-worktree. Use
   `git fetch origin && git reset --hard origin/main` to reconcile.
5. **Scope empty-state assertions precisely.** When testing cold-start
   equivalence, name the exact fields permitted to differ
   (`metricsSnapshotVersion`, `performanceOverlayApplied`) and the fields that
   must match (selection outcome, ranking).
