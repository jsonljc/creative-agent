# Switchboard Context for CreativeAgent

This repo will eventually merge back into Switchboard (`~/switchboard`, GitHub `jsonljc/switchboard`). Code written here must honor Switchboard's invariants, conventions, and integration surface so the merge-back is mechanical, not architectural.

**Source of truth for the parent system:** Switchboard `main` branch. SP1 was merged at commit `05bc4655` (PR #283).

## Switchboard at a glance

> Governed operating system for revenue actions. TypeScript monorepo (pnpm + Turborepo). Multi-channel chat orchestration, agent governance, workflow execution.

It is **not** a creative tool — PCD is one vertical inside a much larger platform that also handles sales pipelines, ad optimization, CRM, calendars, escalations, and marketplaces.

## Core invariants (Switchboard-wide — ours to honor)

These are quoted from Switchboard's `CLAUDE.md` and `docs/DOCTRINE.md`:

1. **Mutating actions enter through `PlatformIngress.submit()`.** PCD job creation is a mutating action. SP3 will eventually wire `PcdTierPolicy` into the ingress path; until then, our policy is a pure function with no side effects.
2. **`WorkTrace` is canonical persistence.** Anything we mutate in production must produce a WorkTrace entry. In this repo we don't have WorkTrace — when SP3+ adds anything that would write one, leave a `// MERGE-BACK: emit WorkTrace here` comment instead of inventing a local equivalent.
3. **Approval is lifecycle state, not a route-owned side effect.** SP6 will add Meta draft + consent revocation gates; these must integrate with Switchboard's `ApprovalLifecycle` model when merged back. Don't roll our own approval here.
4. **Tools are audited, idempotent product surfaces.** The backfill function we ported is already idempotent (event-triggered, find-or-create). Keep this property in any new code.
5. **Human escalation is first-class architecture.** If a tier policy decision could plausibly require human review (e.g. Tier-3 with no consent record), surface that as a return value from the policy function — don't auto-route, don't fail silently.
6. **No mutating bypass paths.** Every PCD generation path goes through the same gate. No "internal" or "system" actor exemption.

## Switchboard package layers (relevant slice)

```
schemas              ← @creativeagent/schemas merges into here
sdk, cartridge-sdk   ← not in scope for PCD
creative-pipeline    ← @creativeagent/creative-pipeline merges into here
ad-optimizer         ← not in scope
core                 ← we don't touch this; SP3+ may need to call into it
db                   ← @creativeagent/db merges into here
apps/api             ← Inngest functions register here; SP1 backfill already wired
apps/dashboard       ← UI work is a separate stream — not our concern
apps/chat            ← not in scope
apps/mcp-server      ← not in scope
```

When merging back, **package names rename** (`@creativeagent/X` → `@switchboard/X`) and files land in identical relative paths.

## Integration surface — what each SP needs from Switchboard

### SP2 (PcdTierPolicy)

**Standalone in this repo.** Pure function, no I/O. Inputs: avatar tier, product tier, shot type, output intent. Output: `PcdTierDecision`.

Nothing to stub — entire SP2 lives in `packages/creative-pipeline/src/pcd/tier-policy.ts` with matrix tests.

### SP3 (wire policy into job creation)

**Will need from Switchboard at merge:**

- `CreativeJobStore.create()` call site in `packages/creative-pipeline/src/runners/` (Switchboard's existing creative job runner)
- Resolver pattern that joins `AssetRecord.creator` (per design spec)

**Stub strategy here:** define a local `CreativeJobIngressContract` interface that captures only what the policy gate needs. SP3 implementation calls the contract; merge-back swaps in Switchboard's real ingress.

### SP4 (tier-based routing)

**Will need:**

- Switchboard's `ProviderRegistry` (`packages/core/src/providers/...`) — Sora, Veo, Runway, Kling, HeyGen profiles
- Capability descriptors

**Stub strategy:** local `ProviderProfile` type with the minimum fields the router reads. Mark any Switchboard-only fields as `// MERGE-BACK: replace with Switchboard ProviderProfile`.

- **CampaignTakeStore is an SP4-declared orchestration dependency; production implementation is reserved for SP6 ApprovalLifecycle/campaign-take ownership at merge-back.** The contract lives at `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts` with a `// MERGE-BACK:` comment marker for code search. No in-tree production implementer ships in SP4 — only test fakes. Production wiring at merge-back must inject the SP6 ApprovalLifecycle-backed store.
- **`PcdIdentitySnapshotStore.createForShot` (creative-pipeline) vs `PrismaPcdIdentitySnapshotStore.create` (db): method names diverge intentionally for semantic clarity.** Resolved in-tree: `adaptPcdIdentitySnapshotStore(prismaStore)` in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` returns a `PcdIdentitySnapshotStoreAdapter` whose `createForShot` shape structurally matches the writer's `PcdIdentitySnapshotStore` contract. Merge-back wiring is `writePcdIdentitySnapshot(input, { pcdIdentitySnapshotStore: adaptPcdIdentitySnapshotStore(prismaStore) })`.

### SP5 (QC gate)

**Will need from Switchboard at merge:**

- A real implementer of `SimilarityProvider` (face + logo embedding) — production model lives in Switchboard's QC service.
- A real implementer of `OcrProvider` — Switchboard QC's OCR pipeline.
- A real implementer of `GeometryProvider` — Switchboard QC's depth/object-detection pipeline.
- Optional: a `PrismaPcdQcResultStore` rename if Switchboard ever decides to rename `ProductQcResult → PcdQcResult` (deferred indefinitely; SP5 keeps SP1's name).

**Stub strategy here:** SP5 ships only the three provider contract surfaces (`SimilarityProvider`, `OcrProvider`, `GeometryProvider`) marked `// MERGE-BACK: replace with Switchboard QC provider`. Concrete production implementers are reserved for Switchboard's QC service ownership at merge-back. In-tree consumers (predicates, tests) inject test stubs that conform to these types.

**Merge-back notes:**

- `SimilarityProvider`, `OcrProvider`, `GeometryProvider` are SP5-declared orchestration dependencies; production implementations are reserved for Switchboard QC service ownership at merge-back.
- `ProductQcResult` table-name reconciliation (preserved verbatim from SP1; potential rename to `PcdQcResult`) is deferred to merge-back — SP5 widens additively without renaming.
- `PcdQcLedgerStore.createForAsset` vs Prisma-natural `create` method-name divergence: if any orchestration caller needs the contract method name strictly, ship `adaptPcdQcResultStore` per SP4's `adaptPcdIdentitySnapshotStore` precedent.

### SP6 (consent + Meta draft + revocation) — SHIPPED

**SP6-declared merge-back surfaces (production wiring at merge-back):**

- `ExportGateState` (default `AlwaysOpenExportGateState`) → adapter over Switchboard's `ExportLifecycle` (`packages/core/src/export-lifecycle/`).
- `ComplianceCheck` (default `AlwaysPassComplianceCheck`) → real FTC-disclosure / Meta-draft compliance pipeline (script claims path, testimonial flagging, voice-consent verification).
- `LegalOverrideRecord` table — deferred to Switchboard. SP6 final-export gate refuses revoked-consent re-export by default with a `// MERGE-BACK: legal-override path` marker. Override store and UX are Switchboard's.
- `WorkTrace` emit — every SP6 lifecycle decision-point carries `// MERGE-BACK: emit WorkTrace here` markers. Six markers total: three at lifecycle-gate returns, one at consent-revocation per-asset boundary, plus the legal-override and notification-fanout deferrals on consent revocation.
- Notification fan-out — `// MERGE-BACK: notification fan-out` marker at end of `propagateConsentRevocation`. Switchboard's three-channel notification system fires per affected campaign owner at merge-back.

**Schema reconciliation at merge-back:**

- `AssetRecord.consentRevokedAfterGeneration Boolean @default(false)` — new column added by SP6 migration. If Switchboard `main` has not added this column independently, the SP6 migration applies cleanly; if Switchboard added a same-semantic column with a different name, reconcile by renaming SP6's column in the migration before merge-back.
- `AssetRecord.approvalState String @default("pending")` — SP1-shipped. SP6 reads it; Switchboard's `ApprovalLifecycle` writes it at merge-back. SP6 returns proposed-state strings on its decision structs ("approved" | "rejected") for `ApprovalLifecycle` to consume.
- `ConsentRecord.revoked / revokedAt / revocable / expiresAt` — SP1-shipped. No widening needed.
- `PcdIdentitySnapshot.consentRecordId` — SP1-shipped. SP6's primary join key for revocation propagation.

**Architectural seams the merge-back does NOT need to rewrite:**

- The six SP6 decision/pre-check functions are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/` changes at merge-back — only the injected stores swap (Prisma adapters → Switchboard's audited equivalents) and the markers get implementations.
- `PcdLifecycleRefusalReason` enum is exported from `@creativeagent/schemas` — at merge-back it becomes `@switchboard/schemas` via the standard sed pass.
- `InvariantViolationError` was promoted to its own file with a widened `(reason, context?)` constructor while preserving the legacy `(jobId, fieldName)` overload for SP3/SP4 callers — no further refactor needed at merge-back.
- **Layer 2 mirror pattern:** the six reader interfaces and `ConsentRevocationStore` are defined in `packages/creative-pipeline/src/pcd/lifecycle-readers.ts` and `consent-revocation.ts` respectively, with **structural mirrors** in `packages/db/src/stores/` Prisma adapter files. This pattern was used because `db` (Layer 2) cannot depend on `creative-pipeline` (Layer 3). At merge-back, Switchboard may consolidate these mirrors by moving the interfaces into `@switchboard/schemas` (Layer 1, importable by both layers).

### SP7 (preproduction chain) — SHIPPED in creativeagent

**SP7-declared merge-back surfaces (production wiring at merge-back):**

- Four stub stage runners → real Switchboard Claude-driven runners. New file `creator-scripts-stage-runner.ts` at merge-back supersedes both Switchboard's existing `script-writer.ts` and the UGC pipeline's `ugc-script-writer.ts`. New file `motivators-stage-runner.ts` at merge-back is net-new (no current Switchboard equivalent at top level — funnel-friction-translator's role moves up).
- `AutoApproveOnlyScriptGate` → Switchboard Inngest `step.waitForEvent` adapter wrapping a new event pair: `creative-pipeline/preproduction.gate.requested` (emitted by the SP7 composer at the gate boundary) and `creative-pipeline/preproduction.gate.approved` (emitted by the dashboard UI). Operator selection payload populates `decidedBy` and `selectedScriptIds`.
- `WorkTrace` emit — every SP7 stage boundary carries a `// MERGE-BACK: emit WorkTrace here` marker. Five markers in `preproduction-chain.ts` (after each of four stages + at gate decision) plus one in `build-pcd-identity-context.ts` after the context is built, plus the `// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload` directive. Plus `// MERGE-BACK: wire UGC production handoff here` on the composer's return.
- Two new SP7 reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) — wider than SP6's narrow consent-only readers. Production wiring at merge-back is a Prisma adapter from `packages/db/`; SP7 ships interfaces only. Both readers consume existing SP1 ProductIdentity / CreatorIdentity columns; no schema changes required.

**Schema reconciliation at merge-back:**

- No Prisma migration. SP7 is pure orchestration. All schema additions are zod-only in `packages/schemas/src/pcd-preproduction.ts`.
- `ProductIdentity.brandPositioningText` — SP7 reads this field if it exists on the merge-back-time ProductIdentity schema; otherwise `null`. SP7 does not widen `ProductIdentity`. If Switchboard's main has not added the column by merge-back, the reader returns `null` for the field and the schema accepts the null.
- `CreatorIdentity.voiceId` — the current Prisma schema has `voice Json` not `voiceId String?`. SP7's `Sp7CreatorRegistryReader.findById()` returns `voiceId: string | null` as its contract. The Prisma adapter at merge-back is responsible for either (a) returning `null`, or (b) extracting a stable id from the `voice` JSON column if one exists. SP7 stub readers in tests return `null`.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP7 composer + builder + gate + four stage runners are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/preproduction/` changes at merge-back — only the injected stub runners + default gate swap (real Claude runners + Inngest waitForEvent adapter) and the markers get implementations.
- `PreproductionChainError` lives in this repo; merge-back keeps the class verbatim.
- `PCD_PREPRODUCTION_CHAIN_VERSION` and `PCD_IDENTITY_CONTEXT_VERSION` are SP7's two new pinned constants. The PCD slice carries ten total pinned constants after SP7.
- SP7 introduces NO circular dependency. Pre-production stages (Switchboard's `stages/`, `ugc/`) import from `pcd/preproduction/` at merge-back; the reverse direction does not exist. SP7 lives inside pcd/ rather than as a sibling synergy/ subdir per the design's Q11 lock.

**SP7 does not call SP3's `resolvePcdRegistryContext`.** The design doc describes SP7 as "wrapping" SP3, which is structural composition language — in implementation, SP7's `buildPcdIdentityContext` reads product/creator registry directly via two new SP7-specific reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) and duplicates SP3's pure `qualityTier → IdentityTier` mapping locally. SP3's source is not edited. SP3's resolver expects a `PcdResolvableJob` with `organizationId`/`deploymentId`/`productDescription`/`productImages` and persists via `jobStore.attachIdentityRefs`; SP7's pre-job `PcdBriefInput` doesn't fit that signature, and SP7 must not persist.

### SP8 (branching tree state + production-fanout hardening) — SHIPPED in creativeagent

**SP8 carry-over (`decisionNote` bound) at merge-back:**

`PcdProductionFanoutDecisionSchema.decisionNote` narrows from `z.string().nullable()` to `z.string().max(2000).nullable()` in SP9. Pre-SP9 stored `decisionNote` values that exceed 2000 chars (none anticipated — SP8's stub gate emits null) would fail re-parse. No backfill needed.

### SP9 (creative-source provenance) — SHIPPED in creativeagent

**SP9-declared merge-back surfaces (production wiring at merge-back):**

- `consentRecordReader` + `creatorIdentityReader` (from SP6 — stamper reuses the existing readers). No new contract.
- The merge-back-time production runner is responsible for calling `writePcdIdentitySnapshotWithProvenance` instead of the bare `writePcdIdentitySnapshot` when generating assets from a fanout-selected script. Both callsites remain valid; legacy callsites (e.g. tests, ad-hoc backfills) may continue to use the bare form and write null lineage.
- `WorkTrace` emit — every SP9 state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `stamp-pcd-provenance.ts` (after lineage walk, after consent re-check, at payload assembly) plus one in `write-pcd-identity-snapshot-with-provenance.ts` at orchestrator pre-persist. Plus `// MERGE-BACK: pick fanoutDecisionId convention` (Inngest event id vs synth hash) at the orchestrator declaration.
- `fanoutDecisionId` convention is caller-supplied. SP9 requires only that the value be stable per gate decision and unique across decisions. Two acceptable conventions documented in the design doc: Inngest event id (preferred at merge-back) or `sha256(briefId + decidedAt + sorted(selectedScriptIds))`.
- `adaptPcdSp9IdentitySnapshotStore(prismaStore)` ships in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` and returns the SP9 contract shape. Wire as `writePcdIdentitySnapshotWithProvenance(input, { pcdSp9IdentitySnapshotStore: adaptPcdSp9IdentitySnapshotStore(prismaStore), … })` at merge-back.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.briefId/trendId/motivatorId/hookId/scriptId/lineageDecisionReason` — six new columns added by SP9 migration `20260430120000_pcd_identity_snapshot_sp9_provenance`. If Switchboard `main` has not added equivalents independently, the SP9 migration applies cleanly. If Switchboard added same-semantic columns with different names, reconcile by renaming SP9's columns in the migration before merge-back.
- No FK constraints on the lineage columns. The referenced ids are not Prisma-modeled in this repo or in SP1–SP8 — they're zod-only schema ids in the chain output. Merge-back may add FKs once Switchboard models the chain output as DB rows; SP9 leaves them as plain `TEXT?` with two indexes (`briefId`, `scriptId`) for query performance.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP9 stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/provenance/` changes at merge-back — only the injected readers swap (Prisma-backed via `adaptPcdSp9IdentitySnapshotStore` from `@creativeagent/db`) and the markers get implementations.
- `PCD_PROVENANCE_VERSION` is the 12th pinned constant. The PCD slice carries 12 total pinned constants after SP9.
- SP9 introduces NO circular dependency. `pcd/provenance/` imports from `pcd/preproduction/` (chain output types, chain-version constant) and from `pcd/` top-level (SP4 writer types, SP6 pre-check). Reverse direction does not exist; `sp9-anti-patterns.test.ts` enforces the source-freeze.
- The SP4 writer body (`writePcdIdentitySnapshot`) is untouched. SP9 added a parallel orchestrator (`writePcdIdentitySnapshotWithProvenance`) that duplicates SP4's invariant-assert + Zod-parse + version-pin logic and calls the new SP9 store method. Anti-pattern test enforces SP4/SP9 invariant logic stays in lock-step (both files import the same four version constants and call `assertTier3RoutingDecisionCompliant` with the same six-argument shape).

### SP10A (cost-forecast wiring) — SHIPPED in creativeagent

**SP10A-declared merge-back surfaces (production wiring at merge-back):**

- `CostEstimator` injection — Switchboard ad-optimizer team owns the production `CostEstimator` implementer. Real estimator reads FX rates, volume tiers, contract pricing. SP10A ships only the contract + a deterministic `StubCostEstimator`. `// MERGE-BACK: replace with Switchboard cost estimator` marker on the stub class declaration.
- `adaptPcdSp10IdentitySnapshotStore(prismaStore)` ships in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` and returns the SP10A contract shape. Wire as:
  ```ts
  writePcdIdentitySnapshotWithCostForecast(input, {
    pcdSp10IdentitySnapshotStore: adaptPcdSp10IdentitySnapshotStore(prismaStore),
    costEstimator: switchboardCostEstimator,
    creatorIdentityReader,
    consentRecordReader,
    clock,
  });
  ```
- `WorkTrace` emit — every SP10A state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Two markers in `stamp-pcd-cost-forecast.ts` (after estimator return, after assembly), one in `write-pcd-identity-snapshot-with-cost-forecast.ts` (orchestrator pre-persist).
- Production runner discipline — at merge-back, all production callsites should call `writePcdIdentitySnapshotWithCostForecast` to get cost observability. Legacy SP4 `writePcdIdentitySnapshot` and SP9 `writePcdIdentitySnapshotWithProvenance` callsites remain valid for tests + ad-hoc backfills but write `costForecastReason = null`.
- `fanoutDecisionId` convention — still caller-supplied, inherited from SP9. Same `// MERGE-BACK: pick fanoutDecisionId convention` marker. SP10A does not lock this.
- Gate-time `PcdProductionFanoutDecision.costForecast` stays `null` in SP10A. Slot remains reserved for a future slice with a coarse pre-routing estimator variant.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.costForecastReason` — one new column added by SP10A migration `20260430130000_pcd_identity_snapshot_sp10a_cost_forecast`. If Switchboard `main` has not added an equivalent independently, the SP10A migration applies cleanly. If Switchboard added a same-semantic column with a different name, reconcile by renaming SP10A's column in the migration before merge-back.
- No FK constraints. The cost record is a self-contained Json struct.
- No flat numeric column on `PcdIdentitySnapshot`. Merge-back analytics may add `estimatedUsdCents Int?` + `(scriptId, estimatedUsdCents)` index; deferred per design §0 risk #9.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10A stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/cost/` changes at merge-back — only the injected estimator + readers swap (Prisma-backed via `adaptPcdSp10IdentitySnapshotStore`, real cost estimator via Switchboard ad-optimizer) and the `// MERGE-BACK:` markers get implementations.
- `PCD_COST_FORECAST_VERSION` is the 13th pinned constant. The PCD slice carries 13 total pinned constants after SP10A.
- SP10A introduces NO circular dependency. `pcd/cost/` imports from `pcd/provenance/` (SP9 stamper) and from `pcd/` top-level (SP4 invariant + writer types). SP6 reader contracts (`creatorIdentityReader`, `consentRecordReader`) reach the orchestrator transitively via the SP9 stamper's store contract — never via a direct import. Reverse direction does not exist; `sp10a-anti-patterns.test.ts` enforces the source-freeze.
- The SP9 orchestrator body (`writePcdIdentitySnapshotWithProvenance`) is untouched. SP10A added a parallel orchestrator (`writePcdIdentitySnapshotWithCostForecast`) that COMPOSES SP9's pure stamper (`stampPcdProvenance`) and adds SP10A cost stamping. Anti-pattern test enforces SP4/SP9/SP10A invariant logic stays in 3-way lock-step.
- SP10A is observability-only. Tree-budget enforcement is reserved for SP10B (separate squash, separate version pin `PCD_TREE_BUDGET_VERSION`).

### SP10B (tree-budget enforcement) — SHIPPED in creativeagent

**SP10B-declared merge-back surfaces (production wiring at merge-back):**

- **`Sp10bBudgetReader` injection** — Switchboard owns the production budget reader. Real reader fetches per-organization defaults with brief-level override from a Switchboard-side `OrganizationBudget` table. SP10B ships only the contract + a deterministic stub (`StaticDefaultBudgetReader`). `// MERGE-BACK: replace with Switchboard org-budget reader` marker on stub class declaration.
- **`WorkTrace` emit** — every SP10B state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `run-identity-aware-preproduction-chain-with-budget.ts`: budget resolved (value or null), budget gate passed, budget gate violated. WorkTrace payload should include `budgetMeta` on success and `meta` + `violations` on failure (both shapes are stable per SP10B).
- **Production runner discipline** — at merge-back, all production callsites should call `runIdentityAwarePreproductionChainWithBudget` to get budget enforcement. Legacy SP7 `runIdentityAwarePreproductionChain` callsites remain valid for tests + ad-hoc uses but bypass the gate.
- **Dashboard UX for `TreeBudgetExceededError`** — operator-facing surface for retrying with a raised budget. SP10B emits the structured error context (`reason`, `budget`, `violations`, full `meta` with `perStageCounts` + `fanoutLevels`) sufficient for a dashboard form.
- **Outcome-wrapper consumption at merge-back** — production runners must destructure the SP10B return: `const { result, budgetMeta } = await runIdentityAwarePreproductionChainWithBudget(...)`. The `budgetMeta` field can populate analytics dashboards directly (per-stage counts, top fanout parents) without re-walking the tree. `budgetMeta === null` means "ran in gated-bypass mode" (org has no budget configured); analytics queries should filter on this to compute opt-in rate.
- **`OrganizationBudget` Prisma table** — Switchboard owns the schema. SP10B does not constrain shape; reader contract is the only PCD-vertical commitment.

**Schema reconciliation at merge-back:**

- `PreproductionTreeBudgetSchema.maxEstimatedUsd` — one new field added by SP10B as `z.number().positive().nullable()`. Always populated as `null` in SP10B; SP10C populates non-null values for cost-budget enforcement. If Switchboard `main` has not added an equivalent independently, the SP10B widen applies cleanly. If Switchboard added a same-semantic field with a different name, reconcile by renaming SP10B's field before merge-back.
- No Prisma columns added by SP10B. Zero migration reconciliation overhead.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10B orchestrator + validator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/budget/` changes at merge-back — only the injected reader swaps (real Switchboard reader replaces `StaticDefaultBudgetReader`) and the `// MERGE-BACK:` markers get implementations.
- `PCD_TREE_BUDGET_VERSION` is the 14th pinned constant. The PCD slice carries 14 total pinned constants after SP10B.
- SP10B introduces NO circular dependency. `pcd/budget/` imports from `pcd/preproduction/` (chain composer, types) and from `pcd/` top-level (`InvariantViolationError`). Reverse direction does not exist; `sp10b-anti-patterns.test.ts` enforces the source-freeze.
- The SP7 composer body (`runIdentityAwarePreproductionChain`) is untouched. SP10B added a parallel orchestrator (`runIdentityAwarePreproductionChainWithBudget`) that calls SP7's chain as a pure function and adds budget gating around the call. Anti-pattern test #9 enforces SP1-SP10A source-body freeze (allowlist includes `sp9-anti-patterns.test.ts` and `sp10a-anti-patterns.test.ts` as legitimate maintenance per the SP10A precedent that allowlisted `pcd/cost/` in SP9's freeze).
- SP10B is the FIRST slice with abort/prune authority. Forecast-only invariant from SP10A no longer applies — `TreeBudgetExceededError` is the canonical SP10B-introduced exception, asserted in the orchestrator (anti-pattern test #3 catches "return false" refactors that lose the throw).

**SP10B is observability + enforcement on count only.** Cost-budget enforcement (`maxEstimatedUsd` field; coarse pre-routing estimator contract) is reserved for SP10C. Field widened in SP10B as nullable, populated null. Orchestrator structurally asserts `budget.maxEstimatedUsd === null` at gate time and throws `InvariantViolationError` if non-null (SP10C-bleed protection).

**SP10B compatibility with SP8 stub fanout:** the local-dev default chain shape (2 trends × 2 motivators × 3 hooks × 2 scripts = 42 nodes; max-fanout 3) PASSES `STATIC_DEFAULT_BUDGET` (`{maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null}`). Local development runs with no budget violations. Tests that exercise the fail path use tighter test-only budgets.

### SP10C (cost-budget enforcement) — SHIPPED in creativeagent

**SP10C-declared merge-back surfaces (production wiring at merge-back):**

- **`CoarseCostEstimator` injection** — Switchboard ad-optimizer team owns the production coarse pre-routing estimator. Real estimator reads per-tier × per-allowed-shot-type pricing tables, FX rates, volume tiers, contract pricing. SP10C ships only the contract + a deterministic stub (`StubCoarseCostEstimator`). `// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator` marker on stub class declaration. **Different team / different model from SP10A's per-asset estimator** — coarse pre-routing vs. routed per-asset answer different questions (design §0 risk #16).
- **`Sp10bBudgetReader` REUSED, NOT widened** — SP10C does NOT ship a parallel reader contract. SP10B's reader returns `PreproductionTreeBudget` which carries `maxEstimatedUsd: number | null`. Switchboard's production `OrganizationBudget` table at merge-back populates the field for cost-enforced orgs; leaves null for count-only orgs. One reader, one schema slot.
- **`WorkTrace` emit** — every SP10C state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Five markers in `run-identity-aware-preproduction-chain-with-cost-budget.ts`: budget resolved at top, count gate passed via SP10B, cost gate skipped (maxEstimatedUsd null), cost gate passed, cost gate violated. WorkTrace payload should include `costMeta` on success and `error.meta` on failure (both are `CostBudgetMeta`).
- **Production runner discipline** — at merge-back, production callsites pick their gate level: SP7's chain directly (no gate), SP10B's orchestrator (count only), or SP10C's orchestrator (count + cost). Three tiers; opt-in by injection. SP10C is the most-restrictive.
- **Dashboard UX for `CostBudgetExceededError`** — operator-facing surface for retrying with a raised cost budget. Separate UI from SP10B's tree-budget retry UI; shared form fields possible. SP10C emits `error.meta` carrying enough context to render the violation breakdown (estimatedUsd vs threshold, lineItems, estimatorVersion, costBudgetVersion, estimatedAt).
- **Outcome-wrapper consumption at merge-back** — production runners must destructure the SP10C return: `const { result, budgetMeta, costMeta } = await runIdentityAwarePreproductionChainWithCostBudget(...)`. The three meta fields populate analytics dashboards directly. The three-state matrix (design Q16) lets analytics queries compute opt-in rates per gate independently:
  - all three null → ran without budget (legacy / pre-rollout)
  - budgetMeta populated, costMeta null → count-only enforcement
  - all three populated → count + cost enforcement
- **`PcdProductionFanoutDecision.costForecast` slot** — STAYS null in SP10C. Merge-back consumers should NOT read this slot; read `outcome.costMeta` (or `error.meta` on failure) instead. SP7's composer is untouched.
- **identityContext threading optimization** — SP10C builds identityContext twice on the gated success path (once at SP10C entry for the estimator, once inside SP7 chain). Merge-back may widen SP7's chain return to include identityContext, after which SP10C's call site is a one-line swap.

**Schema reconciliation at merge-back:**

- `packages/schemas/src/pcd-cost-budget.ts` — NEW schema file added by SP10C: `CoarseCostEstimatorOutputSchema` + `CostBudgetMetaSchema`. Reconciles cleanly if Switchboard `main` has not added equivalent schemas. If Switchboard added same-semantic schemas under different names, reconcile by renaming SP10C's schemas before merge-back.
- `PreproductionTreeBudgetSchema.maxEstimatedUsd` — already widened in SP10B. SP10C populates the slot; does NOT widen further. SP10C anti-pattern test #5 freeze-asserts.
- No Prisma columns added by SP10C. Zero migration reconciliation overhead.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10C orchestrator + validator + stub estimator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/cost-budget/` changes at merge-back — only the injected estimator + reader swap (real Switchboard ad-optimizer estimator replaces `StubCoarseCostEstimator`; real Switchboard `OrganizationBudget` reader replaces `StaticDefaultBudgetReader`) and the `// MERGE-BACK:` markers get implementations.
- `PCD_COST_BUDGET_VERSION` is the 15th pinned constant. The PCD slice carries 15 total pinned constants after SP10C.
- SP10C introduces NO circular dependency. `pcd/cost-budget/` imports from `pcd/preproduction/` (chain composer, identity-context builder, types), `pcd/budget/` (SP10B orchestrator + types), and `pcd/` top-level. Reverse direction does not exist; `sp10c-anti-patterns.test.ts` enforces the source-freeze.
- The SP10B orchestrator body (`runIdentityAwarePreproductionChainWithBudget`) is untouched. SP10C added a parallel orchestrator (`runIdentityAwarePreproductionChainWithCostBudget`) that calls SP10B as a pure function with a stripped budget via `stripMaxUsdReader`. SP10B's count-only invariant is preserved structurally — `sp10b-anti-patterns.test.ts` test #6 stays unchanged.
- SP10C is the SECOND slice with abort/prune authority (SP10B was the first). The SP10B-introduced asymmetry (throw is _required_, mutation is _forbidden_) continues to apply; SP10C's own anti-pattern tests assert it.

**SP10C is the gate-time pre-routing cost forecast.** SP10A's per-asset post-routing forensic stamp is the canonical post-hoc record. The two answer different questions and WILL produce different numbers for the same scripts — operator dashboards must surface both explicitly (design §0 risk #16).

**SP10C compatibility with SP8 stub fanout + StaticDefaultBudgetReader:** 24 scripts × $1.50 = $36 estimate. `STATIC_DEFAULT_BUDGET.maxEstimatedUsd: null` means cost gate is skipped on local dev — same as SP10B count-only behavior. To exercise the cost gate locally, override the budget reader to return a non-null `maxEstimatedUsd`.

## Conventions inherited from Switchboard

These are already enforced in `CLAUDE.md` but listed here for the merge-back checklist:

- ESM, `.js` relative import extensions
- No `any`, no `console.log`
- Conventional Commits
- Co-located `*.test.ts`
- Prettier: semi, double quotes, 2 spaces, trailing commas, 100 cols
- Migration in same commit as schema change
- 400-line soft / 600-line hard file size limits

## Do not invent

If you're tempted to build something that already exists in Switchboard:

- Auth, sessions, NextAuth → don't. We have no UI here.
- Encryption / credentials → there's a real encryption layer in Switchboard's `packages/db/src/crypto/`. Don't re-implement.
- Inngest client setup → use the established pattern (`new Inngest({ id: "switchboard" })` — yes, keep that ID literal so merge-back doesn't have to relabel).
- Audit log writers → wait for `WorkTrace` at merge-back.

## Where to look in Switchboard when stuck

- `~/switchboard/CLAUDE.md` — invariants, layer rules, lint rules
- `~/switchboard/docs/DOCTRINE.md` — architectural rules
- `~/switchboard/docs/ARCHITECTURE.md` — deep architecture
- `~/switchboard/.agent/RESOLVER.md` — agent operating layer for the parent project
- `~/switchboard/packages/schemas/src/index.ts` — full schema barrel (what types we'd inherit)
- `~/switchboard/packages/db/prisma/schema.prisma` — full Prisma schema, including all the models we trimmed away

You can `git show 05bc4655:<path>` from inside `~/switchboard` to read any SP1-state file without checking out a branch.
