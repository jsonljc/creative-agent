# PCD SP19 Implementation Plan — PcdPerformanceSnapshot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a net-new `PcdPerformanceSnapshot` Prisma table (1:1 with `AssetRecord` on `assetRecordId @unique`) for post-completion observability per attempt — terminal kind (success / failure / manual_skip), latency, actual cost, error category, attempt context, forensic version + capture timestamp — via a pure store-injected stamper + thin standalone writer + a new Prisma store + reader. No widen of `PcdIdentitySnapshot`, `AssetRecord`, or `ProductQcResult`. No orchestrator lock-step. No `crypto`. No indexes beyond the unique-FK index. No backfill. Closes the "post-completion observability" successor reservation from SP18 design.

**Architecture:** Standalone-writer, not wrap-not-extend. SP19 is the first PCD slice that stamps at **terminal-state time** rather than generation-decision time, so there is no SP4-invariant lock-step to compose against. The stamper is a pure function over the runner's terminal-state union; the writer is a thin store-injected wrapper. The Prisma table uses `onDelete: Restrict` so historical performance survives accidental `AssetRecord` deletion — test cleanup must delete `PcdPerformanceSnapshot` rows BEFORE their referenced `AssetRecord` rows.

**Tech Stack:** TypeScript 5.x ESM, zod 3.x, Prisma 5.x, Vitest, pnpm workspaces. No `node:crypto`. No `inngest` in the SP19 surface.

---

## Pre-execution gates (BLOCKING)

**Gate G1 — SP18 + SP18 followup squash-merged.** Both `817db22` (SP18 squash, PR #18) and `544816a` (SP18 followup, PR #19) must be on `creativeagent` `main` before Task 1. The SP19 anti-pattern test source-freeze diff is keyed against `544816a` (the later SHA).

Verify:
```bash
git log --oneline 544816a -1   # expect: 544816a test(pcd): SP18 post-merge ...
git log --oneline 817db22 -1   # expect: 817db22 feat(pcd): SP18 — synthetic-routing ...
git merge-base --is-ancestor 544816a HEAD && echo "OK: 544816a is on HEAD"
```

If either SHA is missing, abort and resume after rebase.

**Gate G2 — Worktree.** Execute in `.worktrees/sp19` on branch `pcd/sp19-pcd-performance-snapshot`. Setup via `superpowers:using-git-worktrees` (subagent-driven-development handles this automatically). Branch is cut from `main` at `544816a` or later.

**Gate G3 — Subagent isolation directive.** Every implementer subagent prompt MUST open with:

```bash
pwd                                # expect path ending in .worktrees/sp19
git branch --show-current          # expect pcd/sp19-pcd-performance-snapshot
```

If either is wrong, the subagent must refuse to proceed and surface the mismatch. Per the SP13/SP14/SP15/SP16/SP17/SP18 subagent-wrong-worktree lesson.

**Gate G4 — Working baseline.** Before Task 1, the local repo at the worktree branch tip must have:
- `pnpm typecheck` green across all packages
- `pnpm test` green (target: post-SP18 count — schemas ≥262 / db ≥107+2skip / pipeline ≥1600+, matching the SP18 land state)
- `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"` clean modulo the 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`
- `pnpm prisma migrate status` clean (all SP1–SP18 migrations applied; latest migration directory is `20260515121259_pcd_identity_snapshot_sp18_synthetic_routing_provenance`)
- `git status` clean on the worktree branch

---

## File map

**New files (created in this plan):**

```
packages/schemas/src/pcd-performance-snapshot.ts                                       [Task 2]
packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts                        [Task 2]

packages/db/prisma/migrations/<ts>_pcd_performance_snapshot_sp19/
  migration.sql                                                                        [Task 3]

packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts                        [Task 4]
packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts                       [Task 4]
packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts         [Task 4]
packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts        [Task 4]

packages/creative-pipeline/src/pcd/performance-snapshot/
  performance-snapshot-version.ts                                                      [Task 5]
  performance-snapshot-version.test.ts                                                 [Task 5]
  pcd-sp19-performance-snapshot-store.ts                                               [Task 6]
  stamp-pcd-performance-snapshot.ts                                                    [Task 7]
  stamp-pcd-performance-snapshot.test.ts                                               [Task 7]
  write-pcd-performance-snapshot.ts                                                    [Task 8]
  write-pcd-performance-snapshot.test.ts                                               [Task 8]
  index.ts                                                                             [Task 8 — subdir barrel; created at end of Task 8 so Task 9 can scan it]
  sp19-anti-patterns.test.ts                                                           [Task 9]
```

**Modified files (existing — edits only):**

```
packages/schemas/src/index.ts                                                          [Task 2 — re-export SP19 schemas]
packages/db/prisma/schema.prisma                                                       [Task 3 — ADD new model PcdPerformanceSnapshot]
packages/creative-pipeline/src/index.ts                                                [Task 11 — root package barrel re-export of ./pcd/performance-snapshot/index.js]

packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts                [Task 10 — allowlist widen]
packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts                    [Task 10]
packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts                  [Task 10]
packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts             [Task 10]
packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts                 [Task 10]
packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts               [Task 10]
packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts                   [Task 10]
packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts         [Task 10]
packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts         [Task 10]
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts [Task 10]
```

(Subagent: verify allowlist paths in Task 10 against the actual directory tree. Use `find packages/creative-pipeline/src/pcd -name "sp*-anti-patterns.test.ts"` to enumerate.)

**Files NOT edited (Guardrail B — source-freeze through SP18):**

- All SP4 files: `pcd-identity-snapshot-writer.ts`, `tier-policy.ts`, `provider-capability-matrix.ts`, `provider-router.ts`, `tier3-routing-rules.ts`
- All SP6/SP7/SP8 source bodies
- All SP9 source bodies including `stamp-pcd-provenance.ts`, `write-pcd-identity-snapshot-with-provenance.ts`
- All SP10A/SP10B/SP10C source bodies
- All SP11/SP12/SP13/SP14/SP15/SP16/SP17 source bodies
- All SP18 source bodies: `stamp-pcd-synthetic-routing-decision.ts`, `write-pcd-identity-snapshot-with-synthetic-routing.ts`, `synthetic-routing-provenance-version.ts`, `pcd-sp18-identity-snapshot-store.ts`, `pcd-synthetic-routing-provenance.ts`
- `packages/schemas/src/pcd-identity.ts` (the SP4-era `PcdIdentitySnapshotSchema` stays narrow — Guardrail E)
- `packages/schemas/src/pcd-synthetic-selector.ts` (`metricsSnapshotVersion: z.null()` stays narrow — Guardrail I; SP20's job to widen)
- `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (post-SP18 source frozen)
- `packages/db/prisma/schema.prisma` — only ADD the new `PcdPerformanceSnapshot` model. **No `PcdIdentitySnapshot` or `ProductQcResult` field changes. No `AssetRecord` database-column widen.** SP19 may add the required Prisma-only opposite-relation field `performanceSnapshot PcdPerformanceSnapshot?` on `AssetRecord` (Prisma 5 mandates the back-reference for the 1:1 relation declared on `PcdPerformanceSnapshot.assetRecord`); the migration SQL must not `ALTER TABLE AssetRecord`. Anti-pattern test #5 enforces both halves: existing column lists intact AND migration SQL untouched on `AssetRecord`.

---

## Task 1: Pre-flight gate (verification only — no commit)

**Files:** none modified. This task verifies the worktree is correctly set up and captures the source-freeze SHA into the plan body for Task 9 use.

- [ ] **Step 1.1: Verify worktree position**

Run:
```bash
pwd
git branch --show-current
git log --oneline -1
```

Expected:
- `pwd` ends in `.worktrees/sp19`
- branch is `pcd/sp19-pcd-performance-snapshot`
- HEAD is at or descendant of `544816a`

- [ ] **Step 1.2: Verify source-freeze baseline SHAs are on HEAD**

Run:
```bash
git merge-base --is-ancestor 544816a HEAD && echo "OK: 544816a is on HEAD"
git merge-base --is-ancestor 817db22 HEAD && echo "OK: 817db22 is on HEAD"
```

Expected: both `OK:` lines printed.

- [ ] **Step 1.3: Verify working baseline**

Run:
```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected:
- typecheck: clean across all packages
- test: all green (post-SP18 count: schemas ≥262, db ≥107+2skip, pipeline ≥1600+)
- prettier: only the 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`

- [ ] **Step 1.4: Capture migration timestamp prefix**

Run:
```bash
date -u +"%Y%m%d%H%M%S"
```

Record the output for use in Task 3 as the migration directory prefix (e.g., `20260515160000_pcd_performance_snapshot_sp19`).

- [ ] **Step 1.5: No commit. Proceed to Task 2.**

---

## Task 2: SP19 schemas (`pcd-performance-snapshot.ts` + tests + barrel widen)

**Files:**
- Create: `packages/schemas/src/pcd-performance-snapshot.ts`
- Create: `packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts`
- Modify: `packages/schemas/src/index.ts` (re-export new schemas)

This task ships the full SP19 zod schema surface in one task: the error-category enum, the input discriminated union (3 branches: success / failure / manual_skip), the forensic reason Json shape, and the payload schema. The schemas-package convention is `__tests__/<name>.test.ts` (SP14 lesson, codified by SP15 — barrel widened upfront, Guardrail J).

- [ ] **Step 2.1: Write failing test file**

Create `packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdPerformanceErrorCategorySchema,
  PcdPerformanceSnapshotInputSchema,
  PcdPerformanceSnapshotPayloadSchema,
  PcdPerformanceSnapshotReasonSchema,
} from "../pcd-performance-snapshot.js";

describe("PcdPerformanceErrorCategorySchema", () => {
  it("accepts the 5 enum values", () => {
    for (const v of [
      "provider_timeout",
      "provider_error",
      "qc_rejection",
      "policy_denial",
      "internal_error",
    ] as const) {
      expect(() => PcdPerformanceErrorCategorySchema.parse(v)).not.toThrow();
    }
  });

  it("rejects unknown error category", () => {
    expect(() => PcdPerformanceErrorCategorySchema.parse("unknown")).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — success branch", () => {
  const validSuccess = {
    terminalKind: "success" as const,
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD" as const,
    costActualReason: null,
  };

  it("parses a well-formed success input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validSuccess);
    expect(parsed.terminalKind).toBe("success");
    if (parsed.terminalKind === "success") {
      expect(parsed.actualCostUsd).toBe(0.42);
      expect(parsed.currency).toBe("USD");
    }
  });

  it("rejects success with actualCostUsd null", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, actualCostUsd: null }),
    ).toThrow();
  });

  it("rejects success with negative latencyMs", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, latencyMs: -1 }),
    ).toThrow();
  });

  it("rejects success with attemptNumber 0", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, attemptNumber: 0 }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — failure branch", () => {
  const validFailure = {
    terminalKind: "failure" as const,
    assetRecordId: "asset_xyz",
    attemptNumber: 2,
    providerCalled: "seedance",
    latencyMs: 30000,
    actualCostUsd: null,
    currency: null,
    errorCategory: "provider_timeout" as const,
    costActualReason: null,
  };

  it("parses a well-formed failure input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validFailure);
    expect(parsed.terminalKind).toBe("failure");
    if (parsed.terminalKind === "failure") {
      expect(parsed.errorCategory).toBe("provider_timeout");
      expect(parsed.actualCostUsd).toBeNull();
    }
  });

  it("rejects failure with actualCostUsd number", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validFailure, actualCostUsd: 0.1 }),
    ).toThrow();
  });

  it("rejects failure missing errorCategory", () => {
    const { errorCategory: _e, ...rest } = validFailure;
    expect(() => PcdPerformanceSnapshotInputSchema.parse(rest)).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — manual_skip branch", () => {
  const validSkip = {
    terminalKind: "manual_skip" as const,
    assetRecordId: "asset_lmn",
    attemptNumber: 1,
    providerCalled: "dalle",
    latencyMs: 0,
    actualCostUsd: null,
    currency: null,
    costActualReason: null,
  };

  it("parses a well-formed manual_skip input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validSkip);
    expect(parsed.terminalKind).toBe("manual_skip");
  });

  it("rejects manual_skip with currency USD", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSkip, currency: "USD" }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotReasonSchema", () => {
  it("parses a well-formed reason", () => {
    const parsed = PcdPerformanceSnapshotReasonSchema.parse({
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: "2026-05-15T12:00:00.000Z",
      costActual: null,
    });
    expect(parsed.performanceSnapshotVersion).toBe("pcd-performance-snapshot@1.0.0");
  });

  it("rejects empty performanceSnapshotVersion", () => {
    expect(() =>
      PcdPerformanceSnapshotReasonSchema.parse({
        performanceSnapshotVersion: "",
        capturedAt: "2026-05-15T12:00:00.000Z",
        costActual: null,
      }),
    ).toThrow();
  });

  it("rejects invalid datetime", () => {
    expect(() =>
      PcdPerformanceSnapshotReasonSchema.parse({
        performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
        capturedAt: "not-a-date",
        costActual: null,
      }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotPayloadSchema", () => {
  it("parses a well-formed payload", () => {
    const parsed = PcdPerformanceSnapshotPayloadSchema.parse({
      assetRecordId: "asset_abc",
      terminalKind: "success",
      errorCategory: null,
      latencyMs: 1234,
      actualCostUsd: 0.42,
      currency: "USD",
      costActualReason: {
        performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
        capturedAt: "2026-05-15T12:00:00.000Z",
        costActual: null,
      },
      attemptNumber: 1,
      providerCalled: "kling",
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: new Date("2026-05-15T12:00:00.000Z"),
    });
    expect(parsed.terminalKind).toBe("success");
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test pcd-performance-snapshot
```

Expected: FAIL — cannot resolve `../pcd-performance-snapshot.js`.

- [ ] **Step 2.3: Implement the schema file**

Create `packages/schemas/src/pcd-performance-snapshot.ts`:

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

export const PcdPerformanceSnapshotReasonSchema = z
  .object({
    performanceSnapshotVersion: z.string().min(1),
    capturedAt: z.string().datetime(),
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();
export type PcdPerformanceSnapshotReason = z.infer<typeof PcdPerformanceSnapshotReasonSchema>;

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

- [ ] **Step 2.4: Widen the schemas barrel**

Edit `packages/schemas/src/index.ts` — append (preserving alphabetical or near-alphabetical placement among `pcd-*` exports):

```ts
export * from "./pcd-performance-snapshot.js";
```

- [ ] **Step 2.5: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/schemas test pcd-performance-snapshot
pnpm --filter @creativeagent/schemas typecheck
```

Expected: all SP19 schema tests pass; typecheck clean.

- [ ] **Step 2.6: Commit**

```bash
git add packages/schemas/src/pcd-performance-snapshot.ts \
        packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP19 — PcdPerformanceSnapshot zod schemas (input/reason/payload)"
```

---

## Task 3: Prisma migration + `schema.prisma` widen (ADD new model)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_pcd_performance_snapshot_sp19/migration.sql`

Net-new model — NOT a widen of an existing one. Additive migration. `onDelete: Restrict` (not `Cascade`). No `@@index` lines beyond the unique-FK index that Prisma generates for `assetRecordId @unique`.

**CRITICAL — test cleanup delete-order:** Because `onDelete: Restrict` is used, any test that creates an `AssetRecord` + `PcdPerformanceSnapshot` pair must delete the `PcdPerformanceSnapshot` first during cleanup. Deleting the `AssetRecord` first will fail with an FK violation. This applies to the new Prisma roundtrip tests in Task 4 and any future tests that exercise the joined model. Document this in the migration directory's `README` or as a header comment in the migration SQL (we use a SQL comment).

- [ ] **Step 3.1: Locate the AssetRecord opposite-relation line for back-reference (optional)**

Run:
```bash
grep -n "identitySnapshot\s*PcdIdentitySnapshot" packages/db/prisma/schema.prisma
```

You should see exactly one match in the `AssetRecord` block (around the post-SP6 area). We will mirror this pattern by adding an opposite `performanceSnapshot PcdPerformanceSnapshot?` relation on `AssetRecord`. **This is a Prisma client-side convenience only; it does NOT modify the underlying `AssetRecord` table columns, so it does not violate Guardrail E (which forbids widening the field LIST of `AssetRecord` in the database sense).** The anti-pattern test #5 must be written to allow this single relation-line addition; see Task 9.

- [ ] **Step 3.2: Edit `schema.prisma` — add opposite relation on `AssetRecord`**

In `packages/db/prisma/schema.prisma`, locate the `AssetRecord` block. Append (immediately after the existing `identitySnapshot    PcdIdentitySnapshot?` line):

```prisma
  performanceSnapshot PcdPerformanceSnapshot?
```

The full surrounding context after edit (for reference):

```prisma
  createdAt           DateTime @default(now())

  identitySnapshot    PcdIdentitySnapshot?
  performanceSnapshot PcdPerformanceSnapshot?

  @@unique([specId, attemptNumber, provider])
```

Do not alter any other line in `AssetRecord`.

- [ ] **Step 3.3: Edit `schema.prisma` — add the new model**

Append the new `PcdPerformanceSnapshot` model AFTER the existing `PcdIdentitySnapshot` block (preserving the existing post-SP18 column shape of `PcdIdentitySnapshot` byte-for-byte). The new model:

```prisma
// SP19 — PcdPerformanceSnapshot. Post-completion observability per AssetRecord
// attempt. 1:1 with AssetRecord on assetRecordId @unique. Standalone writer;
// captured at terminal-state time (success / failure / manual_skip). No
// indexes in v1 (assetRecordId @unique already provides the lookup index).
// onDelete: Restrict — historical performance survives accidental asset
// deletion. Test cleanup MUST delete PcdPerformanceSnapshot rows BEFORE their
// referenced AssetRecord rows.
//
// MERGE-BACK: net-new SP19 model. No reconciliation needed at Switchboard
// merge (net-new on both sides). Switchboard may have a parallel
// CreativeJobPerformance or AssetTelemetry concept; reconcile then.
model PcdPerformanceSnapshot {
  id                          String      @id @default(cuid())
  assetRecordId               String      @unique
  assetRecord                 AssetRecord @relation(fields: [assetRecordId], references: [id], onDelete: Restrict)

  terminalKind                String      // "success" | "failure" | "manual_skip"
  errorCategory               String?     // null on success / manual_skip; one of 5 enum values on failure

  latencyMs                   Int         // always populated; failure latency = time-to-failure

  actualCostUsd               Float?      // null on failure / manual_skip
  currency                    String?     // "USD" on success; null on failure / manual_skip
  costActualReason            Json        // forensic record-shape; always populated

  attemptNumber               Int         // denormalized from AssetRecord.attemptNumber
  providerCalled              String      // denormalized from AssetRecord.provider

  performanceSnapshotVersion  String      // forensic version literal (currently "pcd-performance-snapshot@1.0.0")
  capturedAt                  DateTime    // authoritative stamp time from the stamper; distinct from createdAt

  createdAt                   DateTime    @default(now())
}
```

- [ ] **Step 3.4: Hand-author the migration SQL**

Create the migration directory using the timestamp from Step 1.4. Example: `packages/db/prisma/migrations/20260515160000_pcd_performance_snapshot_sp19/migration.sql`.

```sql
-- SP19: PcdPerformanceSnapshot — post-completion observability per AssetRecord attempt.
-- Net-new table. Additive. onDelete RESTRICT (not CASCADE) — historical performance
-- survives accidental asset-record deletion. Test cleanup MUST delete
-- PcdPerformanceSnapshot rows BEFORE their referenced AssetRecord rows.
-- No @@index lines in v1 (assetRecordId @unique already provides the lookup index).

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

- [ ] **Step 3.5: Regenerate the Prisma client**

Run:
```bash
pnpm db:generate
```

Expected: `prisma generate` completes without error; the `pcdPerformanceSnapshot` model is now available on the generated client.

- [ ] **Step 3.6: Verify typecheck (Prisma client surface)**

Run:
```bash
pnpm typecheck
```

Expected: clean (no consumers of the new model yet; Tasks 4–8 will exercise it).

- [ ] **Step 3.7: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/<ts>_pcd_performance_snapshot_sp19/migration.sql
git commit -m "feat(pcd): SP19 — PcdPerformanceSnapshot Prisma model + additive migration (onDelete Restrict)"
```

(Replace `<ts>` with the actual timestamp directory name.)

---

## Task 4: Prisma store + reader adapters + Prisma roundtrip tests

**Files:**
- Create: `packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts`
- Create: `packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts`
- Create: `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts`
- Create: `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts`

Two adapters: one write-side (`createForAssetRecord`), one read-side (`findByAssetRecordId`). Each has a mocked-Prisma roundtrip test. Match the post-SP18 patterns in `prisma-pcd-identity-snapshot-store.ts` and `prisma-pcd-identity-snapshot-reader.ts` for `PrismaClient` injection style.

- [ ] **Step 4.1: Write failing store test**

Create `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";
import { PrismaPcdPerformanceSnapshotStore } from "../prisma-pcd-performance-snapshot-store.js";

function makePayload(
  overrides: Partial<PcdPerformanceSnapshotPayload> = {},
): PcdPerformanceSnapshotPayload {
  return {
    assetRecordId: "asset_abc",
    terminalKind: "success",
    errorCategory: null,
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD",
    costActualReason: {
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: "2026-05-15T12:00:00.000Z",
      costActual: null,
    },
    attemptNumber: 1,
    providerCalled: "kling",
    performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
    capturedAt: new Date("2026-05-15T12:00:00.000Z"),
    ...overrides,
  };
}

describe("PrismaPcdPerformanceSnapshotStore.createForAssetRecord", () => {
  it("calls prisma.pcdPerformanceSnapshot.create with mapped payload", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(makePayload());
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.data.assetRecordId).toBe("asset_abc");
    expect(call.data.terminalKind).toBe("success");
    expect(call.data.actualCostUsd).toBe(0.42);
    expect(call.data.currency).toBe("USD");
    expect(call.data.costActualReason).toEqual({
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: "2026-05-15T12:00:00.000Z",
      costActual: null,
    });
  });

  it("writes null actualCostUsd / currency for failure inputs", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(
      makePayload({
        terminalKind: "failure",
        errorCategory: "provider_timeout",
        actualCostUsd: null,
        currency: null,
      }),
    );
    const call = create.mock.calls[0][0];
    expect(call.data.actualCostUsd).toBeNull();
    expect(call.data.currency).toBeNull();
    expect(call.data.errorCategory).toBe("provider_timeout");
  });

  it("rethrows Prisma errors (unique constraint)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Unique constraint failed"));
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await expect(store.createForAssetRecord(makePayload())).rejects.toThrow(
      "Unique constraint failed",
    );
  });

  it("rethrows Prisma errors (FK violation)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Foreign key constraint failed"));
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await expect(store.createForAssetRecord(makePayload())).rejects.toThrow(
      "Foreign key constraint failed",
    );
  });

  it("passes capturedAt as a Date object (not ISO string)", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(makePayload());
    const call = create.mock.calls[0][0];
    expect(call.data.capturedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 4.2: Write failing reader test**

Create `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PrismaPcdPerformanceSnapshotReader } from "../prisma-pcd-performance-snapshot-reader.js";

describe("PrismaPcdPerformanceSnapshotReader.findByAssetRecordId", () => {
  it("returns the mapped payload when the row exists", async () => {
    const row = {
      id: "row_1",
      assetRecordId: "asset_abc",
      terminalKind: "success",
      errorCategory: null,
      latencyMs: 1234,
      actualCostUsd: 0.42,
      currency: "USD",
      costActualReason: {
        performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
        capturedAt: "2026-05-15T12:00:00.000Z",
        costActual: null,
      },
      attemptNumber: 1,
      providerCalled: "kling",
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: new Date("2026-05-15T12:00:00.000Z"),
      createdAt: new Date("2026-05-15T12:00:01.000Z"),
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    const result = await reader.findByAssetRecordId("asset_abc");
    expect(result).not.toBeNull();
    expect(result?.assetRecordId).toBe("asset_abc");
    expect(result?.terminalKind).toBe("success");
    expect(result?.actualCostUsd).toBe(0.42);
  });

  it("returns null when the row does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    const result = await reader.findByAssetRecordId("asset_nope");
    expect(result).toBeNull();
  });

  it("passes the correct where clause to Prisma", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    await reader.findByAssetRecordId("asset_abc");
    expect(findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "asset_abc" },
    });
  });
});
```

- [ ] **Step 4.3: Run both tests to verify they fail**

```bash
pnpm --filter @creativeagent/db test pcd-performance-snapshot
```

Expected: FAIL — cannot resolve `../prisma-pcd-performance-snapshot-store.js` / `-reader.js`.

- [ ] **Step 4.4: Implement the store adapter**

Create `packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts`:

```ts
// SP19 — PrismaClient-backed write adapter for PcdPerformanceSnapshot.
// Mirrors the post-SP18 PrismaPcdIdentitySnapshotStore pattern: thin wrapper
// over prisma.pcdPerformanceSnapshot.create, no decision logic in this file.
//
// MERGE-BACK: test cleanup delete-order — onDelete: Restrict means
// PcdPerformanceSnapshot rows must be deleted BEFORE their AssetRecord
// rows in any test that creates both.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";

export class PrismaPcdPerformanceSnapshotStore {
  constructor(private readonly client: Pick<PrismaClient, "pcdPerformanceSnapshot">) {}

  async createForAssetRecord(payload: PcdPerformanceSnapshotPayload): Promise<void> {
    await this.client.pcdPerformanceSnapshot.create({
      data: {
        assetRecordId: payload.assetRecordId,
        terminalKind: payload.terminalKind,
        errorCategory: payload.errorCategory,
        latencyMs: payload.latencyMs,
        actualCostUsd: payload.actualCostUsd,
        currency: payload.currency,
        costActualReason: payload.costActualReason as unknown as Prisma.InputJsonValue,
        attemptNumber: payload.attemptNumber,
        providerCalled: payload.providerCalled,
        performanceSnapshotVersion: payload.performanceSnapshotVersion,
        capturedAt: payload.capturedAt,
      },
    });
  }
}
```

- [ ] **Step 4.5: Implement the reader adapter**

Create `packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts`:

```ts
// SP19 — PrismaClient-backed read adapter for PcdPerformanceSnapshot.
// Returns null for missing rows (pre-SP19 AssetRecord rows have no companion).
// SP20 selector consumer treats null as "no historical performance data."

import type { PrismaClient } from "@prisma/client";
import type {
  PcdPerformanceErrorCategory,
  PcdPerformanceSnapshotPayload,
  PcdPerformanceSnapshotReason,
} from "@creativeagent/schemas";

export class PrismaPcdPerformanceSnapshotReader {
  constructor(private readonly client: Pick<PrismaClient, "pcdPerformanceSnapshot">) {}

  async findByAssetRecordId(
    assetRecordId: string,
  ): Promise<PcdPerformanceSnapshotPayload | null> {
    const row = await this.client.pcdPerformanceSnapshot.findUnique({
      where: { assetRecordId },
    });
    if (row === null) return null;
    return {
      assetRecordId: row.assetRecordId,
      terminalKind: row.terminalKind as "success" | "failure" | "manual_skip",
      errorCategory: row.errorCategory as PcdPerformanceErrorCategory | null,
      latencyMs: row.latencyMs,
      actualCostUsd: row.actualCostUsd,
      currency: row.currency as "USD" | null,
      costActualReason: row.costActualReason as unknown as PcdPerformanceSnapshotReason,
      attemptNumber: row.attemptNumber,
      providerCalled: row.providerCalled,
      performanceSnapshotVersion: row.performanceSnapshotVersion,
      capturedAt: row.capturedAt,
    };
  }
}
```

- [ ] **Step 4.6: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/db test pcd-performance-snapshot
pnpm --filter @creativeagent/db typecheck
```

Expected: all 8 tests pass; typecheck clean.

- [ ] **Step 4.7: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts \
        packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts \
        packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts \
        packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts
git commit -m "feat(pcd): SP19 — Prisma store + reader adapters for PcdPerformanceSnapshot"
```

---

## Task 5: `PCD_PERFORMANCE_SNAPSHOT_VERSION` constant (23rd pinned PCD constant)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts`
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.test.ts`

Sole literal site for `"pcd-performance-snapshot@"` across non-test source files. Guardrail C lock.

- [ ] **Step 5.1: Write failing test**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

describe("PCD_PERFORMANCE_SNAPSHOT_VERSION", () => {
  it("is pinned to pcd-performance-snapshot@1.0.0", () => {
    expect(PCD_PERFORMANCE_SNAPSHOT_VERSION).toBe("pcd-performance-snapshot@1.0.0");
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test performance-snapshot-version
```

Expected: FAIL — cannot resolve `./performance-snapshot-version.js`.

- [ ] **Step 5.3: Implement the constant**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts`:

```ts
// PCD slice SP19 — performance-snapshot forensic record version.
// 23rd pinned PCD constant.
// Sole literal site for "pcd-performance-snapshot@" across non-test source.
// Sole runtime import site for PCD_PERFORMANCE_SNAPSHOT_VERSION is
// stamp-pcd-performance-snapshot.ts; tests are explicitly carved out.

export const PCD_PERFORMANCE_SNAPSHOT_VERSION = "pcd-performance-snapshot@1.0.0";
```

- [ ] **Step 5.4: Run test to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test performance-snapshot-version
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts \
        packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.test.ts
git commit -m "feat(pcd): SP19 — PCD_PERFORMANCE_SNAPSHOT_VERSION (23rd pinned PCD constant)"
```

---

## Task 6: SP19 store + reader contract types

**Files:**
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/pcd-sp19-performance-snapshot-store.ts`

Type-only file: two interfaces, no behavior. Mirrors SP18's `pcd-sp18-identity-snapshot-store.ts` pattern.

- [ ] **Step 6.1: Implement the contracts**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/pcd-sp19-performance-snapshot-store.ts`:

```ts
// SP19 — store + reader contracts for PcdPerformanceSnapshot.
//
// MERGE-BACK: type-level bridge PcdSp19PerformanceSnapshotStore =
// adaptPcdSp19PerformanceSnapshotStore(prismaStore) at apps/api or
// integration scope (db layer rule forbids local assertion). Matches SP18
// U8 deferral pattern.

import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";

export interface PcdSp19PerformanceSnapshotStore {
  createForAssetRecord(input: PcdPerformanceSnapshotPayload): Promise<void>;
}

export interface PcdSp19PerformanceSnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<PcdPerformanceSnapshotPayload | null>;
}
```

- [ ] **Step 6.2: Run typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 6.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/performance-snapshot/pcd-sp19-performance-snapshot-store.ts
git commit -m "feat(pcd): SP19 — PcdSp19PerformanceSnapshotStore + Reader contract interfaces"
```

---

## Task 7: `stampPcdPerformanceSnapshot` body + co-located tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts`
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.test.ts`

Pure function. Sole runtime import site for `PCD_PERFORMANCE_SNAPSHOT_VERSION`. Defense-in-depth `PcdPerformanceSnapshotInputSchema.parse(input)`. Clock injection for tests; default `() => new Date()`. No `crypto`. No `Math.random`. No `Date.now()` (use `new Date()` via the clock callback).

- [ ] **Step 7.1: Write failing test**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PcdPerformanceSnapshotInput } from "@creativeagent/schemas";
import { stampPcdPerformanceSnapshot } from "./stamp-pcd-performance-snapshot.js";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

const fixedDate = new Date("2026-05-15T12:00:00.000Z");
const fixedClock = () => fixedDate;

function successInput(overrides: Partial<PcdPerformanceSnapshotInput> = {}): PcdPerformanceSnapshotInput {
  return {
    terminalKind: "success",
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD",
    costActualReason: null,
    ...overrides,
  } as PcdPerformanceSnapshotInput;
}

describe("stampPcdPerformanceSnapshot — success branch", () => {
  it("stamps a payload with terminalKind=success and populated cost", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.terminalKind).toBe("success");
    expect(payload.actualCostUsd).toBe(0.42);
    expect(payload.currency).toBe("USD");
    expect(payload.errorCategory).toBeNull();
  });

  it("stamps performanceSnapshotVersion from the pinned constant", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.performanceSnapshotVersion).toBe(PCD_PERFORMANCE_SNAPSHOT_VERSION);
    expect(payload.costActualReason.performanceSnapshotVersion).toBe(PCD_PERFORMANCE_SNAPSHOT_VERSION);
  });

  it("uses the injected clock for capturedAt", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.capturedAt).toEqual(fixedDate);
    expect(payload.costActualReason.capturedAt).toBe(fixedDate.toISOString());
  });

  it("falls back to new Date() when no clock injected", () => {
    const before = Date.now();
    const payload = stampPcdPerformanceSnapshot(successInput());
    const after = Date.now();
    expect(payload.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(payload.capturedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("is pure: identical input + clock yields deep-equal output", () => {
    const a = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    const b = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(a).toEqual(b);
  });
});

describe("stampPcdPerformanceSnapshot — failure branch", () => {
  it("stamps a payload with terminalKind=failure and null cost", () => {
    const payload = stampPcdPerformanceSnapshot(
      {
        terminalKind: "failure",
        assetRecordId: "asset_xyz",
        attemptNumber: 2,
        providerCalled: "seedance",
        latencyMs: 30000,
        actualCostUsd: null,
        currency: null,
        errorCategory: "provider_timeout",
        costActualReason: null,
      },
      { clock: fixedClock },
    );
    expect(payload.terminalKind).toBe("failure");
    expect(payload.actualCostUsd).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.errorCategory).toBe("provider_timeout");
  });
});

describe("stampPcdPerformanceSnapshot — manual_skip branch", () => {
  it("stamps a payload with terminalKind=manual_skip and nulls", () => {
    const payload = stampPcdPerformanceSnapshot(
      {
        terminalKind: "manual_skip",
        assetRecordId: "asset_lmn",
        attemptNumber: 1,
        providerCalled: "dalle",
        latencyMs: 0,
        actualCostUsd: null,
        currency: null,
        costActualReason: null,
      },
      { clock: fixedClock },
    );
    expect(payload.terminalKind).toBe("manual_skip");
    expect(payload.actualCostUsd).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.errorCategory).toBeNull();
  });
});

describe("stampPcdPerformanceSnapshot — defense-in-depth Zod parse", () => {
  it("rejects unknown terminalKind", () => {
    expect(() =>
      stampPcdPerformanceSnapshot(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { terminalKind: "bogus", assetRecordId: "a", attemptNumber: 1, providerCalled: "k", latencyMs: 0 } as any,
      ),
    ).toThrow();
  });

  it("rejects negative latencyMs", () => {
    expect(() =>
      stampPcdPerformanceSnapshot(
        successInput({ latencyMs: -1 } as Partial<PcdPerformanceSnapshotInput>),
      ),
    ).toThrow();
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-performance-snapshot
```

Expected: FAIL — cannot resolve `./stamp-pcd-performance-snapshot.js`.

- [ ] **Step 7.3: Implement the stamper**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts`:

```ts
// PCD slice SP19 — pure stamper for PcdPerformanceSnapshot.
// Sole runtime import site for PCD_PERFORMANCE_SNAPSHOT_VERSION.
// Defense-in-depth Zod parse on the input. Clock injection for tests.
// No crypto. No Math.random. No Date.now (we read via the clock callback).
//
// MERGE-BACK: runner integration. The runner (Switchboard-side) assembles
// PcdPerformanceSnapshotInput from {AssetRecord, terminal-state observation}
// and calls writePcdPerformanceSnapshot at terminal-state time. SP19 does
// not own the call site.

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
  const parsed = PcdPerformanceSnapshotInputSchema.parse(input);
  const now = stores.clock?.() ?? new Date();
  const errorCategory = parsed.terminalKind === "failure" ? parsed.errorCategory : null;
  const actualCostUsd = parsed.terminalKind === "success" ? parsed.actualCostUsd : null;
  const currency = parsed.terminalKind === "success" ? "USD" : null;
  return {
    assetRecordId: parsed.assetRecordId,
    terminalKind: parsed.terminalKind,
    errorCategory,
    latencyMs: parsed.latencyMs,
    actualCostUsd,
    currency,
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

- [ ] **Step 7.4: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-performance-snapshot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 10 tests pass; typecheck clean.

- [ ] **Step 7.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts \
        packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.test.ts
git commit -m "feat(pcd): SP19 — stampPcdPerformanceSnapshot pure stamper (sole version import site)"
```

---

## Task 8: `writePcdPerformanceSnapshot` writer + co-located tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.ts`
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.test.ts`

Thin store-injected writer. Stamps, then writes. Re-throws store errors. Stamper throw stops writer before store call.

- [ ] **Step 8.1: Write failing test**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  PcdPerformanceSnapshotInput,
  PcdPerformanceSnapshotPayload,
} from "@creativeagent/schemas";
import type { PcdSp19PerformanceSnapshotStore } from "./pcd-sp19-performance-snapshot-store.js";
import { writePcdPerformanceSnapshot } from "./write-pcd-performance-snapshot.js";

const fixedDate = new Date("2026-05-15T12:00:00.000Z");
const fixedClock = () => fixedDate;

function successInput(): PcdPerformanceSnapshotInput {
  return {
    terminalKind: "success",
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD",
    costActualReason: null,
  };
}

describe("writePcdPerformanceSnapshot", () => {
  it("stamps then writes to the store", async () => {
    const captured: PcdPerformanceSnapshotPayload[] = [];
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn(async (p) => {
        captured.push(p);
      }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].terminalKind).toBe("success");
    expect(captured[0].capturedAt).toEqual(fixedDate);
  });

  it("passes the stamped payload byte-equal to the store", async () => {
    let received: PcdPerformanceSnapshotPayload | undefined;
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn(async (p) => {
        received = p;
      }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(received?.performanceSnapshotVersion).toBe("pcd-performance-snapshot@1.0.0");
    expect(received?.costActualReason.performanceSnapshotVersion).toBe(
      "pcd-performance-snapshot@1.0.0",
    );
  });

  it("awaits the store call (no fire-and-forget)", async () => {
    let storeResolved = false;
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            storeResolved = true;
            resolve();
          }, 10);
        }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(storeResolved).toBe(true);
  });

  it("re-throws store errors", async () => {
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn().mockRejectedValue(new Error("DB blew up")),
    };
    await expect(
      writePcdPerformanceSnapshot(successInput(), {
        performanceSnapshotStore: store,
        clock: fixedClock,
      }),
    ).rejects.toThrow("DB blew up");
  });

  it("does not call store when stamper throws (defense-in-depth)", async () => {
    const create = vi.fn(async () => undefined);
    const store: PcdSp19PerformanceSnapshotStore = { createForAssetRecord: create };
    await expect(
      writePcdPerformanceSnapshot(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...successInput(), latencyMs: -1 } as any,
        { performanceSnapshotStore: store, clock: fixedClock },
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-performance-snapshot
```

Expected: FAIL — cannot resolve `./write-pcd-performance-snapshot.js`.

- [ ] **Step 8.3: Implement the writer**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.ts`:

```ts
// SP19 — thin store-injected writer for PcdPerformanceSnapshot.
// Standalone, NOT an orchestrator. No SP4-invariant lock-step, no SP9 stamper
// composition, no SP10A stamper composition, no SP18 stamper composition.
// SP19 captures observation-time values at terminal state; lock-stepping
// against generation-decision-time constants would be ceremonial.
//
// MERGE-BACK: future reconciliation module joins PcdPerformanceSnapshot ⨯
// PcdIdentitySnapshot on assetRecordId to compute forecast-vs-actual cost
// variance. Reconciler pins its own version constant. SP19 ships the data
// foundation only.

import type { PcdPerformanceSnapshotInput } from "@creativeagent/schemas";
import type { PcdSp19PerformanceSnapshotStore } from "./pcd-sp19-performance-snapshot-store.js";
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

- [ ] **Step 8.4: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-performance-snapshot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 5 tests pass; typecheck clean.

- [ ] **Step 8.5: Create the subdir barrel**

The subdir barrel is created at the end of Task 8 (not Task 11) so that Task 9's anti-pattern test scan can read `index.ts` without a missing-file error. By this point all symbols the barrel exports (version constant, store/reader contracts, stamper, writer) exist.

Create `packages/creative-pipeline/src/pcd/performance-snapshot/index.ts`:

```ts
// SP19 — public surface for the performance-snapshot slice.
export { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";
export type {
  PcdSp19PerformanceSnapshotReader,
  PcdSp19PerformanceSnapshotStore,
} from "./pcd-sp19-performance-snapshot-store.js";
export { stampPcdPerformanceSnapshot } from "./stamp-pcd-performance-snapshot.js";
export type { StampPcdPerformanceSnapshotStores } from "./stamp-pcd-performance-snapshot.js";
export { writePcdPerformanceSnapshot } from "./write-pcd-performance-snapshot.js";
export type { WritePcdPerformanceSnapshotStores } from "./write-pcd-performance-snapshot.js";
```

- [ ] **Step 8.6: Typecheck after barrel creation**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean. (The barrel only re-exports; if any symbol name diverged from what the prior tasks declared, this catches it now rather than at Task 9 / Task 11.)

- [ ] **Step 8.7: Commit (writer + subdir barrel together)**

```bash
git add packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.ts \
        packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.test.ts \
        packages/creative-pipeline/src/pcd/performance-snapshot/index.ts
git commit -m "feat(pcd): SP19 — writePcdPerformanceSnapshot store-injected writer + subdir barrel"
```

---

## Task 9: `sp19-anti-patterns.test.ts` — 10 structural + behavioral assertions

**Files:**
- Create: `packages/creative-pipeline/src/pcd/performance-snapshot/sp19-anti-patterns.test.ts`

Ten assertions. Source-freeze diff keyed against `544816a` (SP18 followup) over the SP1–SP18 source-body file list. Follows SP18's anti-pattern test structure.

Subagent: before writing the test body, run `find packages/creative-pipeline/src/pcd packages/db packages/schemas -name "sp*-anti-patterns.test.ts"` and `git log --oneline -5` to confirm the freeze baseline state.

- [ ] **Step 9.1: Implement the anti-pattern test**

Create `packages/creative-pipeline/src/pcd/performance-snapshot/sp19-anti-patterns.test.ts`:

```ts
// SP19 anti-pattern test — 10 structural + behavioral assertions.
//
// Source-freeze keyed against SP18 followup SHA 544816a. SP19 must not edit
// SP1–SP18 source bodies (Guardrail B). The freeze diff is asserted via
// `git diff` against the file list below.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

const PIPELINE_PCD_SRC = join(REPO_ROOT, "packages/creative-pipeline/src/pcd");
const SP19_SUBDIR = join(PIPELINE_PCD_SRC, "performance-snapshot");
const SCHEMAS_SRC = join(REPO_ROOT, "packages/schemas/src");
const DB_STORES = join(REPO_ROOT, "packages/db/src/stores");

const SP19_PIPELINE_FILES = [
  "performance-snapshot-version.ts",
  "performance-snapshot-version.test.ts",
  "pcd-sp19-performance-snapshot-store.ts",
  "stamp-pcd-performance-snapshot.ts",
  "stamp-pcd-performance-snapshot.test.ts",
  "write-pcd-performance-snapshot.ts",
  "write-pcd-performance-snapshot.test.ts",
  "sp19-anti-patterns.test.ts",
  "index.ts",
];

const SP19_SCHEMAS_FILES = [
  "pcd-performance-snapshot.ts",
  "__tests__/pcd-performance-snapshot.test.ts",
];

const SP19_DB_FILES = [
  "prisma-pcd-performance-snapshot-store.ts",
  "prisma-pcd-performance-snapshot-reader.ts",
  "__tests__/prisma-pcd-performance-snapshot-store.test.ts",
  "__tests__/prisma-pcd-performance-snapshot-reader.test.ts",
];

// SP1–SP18 source-body file list — freeze keyed against 544816a.
// Subagent: regenerate this list at execution time by walking the SP1–SP18
// subdirs and excluding *.test.ts; the canonical baseline matches what's
// committed to main at 544816a.
const FROZEN_FILES = [
  // SP4 + SP6
  "packages/creative-pipeline/src/pcd/tier-policy.ts",
  "packages/creative-pipeline/src/pcd/provider-capability-matrix.ts",
  "packages/creative-pipeline/src/pcd/provider-router.ts",
  "packages/creative-pipeline/src/pcd/tier3-routing-rules.ts",
  "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts",
  "packages/creative-pipeline/src/pcd/consent-pre-check-edit.ts",
  "packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts",
  "packages/creative-pipeline/src/pcd/consent-revocation.ts",
  // SP9
  "packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts",
  "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
  "packages/creative-pipeline/src/pcd/provenance/provenance-version.ts",
  // SP10A
  "packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts",
  "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
  "packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts",
  // SP10B + SP10C bodies
  "packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts",
  "packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts",
  "packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts",
  // SP11/SP12
  "packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-roster.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate-version.ts",
  // SP13
  "packages/creative-pipeline/src/pcd/selector/selector.ts",
  "packages/creative-pipeline/src/pcd/selector/selector-version.ts",
  // SP14
  "packages/creative-pipeline/src/pcd/disclosure/resolve-disclosure.ts",
  "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.ts",
  // SP15
  "packages/creative-pipeline/src/pcd/script/select-script.ts",
  "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
  // SP16
  "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing-version.ts",
  // SP18
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts",
  // Schemas — SP1–SP18
  "packages/schemas/src/pcd-identity.ts",
  "packages/schemas/src/pcd-tier-policy.ts",
  "packages/schemas/src/pcd-provenance.ts",
  "packages/schemas/src/pcd-cost-forecast.ts",
  "packages/schemas/src/pcd-cost-budget.ts",
  "packages/schemas/src/pcd-disclosure-template.ts",
  "packages/schemas/src/pcd-script-template.ts",
  "packages/schemas/src/pcd-synthetic-router.ts",
  "packages/schemas/src/pcd-synthetic-routing-provenance.ts",
  "packages/schemas/src/pcd-synthetic-selector.ts",
  "packages/schemas/src/pcd-preproduction.ts",
  "packages/schemas/src/creator-identity.ts",
  "packages/schemas/src/creator-identity-license.ts",
  "packages/schemas/src/creator-identity-synthetic.ts",
  // DB stores — SP1–SP18
  "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts",
  "packages/db/src/stores/prisma-pcd-identity-snapshot-reader.ts",
];

function readSp19SourceText(): string {
  let acc = "";
  for (const f of SP19_PIPELINE_FILES) {
    if (!f.endsWith(".ts")) continue;
    if (f.endsWith(".test.ts")) continue;
    acc += "\n" + readFileSync(join(SP19_SUBDIR, f), "utf8");
  }
  for (const f of SP19_SCHEMAS_FILES) {
    if (f.startsWith("__tests__")) continue;
    acc += "\n" + readFileSync(join(SCHEMAS_SRC, f), "utf8");
  }
  for (const f of SP19_DB_FILES) {
    if (f.startsWith("__tests__")) continue;
    acc += "\n" + readFileSync(join(DB_STORES, f), "utf8");
  }
  return acc;
}

describe("SP19 anti-patterns", () => {
  it("#1 — sole literal site for pcd-performance-snapshot@", () => {
    // The literal must appear in EXACTLY one non-test source file:
    // performance-snapshot-version.ts
    const out = execSync(
      `grep -rl 'pcd-performance-snapshot@' packages --include='*.ts' --exclude='*.test.ts'`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((p) => p.length > 0);
    expect(out).toEqual(["packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts"]);
  });

  it("#2 — sole runtime import site for PCD_PERFORMANCE_SNAPSHOT_VERSION", () => {
    const out = execSync(
      `grep -rl 'PCD_PERFORMANCE_SNAPSHOT_VERSION' packages --include='*.ts' --exclude='*.test.ts'`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((p) => p.length > 0);
    // Two files allowed: the constant declaration (performance-snapshot-version.ts)
    // and the sole importer (stamp-pcd-performance-snapshot.ts).
    expect(new Set(out)).toEqual(
      new Set([
        "packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts",
        "packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts",
      ]),
    );
  });

  it("#3 — no crypto import anywhere in SP19 source", () => {
    const text = readSp19SourceText();
    expect(text).not.toMatch(/from\s+["']node:crypto["']/);
    expect(text).not.toMatch(/require\(["']node:crypto["']\)/);
    expect(text).not.toMatch(/\bcrypto\.createHash\b/);
  });

  it("#4 — no @prisma/client or @creativeagent/db import in the SP19 pipeline subdir", () => {
    for (const f of SP19_PIPELINE_FILES) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const text = readFileSync(join(SP19_SUBDIR, f), "utf8");
      expect(text, `file ${f} must not import @prisma/client`).not.toMatch(
        /from\s+["']@prisma\/client["']/,
      );
      expect(text, `file ${f} must not import @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
    }
  });

  it("#5 — PcdIdentitySnapshot + ProductQcResult database columns unchanged; AssetRecord adds opposite-relation only", () => {
    // SP19 widens by ADDING the new PcdPerformanceSnapshot model + a single
    // opposite-relation line on AssetRecord (Prisma 5 requires the back-ref
    // for the 1:1 relation declared on PcdPerformanceSnapshot.assetRecord).
    // The opposite relation is Prisma-tooling-only; it does NOT generate any
    // SQL change to the AssetRecord table. The migration SQL in Task 3 does
    // not touch AssetRecord at all.
    const schema = readFileSync(join(REPO_ROOT, "packages/db/prisma/schema.prisma"), "utf8");

    // PcdIdentitySnapshot: must still have all SP18 columns.
    expect(schema).toMatch(/syntheticRoutingDecisionReason\s+Json\?/);
    expect(schema).toMatch(/videoProviderChoice\s+String\?/);
    expect(schema).toMatch(/promptHash\s+String\?/);

    // AssetRecord database columns unchanged. Opposite-relation widen permitted.
    expect(schema).toMatch(/identityDriftScore\s+Float\?/);
    expect(schema).toMatch(/consentRevokedAfterGeneration\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/identitySnapshot\s+PcdIdentitySnapshot\?/);
    expect(schema).toMatch(/performanceSnapshot\s+PcdPerformanceSnapshot\?/);

    // ProductQcResult: SP5 widening intact, no further widen.
    expect(schema).toMatch(/qcEvaluationVersion\s+String\?/);
    expect(schema).toMatch(/qcGateMatrixVersion\s+String\?/);
    expect(schema).toMatch(/gateVerdicts\s+Json\?/);

    // Migration SQL must NOT touch AssetRecord.
    const migDir = execSync(
      "ls packages/db/prisma/migrations | grep pcd_performance_snapshot_sp19",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    const migSql = readFileSync(
      join(REPO_ROOT, "packages/db/prisma/migrations", migDir, "migration.sql"),
      "utf8",
    );
    expect(migSql).not.toMatch(/ALTER\s+TABLE\s+"?AssetRecord"?/i);
  });

  it("#6 — PcdIdentitySnapshotSchema in pcd-identity.ts unchanged (no SP19 widen)", () => {
    const text = readFileSync(join(SCHEMAS_SRC, "pcd-identity.ts"), "utf8");
    expect(text).not.toMatch(/performanceSnapshotVersion/);
    expect(text).not.toMatch(/actualCostUsd/);
    expect(text).not.toMatch(/terminalKind/);
  });

  it("#7 — SP13 metricsSnapshotVersion stays z.null() (SP20's job to widen)", () => {
    const text = readFileSync(join(SCHEMAS_SRC, "pcd-synthetic-selector.ts"), "utf8");
    expect(text).toMatch(/metricsSnapshotVersion:\s*z\.null\(\)/);
    expect(text).not.toMatch(/metricsSnapshotVersion:\s*z\.string\(\)/);
  });

  it("#8 — SP1-SP18 source-body freeze (diff against 544816a is empty)", () => {
    const fileArgs = FROZEN_FILES.map((f) => `"${f}"`).join(" ");
    const diff = execSync(`git diff 544816a -- ${fileArgs}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(diff.trim(), "SP1-SP18 source bodies must be unchanged from 544816a").toBe("");
  });

  it("#9 — stamper purity: no Date.now(), no Math.random(), no inngest, no node:fs|http|https|crypto", () => {
    const text = readFileSync(join(SP19_SUBDIR, "stamp-pcd-performance-snapshot.ts"), "utf8");
    expect(text).not.toMatch(/Date\.now\(\)/);
    expect(text).not.toMatch(/Math\.random\(\)/);
    expect(text).not.toMatch(/from\s+["']inngest["']/);
    expect(text).not.toMatch(/from\s+["']node:(fs|http|https|crypto)["']/);
    // No bare @prisma/client either.
    expect(text).not.toMatch(/from\s+["']@prisma\/client["']/);
  });

  it("#10 — writer composes the stamper (positive assertion)", () => {
    const text = readFileSync(join(SP19_SUBDIR, "write-pcd-performance-snapshot.ts"), "utf8");
    expect(text).toMatch(/import\s+\{[^}]*\bstampPcdPerformanceSnapshot\b[^}]*\}/);
    expect(text).toMatch(/\bstampPcdPerformanceSnapshot\s*\(/);
    expect(text).toMatch(/\.createForAssetRecord\s*\(/);
  });
});
```

- [ ] **Step 9.2: Run the anti-pattern test**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp19-anti-patterns
```

Expected: all 10 assertions pass. If `#8` fails with non-empty diff, investigate which frozen file changed.

- [ ] **Step 9.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/performance-snapshot/sp19-anti-patterns.test.ts
git commit -m "test(pcd): SP19 — anti-pattern test (10 assertions; freeze keyed to 544816a)"
```

---

## Task 10: Allowlist maintenance — extend 10 prior anti-pattern tests

**Files:**
- Modify: 10 prior anti-pattern test files (see file map). Each gets its freeze allowlist / skip-prefix list widened to include SP19's net-new paths.

The exact form of the allowlist varies per file (`allowedEdits: Set<string>`, `if (file.startsWith("pcd/...")) continue;` etc.). Subagent: enumerate via `find` first, then open each and add entries for the SP19 net-new paths.

SP19 net-new paths to add:
- `packages/creative-pipeline/src/pcd/performance-snapshot/` (the whole subdir)
- `packages/schemas/src/pcd-performance-snapshot.ts`
- `packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts`
- `packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts`
- `packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts`
- `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-store.test.ts`
- `packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-reader.test.ts`
- `packages/schemas/src/index.ts` (barrel re-export added in Task 2 — only some prior tests assert on this; add only where needed)
- `packages/creative-pipeline/src/index.ts` (barrel re-export added in Task 11 — only some prior tests assert on this; add only where needed)
- `packages/db/prisma/schema.prisma` (new model added in Task 3 — only some prior tests assert on this)

- [ ] **Step 10.1: Enumerate prior anti-pattern tests**

```bash
find packages/creative-pipeline/src/pcd -name "sp*-anti-patterns.test.ts" -type f
find packages/creative-pipeline/src/pcd -name "sp*-anti-pattern*.test.ts" -type f
```

Expected output (set; exact order may vary):
- sp9-anti-patterns.test.ts
- sp10a-anti-patterns.test.ts
- sp10b-anti-patterns.test.ts
- sp10c-anti-patterns.test.ts
- sp13-anti-patterns.test.ts
- sp14-anti-patterns.test.ts
- sp15-anti-patterns.test.ts
- sp16-anti-patterns.test.ts
- sp17-anti-patterns.test.ts
- sp18-anti-patterns.test.ts

(SP6, SP7, SP8, SP11, SP12 also have anti-pattern tests but those don't carry source-freeze allowlists — verify by `grep -l "allowedEdits\|frozenFiles\|startsWith" <file>`.)

- [ ] **Step 10.2: Run the full test suite to see which prior anti-pattern tests are NOW failing**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Capture the list of failing anti-pattern tests. These are the ones that need allowlist widening. Some prior tests use prefix-based skip lists that may already cover SP19's paths; others use exact-match allowlists that need explicit entries.

- [ ] **Step 10.3: Widen each failing test's allowlist**

For each failing prior anti-pattern test, open the test file and locate the freeze allowlist mechanism. Two patterns are common:

**Pattern A — exact-match allowlist:**

```ts
const allowedEdits = new Set<string>([
  // ... existing entries
  "packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts",
  "packages/creative-pipeline/src/pcd/performance-snapshot/pcd-sp19-performance-snapshot-store.ts",
  "packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts",
  "packages/creative-pipeline/src/pcd/performance-snapshot/write-pcd-performance-snapshot.ts",
  "packages/creative-pipeline/src/pcd/performance-snapshot/index.ts",
  "packages/schemas/src/pcd-performance-snapshot.ts",
  "packages/db/src/stores/prisma-pcd-performance-snapshot-store.ts",
  "packages/db/src/stores/prisma-pcd-performance-snapshot-reader.ts",
]);
```

**Pattern B — prefix skip-list inside the file-walker:**

```ts
if (file.startsWith("packages/creative-pipeline/src/pcd/performance-snapshot/")) continue;
if (file.startsWith("packages/db/src/stores/prisma-pcd-performance-snapshot-")) continue;
if (file === "packages/schemas/src/pcd-performance-snapshot.ts") continue;
```

Match whichever pattern each prior test uses. Add entries idempotently — if the test already had a "post-SP18 entries" trailing block, keep that style.

- [ ] **Step 10.4: Re-run all prior anti-pattern tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test anti-pattern
```

Expected: every prior anti-pattern test passes, plus the new SP19 test.

- [ ] **Step 10.5: Commit (single chore commit)**

```bash
git add packages/creative-pipeline/src/pcd/*/sp*-anti-patterns.test.ts
git commit -m "chore(pcd): SP19 — extend SP9/10A/10B/10C/13/14/15/16/17/18 anti-pattern allowlists"
```

---

## Task 11: Root creative-pipeline package barrel widen

**Files:**
- Modify: `packages/creative-pipeline/src/index.ts`

The subdir barrel (`packages/creative-pipeline/src/pcd/performance-snapshot/index.ts`) was created in Task 8 Step 8.5 so Task 9's anti-pattern test could scan it. Task 11 only widens the root package barrel to re-export the subdir.

- [ ] **Step 11.1: Widen the root package barrel**

Edit `packages/creative-pipeline/src/index.ts` — append (after existing SP18 re-export):

```ts
export * from "./pcd/performance-snapshot/index.js";
```

- [ ] **Step 11.2: Typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 11.3: Commit**

```bash
git add packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP19 — root creative-pipeline barrel re-exports performance-snapshot subdir"
```

---

## Task 12: Final integration sweep

**Files:** none modified. Verification + final commit (if any chore cleanups surface).

- [ ] **Step 12.1: Full repo typecheck**

```bash
pnpm typecheck
```

Expected: clean across all packages.

- [ ] **Step 12.2: Full repo test suite**

```bash
pnpm test
```

Expected: all green. Anticipated counts (approximate):
- schemas: +12 tests (Task 2) → ≥274
- db: +8 tests (Task 4) → ≥115+2skip
- creative-pipeline: +1 (Task 5) +10 (Task 7) +5 (Task 8) +10 (Task 9) = +26 → ≥1626+

- [ ] **Step 12.3: Prettier check**

```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: only the 2 SP5-baseline warnings (`tier-policy.ts` / `tier-policy.test.ts`). If new warnings appear, run `pnpm exec prettier --write <files>` on the SP19 net-new files and commit the formatting fix.

- [ ] **Step 12.4: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 12.5: Verify migration status**

```bash
pnpm prisma migrate status
```

Expected: all migrations applied; the new `<ts>_pcd_performance_snapshot_sp19` migration is at the tip.

- [ ] **Step 12.6: Verify the anti-pattern source-freeze one more time**

```bash
git diff 544816a -- $(grep -A 1000 "FROZEN_FILES = \[" packages/creative-pipeline/src/pcd/performance-snapshot/sp19-anti-patterns.test.ts | grep '"packages/' | sed 's/[", ]//g' | tr '\n' ' ')
```

Expected: empty output (no diff in any frozen file).

- [ ] **Step 12.7: Commit (if Step 12.3 needed prettier fixes)**

If Step 12.3 surfaced formatting fixes, commit them:

```bash
git add -u
git commit -m "chore(pcd): SP19 — prettier formatting on SP19 net-new files"
```

If nothing to commit, skip this step.

- [ ] **Step 12.8: Final verification — git status clean**

```bash
git status
```

Expected: `working tree clean`. Ready for PR.

---

## Self-Review Checklist (run after writing this plan)

**1. Spec coverage** — every section of the SP19 design doc has a task:
- ✅ Schemas (§3.2) → Task 2
- ✅ Prisma model + migration (§3.3) → Task 3
- ✅ Store + reader contracts (§3.4) → Task 6 + Task 4 (Prisma adapters)
- ✅ Stamper (§3.5) → Task 7
- ✅ Writer (§3.6) → Task 8
- ✅ Anti-pattern test (§5.4) → Task 9
- ✅ Allowlist maintenance (§5.5) → Task 10
- ✅ Subdir barrel (§3.1 file layout) → Task 8 Step 8.5 (moved up from Task 11 so Task 9 can scan it)
- ✅ Root creative-pipeline barrel widen (§3.1 file layout) → Task 11
- ✅ Final integration sweep → Task 12
- ✅ Pre-flight gate (working baseline) → Task 1
- ✅ Cleanup delete-order documentation (user emphasis) → Task 3 step 3.4 SQL header + model comment

**2. Placeholder scan** — searched plan for TBD/TODO/incomplete:
- `<ts>` in migration directory name is intentional, resolved at Task 1 step 1.4.
- Anti-pattern test `FROZEN_FILES` array (Task 9 step 9.1) is a representative list; subagent verifies via `find` at execution time. The comment in the test code explicitly instructs the subagent to regenerate.
- "approximately N tests" estimates in Task 12 step 12.2 are plan-level summaries, not implementation blockers.

**3. Type consistency** — verified across tasks:
- `PcdPerformanceSnapshotPayload` exported from schemas (Task 2) and consumed by Prisma adapters (Task 4), store contract (Task 6), stamper (Task 7), writer (Task 8). ✅
- `PcdSp19PerformanceSnapshotStore` interface declared in Task 6, implemented in Task 4's `PrismaPcdPerformanceSnapshotStore`, consumed by Task 8's writer via the `performanceSnapshotStore` field on `WritePcdPerformanceSnapshotStores`. ✅
- `PCD_PERFORMANCE_SNAPSHOT_VERSION` exported from Task 5, imported by Task 7 (sole import site), asserted in Task 9 anti-pattern #2. ✅
- Method name `createForAssetRecord` consistent across Tasks 4, 6, 8, 9. ✅
- Method name `findByAssetRecordId` consistent across Tasks 4, 6. ✅

**4. Spec requirements with no task** — none identified.

---

## Notes for the implementer

**SP19 is the simpler slice in the post-SP15 series.** No `crypto`, no orchestrator lock-step, no provider-pairing matrix, no schema discriminator across 3-5 branches with `.readonly()` quirks (SP19 has 3 branches but they live in a `z.union` with explicit literal types, not a discriminatedUnion — Zod 3.x readonly carve-out is handled by the union not the discriminator). The trickiest parts are:

1. **`onDelete: Restrict` and test cleanup.** The Task 4 Prisma roundtrip tests use mocked clients, so cleanup order isn't exercised there. But any **future** test that creates real `AssetRecord` + `PcdPerformanceSnapshot` pairs must delete the snapshot first. Document this loudly in any new joined-test fixture.

2. **Anti-pattern test's `FROZEN_FILES` array.** Don't take Task 9's list verbatim. Re-walk the SP1–SP18 source subdirs and update before writing the test body. Some files in the canonical list may have been renamed in earlier slices; cross-check via `git ls-files | grep <pattern>`.

3. **Allowlist maintenance (Task 10) is the highest-friction task** in this plan. Each prior anti-pattern test uses its own allowlist mechanism. Iterate: run the failing test, read its allowlist code, add SP19 entries in the same style, re-run. Don't try to refactor multiple tests' allowlist styles to a unified format — that's out of scope and would re-open frozen-source-body diffs.

4. **The schema `index.ts` widen in Task 2 (Step 2.4) must come BEFORE any consumer.** Task 4's Prisma adapters import `PcdPerformanceSnapshotPayload` from `@creativeagent/schemas` (not from a deep path), so the barrel re-export must be in place at Task 4 run time.

5. **MERGE-BACK markers.** Five markers across the SP19 surface (see design §7). Verify all five are present at Task 12 step 12.4 lint pass; any missing marker is a documentation regression.

6. **PCD pinned constant count goes 22 → 23 at SP19 land.** Update the slice-progress memory entry post-merge (outside this plan's scope — that's a memory-write step the parent agent handles).

End of plan.
