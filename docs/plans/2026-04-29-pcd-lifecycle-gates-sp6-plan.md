# PCD SP6 — Approval / Final-Export / Meta-Draft / Consent-Revocation Lifecycle Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SP6 of the PCD vertical — six pure store-injected lifecycle decision functions (`decidePcdApprovalAdvancement`, `decidePcdFinalExportGate`, `decidePcdMetaDraftGate`, `propagateConsentRevocation`, `assertConsentNotRevokedForGeneration`, `assertConsentNotRevokedForEdit`), two injected merge-back-seam interfaces (`ExportGateState`, `ComplianceCheck`), one new injected store (`ConsentRevocationStore`) with Prisma implementer, and one additive Prisma migration adding `AssetRecord.consentRevokedAfterGeneration`.

**Architecture:** Independent gates, no internal dispatcher. Each gate takes the minimum input it needs, returns a self-describing decision struct (or throws on consent-revoked / corrupted-state), and pins its version constant from imports. Final-export collects all refusal reasons. Meta-draft genuinely invokes `ComplianceCheck`. Propagation flips `consentRevokedAfterGeneration` idempotently with sorted output. SP5's hard-block invariant step 5 closes here: `passFail === "fail"` refuses approval; `passFail === "warn"` (SP5 binding: not-conclusively-pass) also refuses. Snapshots referencing missing ConsentRecords throw `InvariantViolationError` (corrupted state, not a refusal).

**Tech Stack:** TypeScript ESM, Vitest, Zod, Prisma 5, pnpm + Turborepo. Layer rules per `CLAUDE.md`: schemas (zod-only) → db (schemas + Prisma) → creative-pipeline (schemas + db + inngest).

**Source-of-truth design:** `docs/plans/2026-04-29-pcd-lifecycle-gates-sp6-design.md`. **Read this entirely before starting any task** — it carries the binding invariants, the five applied review tightenings, and the merge-back marker placements.

**Upstream context to read once before Task 0:**

- `CLAUDE.md` — repo conventions (ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft / 600-line hard file limit).
- `docs/SWITCHBOARD-CONTEXT.md` — merge-back rules. SP6 has the highest density of `// MERGE-BACK:` markers.
- `docs/plans/2026-04-27-pcd-identity-registry-design.md` — sections "Compliance hooks", "Consent revocation behavior (explicit)", "Separation of concerns: identity tier vs. approval vs. QC vs. export", and the SP6 row in the sprint plan.
- `docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md` — the SP5 design that left step 5 ("approval refusal") for SP6 to close, plus the `passFail === "warn"` binding semantic that SP6 inherits.
- `packages/schemas/src/pcd-identity.ts` — existing schemas; SP6 widens here.
- `packages/db/prisma/schema.prisma` — existing `AssetRecord.approvalState` (already SP1), `ConsentRecord.revoked` / `revokedAt` (already SP1), `PcdIdentitySnapshot.consentRecordId` (already SP1). SP6 adds only `AssetRecord.consentRevokedAfterGeneration`.

**Pre-existing tooling baseline (per `docs/plans/2026-04-29-pcd-qc-gates-sp5-baseline.md`):** `pnpm lint` is structurally broken on `main` (ESLint not installed in any package). SP6 uses `pnpm exec prettier --check` as the practical style gate, matching SP4/SP5 precedent. Final verification command is `pnpm build && pnpm test && pnpm typecheck && pnpm exec prettier --check '**/*.ts'`.

---

## File structure (locked)

**NEW files:**

```
packages/creative-pipeline/src/pcd/
  approval-lifecycle-version.ts             # PCD_APPROVAL_LIFECYCLE_VERSION
  consent-revocation-version.ts             # PCD_CONSENT_REVOCATION_VERSION
  invariant-violation-error.ts              # promoted from registry-resolver.ts; widened constructor
  consent-revocation-error.ts               # ConsentRevokedRefusalError
  lifecycle-readers.ts                      # 6 narrow reader interfaces
  export-gate-state.ts                      # ExportGateState + AlwaysOpenExportGateState
  export-gate-state.test.ts
  compliance-check.ts                       # ComplianceCheck + AlwaysPassComplianceCheck
  compliance-check.test.ts
  approval-advancement.ts                   # decidePcdApprovalAdvancement
  approval-advancement.test.ts
  final-export-gate.ts                      # decidePcdFinalExportGate
  final-export-gate.test.ts
  meta-draft-gate.ts                        # decidePcdMetaDraftGate
  meta-draft-gate.test.ts
  consent-revocation.ts                     # propagateConsentRevocation + ConsentRevocationStore interface
  consent-revocation.test.ts
  consent-pre-check-generation.ts           # assertConsentNotRevokedForGeneration
  consent-pre-check-generation.test.ts
  consent-pre-check-edit.ts                 # assertConsentNotRevokedForEdit
  consent-pre-check-edit.test.ts
  sp6-anti-patterns.test.ts                 # SP6-wide anti-pattern grep + forbidden-imports tests

packages/db/src/stores/
  prisma-consent-revocation-store.ts
  prisma-consent-revocation-store.test.ts
  prisma-asset-record-reader.ts
  prisma-product-qc-result-reader.ts
  prisma-pcd-identity-snapshot-reader.ts
  prisma-consent-record-reader.ts
  prisma-creative-job-reader.ts
  prisma-creator-identity-reader.ts

packages/db/prisma/migrations/<timestamp>_pcd_asset_record_consent_revoked_sp6/
  migration.sql
```

**MODIFIED files:**

```
packages/schemas/src/pcd-identity.ts                # add 5 new schemas
packages/schemas/src/index.ts                       # re-export new schemas
packages/db/prisma/schema.prisma                    # add AssetRecord.consentRevokedAfterGeneration
packages/db/src/index.ts                            # re-export new stores/readers
packages/creative-pipeline/src/index.ts             # re-export SP6 surfaces
packages/creative-pipeline/src/pcd/registry-resolver.ts   # update InvariantViolationError import + call sites
packages/creative-pipeline/src/pcd/registry-resolver.test.ts  # update InvariantViolationError import
docs/SWITCHBOARD-CONTEXT.md                         # SP6 merge-back notes
```

---

## Task 0: Pre-flight — sync, branch, baseline check

**Files:**
- None (environment setup).

- [ ] **Step 1: Sync local main with origin/main**

```bash
cd ~/creativeagent
git checkout main
git fetch origin
git reset --hard origin/main
git log --oneline -3
```

Expected last 3 commits include `a742ec6 feat(pcd): SP5 — QC gates orchestration + gate matrix + QC ledger writer (#4)`.

- [ ] **Step 2: Create SP6 implementation branch**

```bash
git checkout -b feat/pcd-sp6-lifecycle-gates
git branch --show-current
```

Expected: `feat/pcd-sp6-lifecycle-gates`.

- [ ] **Step 3: Verify baseline build/test/typecheck/prettier**

```bash
pnpm install
pnpm db:generate
pnpm build
pnpm test
pnpm typecheck
pnpm exec prettier --check '**/*.ts' '!**/dist/**' '!**/node_modules/**'
```

Expected: build succeeds across 5 packages; ~1,138 tests pass (per SP5 baseline); typecheck clean; prettier check clean (modulo the two pre-existing tier-policy.ts warnings noted in SP5 baseline — these are not SP6's regression).

- [ ] **Step 4: Confirm AssetRecord and ConsentRecord SP1 columns**

```bash
grep -nE "approvalState|consentRevokedAfterGeneration|revoked\b|revokedAt|consentRecordId" \
  packages/db/prisma/schema.prisma
```

Expected lines (paraphrased) — `AssetRecord.approvalState String @default("pending")`, `ConsentRecord.revoked Boolean @default(false)`, `ConsentRecord.revokedAt DateTime?`, `PcdIdentitySnapshot.consentRecordId String?`. **Critical:** `consentRevokedAfterGeneration` must NOT yet appear — SP6 adds it.

- [ ] **Step 5: No commit — environment-only task. Proceed to Task 1.**

---

## Task 1: Add `PcdLifecycleRefusalReasonSchema` to schemas

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts` (append at end of file)
- Test: `packages/schemas/src/__tests__/pcd-identity-sp6.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/pcd-identity-sp6.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PcdLifecycleRefusalReasonSchema } from "../pcd-identity.js";

describe("PcdLifecycleRefusalReasonSchema", () => {
  it("accepts every documented refusal reason", () => {
    const reasons = [
      "qc_failed",
      "qc_not_conclusive",
      "qc_result_not_found",
      "approval_not_granted",
      "tier_insufficient",
      "export_gate_closed",
      "consent_revoked",
      "compliance_check_failed",
      "asset_not_found",
      "snapshot_not_found",
      "creator_identity_not_found",
      "creative_job_not_found",
    ];
    for (const r of reasons) {
      expect(PcdLifecycleRefusalReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects undocumented reasons", () => {
    expect(PcdLifecycleRefusalReasonSchema.safeParse("unknown_reason").success).toBe(false);
    expect(PcdLifecycleRefusalReasonSchema.safeParse("").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-identity-sp6
```

Expected: FAIL with `PcdLifecycleRefusalReasonSchema is not exported`.

- [ ] **Step 3: Add the schema to `packages/schemas/src/pcd-identity.ts`**

Append at the end of the file (after `PcdSp5QcLedgerInputSchema`):

```ts
// SP6: lifecycle-gate refusal reasons. Enum-only — no free-text payloads echo
// user input. See docs/plans/2026-04-29-pcd-lifecycle-gates-sp6-design.md.
export const PcdLifecycleRefusalReasonSchema = z.enum([
  "qc_failed",                  // ProductQcResult.passFail === "fail"
  "qc_not_conclusive",          // ProductQcResult.passFail === "warn" (SP5 binding)
  "qc_result_not_found",        // SP5 invariant: every PCD asset has a QC row
  "approval_not_granted",       // AssetRecord.approvalState !== "approved"
  "tier_insufficient",          // CreativeJob.effectiveTier < required (or null)
  "export_gate_closed",         // ExportGateState.isOpen returned { open: false }
  "consent_revoked",            // ConsentRecord.revoked === true
  "compliance_check_failed",    // ComplianceCheck returned { pass: false }
  "asset_not_found",            // AssetRecord row missing
  "snapshot_not_found",         // PcdIdentitySnapshot row missing for asset
  "creator_identity_not_found", // CreatorIdentity row missing
  "creative_job_not_found",     // CreativeJob row missing for asset's jobId
]);
export type PcdLifecycleRefusalReason = z.infer<typeof PcdLifecycleRefusalReasonSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-identity-sp6
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-identity.ts \
        packages/schemas/src/__tests__/pcd-identity-sp6.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): SP6 — PcdLifecycleRefusalReasonSchema enum

Twelve enum members covering every refusal path documented in the SP6 design:
QC outcomes, lifecycle state, tier, export-gate, consent, compliance, and the
four "row missing" cases. Enum-only by design — refusal payloads never carry
free-text user data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the four decision-struct schemas

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts`
- Test: `packages/schemas/src/__tests__/pcd-identity-sp6.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `packages/schemas/src/__tests__/pcd-identity-sp6.test.ts`:

```ts
import {
  PcdApprovalAdvancementDecisionSchema,
  PcdFinalExportDecisionSchema,
  PcdMetaDraftDecisionSchema,
  PcdConsentRevocationPropagationResultSchema,
} from "../pcd-identity.js";

describe("PcdApprovalAdvancementDecisionSchema", () => {
  it("accepts a full allow decision", () => {
    const ok = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "approved",
      qcPassFail: "pass",
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts a refuse decision with multiple reasons", () => {
    const ok = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "rejected",
      qcPassFail: "fail",
      refusalReasons: ["qc_failed"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects proposedApprovalState outside the approved/rejected pair", () => {
    const bad = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "deferred",
      qcPassFail: "pass",
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(bad.success).toBe(false);
  });
});

describe("PcdFinalExportDecisionSchema", () => {
  it("accepts a full allow with all four states aligned", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      qcPassFail: "pass",
      exportGateOpen: true,
      consentRevoked: false,
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts collect-all multi-reason refusal", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: 1,
      approvalState: "pending",
      qcPassFail: "fail",
      exportGateOpen: false,
      consentRevoked: true,
      refusalReasons: [
        "tier_insufficient",
        "approval_not_granted",
        "qc_failed",
        "export_gate_closed",
        "consent_revoked",
      ],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts null effectiveTier (per type-boundary normalization)", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: null,
      approvalState: "pending",
      qcPassFail: null,
      exportGateOpen: true,
      consentRevoked: false,
      refusalReasons: ["tier_insufficient"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});

describe("PcdMetaDraftDecisionSchema", () => {
  it("accepts allow with compliance pass", () => {
    const ok = PcdMetaDraftDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      complianceCheckPassed: true,
      consentRevoked: false,
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts refusal on compliance fail", () => {
    const ok = PcdMetaDraftDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      complianceCheckPassed: false,
      consentRevoked: false,
      refusalReasons: ["compliance_check_failed"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});

describe("PcdConsentRevocationPropagationResultSchema", () => {
  it("accepts a propagation result with both partitions", () => {
    const ok = PcdConsentRevocationPropagationResultSchema.safeParse({
      consentRecordId: "consent_1",
      assetIdsFlagged: ["a1", "a2"],
      assetIdsAlreadyFlagged: ["a3"],
      consentRevocationVersion: "consent-revocation@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts an empty propagation result", () => {
    const ok = PcdConsentRevocationPropagationResultSchema.safeParse({
      consentRecordId: "consent_1",
      assetIdsFlagged: [],
      assetIdsAlreadyFlagged: [],
      consentRevocationVersion: "consent-revocation@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-identity-sp6
```

Expected: FAIL with `PcdApprovalAdvancementDecisionSchema is not exported` (and the others).

- [ ] **Step 3: Add the four decision schemas to `packages/schemas/src/pcd-identity.ts`**

Append after `PcdLifecycleRefusalReasonSchema`:

```ts
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
  assetIdsFlagged: z.array(z.string()),
  assetIdsAlreadyFlagged: z.array(z.string()),
  consentRevocationVersion: z.string(),
});
export type PcdConsentRevocationPropagationResult = z.infer<
  typeof PcdConsentRevocationPropagationResultSchema
>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-identity-sp6
```

Expected: 9 tests pass (2 from Task 1 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-identity.ts \
        packages/schemas/src/__tests__/pcd-identity-sp6.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): SP6 — four lifecycle-gate decision schemas

PcdApprovalAdvancementDecisionSchema, PcdFinalExportDecisionSchema,
PcdMetaDraftDecisionSchema, PcdConsentRevocationPropagationResultSchema. All
carry their version constant verbatim (caller-side equality test asserts).
effectiveTier on export and meta-draft schemas is IdentityTier | null per the
type-boundary-normalization rule in the SP6 design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Re-export new schemas from the schemas barrel

**Files:**
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Verify current barrel surface**

```bash
grep -nE "Pcd|Identity" packages/schemas/src/index.ts | head -15
```

Note existing pattern (e.g. `export * from "./pcd-identity.js";` or named re-exports).

- [ ] **Step 2: Add the SP6 schema re-exports**

If the barrel uses named re-exports (recommended pattern), append the SP6 names to the existing `export {}` from `./pcd-identity.js`. If the barrel uses `export *`, no edit is required — the new exports flow automatically. Either way, run a typecheck-only test (no test code change):

```bash
pnpm --filter @creativeagent/schemas typecheck
pnpm --filter @creativeagent/schemas build
```

If the barrel needs editing (named re-exports), modify it. Example named-export form to add (insert near other PCD exports):

```ts
export {
  PcdLifecycleRefusalReasonSchema,
  type PcdLifecycleRefusalReason,
  PcdApprovalAdvancementDecisionSchema,
  type PcdApprovalAdvancementDecision,
  PcdFinalExportDecisionSchema,
  type PcdFinalExportDecision,
  PcdMetaDraftDecisionSchema,
  type PcdMetaDraftDecision,
  PcdConsentRevocationPropagationResultSchema,
  type PcdConsentRevocationPropagationResult,
} from "./pcd-identity.js";
```

- [ ] **Step 3: Verify the surface is consumable from creative-pipeline**

Add a smoke import inside `packages/schemas/src/__tests__/pcd-identity-sp6.test.ts`:

```ts
import * as schemasIndex from "../index.js";

describe("schemas barrel — SP6 surface", () => {
  it("re-exports all SP6 names", () => {
    expect(schemasIndex.PcdLifecycleRefusalReasonSchema).toBeDefined();
    expect(schemasIndex.PcdApprovalAdvancementDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdFinalExportDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdMetaDraftDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdConsentRevocationPropagationResultSchema).toBeDefined();
  });
});
```

- [ ] **Step 4: Run schemas tests**

```bash
pnpm --filter @creativeagent/schemas test
pnpm --filter @creativeagent/schemas typecheck
```

Expected: all schemas tests pass; typecheck clean.

- [ ] **Step 5: Commit (only if barrel was edited; otherwise fold into Task 2's commit)**

```bash
git add packages/schemas/src/index.ts \
        packages/schemas/src/__tests__/pcd-identity-sp6.test.ts
git commit -m "$(cat <<'EOF'
chore(schemas): SP6 — re-export lifecycle-gate decision schemas from barrel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `AssetRecord.consentRevokedAfterGeneration` Prisma column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:138` (the `AssetRecord` model)
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_asset_record_consent_revoked_sp6/migration.sql`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Locate the `AssetRecord` model (line ~112). Add a new field alongside `approvalState`:

```prisma
  approvalState                  String   @default("pending")
  lockedDerivativeOf             String?
  // SP6: flagged true by propagateConsentRevocation when ConsentRecord linked
  // via PcdIdentitySnapshot.consentRecordId is revoked. Non-null with default
  // false; historical rows are well-defined without backfill.
  consentRevokedAfterGeneration  Boolean  @default(false)

  createdAt                      DateTime @default(now())
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/db
DATABASE_URL=postgresql://localhost:5432/scratch_sp6 \
  pnpm prisma migrate dev --create-only --name pcd_asset_record_consent_revoked_sp6
```

Inspect generated `migration.sql`. Expected content:

```sql
-- AlterTable
ALTER TABLE "AssetRecord" ADD COLUMN "consentRevokedAfterGeneration" BOOLEAN NOT NULL DEFAULT false;
```

If extra DDL appears (drift detection), reconcile by re-running `pnpm db:check-drift` from the repo root and resolving any drift before retrying. The expected SP6 diff is one line.

- [ ] **Step 3: Verify the migration applies cleanly to a fresh DB**

```bash
cd ~/creativeagent
DATABASE_URL=postgresql://localhost:5432/scratch_sp6_apply \
  pnpm --filter @creativeagent/db exec prisma migrate reset --force --skip-seed
```

Expected: all 5 prior migrations + the new SP6 migration apply without error. (If no Postgres is available locally, document the expected SQL in the commit message and defer the apply check to CI; SP5 followed this fallback per its baseline.)

- [ ] **Step 4: Regenerate the Prisma client and typecheck the db package**

```bash
pnpm --filter @creativeagent/db exec prisma generate
pnpm --filter @creativeagent/db typecheck
pnpm --filter @creativeagent/db build
```

Expected: typecheck clean; the generated `AssetRecord` type now includes `consentRevokedAfterGeneration: boolean`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/<timestamp>_pcd_asset_record_consent_revoked_sp6/
git commit -m "$(cat <<'EOF'
feat(db): SP6 — AssetRecord.consentRevokedAfterGeneration column + migration

Single non-null Boolean @default(false). Historical rows are well-defined
without backfill. Propagation (Task 18) is the only writer at runtime.
Migration is purely additive: ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT
false. No FK loosening, no rename, no follow-up null→non-null migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Promote and widen `InvariantViolationError`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/invariant-violation-error.ts`
- Create: `packages/creative-pipeline/src/pcd/invariant-violation-error.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.ts` (remove local class, import from new file)
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` (update import only — no test changes)
- Modify: `packages/creative-pipeline/src/index.ts` (re-export from new path; keep the old re-export for backwards compatibility)

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/invariant-violation-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InvariantViolationError } from "./invariant-violation-error.js";

describe("InvariantViolationError", () => {
  it("constructs with reason + context", () => {
    const err = new InvariantViolationError("snapshot referenced missing consent record", {
      assetRecordId: "asset_1",
      consentRecordId: "consent_1",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvariantViolationError");
    expect(err.message).toBe("snapshot referenced missing consent record");
    expect(err.context).toEqual({ assetRecordId: "asset_1", consentRecordId: "consent_1" });
  });

  it("constructs with reason only (no context)", () => {
    const err = new InvariantViolationError("required field missing");
    expect(err.message).toBe("required field missing");
    expect(err.context).toEqual({});
  });

  it("preserves backwards-compat (jobId, fieldName) constructor for SP3/SP4 callers", () => {
    const err = new InvariantViolationError("job_xyz", "productTierAtResolution");
    expect(err.message).toContain("job_xyz");
    expect(err.message).toContain("productTierAtResolution");
    expect(err.context).toEqual({ jobId: "job_xyz", fieldName: "productTierAtResolution" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- invariant-violation-error
```

Expected: FAIL with `Cannot find module './invariant-violation-error.js'`.

- [ ] **Step 3: Read the existing class to capture its current shape**

```bash
sed -n '1,40p' ~/creativeagent/packages/creative-pipeline/src/pcd/registry-resolver.ts
```

Note the existing constructor signature `(jobId, fieldName)` so the migration preserves SP3/SP4 callers.

- [ ] **Step 4: Create `packages/creative-pipeline/src/pcd/invariant-violation-error.ts`**

```ts
/**
 * Thrown when invariant state is violated — a row that should always exist is
 * missing, a stamped tier is out of range, etc. Two construction shapes are
 * supported:
 *
 *   new InvariantViolationError("reason", { ...context })   // SP6+ generic
 *   new InvariantViolationError(jobId, fieldName)            // SP3/SP4 legacy
 *
 * Both forms populate `message` and `context`. The legacy form is preserved so
 * existing call sites in registry-resolver.ts and provider-router.ts do not
 * change behavior. New SP6 call sites should use the generic form.
 */
export class InvariantViolationError extends Error {
  readonly name = "InvariantViolationError";
  readonly context: Readonly<Record<string, unknown>>;

  constructor(reason: string, context?: Record<string, unknown>);
  constructor(jobId: string, fieldName: string);
  constructor(arg1: string, arg2?: string | Record<string, unknown>) {
    if (typeof arg2 === "string") {
      // Legacy (jobId, fieldName) form
      super(`InvariantViolationError: job=${arg1} field=${arg2}`);
      this.context = Object.freeze({ jobId: arg1, fieldName: arg2 });
    } else {
      // Generic (reason, context?) form
      super(arg1);
      this.context = Object.freeze({ ...(arg2 ?? {}) });
    }
    Object.setPrototypeOf(this, InvariantViolationError.prototype);
  }
}
```

- [ ] **Step 5: Run the new test**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- invariant-violation-error
```

Expected: 3 tests pass.

- [ ] **Step 6: Update `registry-resolver.ts` to import from the new file**

Edit `packages/creative-pipeline/src/pcd/registry-resolver.ts` lines 9–18 (the local `InvariantViolationError` class). Replace the class declaration with:

```ts
import { InvariantViolationError } from "./invariant-violation-error.js";
```

Re-export it from the same file so external imports keep working:

```ts
export { InvariantViolationError } from "./invariant-violation-error.js";
```

(Place the re-export near the existing top-of-file exports.)

- [ ] **Step 7: Update `registry-resolver.test.ts` import**

If the test file imports `InvariantViolationError` from `./registry-resolver.js` (line 10 per current source), no change required — the re-export keeps it valid. If you prefer, update the import to point at the new module directly. Both forms work.

- [ ] **Step 8: Run the full creative-pipeline test suite**

```bash
pnpm --filter @creativeagent/creative-pipeline test
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all SP3/SP4/SP5 tests still pass; new InvariantViolationError tests pass.

- [ ] **Step 9: Re-export from creative-pipeline barrel (optional now; folded into Task 21 final re-export pass)**

Skip until Task 21.

- [ ] **Step 10: Commit**

```bash
git add packages/creative-pipeline/src/pcd/invariant-violation-error.ts \
        packages/creative-pipeline/src/pcd/invariant-violation-error.test.ts \
        packages/creative-pipeline/src/pcd/registry-resolver.ts
git commit -m "$(cat <<'EOF'
refactor(pcd): SP6 — promote InvariantViolationError to its own file

Widens the constructor to accept (reason, context?) for SP6 generic use cases
("snapshot references missing consent record", etc.) while preserving the
legacy (jobId, fieldName) form via constructor overload for SP3/SP4 callers.
No behavior change for existing call sites — registry-resolver.ts re-exports
the class to keep its public surface intact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `PCD_APPROVAL_LIFECYCLE_VERSION` and `PCD_CONSENT_REVOCATION_VERSION` constants

**Files:**
- Create: `packages/creative-pipeline/src/pcd/approval-lifecycle-version.ts`
- Create: `packages/creative-pipeline/src/pcd/consent-revocation-version.ts`
- Test: `packages/creative-pipeline/src/pcd/lifecycle-versions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/lifecycle-versions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";

describe("SP6 lifecycle version constants", () => {
  it("PCD_APPROVAL_LIFECYCLE_VERSION is the locked 1.0.0 string", () => {
    expect(PCD_APPROVAL_LIFECYCLE_VERSION).toBe("approval-lifecycle@1.0.0");
  });

  it("PCD_CONSENT_REVOCATION_VERSION is the locked 1.0.0 string", () => {
    expect(PCD_CONSENT_REVOCATION_VERSION).toBe("consent-revocation@1.0.0");
  });

  it("constants are non-empty strings (defensive)", () => {
    expect(typeof PCD_APPROVAL_LIFECYCLE_VERSION).toBe("string");
    expect(PCD_APPROVAL_LIFECYCLE_VERSION.length).toBeGreaterThan(0);
    expect(typeof PCD_CONSENT_REVOCATION_VERSION).toBe("string");
    expect(PCD_CONSENT_REVOCATION_VERSION.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- lifecycle-versions
```

Expected: FAIL with `Cannot find module './approval-lifecycle-version.js'`.

- [ ] **Step 3: Create `approval-lifecycle-version.ts`**

```ts
// SP6 — pinned by decidePcdApprovalAdvancement, decidePcdFinalExportGate,
// decidePcdMetaDraftGate. Caller cannot override; the gate functions import
// this constant and stamp it on every decision struct they emit.
export const PCD_APPROVAL_LIFECYCLE_VERSION = "approval-lifecycle@1.0.0";
```

- [ ] **Step 4: Create `consent-revocation-version.ts`**

```ts
// SP6 — pinned by propagateConsentRevocation. Separate constant from
// PCD_APPROVAL_LIFECYCLE_VERSION because revocation propagation is a sweep
// with side effects, not a decision; the two surfaces evolve independently.
export const PCD_CONSENT_REVOCATION_VERSION = "consent-revocation@1.0.0";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- lifecycle-versions
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/approval-lifecycle-version.ts \
        packages/creative-pipeline/src/pcd/consent-revocation-version.ts \
        packages/creative-pipeline/src/pcd/lifecycle-versions.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — add lifecycle and revocation version constants

PCD_APPROVAL_LIFECYCLE_VERSION="approval-lifecycle@1.0.0" pinned by the three
lifecycle decision gates. PCD_CONSENT_REVOCATION_VERSION="consent-revocation
@1.0.0" pinned by the propagation function. Sibling files matching the
SP3/SP5 pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add `ConsentRevokedRefusalError`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/consent-revocation-error.ts`
- Test: `packages/creative-pipeline/src/pcd/consent-revocation-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/consent-revocation-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";

describe("ConsentRevokedRefusalError", () => {
  it("constructs from generation pre-check (creatorIdentityId form)", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: new Date("2026-04-29T10:00:00Z"),
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentRevokedRefusalError");
    expect(err.creatorIdentityId).toBe("creator_1");
    expect(err.priorAssetRecordId).toBeNull();
    expect(err.consentRecordId).toBe("consent_1");
    expect(err.revokedAt).toEqual(new Date("2026-04-29T10:00:00Z"));
  });

  it("constructs from edit pre-check (priorAssetRecordId form)", () => {
    const err = new ConsentRevokedRefusalError({
      priorAssetRecordId: "asset_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    expect(err.creatorIdentityId).toBeNull();
    expect(err.priorAssetRecordId).toBe("asset_1");
    expect(err.consentRecordId).toBe("consent_1");
    expect(err.revokedAt).toBeNull();
  });

  it("message identifies the refusal kind", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    expect(err.message.toLowerCase()).toContain("consent");
    expect(err.message.toLowerCase()).toContain("revoked");
  });

  it("never echoes ConsentRecord PII (no personName, no scopeOfUse)", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    const json = JSON.stringify({
      message: err.message,
      creatorIdentityId: err.creatorIdentityId,
      priorAssetRecordId: err.priorAssetRecordId,
      consentRecordId: err.consentRecordId,
      revokedAt: err.revokedAt,
    });
    expect(json).not.toMatch(/personName/i);
    expect(json).not.toMatch(/scopeOfUse/i);
    expect(json).not.toMatch(/territory/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-revocation-error
```

Expected: FAIL.

- [ ] **Step 3: Create `consent-revocation-error.ts`**

```ts
/**
 * Thrown by SP6 consent pre-checks (assertConsentNotRevokedForGeneration and
 * assertConsentNotRevokedForEdit) when the bound ConsentRecord is revoked.
 * Carries identifiers only — never PII fields like personName or scopeOfUse.
 *
 * Two call sites (generation vs edit) populate different fields:
 *   - generation pre-check sets creatorIdentityId, leaves priorAssetRecordId null
 *   - edit pre-check sets priorAssetRecordId, leaves creatorIdentityId null
 */
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
  }) {
    const subject =
      args.creatorIdentityId !== undefined
        ? `creatorIdentityId=${args.creatorIdentityId}`
        : `priorAssetRecordId=${args.priorAssetRecordId ?? "?"}`;
    super(`Consent revoked: ${subject} consentRecordId=${args.consentRecordId}`);
    this.creatorIdentityId = args.creatorIdentityId ?? null;
    this.priorAssetRecordId = args.priorAssetRecordId ?? null;
    this.consentRecordId = args.consentRecordId;
    this.revokedAt = args.revokedAt;
    Object.setPrototypeOf(this, ConsentRevokedRefusalError.prototype);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-revocation-error
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/consent-revocation-error.ts \
        packages/creative-pipeline/src/pcd/consent-revocation-error.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — ConsentRevokedRefusalError

Shared error type for both consent pre-checks (generation and edit). Carries
identifiers only — no PII (personName, scopeOfUse, territory). Different
construction shapes for the two call sites; both populate consentRecordId and
revokedAt for forensic logging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add `lifecycle-readers.ts` (six narrow reader interfaces)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/lifecycle-readers.ts`
- Test: `packages/creative-pipeline/src/pcd/lifecycle-readers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/lifecycle-readers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  AssetRecordReader,
  ProductQcResultReader,
  PcdIdentitySnapshotReader,
  ConsentRecordReader,
  CreativeJobReader,
  CreatorIdentityReader,
} from "./lifecycle-readers.js";

describe("lifecycle-readers — type contracts", () => {
  it("AssetRecordReader has the documented method signature", () => {
    const reader: AssetRecordReader = {
      async findById(_id) {
        return { id: "x", jobId: "j", creatorId: null, approvalState: "pending" };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("ProductQcResultReader narrows to passFail-only fields", () => {
    const reader: ProductQcResultReader = {
      async findByAssetRecordId(_id) {
        return { assetRecordId: "x", passFail: "pass" as const };
      },
    };
    expect(reader.findByAssetRecordId).toBeDefined();
  });

  it("PcdIdentitySnapshotReader returns consent-relevant fields", () => {
    const reader: PcdIdentitySnapshotReader = {
      async findByAssetRecordId(_id) {
        return { assetRecordId: "x", creatorIdentityId: "c", consentRecordId: null };
      },
    };
    expect(reader.findByAssetRecordId).toBeDefined();
  });

  it("ConsentRecordReader returns revocation status only", () => {
    const reader: ConsentRecordReader = {
      async findById(_id) {
        return { id: "x", revoked: false, revokedAt: null };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("CreativeJobReader returns effectiveTier (number | null)", () => {
    const reader: CreativeJobReader = {
      async findById(_id) {
        return { id: "x", effectiveTier: 2 };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("CreatorIdentityReader returns consentRecordId binding", () => {
    const reader: CreatorIdentityReader = {
      async findById(_id) {
        return { id: "x", consentRecordId: null };
      },
    };
    expect(reader.findById).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- lifecycle-readers
```

Expected: FAIL.

- [ ] **Step 3: Create `lifecycle-readers.ts`**

```ts
/**
 * Six narrow read-only store reader interfaces consumed by SP6 lifecycle
 * gates. Each returns only the fields the gates require — no full row shape,
 * no PII echoes. Concrete Prisma adapters live in packages/db/src/stores/.
 *
 * SP6 gates assemble store bundles from these interfaces (e.g. the
 * final-export gate takes a 5-field store bundle: AssetRecordReader,
 * ProductQcResultReader, PcdIdentitySnapshotReader, ConsentRecordReader,
 * CreativeJobReader, ExportGateState).
 */

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

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- lifecycle-readers
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/lifecycle-readers.ts \
        packages/creative-pipeline/src/pcd/lifecycle-readers.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — six narrow lifecycle reader interfaces

AssetRecordReader, ProductQcResultReader, PcdIdentitySnapshotReader,
ConsentRecordReader, CreativeJobReader, CreatorIdentityReader. Each returns
the minimum fields the gates need. Concrete Prisma adapters land in
packages/db/src/stores/ in Task 19.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add `ExportGateState` interface + `AlwaysOpenExportGateState`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/export-gate-state.ts`
- Create: `packages/creative-pipeline/src/pcd/export-gate-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/export-gate-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AlwaysOpenExportGateState,
  type ExportGateOpenness,
  type ExportGateState,
} from "./export-gate-state.js";

describe("ExportGateState type contract", () => {
  it("supports the open: true variant", () => {
    const state: ExportGateOpenness = { open: true };
    expect(state.open).toBe(true);
  });

  it("supports the open: false + reason variant", () => {
    const state: ExportGateOpenness = { open: false, reason: "embargo" };
    expect(state.open).toBe(false);
    if (state.open === false) {
      expect(state.reason).toBe("embargo");
    }
  });
});

describe("AlwaysOpenExportGateState", () => {
  it("returns open: true for any asset id", async () => {
    const gate: ExportGateState = new AlwaysOpenExportGateState();
    expect(await gate.isOpen("asset_1")).toEqual({ open: true });
    expect(await gate.isOpen("asset_999")).toEqual({ open: true });
  });

  it("does not throw on empty string id", async () => {
    const gate = new AlwaysOpenExportGateState();
    await expect(gate.isOpen("")).resolves.toEqual({ open: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- export-gate-state
```

Expected: FAIL.

- [ ] **Step 3: Create `export-gate-state.ts`**

```ts
/**
 * SP6 merge-back seam — future Switchboard ExportLifecycle.
 *
 * The final-export gate consults this interface as the fourth orthogonal
 * state ("export gate open?") alongside tier, approval, and QC. The default
 * in-tree implementer always returns open; merge-back replaces it with an
 * adapter over Switchboard's ExportLifecycle.
 *
 * // MERGE-BACK: replace AlwaysOpenExportGateState with Switchboard
 * ExportLifecycle adapter at production wiring time.
 */

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

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- export-gate-state
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/export-gate-state.ts \
        packages/creative-pipeline/src/pcd/export-gate-state.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — ExportGateState interface + AlwaysOpenExportGateState

Future Switchboard ExportLifecycle merge-back seam. Default in-tree
implementer returns { open: true } unconditionally; the // MERGE-BACK marker
on the class indicates production wiring will replace this with an
ExportLifecycle adapter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add `ComplianceCheck` interface + `AlwaysPassComplianceCheck`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/compliance-check.ts`
- Create: `packages/creative-pipeline/src/pcd/compliance-check.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/compliance-check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./compliance-check.js";

describe("ComplianceCheck type contract", () => {
  it("supports the pass: true variant", () => {
    const r: ComplianceCheckResult = { pass: true };
    expect(r.pass).toBe(true);
  });

  it("supports the pass: false + reason variant", () => {
    const r: ComplianceCheckResult = { pass: false, reason: "ftc_disclosure_missing" };
    expect(r.pass).toBe(false);
    if (r.pass === false) {
      expect(r.reason).toBe("ftc_disclosure_missing");
    }
  });
});

describe("ComplianceCheckInput", () => {
  it("permits effectiveTier: null (per SP6 type-boundary normalization)", () => {
    const input: ComplianceCheckInput = {
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: null,
    };
    expect(input.effectiveTier).toBeNull();
  });

  it("permits effectiveTier: 1 | 2 | 3", () => {
    const input: ComplianceCheckInput = {
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    };
    expect(input.effectiveTier).toBe(2);
  });
});

describe("AlwaysPassComplianceCheck", () => {
  it("returns exactly { pass: true } — no reason field", async () => {
    const check: ComplianceCheck = new AlwaysPassComplianceCheck();
    const result = await check.checkMetaDraftCompliance({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    });
    expect(result).toEqual({ pass: true });
    expect(JSON.stringify(result)).not.toContain("reason");
  });

  it("ignores effectiveTier (returns pass: true even when null)", async () => {
    const check = new AlwaysPassComplianceCheck();
    const result = await check.checkMetaDraftCompliance({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: null,
    });
    expect(result).toEqual({ pass: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compliance-check
```

Expected: FAIL.

- [ ] **Step 3: Create `compliance-check.ts`**

```ts
import type { IdentityTier, PcdShotType } from "@creativeagent/schemas";

/**
 * SP6 merge-back seam — future Switchboard FTC-disclosure / Meta-draft
 * compliance pipeline.
 *
 * The Meta-draft gate genuinely invokes this interface (anti-pattern grep
 * test in Task 20 enforces). The default in-tree implementer always passes;
 * merge-back replaces it with the real check.
 *
 * // MERGE-BACK: replace AlwaysPassComplianceCheck with real FTC-disclosure /
 * Meta-draft compliance pipeline at production wiring time.
 */

export type ComplianceCheckInput = {
  assetRecordId: string;
  shotType: PcdShotType;
  // Widened to allow null because the Meta-draft gate must call ComplianceCheck
  // even when CreativeJob.effectiveTier is null. Real implementers may treat
  // null as a refusal reason; the in-tree default ignores tier.
  effectiveTier: IdentityTier | null;
  // Future merge-back fields: scriptClaimsPath, testimonialFlags, voiceConsentRecordId.
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

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compliance-check
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 5 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/compliance-check.ts \
        packages/creative-pipeline/src/pcd/compliance-check.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — ComplianceCheck interface + AlwaysPassComplianceCheck

Future FTC-disclosure / Meta-draft compliance merge-back seam. ComplianceCheckInput
.effectiveTier is IdentityTier | null per the type-boundary-normalization rule
in the SP6 design — the Meta-draft gate must call this interface even when
CreativeJob.effectiveTier is missing. Default in-tree implementer returns
{ pass: true } and contains no reason field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Build `decidePcdApprovalAdvancement`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/approval-advancement.ts`
- Create: `packages/creative-pipeline/src/pcd/approval-advancement.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/creative-pipeline/src/pcd/approval-advancement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { decidePcdApprovalAdvancement } from "./approval-advancement.js";
import type {
  AssetRecordReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";

const makeAssetReader = (
  row: Awaited<ReturnType<AssetRecordReader["findById"]>> | null,
): AssetRecordReader => ({
  async findById() {
    return row;
  },
});

const makeQcReader = (
  row: Awaited<ReturnType<ProductQcResultReader["findByAssetRecordId"]>> | null,
): ProductQcResultReader => ({
  async findByAssetRecordId() {
    return row;
  },
});

const baseAsset = {
  id: "asset_1",
  jobId: "job_1",
  creatorId: "creator_1",
  approvalState: "pending",
};

describe("decidePcdApprovalAdvancement", () => {
  it("allows when QC passFail === pass", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.proposedApprovalState).toBe("approved");
    expect(decision.qcPassFail).toBe("pass");
    expect(decision.refusalReasons).toEqual([]);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on QC fail (SP5 step 5 hard-block closure)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "fail" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.proposedApprovalState).toBe("rejected");
    expect(decision.refusalReasons).toEqual(["qc_failed"]);
  });

  it("refuses on QC warn (SP5 binding: not conclusively pass)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "warn" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["qc_not_conclusive"]);
  });

  it("refuses when QC row is missing (SP5 invariant: every PCD asset has a row)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader(null),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["qc_result_not_found"]);
    expect(decision.qcPassFail).toBeNull();
  });

  it("refuses when AssetRecord is missing", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(null),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["asset_not_found"]);
    expect(decision.currentApprovalState).toBe("");
    expect(decision.proposedApprovalState).toBe("rejected");
  });

  it("pins approvalLifecycleVersion from imports (caller cannot override)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- approval-advancement
```

Expected: FAIL with `Cannot find module './approval-advancement.js'`.

- [ ] **Step 3: Create `approval-advancement.ts`**

```ts
import type { PcdApprovalAdvancementDecision } from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { AssetRecordReader, ProductQcResultReader } from "./lifecycle-readers.js";

export type DecidePcdApprovalAdvancementInput = {
  assetRecordId: string;
};

export type DecidePcdApprovalAdvancementStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
};

/**
 * SP6 — refuses approval advancement unless SP5's persisted QC ledger row
 * passes. Closes the hard-block invariant step 5 SP5 deferred:
 * "label-visible without OCR match → approval refused."
 *
 * Refusal reasons (the only `if (passFail ===` branch in SP6 source):
 *   passFail === "fail" → qc_failed (SP5 step 5)
 *   passFail === "warn" → qc_not_conclusive (SP5 binding semantic)
 *
 * SP6 returns the decision struct only — does not mutate AssetRecord
 * approvalState. Mutation is wired at merge-back inside Switchboard's
 * ApprovalLifecycle after consuming this decision.
 *
 * // MERGE-BACK: emit WorkTrace here at the return statement, payload =
 * decision struct.
 */
export async function decidePcdApprovalAdvancement(
  input: DecidePcdApprovalAdvancementInput,
  stores: DecidePcdApprovalAdvancementStores,
): Promise<PcdApprovalAdvancementDecision> {
  const { assetRecordId } = input;
  const asset = await stores.assetRecordReader.findById(assetRecordId);

  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: "",
      proposedApprovalState: "rejected",
      qcPassFail: null,
      refusalReasons: ["asset_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  const qc = await stores.productQcResultReader.findByAssetRecordId(assetRecordId);

  if (qc === null) {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: null,
      refusalReasons: ["qc_result_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  // The single `if (passFail ===)` branch permitted in SP6 source — anti-pattern
  // grep test (Task 20) enforces this is the only one.
  if (qc.passFail === "fail") {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: "fail",
      refusalReasons: ["qc_failed"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  if (qc.passFail === "warn") {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: "warn",
      refusalReasons: ["qc_not_conclusive"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  // pass
  return {
    allowed: true,
    assetRecordId,
    currentApprovalState: asset.approvalState,
    proposedApprovalState: "approved",
    qcPassFail: "pass",
    refusalReasons: [],
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- approval-advancement
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/approval-advancement.ts \
        packages/creative-pipeline/src/pcd/approval-advancement.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — decidePcdApprovalAdvancement

Closes SP5's hard-block invariant step 5: refuses approval when persisted
ProductQcResult.passFail === "fail". Also refuses on "warn" (SP5 binding
semantic: warn is not conclusively pass). Pure store-injected; pins
PCD_APPROVAL_LIFECYCLE_VERSION from imports. Returns decision struct only —
does not mutate approvalState. // MERGE-BACK: WorkTrace emit at return.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Build `decidePcdFinalExportGate` (collect-all refusal reasons)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/final-export-gate.ts`
- Create: `packages/creative-pipeline/src/pcd/final-export-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/final-export-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { decidePcdFinalExportGate } from "./final-export-gate.js";
import { AlwaysOpenExportGateState, type ExportGateState } from "./export-gate-state.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";
import { InvariantViolationError } from "./invariant-violation-error.js";

const reader = <T>(row: T) => async () => row;

const baseAsset = { id: "asset_1", jobId: "job_1", creatorId: "creator_1", approvalState: "approved" };
const baseJob = { id: "job_1", effectiveTier: 2 as const };
const baseQc = { assetRecordId: "asset_1", passFail: "pass" as const };
const baseSnapshot = { assetRecordId: "asset_1", creatorIdentityId: "creator_1", consentRecordId: null };
const baseConsentNotRevoked = { id: "consent_1", revoked: false, revokedAt: null };
const closedExportGate: ExportGateState = {
  async isOpen() {
    return { open: false, reason: "embargo" };
  },
};

const stores = (overrides: {
  asset?: Awaited<ReturnType<AssetRecordReader["findById"]>> | null;
  job?: Awaited<ReturnType<CreativeJobReader["findById"]>> | null;
  qc?: Awaited<ReturnType<ProductQcResultReader["findByAssetRecordId"]>> | null;
  snapshot?: Awaited<ReturnType<PcdIdentitySnapshotReader["findByAssetRecordId"]>> | null;
  consent?: Awaited<ReturnType<ConsentRecordReader["findById"]>> | null;
  exportGateState?: ExportGateState;
}) => ({
  assetRecordReader: { findById: reader(overrides.asset ?? baseAsset) } as AssetRecordReader,
  productQcResultReader: { findByAssetRecordId: reader(overrides.qc ?? baseQc) } as ProductQcResultReader,
  pcdIdentitySnapshotReader: {
    findByAssetRecordId: reader(overrides.snapshot ?? baseSnapshot),
  } as PcdIdentitySnapshotReader,
  consentRecordReader: { findById: reader(overrides.consent ?? baseConsentNotRevoked) } as ConsentRecordReader,
  creativeJobReader: { findById: reader(overrides.job ?? baseJob) } as CreativeJobReader,
  exportGateState: overrides.exportGateState ?? new AlwaysOpenExportGateState(),
});

describe("decidePcdFinalExportGate", () => {
  it("allows when all four states aligned + consent OK", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({}));
    expect(d.allowed).toBe(true);
    expect(d.refusalReasons).toEqual([]);
    expect(d.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on tier_insufficient (effectiveTier=1, requiredTier=2)", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ job: { id: "job_1", effectiveTier: 1 } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on null effectiveTier (tier_insufficient)", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ job: { id: "job_1", effectiveTier: null } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBeNull();
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on approval_not_granted when approvalState=pending", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ asset: { ...baseAsset, approvalState: "pending" } }),
    );
    expect(d.refusalReasons).toContain("approval_not_granted");
  });

  it("refuses on qc_failed", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ qc: { assetRecordId: "asset_1", passFail: "fail" } }),
    );
    expect(d.refusalReasons).toContain("qc_failed");
  });

  it("refuses on qc_not_conclusive when passFail=warn", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ qc: { assetRecordId: "asset_1", passFail: "warn" } }),
    );
    expect(d.refusalReasons).toContain("qc_not_conclusive");
  });

  it("refuses on export_gate_closed", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ exportGateState: closedExportGate }),
    );
    expect(d.exportGateOpen).toBe(false);
    expect(d.refusalReasons).toContain("export_gate_closed");
  });

  it("refuses on consent_revoked", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
      }),
    );
    expect(d.consentRevoked).toBe(true);
    expect(d.refusalReasons).toContain("consent_revoked");
  });

  it("collect-all: tier + approval + qc + export-gate + consent all wrong → 5 reasons", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({
        asset: { ...baseAsset, approvalState: "pending" },
        job: { id: "job_1", effectiveTier: 1 },
        qc: { assetRecordId: "asset_1", passFail: "fail" },
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
        exportGateState: closedExportGate,
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toEqual(
      expect.arrayContaining([
        "tier_insufficient",
        "approval_not_granted",
        "qc_failed",
        "export_gate_closed",
        "consent_revoked",
      ]),
    );
    expect(d.refusalReasons).toHaveLength(5);
  });

  it("snapshot-null (non-PCD asset) → consentRevoked stays false", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ snapshot: null }),
    );
    expect(d.consentRevoked).toBe(false);
    expect(d.allowed).toBe(true);
  });

  it("AssetRecord missing → asset_not_found single-reason refusal", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ asset: null }));
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toEqual(["asset_not_found"]);
  });

  it("CreativeJob missing → creative_job_not_found", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ job: null }));
    expect(d.refusalReasons).toContain("creative_job_not_found");
  });

  it("QC row missing → qc_result_not_found", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ qc: null }));
    expect(d.refusalReasons).toContain("qc_result_not_found");
  });

  it("snapshot references missing ConsentRecord → throws InvariantViolationError", async () => {
    await expect(
      decidePcdFinalExportGate(
        { assetRecordId: "asset_1" },
        stores({
          snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
          consent: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("respects custom requiredTier", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1", requiredTier: 3 },
      stores({ job: { id: "job_1", effectiveTier: 2 } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- final-export-gate
```

Expected: FAIL.

- [ ] **Step 3: Create `final-export-gate.ts`**

```ts
import {
  IdentityTierSchema,
  type IdentityTier,
  type PcdFinalExportDecision,
  type PcdLifecycleRefusalReason,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { ExportGateState } from "./export-gate-state.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";

export type DecidePcdFinalExportGateInput = {
  assetRecordId: string;
  requiredTier?: IdentityTier;
};

export type DecidePcdFinalExportGateStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  exportGateState: ExportGateState;
};

/**
 * SP6 final-export gate. Refuses unless all four orthogonal states align:
 * tier ≥ requiredTier (default 2), approvalState === "approved",
 * passFail === "pass", ExportGateState.isOpen === true. Plus: refuses on
 * consent-revoked snapshots.
 *
 * Collect-all semantics: every refusal reason is recorded, no short-circuit.
 * An export decision is a forensic statement; multi-fail produces a multi-reason
 * payload so operators see the full state in one round trip.
 *
 * // MERGE-BACK: emit WorkTrace here at return statement, payload = decision.
 * // MERGE-BACK: legal-override path — when LegalOverrideRecord exists for
 * (assetRecordId, consentRecordId) with reason and approver, suppress the
 * consent_revoked reason. Today: refusal is the default.
 */
export async function decidePcdFinalExportGate(
  input: DecidePcdFinalExportGateInput,
  stores: DecidePcdFinalExportGateStores,
): Promise<PcdFinalExportDecision> {
  const { assetRecordId } = input;
  const requiredTier: IdentityTier = input.requiredTier ?? 2;

  const asset = await stores.assetRecordReader.findById(assetRecordId);
  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      effectiveTier: null,
      approvalState: null,
      qcPassFail: null,
      exportGateOpen: false,
      consentRevoked: false,
      refusalReasons: ["asset_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  const refusalReasons: PcdLifecycleRefusalReason[] = [];
  const job = await stores.creativeJobReader.findById(asset.jobId);
  let effectiveTier: IdentityTier | null = null;
  if (job === null) {
    refusalReasons.push("creative_job_not_found");
  } else if (job.effectiveTier === null) {
    refusalReasons.push("tier_insufficient");
  } else {
    const parsed = IdentityTierSchema.safeParse(job.effectiveTier);
    if (!parsed.success) {
      throw new InvariantViolationError("effectiveTier out of range", {
        jobId: job.id,
        value: job.effectiveTier,
      });
    }
    effectiveTier = parsed.data;
    if (effectiveTier < requiredTier) {
      refusalReasons.push("tier_insufficient");
    }
  }

  if (asset.approvalState !== "approved") {
    refusalReasons.push("approval_not_granted");
  }

  const qc = await stores.productQcResultReader.findByAssetRecordId(assetRecordId);
  let qcPassFail: PcdFinalExportDecision["qcPassFail"] = null;
  if (qc === null) {
    refusalReasons.push("qc_result_not_found");
  } else {
    qcPassFail = qc.passFail;
    if (qc.passFail === "fail") refusalReasons.push("qc_failed");
    else if (qc.passFail === "warn") refusalReasons.push("qc_not_conclusive");
  }

  const snapshot = await stores.pcdIdentitySnapshotReader.findByAssetRecordId(assetRecordId);
  let consentRevoked = false;
  if (snapshot !== null && snapshot.consentRecordId !== null) {
    const consent = await stores.consentRecordReader.findById(snapshot.consentRecordId);
    if (consent === null) {
      throw new InvariantViolationError(
        "consent record referenced by snapshot does not exist",
        { assetRecordId, consentRecordId: snapshot.consentRecordId },
      );
    }
    if (consent.revoked === true) {
      consentRevoked = true;
      // // MERGE-BACK: legal-override path — suppress this push when an
      // override exists for (assetRecordId, consentRecordId).
      refusalReasons.push("consent_revoked");
    }
  }

  const exportGate = await stores.exportGateState.isOpen(assetRecordId);
  const exportGateOpen = exportGate.open === true;
  if (!exportGateOpen) {
    refusalReasons.push("export_gate_closed");
  }

  return {
    allowed: refusalReasons.length === 0,
    assetRecordId,
    effectiveTier,
    approvalState: asset.approvalState,
    qcPassFail,
    exportGateOpen,
    consentRevoked,
    refusalReasons,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- final-export-gate
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 14 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/final-export-gate.ts \
        packages/creative-pipeline/src/pcd/final-export-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — decidePcdFinalExportGate (collect-all refusal reasons)

Four orthogonal states: tier ≥ required, approvalState === approved,
passFail === pass, ExportGateState.isOpen === true. Plus consent-revoked
refusal. Collect-all semantics — never short-circuit. Type-boundary normalizes
effectiveTier through IdentityTierSchema.safeParse; out-of-range throws
InvariantViolationError. Snapshot pointing to missing ConsentRecord throws
InvariantViolationError (corrupted state). // MERGE-BACK markers for
WorkTrace emit and legal-override suppression path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Build `decidePcdMetaDraftGate` (genuinely invokes ComplianceCheck)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/meta-draft-gate.ts`
- Create: `packages/creative-pipeline/src/pcd/meta-draft-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/meta-draft-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PcdShotType } from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./compliance-check.js";
import { decidePcdMetaDraftGate } from "./meta-draft-gate.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
} from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

const baseAsset = { id: "asset_1", jobId: "job_1", creatorId: "creator_1", approvalState: "approved" };
const baseJob = { id: "job_1", effectiveTier: 2 as const };
const baseSnapshot = { assetRecordId: "asset_1", creatorIdentityId: "creator_1", consentRecordId: null };

class SpyComplianceCheck implements ComplianceCheck {
  calls: ComplianceCheckInput[] = [];
  constructor(private result: ComplianceCheckResult = { pass: true }) {}
  async checkMetaDraftCompliance(input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
    this.calls.push(input);
    return this.result;
  }
}

const stores = (overrides: {
  asset?: Awaited<ReturnType<AssetRecordReader["findById"]>> | null;
  job?: Awaited<ReturnType<CreativeJobReader["findById"]>> | null;
  snapshot?: Awaited<ReturnType<PcdIdentitySnapshotReader["findByAssetRecordId"]>> | null;
  consent?: Awaited<ReturnType<ConsentRecordReader["findById"]>> | null;
  complianceCheck?: ComplianceCheck;
}) => ({
  assetRecordReader: { findById: reader(overrides.asset ?? baseAsset) } as AssetRecordReader,
  pcdIdentitySnapshotReader: {
    findByAssetRecordId: reader(overrides.snapshot ?? baseSnapshot),
  } as PcdIdentitySnapshotReader,
  consentRecordReader: {
    findById: reader(overrides.consent ?? { id: "consent_1", revoked: false, revokedAt: null }),
  } as ConsentRecordReader,
  creativeJobReader: { findById: reader(overrides.job ?? baseJob) } as CreativeJobReader,
  complianceCheck: overrides.complianceCheck ?? new AlwaysPassComplianceCheck(),
});

describe("decidePcdMetaDraftGate", () => {
  const shotType: PcdShotType = "talking_head";

  it("allows when tier ≥ 2 + approved + compliance pass + consent OK", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({}));
    expect(d.allowed).toBe(true);
    expect(d.refusalReasons).toEqual([]);
    expect(d.complianceCheckPassed).toBe(true);
    expect(d.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on tier_insufficient at Tier 1", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: 1 } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on null effectiveTier", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: null } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on approval_not_granted", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ asset: { ...baseAsset, approvalState: "pending" } }),
    );
    expect(d.refusalReasons).toContain("approval_not_granted");
  });

  it("refuses on consent_revoked", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
      }),
    );
    expect(d.consentRevoked).toBe(true);
    expect(d.refusalReasons).toContain("consent_revoked");
  });

  it("refuses on compliance_check_failed", async () => {
    const spy = new SpyComplianceCheck({ pass: false, reason: "ftc_disclosure_missing" });
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ complianceCheck: spy }),
    );
    expect(d.complianceCheckPassed).toBe(false);
    expect(d.refusalReasons).toContain("compliance_check_failed");
  });

  it("ALWAYS invokes complianceCheck (even on happy-path allow)", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ complianceCheck: spy }),
    );
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toEqual({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    });
  });

  it("ALWAYS invokes complianceCheck even when other refusal reasons exist", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({
        asset: { ...baseAsset, approvalState: "pending" },
        job: { id: "job_1", effectiveTier: 1 },
        complianceCheck: spy,
      }),
    );
    expect(spy.calls).toHaveLength(1);
  });

  it("passes effectiveTier: null to ComplianceCheck when CreativeJob.effectiveTier is null", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: null }, complianceCheck: spy }),
    );
    expect(spy.calls[0]?.effectiveTier).toBeNull();
  });

  it("snapshot referencing missing ConsentRecord → throws InvariantViolationError", async () => {
    await expect(
      decidePcdMetaDraftGate(
        { assetRecordId: "asset_1", shotType },
        stores({
          snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
          consent: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("AssetRecord missing → asset_not_found single refusal", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({ asset: null }));
    expect(d.refusalReasons).toEqual(["asset_not_found"]);
  });

  it("CreativeJob missing → creative_job_not_found", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({ job: null }));
    expect(d.refusalReasons).toContain("creative_job_not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- meta-draft-gate
```

Expected: FAIL.

- [ ] **Step 3: Create `meta-draft-gate.ts`**

```ts
import {
  IdentityTierSchema,
  type IdentityTier,
  type PcdLifecycleRefusalReason,
  type PcdMetaDraftDecision,
  type PcdShotType,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { ComplianceCheck } from "./compliance-check.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
} from "./lifecycle-readers.js";

export type DecidePcdMetaDraftGateInput = {
  assetRecordId: string;
  shotType: PcdShotType;
};

export type DecidePcdMetaDraftGateStores = {
  assetRecordReader: AssetRecordReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  complianceCheck: ComplianceCheck;
};

/**
 * SP6 Meta-draft gate. Refuses unless effectiveTier ≥ 2 + approvalState ===
 * approved + ComplianceCheck.checkMetaDraftCompliance returns { pass: true } +
 * snapshot's ConsentRecord is not revoked.
 *
 * Does NOT re-check QC: approval already implies QC passed (the approval gate
 * refuses on QC fail/warn). Re-checking would create a duplicate source of
 * truth and potential drift.
 *
 * The Meta-draft gate ALWAYS invokes complianceCheck.checkMetaDraftCompliance —
 * even when other refusal reasons are already present, even when effectiveTier
 * is null. Anti-pattern grep test (Task 20) enforces this is not invisible
 * theater. ComplianceCheck is the merge-back seam for real FTC-disclosure logic.
 *
 * // MERGE-BACK: emit WorkTrace here at return statement.
 */
export async function decidePcdMetaDraftGate(
  input: DecidePcdMetaDraftGateInput,
  stores: DecidePcdMetaDraftGateStores,
): Promise<PcdMetaDraftDecision> {
  const { assetRecordId, shotType } = input;
  const requiredTier: IdentityTier = 2;

  const asset = await stores.assetRecordReader.findById(assetRecordId);
  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      effectiveTier: null,
      approvalState: null,
      complianceCheckPassed: false,
      consentRevoked: false,
      refusalReasons: ["asset_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  const refusalReasons: PcdLifecycleRefusalReason[] = [];
  const job = await stores.creativeJobReader.findById(asset.jobId);
  let effectiveTier: IdentityTier | null = null;
  if (job === null) {
    refusalReasons.push("creative_job_not_found");
  } else if (job.effectiveTier === null) {
    refusalReasons.push("tier_insufficient");
  } else {
    const parsed = IdentityTierSchema.safeParse(job.effectiveTier);
    if (!parsed.success) {
      throw new InvariantViolationError("effectiveTier out of range", {
        jobId: job.id,
        value: job.effectiveTier,
      });
    }
    effectiveTier = parsed.data;
    if (effectiveTier < requiredTier) {
      refusalReasons.push("tier_insufficient");
    }
  }

  if (asset.approvalState !== "approved") {
    refusalReasons.push("approval_not_granted");
  }

  const snapshot = await stores.pcdIdentitySnapshotReader.findByAssetRecordId(assetRecordId);
  let consentRevoked = false;
  if (snapshot !== null && snapshot.consentRecordId !== null) {
    const consent = await stores.consentRecordReader.findById(snapshot.consentRecordId);
    if (consent === null) {
      throw new InvariantViolationError(
        "consent record referenced by snapshot does not exist",
        { assetRecordId, consentRecordId: snapshot.consentRecordId },
      );
    }
    if (consent.revoked === true) {
      consentRevoked = true;
      refusalReasons.push("consent_revoked");
    }
  }

  // ALWAYS invoke ComplianceCheck — preserves the merge-back seam regardless
  // of other refusal state. Anti-pattern grep test enforces the literal
  // `complianceCheck.checkMetaDraftCompliance(` token in this source.
  const complianceResult = await stores.complianceCheck.checkMetaDraftCompliance({
    assetRecordId,
    shotType,
    effectiveTier,
  });
  const complianceCheckPassed = complianceResult.pass === true;
  if (!complianceCheckPassed) {
    refusalReasons.push("compliance_check_failed");
  }

  return {
    allowed: refusalReasons.length === 0,
    assetRecordId,
    effectiveTier,
    approvalState: asset.approvalState,
    complianceCheckPassed,
    consentRevoked,
    refusalReasons,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- meta-draft-gate
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 12 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/meta-draft-gate.ts \
        packages/creative-pipeline/src/pcd/meta-draft-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — decidePcdMetaDraftGate (genuinely invokes ComplianceCheck)

Tier ≥ 2 + approval + ComplianceCheck.pass + non-revoked consent. Does NOT
re-check QC (approval already absorbed it). ALWAYS calls ComplianceCheck —
even when other refusal reasons exist, even when effectiveTier is null —
preserving the merge-back seam. Type-boundary normalizes effectiveTier through
IdentityTierSchema.safeParse. Snapshot pointing to missing ConsentRecord
throws InvariantViolationError.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Build `propagateConsentRevocation` (idempotent, sorted output)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/consent-revocation.ts`
- Create: `packages/creative-pipeline/src/pcd/consent-revocation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/consent-revocation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";
import {
  propagateConsentRevocation,
  type ConsentRevocationStore,
} from "./consent-revocation.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader } from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

class MemoryConsentRevocationStore implements ConsentRevocationStore {
  constructor(
    private byConsent: Map<string, string[]>,
    private flagged: Set<string> = new Set(),
  ) {}
  async findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]> {
    return [...(this.byConsent.get(consentRecordId) ?? [])].sort();
  }
  async markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }> {
    const newly: string[] = [];
    const already: string[] = [];
    for (const id of assetRecordIds) {
      if (this.flagged.has(id)) already.push(id);
      else {
        this.flagged.add(id);
        newly.push(id);
      }
    }
    return { newlyFlagged: newly.sort(), alreadyFlagged: already.sort() };
  }
}

const revokedConsent = (id: string) => ({ id, revoked: true, revokedAt: new Date("2026-04-29T00:00:00Z") });

describe("propagateConsentRevocation", () => {
  it("flags all matching assets when none yet flagged", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", ["a3", "a1", "a2"]]]));
    const result = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(result.consentRecordId).toBe("consent_1");
    expect(result.assetIdsFlagged).toEqual(["a1", "a2", "a3"]);
    expect(result.assetIdsAlreadyFlagged).toEqual([]);
    expect(result.consentRevocationVersion).toBe(PCD_CONSENT_REVOCATION_VERSION);
  });

  it("partitions newly-flagged vs already-flagged", async () => {
    const store = new MemoryConsentRevocationStore(
      new Map([["consent_1", ["a1", "a2", "a3"]]]),
      new Set(["a1", "a3"]),
    );
    const result = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(result.assetIdsFlagged).toEqual(["a2"]);
    expect(result.assetIdsAlreadyFlagged).toEqual(["a1", "a3"]);
  });

  it("is idempotent (second run flags zero, repeats already-flagged set)", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", ["a1", "a2"]]]));
    await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    const second = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(second.assetIdsFlagged).toEqual([]);
    expect(second.assetIdsAlreadyFlagged).toEqual(["a1", "a2"]);
  });

  it("returns sorted ids in both partitions", async () => {
    const store = new MemoryConsentRevocationStore(
      new Map([["consent_1", ["az", "ab", "aa"]]]),
      new Set(["az"]),
    );
    const r = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(r.assetIdsFlagged).toEqual(["aa", "ab"]);
    expect(r.assetIdsAlreadyFlagged).toEqual(["az"]);
  });

  it("empty matching set produces empty result (no error)", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", []]]));
    const r = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(r.assetIdsFlagged).toEqual([]);
    expect(r.assetIdsAlreadyFlagged).toEqual([]);
  });

  it("throws InvariantViolationError when ConsentRecord is missing", async () => {
    const store = new MemoryConsentRevocationStore(new Map());
    await expect(
      propagateConsentRevocation(
        { consentRecordId: "consent_1" },
        {
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
          consentRevocationStore: store,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when ConsentRecord exists but revoked === false (caller misuse)", async () => {
    const store = new MemoryConsentRevocationStore(new Map());
    await expect(
      propagateConsentRevocation(
        { consentRecordId: "consent_1" },
        {
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
          consentRevocationStore: store,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-revocation.test
```

Expected: FAIL.

- [ ] **Step 3: Create `consent-revocation.ts`**

```ts
import type { PcdConsentRevocationPropagationResult } from "@creativeagent/schemas";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader } from "./lifecycle-readers.js";

/**
 * SP6 consent-revocation propagation store. Produces sorted asset id lists
 * for deterministic decision payloads and stable idempotency tests.
 */
export interface ConsentRevocationStore {
  /**
   * Returns AssetRecord ids whose PcdIdentitySnapshot.consentRecordId matches
   * the supplied consentRecordId. Returned ids are sorted ascending.
   */
  findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]>;

  /**
   * Atomically flips AssetRecord.consentRevokedAfterGeneration to true for
   * the supplied ids where it is currently false. Returns both partitions
   * (newly-flagged and already-flagged) sorted ascending.
   */
  markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }>;
}

export type PropagateConsentRevocationInput = {
  consentRecordId: string;
};

export type PropagateConsentRevocationStores = {
  consentRecordReader: ConsentRecordReader;
  consentRevocationStore: ConsentRevocationStore;
};

/**
 * SP6 — when a ConsentRecord transitions to revoked, walk every AssetRecord
 * whose PcdIdentitySnapshot.consentRecordId matches and flip
 * consentRevokedAfterGeneration to true. Idempotent: re-running flips no
 * rows and returns the same already-flagged set.
 *
 * Caller misuse guards (both throw InvariantViolationError):
 *   - ConsentRecord row not found
 *   - ConsentRecord exists but revoked === false (caller should not call this
 *     for a non-revoked record)
 *
 * Does NOT delete WorkTrace, PcdIdentitySnapshot, or AssetRecord rows. Audit
 * integrity is non-negotiable.
 *
 * // MERGE-BACK: emit WorkTrace per asset flagged here.
 * // MERGE-BACK: notification fan-out — Switchboard's three-channel notification
 * system fires per affected campaign owner.
 */
export async function propagateConsentRevocation(
  input: PropagateConsentRevocationInput,
  stores: PropagateConsentRevocationStores,
): Promise<PcdConsentRevocationPropagationResult> {
  const { consentRecordId } = input;
  const consent = await stores.consentRecordReader.findById(consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError("consent record not found", { consentRecordId });
  }
  if (consent.revoked !== true) {
    throw new InvariantViolationError(
      "propagateConsentRevocation called for non-revoked record",
      { consentRecordId },
    );
  }

  const assetIds = await stores.consentRevocationStore.findAssetIdsByRevokedConsent(consentRecordId);
  const partition = await stores.consentRevocationStore.markAssetsConsentRevokedAfterGeneration(assetIds);

  return {
    consentRecordId,
    assetIdsFlagged: partition.newlyFlagged,
    assetIdsAlreadyFlagged: partition.alreadyFlagged,
    consentRevocationVersion: PCD_CONSENT_REVOCATION_VERSION,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-revocation.test
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 7 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/consent-revocation.ts \
        packages/creative-pipeline/src/pcd/consent-revocation.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — propagateConsentRevocation + ConsentRevocationStore

Walks every AssetRecord whose PcdIdentitySnapshot.consentRecordId matches the
revoked record and flips consentRevokedAfterGeneration. Idempotent: re-runs
flip zero rows. Both partitions returned sorted ascending. Caller misuse
guards throw InvariantViolationError (consent missing or revoked === false).
Does not delete history. // MERGE-BACK markers for WorkTrace per asset and
notification fan-out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Build `assertConsentNotRevokedForGeneration`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts`
- Create: `packages/creative-pipeline/src/pcd/consent-pre-check-generation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/consent-pre-check-generation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { assertConsentNotRevokedForGeneration } from "./consent-pre-check-generation.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  ConsentRecordReader,
  CreatorIdentityReader,
} from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

describe("assertConsentNotRevokedForGeneration", () => {
  it("returns silently when CreatorIdentity has no consentRecordId (Tier 1/2)", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: null }),
          } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when ConsentRecord exists with revoked === false", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws ConsentRevokedRefusalError when ConsentRecord.revoked === true", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({
              id: "consent_1",
              revoked: true,
              revokedAt: new Date("2026-04-29T00:00:00Z"),
            }),
          } as ConsentRecordReader,
        },
      ),
    ).rejects.toMatchObject({
      name: "ConsentRevokedRefusalError",
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
    });
  });

  it("throws InvariantViolationError when CreatorIdentity is missing", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: { findById: reader(null) } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when bound ConsentRecord is missing", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("ConsentRevokedRefusalError carries revokedAt date", async () => {
    const revokedAt = new Date("2026-04-15T10:30:00Z");
    try {
      await assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: true, revokedAt }),
          } as ConsentRecordReader,
        },
      );
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentRevokedRefusalError);
      expect((e as ConsentRevokedRefusalError).revokedAt).toEqual(revokedAt);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-pre-check-generation
```

Expected: FAIL.

- [ ] **Step 3: Create `consent-pre-check-generation.ts`**

```ts
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, CreatorIdentityReader } from "./lifecycle-readers.js";

export type AssertConsentNotRevokedForGenerationInput = {
  creatorIdentityId: string;
};

export type AssertConsentNotRevokedForGenerationStores = {
  creatorIdentityReader: CreatorIdentityReader;
  consentRecordReader: ConsentRecordReader;
};

/**
 * SP6 pre-check fired before new PCD generation against a creator identity.
 * Caller composes after SP3 resolver runs:
 *   resolvePcdRegistryContext → assertConsentNotRevokedForGeneration → routePcdShot
 *
 * Returns silently when:
 *   - CreatorIdentity has no consentRecordId (Tier 1/2 case; no consent bound).
 *   - Bound ConsentRecord exists with revoked === false.
 *
 * Throws:
 *   - ConsentRevokedRefusalError when bound ConsentRecord.revoked === true.
 *   - InvariantViolationError when the row hierarchy is corrupted (creator
 *     missing, or consent record bound but row missing).
 */
export async function assertConsentNotRevokedForGeneration(
  input: AssertConsentNotRevokedForGenerationInput,
  stores: AssertConsentNotRevokedForGenerationStores,
): Promise<void> {
  const { creatorIdentityId } = input;
  const creator = await stores.creatorIdentityReader.findById(creatorIdentityId);
  if (creator === null) {
    throw new InvariantViolationError("creator identity not found", { creatorIdentityId });
  }
  if (creator.consentRecordId === null) {
    return;
  }
  const consent = await stores.consentRecordReader.findById(creator.consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError("consent record referenced by creator does not exist", {
      creatorIdentityId,
      consentRecordId: creator.consentRecordId,
    });
  }
  if (consent.revoked === true) {
    throw new ConsentRevokedRefusalError({
      creatorIdentityId,
      consentRecordId: consent.id,
      revokedAt: consent.revokedAt,
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-pre-check-generation
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 6 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts \
        packages/creative-pipeline/src/pcd/consent-pre-check-generation.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — assertConsentNotRevokedForGeneration

Pre-check for new PCD generation. Resolves CreatorIdentity → ConsentRecord;
throws ConsentRevokedRefusalError when revoked, InvariantViolationError on
corrupted state. Returns silently when no consent record is bound (Tier 1/2)
or when the bound record is unrevoked. Caller wires it after SP3 resolver
runs and before SP4 routing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Build `assertConsentNotRevokedForEdit`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/consent-pre-check-edit.ts`
- Create: `packages/creative-pipeline/src/pcd/consent-pre-check-edit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/consent-pre-check-edit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { assertConsentNotRevokedForEdit } from "./consent-pre-check-edit.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  ConsentRecordReader,
  PcdIdentitySnapshotReader,
} from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

describe("assertConsentNotRevokedForEdit", () => {
  it("returns silently when no PcdIdentitySnapshot exists (non-PCD asset)", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader(null),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when snapshot has no consentRecordId", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: null,
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when bound ConsentRecord.revoked === false", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws ConsentRevokedRefusalError when bound ConsentRecord.revoked === true", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: true, revokedAt: new Date() }),
          } as ConsentRecordReader,
        },
      ),
    ).rejects.toMatchObject({
      name: "ConsentRevokedRefusalError",
      priorAssetRecordId: "asset_1",
      consentRecordId: "consent_1",
      creatorIdentityId: null,
    });
  });

  it("throws InvariantViolationError when bound ConsentRecord is missing", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-pre-check-edit
```

Expected: FAIL.

- [ ] **Step 3: Create `consent-pre-check-edit.ts`**

```ts
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, PcdIdentitySnapshotReader } from "./lifecycle-readers.js";

export type AssertConsentNotRevokedForEditInput = {
  priorAssetRecordId: string;
};

export type AssertConsentNotRevokedForEditStores = {
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
};

/**
 * SP6 pre-check fired before new edit/extend creation against a prior asset.
 * Caller composes after fetching the prior asset id:
 *   assertConsentNotRevokedForEdit(priorAssetRecordId) → editor / extender
 *
 * Returns silently when:
 *   - The prior asset has no PcdIdentitySnapshot (non-PCD historical asset).
 *   - The snapshot has no consentRecordId bound.
 *   - The bound ConsentRecord exists with revoked === false.
 *
 * Throws:
 *   - ConsentRevokedRefusalError when bound ConsentRecord.revoked === true.
 *   - InvariantViolationError when the snapshot references a missing
 *     ConsentRecord (corrupted state).
 */
export async function assertConsentNotRevokedForEdit(
  input: AssertConsentNotRevokedForEditInput,
  stores: AssertConsentNotRevokedForEditStores,
): Promise<void> {
  const { priorAssetRecordId } = input;
  const snapshot = await stores.pcdIdentitySnapshotReader.findByAssetRecordId(priorAssetRecordId);
  if (snapshot === null) return;
  if (snapshot.consentRecordId === null) return;
  const consent = await stores.consentRecordReader.findById(snapshot.consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError(
      "consent record referenced by snapshot does not exist",
      { priorAssetRecordId, consentRecordId: snapshot.consentRecordId },
    );
  }
  if (consent.revoked === true) {
    throw new ConsentRevokedRefusalError({
      priorAssetRecordId,
      consentRecordId: consent.id,
      revokedAt: consent.revokedAt,
    });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- consent-pre-check-edit
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 5 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/consent-pre-check-edit.ts \
        packages/creative-pipeline/src/pcd/consent-pre-check-edit.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP6 — assertConsentNotRevokedForEdit

Pre-check for new edit/extend creation. Resolves prior AssetRecord →
PcdIdentitySnapshot → ConsentRecord. Throws ConsentRevokedRefusalError
(populating priorAssetRecordId, leaving creatorIdentityId null) when revoked,
InvariantViolationError when snapshot references missing consent record.
Returns silently for non-PCD assets and unrevoked consent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Add SP6-wide anti-pattern + forbidden-imports tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/sp6-anti-patterns.test.ts`

These tests are meta-tests over the SP6 source files. They prevent regressions: no `if (passFail ===` outside `approval-advancement.ts`; no dispatcher pattern; literal `complianceCheck.checkMetaDraftCompliance(` token in `meta-draft-gate.ts`; no banned imports per source file.

- [ ] **Step 1: Write the test file**

Create `packages/creative-pipeline/src/pcd/sp6-anti-patterns.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const SP6_SOURCE_FILES = [
  "approval-lifecycle-version.ts",
  "consent-revocation-version.ts",
  "invariant-violation-error.ts",
  "consent-revocation-error.ts",
  "lifecycle-readers.ts",
  "export-gate-state.ts",
  "compliance-check.ts",
  "approval-advancement.ts",
  "final-export-gate.ts",
  "meta-draft-gate.ts",
  "consent-revocation.ts",
  "consent-pre-check-generation.ts",
  "consent-pre-check-edit.ts",
];

const readSource = (file: string): string => readFileSync(join(here, file), "utf8");

const stripComments = (src: string): string =>
  src
    .split("\n")
    .map((line) => {
      const ix = line.indexOf("//");
      return ix === -1 ? line : line.slice(0, ix);
    })
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

describe("SP6 anti-pattern grep", () => {
  it("no `if (passFail ===` outside approval-advancement.ts", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      if (file === "approval-advancement.ts") continue;
      const src = stripComments(readSource(file));
      if (/if\s*\(\s*[a-zA-Z_$][\w$]*\.passFail\s*===/.test(src)) {
        offenders.push(file);
      }
      if (/if\s*\(\s*passFail\s*===/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no `if (intent ===` or `switch (intent)` dispatch in any SP6 source", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = stripComments(readSource(file));
      if (/if\s*\(\s*[a-zA-Z_$][\w$]*\.?intent\s*===/.test(src)) offenders.push(`if-intent: ${file}`);
      if (/switch\s*\(\s*[a-zA-Z_$][\w$]*\.?intent\s*\)/.test(src)) offenders.push(`switch-intent: ${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no direct prisma. or assetRecord.update or WorkTrace tokens in SP6 sources", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = stripComments(readSource(file));
      if (/\bprisma\./.test(src)) offenders.push(`prisma.: ${file}`);
      if (/assetRecord\.update/.test(src)) offenders.push(`assetRecord.update: ${file}`);
      if (/\bWorkTrace\b/.test(src)) offenders.push(`WorkTrace: ${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("meta-draft-gate.ts contains literal `complianceCheck.checkMetaDraftCompliance(` (real seam, not theater)", () => {
    const src = stripComments(readSource("meta-draft-gate.ts"));
    expect(src).toContain("complianceCheck.checkMetaDraftCompliance(");
  });

  it("no Switchboard-only imports in any SP6 source (core/approval, ApprovalLifecycle, ExportLifecycle)", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = readSource(file);
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      for (const line of importLines) {
        if (/core\/approval/.test(line)) offenders.push(`core/approval in ${file}`);
        if (/ApprovalLifecycle\b/.test(line)) offenders.push(`ApprovalLifecycle in ${file}`);
        if (/ExportLifecycle\b/.test(line)) offenders.push(`ExportLifecycle in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("SP6 forbidden imports per source file", () => {
  const FORBIDDEN_PER_FILE = [
    "@creativeagent/db",
    "@prisma/client",
    "inngest",
    "node:fs",
    "node:http",
    "node:https",
    "crypto",
  ];

  for (const file of SP6_SOURCE_FILES) {
    it(`${file} imports none of [${FORBIDDEN_PER_FILE.join(", ")}]`, () => {
      const src = readSource(file);
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      const offenders: string[] = [];
      for (const banned of FORBIDDEN_PER_FILE) {
        for (const line of importLines) {
          if (line.includes(`"${banned}"`) || line.includes(`'${banned}'`)) {
            offenders.push(`${banned} in line: ${line.trim()}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("SP5 hard-block invariant chain — end-to-end", () => {
  it("approval-advancement.ts is the sole holder of the passFail === fail refusal", () => {
    const src = stripComments(readSource("approval-advancement.ts"));
    expect(src).toMatch(/qc\.passFail\s*===\s*"fail"/);
    expect(src).toMatch(/qc_failed/);
  });

  it("approval-advancement.ts also refuses passFail === warn (SP5 binding)", () => {
    const src = stripComments(readSource("approval-advancement.ts"));
    expect(src).toMatch(/qc\.passFail\s*===\s*"warn"/);
    expect(src).toMatch(/qc_not_conclusive/);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp6-anti-patterns
```

Expected: all pass (typically 8–10 individual tests, depending on per-file forbidden-imports loop expansion).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/sp6-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP6 — anti-pattern grep + forbidden-imports tests

Locks SP6 invariants at the source level:
- No `if (passFail ===` outside approval-advancement.ts (sole hard-block holder).
- No `if (intent ===` / `switch (intent)` dispatch (forbids retroactive
  introduction of the rejected single-dispatcher approach).
- No prisma. / assetRecord.update / WorkTrace tokens in SP6 source.
- meta-draft-gate.ts genuinely contains the ComplianceCheck call (not theater).
- No Switchboard-only imports (core/approval, ApprovalLifecycle, ExportLifecycle).
- Per-file forbidden imports: @creativeagent/db, @prisma/client, inngest,
  node:fs, node:http, node:https, crypto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Implement `PrismaConsentRevocationStore` in `packages/db`

**Files:**
- Create: `packages/db/src/stores/prisma-consent-revocation-store.ts`
- Create: `packages/db/src/stores/prisma-consent-revocation-store.test.ts`

The Prisma store satisfies the SP6 `ConsentRevocationStore` contract from Task 14. It uses two Prisma queries plus an in-memory partition.

- [ ] **Step 1: Write failing tests**

Create `packages/db/src/stores/prisma-consent-revocation-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ConsentRevocationStore } from "@creativeagent/creative-pipeline";
import { PrismaConsentRevocationStore } from "./prisma-consent-revocation-store.js";

// Minimal Prisma-shaped fake to exercise the store without a real DB.
type FakePrisma = {
  pcdIdentitySnapshot: {
    findMany: (args: {
      where: { consentRecordId: string };
      select: { assetRecordId: true };
    }) => Promise<{ assetRecordId: string }[]>;
  };
  assetRecord: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; consentRevokedAfterGeneration: true };
    }) => Promise<{ id: string; consentRevokedAfterGeneration: boolean }[]>;
    updateMany: (args: {
      where: { id: { in: string[] } };
      data: { consentRevokedAfterGeneration: true };
    }) => Promise<{ count: number }>;
  };
};

const buildFakePrisma = (
  snapshots: Array<{ assetRecordId: string; consentRecordId: string }>,
  flagged: Set<string>,
): FakePrisma => ({
  pcdIdentitySnapshot: {
    async findMany(args) {
      return snapshots
        .filter((s) => s.consentRecordId === args.where.consentRecordId)
        .map((s) => ({ assetRecordId: s.assetRecordId }));
    },
  },
  assetRecord: {
    async findMany(args) {
      return args.where.id.in.map((id) => ({
        id,
        consentRevokedAfterGeneration: flagged.has(id),
      }));
    },
    async updateMany(args) {
      let count = 0;
      for (const id of args.where.id.in) {
        if (!flagged.has(id)) {
          flagged.add(id);
          count += 1;
        }
      }
      return { count };
    },
  },
});

describe("PrismaConsentRevocationStore", () => {
  it("findAssetIdsByRevokedConsent returns sorted matching ids", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma(
      [
        { assetRecordId: "az", consentRecordId: "consent_1" },
        { assetRecordId: "ab", consentRecordId: "consent_1" },
        { assetRecordId: "aa", consentRecordId: "consent_1" },
        { assetRecordId: "ax", consentRecordId: "consent_2" },
      ],
      flagged,
    );
    const store: ConsentRevocationStore = new PrismaConsentRevocationStore(prisma as never);
    expect(await store.findAssetIdsByRevokedConsent("consent_1")).toEqual(["aa", "ab", "az"]);
    expect(await store.findAssetIdsByRevokedConsent("consent_2")).toEqual(["ax"]);
    expect(await store.findAssetIdsByRevokedConsent("consent_x")).toEqual([]);
  });

  it("markAssetsConsentRevokedAfterGeneration partitions sorted newly/already", async () => {
    const flagged = new Set<string>(["a1", "a3"]);
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const r = await store.markAssetsConsentRevokedAfterGeneration(["a3", "a2", "a4", "a1"]);
    expect(r.newlyFlagged).toEqual(["a2", "a4"]);
    expect(r.alreadyFlagged).toEqual(["a1", "a3"]);
    expect(flagged.has("a2")).toBe(true);
    expect(flagged.has("a4")).toBe(true);
  });

  it("markAssetsConsentRevokedAfterGeneration is idempotent", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const first = await store.markAssetsConsentRevokedAfterGeneration(["a1", "a2"]);
    expect(first.newlyFlagged).toEqual(["a1", "a2"]);
    expect(first.alreadyFlagged).toEqual([]);
    const second = await store.markAssetsConsentRevokedAfterGeneration(["a1", "a2"]);
    expect(second.newlyFlagged).toEqual([]);
    expect(second.alreadyFlagged).toEqual(["a1", "a2"]);
  });

  it("empty input array → empty partitions, no Prisma calls beyond findMany", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const r = await store.markAssetsConsentRevokedAfterGeneration([]);
    expect(r.newlyFlagged).toEqual([]);
    expect(r.alreadyFlagged).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/db test -- prisma-consent-revocation-store
```

Expected: FAIL.

- [ ] **Step 3: Create `prisma-consent-revocation-store.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import type { ConsentRevocationStore } from "@creativeagent/creative-pipeline";

/**
 * Prisma implementer of the SP6 ConsentRevocationStore contract.
 *
 * Two queries:
 *   1. JOIN AssetRecord → PcdIdentitySnapshot on consentRecordId.
 *   2. partition AssetRecord rows by current consentRevokedAfterGeneration value,
 *      then updateMany the false ones.
 *
 * Sort outputs ascending for deterministic decision payloads. SP6 idempotency
 * tests depend on stable ordering.
 */
export class PrismaConsentRevocationStore implements ConsentRevocationStore {
  constructor(private prisma: PrismaClient) {}

  async findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]> {
    const rows = await this.prisma.pcdIdentitySnapshot.findMany({
      where: { consentRecordId },
      select: { assetRecordId: true },
    });
    return rows.map((r) => r.assetRecordId).sort();
  }

  async markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }> {
    if (assetRecordIds.length === 0) {
      return { newlyFlagged: [], alreadyFlagged: [] };
    }
    const before = await this.prisma.assetRecord.findMany({
      where: { id: { in: assetRecordIds } },
      select: { id: true, consentRevokedAfterGeneration: true },
    });
    const newlyFlaggedIds = before
      .filter((r) => !r.consentRevokedAfterGeneration)
      .map((r) => r.id);
    const alreadyFlaggedIds = before
      .filter((r) => r.consentRevokedAfterGeneration)
      .map((r) => r.id);

    if (newlyFlaggedIds.length > 0) {
      await this.prisma.assetRecord.updateMany({
        where: { id: { in: newlyFlaggedIds } },
        data: { consentRevokedAfterGeneration: true },
      });
    }

    return {
      newlyFlagged: newlyFlaggedIds.slice().sort(),
      alreadyFlagged: alreadyFlaggedIds.slice().sort(),
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/db test -- prisma-consent-revocation-store
pnpm --filter @creativeagent/db typecheck
```

Expected: 4 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-consent-revocation-store.ts \
        packages/db/src/stores/prisma-consent-revocation-store.test.ts
git commit -m "$(cat <<'EOF'
feat(db): SP6 — PrismaConsentRevocationStore

Implements ConsentRevocationStore over @prisma/client. Two queries: snapshot
findMany joined on consentRecordId, then assetRecord findMany + updateMany for
partition + flip. Both findAssetIdsByRevokedConsent and
markAssetsConsentRevokedAfterGeneration return sorted ids per the SP6
deterministic-output contract.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Implement six Prisma reader adapters in `packages/db`

**Files (all new):**
- `packages/db/src/stores/prisma-asset-record-reader.ts`
- `packages/db/src/stores/prisma-product-qc-result-reader.ts`
- `packages/db/src/stores/prisma-pcd-identity-snapshot-reader.ts`
- `packages/db/src/stores/prisma-consent-record-reader.ts`
- `packages/db/src/stores/prisma-creative-job-reader.ts`
- `packages/db/src/stores/prisma-creator-identity-reader.ts`
- `packages/db/src/stores/prisma-readers.test.ts`

Each adapter is small (one method, one Prisma `findUnique` or `findFirst`). Combine into a single test file for compactness.

- [ ] **Step 1: Write the consolidated test file**

Create `packages/db/src/stores/prisma-readers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PrismaAssetRecordReader } from "./prisma-asset-record-reader.js";
import { PrismaProductQcResultReader } from "./prisma-product-qc-result-reader.js";
import { PrismaPcdIdentitySnapshotReader } from "./prisma-pcd-identity-snapshot-reader.js";
import { PrismaConsentRecordReader } from "./prisma-consent-record-reader.js";
import { PrismaCreativeJobReader } from "./prisma-creative-job-reader.js";
import { PrismaCreatorIdentityReader } from "./prisma-creator-identity-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    assetRecord: { findUnique: async ({ where }: { where: { id: string } }) => rows[`asset:${where.id}`] ?? null },
    productQcResult: {
      findFirst: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`qc:${where.assetRecordId}`] ?? null,
    },
    pcdIdentitySnapshot: {
      findUnique: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`snapshot:${where.assetRecordId}`] ?? null,
    },
    consentRecord: { findUnique: async ({ where }: { where: { id: string } }) => rows[`consent:${where.id}`] ?? null },
    creativeJob: { findUnique: async ({ where }: { where: { id: string } }) => rows[`job:${where.id}`] ?? null },
    creatorIdentity: { findUnique: async ({ where }: { where: { id: string } }) => rows[`creator:${where.id}`] ?? null },
  }) as never;

describe("PrismaAssetRecordReader", () => {
  it("returns the documented narrow shape", async () => {
    const r = new PrismaAssetRecordReader(
      fakePrisma({
        "asset:a1": { id: "a1", jobId: "j1", creatorId: "c1", approvalState: "pending", consentRevokedAfterGeneration: false, lockedDerivativeOf: null },
      }),
    );
    expect(await r.findById("a1")).toEqual({ id: "a1", jobId: "j1", creatorId: "c1", approvalState: "pending" });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaAssetRecordReader(fakePrisma({}));
    expect(await r.findById("a1")).toBeNull();
  });
});

describe("PrismaProductQcResultReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaProductQcResultReader(
      fakePrisma({ "qc:a1": { assetRecordId: "a1", passFail: "pass" } }),
    );
    expect(await r.findByAssetRecordId("a1")).toEqual({ assetRecordId: "a1", passFail: "pass" });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaProductQcResultReader(fakePrisma({}));
    expect(await r.findByAssetRecordId("a1")).toBeNull();
  });
});

describe("PrismaPcdIdentitySnapshotReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaPcdIdentitySnapshotReader(
      fakePrisma({
        "snapshot:a1": { assetRecordId: "a1", creatorIdentityId: "c1", consentRecordId: "consent_1" },
      }),
    );
    expect(await r.findByAssetRecordId("a1")).toEqual({
      assetRecordId: "a1",
      creatorIdentityId: "c1",
      consentRecordId: "consent_1",
    });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaPcdIdentitySnapshotReader(fakePrisma({}));
    expect(await r.findByAssetRecordId("a1")).toBeNull();
  });
});

describe("PrismaConsentRecordReader", () => {
  it("returns the narrow shape", async () => {
    const revokedAt = new Date("2026-04-29T00:00:00Z");
    const r = new PrismaConsentRecordReader(
      fakePrisma({ "consent:c1": { id: "c1", revoked: true, revokedAt } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", revoked: true, revokedAt });
  });
});

describe("PrismaCreativeJobReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreativeJobReader(fakePrisma({ "job:j1": { id: "j1", effectiveTier: 2 } }));
    expect(await r.findById("j1")).toEqual({ id: "j1", effectiveTier: 2 });
  });
});

describe("PrismaCreatorIdentityReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreatorIdentityReader(
      fakePrisma({ "creator:c1": { id: "c1", consentRecordId: null } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", consentRecordId: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/db test -- prisma-readers
```

Expected: FAIL with `Cannot find module './prisma-asset-record-reader.js'`.

- [ ] **Step 3: Create the six reader files**

`packages/db/src/stores/prisma-asset-record-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { AssetRecordReader } from "@creativeagent/creative-pipeline";

export class PrismaAssetRecordReader implements AssetRecordReader {
  constructor(private prisma: PrismaClient) {}
  async findById(id: string) {
    const row = await this.prisma.assetRecord.findUnique({ where: { id } });
    if (row === null) return null;
    return {
      id: row.id,
      jobId: row.jobId,
      creatorId: row.creatorId,
      approvalState: row.approvalState,
    };
  }
}
```

`packages/db/src/stores/prisma-product-qc-result-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { ProductQcResultReader } from "@creativeagent/creative-pipeline";

export class PrismaProductQcResultReader implements ProductQcResultReader {
  constructor(private prisma: PrismaClient) {}
  async findByAssetRecordId(assetRecordId: string) {
    const row = await this.prisma.productQcResult.findFirst({ where: { assetRecordId } });
    if (row === null) return null;
    if (row.passFail !== "pass" && row.passFail !== "fail" && row.passFail !== "warn") {
      // Defensive narrow — DB column is unconstrained String. SP5 writes one of
      // the three values; any other value is upstream corruption.
      throw new Error(`PrismaProductQcResultReader: unexpected passFail value "${row.passFail}"`);
    }
    return { assetRecordId: row.assetRecordId, passFail: row.passFail };
  }
}
```

`packages/db/src/stores/prisma-pcd-identity-snapshot-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { PcdIdentitySnapshotReader } from "@creativeagent/creative-pipeline";

export class PrismaPcdIdentitySnapshotReader implements PcdIdentitySnapshotReader {
  constructor(private prisma: PrismaClient) {}
  async findByAssetRecordId(assetRecordId: string) {
    const row = await this.prisma.pcdIdentitySnapshot.findUnique({ where: { assetRecordId } });
    if (row === null) return null;
    return {
      assetRecordId: row.assetRecordId,
      creatorIdentityId: row.creatorIdentityId,
      consentRecordId: row.consentRecordId,
    };
  }
}
```

`packages/db/src/stores/prisma-consent-record-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { ConsentRecordReader } from "@creativeagent/creative-pipeline";

export class PrismaConsentRecordReader implements ConsentRecordReader {
  constructor(private prisma: PrismaClient) {}
  async findById(id: string) {
    const row = await this.prisma.consentRecord.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, revoked: row.revoked, revokedAt: row.revokedAt };
  }
}
```

`packages/db/src/stores/prisma-creative-job-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { CreativeJobReader } from "@creativeagent/creative-pipeline";

export class PrismaCreativeJobReader implements CreativeJobReader {
  constructor(private prisma: PrismaClient) {}
  async findById(id: string) {
    const row = await this.prisma.creativeJob.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, effectiveTier: row.effectiveTier };
  }
}
```

`packages/db/src/stores/prisma-creator-identity-reader.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { CreatorIdentityReader } from "@creativeagent/creative-pipeline";

export class PrismaCreatorIdentityReader implements CreatorIdentityReader {
  constructor(private prisma: PrismaClient) {}
  async findById(id: string) {
    const row = await this.prisma.creatorIdentity.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, consentRecordId: row.consentRecordId };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @creativeagent/db test -- prisma-readers
pnpm --filter @creativeagent/db typecheck
```

Expected: 6+ tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-asset-record-reader.ts \
        packages/db/src/stores/prisma-product-qc-result-reader.ts \
        packages/db/src/stores/prisma-pcd-identity-snapshot-reader.ts \
        packages/db/src/stores/prisma-consent-record-reader.ts \
        packages/db/src/stores/prisma-creative-job-reader.ts \
        packages/db/src/stores/prisma-creator-identity-reader.ts \
        packages/db/src/stores/prisma-readers.test.ts
git commit -m "$(cat <<'EOF'
feat(db): SP6 — six Prisma reader adapters

PrismaAssetRecordReader, PrismaProductQcResultReader,
PrismaPcdIdentitySnapshotReader, PrismaConsentRecordReader,
PrismaCreativeJobReader, PrismaCreatorIdentityReader. Each implements the
narrow lifecycle-readers.ts interface from creative-pipeline; each returns
only the documented fields (no PII echoes). PrismaProductQcResultReader
defensively narrows passFail to the SP5 enum, throwing on out-of-band values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Re-export SP6 surfaces from package barrels

**Files:**
- Modify: `packages/creative-pipeline/src/index.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Append SP6 exports to `packages/creative-pipeline/src/index.ts`**

After the SP5 block:

```ts
// SP6: lifecycle gates — approval / final-export / meta-draft / consent
export { PCD_APPROVAL_LIFECYCLE_VERSION } from "./pcd/approval-lifecycle-version.js";
export { PCD_CONSENT_REVOCATION_VERSION } from "./pcd/consent-revocation-version.js";

export { InvariantViolationError } from "./pcd/invariant-violation-error.js";
export { ConsentRevokedRefusalError } from "./pcd/consent-revocation-error.js";

export type {
  AssetRecordReader,
  ProductQcResultReader,
  PcdIdentitySnapshotReader,
  ConsentRecordReader,
  CreativeJobReader,
  CreatorIdentityReader,
} from "./pcd/lifecycle-readers.js";

export {
  AlwaysOpenExportGateState,
  type ExportGateOpenness,
  type ExportGateState,
} from "./pcd/export-gate-state.js";

export {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./pcd/compliance-check.js";

export {
  decidePcdApprovalAdvancement,
  type DecidePcdApprovalAdvancementInput,
  type DecidePcdApprovalAdvancementStores,
} from "./pcd/approval-advancement.js";

export {
  decidePcdFinalExportGate,
  type DecidePcdFinalExportGateInput,
  type DecidePcdFinalExportGateStores,
} from "./pcd/final-export-gate.js";

export {
  decidePcdMetaDraftGate,
  type DecidePcdMetaDraftGateInput,
  type DecidePcdMetaDraftGateStores,
} from "./pcd/meta-draft-gate.js";

export {
  propagateConsentRevocation,
  type ConsentRevocationStore,
  type PropagateConsentRevocationInput,
  type PropagateConsentRevocationStores,
} from "./pcd/consent-revocation.js";

export {
  assertConsentNotRevokedForGeneration,
  type AssertConsentNotRevokedForGenerationInput,
  type AssertConsentNotRevokedForGenerationStores,
} from "./pcd/consent-pre-check-generation.js";

export {
  assertConsentNotRevokedForEdit,
  type AssertConsentNotRevokedForEditInput,
  type AssertConsentNotRevokedForEditStores,
} from "./pcd/consent-pre-check-edit.js";
```

- [ ] **Step 2: Append SP6 exports to `packages/db/src/index.ts`**

After the existing SP1–SP5 store re-exports:

```ts
// SP6: lifecycle store + reader adapters
export { PrismaConsentRevocationStore } from "./stores/prisma-consent-revocation-store.js";
export { PrismaAssetRecordReader } from "./stores/prisma-asset-record-reader.js";
export { PrismaProductQcResultReader } from "./stores/prisma-product-qc-result-reader.js";
export { PrismaPcdIdentitySnapshotReader } from "./stores/prisma-pcd-identity-snapshot-reader.js";
export { PrismaConsentRecordReader } from "./stores/prisma-consent-record-reader.js";
export { PrismaCreativeJobReader } from "./stores/prisma-creative-job-reader.js";
export { PrismaCreatorIdentityReader } from "./stores/prisma-creator-identity-reader.js";
```

- [ ] **Step 3: Build and typecheck both packages**

```bash
pnpm --filter @creativeagent/creative-pipeline build
pnpm --filter @creativeagent/creative-pipeline typecheck
pnpm --filter @creativeagent/db build
pnpm --filter @creativeagent/db typecheck
```

Expected: clean across both.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/index.ts packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
chore: SP6 — re-export lifecycle gates and Prisma adapters from barrels

Surfaces decidePcdApprovalAdvancement, decidePcdFinalExportGate,
decidePcdMetaDraftGate, propagateConsentRevocation, two pre-checks, two
injected interfaces with default implementers, six reader interfaces, and
their Prisma adapters. Two version constants and two error types also
exported.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Update `docs/SWITCHBOARD-CONTEXT.md` with SP6 merge-back notes

**Files:**
- Modify: `docs/SWITCHBOARD-CONTEXT.md` (the SP6 section starting at line ~87)

- [ ] **Step 1: Replace the SP6 stub section with locked merge-back contracts**

Replace the existing SP6 paragraph in `docs/SWITCHBOARD-CONTEXT.md` (lines 87–95 in the current file) with:

```md
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
```

- [ ] **Step 2: Verify the file builds**

No code change; just verify the file remains valid markdown:

```bash
grep -nE "^### SP" docs/SWITCHBOARD-CONTEXT.md
```

Expected: SP2–SP6 section headers present.

- [ ] **Step 3: Commit**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "$(cat <<'EOF'
docs(pcd): SP6 — record merge-back contracts in SWITCHBOARD-CONTEXT

Replaces the SP6 stub paragraph with locked merge-back surfaces:
ExportGateState, ComplianceCheck, LegalOverrideRecord (deferred), WorkTrace
emit markers (six total), notification fan-out, and schema reconciliation
notes for AssetRecord.consentRevokedAfterGeneration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Final verification — full build, test, typecheck, prettier

**Files:**
- None (pure verification gate).

- [ ] **Step 1: Clean rebuild**

```bash
pnpm reset 2>/dev/null || (
  pnpm exec turbo clean
  pnpm db:generate
  pnpm --filter @creativeagent/schemas build
  pnpm --filter @creativeagent/db build
  pnpm --filter @creativeagent/creative-pipeline build
)
```

Expected: clean exit.

- [ ] **Step 2: Full test suite**

```bash
pnpm test 2>&1 | tail -40
```

Expected: all tests across schemas + db + creative-pipeline pass. Capture the new totals — SP6 adds approximately 70+ new tests (12 schemas + 6 lifecycle-readers + 4 export-gate + 5 compliance + 6 approval-advancement + 14 final-export + 12 meta-draft + 7 propagation + 6 generation pre-check + 5 edit pre-check + ~12 anti-pattern + 4 prisma-store + 6 prisma-readers + 3 lifecycle-versions + 2 invariant-error + 4 consent-error). Record the actual count from output for the PR description.

- [ ] **Step 3: Full typecheck**

```bash
pnpm typecheck
```

Expected: clean across all 5 packages.

- [ ] **Step 4: Prettier check (style gate per SP5 baseline; pnpm lint is broken on origin/main)**

```bash
pnpm exec prettier --check '**/*.ts' '!**/dist/**' '!**/node_modules/**'
```

Expected: clean modulo the two pre-existing tier-policy.ts SP2-era warnings (those are baseline noise, not SP6 regressions). If any new SP6 file fails prettier, run `pnpm exec prettier --write <file>` and add the formatting fix to a separate commit.

- [ ] **Step 5: Commit any prettier fixes (if any)**

If `prettier --check` flagged SP6 files, format and commit:

```bash
pnpm exec prettier --write '**/*.ts' '!**/dist/**' '!**/node_modules/**'
git add -u
git diff --cached --stat
git commit -m "style(pcd): SP6 — apply prettier formatting"
```

If clean, skip this step.

- [ ] **Step 6: Sanity-check the SP6 source file count**

```bash
git diff --stat origin/main...HEAD -- packages/creative-pipeline/src/pcd/ packages/db/src/stores/
```

Expected: ~22 new TS files created (13 in creative-pipeline/pcd + 7 in db/stores + 1 SP6 anti-pattern test) plus the migration directory. Adjust the PR body's "files added" count to the actual.

---

## Task 23: Open the SP6 PR

**Files:**
- None (PR creation).

- [ ] **Step 1: Verify branch state and final diff**

```bash
git branch --show-current        # feat/pcd-sp6-lifecycle-gates
git log --oneline origin/main..HEAD | head -30
git diff --stat origin/main...HEAD | tail -5
```

Expected: ~21 commits (one per task), additive diff (no deletes outside the InvariantViolationError class relocation).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/pcd-sp6-lifecycle-gates
```

- [ ] **Step 3: Open the PR with full body**

```bash
gh pr create --title "feat(pcd): SP6 — approval / final-export / meta-draft / consent-revocation lifecycle gates" --body "$(cat <<'EOF'
## Summary
- Six pure store-injected lifecycle decision/assertion functions: `decidePcdApprovalAdvancement`, `decidePcdFinalExportGate`, `decidePcdMetaDraftGate`, `propagateConsentRevocation`, `assertConsentNotRevokedForGeneration`, `assertConsentNotRevokedForEdit`.
- Two injected merge-back-seam interfaces with default in-tree implementers: `ExportGateState` (`AlwaysOpenExportGateState`), `ComplianceCheck` (`AlwaysPassComplianceCheck`).
- One new injected store contract `ConsentRevocationStore` with concrete `PrismaConsentRevocationStore` in `packages/db`.
- Six narrow lifecycle reader interfaces with concrete Prisma adapters in `packages/db`.
- Two new pinned version constants: `PCD_APPROVAL_LIFECYCLE_VERSION = "approval-lifecycle@1.0.0"` (three lifecycle gates) and `PCD_CONSENT_REVOCATION_VERSION = "consent-revocation@1.0.0"` (propagator).
- One additive Prisma migration: `AssetRecord.consentRevokedAfterGeneration Boolean @default(false)`.
- `InvariantViolationError` promoted to its own file with widened `(reason, context?)` constructor — legacy `(jobId, fieldName)` overload preserved for SP3/SP4 callers.
- Closes SP5's hard-block invariant step 5 ("label-visible without OCR match → approval refused"). Inherits SP5 binding: `passFail === "warn"` is "not conclusively pass" → also refused.

## Architecture
Approach 1 (independent gates, caller composes) per the SP6 design. No internal dispatcher, no shared `LifecycleContext`, no apps/api wiring. Each gate takes the minimum input it needs (zod-validated), returns a self-describing decision struct, and pins its version constant from imports. Final-export collects all refusal reasons (no short-circuit). Meta-draft genuinely invokes ComplianceCheck even when other refusals exist — anti-pattern grep test enforces. Propagation is idempotent with sorted output. Snapshots referencing missing ConsentRecords throw `InvariantViolationError` (corrupted state, not refusal).

## Merge-back contracts
Six `// MERGE-BACK:` markers documented in the design and listed in `docs/SWITCHBOARD-CONTEXT.md`: WorkTrace emit at each lifecycle decision-point, WorkTrace per asset flagged, legal-override path on revoked re-export, ExportGateState swap to Switchboard ExportLifecycle, ComplianceCheck swap to Switchboard FTC pipeline, notification fan-out on revocation.

## Test plan
- [ ] `pnpm build` — clean across all 5 packages.
- [ ] `pnpm test` — all SP1–SP5 tests still pass; SP6 adds ~70+ new tests (record exact total from CI).
- [ ] `pnpm typecheck` — clean.
- [ ] `pnpm exec prettier --check '**/*.ts'` — clean modulo two pre-existing tier-policy.ts SP2-era warnings (baseline noise, not SP6 regressions).
- [ ] Anti-pattern grep tests pass (no `if (passFail ===` outside approval-advancement.ts; no dispatcher; ComplianceCheck literal call in meta-draft-gate.ts).
- [ ] Forbidden-imports tests pass (no `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, etc. in any SP6 source).
- [ ] Migration applies cleanly to a fresh DB (verify locally or in CI).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 4: Verify PR was created**

```bash
gh pr view --json url,title,number
```

Expected: PR created successfully with the SP6 title. **Record the actual PR number and URL from `gh pr view`** — GitHub PR numbering is not a design invariant; do not assume a specific number.

---

## Self-review (run after the plan ships, before execution)

This plan covers every spec section. Cross-check before executing:

| Spec section | Implementing task |
|---|---|
| Goal — six lifecycle gate functions | Tasks 11–16 |
| ExportGateState injected interface | Task 9 |
| ComplianceCheck injected interface | Task 10 |
| ConsentRevocationStore + Prisma implementer | Tasks 14, 18 |
| `AssetRecord.consentRevokedAfterGeneration` migration (non-null Boolean default false) | Task 4 |
| Decision-struct schemas + refusal-reason enum | Tasks 1, 2, 3 |
| Two version constants | Task 6 |
| `ConsentRevokedRefusalError` | Task 7 |
| Six narrow reader interfaces | Task 8 |
| Six Prisma reader adapters | Task 19 |
| `InvariantViolationError` promotion + widening | Task 5 |
| Type-boundary normalization for `effectiveTier` | Tasks 12, 13 (inline in gates) |
| Sorted output from `ConsentRevocationStore` | Tasks 14, 18 |
| Snapshot-references-missing-ConsentRecord throws | Tasks 12, 13 |
| Anti-pattern grep + forbidden-imports tests | Task 17 |
| `// MERGE-BACK:` markers (6 total) | Tasks 11, 12, 13, 14 |
| `SWITCHBOARD-CONTEXT.md` SP6 update | Task 21 |
| Final verification gate | Task 22 |
| PR | Task 23 |

**Placeholders:** none — every test and implementation has complete code blocks.

**Type consistency:** decision-struct field names match between zod schema (Task 2) and TypeScript usage in gate implementations (Tasks 11–13). `effectiveTier: IdentityTier | null` propagates consistently from `CreativeJobReader` (Task 8) → gate normalization (Tasks 12, 13) → decision struct (Task 2) → `ComplianceCheckInput` (Task 10).

**Scope:** focused on the SP6 lifecycle slice. No SP1–SP5 source body changes (only the InvariantViolationError relocation, which preserves backwards compatibility via re-export and constructor overload). No apps/api wiring. No SP1–SP5 schema body changes (only the additive `AssetRecord.consentRevokedAfterGeneration` column).


