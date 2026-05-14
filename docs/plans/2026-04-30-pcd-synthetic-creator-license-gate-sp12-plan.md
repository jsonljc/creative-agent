# SP12 — Synthetic Creator License Gate + Leasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the per-clinic licensing layer for synthetic creators on top of SP11's foundation. Add a `CreatorIdentityLicense` table (FK → `CreatorIdentity.id`, CASCADE) with three lock-types (`hard_exclusive | priority_access | soft_exclusive`), time-boxed leases, and a Prisma store + reader. Ship a pure-deterministic `licenseGate({ creatorIdentityId, clinicId, market, treatmentClass, now, leases }) → { allowed, license, reason, isSoftExclusivityOverride? }` module that mirrors `PcdTierPolicy` (SP2) shape — snapshot-only, no DB reads at decision time. **No selector, no disclosure registry, no script template, no provider-routing extension, no provenance extension.** Those are SP13–SP17.

**Architecture:** Strictly additive. The license table sits next to `CreatorIdentity` with a one-to-many relation; real-kind `CreatorIdentity` rows can technically hold license rows, but the gate is meaningful only for `kind = "synthetic"` (real creators continue to flow through SP6 consent enforcement via `consentRecordId`). The gate itself is a pure function over a caller-supplied snapshot of leases — exactly like `decidePcdGenerationAccess` in SP2. The reader exposes the one snapshot query downstream consumers (SP13 selector, SP17 provenance writer) need: "give me all active leases on this `(creator, market, treatmentClass)` tuple at this moment." No live mutable reads inside the gate; no DB writes from the gate.

**Tech Stack:** TypeScript ESM (`.js` relative imports), zod schemas with `.readonly()`, vitest 2.1.x, Prisma + Postgres, pnpm + Turborepo. One Prisma migration. No Inngest wiring. Mock-tested store + reader (matching SP11's mock convention in `packages/db/src/stores/__tests__/`).

**Source-of-truth design:** `docs/plans/2026-04-30-pcd-synthetic-creator-roster-design.md` — specifically §3.3 (lock-type semantics), §4 step 5 (per-job flow position), §11 (out-of-scope), §12 (open questions — lease default duration is item 7).

**SP11 baseline this plan extends:** `docs/plans/2026-04-30-pcd-synthetic-creator-foundation-sp11-plan.md` (shipped on `feat/pcd-synthetic-creator-roster`, currently in PR #9).

## User-locked priority invariants (do not violate)

These are non-negotiable. The anti-pattern grep tests in Task 8 enforce items 1–7 structurally.

1. **License gate is pure-deterministic and snapshot-only.** `licenseGate()` does not import `@creativeagent/db`, does not import `@prisma/client`, does not perform I/O, does not read `Date.now()` (the caller supplies `now`). All inputs flow in via the typed input record. Any future "live mutable read" inside the gate breaks the invariant.
2. **Lock-type semantics are non-negotiable.** Per design §3.3:
   - `hard_exclusive` — only the holder can use the creator in `(market, treatmentClass)`. Any *competing* hard_exclusive lease (different `clinicId`, same scope, in-window, status=active) → reason `blocked_by_hard_exclusive`. The holder itself passes with reason `active_lease`.
   - `priority_access` — multiple clinics may hold concurrent leases. Selector ordering uses `priorityRank` ASC; the gate never blocks on `priority_access`.
   - `soft_exclusive` — single primary holder by design, but additional clinics holding their own active soft_exclusive lease on the same scope pass with `isSoftExclusivityOverride: true`. The flag is captured in the decision; SP17 will record it in provenance.
3. **One Prisma migration only.** The new `CreatorIdentityLicense` table + the `licenses CreatorIdentityLicense[]` back-reference on `CreatorIdentity` land in a single migration. No second migration to "fix" anything.
4. **No edits to SP1–SP11 source bodies.** Acceptable edits: schemas barrel re-exports, db barrel re-exports, the synthetic-creator subdir barrel (`packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`), one append-only line on `CreatorIdentity` in `schema.prisma` (the `licenses` back-reference), and additive `allowlist` extensions in `sp9-anti-patterns.test.ts` (shared edit surface — SP10B is the parallel co-author). All other SP1–SP11 files stay byte-identical.
5. **No SP13+ scope leak.** SP12 does NOT introduce: `SyntheticCreatorSelector`, `DisclosureTemplate`, `DisclosureResolver`, `ScriptTemplate`, `PcdPerformanceSnapshot`, `SyntheticCreatorSelectionDecision`, provider-routing extension, SP9 provenance extension. Any task ballooning into these areas STOPS and is split.
6. **No real model runners.** SP12 does not call DALL-E, Kling, or any LLM. The gate is deterministic boolean logic over typed lease records.
7. **Lease conflict detection at lease-creation time is OUT of scope.** The store accepts whatever active leases the caller writes (subject to zod payload validation only). The gate enforces conflicts at job time — that's the v1 contract. A v1.5 slice may add overlap detection at insert; SP12 does not.
8. **Lease default duration is in the application layer, not the migration.** Per design §12 open question #7, 30-day default is a v1 guess. The store applies `effectiveFrom + 30 days` if `effectiveTo` is omitted; the migration leaves the column nullable with no DB-level default. This keeps the default tunable without a schema change.
9. **`clinicId` is a plain `String` for now.** This repo has no `Clinic` model (per `docs/SWITCHBOARD-CONTEXT.md`, Clinic is Switchboard-side). Store the foreign id as a string with a `// MERGE-BACK: replace with FK to Clinic.id` marker. Do NOT add a `Clinic` Prisma model in SP12.
10. **Real `CreatorIdentity` rows are unaffected at decision time.** The license gate is consumed only when `kind = "synthetic"`. SP12 does not edit SP6 consent enforcement, SP4 routing, or any other path that handles real creators. Real-kind rows may technically hold license rows (the FK is symmetric), but no SP12 code path reads them.

## Pre-flight verification (before starting Task 1)

**Branch context:** SP12 is based on `feat/pcd-synthetic-creator-roster` (the SP11 branch, open as PR #9 against `main`). When SP11 merges to `main`, this branch will be rebased onto `main` and any conflict in `sp9-anti-patterns.test.ts` (allowlist extensions) is resolved by union — keep both SP11 and SP12 entries. Document this rebase as a known merge-time concern in the eventual SP12 PR description.

**Worktree:** This plan is written from `/Users/jasonli/creativeagent/.worktrees/sp12` on branch `feat/pcd-synthetic-creator-license-gate`, created via `git worktree add .worktrees/sp12 -b feat/pcd-synthetic-creator-license-gate feat/pcd-synthetic-creator-roster`.

Run from worktree root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected:
- Typecheck clean across all 5 packages.
- Test suite green at the **SP11 baseline**. Capture the test count from the vitest summary line ("Test Files: X passed, Y total" / "Tests: N passed") and record it as `<SP11_BASELINE_TESTS>` for the post-flight comparison in Task 9.
- Prettier clean (or only the pre-existing legacy noise on `tier-policy.ts` — leave as-is).

Confirm branch + recent log:

```bash
git rev-parse --abbrev-ref HEAD
# expect: feat/pcd-synthetic-creator-license-gate

git log --oneline -3
# expect (top of the log to be the SP11 tip):
#   <sha>  fix(pcd): SP11 — filter inactive parents in selector query, export RosterEntry types, document listAll semantics
#   <sha>  feat(pcd): SP11 — anti-pattern grep tests
#   <sha>  feat(pcd): SP11 — 10-character synthetic creator seed roster
```

Capture the SP11-frozen-source-body baseline for Task 8's structural assertion (used to verify no SP1–SP11 source body changes throughout SP12):

```bash
git rev-parse HEAD
# Note this commit hash; use it as <SP11_BASELINE> in Task 8 (sp12-anti-patterns.test.ts).
```

Confirm a parallel SP10B session is not editing the same files. Run:

```bash
git worktree list
```

Expected: at least the `creativeagent`, `creativeagent-sp11`, and `.worktrees/sp12` worktrees. If SP10B is in a `.worktrees/sp10b` worktree, it owns `packages/creative-pipeline/src/pcd/cost/` and `packages/schemas/src/pcd-cost-forecast.ts`. SP12 must not touch those paths. The `sp9-anti-patterns.test.ts` allowlist is the only shared edit surface — additions are union-mergeable.

---

## Task 1: SP12 zod schemas — `LockType`, `LeaseStatus`, `ExclusivityScope`, `CreatorIdentityLicensePayload`

**Files:**
- Create: `packages/schemas/src/creator-identity-license.ts`
- Create: `packages/schemas/src/__tests__/creator-identity-license.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/creator-identity-license.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LockTypeSchema,
  LeaseStatusSchema,
  ExclusivityScopeSchema,
  CreatorIdentityLicensePayloadSchema,
  type CreatorIdentityLicensePayload,
} from "../creator-identity-license.js";

describe("LockTypeSchema", () => {
  it("accepts the three v1 lock types", () => {
    for (const t of ["hard_exclusive", "priority_access", "soft_exclusive"]) {
      expect(LockTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown lock types", () => {
    expect(() => LockTypeSchema.parse("exclusive")).toThrow();
    expect(() => LockTypeSchema.parse("")).toThrow();
  });
});

describe("LeaseStatusSchema", () => {
  it("accepts the four v1 lease statuses", () => {
    for (const s of ["active", "suspended", "expired", "superseded"]) {
      expect(LeaseStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown statuses", () => {
    expect(() => LeaseStatusSchema.parse("cancelled")).toThrow();
  });
});

describe("ExclusivityScopeSchema", () => {
  it("accepts market_treatment (B-tier) and free (D-tier)", () => {
    expect(ExclusivityScopeSchema.parse("market_treatment")).toBe("market_treatment");
    expect(ExclusivityScopeSchema.parse("free")).toBe("free");
  });
});

describe("CreatorIdentityLicensePayloadSchema", () => {
  const valid: CreatorIdentityLicensePayload = {
    id: "lic_test_01",
    creatorIdentityId: "cid_synth_cheryl_sg_01",
    clinicId: "clinic_test_01",
    market: "SG",
    treatmentClass: "med_spa",
    lockType: "priority_access",
    exclusivityScope: "market_treatment",
    effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
    priorityRank: 0,
    status: "active",
  };

  it("accepts a fully populated priority_access lease", () => {
    expect(CreatorIdentityLicensePayloadSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a hard_exclusive lease without priorityRank", () => {
    const hard: CreatorIdentityLicensePayload = {
      ...valid,
      lockType: "hard_exclusive",
      priorityRank: null,
    };
    expect(CreatorIdentityLicensePayloadSchema.parse(hard)).toEqual(hard);
  });

  it("accepts a soft_exclusive lease without priorityRank", () => {
    const soft: CreatorIdentityLicensePayload = {
      ...valid,
      lockType: "soft_exclusive",
      priorityRank: null,
    };
    expect(CreatorIdentityLicensePayloadSchema.parse(soft)).toEqual(soft);
  });

  it("accepts an indefinite lease (effectiveTo = null)", () => {
    expect(
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, effectiveTo: null }),
    ).toBeDefined();
  });

  it("rejects a lease with effectiveTo earlier than effectiveFrom", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({
        ...valid,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });

  it("rejects a priority_access lease with negative priorityRank", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, priorityRank: -1 }),
    ).toThrow();
  });

  it("rejects empty creatorIdentityId / clinicId / id", () => {
    expect(() => CreatorIdentityLicensePayloadSchema.parse({ ...valid, id: "" })).toThrow();
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, creatorIdentityId: "" }),
    ).toThrow();
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, clinicId: "" }),
    ).toThrow();
  });

  it("rejects unknown market / treatmentClass values (delegates to SP11 enums)", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, market: "JP" as never }),
    ).toThrow();
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, treatmentClass: "slimming" as never }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-license`
Expected: FAIL with "Cannot find module '../creator-identity-license.js'".

- [ ] **Step 3: Write the schema module**

Create `packages/schemas/src/creator-identity-license.ts`:

```ts
// PCD slice SP12 — Creator identity license payload. Per-clinic leasing
// over (creatorIdentityId, market, treatmentClass) for synthetic creators.
// Three lock-types per design spec §3.3:
//   - hard_exclusive   only the holder can use the creator at job time
//   - priority_access  multiple holders allowed; selector orders by priorityRank
//   - soft_exclusive   single primary, others pass with override flag in provenance
// The pure license-gate (`packages/creative-pipeline/src/pcd/synthetic-creator/
// license-gate.ts`) consumes this schema as a snapshot input. Real-kind
// CreatorIdentity rows continue through SP6 consent enforcement; the gate is
// invoked only for kind="synthetic".
import { z } from "zod";
import { MarketSchema, TreatmentClassSchema } from "./creator-identity-synthetic.js";

export const LockTypeSchema = z.enum(["hard_exclusive", "priority_access", "soft_exclusive"]);
export type LockType = z.infer<typeof LockTypeSchema>;

export const LeaseStatusSchema = z.enum(["active", "suspended", "expired", "superseded"]);
export type LeaseStatus = z.infer<typeof LeaseStatusSchema>;

export const ExclusivityScopeSchema = z.enum(["market_treatment", "free"]);
export type ExclusivityScope = z.infer<typeof ExclusivityScopeSchema>;

export const CreatorIdentityLicensePayloadSchema = z
  .object({
    id: z.string().min(1),
    creatorIdentityId: z.string().min(1),
    clinicId: z.string().min(1),
    market: MarketSchema,
    treatmentClass: TreatmentClassSchema,
    lockType: LockTypeSchema,
    exclusivityScope: ExclusivityScopeSchema,
    effectiveFrom: z.date(),
    effectiveTo: z.date().nullable(),
    priorityRank: z.number().int().min(0).nullable(),
    status: LeaseStatusSchema,
  })
  .readonly()
  .refine(
    (lease) => lease.effectiveTo === null || lease.effectiveTo.getTime() > lease.effectiveFrom.getTime(),
    { message: "effectiveTo must be strictly after effectiveFrom (or null for indefinite leases)" },
  );
export type CreatorIdentityLicensePayload = z.infer<typeof CreatorIdentityLicensePayloadSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-license`
Expected: PASS, all 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/creator-identity-license.ts packages/schemas/src/__tests__/creator-identity-license.test.ts
git commit -m "feat(pcd): SP12 — CreatorIdentityLicense zod schema (lock-types + lease lifecycle)"
```

---

## Task 2: Schemas barrel re-export

**Files:**
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/schemas/src/__tests__/creator-identity-license.test.ts` at the bottom:

```ts
import * as barrel from "../index.js";

describe("schemas package barrel — SP12 surface", () => {
  it("re-exports the SP12 license schemas + types", () => {
    expect(barrel.LockTypeSchema).toBeDefined();
    expect(barrel.LeaseStatusSchema).toBeDefined();
    expect(barrel.ExclusivityScopeSchema).toBeDefined();
    expect(barrel.CreatorIdentityLicensePayloadSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-license`
Expected: FAIL with "barrel.LockTypeSchema is undefined" (or similar).

- [ ] **Step 3: Add re-exports**

Append to `packages/schemas/src/index.ts`:

```ts
// SP12 — synthetic creator license gate
export * from "./creator-identity-license.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test`
Expected: full schemas test suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/index.ts packages/schemas/src/__tests__/creator-identity-license.test.ts
git commit -m "feat(pcd): SP12 — re-export CreatorIdentityLicense from schemas barrel"
```

---

## Task 3: Prisma migration — `CreatorIdentityLicense` table + relation back-reference

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_creator_identity_license_sp12/migration.sql`

- [ ] **Step 1: Edit `schema.prisma` — add the `licenses` back-reference on `CreatorIdentity`**

Find the `CreatorIdentity` model. Locate the existing `syntheticProfile CreatorIdentitySynthetic?` line (added by SP11). Immediately after it, add:

```prisma
  // SP12 — per-clinic leases for synthetic creators. Real-kind rows may
  // technically hold lease rows (the relation is symmetric), but the
  // license gate is invoked only for kind = "synthetic"; real creators
  // continue through SP6 consent enforcement via consentRecordId.
  licenses            CreatorIdentityLicense[]
```

This is the **only** edit to the existing `CreatorIdentity` model body — strictly an additive back-reference.

- [ ] **Step 2: Edit `schema.prisma` — add the new model**

Append after the `CreatorIdentitySynthetic` model (and its `@@index` block):

```prisma
// ── PCD slice SP12 — synthetic creator license / leasing ──
//
// One row per active lease. Lock-type semantics enforced by the pure
// licenseGate() module in packages/creative-pipeline; this table is the
// authoritative store for lease records but never stores a "decision".
//
// MERGE-BACK: clinicId is a plain String here because this repo has no
// Clinic model (Clinic is Switchboard-side per docs/SWITCHBOARD-CONTEXT.md).
// Replace with `clinic Clinic @relation(...)` at merge-back.
model CreatorIdentityLicense {
  id                  String          @id @default(cuid())
  creatorIdentityId   String
  creatorIdentity     CreatorIdentity @relation(fields: [creatorIdentityId], references: [id], onDelete: Cascade)

  clinicId            String

  market              String
  treatmentClass      String

  lockType            String
  exclusivityScope    String          @default("market_treatment")

  effectiveFrom       DateTime
  effectiveTo         DateTime?

  priorityRank        Int?

  status              String          @default("active")

  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  @@index([creatorIdentityId, status])
  @@index([clinicId, market, treatmentClass])
  @@index([effectiveTo])
}
```

> Note: `lockType`, `exclusivityScope`, `status`, `market`, `treatmentClass` are stored as `String` rather than Postgres enums, matching SP11's convention — zod owns the value-set contract. Adding a new lock-type later (e.g. `priority_exclusive`) requires only a zod enum extension, not a DB migration.

- [ ] **Step 3: Generate the Prisma client + migration**

Run from worktree root:

```bash
pnpm db:generate
pnpm db:migrate -- --name pcd_creator_identity_license_sp12
```

Expected:
- A new directory `packages/db/prisma/migrations/<timestamp>_pcd_creator_identity_license_sp12/`
- `migration.sql` containing: `CREATE TABLE "CreatorIdentityLicense"`, foreign-key constraint with `ON DELETE CASCADE`, three indexes
- No drops, no renames, no data backfills, no enum creation (we keep enum values in zod)

- [ ] **Step 4: Verify migration content**

Open the generated `migration.sql`. Assert manually:
- `CREATE TABLE "CreatorIdentityLicense"` includes columns: `id`, `creatorIdentityId`, `clinicId`, `market`, `treatmentClass`, `lockType`, `exclusivityScope`, `effectiveFrom`, `effectiveTo`, `priorityRank`, `status`, `createdAt`, `updatedAt`.
- `ALTER TABLE "CreatorIdentityLicense" ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES "CreatorIdentity"("id") ON DELETE CASCADE`.
- Three `CREATE INDEX` statements: `(creatorIdentityId, status)`, `(clinicId, market, treatmentClass)`, `(effectiveTo)`.
- No `DROP` statements.
- No `CREATE TYPE` statements (no new enums).

If any are missing or wrong, fix `schema.prisma` and regenerate (delete the partial migration directory first, then re-run `pnpm db:migrate -- --name pcd_creator_identity_license_sp12`).

- [ ] **Step 5: Run tests to verify nothing else broke**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, all existing SP11 tests still green. The Prisma client now exposes `prisma.creatorIdentityLicense.{create,findMany,findUnique,upsert,...}`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(pcd): SP12 — Prisma migration for CreatorIdentityLicense (additive table + FK CASCADE)"
```

---

## Task 4: db store + reader — `PrismaCreatorIdentityLicenseStore` / `…Reader`

**Files:**
- Create: `packages/db/src/stores/prisma-creator-identity-license-store.ts`
- Create: `packages/db/src/stores/prisma-creator-identity-license-reader.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creator-identity-license-store.test.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts`

- [ ] **Step 1: Write the failing store tests**

Create `packages/db/src/stores/__tests__/prisma-creator-identity-license-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityLicenseStore } from "../prisma-creator-identity-license-store.js";
import type { CreatorIdentityLicensePayload } from "@creativeagent/schemas";

function createMockPrisma() {
  return {
    creatorIdentityLicense: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

const validInput = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
  id: "lic_sp12_test_001",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_test_01",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});

describe("PrismaCreatorIdentityLicenseStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreatorIdentityLicenseStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreatorIdentityLicenseStore(prisma as never);
  });

  describe("create", () => {
    it("upserts a license payload via Prisma", async () => {
      const payload = validInput();
      await store.create(payload);

      expect(prisma.creatorIdentityLicense.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.creatorIdentityLicense.upsert.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ id: "lic_sp12_test_001" });
      expect(call?.create.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(call?.create.clinicId).toBe("clinic_test_01");
      expect(call?.create.lockType).toBe("priority_access");
      expect(call?.update.lockType).toBe("priority_access");
    });

    it("validates the payload via zod and rejects invalid input", async () => {
      await expect(store.create({ ...validInput(), id: "" })).rejects.toThrow();
      expect(prisma.creatorIdentityLicense.upsert).not.toHaveBeenCalled();
    });

    it("applies the 30-day default for effectiveTo when input.effectiveTo is omitted from the convenience helper", async () => {
      // The store's `create` requires a fully-formed payload (zod validates
      // effectiveTo: Date | null). The 30-day default lives in the
      // `withDefaultLeaseWindow` helper exported alongside the store.
      const { withDefaultLeaseWindow } = await import(
        "../prisma-creator-identity-license-store.js"
      );
      const filled = withDefaultLeaseWindow({
        id: "lic_sp12_test_002",
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        clinicId: "clinic_test_01",
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "priority_access",
        exclusivityScope: "market_treatment",
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        priorityRank: 0,
        status: "active",
      });
      expect(filled.effectiveTo?.toISOString()).toBe("2026-05-31T00:00:00.000Z");
    });

    it("withDefaultLeaseWindow preserves an explicit null effectiveTo (indefinite lease)", async () => {
      const { withDefaultLeaseWindow } = await import(
        "../prisma-creator-identity-license-store.js"
      );
      const filled = withDefaultLeaseWindow({
        id: "lic_sp12_test_003",
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        clinicId: "clinic_test_01",
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "hard_exclusive",
        exclusivityScope: "market_treatment",
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        effectiveTo: null,
        priorityRank: null,
        status: "active",
      });
      expect(filled.effectiveTo).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("updates only the status field on a license row", async () => {
      await store.updateStatus("lic_sp12_test_001", "expired");

      expect(prisma.creatorIdentityLicense.update).toHaveBeenCalledWith({
        where: { id: "lic_sp12_test_001" },
        data: { status: "expired" },
      });
    });

    it("rejects an unknown status value via zod", async () => {
      await expect(
        store.updateStatus("lic_sp12_test_001", "cancelled" as never),
      ).rejects.toThrow();
      expect(prisma.creatorIdentityLicense.update).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Write the failing reader tests**

Create `packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityLicenseReader } from "../prisma-creator-identity-license-reader.js";

function createMockPrisma() {
  return {
    creatorIdentityLicense: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  id: "lic_sp12_test_001",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_test_01",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});

describe("PrismaCreatorIdentityLicenseReader", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let reader: PrismaCreatorIdentityLicenseReader;

  beforeEach(() => {
    prisma = createMockPrisma();
    reader = new PrismaCreatorIdentityLicenseReader(prisma as never);
  });

  describe("findById", () => {
    it("returns the parsed payload when row exists", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(dbRow());
      const result = await reader.findById("lic_sp12_test_001");
      expect(result?.id).toBe("lic_sp12_test_001");
      expect(result?.lockType).toBe("priority_access");
    });

    it("returns null when no row found", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(null);
      expect(await reader.findById("lic_missing")).toBeNull();
    });

    it("throws when the row fails zod validation (data corruption guard)", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(
        dbRow({ lockType: "garbage" }),
      );
      await expect(reader.findById("lic_sp12_test_001")).rejects.toThrow();
    });
  });

  describe("findActiveByCreatorAndScope", () => {
    it("filters by (creatorIdentityId, market, treatmentClass), status='active', and effectiveFrom <= now < effectiveTo", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([dbRow()]);
      const now = new Date("2026-05-15T00:00:00.000Z");
      const result = await reader.findActiveByCreatorAndScope(
        "cid_synth_cheryl_sg_01",
        "SG",
        "med_spa",
        now,
      );

      expect(result).toHaveLength(1);
      const call = prisma.creatorIdentityLicense.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        market: "SG",
        treatmentClass: "med_spa",
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      });
    });

    it("returns empty array when no matches", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([]);
      const result = await reader.findActiveByCreatorAndScope(
        "cid_missing",
        "SG",
        "med_spa",
        new Date(),
      );
      expect(result).toEqual([]);
    });
  });

  describe("findAllByCreatorAndScope", () => {
    it("returns rows regardless of status or window — used for diagnostics / lifecycle ops", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([
        dbRow(),
        dbRow({ id: "lic_sp12_test_002", status: "expired" }),
      ]);
      const result = await reader.findAllByCreatorAndScope(
        "cid_synth_cheryl_sg_01",
        "SG",
        "med_spa",
      );

      expect(result).toHaveLength(2);
      const call = prisma.creatorIdentityLicense.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        market: "SG",
        treatmentClass: "med_spa",
      });
      expect(call?.orderBy).toEqual([{ effectiveFrom: "asc" }, { id: "asc" }]);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/db test prisma-creator-identity-license
```
Expected: FAIL with "Cannot find module '../prisma-creator-identity-license-store.js'" / "...-reader.js".

- [ ] **Step 4: Write the store**

Create `packages/db/src/stores/prisma-creator-identity-license-store.ts`:

```ts
// PCD slice SP12 — write surface for CreatorIdentityLicense.
// Validates input via the SP12 zod schema before any DB write.
// Upsert semantics on (id) — caller controls the lease id (cuid generated
// elsewhere, e.g. from an admin UI or a fixtures runner).
//
// `withDefaultLeaseWindow` is the convenience helper for callers that
// don't supply effectiveTo: it applies the v1 30-day default per design
// spec §3.3 / §12 open question #7. Explicit `effectiveTo: null`
// (indefinite lease) is preserved.
//
// MERGE-BACK: clinicId is a plain String here. Switchboard's Clinic model
// will replace it with a true FK at merge-back.
import type { PrismaDbClient } from "../prisma-db.js";
import {
  CreatorIdentityLicensePayloadSchema,
  LeaseStatusSchema,
  type CreatorIdentityLicensePayload,
  type LeaseStatus,
} from "@creativeagent/schemas";

const DEFAULT_LEASE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type LicenseInputWithOptionalWindow = Omit<CreatorIdentityLicensePayload, "effectiveTo"> & {
  effectiveTo?: Date | null;
};

export function withDefaultLeaseWindow(
  input: LicenseInputWithOptionalWindow,
): CreatorIdentityLicensePayload {
  const effectiveTo =
    input.effectiveTo === undefined
      ? new Date(input.effectiveFrom.getTime() + DEFAULT_LEASE_WINDOW_MS)
      : input.effectiveTo;
  return { ...input, effectiveTo };
}

export class PrismaCreatorIdentityLicenseStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async create(input: CreatorIdentityLicensePayload): Promise<void> {
    const payload = CreatorIdentityLicensePayloadSchema.parse(input);

    const data = {
      creatorIdentityId: payload.creatorIdentityId,
      clinicId: payload.clinicId,
      market: payload.market,
      treatmentClass: payload.treatmentClass,
      lockType: payload.lockType,
      exclusivityScope: payload.exclusivityScope,
      effectiveFrom: payload.effectiveFrom,
      effectiveTo: payload.effectiveTo,
      priorityRank: payload.priorityRank,
      status: payload.status,
    };

    await this.prisma.creatorIdentityLicense.upsert({
      where: { id: payload.id },
      create: { id: payload.id, ...data },
      update: data,
    });
  }

  async updateStatus(id: string, status: LeaseStatus): Promise<void> {
    const parsedStatus = LeaseStatusSchema.parse(status);
    await this.prisma.creatorIdentityLicense.update({
      where: { id },
      data: { status: parsedStatus },
    });
  }
}
```

- [ ] **Step 5: Write the reader**

Create `packages/db/src/stores/prisma-creator-identity-license-reader.ts`:

```ts
// PCD slice SP12 — read surface for CreatorIdentityLicense.
// Pure read methods. The active-window query here is what the SP12 license
// gate caller uses to seed the gate's snapshot input — the gate itself
// performs no I/O (see packages/creative-pipeline/src/pcd/synthetic-creator/
// license-gate.ts).
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentityLicensePayloadSchema,
  type CreatorIdentityLicensePayload,
  type Market,
  type TreatmentClass,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentityLicenseReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CreatorIdentityLicensePayload | null> {
    const row = await this.prisma.creatorIdentityLicense.findUnique({ where: { id } });
    if (!row) return null;
    return this.parse(row);
  }

  /**
   * Returns all leases on (creatorIdentityId, market, treatmentClass) that are
   * currently active: status='active' AND effectiveFrom <= now AND
   * (effectiveTo is null OR effectiveTo > now). The result is the snapshot the
   * pure license-gate consumes — caller passes it in via gate input.
   */
  async findActiveByCreatorAndScope(
    creatorIdentityId: string,
    market: Market,
    treatmentClass: TreatmentClass,
    now: Date,
  ): Promise<CreatorIdentityLicensePayload[]> {
    const rows = await this.prisma.creatorIdentityLicense.findMany({
      where: {
        creatorIdentityId,
        market,
        treatmentClass,
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    return rows.map((r) => this.parse(r));
  }

  /**
   * Returns ALL leases on (creatorIdentityId, market, treatmentClass) regardless
   * of status or window. Used for diagnostics, admin audit, and lifecycle
   * operations (e.g. expiring stale rows). Not consumed by the gate.
   */
  async findAllByCreatorAndScope(
    creatorIdentityId: string,
    market: Market,
    treatmentClass: TreatmentClass,
  ): Promise<CreatorIdentityLicensePayload[]> {
    const rows = await this.prisma.creatorIdentityLicense.findMany({
      where: { creatorIdentityId, market, treatmentClass },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => this.parse(r));
  }

  private parse(row: {
    id: string;
    creatorIdentityId: string;
    clinicId: string;
    market: string;
    treatmentClass: string;
    lockType: string;
    exclusivityScope: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    priorityRank: number | null;
    status: string;
  }): CreatorIdentityLicensePayload {
    return CreatorIdentityLicensePayloadSchema.parse({
      id: row.id,
      creatorIdentityId: row.creatorIdentityId,
      clinicId: row.clinicId,
      market: row.market,
      treatmentClass: row.treatmentClass,
      lockType: row.lockType,
      exclusivityScope: row.exclusivityScope,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      priorityRank: row.priorityRank,
      status: row.status,
    });
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/db test prisma-creator-identity-license`
Expected: PASS — all store + reader tests green (12 tests: 6 store + 6 reader).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-creator-identity-license-store.ts packages/db/src/stores/prisma-creator-identity-license-reader.ts packages/db/src/stores/__tests__/prisma-creator-identity-license-store.test.ts packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts
git commit -m "feat(pcd): SP12 — Prisma store + reader for CreatorIdentityLicense"
```

---

## Task 5: db barrel re-exports

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add the SP12 re-exports**

Append to `packages/db/src/index.ts` (after the existing SP11 block):

```ts
// SP12 — synthetic creator license + leasing
export {
  PrismaCreatorIdentityLicenseStore,
  withDefaultLeaseWindow,
  type LicenseInputWithOptionalWindow,
} from "./stores/prisma-creator-identity-license-store.js";
export { PrismaCreatorIdentityLicenseReader } from "./stores/prisma-creator-identity-license-reader.js";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @creativeagent/db typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(pcd): SP12 — re-export license store + reader from db barrel"
```

---

## Task 6: Pure license-gate module (`license-gate.ts`)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts`

- [ ] **Step 1: Write the failing tests (table-driven across all three lock-types)**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts`:

```ts
// SP12 license gate — table-driven tests across the three lock-types.
// The gate is a pure function; tests inject snapshot leases directly,
// no DB / Prisma anywhere in this file (an SP12 anti-pattern test
// asserts this structurally).
import { describe, expect, it } from "vitest";
import type { CreatorIdentityLicensePayload } from "@creativeagent/schemas";
import {
  licenseGate,
  PCD_LICENSE_GATE_VERSION,
  type LicenseGateDecision,
  type LicenseGateInput,
} from "./license-gate.js";

const NOW = new Date("2026-05-15T00:00:00.000Z");

const makeLease = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
  id: "lic_test_default",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});

const baseInput = (
  leases: readonly CreatorIdentityLicensePayload[],
  overrides: Partial<LicenseGateInput> = {},
): LicenseGateInput => ({
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
  market: "SG",
  treatmentClass: "med_spa",
  now: NOW,
  leases,
  ...overrides,
});

describe("licenseGate — version pin", () => {
  it("exposes a stable version constant", () => {
    expect(PCD_LICENSE_GATE_VERSION).toBe("license-gate@1.0.0");
  });
});

describe("licenseGate — no_lease", () => {
  it("blocks when there are no leases at all on the scope", () => {
    const decision = licenseGate(baseInput([]));
    expect(decision).toEqual({
      allowed: false,
      license: null,
      reason: "no_lease",
    } satisfies LicenseGateDecision);
  });

  it("blocks when leases exist on the creator but for other clinics only", () => {
    const decision = licenseGate(
      baseInput([makeLease({ id: "lic_other", clinicId: "clinic_b", lockType: "priority_access" })]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_lease");
  });
});

describe("licenseGate — expired / suspended", () => {
  it("returns reason='expired' when this clinic's lease has effectiveTo <= now", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-05-01T00:00:00.000Z"), // before NOW
          status: "active",
        }),
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("expired");
  });

  it("returns reason='suspended' when this clinic's lease has status='suspended'", () => {
    const decision = licenseGate(
      baseInput([makeLease({ id: "lic_susp", status: "suspended" })]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("suspended");
  });

  it("expired beats suspended when both are present (most-recent-failure wins)", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_susp", status: "suspended" }),
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-05-01T00:00:00.000Z"),
          status: "active",
        }),
      ]),
    );
    expect(decision.reason).toBe("expired");
  });
});

describe("licenseGate — hard_exclusive", () => {
  it("allows the holder of the hard_exclusive lease", () => {
    const lease = makeLease({ lockType: "hard_exclusive", priorityRank: null });
    const decision = licenseGate(baseInput([lease]));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe(lease.id);
      expect(decision.reason).toBe("active_lease");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });

  it("blocks a competing clinic when another clinic holds an active hard_exclusive on the same scope", () => {
    const competing = makeLease({
      id: "lic_competing_hard",
      clinicId: "clinic_b",
      lockType: "hard_exclusive",
      priorityRank: null,
    });
    const decision = licenseGate(baseInput([competing]));
    expect(decision).toEqual({
      allowed: false,
      license: null,
      reason: "blocked_by_hard_exclusive",
    } satisfies LicenseGateDecision);
  });

  it("blocks even when the requesting clinic also holds a priority_access lease on the same scope", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({
          id: "lic_competing_hard",
          clinicId: "clinic_b",
          lockType: "hard_exclusive",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.reason).toBe("blocked_by_hard_exclusive");
  });

  it("does NOT block when the competing hard_exclusive is suspended or out-of-window", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({
          id: "lic_competing_hard_susp",
          clinicId: "clinic_b",
          lockType: "hard_exclusive",
          status: "suspended",
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_mine_priority");
  });
});

describe("licenseGate — priority_access", () => {
  it("allows multiple concurrent priority_access holders (no blocking)", () => {
    const a = makeLease({ id: "lic_a", clinicId: "clinic_a", lockType: "priority_access", priorityRank: 0 });
    const b = makeLease({ id: "lic_b", clinicId: "clinic_b", lockType: "priority_access", priorityRank: 1 });
    const decisionA = licenseGate(baseInput([a, b]));
    const decisionB = licenseGate(baseInput([a, b], { clinicId: "clinic_b" }));
    expect(decisionA.allowed).toBe(true);
    expect(decisionB.allowed).toBe(true);
    if (decisionA.allowed) expect(decisionA.license.id).toBe("lic_a");
    if (decisionB.allowed) expect(decisionB.license.id).toBe("lic_b");
  });

  it("when the same clinic holds multiple priority_access leases, picks the lowest priorityRank", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_high", lockType: "priority_access", priorityRank: 5 }),
        makeLease({ id: "lic_low", lockType: "priority_access", priorityRank: 0 }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_low");
  });

  it("hard_exclusive trumps priority_access when both belong to the requesting clinic", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({ id: "lic_hard", lockType: "hard_exclusive", priorityRank: null }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_hard");
  });
});

describe("licenseGate — soft_exclusive (override semantics)", () => {
  it("allows the sole soft_exclusive holder without an override flag", () => {
    const lease = makeLease({
      id: "lic_soft_solo",
      lockType: "soft_exclusive",
      priorityRank: null,
    });
    const decision = licenseGate(baseInput([lease]));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe("lic_soft_solo");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });

  it("flags isSoftExclusivityOverride=true when another clinic also holds an active soft_exclusive", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_soft", lockType: "soft_exclusive", priorityRank: null }),
        makeLease({
          id: "lic_other_soft",
          clinicId: "clinic_b",
          lockType: "soft_exclusive",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe("lic_mine_soft");
      expect(decision.isSoftExclusivityOverride).toBe(true);
    }
  });

  it("does not flag override when the other clinic's soft_exclusive is expired / suspended", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_soft", lockType: "soft_exclusive", priorityRank: null }),
        makeLease({
          id: "lic_other_soft_susp",
          clinicId: "clinic_b",
          lockType: "soft_exclusive",
          status: "suspended",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.isSoftExclusivityOverride).toBe(false);
  });
});

describe("licenseGate — scope filtering (defensive)", () => {
  it("ignores leases whose creatorIdentityId / market / treatmentClass do not match the input scope", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_wrong_creator", creatorIdentityId: "cid_synth_other_99" }),
        makeLease({ id: "lic_wrong_market", market: "MY" }),
        makeLease({ id: "lic_wrong_treatment", treatmentClass: "dental" }),
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_lease");
  });
});

describe("licenseGate — determinism", () => {
  it("produces the same decision regardless of input lease order", () => {
    const a = makeLease({ id: "lic_a", lockType: "priority_access", priorityRank: 5 });
    const b = makeLease({ id: "lic_b", lockType: "priority_access", priorityRank: 0 });
    const c = makeLease({ id: "lic_c", lockType: "priority_access", priorityRank: 1 });

    const decision1 = licenseGate(baseInput([a, b, c]));
    const decision2 = licenseGate(baseInput([c, a, b]));
    const decision3 = licenseGate(baseInput([b, c, a]));

    expect(decision1).toEqual(decision2);
    expect(decision2).toEqual(decision3);
    if (decision1.allowed) expect(decision1.license.id).toBe("lic_b");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/license-gate`
Expected: FAIL with "Cannot find module './license-gate.js'".

- [ ] **Step 3: Write the gate**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts`:

```ts
// PCD slice SP12 — pure deterministic license gate for synthetic creators.
// Mirrors the SP2 PcdTierPolicy shape: typed input record, no I/O, no
// Date.now() reads — caller supplies `now` and the lease snapshot. The
// gate is invoked at job-creation time per the design spec §4 step 5.
//
// Lock-type semantics (design §3.3):
//   - hard_exclusive   only the holder can use the creator at job time
//   - priority_access  multiple holders allowed; selector orders by priorityRank
//   - soft_exclusive   single primary, others pass with override flag
//
// The gate never imports @creativeagent/db, @prisma/client, or performs
// any I/O. Anti-pattern test in `pcd/sp12-anti-patterns.test.ts` enforces.
import type {
  CreatorIdentityLicensePayload,
  Market,
  TreatmentClass,
} from "@creativeagent/schemas";

export const PCD_LICENSE_GATE_VERSION = "license-gate@1.0.0";

export type LicenseGateInput = {
  creatorIdentityId: string;
  clinicId: string;
  market: Market;
  treatmentClass: TreatmentClass;
  now: Date;
  /**
   * Snapshot of leases the gate decides over. Caller pulls these via
   * `PrismaCreatorIdentityLicenseReader.findActiveByCreatorAndScope`
   * (or a wider query if non-active leases are needed for the
   * expired/suspended distinction). The gate filters defensively by
   * (creatorIdentityId, market, treatmentClass) before deciding.
   */
  leases: readonly CreatorIdentityLicensePayload[];
};

export type LicenseGateReason =
  | "active_lease"
  | "no_lease"
  | "expired"
  | "suspended"
  | "blocked_by_hard_exclusive";

export type LicenseGateDecision =
  | {
      allowed: true;
      license: CreatorIdentityLicensePayload;
      reason: "active_lease";
      isSoftExclusivityOverride: boolean;
    }
  | {
      allowed: false;
      license: null;
      reason: Exclude<LicenseGateReason, "active_lease">;
    };

export function licenseGate(input: LicenseGateInput): LicenseGateDecision {
  const inScope = input.leases.filter(
    (l) =>
      l.creatorIdentityId === input.creatorIdentityId &&
      l.market === input.market &&
      l.treatmentClass === input.treatmentClass,
  );

  const mine = inScope.filter((l) => l.clinicId === input.clinicId);
  const competing = inScope.filter((l) => l.clinicId !== input.clinicId);

  // Step 1 — Competing hard_exclusive blocks unconditionally.
  const competingHardActive = competing.filter(
    (l) => l.lockType === "hard_exclusive" && isActiveAt(l, input.now),
  );
  if (competingHardActive.length > 0) {
    return { allowed: false, license: null, reason: "blocked_by_hard_exclusive" };
  }

  // Step 2 — Requesting clinic's active leases.
  const mineActive = mine.filter((l) => isActiveAt(l, input.now));

  if (mineActive.length === 0) {
    // Distinguish expired vs suspended vs no_lease for caller diagnostics.
    if (mine.some((l) => isExpiredAt(l, input.now))) {
      return { allowed: false, license: null, reason: "expired" };
    }
    if (mine.some((l) => l.status === "suspended")) {
      return { allowed: false, license: null, reason: "suspended" };
    }
    return { allowed: false, license: null, reason: "no_lease" };
  }

  // Step 3 — Pick strongest active lease for this clinic.
  //   Precedence: hard_exclusive > priority_access (lowest rank wins) > soft_exclusive.
  //   Tie-break: effectiveFrom ASC, then id ASC (deterministic, replayable).
  const strongest = pickStrongest(mineActive);

  // Step 4 — Soft-exclusive override flag.
  let isSoftExclusivityOverride = false;
  if (strongest.lockType === "soft_exclusive") {
    isSoftExclusivityOverride = competing.some(
      (l) => l.lockType === "soft_exclusive" && isActiveAt(l, input.now),
    );
  }

  return {
    allowed: true,
    license: strongest,
    reason: "active_lease",
    isSoftExclusivityOverride,
  };
}

function isActiveAt(lease: CreatorIdentityLicensePayload, now: Date): boolean {
  if (lease.status !== "active") return false;
  if (lease.effectiveFrom.getTime() > now.getTime()) return false;
  if (lease.effectiveTo === null) return true;
  return lease.effectiveTo.getTime() > now.getTime();
}

function isExpiredAt(lease: CreatorIdentityLicensePayload, now: Date): boolean {
  return lease.effectiveTo !== null && lease.effectiveTo.getTime() <= now.getTime();
}

const LOCK_TYPE_RANK: Record<CreatorIdentityLicensePayload["lockType"], number> = {
  hard_exclusive: 0,
  priority_access: 1,
  soft_exclusive: 2,
};

function pickStrongest(
  leases: readonly CreatorIdentityLicensePayload[],
): CreatorIdentityLicensePayload {
  const sorted = [...leases].sort((a, b) => {
    const ra = LOCK_TYPE_RANK[a.lockType];
    const rb = LOCK_TYPE_RANK[b.lockType];
    if (ra !== rb) return ra - rb;
    if (a.lockType === "priority_access" && b.lockType === "priority_access") {
      const pa = a.priorityRank ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priorityRank ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
    }
    if (a.effectiveFrom.getTime() !== b.effectiveFrom.getTime()) {
      return a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Non-empty by precondition (caller passes mineActive.length > 0).
  return sorted[0]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/license-gate`
Expected: PASS, all 18 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts
git commit -m "feat(pcd): SP12 — pure license gate (hard / priority / soft lock-type semantics)"
```

---

## Task 7: synthetic-creator subdir barrel + creative-pipeline package barrel

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`
- (No edit needed to `packages/creative-pipeline/src/index.ts` — SP11 already wired `export * from "./pcd/synthetic-creator/index.js"` at line 114–115.)

- [ ] **Step 1: Write the failing test**

Append to `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts` at the bottom:

```ts
import * as syntheticBarrel from "./index.js";
import * as packageBarrel from "../../index.js";

describe("synthetic-creator subdir barrel — SP12 surface", () => {
  it("re-exports the license gate function + types", () => {
    expect(syntheticBarrel.licenseGate).toBeDefined();
    expect(syntheticBarrel.PCD_LICENSE_GATE_VERSION).toBe("license-gate@1.0.0");
  });

  it("re-exports through the creative-pipeline package barrel", () => {
    expect(packageBarrel.licenseGate).toBeDefined();
    expect(packageBarrel.PCD_LICENSE_GATE_VERSION).toBe("license-gate@1.0.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/license-gate`
Expected: FAIL with "syntheticBarrel.licenseGate is undefined".

- [ ] **Step 3: Add the re-export to the synthetic-creator subdir barrel**

Edit `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts` — replace the existing file contents with:

```ts
// PCD slice SP11–SP12 — synthetic creator package barrel.
export { SP11_SYNTHETIC_CREATOR_ROSTER, SP11_ROSTER_SIZE } from "./seed.js";
export type { RosterEntry, CreatorIdentityStub } from "./seed.js";

// SP12 — pure license gate
export { licenseGate, PCD_LICENSE_GATE_VERSION } from "./license-gate.js";
export type { LicenseGateInput, LicenseGateDecision, LicenseGateReason } from "./license-gate.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/license-gate`
Expected: all license-gate tests + 2 new barrel tests green.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-creator/index.ts packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts
git commit -m "feat(pcd): SP12 — re-export license gate from synthetic-creator + package barrels"
```

---

## Task 8: SP12 anti-pattern grep tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts`

- [ ] **Step 1: Write the anti-pattern test**

Create `packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts`:

```ts
// SP12 anti-pattern grep tests. These guard against:
//   1. SP13+ scope leak (no selector / disclosure / script-template / performance-snapshot
//      imports in SP12 files)
//   2. Migration shape (additive only — no DROP, FK with CASCADE, no new enum types)
//   3. License-gate purity (no @creativeagent/db, no @prisma/client, no Date.now() inside
//      the gate module)
//   4. SP1–SP11 source body changes — only the additive `licenses` back-reference on
//      CreatorIdentity is allowed
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

function grepFiles(pattern: string, scope: string): string[] {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return []; // grep exits 1 on no match
  }
}

describe("SP12 anti-patterns", () => {
  it("license-gate module does not import @creativeagent/db or @prisma/client (purity)", () => {
    const gatePath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
    );
    const src = readFileSync(gatePath, "utf8");
    expect(src).not.toMatch(/from\s+["']@creativeagent\/db["']/);
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it("license-gate module does not call Date.now() or new Date() inside the function body", () => {
    const gatePath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
    );
    const src = readFileSync(gatePath, "utf8");
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new\s+Date\(/);
  });

  it("SP12 source files do not import SP13+ modules (selector / disclosure / script / snapshot)", () => {
    const sp12Files = [
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
      "packages/db/src/stores/prisma-creator-identity-license-store.ts",
      "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
      "packages/schemas/src/creator-identity-license.ts",
    ];
    for (const rel of sp12Files) {
      const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} must not reference selector`).not.toMatch(/selector/i);
      expect(src, `${rel} must not reference disclosure`).not.toMatch(/disclosure/i);
      expect(src, `${rel} must not reference script-template`).not.toMatch(/script-template/i);
      expect(src, `${rel} must not reference performance-snapshot`).not.toMatch(
        /performance-snapshot/i,
      );
      expect(
        src,
        `${rel} must not reference SyntheticCreatorSelectionDecision`,
      ).not.toMatch(/SyntheticCreatorSelectionDecision/);
    }
  });

  it("SP12 migration is additive — adds CreatorIdentityLicense, no drops, no new enum types", () => {
    const migrationsDir = path.join(REPO_ROOT, "packages/db/prisma/migrations");
    const list = readdirSync(migrationsDir);
    const sp12Migration = list.find((d) => /license_sp12/.test(d));
    expect(sp12Migration, "SP12 migration directory not found").toBeDefined();

    const migrationPath = path.join(migrationsDir, sp12Migration!, "migration.sql");
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE TABLE "CreatorIdentityLicense"/);
    expect(sql).toMatch(/REFERENCES "CreatorIdentity"\("id"\) ON DELETE CASCADE/);

    // Three required indexes
    expect(sql).toMatch(/CreatorIdentityLicense_creatorIdentityId_status_idx/);
    expect(sql).toMatch(/CreatorIdentityLicense_clinicId_market_treatmentClass_idx/);
    expect(sql).toMatch(/CreatorIdentityLicense_effectiveTo_idx/);

    // Strictly additive — no drops, no new enum types
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
    expect(sql).not.toMatch(/CREATE TYPE/);
  });

  it("CreatorIdentity Prisma model body adds only the `licenses` back-reference and no other SP12 fields", () => {
    const schemaPath = path.join(REPO_ROOT, "packages/db/prisma/schema.prisma");
    expect(existsSync(schemaPath)).toBe(true);
    const src = readFileSync(schemaPath, "utf8");

    const match = src.match(/model CreatorIdentity \{([\s\S]+?)(?=^model )/m);
    expect(match, "CreatorIdentity block not found in schema.prisma").toBeDefined();
    const block = match![1] ?? "";

    // SP11 column still present:
    expect(block).toMatch(/kind\s+CreatorIdentityKind\s+@default\(real\)/);
    // SP12 back-reference present:
    expect(block).toMatch(/licenses\s+CreatorIdentityLicense\[\]/);

    // SP12 has not leaked synthetic-only or license-only fields onto the
    // base CreatorIdentity model — those belong on the extension tables.
    expect(block).not.toMatch(/lockType/);
    expect(block).not.toMatch(/clinicId/);
    expect(block).not.toMatch(/effectiveFrom/);
  });

  it("no SP12 source file imports DALL-E / Kling / OpenAI APIs (no real model runners)", () => {
    const hits = grepFiles(
      "(openai\\.images|dalle\\.|fetch.*kling|fetch.*openai|kling\\.api|dalle3)",
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts packages/db/src/stores/prisma-creator-identity-license-store.ts packages/db/src/stores/prisma-creator-identity-license-reader.ts",
    );
    expect(hits).toEqual([]);
  });

  it("license gate test file does not depend on Prisma at runtime (pure-table-driven invariant)", () => {
    const testPath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts",
    );
    const src = readFileSync(testPath, "utf8");
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });
});
```

- [ ] **Step 2: Run the anti-pattern tests**

Run: `pnpm --filter @creativeagent/creative-pipeline test sp12-anti-patterns`
Expected: PASS, all 7 tests green.

If a test fails because the migration SQL does not contain one of the asserted index names exactly: the Prisma migration generator names indexes by table+columns. If the actual generated names differ from the expected ones (e.g. `CreatorIdentityLicense_creatorIdentityId_status_idx` vs a Prisma-generated alternative), update the regex to match the actual generated name — don't rename the index in `schema.prisma` to fit the test.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all green (SP11 baseline + SP12 additions, ~30+ new tests).

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts
git commit -m "test(pcd): SP12 — anti-pattern grep tests (gate purity, scope leak, additive migration)"
```

---

## Task 9: Verification + branch summary + PR

- [ ] **Step 1: Full repo verification**

Run from worktree root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: typecheck clean, full test suite green at SP11 baseline + SP12 additions (~30 new tests across schemas / db / creative-pipeline). The post-flight test count should equal `<SP11_BASELINE_TESTS> + 30 (±2)`. Prettier clean (or only the legacy `tier-policy.ts` baseline noise — leave as-is).

- [ ] **Step 2: Migration smoke test against a fresh DB**

```bash
pnpm db:reset --skip-seed
pnpm db:migrate deploy
psql $DATABASE_URL -c "\d \"CreatorIdentityLicense\""
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename = 'CreatorIdentityLicense'"
```

Expected:
- `CreatorIdentityLicense` table exists with all expected columns (id, creatorIdentityId, clinicId, market, treatmentClass, lockType, exclusivityScope, effectiveFrom, effectiveTo, priorityRank, status, createdAt, updatedAt)
- Three indexes listed: `_creatorIdentityId_status_idx`, `_clinicId_market_treatmentClass_idx`, `_effectiveTo_idx`
- Foreign-key constraint to `CreatorIdentity(id)` with `ON DELETE CASCADE`
- No errors

- [ ] **Step 3: End-to-end roundtrip via store + reader against the dev DB**

Create a one-shot script `packages/creative-pipeline/scripts/sp12-smoke-license-gate.ts`:

```ts
// SP12 smoke test — write a few leases, query them, run the gate end-to-end.
// Not committed; delete after smoke-testing. Shipping the seed runner is SP18+ work.
import { PrismaClient } from "@prisma/client";
import {
  PrismaCreatorIdentityLicenseStore,
  PrismaCreatorIdentityLicenseReader,
  withDefaultLeaseWindow,
} from "@creativeagent/db";
import { licenseGate } from "@creativeagent/creative-pipeline";

const prisma = new PrismaClient();
const store = new PrismaCreatorIdentityLicenseStore(prisma);
const reader = new PrismaCreatorIdentityLicenseReader(prisma);

const now = new Date();
await store.create(
  withDefaultLeaseWindow({
    id: "lic_smoke_001",
    creatorIdentityId: "cid_synth_cheryl_sg_01",
    clinicId: "clinic_smoke_a",
    market: "SG",
    treatmentClass: "med_spa",
    lockType: "priority_access",
    exclusivityScope: "market_treatment",
    effectiveFrom: now,
    priorityRank: 0,
    status: "active",
  }),
);

const leases = await reader.findActiveByCreatorAndScope(
  "cid_synth_cheryl_sg_01",
  "SG",
  "med_spa",
  now,
);
const decision = licenseGate({
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_smoke_a",
  market: "SG",
  treatmentClass: "med_spa",
  now,
  leases,
});

console.warn("SP12 smoke decision:", JSON.stringify(decision, null, 2));
```

Run: `pnpm --filter @creativeagent/creative-pipeline ts-node-esm scripts/sp12-smoke-license-gate.ts`

Expected output:
```
SP12 smoke decision: {
  "allowed": true,
  "license": { "id": "lic_smoke_001", ... },
  "reason": "active_lease",
  "isSoftExclusivityOverride": false
}
```

Then **delete the smoke script** before committing — it's a debugging artifact, not part of the SP12 surface:

```bash
rm packages/creative-pipeline/scripts/sp12-smoke-license-gate.ts
```

- [ ] **Step 4: Final commit summary**

```bash
git log --oneline feat/pcd-synthetic-creator-roster..HEAD
```

Expected: ~8 commits on `feat/pcd-synthetic-creator-license-gate` (one per Task 1–8), each `feat(pcd): SP12 — ...` or `test(pcd): SP12 — ...`. If any task ballooned and was committed in sub-tasks, that's fine — note in the squash-PR description.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base feat/pcd-synthetic-creator-roster --title "feat(pcd): SP12 — synthetic creator license gate + leasing (CreatorIdentityLicense + pure gate)" --body "$(cat <<'EOF'
## Summary

- Adds `CreatorIdentityLicense` table (additive Prisma migration, FK CASCADE to `CreatorIdentity`)
- Adds zod schemas for `LockType` (`hard_exclusive | priority_access | soft_exclusive`), `LeaseStatus`, `ExclusivityScope`, and `CreatorIdentityLicensePayload`
- Adds `PrismaCreatorIdentityLicenseStore` (write surface with 30-day default lease window helper) and `PrismaCreatorIdentityLicenseReader` (read surface — `findById`, `findActiveByCreatorAndScope`, `findAllByCreatorAndScope`)
- Adds pure-deterministic `licenseGate({creatorIdentityId, clinicId, market, treatmentClass, now, leases}) → LicenseGateDecision` mirroring SP2 PcdTierPolicy shape — snapshot-only, no DB reads, table-driven across all three lock-types
- SP12 anti-pattern grep tests (gate purity, scope leak, additive migration shape, no real model runners)

## Lock-type semantics (from design spec §3.3)

- `hard_exclusive` — only the holder can use the creator at job time. Competing hard_exclusive → `blocked_by_hard_exclusive`.
- `priority_access` — multiple holders allowed; selector orders by `priorityRank` ASC; the gate never blocks.
- `soft_exclusive` — single primary holder; non-primary holders pass with `isSoftExclusivityOverride: true` recorded in the decision (caller writes to provenance — SP17 work).

## Out of scope (SP13+)

- Selector (SP13)
- Disclosure registry (SP14)
- Script templates (SP15)
- Provider-routing extension (SP16)
- SP9 provenance extension for `licenseId` (SP17)
- Performance snapshots (SP18)
- QC face-match for synthetic (SP20)
- Lease conflict detection at lease-creation time (v1.5 concern)
- Lease renewal UI / admin operations (post-v1)

## Base branch

This PR targets `feat/pcd-synthetic-creator-roster` (SP11), not `main`. After SP11 merges to `main`, this branch will be rebased — any conflict in `sp9-anti-patterns.test.ts` allowlist additions resolves via union (SP10B is the parallel co-author of that file).

## Source-of-truth

- Design: `docs/plans/2026-04-30-pcd-synthetic-creator-roster-design.md` §3.3, §4 step 5
- Plan: `docs/plans/2026-04-30-pcd-synthetic-creator-license-gate-sp12-plan.md`

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green (full suite + ~30 new tests)
- [ ] Migration applies cleanly against a fresh DB (`CreatorIdentityLicense` table + 3 indexes + FK CASCADE)
- [ ] Smoke roundtrip: write a lease, query it, run the gate end-to-end → expected `active_lease` decision
- [ ] SP12 anti-pattern tests green (gate purity / no SP13+ leak / additive migration / no real runners)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (executor: do this before opening the PR)

1. **Spec coverage** — every design-spec §3.3, §4 step 5 lock-type semantic implemented?
   - `CreatorIdentityLicense` table with all required columns ✅ Task 3
   - `LockType` zod enum (3 values) ✅ Task 1
   - `LeaseStatus` zod enum (4 values) ✅ Task 1
   - `ExclusivityScope` zod enum (`market_treatment`, `free`) ✅ Task 1
   - `priorityRank` nullable, only meaningful for `priority_access` ✅ Task 1 schema + Task 6 gate
   - 30-day default lease window helper ✅ Task 4 (`withDefaultLeaseWindow`)
   - Reader query for active leases at `now` ✅ Task 4 (`findActiveByCreatorAndScope`)
   - Pure-deterministic gate over caller-supplied snapshot ✅ Task 6
   - 5 reasons (`active_lease | no_lease | expired | suspended | blocked_by_hard_exclusive`) ✅ Task 6
   - Soft-exclusive override flag (`isSoftExclusivityOverride: true`) recorded in decision ✅ Task 6
   - Hard-exclusive blocks competing clinics; priority_access never blocks; soft_exclusive emits override flag ✅ Task 6 tests
   - Additive Prisma migration with CASCADE FK + 3 required indexes ✅ Task 3
   - SP12 anti-pattern grep tests (purity, scope-leak, additive migration) ✅ Task 8
2. **Placeholder scan** — no `TBD`, no `// implement later`, no empty function bodies, no `/* ... */` placeholders. The smoke script in Task 9 step 3 is explicitly created and deleted within the task — that's not a placeholder, it's a one-shot debugging step.
3. **Type consistency** — `CreatorIdentityLicensePayload` shape matches between schema (Task 1), store input (Task 4), reader output (Task 4), and gate input snapshot (Task 6). One canonical type, imported everywhere from `@creativeagent/schemas`.
4. **Method-name consistency** — reader query is `findActiveByCreatorAndScope` everywhere (not `findActiveLeases` in one place and `findCurrentLeases` in another). Gate function is `licenseGate` everywhere; version constant is `PCD_LICENSE_GATE_VERSION`.
5. **Anti-pattern tests stay green at every commit** — if any task commit breaks Task 8's tests, fix in the same commit, not a follow-up.

If a task ballooned past its declared scope (e.g. selector logic crept into the gate because a test demanded fallback ordering), STOP and split. SP12A (schemas + Prisma + store/reader) and SP12B (pure gate + anti-patterns) are an acceptable split if needed.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-04-30-pcd-synthetic-creator-license-gate-sp12-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Fresh subagent per task with two-stage review. Best when tasks are independent and you want fast iteration with checkpoints between commits.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Best when you want one continuous session with batch checkpoints.

**Which approach?**

---

*End of SP12 plan. Awaiting user review per writing-plans skill review gate before execution.*
