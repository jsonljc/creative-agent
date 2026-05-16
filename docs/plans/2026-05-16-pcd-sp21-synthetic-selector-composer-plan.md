# PCD SP21 — Synthetic-Creator Selection Composer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first impure orchestrator in the PCD vertical — an async composer that reads the synthetic-creator roster, the brief-scoped active leases, and a 30-day SP20 performance-metrics window through three injected port interfaces, then invokes the unchanged SP13/SP20 pure `selectSyntheticCreator` and returns its decision.

**Architecture:** Free-standing async function `composeSyntheticCreatorSelection(input, stores)` in `packages/creative-pipeline/src/pcd/selector/`. Three narrow port interfaces (`SyntheticCreatorRosterReader`, `SyntheticCreatorLeaseReader`, `SyntheticCreatorMetricsReader`) live in `packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts`. The composer file imports **only** `@creativeagent/schemas` and same-package modules — never `@creativeagent/db`. Concrete Prisma readers (the existing SP20 metrics reader + a new `findActiveByClinicAndScope` method on the existing license reader) live in `@creativeagent/db` and are wired in by the runner/app layer at merge-back. A `Sp11SeedSyntheticCreatorRosterReader` provides v1 roster reads from the SP11 in-memory seed; the eventual Prisma synthetic-creator reader is reserved for SP21.1.

**Tech Stack:** TypeScript (ESM, `.js` extensions in relative imports), Zod 3.x, Prisma 5 with Postgres, Vitest. Conventional Commits; co-located tests; 400-line soft file-size limit per `CLAUDE.md`.

**Branch:** `pcd/sp21-synthetic-selector-composer` in worktree `.worktrees/sp21`. (If `.worktrees/sp21` does not yet exist, create the worktree via the `superpowers:using-git-worktrees` skill before executing Task 1.)

**Anti-pattern freeze SHA:** `06ba0ac` (SP20 squash on `main`, 2026-05-16).

**Spec:** `docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-design.md` (commit `4ede87a`).

**Locked plan requirements (user, 2026-05-16):**
1. Composer MUST NOT import `@creativeagent/db`. Ports only.
2. Metrics-reader port shape MUST be `{ creatorIdentityIds, window: { since } }` — matches the existing SP20 reader verbatim; zero adapter.
3. Seed adapter MUST be named `Sp11SeedSyntheticCreatorRosterReader` and be explicitly tagged as a temporary SP21.1 bridge. SP21 MUST NOT introduce a Prisma synthetic-creator roster reader.
4. `metricsSince` MUST be derived from `input.now`. The anti-pattern test bans `new Date(` inside the composer body.
5. Empty-roster behavior is locked: short-circuit; do not call lease reader or metrics reader; invoke selector with empty arrays.
6. Lease-reader schema verification (Task 1) precedes any code in Task 2 — per SP20 lesson.

---

## Pre-flight (one-time, before Task 1)

The worktree should already exist at `.worktrees/sp21` on branch `pcd/sp21-synthetic-selector-composer` (created via `superpowers:using-git-worktrees`). All subsequent task commands run from inside that worktree.

```bash
cd .worktrees/sp21
git status                                # clean, on pcd/sp21-synthetic-selector-composer
git log --oneline -1                      # 06ba0ac feat(pcd): SP20 ...

pnpm install
pnpm db:generate
pnpm typecheck && pnpm test && pnpm exec prettier --check .
```

Expected: clean. If anything fails on a clean checkout, stop and investigate — that is not an SP21 concern but must be resolved before adding new code.

---

## Task 1: Verify Prisma columns for `findActiveByClinicAndScope` (no code; investigation + commit a finding note)

**Files:**
- Read: `packages/db/prisma/schema.prisma`
- Read: `packages/db/src/stores/prisma-creator-identity-license-reader.ts`
- Create: `docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md`

The new method `findActiveByClinicAndScope({ clinicId, market, treatmentClass, now })` filters `CreatorIdentityLicense` rows by clinic + scope + active-window predicate. Task 1 confirms every column exists with the expected type before any query is written, per the SP20 lesson.

- [ ] **Step 1: Read the relevant Prisma block**

Open `packages/db/prisma/schema.prisma` and locate `model CreatorIdentityLicense`. For each of the following fields, record the type and nullability:

- `id`
- `creatorIdentityId`
- `clinicId`
- `market`
- `treatmentClass`
- `lockType`
- `exclusivityScope`
- `effectiveFrom`
- `effectiveTo`
- `priorityRank`
- `status`

- [ ] **Step 2: Cross-check existing method's filter shape**

Open `packages/db/src/stores/prisma-creator-identity-license-reader.ts` lines 29–46 (`findActiveByCreatorAndScope`). The new method MUST use the identical active-window predicate:

```ts
status: "active",
effectiveFrom: { lte: now },
OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
```

Confirm that the existing method's predicate logic is the canonical one. The only divergence in the new method is the grouping column: `clinicId` instead of `creatorIdentityId`.

- [ ] **Step 3: Write the findings note**

Create `docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md` with three sections:

1. Quoted excerpt of `model CreatorIdentityLicense` (relevant ~15 lines).
2. Confirmation table: every required column exists with the expected type.
3. The exact Prisma `where` clause that the new method will use (committed before the code is written, so it is the contract Task 2 implements):

```ts
where: {
  clinicId,
  market,
  treatmentClass,
  status: "active",
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
}
```

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md
git commit -m "docs(pcd): SP21 task 1 — verify CreatorIdentityLicense columns for findActiveByClinicAndScope"
```

---

## Task 2: Add `findActiveByClinicAndScope` to `PrismaCreatorIdentityLicenseReader` (TDD)

**Files:**
- Modify: `packages/db/src/stores/prisma-creator-identity-license-reader.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts`

The composer's lease port (`SyntheticCreatorLeaseReader.findActiveLeasesForBriefScope`) is satisfied by this method. The method is purely additive; the existing `findActiveByCreatorAndScope` is unchanged.

- [ ] **Step 1: Write the failing test**

Append the following describe block to `packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts` (preserving all existing tests). Match the file's existing seeding / cleanup style — the test below uses Prisma model writes via the live `prisma` client the file already imports.

```ts
describe("findActiveByClinicAndScope", () => {
  it("returns active leases for the clinic+market+treatmentClass scope at `now`, excluding revoked and out-of-window rows", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const before = new Date("2026-04-01T00:00:00.000Z");
    const after = new Date("2026-06-30T00:00:00.000Z");
    const longPast = new Date("2025-01-01T00:00:00.000Z");
    const longPastEnd = new Date("2025-12-31T00:00:00.000Z");

    const clinicId = "clinic_sp21_a";
    const otherClinicId = "clinic_sp21_b";

    // Two creators in scope, plus rows that should NOT match.
    await prisma.creatorIdentity.createMany({
      data: [
        { id: "cid_sp21_alpha", name: "Alpha", kind: "synthetic" },
        { id: "cid_sp21_beta", name: "Beta", kind: "synthetic" },
        { id: "cid_sp21_gamma", name: "Gamma", kind: "synthetic" },
      ],
      skipDuplicates: true,
    });

    await prisma.creatorIdentityLicense.createMany({
      data: [
        // Match #1: active, in-window, target scope, target clinic.
        {
          id: "lic_match_1",
          creatorIdentityId: "cid_sp21_alpha",
          clinicId,
          market: "SG",
          treatmentClass: "med_spa",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: after,
          priorityRank: 1,
          status: "active",
        },
        // Match #2: active, open-ended (effectiveTo null), target scope, target clinic.
        {
          id: "lic_match_2",
          creatorIdentityId: "cid_sp21_beta",
          clinicId,
          market: "SG",
          treatmentClass: "med_spa",
          lockType: "soft_exclusive",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: null,
          priorityRank: null,
          status: "active",
        },
        // Reject: wrong clinic.
        {
          id: "lic_wrong_clinic",
          creatorIdentityId: "cid_sp21_alpha",
          clinicId: otherClinicId,
          market: "SG",
          treatmentClass: "med_spa",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: after,
          priorityRank: 2,
          status: "active",
        },
        // Reject: wrong market.
        {
          id: "lic_wrong_market",
          creatorIdentityId: "cid_sp21_alpha",
          clinicId,
          market: "MY",
          treatmentClass: "med_spa",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: after,
          priorityRank: 3,
          status: "active",
        },
        // Reject: wrong treatmentClass.
        {
          id: "lic_wrong_tc",
          creatorIdentityId: "cid_sp21_alpha",
          clinicId,
          market: "SG",
          treatmentClass: "dental",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: after,
          priorityRank: 4,
          status: "active",
        },
        // Reject: status revoked.
        {
          id: "lic_revoked",
          creatorIdentityId: "cid_sp21_gamma",
          clinicId,
          market: "SG",
          treatmentClass: "med_spa",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: before,
          effectiveTo: after,
          priorityRank: 5,
          status: "revoked",
        },
        // Reject: out of window (ended in 2025).
        {
          id: "lic_expired",
          creatorIdentityId: "cid_sp21_gamma",
          clinicId,
          market: "SG",
          treatmentClass: "med_spa",
          lockType: "priority_access",
          exclusivityScope: "clinic",
          effectiveFrom: longPast,
          effectiveTo: longPastEnd,
          priorityRank: 6,
          status: "active",
        },
      ],
      skipDuplicates: true,
    });

    const reader = new PrismaCreatorIdentityLicenseReader(prisma);
    const rows = await reader.findActiveByClinicAndScope(clinicId, "SG", "med_spa", now);

    expect(rows.map((r) => r.id).sort()).toEqual(["lic_match_1", "lic_match_2"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/db test -- prisma-creator-identity-license-reader
```

Expected: FAIL with `reader.findActiveByClinicAndScope is not a function` (or similar — method does not exist yet).

- [ ] **Step 3: Add the method**

Insert the following method into `packages/db/src/stores/prisma-creator-identity-license-reader.ts`, between `findActiveByCreatorAndScope` and `findAllByCreatorAndScope` (preserving every existing line):

```ts
  /**
   * Returns all active leases for a clinic-wide scope: status='active'
   * AND effectiveFrom <= now AND (effectiveTo is null OR effectiveTo > now).
   * Used by the SP21 composer to seed the SP13 selector's `leases` input
   * across every candidate in the roster — DB-side scope filter so the
   * composer never fetches "all clinic leases" and trims in memory.
   */
  async findActiveByClinicAndScope(
    clinicId: string,
    market: Market,
    treatmentClass: TreatmentClass,
    now: Date,
  ): Promise<CreatorIdentityLicensePayload[]> {
    const rows = await this.prisma.creatorIdentityLicense.findMany({
      where: {
        clinicId,
        market,
        treatmentClass,
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    return rows.map((r) => this.parse(r));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/db test -- prisma-creator-identity-license-reader
```

Expected: PASS (the new test + all prior tests in the file).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-creator-identity-license-reader.ts \
        packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts
git commit -m "feat(db): SP21 — findActiveByClinicAndScope on PrismaCreatorIdentityLicenseReader"
```

---

## Task 3: Define the three port interfaces

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts` (barrel re-export)

The three ports live in `synthetic-creator/` (not `selector/`) so the import direction across the package is selector → synthetic-creator (which already exists via `RosterEntry`). The composer file imports the port types from here; the seed adapter and any future readers implement them.

- [ ] **Step 1: Create the ports file**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts`:

```ts
// SP21 — port interfaces for the synthetic-creator selection composer.
//
// Defined here (synthetic-creator/) rather than in selector/ so the cross-dir
// import direction stays selector → synthetic-creator (the same direction
// already used by the SP13 selector's `RosterEntry` import from ./seed.js).
// The composer imports these types; concrete adapters implement them.
//
// LAYERING GUARDRAIL — these interfaces deliberately encode no Prisma types.
// Concrete Prisma readers live in @creativeagent/db; in-memory adapters live
// alongside the seed in this package. SP21 anti-pattern test #1 enforces.

import type {
  CreatorIdentityLicensePayload,
  CreatorPerformanceMetrics,
  Market,
  TreatmentClass,
} from "@creativeagent/schemas";
import type { RosterEntry } from "./seed.js";

export interface SyntheticCreatorRosterReader {
  // v1: returns SP11_SYNTHETIC_CREATOR_ROSTER pre-filtered by market +
  // treatmentClass (the schema-indexable fields). The SP13 selector applies
  // the full compatibility predicate (vibe, ethnicityFamily, ageBand,
  // pricePositioning) downstream. MERGE-BACK: replaced by a real Prisma
  // reader at SP21.1.
  listActiveCompatibleRoster(input: {
    market: Market;
    treatmentClass: TreatmentClass;
  }): Promise<readonly RosterEntry[]>;
}

export interface SyntheticCreatorLeaseReader {
  // DB-side filter — composer never fetches "all leases for clinic" and trims
  // in memory. SP13 selector still license-gates each candidate against this
  // narrow pool. Satisfied by
  // PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope at the
  // app/runner wiring layer.
  findActiveLeasesForBriefScope(input: {
    clinicId: string;
    market: Market;
    treatmentClass: TreatmentClass;
    now: Date;
  }): Promise<readonly CreatorIdentityLicensePayload[]>;
}

export interface SyntheticCreatorMetricsReader {
  // Port shape matches PrismaPcdCreatorPerformanceMetricsReader and
  // InMemoryPcdCreatorPerformanceMetricsReader EXACTLY (SP20). Both concrete
  // readers satisfy this port without an adapter.
  findMetricsForCreators(input: {
    creatorIdentityIds: readonly string[];
    window: { since: Date };
  }): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>>;
}
```

- [ ] **Step 2: Re-export from the synthetic-creator barrel**

Append to `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`:

```ts
export type {
  SyntheticCreatorRosterReader,
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
} from "./synthetic-creator-selection-ports.js";
```

- [ ] **Step 3: Verify it type-checks**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts \
        packages/creative-pipeline/src/pcd/synthetic-creator/index.ts
git commit -m "feat(pcd): SP21 — port interfaces for synthetic-creator selection composer"
```

---

## Task 4: `Sp11SeedSyntheticCreatorRosterReader` (TDD)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts` (barrel re-export)

The v1 adapter for the roster port. Reads from the in-memory `SP11_SYNTHETIC_CREATOR_ROSTER` and filters on `synthetic.status === "active"` AND `synthetic.market === input.market` AND `synthetic.treatmentClass === input.treatmentClass`.

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./seed.js";
import { Sp11SeedSyntheticCreatorRosterReader } from "./sp11-seed-synthetic-creator-roster-reader.js";

describe("Sp11SeedSyntheticCreatorRosterReader", () => {
  it("returns only roster entries matching market + treatmentClass + active status", async () => {
    const reader = new Sp11SeedSyntheticCreatorRosterReader();
    const rows = await reader.listActiveCompatibleRoster({
      market: "SG",
      treatmentClass: "med_spa",
    });

    for (const r of rows) {
      expect(r.synthetic.market).toBe("SG");
      expect(r.synthetic.treatmentClass).toBe("med_spa");
      expect(r.synthetic.status).toBe("active");
    }

    // Expected set is the SP11 roster filtered the same way.
    const expectedIds = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === "SG" &&
        e.synthetic.treatmentClass === "med_spa",
    )
      .map((e) => e.creatorIdentity.id)
      .sort();
    expect(rows.map((r) => r.creatorIdentity.id).sort()).toEqual(expectedIds);
    expect(rows.length).toBeGreaterThan(0); // SP11 seed has SG/med_spa entries.
  });

  it("returns an empty array when no roster entry matches the scope", async () => {
    const reader = new Sp11SeedSyntheticCreatorRosterReader();
    // dental is not present in the SP11 seed for any market — exact pair
    // (TH, dental) is guaranteed to be empty regardless of seed evolution.
    const rows = await reader.listActiveCompatibleRoster({
      market: "TH",
      treatmentClass: "dental",
    });
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp11-seed-synthetic-creator-roster-reader
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts`:

```ts
// SP21 — temporary in-memory adapter for the SP11 synthetic-creator roster.
//
// MERGE-BACK: this adapter is the v1 stand-in for a real
// PrismaCreatorIdentitySyntheticReader.findActive(...) query. SP21 explicitly
// does NOT create a Prisma synthetic-creator roster reader — that work is
// reserved for SP21.1 (or for Switchboard at merge-back).
//
// The roster narrowing here is intentionally schema-level (market +
// treatmentClass + active status), matching the columns a Prisma successor
// would index on. The SP13 selector applies the full compatibility predicate
// (vibe, ethnicityFamily, ageBand, pricePositioning) downstream — this
// adapter never duplicates that logic.

import type { Market, TreatmentClass } from "@creativeagent/schemas";
import type { RosterEntry } from "./seed.js";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./seed.js";
import type { SyntheticCreatorRosterReader } from "./synthetic-creator-selection-ports.js";

export class Sp11SeedSyntheticCreatorRosterReader implements SyntheticCreatorRosterReader {
  async listActiveCompatibleRoster(input: {
    market: Market;
    treatmentClass: TreatmentClass;
  }): Promise<readonly RosterEntry[]> {
    return SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (entry) =>
        entry.synthetic.status === "active" &&
        entry.synthetic.market === input.market &&
        entry.synthetic.treatmentClass === input.treatmentClass,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp11-seed-synthetic-creator-roster-reader
```

Expected: PASS (both tests).

- [ ] **Step 5: Re-export from the barrel**

Append to `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`:

```ts
export { Sp11SeedSyntheticCreatorRosterReader } from "./sp11-seed-synthetic-creator-roster-reader.js";
```

- [ ] **Step 6: Verify typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts \
        packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts \
        packages/creative-pipeline/src/pcd/synthetic-creator/index.ts
git commit -m "feat(pcd): SP21 — Sp11SeedSyntheticCreatorRosterReader (temporary seed adapter, SP21.1 reserved)"
```

---

## Task 5: Composer happy-path test (red)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

This is the red test that drives Task 6's implementation. It exercises the full happy path with all three readers populated and asserts the composer returns the same decision the underlying pure `selectSyntheticCreator` would produce given the assembled input.

- [ ] **Step 1: Create the test file**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  PCD_PERFORMANCE_OVERLAY_VERSION,
  type CreativeBrief,
  type CreatorIdentityLicensePayload,
  type CreatorPerformanceMetrics,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import type {
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
  SyntheticCreatorRosterReader,
} from "../synthetic-creator/synthetic-creator-selection-ports.js";
import { composeSyntheticCreatorSelection } from "./compose-synthetic-creator-selection.js";

function buildBrief(overrides: Partial<CreativeBrief> = {}): CreativeBrief {
  // Field shape mirrors the canonical brief used in
  // packages/creative-pipeline/src/pcd/selector/selector.test.ts
  // (`briefForCheryl`). If `CreativeBrief` gains additional required fields
  // in the future, mirror them from that same file.
  //
  // Match the first SP11 SG/med_spa entry so the happy path produces a
  // non-empty compatible set without depending on every seed dimension.
  const cheryl = SP11_SYNTHETIC_CREATOR_ROSTER.find((e) => e.creatorIdentity.id === "cid_synth_cheryl_sg_01")!;
  return {
    briefId: "brief_sp21_happy",
    clinicId: "clinic_sp21_happy",
    treatmentClass: cheryl.synthetic.treatmentClass,
    market: cheryl.synthetic.market,
    jurisdictionCode: "SG",
    platform: "tiktok",
    targetVibe: cheryl.synthetic.vibe,
    targetEthnicityFamily: cheryl.synthetic.ethnicityFamily,
    targetAgeBand: cheryl.synthetic.ageBand,
    pricePositioning: cheryl.synthetic.pricePositioning,
    hardConstraints: [],
    ...overrides,
  };
}

function buildLease(
  creatorIdentityId: string,
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload {
  return {
    id: `lic_${creatorIdentityId}`,
    creatorIdentityId,
    clinicId: "clinic_sp21_happy",
    market: "SG",
    treatmentClass: "med_spa",
    lockType: "priority_access",
    exclusivityScope: "clinic",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
    priorityRank: 1,
    status: "active",
    ...overrides,
  };
}

function buildMetrics(
  creatorIdentityId: string,
  sampleSize: number,
  successRate: number,
  windowStart: Date,
  windowEnd: Date,
): CreatorPerformanceMetrics {
  const successCount = Math.round(sampleSize * successRate);
  return {
    creatorIdentityId,
    sampleSize,
    successCount,
    failureCount: sampleSize - successCount,
    manualSkipCount: 0,
    successRate,
    medianLatencyMs: 4200,
    windowStart,
    windowEnd,
    metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
  };
}

describe("composeSyntheticCreatorSelection — happy path", () => {
  it("calls all three readers, threads result into the selector, returns an allowed decision", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();

    // SP11 seed already filtered down to the compatible roster shape — use it.
    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(
        SP11_SYNTHETIC_CREATOR_ROSTER.filter(
          (e) =>
            e.synthetic.status === "active" &&
            e.synthetic.market === brief.market &&
            e.synthetic.treatmentClass === brief.treatmentClass,
        ),
      ),
    };

    // One lease per candidate so the license gate passes for each.
    const leases = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    ).map((e) => buildLease(e.creatorIdentity.id));

    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };

    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = now;
    const metricsMap = new Map<string, CreatorPerformanceMetrics>();
    for (const lease of leases) {
      metricsMap.set(
        lease.creatorIdentityId,
        buildMetrics(lease.creatorIdentityId, 10, 0.7, windowStart, windowEnd),
      );
    }
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockResolvedValue(metricsMap),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(rosterReader.listActiveCompatibleRoster).toHaveBeenCalledOnce();
    expect(leaseReader.findActiveLeasesForBriefScope).toHaveBeenCalledOnce();
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledOnce();

    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.performanceOverlayApplied).toBe(true);
      expect(decision.metricsSnapshotVersion).toBe(PCD_PERFORMANCE_OVERLAY_VERSION);
      expect(decision.briefId).toBe(brief.briefId);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: FAIL — module not found.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer happy-path test (red)"
```

---

## Task 6: Composer implementation (green)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/index.ts` (barrel re-export)

The composer. Free-standing async function. Imports from `@creativeagent/schemas` + same-package selector + same-package synthetic-creator ports only. No `@creativeagent/db` import. No `new Date(` inside the body.

- [ ] **Step 1: Create the composer file**

```ts
// SP21 — Synthetic-creator selection composer.
//
// The first impure orchestrator in the PCD vertical. Reads the roster,
// brief-scoped active leases, and a 30-day SP20 performance-metrics window
// through three injected port interfaces, then invokes the unchanged
// SP13/SP20 pure selectSyntheticCreator and returns its decision.
//
// LAYERING GUARDRAIL — this file MUST NOT import from @creativeagent/db.
// Concrete Prisma readers live in @creativeagent/db and are wired in by the
// runner/app layer (// MERGE-BACK). The composer depends on the port
// interfaces in ../synthetic-creator/synthetic-creator-selection-ports.ts.
//
// CLOCK DISCIPLINE — metricsSince is derived from input.now. The composer
// MUST NOT call new Date() in its body. SP21 anti-pattern test #2 enforces.
//
// EMPTY-ROSTER SHORT-CIRCUIT — when the roster reader returns [], the
// composer does NOT call the lease reader or the metrics reader. The
// selector is invoked with empty arrays and returns
// no_compatible_candidates.
//
// MERGE-BACK markers:
//   1. Replace Sp11SeedSyntheticCreatorRosterReader with a real
//      PrismaCreatorIdentitySyntheticReader.findActive(...) at SP21.1.
//   2. Inngest step wrapping at the call site (Switchboard runner owns).
//   3. WorkTrace emission at composer entry / exit (forensic record-keeping).
//   4. Operator-facing composer-selection dashboards.
//   5. SP21_PERFORMANCE_WINDOW_DAYS becomes a Switchboard-side config knob
//      (per-tier or per-clinic).

import type {
  CreativeBrief,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import type {
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
  SyntheticCreatorRosterReader,
} from "../synthetic-creator/synthetic-creator-selection-ports.js";
import { selectSyntheticCreator } from "./selector.js";

const SP21_PERFORMANCE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ComposeSyntheticCreatorSelectionInput = {
  brief: CreativeBrief;
  now: Date;
};

export type ComposeSyntheticCreatorSelectionStores = {
  rosterReader: SyntheticCreatorRosterReader;
  leaseReader: SyntheticCreatorLeaseReader;
  metricsReader: SyntheticCreatorMetricsReader;
};

export async function composeSyntheticCreatorSelection(
  input: ComposeSyntheticCreatorSelectionInput,
  stores: ComposeSyntheticCreatorSelectionStores,
): Promise<SyntheticCreatorSelectionDecision> {
  // Step 1 — read roster (market + treatmentClass scope).
  const roster = await stores.rosterReader.listActiveCompatibleRoster({
    market: input.brief.market,
    treatmentClass: input.brief.treatmentClass,
  });

  // Step 2 — empty-roster short-circuit. Skip lease + metrics reads entirely.
  if (roster.length === 0) {
    return selectSyntheticCreator({
      brief: input.brief,
      now: input.now,
      roster: [],
      leases: [],
      performanceHistory: undefined,
    });
  }

  // Step 3 — read brief-scoped active leases.
  const leases = await stores.leaseReader.findActiveLeasesForBriefScope({
    clinicId: input.brief.clinicId,
    market: input.brief.market,
    treatmentClass: input.brief.treatmentClass,
    now: input.now,
  });

  // Step 4 — read 30-day performance metrics. metricsSince derived from
  // input.now (never new Date()).
  const metricsSince = new Date(input.now.getTime() - SP21_PERFORMANCE_WINDOW_DAYS * MS_PER_DAY);
  const performanceHistory = await stores.metricsReader.findMetricsForCreators({
    creatorIdentityIds: roster.map((entry) => entry.creatorIdentity.id),
    window: { since: metricsSince },
  });

  // Step 5 — invoke the pure selector with the assembled input.
  return selectSyntheticCreator({
    brief: input.brief,
    now: input.now,
    roster,
    leases,
    performanceHistory,
  });
}
```

- [ ] **Step 2: Re-export from the selector barrel**

Append to `packages/creative-pipeline/src/pcd/selector/index.ts`:

```ts
export { composeSyntheticCreatorSelection } from "./compose-synthetic-creator-selection.js";
export type {
  ComposeSyntheticCreatorSelectionInput,
  ComposeSyntheticCreatorSelectionStores,
} from "./compose-synthetic-creator-selection.js";
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (the happy-path test from Task 5).

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts \
        packages/creative-pipeline/src/pcd/selector/index.ts
git commit -m "feat(pcd): SP21 — composeSyntheticCreatorSelection (first impure PCD orchestrator)"
```

---

## Task 7: Empty-roster short-circuit test

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

Append a describe block that asserts the locked empty-roster behavior: when the roster reader returns `[]`, the composer MUST NOT call the lease reader or the metrics reader, and the selector returns `no_compatible_candidates`.

- [ ] **Step 1: Append the test**

```ts
describe("composeSyntheticCreatorSelection — empty roster short-circuit", () => {
  it("does not call lease or metrics readers when roster is empty; selector returns no_compatible_candidates", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_empty_roster" });

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue([]),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn(),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(rosterReader.listActiveCompatibleRoster).toHaveBeenCalledOnce();
    expect(leaseReader.findActiveLeasesForBriefScope).not.toHaveBeenCalled();
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();

    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
      expect(decision.briefId).toBe("brief_sp21_empty_roster");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (happy + empty-roster, two tests).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer empty-roster short-circuit (lease + metrics readers skipped)"
```

---

## Task 8: Empty-leases test

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

When roster is non-empty but leases are empty, every candidate fails the license gate → selector returns `all_blocked_by_license`. Metrics reader is still called (the short-circuit applies only to the empty-roster case).

- [ ] **Step 1: Append the test**

```ts
describe("composeSyntheticCreatorSelection — empty leases", () => {
  it("calls metrics reader; selector returns all_blocked_by_license", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_empty_leases" });

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue([]),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(leaseReader.findActiveLeasesForBriefScope).toHaveBeenCalledOnce();
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledOnce();

    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (3 tests now).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer empty-leases (selector returns all_blocked_by_license)"
```

---

## Task 9: Empty-metrics cold-start test

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

When the metrics reader returns an empty Map (PcdPerformanceSnapshot empty at land time), the composer passes it through to the selector. SP20 Guardrail G makes the comparator a no-op for missing/zero-sample sides, so the decision is SP13-equivalent. The expected divergences from a `performanceHistory: undefined` call are exactly two fields: `performanceOverlayApplied` and `metricsSnapshotVersion`.

- [ ] **Step 1: Append the test**

```ts
describe("composeSyntheticCreatorSelection — empty metrics (cold start)", () => {
  it("passes empty performanceHistory Map to selector; performanceOverlayApplied=true; metricsSnapshotVersion=null when map is empty", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_cold_metrics" });

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      // performanceOverlayApplied tracks "did the composer supply a map?"
      // — yes, even though the map is empty. (Selector's resolveMetricsVersion
      // returns null on an empty map per its reader contract.)
      expect(decision.performanceOverlayApplied).toBe(true);
      expect(decision.metricsSnapshotVersion).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (4 tests now).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer cold-start empty metrics map (performanceOverlayApplied=true, metricsVersion=null)"
```

---

## Task 10: Reader-throw propagation tests

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

Three tests, one per reader: rejected promise propagates as a thrown error. Each test also asserts that **downstream** readers were NOT called when an upstream reader threw.

- [ ] **Step 1: Append the describe block**

```ts
describe("composeSyntheticCreatorSelection — reader-throw propagation", () => {
  it("rethrows when rosterReader fails; lease + metrics readers not called", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("roster boom");

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockRejectedValue(bang),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn(),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
    expect(leaseReader.findActiveLeasesForBriefScope).not.toHaveBeenCalled();
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();
  });

  it("rethrows when leaseReader fails; metrics reader not called", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("lease boom");

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockRejectedValue(bang),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();
  });

  it("rethrows when metricsReader fails", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("metrics boom");

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockRejectedValue(bang),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (7 tests now).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer reader-throw propagation (3 tests, downstream readers skipped)"
```

---

## Task 11: 30-day window math test

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts`

Deterministic check that the composer passes `window.since === input.now - 30 days` to the metrics reader, and that the `creatorIdentityIds` argument matches the roster.

- [ ] **Step 1: Append the test**

```ts
describe("composeSyntheticCreatorSelection — metrics window + ids contract", () => {
  it("calls metrics reader with window.since = input.now - 30 days and ids matching the roster", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    const expectedSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledWith({
      creatorIdentityIds: compatibleRoster.map((e) => e.creatorIdentity.id),
      window: { since: expectedSince },
    });
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- compose-synthetic-creator-selection
```

Expected: PASS (8 tests now).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts
git commit -m "test(pcd): SP21 — composer 30-day window math + creatorIdentityIds contract"
```

---

## Task 12: SP21 anti-pattern test

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts`

Six assertions keyed to SP20 squash `06ba0ac`.

- [ ] **Step 1: Create the file**

```ts
// SP21 anti-pattern test. Six assertions per design §7.4 + plan Task 12.
// Keyed to SP20 squash SHA 06ba0ac as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "06ba0ac";

const SP21_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // Task 2 — lease reader new method + test.
  "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
  "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts",
  // Task 3 — ports + synthetic-creator barrel widen.
  "packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts",
  // Task 4 — seed adapter + test.
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts",
  // Tasks 5–6 — composer + test + selector barrel widen.
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts",
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts",
  "packages/creative-pipeline/src/pcd/selector/index.ts",
  // This file.
  "packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md",
];

function listAllSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === "dist" ||
        ent.name === ".worktrees"
      )
        continue;
      out.push(...listAllSourceFiles(p));
    } else if (ent.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      out.push(p);
    }
  }
  return out;
}

const COMPOSER_PATH = join(
  REPO_ROOT,
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts",
);

describe("SP21 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP21 allowlist (freeze vs SP20 squash 06ba0ac)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP21_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 13 may
      // modify them in a separate commit).
      if (/(sp\d+[a-c]?)-anti-patterns\.test\.ts$/.test(f)) continue;
      offenders.push(f);
    }
    expect(offenders, `Unallowlisted edits since ${FREEZE_SHA}: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("#2 composer does not import from @creativeagent/db", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    expect(body).not.toMatch(/from\s+["']@creativeagent\/db["']/);
  });

  it("#3 composer body contains no `new Date(` (metricsSince must be derived from input.now)", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    // Strip line comments before searching so the file's header comment block
    // does not produce false positives.
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(bodyNoLineComments).not.toMatch(/new\s+Date\s*\(/);
  });

  it("#4 composer does not reference forbidden PCD subsystems (snapshot writer, router, QC, consent, Inngest, env)", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const forbidden of [
      "PcdIdentitySnapshot",
      "routePcdShot",
      "qcEvaluator",
      "consentPreCheck",
      "syntheticRouter",
      "Inngest",
      "process.env",
    ]) {
      expect(bodyNoLineComments).not.toContain(forbidden);
    }
  });

  it("#5 composer does not import from forbidden sibling dirs (provider-router, synthetic-router, qc-, consent-, snapshot writer, performance-snapshot)", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lines = body.split("\n");
    const importLines = lines.filter((line) => /^\s*import\b/.test(line));
    const forbidden = [
      /from\s+["']\.\.\/provider-router/,
      /from\s+["']\.\.\/synthetic-router\//,
      /from\s+["']\.\.\/qc-/,
      /from\s+["']\.\.\/consent-/,
      /from\s+["']\.\.\/pcd-identity-snapshot-/,
      /from\s+["']\.\.\/performance-snapshot\//,
    ];
    for (const pattern of forbidden) {
      for (const line of importLines) {
        expect(line, `forbidden import: ${line}`).not.toMatch(pattern);
      }
    }
  });

  it("#6 PCD pinned-constant census stays at 24 (no new PCD_*_VERSION export introduced since 06ba0ac)", () => {
    // The 24 pinned constants live in packages/schemas/src/*-version.ts as
    // single-line `export const PCD_..._VERSION = "..."`. SP21 introduces
    // NO new pinned constant, so the count of such files in the schemas
    // package must be unchanged from the freeze baseline.
    const schemasDir = "packages/schemas/src";
    const baselineFiles = execSync(
      `git ls-tree -r --name-only ${FREEZE_SHA} -- ${schemasDir}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    const currentFiles = listAllSourceFiles(join(REPO_ROOT, schemasDir))
      .map((p) => relative(REPO_ROOT, p))
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    expect(currentFiles.sort()).toEqual(baselineFiles.sort());
  });
});
```

- [ ] **Step 2: Run the file**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp21-anti-patterns
```

Expected: PASS (6 assertions).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts
git commit -m "test(pcd): SP21 — anti-pattern test (6 assertions, frozen vs SP20 squash 06ba0ac)"
```

---

## Task 13: Allowlist sweep across prior `sp*-anti-patterns.test.ts`

**Files:**
- Modify (only if failing): any prior `sp*-anti-patterns.test.ts` whose allowlist needs a narrow extension for SP21 files.

The freeze-baseline check (`#1` in each prior anti-pattern file) keys against an older SHA than `06ba0ac`. Most prior tests permit `sp*-anti-patterns.test.ts` edits via a regex carve-out, so this sweep is usually a no-op — but the discovery step is mandatory.

- [ ] **Step 1: Discover the live set**

```bash
find packages -name "sp*-anti-patterns.test.ts" -not -path "*/node_modules/*"
```

Record each path. Do NOT pre-list them in this plan — discovery is the contract.

- [ ] **Step 2: Run them all**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- anti-patterns
pnpm --filter @creativeagent/schemas test -- anti-patterns
pnpm --filter @creativeagent/db test -- anti-patterns
```

Expected outcome: most pass. Any failure will name a specific SP21 file as an unallowlisted edit.

- [ ] **Step 3: For each failing prior test, add a narrow allowlist entry**

For a failure of the form `Unallowlisted edits since <SHA>: <sp21-file-path>` in `packages/.../spNN-anti-patterns.test.ts`:

- Open the failing test file.
- Locate its `SP<NN>_ALLOWLISTED_EDITS` (or equivalently named) array.
- Append ONLY the offending paths. Do not widen to entire directories. Do not pre-emptively add files that did not cause a failure.

Repeat until all prior anti-pattern tests pass.

- [ ] **Step 4: Run the full anti-pattern set + SP21's own**

```bash
pnpm test -- anti-patterns
```

Expected: every `sp*-anti-patterns.test.ts` PASSES.

- [ ] **Step 5: Commit**

If any prior tests were modified, commit them in a single follow-up commit:

```bash
git add packages/**/sp*-anti-patterns.test.ts
git commit -m "test(pcd): SP21 — allowlist SP21 files in prior sp*-anti-patterns tests"
```

If no prior tests required changes:

```bash
git status   # confirm clean; skip the commit
```

---

## Task 14: Final verification gate

**Files:** none.

- [ ] **Step 1: Full typecheck + test + lint sweep**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Expected: all green.

- [ ] **Step 2: Worktree-side prettier check (SP19/SP20 lesson — controller-side prettier --check from parent repo silently passes on worktree-only files)**

Run from inside `.worktrees/sp21`:

```bash
git diff --name-only main...HEAD | xargs pnpm exec prettier --check
```

Expected: every changed file reports `Code style issues found in 0 files.` equivalent — i.e. clean.

- [ ] **Step 3: Confirm the PCD pinned-constant census stays at 24**

```bash
grep -rn "^export const PCD_[A-Z_]*_VERSION" packages/schemas/src/ | grep -v "\.test\.ts"
```

Expected: exactly 24 lines (one per pinned constant; no SP21 addition).

- [ ] **Step 4: Confirm composer does not import @creativeagent/db**

```bash
grep -n "@creativeagent/db" packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts || echo "OK — no db import"
```

Expected: `OK — no db import`.

- [ ] **Step 5: Run the SP21 anti-pattern test in isolation**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp21-anti-patterns
```

Expected: 6 tests PASS.

- [ ] **Step 6: Confirm no Prisma migration was introduced**

```bash
git diff --name-only main...HEAD -- packages/db/prisma/migrations/
```

Expected: empty output.

---

## Task 15: Open the PR

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin pcd/sp21-synthetic-selector-composer
```

- [ ] **Step 2: Open the PR via `gh`**

```bash
gh pr create --title "feat(pcd): SP21 — synthetic-creator selection composer (first impure PCD orchestrator)" --body "$(cat <<'EOF'
## Summary

- First impure orchestrator in the PCD vertical. Closes the SP20 "caller supplies `performanceHistory`" loop.
- Composer `composeSyntheticCreatorSelection(input, stores)` reads roster + brief-scoped leases + 30-day SP20 metrics through three injected ports, then invokes the unchanged SP13/SP20 pure `selectSyntheticCreator`.
- **Layering:** composer imports `@creativeagent/schemas` + same-package selector + same-package synthetic-creator ports only. **No `@creativeagent/db` import.** Concrete Prisma readers are wired in by the runner/app layer (// MERGE-BACK).
- New: `Sp11SeedSyntheticCreatorRosterReader` (temporary in-memory adapter, SP21.1 reserved for the real Prisma synthetic-creator reader) and `PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope` (additive method, no migration).
- **No new pinned constant.** PCD pinned-constant count stays at 24.
- Empty-roster short-circuit locked + tested: lease + metrics readers not called.

## Test plan

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (full creative-pipeline + schemas + db packages)
- [ ] `pnpm lint`
- [ ] Worktree-side prettier: `git diff --name-only main...HEAD | xargs pnpm exec prettier --check`
- [ ] `sp21-anti-patterns.test.ts` passes (6 assertions, frozen vs SP20 squash 06ba0ac)
- [ ] Every prior `sp*-anti-patterns.test.ts` still passes
- [ ] Pinned-constant census stays at 24
- [ ] No new Prisma migration introduced

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

`gh pr create` prints the URL. Surface it as the task result.

---

## Self-review notes

Spec coverage check — every numbered section of the SP21 design is implemented:

| Spec § | Plan task |
|---|---|
| §1 Purpose + §1.1 out-of-scope + §1.2 hard rules | Anti-pattern enforced by Task 12 (#1, #2, #3, #4, #5, #6) |
| §2 Composer surface (free-standing async fn; types) | Task 6 (impl) + Task 5 (red test) |
| §2.1 Layering — no @creativeagent/db import | Task 12 #2 + Task 14 step 4 |
| §3 Port interfaces + 3.1 concrete readers | Task 3 (ports) + Task 2 (lease reader method) + Task 4 (seed adapter) + Tasks 5–6 wire existing SP20 metrics reader through |
| §4 Composition flow (5 steps) | Task 6 step 1 (impl) — matches the 5 steps verbatim |
| §4.1 Empty-roster short-circuit | Task 6 impl + Task 7 test |
| §4.2 Cold-start handling | Task 6 impl + Task 9 test |
| §5 30-day window constant | Task 6 impl (`SP21_PERFORMANCE_WINDOW_DAYS`) + Task 11 test + Task 14 step 3 (census) |
| §6 Error handling — throw raw | Task 10 (3 propagation tests) |
| §7.1 Unit tests (9 cases) | Tasks 5, 7, 8, 9, 10 (×3), 11 — total 7 composer tests covering all 9 listed cases (3 reader-throw tests fold cases 7/8/9; cases 1/2/3/4/5/6 are happy/empty-roster/empty-leases/empty-metrics/window/ids) |
| §7.2 Sp11SeedSyntheticCreatorRosterReader test | Task 4 |
| §7.3 PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope test | Task 2 |
| §7.4 Anti-pattern test (6 assertions) | Task 12 |
| §7.5 Allowlist sweep | Task 13 |
| §8 Files added/touched | Tasks 2–6, 12; final verification Task 14 |
| §9 MERGE-BACK markers | Task 6 step 1 (header comment block) |
| §10 ~14 TDD tasks | This plan: 15 tasks (Pre-flight + 14 substantive + PR open) |
| §11 Lessons from SP19/SP20 | Task 1 (schema verification first); Task 14 step 2 (worktree-side prettier); Task 13 (allowlist sweep discipline) |

Placeholder scan: every step contains either complete runnable code, a runnable shell command with expected output, or an explicit instruction that names exact files and changes. The Task 13 step 3 instruction is intentionally a *procedure* (run each failing test, add the offending path) rather than pre-listed paths — the design rejected pre-listing in favor of discovery. That is not a placeholder; it is the locked plan requirement.

Type consistency: `SyntheticCreatorRosterReader`, `SyntheticCreatorLeaseReader`, `SyntheticCreatorMetricsReader` shapes are byte-identical across Tasks 3, 4, 5, 6, 7, 8, 9, 10, 11. `ComposeSyntheticCreatorSelectionInput` / `ComposeSyntheticCreatorSelectionStores` match between Task 5 (test) and Task 6 (impl). `SP21_PERFORMANCE_WINDOW_DAYS = 30` is referenced in Task 6 (impl) and Task 11 (test computes the same `30 * 24 * 60 * 60 * 1000` window). `FREEZE_SHA = "06ba0ac"` matches the plan header and Task 12 file. `Sp11SeedSyntheticCreatorRosterReader` class name is identical in Tasks 4, 12 (allowlist), and the design spec.
