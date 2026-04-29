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
