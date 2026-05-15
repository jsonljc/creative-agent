# PCD SP19 — PcdPerformanceSnapshot — Design Spec

**Date:** 2026-05-15
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (autonomous brainstorming per user's "no clarifying questions" instruction, single batched recommendation; 4 corrections applied after first-pass review)
**Predecessor slice:** SP18 (synthetic-routing provenance widen on `PcdIdentitySnapshot`, squash `817db22`; followup `544816a` strengthening SP4-invariant + step-ordering assertions and extending `frozenFiles` to 41)
**Successor slices reserved by name:**
- **SP20** — Selector-side performance-overlay re-rank (widens SP13 `metricsSnapshotVersion: z.null()` to `z.string().min(1).nullable()`; consumes the SP19 reader). NOT in SP19 scope.
- **Future** — Cost reconciliation analytics module (joins SP10A `costForecastReason` ⨯ SP19 `actualCostUsd` per `assetRecordId`); pins its own version literal if/when it ships. NOT in SP19 scope.
- **Future** — Billing-facade integration (Stripe/Anthropic invoice → `actualCostUsd` ingestion). Switchboard-side merge-back; SP19 marks the seam only.

---

## 1. Scope & Strategy

SP19 introduces a net-new `PcdPerformanceSnapshot` Prisma table to capture post-completion observability per `AssetRecord` attempt: terminal kind (success / failure / manual_skip), latency, actual cost, error category, attempt number, provider called, and a forensic capture timestamp. It ships a new pure store-injected stamper and a thin standalone writer. No orchestrator-level lock-step (contrast SP18's 4-way SP4 invariant), no widen of `PcdIdentitySnapshot`, no widen of `AssetRecord`, no widen of `ProductQcResult`, no SP10A `costForecastReason` mutation.

**Mental model (user-affirmed at design time):**

- **SP10A** = forecast per-asset cost at generation-decision time.
- **SP18** = stamp synthetic-routing decision at generation-decision time.
- **SP19** = capture actual performance at terminal-state time (success, failure, or manual skip).
- **SP20** = selector consumes SP19 history to re-rank candidates (widens SP13).

SP19 is the first PCD slice that writes AFTER generation has terminated. Every prior identity-snapshot widen (SP4, SP9, SP10A, SP18) stamps inside the same write transaction at generation-decision time; SP19 stamps minutes-to-hours later, after the provider call has resolved or the run has been manually skipped.

**Locked invariant (user-stipulated, §2.1 below):** SP19 persists for **all terminal states**: `success`, `failure`, and `manual_skip`. Failure and manual-skip rows are forensically load-bearing (operational truth about provider timeouts, manual-skip dispositions, retry history). Stamper input is the runner's terminal-state union; defense-in-depth Zod parse rejects any non-terminal kind.

**Key inflection (SP18 → SP19):** SP18 stamped the last generation-decision-time provenance field set. SP19 reaches the first **post-completion** persistence boundary. New write site, new lifecycle moment, new model — not a widen.

**Scope guardrail (user-approved, §2.1 below):** SP19 may NOT edit SP1–SP18 source bodies. It introduces a new Prisma model + new schemas file + new pipeline subdir. The SP4 writer, SP9 orchestrator, SP10A orchestrator, SP10B budget gate, SP10C budget enforcer, SP13 selector, SP14 disclosure resolver, SP15 script selector, SP16 router, SP17 router widening, and SP18 stamper + orchestrator are preserved verbatim. SP13's `metricsSnapshotVersion: z.null()` reservation is **not widened** in SP19 (SP20's job). Anti-pattern test enforces source-freeze keyed against the SP18 squash SHA `817db22` plus the SP18 followup SHA `544816a` (both currently shipped on `main`).

**What SP19 deliberately does NOT do:**

- **No widen of `PcdIdentitySnapshot`.** Net-new model. The identity snapshot is generation-decision-time provenance and stays frozen at its post-SP18 column shape.
- **No widen of `AssetRecord`.** `AssetRecord` is Switchboard-owned (per `CLAUDE.md`); SP19 may not add columns to it. The existing `AssetRecord.latencyMs`, `AssetRecord.costEstimate`, `AssetRecord.attemptNumber` fields are read-only inputs to the SP19 stamper at construction time but the stamper produces a new `PcdPerformanceSnapshot` row rather than mutating `AssetRecord`.
- **No widen of `ProductQcResult`.** SP5 owns the QC table. Earlier brainstorming considered reserving QC fields on `PcdPerformanceSnapshot` — **dropped**: `ProductQcResult` already carries `creatorIdentityId`, `pcdIdentitySnapshotId`, `gateVerdicts`, `qcEvaluationVersion`, `qcGateMatrixVersion`. Duplicating would create two QC homes and a future merge-conflict. Q4 user direction.
- **No mutation of SP10A `costForecastReason`.** Forecast and actual must remain forensically separate. Reconciliation = read-side join on `assetRecordId`. Q3 user direction.
- **No `crypto` import** anywhere in the SP19 surface. SP19 captures runtime-observed values, not derived hashes. (Contrast SP18's single `crypto.createHash` site for `promptHash`.) Anti-pattern test enforces.
- **No SP4 invariant lock-step.** The SP4 four-version invariant (`PCD_TIER_POLICY_VERSION` × `PCD_PROVIDER_CAPABILITY_VERSION` × `PCD_PROVIDER_ROUTER_VERSION` × `PCD_SHOT_SPEC_VERSION`) only applies at generation-decision time. SP19 stamps post-decision; there is nothing to lock-step against. Standalone writer, not an orchestrator. Q6 user direction.
- **No `providerResponseBytes` field.** Earlier brainstorming considered a per-response-bytes capture; **dropped** because cross-provider reliability of byte-count observation is unproven. If load-bearing later, ships in SP19.1 or a follow-up.
- **No `@@index` lines in v1.** `assetRecordId @unique` already creates a Postgres index for lookup. Explicit `@@index([terminalKind])` or `@@index([errorCategory])` would be speculative — no proven query pattern yet (SP20 selector hasn't shipped). Guardrail F + first-pass-review correction #1.
- **No indexes on `actualCostUsd`, `providerCalled`, `attemptNumber`.** Speculative without a consumer. Future analytics slices add indexes as needed.
- **No backfill of pre-SP19 `AssetRecord` rows.** Pre-SP19 assets have no companion `PcdPerformanceSnapshot`. The reader treats missing as "not captured" (returns `null` from `findByAssetRecordId`). Forensic record: those assets predate the performance-capture era. Guardrail G (SP4/SP9/SP10A/SP18 precedent inherited).
- **No FK CASCADE from `AssetRecord` → `PcdPerformanceSnapshot`.** `onDelete: Restrict`. Historical performance survives accidental asset deletion (asset-record deletion fails when a performance snapshot references it). User-approved trade-off; test cleanup must delete `PcdPerformanceSnapshot` before `AssetRecord`. Documented in §6 risk #4.
- **No reader-side aggregation, no rollup, no analytic query.** SP19 ships the row writer + per-asset reader. Aggregation slices (e.g., "success rate per provider over last 30 days") are SP20+ concerns.
- **No widen of SP13 `metricsSnapshotVersion`.** Stays `z.null()`. SP20 widens to `z.string().min(1).nullable()` when the selector consumes SP19 history.
- **No composer wiring** (SP21). The runner-side wiring that calls `writePcdPerformanceSnapshot` at terminal state is a `// MERGE-BACK:` marker — Switchboard-side runner integration.
- **No real provider API call.** No Kling, no Seedance, no DALL-E. Performance values flow in as a typed input from the runner; SP19 doesn't fetch.
- **No billing-facade integration.** `actualCostUsd` is supplied by the caller (the runner is responsible for invoice reconciliation upstream of SP19). Billing-facade ↔ runner reconciliation is a future Switchboard-side seam (Q9 marker).

---

## 2. Locked decisions

### 2.1 Scope guardrails (user-approved)

**Guardrail A — all-terminal-state persistence (user-stipulated explicit invariant):**

> SP19 persists `PcdPerformanceSnapshot` rows for ALL terminal states: `success`, `failure`, `manual_skip`. Failure-path rows carry `latencyMs` (time-to-failure), `errorCategory`, and `actualCostUsd: null` / `currency: null`. Manual-skip rows carry `latencyMs` (zero or the runner's pre-skip elapsed), `actualCostUsd: null`, `currency: null`, `errorCategory: null`. Enforced via the stamper's defense-in-depth Zod parse + the discriminated `terminalKind: "success" | "failure" | "manual_skip"` field. The runtime parse rejects unknown values.

**Guardrail B — no SP1–SP18 source-body edits:**

> SP19 may NOT edit SP1–SP18 source bodies. The existing SP4 writer (`pcd-identity-snapshot-writer.ts`), SP6 consent pre-checks, SP7/SP8 chain/gate, SP9 stamper + orchestrator, SP10A stamper + orchestrator, SP10B budget gate, SP10C budget enforcer, SP11 synthetic identity, SP12 license gate, SP13 selector (incl. `metricsSnapshotVersion: z.null()` reservation), SP14 disclosure resolver, SP15 script-template selector, SP16 router, SP17 router widening, and SP18 stamper + orchestrator are preserved verbatim. Anti-pattern test asserts via diff against the SP18 squash SHA `817db22` plus the SP18 followup SHA `544816a` (both on `main` at design time).

**Guardrail C — composer-only version pinning:**

> Two parts (mirrors SP9/SP10A/SP18 lock):
>
> 1. **Sole literal site.** Among non-test source files, the literal `"pcd-performance-snapshot@"` appears in exactly one file: `performance-snapshot-version.ts`. No stamper, store, writer, schema, or non-test fixture may inline the literal. Anti-pattern test #1 enforces.
> 2. **Sole runtime import site.** Among non-test runtime sources, the symbol `PCD_PERFORMANCE_SNAPSHOT_VERSION` is imported by exactly one file: `stamp-pcd-performance-snapshot.ts`. Tests are explicitly permitted to import the constant from `performance-snapshot-version.ts` for literal-pin assertions and forensic-payload assertions; this is not a violation.

**Guardrail D — no `crypto` in SP19:**

> The SP19 surface (subdir, schema file, store file, reader file, store contract, version constant, stamper, writer, tests) MUST NOT import `node:crypto` or any `crypto` symbol. SP19 captures runtime-observed values; it does not derive hashes. Anti-pattern test enforces. (SP18 had a single `crypto.createHash` site for `promptHash`; SP19 has none.)

**Guardrail E — no widen of `PcdIdentitySnapshot`, `AssetRecord`, or `ProductQcResult` (database columns):**

> Three Prisma models stay column-frozen at the database level. SP19 widens by ADDING a new `PcdPerformanceSnapshot` model. Clarification on `AssetRecord`: **no AssetRecord database-column widen. SP19 may add the required Prisma-only opposite-relation field `performanceSnapshot PcdPerformanceSnapshot?`; the migration SQL must not `ALTER TABLE AssetRecord`.** Prisma 5 mandates the back-reference for the 1:1 relation declared on `PcdPerformanceSnapshot.assetRecord`, so the line is unavoidable; it is tooling-only and emits no DDL. Anti-pattern test #5 verifies both halves: the existing column lists are intact, the opposite-relation line is the only AssetRecord-block change, and the SP19 migration SQL contains no `ALTER TABLE AssetRecord` statement.

**Guardrail F — no `@@index` lines in SP19 v1:**

> `assetRecordId @unique` already creates a Postgres index for the primary lookup pattern. Explicit `@@index([terminalKind])`, `@@index([errorCategory])`, `@@index([providerCalled])`, `@@index([actualCostUsd])`, etc., are all speculative without a proven consumer (SP20 selector has not shipped). Defer to a future slice when query patterns materialize. Match SP10A §0 risk #6 deferral posture. Write-throughput on the runner's terminal-state path matters; adding indexes for hypothetical analytic queries is premature.

**Guardrail G — no backfill of pre-SP19 `AssetRecord` rows:**

> Pre-SP19 `AssetRecord` rows have no companion `PcdPerformanceSnapshot`. The reader returns `null` for missing rows. Forensic record: those assets predate the performance-capture era. Match SP4/SP9/SP10A/SP18 precedent. Backfill is impossible (we would have to invent fake values).

**Guardrail H — `onDelete: Restrict` (not `Cascade`):**

> Historical performance survives accidental `AssetRecord` deletion. The trade-off is that test cleanup must delete `PcdPerformanceSnapshot` rows before their referenced `AssetRecord` rows; this is documented in §6 risk #1 and called out in the SP19 plan's migration task. Diverges from `PcdIdentitySnapshot`'s `onDelete: Cascade`, which was chosen because the identity snapshot is structurally part of the asset's identity at generation time — deleting the asset legitimately invalidates the snapshot. Performance is a separate forensic record that should outlive accidental asset deletion.

**Guardrail I — SP13 `metricsSnapshotVersion: z.null()` stays narrow:**

> SP19 is the data foundation, not the consumer. SP20 widens `metricsSnapshotVersion` to `z.string().min(1).nullable()` when the selector consumes SP19 history. Anti-pattern test #7 enforces.

**Guardrail J — schemas barrel widened upfront:**

> `packages/schemas/src/index.ts` re-exports `./pcd-performance-snapshot.js` in the first implementation task, not at the end. SP14 lesson, codified by SP15. Subsequent tasks import from `@creativeagent/schemas` without deep-path workarounds.

### 2.2 Decisions settled in this brainstorm

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Net-new `PcdPerformanceSnapshot` model.** 1:1 with `AssetRecord` on `assetRecordId @unique`. NOT a widen of `PcdIdentitySnapshot`. | Lifecycle moment differs from SP9/SP10A/SP18. Identity-snapshot widens stamp at generation-decision-time inside a single write transaction; SP19 stamps at terminal-state time, minutes-to-hours later. Widening the identity snapshot would force either a snapshot UPDATE (violates the implicit write-once forensic invariant) or a deferred-population pattern that contaminates the existing SP4+SP9+SP10A+SP18 4-way lock-step orchestrator. `AssetRecord` widen is forbidden (Switchboard-owned). Net-new model is the clean architectural break. |
| Q2 | **Per-attempt.** 1 `PcdPerformanceSnapshot` per `AssetRecord`. Since `AssetRecord` is per-attempt (`@@unique([specId, attemptNumber, provider])`), 1:1 with `AssetRecord` is structurally per-attempt. | Failed-attempt forensics are load-bearing ("attempt 1 → provider timeout; attempt 2 → success" must remain visible). Final-attempt-only would erase operational truth. Query layer can filter `WHERE assetRecord.attemptNumber = MAX(...)` for "final attempt" analytics. Storage cost is trivial. |
| Q3 | **Both flat + Json.** `actualCostUsd: Float?` flat column (analytics-friendly), `costActualReason: Json?` (provider/SKU breakdown, billing-line-id refs). NO mutation of SP10A's `costForecastReason`. | Forecast and actual must remain forensically separate. SP10A's no-flat-numeric posture (its §0 risk #6) was justified by lack of proven query patterns; SP19's load-bearing analytic IS the reconciliation, which justifies the flat column on the actual side. Reconciliation = read-side join via `assetRecordId`. |
| Q3a | **Single-currency lock: `currency: z.literal("USD").nullable()`.** Always `"USD"` on success; `null` on failure / manual_skip. | Match SP10A. Multi-currency requires provider-invoice ingestion (Switchboard-side billing facade) — out of PCD scope. |
| Q4 | **No QC reservation.** `ProductQcResult` is the canonical QC home (SP5, already widened with `pcdIdentitySnapshotId`, `gateVerdicts`, `qcEvaluationVersion`, `qcGateMatrixVersion`). SP19 does NOT duplicate. | Reservation-by-name was the original instinct but the canonical home already exists. Reserving on `PcdPerformanceSnapshot` would create two QC homes and a merge-conflict at SP20. SP20 widens `ProductQcResult` if needed. |
| Q5 | **All three terminal states.** Discriminated `terminalKind: "success" \| "failure" \| "manual_skip"`. Success carries `actualCostUsd`, `currency: "USD"`, `latencyMs`. Failure carries `errorCategory: "provider_timeout" \| "provider_error" \| "qc_rejection" \| "policy_denial" \| "internal_error"` + `latencyMs` (time-to-failure) + `actualCostUsd: null`. Manual-skip carries `latencyMs` (zero or pre-skip elapsed) + all cost / error fields null. | Forensically complete. Failure rows answer "why are we burning provider minutes?" Manual-skip rows are distinct from failure semantically (operator decision, not system fault) and warrant their own discriminator. |
| Q6 | **Standalone writer, no SP4 lock-step.** `stampPcdPerformanceSnapshot(input, stores) → PerformanceSnapshotPayload` (pure). `writePcdPerformanceSnapshot(input, stores)` (thin store-injected wrapper). No 5-way orchestrator. | SP4 invariant only applies at generation-decision time. SP19 is post-decision; lock-stepping against constants that were already pinned and persisted on `PcdIdentitySnapshot` would be ceremonial without adding forensic value. Standalone writer matches the actual semantics. |
| Q7 | **One new constant: `PCD_PERFORMANCE_SNAPSHOT_VERSION = "pcd-performance-snapshot@1.0.0"`.** 23rd pinned PCD constant. No separate cost-reconciliation version. | Cost reconciliation is a future analytic concern, not a separate forensic artifact in SP19. The performance-snapshot version covers cost-actual, latency, retry, terminal state, and error category as a single forensic record-shape unit. If/when a reconciler module ships joining SP10A ⨯ SP19, it pins its own version. |
| Q8 | **MERGE-BACK markers only.** Switchboard-side `CreativeJobPerformance` / `AssetTelemetry` concepts reconcile at merge. No Switchboard imports in SP19 code. | SP18 U7/U8 deferral pattern. PCD slice stays self-contained per `CLAUDE.md`. |
| Q9 | **One new external-system seam: billing-facade integration.** `actualCostUsd` / `costActualReason` are populated upstream by the runner's billing-facade reconciliation (Stripe / Anthropic / per-provider invoice). SP19 marks the seam with a `MERGE-BACK:` comment; no integration. | Largest new merge-back surface SP19 introduces. Latency, retry count, error category are internal runner observables — no new seam. Billing facade is the only seam. |

### 2.3 Naming locks (user-affirmed)

> Use the long-but-explicit naming. The slice name `performance-snapshot` mirrors `identity-snapshot` as a sibling forensic-record concept. The constant `PCD_PERFORMANCE_SNAPSHOT_VERSION` follows the `PCD_<SLICE>_VERSION` pattern from SP9 (`PCD_PROVENANCE_VERSION`), SP10A (`PCD_COST_FORECAST_VERSION`), SP18 (`PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION`).

| Surface | Name |
|---|---|
| Subdir | `packages/creative-pipeline/src/pcd/performance-snapshot/` |
| Pinned constant | `PCD_PERFORMANCE_SNAPSHOT_VERSION = "pcd-performance-snapshot@1.0.0"` (23rd pinned PCD constant) |
| Stamper | `stampPcdPerformanceSnapshot` |
| Writer | `writePcdPerformanceSnapshot` |
| Schema file | `packages/schemas/src/pcd-performance-snapshot.ts` |
| Prisma model | `PcdPerformanceSnapshot` |
| Store contract | `PcdSp19PerformanceSnapshotStore` with method `createForAssetRecord` |
| Reader contract | `PcdSp19PerformanceSnapshotReader` with method `findByAssetRecordId` |
| Prisma store adapter | `PrismaPcdPerformanceSnapshotStore` (implements `PcdSp19PerformanceSnapshotStore`) |
| Prisma reader adapter | `PrismaPcdPerformanceSnapshotReader` (implements `PcdSp19PerformanceSnapshotReader`) |
| Migration | `<ts>_pcd_performance_snapshot_sp19` |
| Anti-pattern test | `packages/creative-pipeline/src/pcd/performance-snapshot/sp19-anti-patterns.test.ts` |
| Worktree | `.worktrees/sp19` |
| Branch | `pcd/sp19-pcd-performance-snapshot` |

### 2.4 Judgment calls baked into this spec (open to push-back at the user review gate)

| # | Decision | Rationale |
|---|---|---|
| J1 | **`PCD_PERFORMANCE_SNAPSHOT_VERSION` is the 23rd pinned PCD constant.** SP19 introduces exactly one new constant. | Mirrors SP9 / SP10A / SP18 — each slice pins its own forensic-record-shape version. |
| J2 | **Discriminated union via `z.union`, not `z.discriminatedUnion`.** | Same Zod 3.x carve-out as SP13/SP14/SP15/SP16/SP17/SP18: `z.discriminatedUnion` doesn't see literal discriminators on `.readonly()`-wrapped branches. `z.union` parses by trying members in order; semantically equivalent for the 3-branch shape. |
| J3 | **Stamper input is typed as the runner's terminal-state union AND defense-in-depth runtime Zod parse + refine.** Belt-and-suspenders. | TS narrowing fires at compile time inside the package; runtime parse defends against external callers who might pass a runtime-shaped value through `unknown` (e.g., from a test fixture, ad-hoc backfill, or merge-back integration that loses the TS type). Throws `ZodError` on mismatch. |
| J4 | **Stamper accepts a clock injection `clock?: () => Date`** (matches SP9/SP10A/SP18 convention). `capturedAt = (stores.clock?.() ?? new Date()).toISOString()` on the forensic Json; the Prisma column `capturedAt` is `@default(now())` at row insert but the stamper-stamped value is the authoritative one (passed explicitly to the store). | Test-friendliness. Production callers omit `clock`; tests pass a fixed-instant clock for determinism. |
| J5 | **Stamper does NOT re-validate `latencyMs ≥ 0`, `actualCostUsd ≥ 0`, or `attemptNumber ≥ 1` beyond what the input Zod schema enforces.** | Defense-in-depth Zod parse on the whole input via `PcdPerformanceSnapshotInputSchema` already covers all field-level constraints. No double-validation. |
| J6 | **`providerCalled` is denormalized from `AssetRecord.provider`** (Prisma column on the new table). Stamper accepts it as a typed input string and copies it verbatim. | Denormalization is forensic: the row records what the runner actually called, even if the asset record's provider field is later mutated or the asset record is deleted. Query-time joins to `AssetRecord` would lose this if SP19 had to look it up. Anti-pattern test asserts the stamper does not query `AssetRecord` (purity). |
| J7 | **`attemptNumber` is also denormalized** from `AssetRecord.attemptNumber`. Stamper accepts it as a typed input integer and copies it verbatim. | Same forensic argument as J6. The runner already knows attemptNumber at terminal-state time. |
| J8 | **Manual-skip rows carry `latencyMs: 0` if no pre-skip elapsed time is meaningful, OR the runner's pre-skip elapsed time if any.** Stamper accepts whatever the runner passes; no special-casing. | Avoids inventing semantics. Runner integration at merge-back decides. SP19 v1 documents the convention but does not enforce it. |
| J9 | **No flat `errorMessage` column.** Error detail lives inside `costActualReason` Json if relevant (or could be moved to a future `errorReason: Json?` if pressure emerges). | Error messages are unbounded strings; storing flat invites schema drift. Forensic Json carries the structured fields the runner can produce. |
| J10 | **No `runnerVersion` column.** | The runner is a Switchboard-owned concept; SP19 doesn't pin it. If runner-version is forensically load-bearing later, it ships inside `costActualReason` Json or as a future flat column. |
| J11 | **Allowlist maintenance touches 10 prior anti-pattern test files.** SP9, SP10A, SP10B, SP10C, SP13, SP14, SP15, SP16, SP17, SP18. | Continuation of the SP10A→SP16→SP17→SP18 precedent. SP18 is the most recent shipped slice with a freeze allowlist that needs widening for SP19's net-new files. |
| J12 | **Anti-pattern test source-freeze diff is keyed against SP18 squash SHA `817db22` AND SP18 followup SHA `544816a`.** Both shipped on `main` at design time. | Source-freeze covers the SP18 squash plus the SP18 post-merge followup (which strengthened the 4-way invariant assertion + step-ordering test + frozen-files list). Two-SHA freeze is unusual; SP18's followup landed as PR #19 to strengthen tests without touching SP18 source, so the SP1–SP18 source bodies are byte-identical at both SHAs. Anti-pattern test asserts diff against `544816a` (the later of the two) but documents both for forensic clarity. |
| J13 | **Stub stores (in-memory) on the test side.** No new Prisma test fixtures beyond a roundtrip test of `PrismaPcdPerformanceSnapshotStore.createForAssetRecord` + `PrismaPcdPerformanceSnapshotReader.findByAssetRecordId` against a mocked Prisma client. | Match SP18's test surface. Behavioral assertions live at the stamper + writer level (pure-function tests). |
| J14 | **Reader returns `null` for missing rows** (not throw). | Pre-SP19 `AssetRecord` rows legitimately have no companion. `findByAssetRecordId` returns `PcdPerformanceSnapshotPayload \| null`. SP20 consumer treats `null` as "no historical performance data." |
| J15 | **No SP6 consent-revocation interaction.** SP19 is post-completion; consent state at SP19 capture time is irrelevant to performance forensics (the asset was already generated). | Consent revocation propagates via SP6 to `AssetRecord.consentRevokedAfterGeneration`. SP19 does not duplicate. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  pcd-performance-snapshot.ts                                   [new — SP19 forensic schemas]
  __tests__/pcd-performance-snapshot.test.ts                    [new — schemas package convention]
  index.ts                                                      [edit — re-export pcd-performance-snapshot]

packages/db/prisma/
  schema.prisma                                                 [edit — ADD new model PcdPerformanceSnapshot]
  migrations/<ts>_pcd_performance_snapshot_sp19/
    migration.sql                                               [new — additive, new table, no FK CASCADE, no index]

packages/db/src/stores/
  prisma-pcd-performance-snapshot-store.ts                      [new — write adapter]
  prisma-pcd-performance-snapshot-reader.ts                     [new — read adapter]
  __tests__/prisma-pcd-performance-snapshot-store.test.ts       [new — Prisma roundtrip via mocked client]
  __tests__/prisma-pcd-performance-snapshot-reader.test.ts      [new]

packages/creative-pipeline/src/pcd/performance-snapshot/        [NEW SUBDIR]
  performance-snapshot-version.ts                               [23rd pinned constant]
  pcd-sp19-performance-snapshot-store.ts                        [SP19 store + reader contracts]
  stamp-pcd-performance-snapshot.ts                             [pure stamper — sole version-import site]
  write-pcd-performance-snapshot.ts                             [thin store-injected writer]
  index.ts                                                      [public-surface barrel]
  performance-snapshot-version.test.ts                          [literal pin]
  stamp-pcd-performance-snapshot.test.ts                        [stamper unit tests]
  write-pcd-performance-snapshot.test.ts                        [writer unit tests]
  sp19-anti-patterns.test.ts                                    [~10 structural + behavioral assertions]

— allowlist maintenance —
packages/creative-pipeline/src/pcd/{provenance,cost,cost-budget,budget,selector,disclosure,script,synthetic-router,synthetic-routing-provenance}/sp{9,10a,10b,10c,13,14,15,16,17,18}-anti-patterns.test.ts
                                                                [edit — extend allowlists with SP19 net-new files]

packages/creative-pipeline/src/index.ts                         [edit — re-export ./pcd/performance-snapshot/index.js]
```

Pinned-PCD-constant count goes **22 → 23** after SP19 land (J1). The SP4 Zod `PcdIdentitySnapshotSchema` is **NOT** edited. The three frozen Prisma models (`PcdIdentitySnapshot`, `AssetRecord`, `ProductQcResult`) are **NOT** edited.

### 3.2 New Zod schemas — `pcd-performance-snapshot.ts`

```ts
// PCD slice SP19 — PcdPerformanceSnapshot forensic record. Captures post-
// completion observability per AssetRecord attempt: terminal kind, latency,
// actual cost, error category, attempt context, and forensic version + capture
// timestamp.
//
// MERGE-BACK: net-new SP19 schema. No reconciliation needed at Switchboard
// merge for the schema itself (net-new on both sides). Switchboard may have
// a parallel CreativeJobPerformance or AssetTelemetry concept; reconcile then.
//
// MERGE-BACK: actualCostUsd / costActualReason populated upstream by the
// runner's billing-facade reconciliation (Stripe / Anthropic / per-provider
// invoice). SP19 marks the seam; integration is Switchboard-side.
//
// NB: z.union (not z.discriminatedUnion) — same Zod 3.x readonly carve-out as
// SP13/SP14/SP15/SP16/SP17/SP18. z.union parses by trying members in order;
// semantically equivalent for the 3-branch shape.

import { z } from "zod";

export const PcdPerformanceErrorCategorySchema = z.enum([
  "provider_timeout",
  "provider_error",
  "qc_rejection",
  "policy_denial",
  "internal_error",
]);
export type PcdPerformanceErrorCategory = z.infer<typeof PcdPerformanceErrorCategorySchema>;

const CostActualReasonInnerSchema = z
  .object({
    providerCalled: z.string().min(1).max(64),
    providerSku: z.string().min(1).max(128).nullable(),
    billingLineId: z.string().min(1).max(256).nullable(),
    note: z.string().max(500).nullable(),
  })
  .readonly();

// Forensic JSON shape — denormalized into a Json column on the Prisma model.
// Mirrors the SP9 lineageDecisionReason / SP10A costForecastReason / SP18
// syntheticRoutingDecisionReason convention: version + decidedAt + body.
export const PcdPerformanceSnapshotReasonSchema = z
  .object({
    performanceSnapshotVersion: z.string().min(1),
    capturedAt: z.string().datetime(),
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();
export type PcdPerformanceSnapshotReason = z.infer<typeof PcdPerformanceSnapshotReasonSchema>;

// Stamper INPUT — the runner's terminal-state union, with all flat fields
// the stamper needs. The stamper produces the payload below.
const SuccessInputSchema = z
  .object({
    terminalKind: z.literal("success"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.number().min(0),
    currency: z.literal("USD"),
    costActualReason: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();

const FailureInputSchema = z
  .object({
    terminalKind: z.literal("failure"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.null(),
    currency: z.null(),
    errorCategory: PcdPerformanceErrorCategorySchema,
    costActualReason: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();

const ManualSkipInputSchema = z
  .object({
    terminalKind: z.literal("manual_skip"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.null(),
    currency: z.null(),
    costActualReason: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();

export const PcdPerformanceSnapshotInputSchema = z.union([
  SuccessInputSchema,
  FailureInputSchema,
  ManualSkipInputSchema,
]);
export type PcdPerformanceSnapshotInput = z.infer<typeof PcdPerformanceSnapshotInputSchema>;

// Stamper OUTPUT — what the store persists. Same shape as the Prisma row,
// minus auto-generated id + createdAt.
export const PcdPerformanceSnapshotPayloadSchema = z
  .object({
    assetRecordId: z.string().min(1),
    terminalKind: z.enum(["success", "failure", "manual_skip"]),
    errorCategory: PcdPerformanceErrorCategorySchema.nullable(),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.number().min(0).nullable(),
    currency: z.literal("USD").nullable(),
    costActualReason: PcdPerformanceSnapshotReasonSchema,
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    performanceSnapshotVersion: z.string().min(1),
    capturedAt: z.date(),
  })
  .readonly();
export type PcdPerformanceSnapshotPayload = z.infer<typeof PcdPerformanceSnapshotPayloadSchema>;
```

### 3.3 Prisma model + migration

**Schema additions to `packages/db/prisma/schema.prisma`:**

```prisma
model PcdPerformanceSnapshot {
  id                          String      @id @default(cuid())
  assetRecordId               String      @unique
  assetRecord                 AssetRecord @relation(fields: [assetRecordId], references: [id], onDelete: Restrict)

  terminalKind                String      // "success" | "failure" | "manual_skip"
  errorCategory               String?     // null on success / manual_skip; one of 5 enum values on failure

  latencyMs                   Int         // always populated; failure latency = time-to-failure

  actualCostUsd               Float?      // null on failure / manual_skip
  currency                    String?     // "USD" on success; null on failure / manual_skip
  costActualReason            Json        // forensic record-shape; always populated (carries version + capturedAt + costActual)

  attemptNumber               Int         // denormalized from AssetRecord.attemptNumber
  providerCalled              String      // denormalized from AssetRecord.provider

  performanceSnapshotVersion  String      // forensic version literal (currently "pcd-performance-snapshot@1.0.0")
  capturedAt                  DateTime    // authoritative stamp time (from stamper); distinct from createdAt

  createdAt                   DateTime    @default(now())
}
```

Notes:
- `assetRecordId @unique` provides the only index in v1. Guardrail F lock.
- `onDelete: Restrict` (not `Cascade`). Historical performance survives accidental asset-record deletion.
- `costActualReason: Json` (non-nullable). The forensic record-shape always carries `performanceSnapshotVersion` + `capturedAt`; the inner `costActual` body is nullable.
- `currency: String?` (not Postgres enum). Match SP10A's string column for the same field.
- No `gateVerdicts` / no QC fields. Q4 lock.
- No `briefId` / `scriptId` denormalization. SP9 lineage already lives on `PcdIdentitySnapshot`; SP19 queries reach lineage via `assetRecord → identitySnapshot → briefId/scriptId`.

**Migration SQL (additive, hand-authored per `CLAUDE.md` convention since no local `DATABASE_URL`):**

```sql
-- SP19: PcdPerformanceSnapshot — post-completion observability per AssetRecord attempt.
-- Net-new table. Additive. No FK CASCADE (Restrict). No indexes beyond the unique-FK index.

CREATE TABLE "PcdPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "assetRecordId" TEXT NOT NULL,
    "terminalKind" TEXT NOT NULL,
    "errorCategory" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "actualCostUsd" DOUBLE PRECISION,
    "currency" TEXT,
    "costActualReason" JSONB NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerCalled" TEXT NOT NULL,
    "performanceSnapshotVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcdPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PcdPerformanceSnapshot_assetRecordId_key" ON "PcdPerformanceSnapshot"("assetRecordId");

ALTER TABLE "PcdPerformanceSnapshot"
    ADD CONSTRAINT "PcdPerformanceSnapshot_assetRecordId_fkey"
    FOREIGN KEY ("assetRecordId") REFERENCES "AssetRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 3.4 Store + reader contracts

**`pcd-sp19-performance-snapshot-store.ts`:**

```ts
import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";

export interface PcdSp19PerformanceSnapshotStore {
  createForAssetRecord(input: PcdPerformanceSnapshotPayload): Promise<void>;
}

export interface PcdSp19PerformanceSnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<PcdPerformanceSnapshotPayload | null>;
}
```

The Prisma adapters (`PrismaPcdPerformanceSnapshotStore`, `PrismaPcdPerformanceSnapshotReader`) live in `packages/db/src/stores/` and implement these. A type-level bridge `PcdSp19PerformanceSnapshotStore = adaptPcdSp19PerformanceSnapshotStore(prismaStore)` is **deferred to merge-back** (matches SP18's U8 deferral — the db-layer rule forbids local type assertions; full bridging is at integration scope).

### 3.5 Stamper

**`stamp-pcd-performance-snapshot.ts`** (sole `PCD_PERFORMANCE_SNAPSHOT_VERSION` import site):

```ts
import {
  PcdPerformanceSnapshotInputSchema,
  type PcdPerformanceSnapshotInput,
  type PcdPerformanceSnapshotPayload,
} from "@creativeagent/schemas";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

export interface StampPcdPerformanceSnapshotStores {
  clock?: () => Date;
}

export function stampPcdPerformanceSnapshot(
  input: PcdPerformanceSnapshotInput,
  stores: StampPcdPerformanceSnapshotStores = {},
): PcdPerformanceSnapshotPayload {
  // Defense-in-depth: re-parse the input even though TS narrowing fires upstream.
  const parsed = PcdPerformanceSnapshotInputSchema.parse(input);
  const now = stores.clock?.() ?? new Date();
  return {
    assetRecordId: parsed.assetRecordId,
    terminalKind: parsed.terminalKind,
    errorCategory: parsed.terminalKind === "failure" ? parsed.errorCategory : null,
    latencyMs: parsed.latencyMs,
    actualCostUsd: parsed.terminalKind === "success" ? parsed.actualCostUsd : null,
    currency: parsed.terminalKind === "success" ? "USD" : null,
    costActualReason: {
      performanceSnapshotVersion: PCD_PERFORMANCE_SNAPSHOT_VERSION,
      capturedAt: now.toISOString(),
      costActual: parsed.costActualReason,
    },
    attemptNumber: parsed.attemptNumber,
    providerCalled: parsed.providerCalled,
    performanceSnapshotVersion: PCD_PERFORMANCE_SNAPSHOT_VERSION,
    capturedAt: now,
  };
}
```

### 3.6 Writer

**`write-pcd-performance-snapshot.ts`** (thin store-injected writer):

```ts
import type { PcdPerformanceSnapshotInput } from "@creativeagent/schemas";
import type {
  PcdSp19PerformanceSnapshotStore,
} from "./pcd-sp19-performance-snapshot-store.js";
import {
  stampPcdPerformanceSnapshot,
  type StampPcdPerformanceSnapshotStores,
} from "./stamp-pcd-performance-snapshot.js";

export interface WritePcdPerformanceSnapshotStores extends StampPcdPerformanceSnapshotStores {
  performanceSnapshotStore: PcdSp19PerformanceSnapshotStore;
}

export async function writePcdPerformanceSnapshot(
  input: PcdPerformanceSnapshotInput,
  stores: WritePcdPerformanceSnapshotStores,
): Promise<void> {
  const payload = stampPcdPerformanceSnapshot(input, stores);
  await stores.performanceSnapshotStore.createForAssetRecord(payload);
}
```

No orchestration. No SP4-invariant lock-step. No SP9 stamper composition. Q6 lock.

---

## 4. Data flow & call sequence

**At terminal-state time (Switchboard runner):**

```
runner → assembles PcdPerformanceSnapshotInput from {AssetRecord, terminal-state observation}
       → calls writePcdPerformanceSnapshot(input, { performanceSnapshotStore, clock? })
                  → stampPcdPerformanceSnapshot(input, { clock? })
                       → PcdPerformanceSnapshotInputSchema.parse(input)       # defense-in-depth
                       → constructs PcdPerformanceSnapshotPayload
                       → returns payload
                  → store.createForAssetRecord(payload)
                       → Prisma INSERT into PcdPerformanceSnapshot
                       → throws if assetRecordId already has a snapshot (unique constraint)
                       → throws if assetRecordId does not exist in AssetRecord (FK)
```

**At SP20 read time (future selector consumer, not in SP19 scope):**

```
selector → reader.findByAssetRecordId(assetRecordId)
        → Prisma SELECT * FROM PcdPerformanceSnapshot WHERE assetRecordId = ?
        → returns PcdPerformanceSnapshotPayload | null
```

**Unique-constraint semantics:** A second `writePcdPerformanceSnapshot` call for the same `assetRecordId` throws. This is the intended behavior: each `AssetRecord` attempt is a single terminal state, persisted once. Retries produce new `AssetRecord` rows (with incremented `attemptNumber`), each with its own `PcdPerformanceSnapshot`.

---

## 5. Test plan

### 5.1 Schemas tests (`packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts`)

Approximately 12 tests:

1. `PcdPerformanceErrorCategorySchema` accepts the 5 enum values and rejects others.
2. `SuccessInputSchema` parses a well-formed success input.
3. `FailureInputSchema` parses a well-formed failure input.
4. `ManualSkipInputSchema` parses a well-formed manual-skip input.
5. `PcdPerformanceSnapshotInputSchema` discriminates success / failure / manual_skip correctly.
6. Success branch rejects `actualCostUsd: null` (must be a number).
7. Failure branch rejects `actualCostUsd` as a number (must be null).
8. Failure branch requires `errorCategory`; rejects missing.
9. Manual-skip branch rejects `errorCategory` (must be absent or null).
10. `PcdPerformanceSnapshotReasonSchema` parses a well-formed reason; `performanceSnapshotVersion` is required, non-empty.
11. `PcdPerformanceSnapshotPayloadSchema` round-trips through the stamper output shape.
12. All three input branches reject `latencyMs: -1` and `attemptNumber: 0`.

### 5.2 DB-package tests

`packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts` (~5 tests):
1. `createForAssetRecord` calls `prisma.pcdPerformanceSnapshot.create` with the mapped payload.
2. `costActualReason` writes as `Prisma.JsonNull` only when the input reason is structurally null (it never is — top-level reason is always present; inner `costActual` may be null but the outer reason carries version + capturedAt).
3. `actualCostUsd` writes through as `null` for failure / manual-skip inputs.
4. Throws on Prisma unique-constraint violation (assertion against an injected throwing mock).
5. Throws on Prisma FK violation (AssetRecord not found).

`packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts` (~3 tests):
1. `findByAssetRecordId` returns the mapped payload when the row exists.
2. `findByAssetRecordId` returns `null` when the row does not exist.
3. Reader does not throw for missing rows (no assertion-style error).

### 5.3 Pipeline tests

`performance-snapshot-version.test.ts` (1 test): literal pin asserts `PCD_PERFORMANCE_SNAPSHOT_VERSION === "pcd-performance-snapshot@1.0.0"`.

`stamp-pcd-performance-snapshot.test.ts` (~10 tests):
1. Success input produces a payload with `terminalKind: "success"`, populated `actualCostUsd`, `currency: "USD"`, `errorCategory: null`.
2. Failure input produces a payload with `terminalKind: "failure"`, `actualCostUsd: null`, `currency: null`, populated `errorCategory`.
3. Manual-skip input produces a payload with `terminalKind: "manual_skip"`, all cost / error fields null.
4. `performanceSnapshotVersion` is stamped from `PCD_PERFORMANCE_SNAPSHOT_VERSION` (asserts the literal at the payload level, not via re-import).
5. `capturedAt` uses the injected clock when provided.
6. `capturedAt` defaults to `new Date()` when no clock is injected.
7. `costActualReason.capturedAt` matches `payload.capturedAt.toISOString()`.
8. Defense-in-depth Zod parse rejects unknown `terminalKind`.
9. Defense-in-depth Zod parse rejects negative `latencyMs`.
10. Stamper is pure: same input + same clock → identical output (deep-equal).

`write-pcd-performance-snapshot.test.ts` (~5 tests):
1. Calls the stamper, then the store, in that order.
2. Passes the stamped payload to `store.createForAssetRecord` byte-equal.
3. Awaits the store call (no fire-and-forget).
4. Re-throws store errors (no swallowing).
5. Does not call the store if the stamper throws (defense-in-depth Zod failure).

### 5.4 Anti-pattern tests (`sp19-anti-patterns.test.ts`)

Approximately 10 structural assertions:

1. **Sole literal site:** the string `"pcd-performance-snapshot@"` appears in exactly one non-test source file: `performance-snapshot-version.ts`.
2. **Sole runtime import site:** the symbol `PCD_PERFORMANCE_SNAPSHOT_VERSION` is imported by exactly one non-test runtime source: `stamp-pcd-performance-snapshot.ts`.
3. **No `crypto` import** anywhere in the SP19 subdir, schemas file, or db-package SP19 files.
4. **No `@prisma/client` or `@creativeagent/db` import** in the SP19 subdir under `creative-pipeline` (purity envelope; matches SP18's purity rule for the stamper subdir).
5. **Three frozen Prisma models:** `PcdIdentitySnapshot`, `AssetRecord`, `ProductQcResult` field lists unchanged. Asserted via regex against `schema.prisma`.
6. **No widen of `pcd-identity.ts` schemas.** `PcdIdentitySnapshotSchema` field set is unchanged (matches SP9/SP10A/SP18 precedent).
7. **No widen of `pcd-synthetic-selector.ts`.** `metricsSnapshotVersion: z.null()` remains (SP20's job).
8. **SP1–SP18 source-body freeze:** `git diff 544816a -- <sp1-sp18 source-body file list>` is empty.
9. **Stamper purity:** `stamp-pcd-performance-snapshot.ts` does not call `Date.now()`, does not call `Math.random()`, does not import `@prisma/client`, does not import `inngest`, does not import `node:fs|http|https|crypto`.
10. **Writer composition:** `write-pcd-performance-snapshot.ts` imports `stampPcdPerformanceSnapshot` AND uses it as `stampPcdPerformanceSnapshot(input, stores)` (positive assertion against silent decomposition).

### 5.5 Allowlist maintenance

10 prior anti-pattern test files (`sp9`, `sp10a`, `sp10b`, `sp10c`, `sp13`, `sp14`, `sp15`, `sp16`, `sp17`, `sp18`) get their freeze allowlists extended to include the SP19 net-new files under `pcd/performance-snapshot/`, plus the schemas-package and db-package net-new files. Single chore commit at the end of the SP19 branch (SP10A → SP18 precedent).

---

## 6. Risks (numbered, user-acknowledged)

1. **Test cleanup delete-order.** `onDelete: Restrict` means `AssetRecord` deletion fails when a `PcdPerformanceSnapshot` references it. Test fixtures that delete `AssetRecord` rows directly must delete the snapshot first. Documented in plan; no code-level mitigation.
2. **Storage growth.** One row per `AssetRecord` attempt. At Switchboard scale this could be significant. No retention policy in v1; merge-back team owns lifecycle if needed.
3. **`actualCostUsd` precision.** `Float` (Postgres `DOUBLE PRECISION`) — match SP10A's `estimatedUsd` precision. Acceptable for analytic reconciliation; not suitable for legal billing claims. Documented in `costActualReason.billingLineId` semantics: the billing line is the source of truth, not `actualCostUsd`.
4. **Manual-skip semantics undocumented.** SP19 v1 accepts `manual_skip` but does not define when the runner emits it. Merge-back integration decides. Risk: runner could under-emit (treating skips as failures) or over-emit (counting auto-prune as manual). Documented for merge-back.
5. **No reader-side aggregation.** SP20 will need cross-asset queries ("success rate per provider over last N days"). SP19 ships only `findByAssetRecordId`. SP20 design adds the aggregator; SP19 risk is that the aggregator might want a flat-column shape that SP19's `costActualReason` Json doesn't support — defer to SP20.
6. **`providerCalled` denormalization drift.** If `AssetRecord.provider` is ever mutated (it's not supposed to be, but the constraint isn't enforced), the snapshot's `providerCalled` will diverge. J6 documents the forensic-fidelity argument: the snapshot is the source of truth for what was called at terminal-state time.
7. **No `errorMessage` field.** Failure rows carry `errorCategory` (5-enum) but no free-text error detail. J9 documents the trade-off; future widen ships error detail inside `costActualReason` or as a new `errorReason: Json?` column.
8. **Defense-in-depth Zod parse cost.** Every stamper call re-parses the input. For high-volume runners this is non-trivial. Match SP18 precedent (defense-in-depth always wins for forensic records).
9. **No SP4 invariant capture.** SP19 does not snapshot the four SP4 version constants at terminal-state time. The argument: those constants are already snapshotted on the companion `PcdIdentitySnapshot` row at generation-decision time; SP19 captures observation-time values only, not policy-time values. Risk: if a version replay needs the generation-time SP4 constants at SP19's `capturedAt` wall-clock, the reader must join `PcdPerformanceSnapshot` → `AssetRecord` → `PcdIdentitySnapshot`. Documented.
10. **FK Restrict surprises in dev workflows.** A developer who runs `prisma migrate reset` will succeed (the migration drops and recreates the table). A developer who manually deletes an `AssetRecord` row in a dev DB without first deleting the snapshot will hit an FK error. Documented in the SP19 plan task on migration.

---

## 7. MERGE-BACK markers

Five markers across the SP19 surface:

1. **Schema file header** — `MERGE-BACK: net-new SP19 schema. No reconciliation needed at Switchboard merge for the schema itself.`
2. **Schema file header** — `MERGE-BACK: actualCostUsd / costActualReason populated upstream by the runner's billing-facade reconciliation (Stripe / Anthropic / per-provider invoice). SP19 marks the seam; integration is Switchboard-side.`
3. **Store contract file** — `MERGE-BACK: type-level bridge PcdSp19PerformanceSnapshotStore = adaptPcdSp19PerformanceSnapshotStore(prismaStore) at apps/api or integration scope (db layer rule forbids local assertion). Matches SP18 U8 deferral.`
4. **Stamper file** — `MERGE-BACK: runner integration. The runner (Switchboard-side) calls writePcdPerformanceSnapshot at terminal-state time. SP19 does not own the call site.`
5. **Writer file** — `MERGE-BACK: future reconciliation module joins PcdPerformanceSnapshot ⨯ PcdIdentitySnapshot on assetRecordId to compute forecast-vs-actual cost variance. Reconciler pins its own version constant. SP19 ships the data foundation only.`

---

## 8. Out of scope (linked to future slices)

- **SP20** — selector-side performance-overlay re-rank. Consumer of SP19 reader. Widens SP13 `metricsSnapshotVersion: z.null()` to populate.
- **Future cost reconciliation module** — joins SP10A `costForecastReason` ⨯ SP19 `actualCostUsd` per `assetRecordId`. Pins its own version.
- **Future SP21+ composer** — runner integration that wires `writePcdPerformanceSnapshot` into the actual terminal-state code path.
- **Switchboard billing-facade integration** — provider-invoice ingestion. Marker only.
- **Aggregated query layer** — "success rate per provider," "p95 latency by shot type," etc. Pure SQL or analytic-store concern; not a PCD slice.
- **Retention / archival policy** — `PcdPerformanceSnapshot` rows accumulate indefinitely in SP19 v1. Lifecycle is merge-back's problem.

---

## Approval gate

The user reviews this written spec before SP19 implementation planning begins. If any decision in §2.2, judgment call in §2.4, module surface in §3, test plan in §5, or risk in §6 is wrong, push back. Otherwise reply "approved, proceed to writing-plans" and the next step is invoking the `superpowers:writing-plans` skill for the SP19 implementation plan.
