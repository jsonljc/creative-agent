---
date: 2026-04-29
tags: [creativeagent, pcd, design, sp6, approval, export, meta-draft, consent]
status: active
---

# SP6 — Approval / Final-Export / Meta-Draft / Consent-Revocation Lifecycle Gates — Design Spec

**Project:** CreativeAgent / PCD (Performance Creative Director)
**Sprint:** SP6 — final PCD slice
**Created:** 2026-04-29
**Status:** Design approved, pending implementation plan

## Goal

Ship the lifecycle-gate layer that closes the SP1–SP5 chain. SP6 is governance, not orchestration: it encodes the rules that say which AssetRecord transitions are allowed, refuses transitions that violate the rules, and propagates consent revocation through historical assets. SP6 ships:

1. **Approval-advancement gate** — refuses approval when SP5's persisted `ProductQcResult.passFail` is `fail` or `warn`. Closes step 5 of the hard-block invariant SP5 deferred ("label-visible without OCR match → approval refused").
2. **Final-export gate** — refuses final export unless four independent states align: `effectiveTier ≥ required`, `approvalState === "approved"`, `qc passFail === "pass"`, `ExportGateState.isOpen === true`. Plus: refuses on consent-revoked snapshots.
3. **Meta-draft gate** — refuses Meta-draft creation unless `effectiveTier ≥ 2`, `approvalState === "approved"`, `ComplianceCheck.checkMetaDraftCompliance` returns `pass: true`, and the snapshot's consent record is not revoked.
4. **Consent-revocation propagation** — when a `ConsentRecord` transitions to `revoked: true`, walks every `AssetRecord` whose `PcdIdentitySnapshot.consentRecordId` matches and sets `AssetRecord.consentRevokedAfterGeneration = true`. Idempotent. Does not delete history.
5. **Two pre-checks for new generation paths** — refuse new PCD job creation against a creator with revoked consent (`assertConsentNotRevokedForGeneration`); refuse edit/extend creation against a prior asset whose snapshot's consent is revoked (`assertConsentNotRevokedForEdit`).

## Scope

### In scope

- Six pure store-injected functions in `packages/creative-pipeline/src/pcd/`.
- Two injected merge-back-seam interfaces (`ExportGateState`, `ComplianceCheck`) with default in-tree implementers (`AlwaysOpenExportGateState`, `AlwaysPassComplianceCheck`).
- One new injected store contract (`ConsentRevocationStore`) with concrete `PrismaConsentRevocationStore` in `packages/db`.
- Narrow read-only store reader interfaces (`AssetRecordReader`, `ConsentRecordReader`, `ProductQcResultReader`, `PcdIdentitySnapshotReader`, `CreativeJobReader`, `CreatorIdentityReader`) — Prisma adapters in `packages/db`.
- One additive Prisma migration: add `consentRevokedAfterGeneration Boolean @default(false)` column to `AssetRecord`. Same commit as the schema change.
- Decision-struct schemas added to `packages/schemas/src/pcd-identity.ts` (zod).
- Two new pinned version constants: `PCD_APPROVAL_LIFECYCLE_VERSION` (sibling file `approval-lifecycle-version.ts`) and `PCD_CONSENT_REVOCATION_VERSION` (sibling file `consent-revocation-version.ts`).
- Co-located `*.test.ts` for every non-type-only source file.
- Forbidden-imports tests + anti-pattern grep tests per existing SP discipline.

### Out of scope

- **`apps/api` wiring.** SP6 ships gate functions; merge-back wires them into job-creation, final-export, Meta-draft, and revocation-trigger entry points.
- **Real `WorkTrace` emission.** Each lifecycle decision-point carries a `// MERGE-BACK: emit WorkTrace here` marker. No equivalent emitter is invented in this repo.
- **Real `ApprovalLifecycle`.** Switchboard owns `packages/core/src/approval/`. SP6 does not invent a parallel state machine; it reads `AssetRecord.approvalState` and returns decisions about proposed transitions.
- **`LegalOverrideRecord` table or override UX.** SP6 refuses revoked re-export by default with a `// MERGE-BACK: legal-override path` marker at the refusal branch. Override schema, table, and UX are Switchboard's at merge-back.
- **Real FTC-disclosure logic.** `AlwaysPassComplianceCheck` is the only implementer in-tree. The Meta-draft gate genuinely calls the interface (not invisible theater); the real implementation is merge-back.
- **Notification fan-out** for consent revocation. Switchboard's three-channel notification system at merge-back.
- **Asset deletion.** Revocation never deletes `WorkTrace`, `PcdIdentitySnapshot`, or `AssetRecord` rows. Only flips `consentRevokedAfterGeneration`.
- **`ConsentRecord` schema widening.** Existing `revoked / revokedAt / revocable / expiresAt` fields are sufficient.
- **SP1–SP5 schema body changes.** No edits to `tier-policy.ts`, `registry-resolver.ts`, `provider-router.ts`, `pcd-identity-snapshot-writer.ts`, `qc-evaluator.ts`, the QC matrix, the QC predicates, or the QC aggregator. SP6 consumes their outputs only.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SP6 lifecycle gates — independent, store-injected, no internal dispatcher    │
│                                                                               │
│   decidePcdApprovalAdvancement   ──→  PcdApprovalAdvancementDecision         │
│   decidePcdFinalExportGate       ──→  PcdFinalExportDecision                 │
│   decidePcdMetaDraftGate         ──→  PcdMetaDraftDecision                   │
│   propagateConsentRevocation     ──→  PcdConsentRevocationPropagationResult  │
│   assertConsentNotRevokedForGeneration  ──→  void / throws                   │
│   assertConsentNotRevokedForEdit         ──→  void / throws                  │
│                                                                               │
│   Caller (merge-back: Switchboard ApprovalLifecycle / ExportLifecycle /      │
│   ingress) composes them explicitly. SP6 ships no dispatcher.                │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ reads
                                    ▼
                  ┌──────────────────────────────────┐
                  │ Read-only store readers          │
                  │ (Prisma adapters in packages/db) │
                  │                                  │
                  │ AssetRecordReader                │
                  │ ProductQcResultReader            │
                  │ PcdIdentitySnapshotReader        │
                  │ ConsentRecordReader              │
                  │ CreativeJobReader                │
                  │ CreatorIdentityReader            │
                  └──────────────────────────────────┘
                                    │
                                    │ propagateConsentRevocation also writes
                                    ▼
                  ┌──────────────────────────────────┐
                  │ ConsentRevocationStore (writes)  │
                  │ PrismaConsentRevocationStore     │
                  │   findAssetIdsByRevokedConsent   │
                  │   markAssetsConsent...Generation │
                  └──────────────────────────────────┘

Injected merge-back seams (separate files, separate concerns):
  ExportGateState  — default: AlwaysOpenExportGateState
  ComplianceCheck  — default: AlwaysPassComplianceCheck
```

### File layout

```
packages/creative-pipeline/src/pcd/
  approval-lifecycle-version.ts          # exports PCD_APPROVAL_LIFECYCLE_VERSION
  consent-revocation-version.ts          # exports PCD_CONSENT_REVOCATION_VERSION
  approval-advancement.ts                # decidePcdApprovalAdvancement
  final-export-gate.ts                   # decidePcdFinalExportGate
  meta-draft-gate.ts                     # decidePcdMetaDraftGate
  consent-revocation.ts                  # propagateConsentRevocation
  consent-pre-check-generation.ts        # assertConsentNotRevokedForGeneration
  consent-pre-check-edit.ts              # assertConsentNotRevokedForEdit
  export-gate-state.ts                   # ExportGateState type + AlwaysOpenExportGateState
  compliance-check.ts                    # ComplianceCheck type + AlwaysPassComplianceCheck
  consent-revocation-error.ts            # ConsentRevokedRefusalError
  + co-located *.test.ts for each non-type-only file

packages/db/src/stores/
  prisma-consent-revocation-store.ts     # PrismaConsentRevocationStore
  prisma-asset-record-reader.ts          # PrismaAssetRecordReader (and similar for each reader)
  prisma-product-qc-result-reader.ts
  prisma-pcd-identity-snapshot-reader.ts
  prisma-consent-record-reader.ts
  prisma-creative-job-reader.ts
  prisma-creator-identity-reader.ts

packages/schemas/src/pcd-identity.ts
  PcdLifecycleRefusalReasonSchema
  PcdApprovalAdvancementDecisionSchema
  PcdFinalExportDecisionSchema
  PcdMetaDraftDecisionSchema
  PcdConsentRevocationPropagationResultSchema
```

### Boundary discipline

- Each lifecycle decision is its own pure async function. No internal dispatcher; no shared `LifecycleContext` god-bag; no `if (intent === ...)` switch.
- Each function takes the minimum input it needs (zod-validated at the boundary) plus a small store bundle of injected dependencies.
- Each gate's decision struct carries the version constant pinned from imports — caller cannot override.
- Refusal reasons are an enum, not a free-text field. PII bounds: refusal-reason payloads never echo user input.

## Schema additions

### Prisma migration (additive, single commit with schema change)

Add one column to `AssetRecord`:

```prisma
model AssetRecord {
  // ...existing fields...
  consentRevokedAfterGeneration Boolean @default(false)
  // ...
}
```

- Nullable-equivalent (defaults to `false` so historical rows are well-defined).
- No backfill job required: every existing asset reads as not-flagged. Propagation is the only writer.
- No FK loosening, no rename, no follow-up migration.

### `packages/schemas/src/pcd-identity.ts` additions

```ts
export const PcdLifecycleRefusalReasonSchema = z.enum([
  "qc_failed",                    // ProductQcResult.passFail === "fail"
  "qc_not_conclusive",             // ProductQcResult.passFail === "warn" (SP5 binding)
  "qc_result_not_found",           // SP5 invariant: every asset has a QC row; missing = error
  "approval_not_granted",          // AssetRecord.approvalState !== "approved"
  "tier_insufficient",             // CreativeJob.effectiveTier < required
  "export_gate_closed",            // ExportGateState.isOpen returned { open: false }
  "consent_revoked",               // ConsentRecord.revoked === true
  "compliance_check_failed",       // ComplianceCheck.checkMetaDraftCompliance returned { pass: false }
  "asset_not_found",               // AssetRecord row missing
  "snapshot_not_found",            // PcdIdentitySnapshot row missing for asset
  "creator_identity_not_found",    // CreatorIdentity row missing
  "creative_job_not_found",        // CreativeJob row missing for asset's jobId
]);
export type PcdLifecycleRefusalReason = z.infer<typeof PcdLifecycleRefusalReasonSchema>;

export const PcdApprovalAdvancementDecisionSchema = z.object({
  allowed: z.boolean(),
  assetRecordId: z.string(),
  currentApprovalState: z.string(),
  proposedApprovalState: z.enum(["approved", "rejected"]),
  qcPassFail: z.enum(["pass", "fail", "warn"]).nullable(),
  refusalReasons: z.array(PcdLifecycleRefusalReasonSchema),
  approvalLifecycleVersion: z.string(),
});
export type PcdApprovalAdvancementDecision = z.infer<typeof PcdApprovalAdvancementDecisionSchema>;

export const PcdFinalExportDecisionSchema = z.object({
  allowed: z.boolean(),
  assetRecordId: z.string(),
  effectiveTier: IdentityTierSchema.nullable(),
  approvalState: z.string().nullable(),
  qcPassFail: z.enum(["pass", "fail", "warn"]).nullable(),
  exportGateOpen: z.boolean(),
  consentRevoked: z.boolean(),
  refusalReasons: z.array(PcdLifecycleRefusalReasonSchema),
  approvalLifecycleVersion: z.string(),
});
export type PcdFinalExportDecision = z.infer<typeof PcdFinalExportDecisionSchema>;

export const PcdMetaDraftDecisionSchema = z.object({
  allowed: z.boolean(),
  assetRecordId: z.string(),
  effectiveTier: IdentityTierSchema.nullable(),
  approvalState: z.string().nullable(),
  complianceCheckPassed: z.boolean(),
  consentRevoked: z.boolean(),
  refusalReasons: z.array(PcdLifecycleRefusalReasonSchema),
  approvalLifecycleVersion: z.string(),
});
export type PcdMetaDraftDecision = z.infer<typeof PcdMetaDraftDecisionSchema>;

export const PcdConsentRevocationPropagationResultSchema = z.object({
  consentRecordId: z.string(),
  assetIdsFlagged: z.array(z.string()),         // newly flagged this run
  assetIdsAlreadyFlagged: z.array(z.string()),  // already flagged from a prior run (idempotency)
  consentRevocationVersion: z.string(),
});
export type PcdConsentRevocationPropagationResult = z.infer<
  typeof PcdConsentRevocationPropagationResultSchema
>;
```

`AssetRecord.approvalState` remains `String` at the DB layer (no enum constraint), matching SP1's existing shape and Switchboard's eventual `ApprovalLifecycle` ownership. SP6 reads it; SP6 does not mutate it. Mutation happens at merge-back inside Switchboard's `ApprovalLifecycle` after consuming SP6's decision.

## Function contracts (gate by gate)

### `decidePcdApprovalAdvancement`

```ts
type DecidePcdApprovalAdvancementInput = {
  assetRecordId: string;
};

type DecidePcdApprovalAdvancementStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
};

async function decidePcdApprovalAdvancement(
  input: DecidePcdApprovalAdvancementInput,
  stores: DecidePcdApprovalAdvancementStores,
): Promise<PcdApprovalAdvancementDecision>;
```

**Logic:**

1. Read `AssetRecord` by id. If null → `{ allowed: false, refusalReasons: ["asset_not_found"], proposedApprovalState: "rejected" }`.
2. Read `ProductQcResult` by `assetRecordId`. If null → `refusalReasons: ["qc_result_not_found"]`. Per SP5: every PCD asset has a QC row; missing is an error/unprocessed state.
3. Switch on `productQcResult.passFail`:
   - `"fail"` → refuse with `["qc_failed"]`. **Hard-block invariant step 5 closure.** This is the *only* `if (passFail ===` branch in SP6 source — anti-pattern grep test enforces.
   - `"warn"` → refuse with `["qc_not_conclusive"]`. SP5 binding semantic: warn is "not conclusively pass," not approvable.
   - `"pass"` → allow.
4. `proposedApprovalState` is `"approved"` when `allowed === true`; otherwise `"rejected"`. This field describes the *proposed* lifecycle transition the caller is checking — SP6 does not mutate state.
5. Pin `approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION` from imports.
6. `// MERGE-BACK: emit WorkTrace here` marker at the return statement.

### `decidePcdFinalExportGate`

```ts
type DecidePcdFinalExportGateInput = {
  assetRecordId: string;
  requiredTier?: IdentityTier;  // defaults to 2 per design's "final_export requires effectiveTier ≥ 2"
};

type DecidePcdFinalExportGateStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  exportGateState: ExportGateState;
};

async function decidePcdFinalExportGate(
  input: DecidePcdFinalExportGateInput,
  stores: DecidePcdFinalExportGateStores,
): Promise<PcdFinalExportDecision>;
```

**Logic (collect-all, do not short-circuit):**

1. Read `AssetRecord`. Missing → return single-reason refusal `["asset_not_found"]`.
2. Read `CreativeJob` by `AssetRecord.jobId`. Missing → `["creative_job_not_found"]`.
3. Read `ProductQcResult` by `assetRecordId`. Missing → reason `qc_result_not_found`. Otherwise read `passFail`.
4. Read `PcdIdentitySnapshot` by `assetRecordId`. May be null for non-PCD historical assets (snapshot is SP4+). When null, `consentRevoked = false`.
5. If snapshot exists and `snapshot.consentRecordId !== null`, read `ConsentRecord` and check `revoked`.
6. Call `exportGateState.isOpen(assetRecordId)`.
7. Compute refusal reasons (collect all, ordered by severity):
   - `effectiveTier < requiredTier` → `tier_insufficient`
   - `approvalState !== "approved"` → `approval_not_granted`
   - `passFail !== "pass"` → `qc_failed` (when fail) or `qc_not_conclusive` (when warn)
   - `exportGateOpen === false` → `export_gate_closed`
   - `consentRevoked === true` → `consent_revoked`
     - `// MERGE-BACK: legal-override path — when LegalOverrideRecord exists for this asset with reason+approver, do not refuse on consent_revoked.` marker placed at this branch.
8. `allowed = refusalReasons.length === 0`.
9. Pin `approvalLifecycleVersion` from imports.
10. `// MERGE-BACK: emit WorkTrace here` marker at return.

**Why collect-all:** an export decision is a forensic statement. If three things are wrong, the audit log should show three reasons, not one. Short-circuit hides downstream problems and forces operators to retry to discover the next issue.

### `decidePcdMetaDraftGate`

```ts
type DecidePcdMetaDraftGateInput = {
  assetRecordId: string;
  shotType: PcdShotType;
};

type DecidePcdMetaDraftGateStores = {
  assetRecordReader: AssetRecordReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  complianceCheck: ComplianceCheck;
};

async function decidePcdMetaDraftGate(
  input: DecidePcdMetaDraftGateInput,
  stores: DecidePcdMetaDraftGateStores,
): Promise<PcdMetaDraftDecision>;
```

**Logic (collect-all):**

1. Read `AssetRecord`. Missing → `["asset_not_found"]`.
2. Read `CreativeJob`. Missing → `["creative_job_not_found"]`.
3. Read `PcdIdentitySnapshot`; check consent if present.
4. **Always invoke `complianceCheck.checkMetaDraftCompliance({ assetRecordId, shotType, effectiveTier })`** — even when other refusal reasons are already present. The Meta-draft gate genuinely calls the interface; the call is not invisible theater. This preserves the merge-back seam: when Switchboard's real FTC-disclosure check ships, the gate already routes through it.
5. Compute refusal reasons:
   - `effectiveTier < 2` → `tier_insufficient`
   - `approvalState !== "approved"` → `approval_not_granted`
   - `consentRevoked === true` → `consent_revoked`
   - `complianceCheck` returned `pass: false` → `compliance_check_failed`
6. `allowed = refusalReasons.length === 0`.
7. **Note:** Meta-draft does NOT re-check `passFail`. The design's Meta-draft rule is `effectiveTier ≥ 2 + approval pass + compliance check`. `approvalState === "approved"` already implies QC passed (the approval gate refuses on QC fail/warn). Re-checking would duplicate state and create drift between approval-state and QC at meta-draft time.
8. `// MERGE-BACK: emit WorkTrace here` marker at return.

### `propagateConsentRevocation`

```ts
type PropagateConsentRevocationInput = {
  consentRecordId: string;
};

type PropagateConsentRevocationStores = {
  consentRecordReader: ConsentRecordReader;
  consentRevocationStore: ConsentRevocationStore;
};

async function propagateConsentRevocation(
  input: PropagateConsentRevocationInput,
  stores: PropagateConsentRevocationStores,
): Promise<PcdConsentRevocationPropagationResult>;
```

**Logic:**

1. Read `ConsentRecord` by id. If null → throw `InvariantViolationError("consent record not found")`. Caller should not call with a non-existent id.
2. If `revoked !== true` → throw `InvariantViolationError("propagateConsentRevocation called for non-revoked record")`. Caller misuse guard. Propagation is for revoked records only; a separate untouched code path handles new consent.
3. `assetIds = consentRevocationStore.findAssetIdsByRevokedConsent(consentRecordId)` — returns AssetRecord ids whose snapshot's `consentRecordId` matches.
4. `consentRevocationStore.markAssetsConsentRevokedAfterGeneration(assetIds)` — flips the column to `true` for any not already true. Idempotency contract: SQL is `UPDATE ... SET consentRevokedAfterGeneration = true WHERE id IN (...) AND consentRevokedAfterGeneration = false RETURNING id`. The returned ids are `assetIdsFlagged`; the rest are `assetIdsAlreadyFlagged`.
5. Pin `consentRevocationVersion: PCD_CONSENT_REVOCATION_VERSION` from imports.
6. `// MERGE-BACK: emit WorkTrace per asset flagged here.` marker around the per-asset boundary.
7. Returns `PcdConsentRevocationPropagationResult`.

**Idempotency property:** running `propagateConsentRevocation` twice in a row produces identical state. The second run returns `assetIdsFlagged: []` and the same `assetIdsAlreadyFlagged` list as the first run produced.

**No deletion:** `WorkTrace`, `PcdIdentitySnapshot`, and `AssetRecord` rows are preserved verbatim. Audit integrity is non-negotiable. Only `consentRevokedAfterGeneration` flips.

### `assertConsentNotRevokedForGeneration`

```ts
type AssertConsentNotRevokedForGenerationInput = {
  creatorIdentityId: string;
};

type AssertConsentNotRevokedForGenerationStores = {
  creatorIdentityReader: CreatorIdentityReader;
  consentRecordReader: ConsentRecordReader;
};

async function assertConsentNotRevokedForGeneration(
  input: AssertConsentNotRevokedForGenerationInput,
  stores: AssertConsentNotRevokedForGenerationStores,
): Promise<void>;  // throws ConsentRevokedRefusalError on refusal
```

**Logic:**

1. Read `CreatorIdentity` by id. Missing → throw `InvariantViolationError`.
2. If `creatorIdentity.consentRecordId === null` → return (no consent record means Tier 1/2; not blocked at this gate).
3. Read `ConsentRecord` by id. Missing → throw `InvariantViolationError`.
4. If `consentRecord.revoked === true` → throw `ConsentRevokedRefusalError({ creatorIdentityId, consentRecordId, revokedAt })`.
5. Otherwise return.

**Caller composition (merge-back):** Switchboard's PCD job-creation orchestrator calls `resolvePcdRegistryContext` (SP3) → then calls `assertConsentNotRevokedForGeneration(creatorIdentityId, ...)` → then proceeds to `routePcdShot` (SP4). Two function calls bracket the SP3 resolver call. SP3 source is untouched.

### `assertConsentNotRevokedForEdit`

```ts
type AssertConsentNotRevokedForEditInput = {
  priorAssetRecordId: string;
};

type AssertConsentNotRevokedForEditStores = {
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
};

async function assertConsentNotRevokedForEdit(
  input: AssertConsentNotRevokedForEditInput,
  stores: AssertConsentNotRevokedForEditStores,
): Promise<void>;
```

**Logic:**

1. Read `PcdIdentitySnapshot` by `assetRecordId`.
2. If snapshot is null → return (the prior asset has no PCD snapshot; not blocked).
3. If `snapshot.consentRecordId === null` → return (no consent record was bound at generation time).
4. Read `ConsentRecord` by id. Missing → throw `InvariantViolationError`.
5. If `revoked === true` → throw `ConsentRevokedRefusalError`.
6. Otherwise return.

**Why two functions, not one:** the input is a different identifier (`creatorIdentityId` vs `priorAssetRecordId`), the lookup chain is different (one hop vs two hops), and the call sites are different (job creation vs edit/extend creation). One concern per file matches SP1–SP5 file discipline and keeps audit boundaries crisp.

## Injected interfaces

### `ExportGateState`

Future Switchboard `ExportLifecycle` seam.

```ts
export type ExportGateOpenness = { open: true } | { open: false; reason: string };

export interface ExportGateState {
  isOpen(assetRecordId: string): Promise<ExportGateOpenness>;
}

export class AlwaysOpenExportGateState implements ExportGateState {
  async isOpen(_assetRecordId: string): Promise<ExportGateOpenness> {
    return { open: true };
  }
}
```

`// MERGE-BACK: replace AlwaysOpenExportGateState with Switchboard ExportLifecycle adapter.` marker on the class.

### `ComplianceCheck`

Future FTC-disclosure / Meta-draft compliance review seam.

```ts
export type ComplianceCheckInput = {
  assetRecordId: string;
  shotType: PcdShotType;
  effectiveTier: IdentityTier;
  // Future merge-back fields: scriptClaimsPath, testimonialFlags, voiceConsentRecordId, ...
};

export type ComplianceCheckResult =
  | { pass: true }
  | { pass: false; reason: string };

export interface ComplianceCheck {
  checkMetaDraftCompliance(input: ComplianceCheckInput): Promise<ComplianceCheckResult>;
}

export class AlwaysPassComplianceCheck implements ComplianceCheck {
  async checkMetaDraftCompliance(_input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
    return { pass: true };
  }
}
```

`// MERGE-BACK: replace AlwaysPassComplianceCheck with real FTC-disclosure / Meta-draft compliance pipeline.` marker on the class.

The Meta-draft gate **must** call this interface even though the default implementer always passes. An anti-pattern test asserts the gate source contains a literal call to `complianceCheck.checkMetaDraftCompliance`. This guarantees the merge-back seam is real, not theater: when the real check ships, no gate-side code change is required.

### `ConsentRevocationStore`

```ts
export interface ConsentRevocationStore {
  /**
   * Returns AssetRecord ids whose PcdIdentitySnapshot.consentRecordId matches
   * the supplied consentRecordId. Implementation: JOIN AssetRecord with
   * PcdIdentitySnapshot on AssetRecord.id = PcdIdentitySnapshot.assetRecordId
   * WHERE PcdIdentitySnapshot.consentRecordId = $1.
   */
  findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]>;

  /**
   * Atomically flips AssetRecord.consentRevokedAfterGeneration to true for the
   * supplied ids where it is currently false. Returns the ids whose value
   * changed (newly flagged). Ids already true are not in the return.
   */
  markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }>;
}
```

Concrete `PrismaConsentRevocationStore` in `packages/db/src/stores/prisma-consent-revocation-store.ts` uses two Prisma queries:

```ts
// findAssetIdsByRevokedConsent
prisma.pcdIdentitySnapshot.findMany({
  where: { consentRecordId },
  select: { assetRecordId: true },
}).then(rows => rows.map(r => r.assetRecordId));

// markAssetsConsentRevokedAfterGeneration
const before = await prisma.assetRecord.findMany({
  where: { id: { in: assetRecordIds } },
  select: { id: true, consentRevokedAfterGeneration: true },
});
const toFlag = before.filter(r => !r.consentRevokedAfterGeneration).map(r => r.id);
await prisma.assetRecord.updateMany({
  where: { id: { in: toFlag } },
  data: { consentRevokedAfterGeneration: true },
});
return {
  newlyFlagged: toFlag,
  alreadyFlagged: before.filter(r => r.consentRevokedAfterGeneration).map(r => r.id),
};
```

### Read-only store readers

Each reader is a one-method interface returning the minimum fields the gates need. Concrete Prisma adapters in `packages/db/src/stores/`. No changes to existing PrismaXxxStore implementations; the readers are new narrow interfaces a Prisma adapter satisfies.

```ts
export interface AssetRecordReader {
  findById(assetRecordId: string): Promise<{
    id: string;
    jobId: string;
    creatorId: string | null;
    approvalState: string;
  } | null>;
}

export interface ProductQcResultReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    passFail: "pass" | "fail" | "warn";
  } | null>;
}

export interface PcdIdentitySnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    creatorIdentityId: string;
    consentRecordId: string | null;
  } | null>;
}

export interface ConsentRecordReader {
  findById(consentRecordId: string): Promise<{
    id: string;
    revoked: boolean;
    revokedAt: Date | null;
  } | null>;
}

export interface CreativeJobReader {
  findById(jobId: string): Promise<{
    id: string;
    effectiveTier: number | null;
  } | null>;
}

export interface CreatorIdentityReader {
  findById(creatorIdentityId: string): Promise<{
    id: string;
    consentRecordId: string | null;
  } | null>;
}
```

## Version constants

```ts
// packages/creative-pipeline/src/pcd/approval-lifecycle-version.ts
export const PCD_APPROVAL_LIFECYCLE_VERSION = "approval-lifecycle@1.0.0";

// packages/creative-pipeline/src/pcd/consent-revocation-version.ts
export const PCD_CONSENT_REVOCATION_VERSION = "consent-revocation@1.0.0";
```

Pinned by importing functions; caller cannot override.

| Function | Pinned constant |
|---|---|
| `decidePcdApprovalAdvancement` | `PCD_APPROVAL_LIFECYCLE_VERSION` |
| `decidePcdFinalExportGate` | `PCD_APPROVAL_LIFECYCLE_VERSION` |
| `decidePcdMetaDraftGate` | `PCD_APPROVAL_LIFECYCLE_VERSION` |
| `propagateConsentRevocation` | `PCD_CONSENT_REVOCATION_VERSION` |
| Pre-checks | none — they throw or return; no decision struct, no version |

Each decision struct carries its pinned version string verbatim. Tests assert struct equality on the version field by importing the constant.

## Errors

### `ConsentRevokedRefusalError`

```ts
export class ConsentRevokedRefusalError extends Error {
  readonly name = "ConsentRevokedRefusalError";
  readonly creatorIdentityId: string | null;
  readonly priorAssetRecordId: string | null;
  readonly consentRecordId: string;
  readonly revokedAt: Date | null;

  constructor(args: {
    creatorIdentityId?: string;
    priorAssetRecordId?: string;
    consentRecordId: string;
    revokedAt: Date | null;
  }) { /* ... */ }
}
```

Used by both pre-checks. The two pre-checks throw the same error type with different identifying fields populated.

### `InvariantViolationError`

The existing `InvariantViolationError` lives in `packages/creative-pipeline/src/pcd/registry-resolver.ts:9` with constructor `(jobId, fieldName)` — SP3/SP4-specific. SP6 needs a more generic shape for "row not found that should always exist" cases (consent record missing, creator identity missing, etc.).

Implementation choice (the implementation plan resolves which):

- **Option A:** Promote `InvariantViolationError` to its own file `packages/creative-pipeline/src/pcd/invariant-violation-error.ts` and widen its constructor to `(reason: string, context?: Record<string, unknown>)`. Update SP3/SP4 call sites to use the new shape (small mechanical refactor). Re-exported from `registry-resolver.ts` for backward compatibility.
- **Option B:** Introduce a sibling `LifecycleInvariantViolationError` in `packages/creative-pipeline/src/pcd/lifecycle-invariant-violation-error.ts` with the wider shape, and leave the SP3/SP4 class untouched.

Option A is preferred (one error class for one concept); Option B is the fallback if the SP3/SP4 refactor is deemed too invasive in the implementation plan.

## Testing strategy

### Per-function invariant tests

Co-located `*.test.ts` for each non-type-only file. In-memory fakes implement the reader and store interfaces.

**`approval-advancement.test.ts`:**

1. QC `passFail === "pass"` → `allowed: true`, `proposedApprovalState: "approved"`, `refusalReasons: []`.
2. QC `passFail === "fail"` → `allowed: false`, `refusalReasons: ["qc_failed"]`. **SP5 step 5 closure.**
3. QC `passFail === "warn"` → `allowed: false`, `refusalReasons: ["qc_not_conclusive"]`. SP5 binding.
4. QC row missing → `allowed: false`, `refusalReasons: ["qc_result_not_found"]`.
5. AssetRecord missing → `["asset_not_found"]`.
6. Decision struct carries `approvalLifecycleVersion === PCD_APPROVAL_LIFECYCLE_VERSION`.

**`final-export-gate.test.ts`:**

7. All four states aligned + consent OK + export gate open → `allowed: true`.
8. Tier insufficient (effectiveTier=1, requiredTier=2) → `["tier_insufficient"]`.
9. ApprovalState=`"pending"` → `["approval_not_granted"]`.
10. QC fail → `["qc_failed"]`.
11. QC warn → `["qc_not_conclusive"]`.
12. Export gate closed → `["export_gate_closed"]`.
13. Consent revoked → `["consent_revoked"]`.
14. **Multi-fail collect-all:** tier insufficient + approval not granted + QC fail + export gate closed → all four reasons in `refusalReasons`. Asserts no short-circuit.
15. Snapshot null (non-PCD asset) → `consentRevoked: false`, no revocation reason.

**`meta-draft-gate.test.ts`:**

16. All states aligned + ComplianceCheck passes → `allowed: true`.
17. Tier 1 → `["tier_insufficient"]`.
18. ApprovalState=`"pending"` → `["approval_not_granted"]`.
19. Consent revoked → `["consent_revoked"]`.
20. ComplianceCheck returns `{ pass: false, reason: "FTC_DISCLOSURE_MISSING" }` → `["compliance_check_failed"]`.
21. **Compliance call is invoked:** spy ComplianceCheck records calls; gate calls it exactly once with `{ assetRecordId, shotType, effectiveTier }`.
22. **Compliance call is invoked even when other refusal reasons exist:** assert call happens regardless of tier/approval/consent state. Preserves the merge-back seam.

**`consent-revocation.test.ts`:**

23. ConsentRecord missing → throws `InvariantViolationError`.
24. ConsentRecord exists but `revoked === false` → throws `InvariantViolationError`. Caller misuse guard.
25. Three matching assets, none flagged → all three flagged; `assetIdsFlagged: [...]`, `assetIdsAlreadyFlagged: []`.
26. Three matching assets, two already flagged → one newly flagged, two already-flagged.
27. **Idempotency:** run propagation twice; second run returns `assetIdsFlagged: []`, same `assetIdsAlreadyFlagged` set.
28. Decision struct carries `consentRevocationVersion === PCD_CONSENT_REVOCATION_VERSION`.
29. Empty matching set (consent revoked but no snapshot referenced it) → `assetIdsFlagged: []`, no error.

**`consent-pre-check-generation.test.ts`:**

30. CreatorIdentity with `consentRecordId === null` → returns (no error).
31. CreatorIdentity with consent record `revoked === false` → returns.
32. CreatorIdentity with consent record `revoked === true` → throws `ConsentRevokedRefusalError({ creatorIdentityId, consentRecordId, revokedAt })`.
33. CreatorIdentity not found → throws `InvariantViolationError`.

**`consent-pre-check-edit.test.ts`:**

34. AssetRecord with no PcdIdentitySnapshot → returns (non-PCD asset).
35. Snapshot with `consentRecordId === null` → returns.
36. Snapshot with consent record `revoked === false` → returns.
37. Snapshot with consent record `revoked === true` → throws `ConsentRevokedRefusalError({ priorAssetRecordId, consentRecordId, revokedAt })`.

**`prisma-consent-revocation-store.test.ts`** (in `packages/db`):

38. `findAssetIdsByRevokedConsent` returns ids matching snapshot.consentRecordId.
39. `markAssetsConsentRevokedAfterGeneration` flips false→true and returns `newlyFlagged`.
40. Calling `markAssetsConsentRevokedAfterGeneration` twice on same ids returns empty `newlyFlagged` second time.

### Anti-pattern grep tests

- **No `if (passFail ===` outside `approval-advancement.ts`.** SP5's matrix-driven dispatch invariant inheritance. Test scans every other SP6 source file (after stripping line comments), fails on match.
- **No `assetRecord.update`, `prisma.`, or `WorkTrace` token in any SP6 source file under `packages/creative-pipeline/src/pcd/`** (except `// MERGE-BACK:` comment markers — strip line comments first). Mutations live in stores; SP6 source is decision logic only.
- **No `if (intent ===`, `switch (intent)`, or similar dispatch pattern in any SP6 source.** Forbids retroactive introduction of Approach 2.
- **`meta-draft-gate.ts` source contains the literal `complianceCheck.checkMetaDraftCompliance(`.** Guarantees the seam is real, not theater.
- **No `import.*core/approval`, `import.*ApprovalLifecycle`, `import.*ExportLifecycle` in SP6 source.** Switchboard merge-back surfaces are stubbed locally; SP6 cannot accidentally reach into the parent system.

### Forbidden imports per source file

Each SP6 source file ships a co-located test asserting its source string does not contain any of:

- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`, `node:http`, `node:https`
- `crypto` (no hashing in lifecycle gates; SP6 reads existing rows, decides, returns)

Per existing SP1–SP5 pattern.

### PII bounds

- `PcdLifecycleRefusalReason` is an enum. No free-text refusal field carries user data.
- `ComplianceCheckResult.reason` is an opaque string from the implementer — the in-tree `AlwaysPassComplianceCheck` never returns it. A test asserts `AlwaysPassComplianceCheck` returns exactly `{ pass: true }` (no reason field).
- `ConsentRevokedRefusalError` carries identifiers only (creatorIdentityId, consentRecordId, revokedAt) — never personName, scopeOfUse, or other ConsentRecord PII.

## SP5 invariant inheritance

SP5 left explicit hooks for SP6:

| SP5 invariant | SP6 enforcement |
|---|---|
| **Hard-block invariant step 5** ("label-visible without OCR match → approval refused") | `decidePcdApprovalAdvancement` refuses on `passFail === "fail"`. Test asserts the chain end-to-end. |
| **`passFail === "warn"` is not approvable** ("not conclusively pass") | `decidePcdApprovalAdvancement` refuses on `passFail === "warn"` with reason `qc_not_conclusive`. |
| **Every PCD asset has a `ProductQcResult` row** | SP6 treats missing row as `qc_result_not_found` refusal — not as "no QC needed." |
| **Empty-gates QC ledger row → `passFail: "warn"`** | Tier 1 assets that ran zero gates carry `passFail: "warn"` and SP6 refuses approval — preventing implicit Tier 1 approval. |
| **Matrix-driven dispatch invariant** (no `if (gate ===`, `if (effectiveTier ===`, `if (shotType ===` outside data-keyed switch) | SP6 anti-pattern grep extends this: no `if (passFail ===` outside `approval-advancement.ts`; no `if (intent ===` anywhere. |

## Merge-back surface

SP6 is the slice with the most merge-back surface, per `docs/SWITCHBOARD-CONTEXT.md`. Markers and contracts:

| `// MERGE-BACK:` marker | Location | Resolution at merge-back |
|---|---|---|
| `// MERGE-BACK: emit WorkTrace here` | Each lifecycle decision return statement | Switchboard's `WorkTrace` writer wraps each gate call; emits a state-transition record with the decision struct as payload. |
| `// MERGE-BACK: emit WorkTrace per asset flagged here` | `consent-revocation.ts` per-asset boundary | Switchboard's WorkTrace writer fires once per AssetRecord whose flag flips. |
| `// MERGE-BACK: legal-override path` | `final-export-gate.ts` consent-revoked refusal branch | Switchboard's `LegalOverrideRecord` lookup precedes the consent-revoked refusal. If a valid override exists for `(assetRecordId, consentRecordId)` with reason and approver, the gate suppresses the `consent_revoked` reason. |
| `// MERGE-BACK: replace AlwaysOpenExportGateState with Switchboard ExportLifecycle adapter` | `export-gate-state.ts` | Default implementer is replaced by an adapter calling `packages/core/src/export-lifecycle/`. |
| `// MERGE-BACK: replace AlwaysPassComplianceCheck with real FTC-disclosure / Meta-draft compliance pipeline` | `compliance-check.ts` | Default is replaced by Switchboard's compliance pipeline (script-claims path, testimonial flagging, FTC disclosure). |
| `// MERGE-BACK: notification fan-out` | `consent-revocation.ts` after propagation completes | Switchboard's three-channel notification system fires per affected campaign owner. |

### Stored row reconciliation at merge-back

- `AssetRecord.consentRevokedAfterGeneration Boolean @default(false)` migration: this column is net-new; merge-back applies it to Switchboard's `AssetRecord` (assuming Switchboard hasn't added it). If Switchboard already has a column with the same semantic but different name, reconcile by renaming SP6's column in the migration before merge-back.
- `AssetRecord.approvalState`: SP6 reads it; merge-back keeps the SP1 column shape. Switchboard's `ApprovalLifecycle` writes it. SP6 does not mutate.

### Stub-strategy summary (matches `docs/SWITCHBOARD-CONTEXT.md` SP6 section)

- Local `ApprovalRequest` interface? Not needed at SP6 boundary. SP6 reads `AssetRecord` via `AssetRecordReader`; the proposed-state field on the decision struct is what merge-back consumes.
- Local `ExportLifecycle` interface: `ExportGateState`. Default implementer is the seam.
- Local FTC compliance interface: `ComplianceCheck`. Default implementer is the seam.
- Local override path: deferred entirely to merge-back; only a comment marker in this repo.

## Acceptance criteria (from source-of-truth design)

From `docs/plans/2026-04-27-pcd-identity-registry-design.md` SP6 row:

> Final export requires tier pass + QC pass + approval pass. Meta draft additionally requires compliance check pass. Consent revocation blocks future generations, edits, extensions, Meta drafts, and re-export of prior assets without override.

SP6 implementation verifies all of the above structurally:

- ✅ `decidePcdFinalExportGate` refuses unless tier ≥ required AND `approvalState === "approved"` AND `passFail === "pass"` AND export gate open.
- ✅ `decidePcdMetaDraftGate` calls `ComplianceCheck.checkMetaDraftCompliance` and refuses on `pass: false`.
- ✅ `assertConsentNotRevokedForGeneration` blocks new generations against revoked consent.
- ✅ `assertConsentNotRevokedForEdit` blocks new edits/extensions against revoked-consent snapshots.
- ✅ `decidePcdMetaDraftGate` blocks new Meta drafts of revoked-consent snapshots.
- ✅ `decidePcdFinalExportGate` blocks re-export of revoked-consent assets (with `// MERGE-BACK: legal-override path` for the override case).
- ✅ `propagateConsentRevocation` flips `consentRevokedAfterGeneration` on existing assets without deleting any history.

## What's deliberately out of scope

- **No `LegalOverrideRecord` table or override UX.** Deferred to merge-back. Refusal is the SP6 default.
- **No notification fan-out.** Switchboard's three-channel notification system at merge-back.
- **No `apps/api` HTTP routes, Inngest functions, or PlatformIngress wiring.** Gate functions only.
- **No real `WorkTrace` emit, no real `ApprovalLifecycle` mutation.** Markers only.
- **No real FTC-disclosure logic.** `AlwaysPassComplianceCheck` is the only implementer.
- **No `apps/dashboard` UI for the `consentRevokedAfterGeneration` flag.** Schema column ships; UI is Switchboard's.
- **No retroactive backfill of `consentRevokedAfterGeneration`.** New column defaults `false` for historical rows. Propagation is the only writer.
- **No SP1–SP5 source body changes.** SP6 consumes outputs only.
- **No widening of `ConsentRecord` schema.** Existing fields cover SP6 needs.

## Non-obvious conclusions

- **SP6 is governance, not orchestration.** It encodes the rules and refuses violations. The orchestration layer (job creation, edit creation, final export, Meta-draft, revocation trigger) is wired at merge-back. Keeping SP6 free of dispatch and entry-point wiring is what makes it an audit boundary instead of a business-logic blob.
- **Approach 1 (independent gates) is right because the four decisions are not dispatch siblings.** They run at different lifecycle moments, on different rows, with different inputs. Forcing them into one dispatcher would couple decisions that should evolve independently and reintroduce the very `if (intent ===` shape SP5's matrix-driven discipline forbids.
- **Final-export gate collects all refusal reasons (does not short-circuit) because export is a forensic statement.** "This export was refused for three reasons" is more honest than "this export was refused; once you fix that, ask again to find the next problem."
- **Meta-draft gate genuinely calls `ComplianceCheck` even when the default always passes.** This is the difference between a real seam and invisible theater. When merge-back swaps in the real check, no gate-side code changes — the call is already there.
- **Consent revocation propagation is a one-way flag flip, not a deletion.** Audit integrity is non-negotiable; the design's "do not delete" rule is structural, not a politeness. Future-readable WorkTrace history is what the entire registry exists to provide.
- **Two pre-check functions (generation + edit), not one.** Different identifier in, different lookup chain, different call site. One concern per file matches SP1–SP5 file discipline. The shared error type (`ConsentRevokedRefusalError`) keeps the refusal shape consistent at the call site without forcing the lookup into a discriminated union.
