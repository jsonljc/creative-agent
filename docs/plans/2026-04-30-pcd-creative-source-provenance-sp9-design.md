# SP9 — Creative-Source Provenance (Design)

**Slice:** PCD vertical SP9
**Date:** 2026-04-30
**Status:** Design — awaiting plan + implementation
**Predecessor:** SP8 (branching tree state + production-fanout hardening, squash `90f5323`, PR #7)
**Successor (planned):** SP10 (cost forecast wiring + tree-budget enforcement)

---

## 1. Mission

Bridge SP7/SP8's pre-production tree to SP4's per-asset `PcdIdentitySnapshot` so every generated asset carries a forensic trail back to the brief that authorized it: `briefId → trendId → motivatorId → hookId → scriptId → assetId`.

Today the gap is structural:

- **SP7/SP8** produce a 24-script branching tree with `parent*Id` lineage in zod schemas. A single `PcdProductionFanoutDecision` selects one or more scripts and ends pre-production.
- **SP4** writes a `PcdIdentitySnapshot` per generated asset with provider + four pinned versions. It has zero fields linking the asset back to the brief, the chain, or the script lineage that authorized it.
- **SP5** (QC) and **SP6** (consent revocation, final-export gate) operate on assets without ever knowing which script in which hook in which motivator in which trend produced them.

SP9 closes that gap with five new lineage columns + one `lineageDecisionReason Json?` column on `PcdIdentitySnapshot`, a 12th pinned version constant, and a new pure composer-side stamper that the merge-back-time production runner is required to call before invoking the SP4 writer.

---

## 2. Hard guardrails (inherited from SP1–SP8 — not negotiable)

1. **Pure orchestration in `packages/creative-pipeline/src/pcd/`.** Persistence goes through injected store interfaces with concrete Prisma implementers in `packages/db/`.
2. **No edits to SP1–SP8 source bodies.** SP9 widens schemas additively. SP4's `writePcdIdentitySnapshot` is NOT mutated; SP9 ships a new top-level orchestrator (`writePcdIdentitySnapshotWithProvenance`) that calls the SP4 writer.
3. **Pinned version constants per new decision surface.** SP9 adds `PCD_PROVENANCE_VERSION` (12th constant).
4. **`// MERGE-BACK:` markers** at every new state transition / external-system seam.
5. **Anti-pattern grep tests + forbidden-imports tests** on every new module. Ship `sp9-anti-patterns.test.ts` (extends SP7/SP8 pattern).
6. **Composer-only version pinning (SP8 lock).** The provenance stamper imports `PCD_PROVENANCE_VERSION` from a sibling const file. No gate or stub-stage-runner file may contain a `PCD_*_VERSION` literal — anti-pattern grep enforces.
7. **Identity context immutability (SP8 lock).** SP9 widens neither `PcdIdentityContext` nor the gate operator-decision tuple. Provenance is forensics on the per-asset snapshot, not state on the in-flight identity context.
8. **Per CLAUDE.md:** ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft limit, `pnpm exec prettier --check`. `pnpm lint` is structurally broken on origin/main per SP5 baseline note — use prettier as the practical style gate.

---

## 3. Architectural locks (Q1–Q6 + SP8 carry-overs)

### Q1 — Scope: creative-source provenance (chosen)

SP9 stamps lineage on the per-asset `PcdIdentitySnapshot` row. **Tree-time consent revocation** folds in as a small secondary check inside the stamper: if `assertConsentNotRevokedForGeneration` fails at stamp time, the stamper refuses with the existing `ConsentRevokedRefusalError` and the SP4 writer is never called. This is structurally identical to how the existing SP6 pre-check works; SP9 just adds a second invocation site at the provenance boundary.

**Rejected alternatives:**
- (B) Cost-forecast — already pinned for SP10 with `PcdCostForecastSchema` null on the decision struct and `PreproductionTreeBudgetSchema` null on the identity context.
- (D) Real-runner router seam — pulls Switchboard-only concerns into PCD scope; merge-back rule says the existing stub injection seams are correct and the swap happens at merge-back.

### Q2 — Schema location: widen `PcdIdentitySnapshot`

Provenance is per-asset forensics. The SP4 row is already that record. Three considered options:

| Option | Choice | Rationale |
|---|---|---|
| Widen `PcdIdentitySnapshot` | ✅ | Per-asset forensic record; SP4 already widened it additively (Q-ext-1 precedent). One row per asset; QC/approval queries already JOIN this. |
| New `PcdProvenance` table | ❌ | Doubles JOIN cost on every QC ledger and approval query. No semantic gain — it's still 1:1 with snapshot. |
| Widen `AssetRecord` | ❌ | `AssetRecord` is a Switchboard-broad object PCD doesn't own. SP6's `consentRevokedAfterGeneration` widen was exceptional (consent semantics live on the asset). Lineage is PCD-vertical-internal. |

**Five new nullable columns** + one nullable Json column. Existing pre-SP9 rows remain readable (Q5 lock).

### Q3 — Shape: denormalized (one row per asset, flat lineage)

```
briefId               String?    -- root of the lineage chain
trendId               String?    -- selected trend
motivatorId           String?    -- selected motivator (parentTrendId encoded in the chain output)
hookId                String?    -- selected hook
scriptId              String?    -- selected script (gate output)
lineageDecisionReason Json?      -- forensic carry-through: decidedAt, fanoutDecisionId, chainVersion, provenanceVersion
```

**Rationale:** one row tells the whole story. Matches SP4's `routingDecisionReason Json?` precedent. Normalized stage rows would force four JOINs on every QC ledger read; the parent-id chain is already encoded structurally in SP7/SP8's `parentTrendId` / `parentMotivatorId` / `parentHookId` schema fields, and the denormalized columns are the leaf-to-root projection of that walk.

### Q4 — Version pin: new `PCD_PROVENANCE_VERSION = "pcd-provenance@1.0.0"`

12th pinned constant in the PCD slice. Reasons not to reuse `PCD_PREPRODUCTION_CHAIN_VERSION`:

- Lineage-shape evolution (e.g. adding a `templateId` rung) is independent of chain-shape evolution (e.g. adding a 5th stage).
- SP10's cost ledger needs to bump cost-version independently of provenance-version.
- The composer-only version pinning lock means the stamper file is the single import site for this constant. No gate, runner, or writer source may contain the literal — `sp9-anti-patterns.test.ts` enforces.

`lineageDecisionReason.provenanceVersion` carries the value forensically. Future provenance-version bumps mean pre-bump rows record the prior version; readers must treat the column as schema-fixed but the Json value as version-tagged.

### Q5 — Backfill: additive nullable widen (option a)

Pre-SP9 `PcdIdentitySnapshot` rows have all six new columns null. No backfill function. No hard-cutover. SP9-and-later writes always populate (when called via `writePcdIdentitySnapshotWithProvenance` — the SP4-only callsite remains valid for tests and back-compat callers but emits null lineage).

**Conservative-compatibility precedent:** SP1, SP4, and SP5 all widened additively with nullable columns. SP9 follows the same pattern.

### Q6 — Module placement: top-level `pcd/provenance/` sibling subdir

Files land in `packages/creative-pipeline/src/pcd/provenance/`. Sibling to `pcd/preproduction/` (SP7/SP8) and to the SP1–SP6 top-level files. Rationale:

- Provenance is structurally **between** SP7/SP8 (chain output reader) and SP4 (snapshot writer). It's not part of pre-production (the chain has returned and the gate has selected). It's not part of the writer (the writer must not import preproduction schemas — that would create a backwards dependency in the slice ordering).
- Sibling subdir matches SP7's `pcd/preproduction/` precedent for a synergy slice with its own surface area, version constant, anti-pattern test, and barrel.

### SP8 carry-over: bound `decisionNote`

SP8 left `PcdProductionFanoutDecision.decisionNote: z.string().nullable()` deliberately unbounded with a comment flagging SP9+ for tightening. SP9 narrows to `z.string().max(2000).nullable()` and ships an anti-pattern grep test asserting:

- `decisionNote` is never read by any stub stage runner (no `decisionNote` substring in `stages/stub-*.ts`).
- `decisionNote` is never substringed into runner-prompt construction (no `decisionNote` substring in `stages/*-stage-runner.ts` source bodies — interface files are exempt).

The `decisionNote` field remains operator-only writeable (the gate populates it from the operator decision tuple via the schema-validated path; SP9 does NOT widen the gate operator decision schema — that would violate the SP8 immutability lock).

### SP8 carry-over: stub-fanout barrel re-exports

SP8 design specced barrel re-exports for `STUB_TRENDS_FANOUT` etc. but the in-tree barrel never added them. SP9 adds the four constant re-exports to `preproduction/index.ts` as a one-line cleanup. Cosmetic, not load-bearing.

---

## 4. What ships

### 4.1 New zod schemas (`packages/schemas/src/pcd-provenance.ts`)

```ts
// PCD slice SP9 — Creative-source provenance schema.
import { z } from "zod";

export const PcdProvenanceLineageSchema = z.object({
  briefId: z.string().min(1),
  trendId: z.string().min(1),
  motivatorId: z.string().min(1),
  hookId: z.string().min(1),
  scriptId: z.string().min(1),
}).readonly();
export type PcdProvenanceLineage = z.infer<typeof PcdProvenanceLineageSchema>;

export const PcdProvenanceDecisionReasonSchema = z.object({
  decidedAt: z.string().datetime(),
  fanoutDecisionId: z.string().min(1),         // stable id of the gate decision
  chainVersion: z.string().min(1),             // PCD_PREPRODUCTION_CHAIN_VERSION at stamp time
  provenanceVersion: z.string().min(1),        // PCD_PROVENANCE_VERSION at stamp time
}).readonly();
export type PcdProvenanceDecisionReason = z.infer<typeof PcdProvenanceDecisionReasonSchema>;

// Persistence input — flat shape for Prisma. Five lineage fields + one Json reason.
export const PcdSp9ProvenancePayloadSchema = z.object({
  briefId: z.string().min(1),
  trendId: z.string().min(1),
  motivatorId: z.string().min(1),
  hookId: z.string().min(1),
  scriptId: z.string().min(1),
  lineageDecisionReason: PcdProvenanceDecisionReasonSchema,
});
export type PcdSp9ProvenancePayload = z.infer<typeof PcdSp9ProvenancePayloadSchema>;
```

**Tests:** `packages/schemas/src/__tests__/pcd-provenance.test.ts` (SP8-discovered convention — schemas-package tests live in `__tests__/`, not `src/*.test.ts`).

### 4.2 SP8 carry-over: tighten `decisionNote`

In `packages/schemas/src/pcd-preproduction.ts`:

```diff
-  // SP8 — operator commentary seam; SP8 composer always emits null.
-  // SP9+: bound this field — max length, operator-only writeable, never used
-  // by stubs / never read for control flow / never copied into runner prompts.
-  decisionNote: z.string().nullable(),
+  // SP9 — bounded operator commentary. Operator-only writeable; never read by
+  // stub stage runners; never substringed into runner-prompt text.
+  // sp9-anti-patterns.test.ts enforces these invariants structurally.
+  decisionNote: z.string().max(2000).nullable(),
```

This is a widening of the constraint (existing values up to 2000 chars remain valid). No migration impact.

### 4.3 New pinned version constant

`packages/creative-pipeline/src/pcd/provenance/provenance-version.ts`:

```ts
// SP9 — pinned version constant for creative-source provenance lineage.
// 12th pinned constant in the PCD slice. Caller cannot override; pinned by the
// stamper from import. Bumped independently of PCD_PREPRODUCTION_CHAIN_VERSION
// so lineage-shape evolution is decoupled from chain-shape evolution.
export const PCD_PROVENANCE_VERSION = "pcd-provenance@1.0.0";
```

### 4.4 Pure provenance stamper

`packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts`:

```ts
// Pure store-injected stamper. Walks the chain output to derive the leaf-to-root
// lineage for the selected script, validates consent has not revoked since the
// gate decision, and returns a payload for the SP4 writer.

export type StampPcdProvenanceInput = {
  scriptId: string;                          // the script the asset is being generated for
  chainResult: PcdPreproductionChainResult;  // the SP7/SP8 chain output (decision + stageOutputs)
  fanoutDecisionId: string;                  // stable id for the fanout decision (provided by caller)
};

export type StampPcdProvenanceStores = {
  // SP6's existing reader; SP9 reuses it for the second consent check.
  consentRecordReader: { findById(id: string): Promise<{ revoked: boolean } | null> };
  clock?: () => Date;
};

export async function stampPcdProvenance(
  input: StampPcdProvenanceInput,
  stores: StampPcdProvenanceStores,
): Promise<PcdSp9ProvenancePayload>;
```

**Behavior:**

1. Walk `chainResult.stageOutputs.scripts.scripts` for the matching `scriptId`. Throw `InvariantViolationError("provenance script id not in chain output", { scriptId })` if absent.
2. From the matched script, read `parentHookId`. Walk `chainResult.stageOutputs.hooks.hooks` for that hook → read `parentMotivatorId` → walk motivators → read `parentTrendId` → walk trends.
3. Re-check consent via `assertConsentNotRevokedForGeneration` (SP6 import). On revocation: throw `ConsentRevokedRefusalError`. SP4 writer is never called.
4. Assemble `PcdSp9ProvenancePayload` pinning `PCD_PROVENANCE_VERSION` and reading `PCD_PREPRODUCTION_CHAIN_VERSION` from the SP7 import (forensic record of which chain shape produced this lineage).
5. `decidedAt` from `stores.clock?.() ?? new Date()` — same convention as SP7/SP8 wall-clock-stamped decisions.

**Pure async, store-injected.** Three error classes: `ZodError` (input validation), `InvariantViolationError` (lineage mismatch), `ConsentRevokedRefusalError` (mid-flight revocation). All propagate raw — no wrapping.

### 4.5 New top-level orchestrator + SP9 store contract

The SP4 writer body and store contract are preserved verbatim. SP9 ships a **new** store contract with a **new** persistence method (`createForShotWithProvenance`), a **new** adapter that returns the SP9-shaped store, and a **new** orchestrator that composes the stamper with a parallel SP9-only persistence path.

```ts
// SP9 — additive store contract. Imported from SP9 only. The SP4 contract
// (PcdIdentitySnapshotStore.createForShot) is preserved verbatim and continues
// to serve legacy callsites that write null lineage.
export type PcdSp9IdentitySnapshotStore = {
  createForShotWithProvenance(
    input: PcdIdentitySnapshotStoreInput & PcdSp9ProvenancePayload,
  ): Promise<PcdIdentitySnapshot>;
};
```

```ts
// packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts
//
// SP9 orchestrator. Stamps provenance, then persists via the SP9 store. SP4
// source body is NOT edited; SP9 adds a new public callsite that the
// merge-back-time production runner is required to call when generating
// assets from a fanout-selected script.

export type WritePcdIdentitySnapshotWithProvenanceInput = {
  snapshot: WritePcdIdentitySnapshotInput;       // SP4 input (unchanged shape)
  provenance: StampPcdProvenanceInput;           // SP9 input
};

export type WritePcdIdentitySnapshotWithProvenanceStores = {
  pcdSp9IdentitySnapshotStore: PcdSp9IdentitySnapshotStore;
} & StampPcdProvenanceStores;

export async function writePcdIdentitySnapshotWithProvenance(
  input: WritePcdIdentitySnapshotWithProvenanceInput,
  stores: WritePcdIdentitySnapshotWithProvenanceStores,
): Promise<PcdIdentitySnapshot>;
```

**Behavior, in order:**

1. Call `stampPcdProvenance(input.provenance, stores)`. May throw `ConsentRevokedRefusalError` / `InvariantViolationError` / `ZodError` — propagated raw.
2. Apply the same Tier 3 invariant assertion the SP4 writer applies (recompute-based, via the existing `assertTier3RoutingDecisionCompliant` import). On violation: throw `Tier3RoutingViolationError` / `Tier3RoutingMetadataMismatchError`. The store is never called.
3. Validate the snapshot input via the existing `PcdSp4IdentitySnapshotInputSchema.parse` (defense-in-depth — same allowlist forwarding pattern as SP4 writer body).
4. Pin the four SP4 versions (`PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`, plus `shotSpecVersion` carried from input) — same imports the SP4 writer uses.
5. Call `stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance(...)` with the merged 25-field payload (19 SP4 fields + 5 lineage ids + 1 lineage decision reason).

**Why duplicate steps 2–4 instead of calling `writePcdIdentitySnapshot`?** Because SP4's writer hardcodes `pcdIdentitySnapshotStore.createForShot(payload)` at the end — it persists to the SP4 contract method, which writes the 19-field row. To get a 25-field row written, SP9 needs to bypass that final call. The cleanest way (without editing SP4 source body) is to duplicate steps 2–4 in the SP9 orchestrator. Steps 2–4 are pure (Zod parse + invariant assertions + import-pinning); duplicating them is structurally safe.

**An anti-pattern grep test (`sp9-anti-patterns.test.ts`) asserts the duplicate steps are byte-equivalent in their version-pinning behavior:** the SP9 orchestrator must import the same four version constants as the SP4 writer, and must call `assertTier3RoutingDecisionCompliant` with the same six-argument signature. Drift between SP4 and SP9 invariant logic is a structural defect.

### 4.6 fanoutDecisionId convention

`PcdProductionFanoutDecision` (SP8) does NOT carry an explicit `id` field. SP9's `StampPcdProvenanceInput.fanoutDecisionId` is supplied by the caller (the merge-back-time production runner). Two acceptable conventions, documented for merge-back:

- **Inngest event id.** The Inngest event that triggered production fanout (per Switchboard's `creative-pipeline/preproduction.gate.approved` event pair) carries a stable id; the runner forwards it.
- **Synthesized hash.** `sha256(briefId + decidedAt + sorted(selectedScriptIds).join(","))`. Stable for the same gate decision; unique per fanout.

SP9 does not enforce one convention — it requires only that the value be stable per gate decision and unique across decisions (Zod-level: `z.string().min(1)`). Tests use a literal string fixture; production wiring at merge-back picks one. A `// MERGE-BACK: pick fanoutDecisionId convention` marker lives at the orchestrator's call site.

### 4.7 Prisma migration

`packages/db/prisma/migrations/<ts>_pcd_identity_snapshot_sp9_provenance/migration.sql`:

```sql
-- SP9 — Creative-source provenance lineage on PcdIdentitySnapshot.
-- All columns nullable for historical compatibility (pre-SP9 rows remain readable).
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "briefId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "trendId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "motivatorId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "hookId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "scriptId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "lineageDecisionReason" JSONB;

CREATE INDEX "PcdIdentitySnapshot_briefId_idx" ON "PcdIdentitySnapshot"("briefId");
CREATE INDEX "PcdIdentitySnapshot_scriptId_idx" ON "PcdIdentitySnapshot"("scriptId");
```

Indexes on `briefId` and `scriptId` only — these are the two leaf-to-root anchor points operators query by ("which assets came from this brief" / "which assets came from this script"). The intermediate three (trend/motivator/hook) are reachable via chain output JOIN if needed, and indexing them all costs write throughput on the SP4 hot path.

`schema.prisma` widens `PcdIdentitySnapshot`:

```diff
 model PcdIdentitySnapshot {
   /* ...existing fields... */
+  // SP9 provenance — nullable for historical compatibility (pre-SP9 rows).
+  briefId                     String?
+  trendId                     String?
+  motivatorId                 String?
+  hookId                      String?
+  scriptId                    String?
+  lineageDecisionReason       Json?

   createdAt                   DateTime        @default(now())

   @@index([productIdentityId])
   @@index([creatorIdentityId])
   @@index([selectedProvider])
+  @@index([briefId])
+  @@index([scriptId])
 }
```

### 4.8 Prisma adapter (`packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`)

**Existing** `PrismaPcdIdentitySnapshotStore.create` is preserved. **New** `createForShotWithProvenance` method added; existing `adaptPcdIdentitySnapshotStore` unchanged. Add a sibling `adaptPcdSp9IdentitySnapshotStore` adapter that returns the SP9 contract shape.

The new method writes the six provenance fields, with `lineageDecisionReason` JSON-serialized via `Prisma.JsonNull` if absent (matches SP4 precedent).

### 4.9 Public surface (creative-pipeline barrel)

`packages/creative-pipeline/src/pcd/provenance/index.ts`:

```ts
export { PCD_PROVENANCE_VERSION } from "./provenance-version.js";
export {
  stampPcdProvenance,
  type StampPcdProvenanceInput,
  type StampPcdProvenanceStores,
} from "./stamp-pcd-provenance.js";
export {
  writePcdIdentitySnapshotWithProvenance,
  type WritePcdIdentitySnapshotWithProvenanceInput,
  type WritePcdIdentitySnapshotWithProvenanceStores,
  type PcdSp9IdentitySnapshotStore,
} from "./write-pcd-identity-snapshot-with-provenance.js";
```

`packages/creative-pipeline/src/index.ts` re-exports `./pcd/provenance/index.js`.
`packages/schemas/src/index.ts` re-exports `./pcd-provenance.js`.

---

## 5. Data flow

```
[PcdProductionFanoutDecision]                                                       (SP8)
   selectedScriptIds: [s1, s2]
   ↓
[per-script production fanout — merge-back-time runner]
   for each scriptId in selectedScriptIds:
     for each AssetRecord generated for that script:
       ↓
       [writePcdIdentitySnapshotWithProvenance]                                     (SP9, NEW)
         step 1: stampPcdProvenance({ scriptId, chainResult, fanoutDecisionId })
                   walks chain → derives { briefId, trendId, motivatorId, hookId, scriptId }
                   re-checks consent (SP6 invocation #2)
                   pins PCD_PROVENANCE_VERSION + reads PCD_PREPRODUCTION_CHAIN_VERSION
                   returns PcdSp9ProvenancePayload
         step 2: writePcdIdentitySnapshot widened input → createForShotWithProvenance
                   SP4 invariant assertions run (Tier 3 compliance)
                   Prisma adapter writes 25-field row
       ↓
[PcdIdentitySnapshot row]                                                          (DB)
   forensic: provider + 4 SP4 versions + 5 lineage ids + 1 lineage reason
```

**Two consent-check invocations** by design: SP7/SP8's pre-chain check (one) + SP9 stamper's pre-write check (two). Reasons:

- Consent can revoke between gate decision and per-asset generation.
- Per-asset generation may be hours or days after the gate decision in production (Inngest replay, batch fanout).
- The cost of a duplicate check on the happy path is one DB read; the cost of writing an asset under revoked consent is a compliance incident.

---

## 6. Error handling

| Error class | Source | Wrapped? | Propagation |
|---|---|---|---|
| `ZodError` | input validation | no | propagates raw |
| `InvariantViolationError` | lineage script-id missing from chain | no | propagates raw with `{ scriptId }` context |
| `ConsentRevokedRefusalError` | SP6 pre-check at stamp time | no | propagates raw |
| `Tier3RoutingViolationError` | SP4 writer | no | propagates raw (SP4 unchanged) |
| `Tier3RoutingMetadataMismatchError` | SP4 writer | no | propagates raw (SP4 unchanged) |

No new error classes. SP9 reuses `InvariantViolationError` (SP6-promoted, widened constructor) and `ConsentRevokedRefusalError` (SP6).

---

## 7. Anti-pattern enforcement

`packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` — extends the SP7/SP8 grep-test pattern. Five structural assertions:

1. **No `PCD_*_VERSION` literal in any SP9 source other than `provenance-version.ts`** — composer-only pinning lock.
2. **`stampPcdProvenance` literally calls `assertConsentNotRevokedForGeneration(`** — second consent check is structurally enforced.
3. **No `decisionNote` substring in any `stages/stub-*.ts` file** — bounding lock.
4. **No `decisionNote` substring in any `stages/*-stage-runner.ts` source body** — never copied into runner prompts. Interface files (`*-stage-runner.ts` declaring only types) are exempt; the regex looks for `decisionNote` outside type-only contexts.
5. **No edits to SP1–SP8 source bodies** — git-diff-based assertion that no file under `pcd/*.ts` (top level) and no file under `pcd/preproduction/` other than `index.ts` (barrel re-export cleanup) and `pcd-preproduction.ts` (decisionNote bound) has changed since the SP8 squash commit.

**Forbidden imports** (test 5b in the same file): SP9 source must not import:
- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`, `node:http`, `node:https`, `crypto`

(Same list as SP7's forbidden-imports test.)

---

## 8. Testing strategy

| Module | Test file | Coverage |
|---|---|---|
| `pcd-provenance.ts` schemas | `packages/schemas/src/__tests__/pcd-provenance.test.ts` | Lineage shape, decision-reason shape, payload shape, readonly invariants |
| `decisionNote` bounding | `packages/schemas/src/__tests__/pcd-preproduction.test.ts` (extend) | Reject 2001-char string; accept 2000-char string; accept null |
| `provenance-version.ts` | co-located `.test.ts` | Constant value + format match |
| `stamp-pcd-provenance.ts` | co-located `.test.ts` | Happy path, missing script id, mid-flight revocation, clock injection, version pinning forensic |
| `write-pcd-identity-snapshot-with-provenance.ts` | co-located `.test.ts` | Stamps then writes; revocation aborts before SP4 writer call; SP4 errors propagate |
| `sp9-anti-patterns.test.ts` | co-located | Five structural assertions above |
| `prisma-pcd-identity-snapshot-store.ts` | extend SP4 test | New `createForShotWithProvenance` method writes 25-field row; legacy `createForShot` writes 19-field row with provenance columns null |

**Target test count delta:** ~80–100 net new tests (matches SP6/SP7/SP8 net deltas).

---

## 9. File layout

```
packages/schemas/src/
├── pcd-preproduction.ts                     [EDIT — bound decisionNote only]
├── pcd-provenance.ts                        [NEW]
├── __tests__/
│   ├── pcd-preproduction.test.ts            [EDIT — bound assertion]
│   └── pcd-provenance.test.ts               [NEW]
└── index.ts                                  [EDIT — re-export pcd-provenance]

packages/db/
├── prisma/
│   ├── schema.prisma                         [EDIT — widen PcdIdentitySnapshot]
│   └── migrations/<ts>_pcd_identity_snapshot_sp9_provenance/
│       └── migration.sql                     [NEW]
└── src/stores/
    ├── prisma-pcd-identity-snapshot-store.ts [EDIT — add createForShotWithProvenance + adaptPcdSp9*]
    └── prisma-pcd-identity-snapshot-store.test.ts [EDIT]

packages/creative-pipeline/src/
├── pcd/
│   ├── provenance/                           [NEW SUBDIR]
│   │   ├── index.ts
│   │   ├── provenance-version.ts
│   │   ├── provenance-version.test.ts
│   │   ├── stamp-pcd-provenance.ts
│   │   ├── stamp-pcd-provenance.test.ts
│   │   ├── write-pcd-identity-snapshot-with-provenance.ts
│   │   ├── write-pcd-identity-snapshot-with-provenance.test.ts
│   │   └── sp9-anti-patterns.test.ts
│   └── preproduction/
│       └── index.ts                          [EDIT — stub-fanout barrel cleanup]
└── index.ts                                  [EDIT — re-export pcd/provenance]

docs/
├── plans/
│   ├── 2026-04-30-pcd-creative-source-provenance-sp9-design.md  [THIS DOC]
│   └── 2026-04-30-pcd-creative-source-provenance-sp9-plan.md    [SUBSEQUENT]
└── SWITCHBOARD-CONTEXT.md                    [EDIT — SP9 merge-back surface section]
```

**Edit count:** 9 edits to existing files (3 schemas, 2 db, 2 creative-pipeline, 1 docs, 1 prisma schema). All additive widening or barrel re-export. Zero edits to SP1–SP8 source bodies (SP4 writer body, SP6 pre-check body, SP7 chain/builder/gate bodies, SP8 deep-freeze/composer/builder bodies).

**File size budget:** every new file under 400 lines (CLAUDE.md soft limit). Anticipated: stamper ~150 lines, orchestrator ~80 lines, anti-pattern test ~200 lines.

---

## 10. Merge-back surface (additions to `SWITCHBOARD-CONTEXT.md`)

### SP9 (creative-source provenance) — to be SHIPPED in creativeagent

**SP9-declared merge-back surfaces:**

- `consentRecordReader` (from SP6 — stamper reuses the existing reader). No new contract.
- `WorkTrace` emit — every SP9 state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `stamp-pcd-provenance.ts` (after lineage walk, after consent check, at payload assembly) plus one in `write-pcd-identity-snapshot-with-provenance.ts` at orchestrator return. Plus `// MERGE-BACK: include PCD_PROVENANCE_VERSION in WorkTrace decision payload` directive.
- The merge-back-time production runner is responsible for calling `writePcdIdentitySnapshotWithProvenance` instead of the bare `writePcdIdentitySnapshot`. Both callsites remain valid (the SP4 writer still ships); legacy callsites (e.g. tests, ad-hoc backfills) may continue to use the bare form and write null lineage.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.briefId/trendId/motivatorId/hookId/scriptId/lineageDecisionReason` — six new columns added by SP9 migration. If Switchboard `main` has not added equivalents independently, the SP9 migration applies cleanly. If Switchboard added same-semantic columns with different names, reconcile by renaming SP9's columns in the migration before merge-back.
- No FK constraints on the lineage columns. The referenced ids (`briefId`, `trendId`, etc.) are not Prisma-modeled in this repo or in SP1–SP8 — they're zod-only schema ids in the chain output. Merge-back may add FKs once Switchboard models the chain output as DB rows; SP9 leaves them as plain `TEXT?` with indexes for query performance.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP9 stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/provenance/` changes at merge-back — only the injected `consentRecordReader` swaps (Prisma-backed) and the `// MERGE-BACK:` markers get implementations.
- `PCD_PROVENANCE_VERSION` is the 12th pinned constant. The PCD slice carries 12 total pinned constants after SP9.
- SP9 introduces NO circular dependency. `pcd/provenance/` imports from `pcd/preproduction/` (chain output types) and from `pcd/` top-level (SP4 writer + SP6 pre-check). Reverse direction does not exist; anti-pattern test #5 enforces.

### SP8 carry-over (decisionNote bound) at merge-back

`PcdProductionFanoutDecisionSchema.decisionNote` narrows from `z.string().nullable()` to `z.string().max(2000).nullable()`. Pre-SP9 stored `decisionNote` values that exceed 2000 chars (none are anticipated — SP8's stub gate emits null) would fail re-parse. No backfill needed; SP8 stubs always emit null.

---

## 11. Merge-back checklist additions

For the eventual `creativeagent → switchboard` merge:

1. Single sed pass `@creativeagent/* → @switchboard/*` (covers SP9 imports verbatim).
2. `pcd-provenance.ts` is net-new in `@switchboard/schemas` — no reconciliation.
3. `pcd-provenance/` subdir in `creative-pipeline` is net-new — no reconciliation.
4. `provenance-version.ts` is net-new — no reconciliation.
5. SP9 migration is already applied to creativeagent's `main` — DO NOT re-apply at merge-back. Just don't add a duplicate.
6. `prisma-pcd-identity-snapshot-store.ts` widens with `createForShotWithProvenance` and `adaptPcdSp9IdentitySnapshotStore` — additive only; merge cleanly.

---

## 12. What is NOT in scope

- **Cost forecast wiring.** Reserved for SP10. `PcdCostForecastSchema` already null-reserved on `PcdProductionFanoutDecision`; SP9 does not populate it.
- **Tree-budget enforcement.** Reserved for SP10. `PreproductionTreeBudgetSchema` already null-reserved on `PcdIdentityContext`; SP9 does not validate it.
- **Real Claude-driven stage runners.** Reserved for merge-back. Stub injection seams remain correct.
- **Inngest event wiring.** SP9 ships pure orchestration. Merge-back-time production runner is responsible for invoking the SP9 orchestrator inside the appropriate Inngest function.
- **Backfilling pre-SP9 `PcdIdentitySnapshot` rows.** Per Q5 lock — additive null widen only. Pre-SP9 rows remain forever stranded with null lineage; that is the intended forensic record (those assets predate the lineage discipline).
- **Lineage on `AssetRecord`.** Lineage lives on the per-asset `PcdIdentitySnapshot` (Q2 lock). `AssetRecord` is Switchboard-broad and PCD does not own it.
- **FK constraints on lineage columns.** See merge-back note in §10. Switchboard may add FKs post-merge once chain output is DB-modeled; SP9 keeps them as plain `TEXT?`.
- **Edits to SP4 writer body.** SP9 widens via a new store contract method (`createForShotWithProvenance`) and a new orchestrator. The SP4 writer body (`writePcdIdentitySnapshot`) is preserved verbatim.

---

## 13. Open questions / deferrals

None. Q1–Q6 + SP8 carry-overs are all locked above. Any open question discovered during implementation triggers a stop-and-discuss per SP6/SP7/SP8 precedent — design doc updates land before the affected task ships.

---

## 14. Acceptance criteria

SP9 is done when:

- All 12 pinned constants present and re-exported from creative-pipeline barrel.
- SP4 writer body unchanged (git diff against SP8 squash for `pcd-identity-snapshot-writer.ts` is empty).
- SP6 pre-check body unchanged.
- SP7 chain/builder/gate bodies unchanged.
- SP8 deep-freeze/composer-widen bodies unchanged.
- SP9 migration applied locally; `pnpm db:generate` clean; `pnpm typecheck` clean across all 5 packages.
- `pnpm test` green: SP8 baseline (~1,411 tests) + ~80–100 SP9 net tests.
- `pnpm exec prettier --check` clean modulo the two SP5-baseline noise warnings on `tier-policy.ts`/`tier-policy.test.ts`.
- `sp9-anti-patterns.test.ts` passes all five structural assertions + forbidden-imports.
- `decisionNote` bounded at `max(2000)`; SP8 stub gate (which emits null) continues to pass.
- SWITCHBOARD-CONTEXT.md SP9 section + SP8-carry-over section added.
- Auto-memory updated with SP9 status entry.

---

## Appendix A — Why two consent checks (SP7 pre-chain + SP9 pre-write)

Single consent check at SP7 entry would mean the chain (and gate decision) runs under the consent state of "consent at brief input." But:

- Consent can revoke between brief input and gate decision (operator selection may take hours).
- Consent can revoke between gate decision and per-asset generation (production fanout may run for days, especially with Inngest retries).
- A revoked-consent asset in the snapshot record is a compliance incident, not a data-quality bug.

Two checks bracket the production-time interval. The pre-write check is the tighter of the two — it runs at the latest possible moment before persistence, when the snapshot row that carries `consentRecordId` is about to be written.

This is symmetric with SP6's `assertConsentNotRevokedForEdit` — same defense-in-depth pattern at a different lifecycle boundary.

## Appendix B — Why denormalized lineage columns (vs normalized stage rows)

The forensic question operators most commonly ask is: "An asset failed approval / a customer revoked consent / QC found a defect — what creative decisions led here?" The answer is one row in `PcdIdentitySnapshot` joined to one row in `AssetRecord`. With normalized stage rows, the answer is a five-table JOIN through `Trend → Motivator → Hook → Script → Snapshot`.

The chain output from SP7/SP8 already carries the `parent*Id` walk structurally in zod schemas. The SP9 lineage columns are the leaf-to-root projection of that walk, frozen at production-fanout time. The chain output JSON is also persisted (TODO at merge-back — Switchboard may model `PreproductionChainResult` as a DB row, at which point SP9's lineage columns become FK candidates), so the normalized walk remains reconstructible if needed for forensics.

The SP4 precedent for storing forensic data as both flat columns AND a `Json?` reason field (`routingDecisionReason`) is the model SP9 follows: flat columns for query performance, Json for the full forensic trail.

## Appendix C — Why `PCD_PROVENANCE_VERSION` is independent of `PCD_PREPRODUCTION_CHAIN_VERSION`

Three changes that bump chain version do NOT change provenance shape:
- Adding a 5th stage between hooks and scripts.
- Reordering parallel stages.
- Refactoring `PreproductionChainError` shape.

Three changes that bump provenance version do NOT change chain shape:
- Adding a `templateId` rung between brief and trend.
- Adding a confidence score to each lineage rung.
- Splitting `lineageDecisionReason` into structured fields.

Coupling them via a single version constant means every chain-version bump invalidates every provenance-version forensic claim, and vice versa. Independent pinning is the conservative choice.
