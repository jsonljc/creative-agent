# PCD SP20 — Performance-Overlay Re-rank — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a selector-side performance overlay that re-ranks contractually-equivalent SP12 candidates by SP19 historical success rate and median latency, without touching SP12 license-ordering semantics, without writing a Prisma migration, and producing byte-identical decisions to SP13 when no overlay data is supplied.

**Architecture:** Pure-orchestration slice (SP10C precedent) plus a bounded SP13 source-body carve-out at three forward-declared sites (`metricsSnapshotVersion`, `performanceOverlayApplied`, and the selector signature/comparator). New `CreatorPerformanceMetrics` schema lives in `@creativeagent/schemas`; SQL aggregation lives in a new Prisma-backed reader in `@creativeagent/db`; selector consumes a ready `Map<creatorIdentityId, CreatorPerformanceMetrics>` and never performs aggregation. 24th pinned constant `PCD_PERFORMANCE_OVERLAY_VERSION` is stamped by the reader; selector reads it through from the supplied map.

**Tech Stack:** TypeScript (ESM, `.js` extensions in relative imports), Zod 3.x, Prisma 5 with Postgres, Vitest. Conventional Commits; co-located tests; 400-line soft file-size limit per `CLAUDE.md`.

**Branch:** `pcd/sp20-performance-overlay-rerank` in worktree `.worktrees/sp20`. (If `.worktrees/sp20` does not yet exist, create the worktree via the `superpowers:using-git-worktrees` skill before executing Task 1.)

**Anti-pattern freeze SHA:** `1d22d61` (SP19 squash on `main`, 2026-05-16).

**Spec:** `docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md` (commit `d33c353`).

**Locked plan requirements (user, 2026-05-16):**
1. Verify the SQL join path first (Task 1).
2. No Prisma migration.
3. No selector-side aggregation.
4. No selector import of `PCD_PERFORMANCE_OVERLAY_VERSION`.
5. `performanceHistory` empty/undefined remains SP13-equivalent except the expected `performanceOverlayApplied` and `metricsSnapshotVersion` slots.
6. SP12 license ordering remains untouchable.

---

## Pre-flight (one-time, before Task 1)

The worktree should already exist at `.worktrees/sp20` on branch `pcd/sp20-performance-overlay-rerank` (created via `superpowers:using-git-worktrees`). All subsequent task commands run from that worktree.

```bash
# Verify worktree + branch
cd .worktrees/sp20
git status                                # clean, on pcd/sp20-performance-overlay-rerank
git log --oneline -1                      # 1d22d61 feat(pcd): SP19 ...

# Install deps once
pnpm install

# Verify baseline green
pnpm db:generate
pnpm typecheck && pnpm test && pnpm exec prettier --check .
```

Expected: clean. If anything fails on a clean checkout, stop and investigate — that is not a SP20 concern but must be resolved before adding new code.

---

## Task 1: Verify Prisma join path (no code; investigation + commit a finding note)

**Files:**
- Read: `packages/db/prisma/schema.prisma`
- Create: `docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md`

The metrics reader must aggregate `PcdPerformanceSnapshot` rows GROUPed by `creatorIdentityId`. The design's worst-case join chain is `PcdPerformanceSnapshot → AssetRecord → PcdIdentitySnapshot → creatorIdentityId`. Initial inspection suggests `AssetRecord` carries `creatorIdentityId` directly (schema.prisma:325), which would shorten the chain to `PcdPerformanceSnapshot → AssetRecord.creatorIdentityId`. This task locks the join path before any SQL is written.

- [ ] **Step 1: Read the relevant Prisma blocks**

Read `packages/db/prisma/schema.prisma`. Locate the three blocks: `model AssetRecord`, `model PcdIdentitySnapshot`, `model PcdPerformanceSnapshot`. For each, note:

- Primary key column(s).
- Foreign-key relations.
- Whether `creatorIdentityId` is present as a column.
- Whether `assetRecordId` is unique on `PcdPerformanceSnapshot`.

- [ ] **Step 2: Decide the join path**

Choose ONE of:

- **Path A (preferred, if `AssetRecord.creatorIdentityId` is non-null and reliably populated for every row that has a companion `PcdPerformanceSnapshot`):** `PcdPerformanceSnapshot` JOIN `AssetRecord` ON `assetRecordId` → `AssetRecord.creatorIdentityId`. One join.
- **Path B (fallback, if `AssetRecord.creatorIdentityId` is nullable or unreliable):** `PcdPerformanceSnapshot` JOIN `AssetRecord` JOIN `PcdIdentitySnapshot` ON the identity-snapshot FK → `PcdIdentitySnapshot.creatorIdentityId`. Two joins.

Write findings to `docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md`. Include:

- Quoted excerpts of the three Prisma models (just the relevant fields, ~5 lines each).
- The chosen path (A or B) with one-sentence justification.
- The exact SQL fragment that resolves `creatorIdentityId` for a `PcdPerformanceSnapshot` row.

- [ ] **Step 3: Commit findings**

```bash
git add docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md
git commit -m "docs(pcd): SP20 task 1 — Prisma join path verification"
```

**Acceptance:** The chosen path is documented and committed. No source code changed. Task 5 references this finding when writing the reader's SQL.

---

## Task 2: Pin `PCD_PERFORMANCE_OVERLAY_VERSION` (24th constant) + widen schemas barrel upfront

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts`
- Create: `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.test.ts`
- Modify: `packages/schemas/src/index.ts` (barrel re-export — placeholder only; the actual file lands in Task 3)

Guardrail C (sole literal site) + Guardrail I (schemas barrel widened upfront). The barrel re-export must reference the schema file before Task 3 creates it, so we add a stub schema file in this task too (one-line `export {}`), and Task 3 fleshes it out. This keeps each task self-contained and avoids "deep import path workarounds" called out by Guardrail I.

- [ ] **Step 1: Write the failing version-pin test**

Create `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "./performance-overlay-version.js";

describe("PCD_PERFORMANCE_OVERLAY_VERSION", () => {
  it("is the literal pcd-performance-overlay@1.0.0", () => {
    expect(PCD_PERFORMANCE_OVERLAY_VERSION).toBe("pcd-performance-overlay@1.0.0");
  });
});
```

- [ ] **Step 2: Run the test, expect FAIL**

```
pnpm --filter @creativeagent/creative-pipeline test -- performance-overlay-version
```

Expected: FAIL with "Cannot find module './performance-overlay-version.js'".

- [ ] **Step 3: Implement the constant**

Create `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts`:

```ts
// SP20 — sole literal site for the performance-overlay pinned constant.
// MERGE-BACK: stays at @creativeagent/* package locality; rename pass at merge.
//
// Guardrail C (design §2.1):
//   - This file is the only non-test source file that contains the literal
//     "pcd-performance-overlay@".
//   - The metrics reader (packages/db/src/stores/
//     prisma-pcd-creator-performance-metrics-reader.ts) is the only non-test
//     runtime source file that imports this symbol. The SP13 selector does
//     NOT import it; the selector reads metrics.metricsVersion through from
//     the supplied performanceHistory map.
//
// Anti-pattern test (sp20-anti-patterns.test.ts) enforces both halves.

export const PCD_PERFORMANCE_OVERLAY_VERSION = "pcd-performance-overlay@1.0.0";
```

- [ ] **Step 4: Run the test, expect PASS**

```
pnpm --filter @creativeagent/creative-pipeline test -- performance-overlay-version
```

Expected: PASS (1 test).

- [ ] **Step 5: Add stub schema file + barrel re-export**

Create `packages/schemas/src/pcd-creator-performance-metrics.ts` (stub — Task 3 fills it out):

```ts
// SP20 — CreatorPerformanceMetrics schema. Stub; Task 3 fills the body.
export {};
```

Modify `packages/schemas/src/index.ts` to add the re-export. Locate the existing `export * from "./pcd-performance-snapshot.js";` line (or the alphabetically-adjacent SP19 export) and add immediately after it:

```ts
export * from "./pcd-creator-performance-metrics.js";
```

- [ ] **Step 6: Typecheck**

```
pnpm typecheck
```

Expected: clean. The stub schema exports nothing, but the barrel widen is in place per Guardrail I.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts \
        packages/creative-pipeline/src/pcd/selector/performance-overlay-version.test.ts \
        packages/schemas/src/pcd-creator-performance-metrics.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP20 task 2 — pin PCD_PERFORMANCE_OVERLAY_VERSION + widen schemas barrel"
```

---

## Task 3: `CreatorPerformanceMetrics` schema + tests

**Files:**
- Modify: `packages/schemas/src/pcd-creator-performance-metrics.ts` (flesh out the Task 2 stub)
- Create: `packages/schemas/src/pcd-creator-performance-metrics.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `packages/schemas/src/pcd-creator-performance-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CreatorPerformanceMetricsSchema,
  type CreatorPerformanceMetrics,
} from "./pcd-creator-performance-metrics.js";

const baseline: CreatorPerformanceMetrics = {
  creatorIdentityId: "creator-A",
  sampleSize: 10,
  successCount: 7,
  failureCount: 2,
  manualSkipCount: 1,
  successRate: 0.7,
  medianLatencyMs: 1500,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: "pcd-performance-overlay@1.0.0",
};

describe("CreatorPerformanceMetricsSchema", () => {
  it("accepts a valid populated record", () => {
    const parsed = CreatorPerformanceMetricsSchema.parse(baseline);
    expect(parsed).toEqual(baseline);
  });

  it("accepts a cold-start record (sampleSize 0, null latency, 0 success rate)", () => {
    const cold = {
      ...baseline,
      sampleSize: 0,
      successCount: 0,
      failureCount: 0,
      manualSkipCount: 0,
      successRate: 0,
      medianLatencyMs: null,
    };
    expect(() => CreatorPerformanceMetricsSchema.parse(cold)).not.toThrow();
  });

  it("rejects negative counts", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, successCount: -1 }),
    ).toThrow();
  });

  it("rejects successRate > 1", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, successRate: 1.1 }),
    ).toThrow();
  });

  it("rejects empty creatorIdentityId", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, creatorIdentityId: "" }),
    ).toThrow();
  });

  it("rejects empty metricsVersion", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, metricsVersion: "" }),
    ).toThrow();
  });

  it("rejects non-integer sampleSize", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, sampleSize: 1.5 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/schemas test -- pcd-creator-performance-metrics
```

Expected: FAIL — schema is the Task-2 stub.

- [ ] **Step 3: Implement the schema**

Replace `packages/schemas/src/pcd-creator-performance-metrics.ts` body:

```ts
// SP20 — CreatorPerformanceMetrics schema.
//
// Per-creator aggregation grain (per-creator overall in v1).
//
// MERGE-BACK: SP20.1 may add byShotType?: Record<PcdShotType, CreatorPerformanceMetrics>
// MERGE-BACK: SP20.5 may add costVarianceUsd?: number — joins SP10A forecast × SP19 actual.
//
// Reader contract invariants (defense-in-depth Zod parse enforces shape; the
// reader is responsible for satisfying the cross-field invariants below):
//   - successCount + failureCount + manualSkipCount === sampleSize
//   - sampleSize === 0  ⇒ medianLatencyMs === null AND successRate === 0
//   - sampleSize > 0    ⇒ medianLatencyMs !== null
//   - windowEnd > windowStart
//   - metricsVersion === PCD_PERFORMANCE_OVERLAY_VERSION

import { z } from "zod";

export const CreatorPerformanceMetricsSchema = z
  .object({
    creatorIdentityId: z.string().min(1),
    sampleSize: z.number().int().min(0),
    successCount: z.number().int().min(0),
    failureCount: z.number().int().min(0),
    manualSkipCount: z.number().int().min(0),
    successRate: z.number().min(0).max(1),
    medianLatencyMs: z.number().int().min(0).nullable(),
    windowStart: z.date(),
    windowEnd: z.date(),
    metricsVersion: z.string().min(1),
  })
  .strict()
  .readonly();

export type CreatorPerformanceMetrics = z.infer<typeof CreatorPerformanceMetricsSchema>;
```

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/schemas test -- pcd-creator-performance-metrics
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-creator-performance-metrics.ts \
        packages/schemas/src/pcd-creator-performance-metrics.test.ts
git commit -m "feat(pcd): SP20 task 3 — CreatorPerformanceMetrics schema"
```

---

## Task 4: Fixture helper `buildCreatorPerformanceMetrics`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts`
- Create: `packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts`

Test-time helper that builds a valid `CreatorPerformanceMetrics` with sensible defaults and accepts partial overrides. Used by Tasks 5, 7, 8, 9, 11. Co-located with the selector since it's a selector-test fixture (not a schema fixture — schemas package stays test-light).

- [ ] **Step 1: Write the failing fixture test**

Create `packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreatorPerformanceMetricsSchema } from "@creativeagent/schemas";
import { buildCreatorPerformanceMetrics } from "./build-creator-performance-metrics.fixture.js";

describe("buildCreatorPerformanceMetrics", () => {
  it("returns a Zod-valid baseline record", () => {
    const metrics = buildCreatorPerformanceMetrics();
    expect(() => CreatorPerformanceMetricsSchema.parse(metrics)).not.toThrow();
  });

  it("applies overrides", () => {
    const metrics = buildCreatorPerformanceMetrics({
      creatorIdentityId: "creator-X",
      sampleSize: 0,
      successCount: 0,
      failureCount: 0,
      manualSkipCount: 0,
      successRate: 0,
      medianLatencyMs: null,
    });
    expect(metrics.creatorIdentityId).toBe("creator-X");
    expect(metrics.sampleSize).toBe(0);
    expect(metrics.medianLatencyMs).toBeNull();
  });

  it("baseline has sampleSize > 0 and non-null medianLatencyMs", () => {
    const metrics = buildCreatorPerformanceMetrics();
    expect(metrics.sampleSize).toBeGreaterThan(0);
    expect(metrics.medianLatencyMs).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/creative-pipeline test -- build-creator-performance-metrics.fixture
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fixture**

Create `packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts`:

```ts
import type { CreatorPerformanceMetrics } from "@creativeagent/schemas";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "./performance-overlay-version.js";

const BASELINE: CreatorPerformanceMetrics = {
  creatorIdentityId: "creator-baseline",
  sampleSize: 10,
  successCount: 7,
  failureCount: 2,
  manualSkipCount: 1,
  successRate: 0.7,
  medianLatencyMs: 1500,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
};

export function buildCreatorPerformanceMetrics(
  overrides: Partial<CreatorPerformanceMetrics> = {},
): CreatorPerformanceMetrics {
  return { ...BASELINE, ...overrides };
}
```

Note: the fixture file is in `packages/creative-pipeline/src/pcd/selector/` and imports `PCD_PERFORMANCE_OVERLAY_VERSION` from the sibling version file. The anti-pattern test in Task 12 will explicitly allowlist fixture files (`.fixture.ts`) as a permitted importer alongside the metrics reader. This keeps Guardrail C's intent ("selector body doesn't import the constant") while permitting test fixtures.

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/creative-pipeline test -- build-creator-performance-metrics.fixture
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts \
        packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts
git commit -m "feat(pcd): SP20 task 4 — CreatorPerformanceMetrics fixture helper"
```

---

## Task 5: In-memory metrics reader test double

**Files:**
- Create: `packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts`
- Create: `packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts`

Test double matching SP12/SP13's in-memory reader precedent. Lets selector consumers in tests skip the Prisma path. NOT used by SP20's selector tests directly (those use the fixture from Task 4 + a plain `Map`); it's shipped for SP21+ composer tests.

- [ ] **Step 1: Write the failing test double test**

Create `packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreatorPerformanceMetricsSchema, type CreatorPerformanceMetrics } from "@creativeagent/schemas";
import { InMemoryPcdCreatorPerformanceMetricsReader } from "./in-memory-pcd-creator-performance-metrics-reader.js";

const make = (overrides: Partial<CreatorPerformanceMetrics> = {}): CreatorPerformanceMetrics => ({
  creatorIdentityId: "creator-A",
  sampleSize: 5,
  successCount: 4,
  failureCount: 1,
  manualSkipCount: 0,
  successRate: 0.8,
  medianLatencyMs: 1200,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: "pcd-performance-overlay@1.0.0",
  ...overrides,
});

describe("InMemoryPcdCreatorPerformanceMetricsReader", () => {
  it("returns metrics for known creators and cold-start entries for unknown creators", async () => {
    const seed = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", make({ creatorIdentityId: "creator-A" })],
    ]);
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(seed);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.get("creator-A")).toBeDefined();
    const cold = out.get("creator-B");
    expect(cold).toBeDefined();
    expect(cold!.sampleSize).toBe(0);
    expect(cold!.medianLatencyMs).toBeNull();
    expect(cold!.successRate).toBe(0);
  });

  it("returns Zod-valid entries for every queried id", async () => {
    const seed = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", make({ creatorIdentityId: "creator-A" })],
    ]);
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(seed);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    for (const entry of out.values()) {
      expect(() => CreatorPerformanceMetricsSchema.parse(entry)).not.toThrow();
    }
  });

  it("returns empty map when queried with empty id list", async () => {
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(new Map());
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: [],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/db test -- in-memory-pcd-creator-performance-metrics-reader
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts`:

```ts
// SP20 — in-memory CreatorPerformanceMetrics reader.
// Test double for SP21+ composer tests; not used by SP20 selector tests
// (those use a plain Map<string, CreatorPerformanceMetrics>).
//
// MERGE-BACK: shipped at @creativeagent/db package locality; rename pass at merge.

import type { CreatorPerformanceMetrics } from "@creativeagent/schemas";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "../../../creative-pipeline/src/pcd/selector/performance-overlay-version.js";

export type FindMetricsForCreatorsInput = {
  creatorIdentityIds: readonly string[];
  window: { since: Date };
};

export class InMemoryPcdCreatorPerformanceMetricsReader {
  constructor(private readonly seed: ReadonlyMap<string, CreatorPerformanceMetrics>) {}

  async findMetricsForCreators(
    input: FindMetricsForCreatorsInput,
  ): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>> {
    const out = new Map<string, CreatorPerformanceMetrics>();
    const now = new Date();
    for (const id of input.creatorIdentityIds) {
      const seeded = this.seed.get(id);
      if (seeded !== undefined) {
        out.set(id, seeded);
      } else {
        out.set(id, {
          creatorIdentityId: id,
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
          windowStart: input.window.since,
          windowEnd: now,
          metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
        });
      }
    }
    return out;
  }
}
```

**Important — verify the relative import path** to `performance-overlay-version.ts` works from `packages/db/src/stores/`. The two packages live as siblings under `packages/`; cross-package imports normally go through the package barrel. If the cross-package relative import causes a build break:

- **Fix:** Move `PCD_PERFORMANCE_OVERLAY_VERSION` to a new sibling file in `packages/db/src/` (e.g., `packages/db/src/pcd-performance-overlay-version.ts`) and re-export from there, OR re-export from a new `@creativeagent/schemas/pcd-performance-overlay-version` location. Update Task 2's file location.
- If the import resolves cleanly (TypeScript projects via `tsconfig.json` paths or pnpm workspace symlinks), proceed as-is.

Decide at this task; document the chosen location in a one-line comment at the top of the version file.

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/db test -- in-memory-pcd-creator-performance-metrics-reader
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts \
        packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts
git commit -m "feat(pcd): SP20 task 5 — in-memory CreatorPerformanceMetrics reader"
```

---

## Task 6: `PrismaPcdCreatorPerformanceMetricsReader` (real Postgres reader with SQL aggregation)

**Files:**
- Create: `packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts`
- Create: `packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.test.ts`

Real Prisma-backed reader. Uses `$queryRaw` for `percentile_cont`. Integration test runs against a real Postgres (project's existing integration-test setup; pattern matches SP19's `prisma-pcd-performance-snapshot-reader.test.ts`).

**Prerequisite:** Task 1's findings file. Use the Path A or Path B SQL fragment recorded there.

- [ ] **Step 1: Write the failing integration test**

Create `packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPcdCreatorPerformanceMetricsReader } from "./prisma-pcd-creator-performance-metrics-reader.js";

// Project's existing integration-test pattern: real Postgres via DATABASE_URL.
const prisma = new PrismaClient();

// Helpers — minimal seeders. Mirror SP19 reader test's seeder discipline.
// (Task implementer: copy the AssetRecord + PcdIdentitySnapshot + CreatorIdentity
// seed helpers from packages/db/src/stores/prisma-pcd-performance-snapshot-reader.test.ts
// or its sibling fixtures and parameterize creatorIdentityId.)

async function seedPerformanceRow(args: {
  creatorIdentityId: string;
  terminalKind: "success" | "failure" | "manual_skip";
  latencyMs: number;
  capturedAt: Date;
}): Promise<void> {
  // Implementation: follow SP19 reader test's seed pattern. Insert
  // CreatorIdentity → AssetRecord (with creatorIdentityId per Task 1
  // Path A) → PcdPerformanceSnapshot row with the chosen capturedAt.
  // See SP19 reader test for exact seeder calls.
  throw new Error("seed helper — copy from SP19 reader test");
}

beforeAll(async () => {
  // Truncate tables in dependency order: PcdPerformanceSnapshot →
  // AssetRecord → PcdIdentitySnapshot → CreatorIdentity. Per SP19
  // Guardrail H (onDelete: Restrict on PcdPerformanceSnapshot →
  // AssetRecord), performance rows must be deleted before asset rows.
});

afterEach(async () => {
  await prisma.pcdPerformanceSnapshot.deleteMany({});
  // Truncate other tables per SP19 cleanup pattern.
});

describe("PrismaPcdCreatorPerformanceMetricsReader", () => {
  it("returns empty map when no rows match", async () => {
    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    // Cold-start entry returned for queried id (per reader contract):
    expect(out.get("creator-A")).toBeDefined();
    expect(out.get("creator-A")!.sampleSize).toBe(0);
    expect(out.get("creator-A")!.medianLatencyMs).toBeNull();
  });

  it("aggregates mixed terminal kinds for one creator", async () => {
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 1000, capturedAt: new Date("2026-05-01") });
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 1500, capturedAt: new Date("2026-05-02") });
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 2000, capturedAt: new Date("2026-05-03") });
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "failure", latencyMs: 800, capturedAt: new Date("2026-05-04") });
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "failure", latencyMs: 1200, capturedAt: new Date("2026-05-05") });
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "manual_skip", latencyMs: 50, capturedAt: new Date("2026-05-06") });

    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    const m = out.get("creator-A")!;
    expect(m.sampleSize).toBe(6);
    expect(m.successCount).toBe(3);
    expect(m.failureCount).toBe(2);
    expect(m.manualSkipCount).toBe(1);
    expect(m.successRate).toBeCloseTo(0.5, 5);
    expect(m.medianLatencyMs).toBe(1100); // median of [50, 800, 1000, 1200, 1500, 2000] = (1000+1200)/2 = 1100
  });

  it("filters by window: pre-window rows excluded", async () => {
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 1000, capturedAt: new Date("2026-03-01") }); // pre-window
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 2000, capturedAt: new Date("2026-05-01") }); // in window

    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.get("creator-A")!.sampleSize).toBe(1);
    expect(out.get("creator-A")!.medianLatencyMs).toBe(2000);
  });

  it("returns one entry per queried creator id (cold-start entries included)", async () => {
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 1000, capturedAt: new Date("2026-05-01") });

    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B", "creator-C"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.size).toBe(3);
    expect(out.get("creator-A")!.sampleSize).toBe(1);
    expect(out.get("creator-B")!.sampleSize).toBe(0);
    expect(out.get("creator-C")!.sampleSize).toBe(0);
  });

  it("stamps every entry with PCD_PERFORMANCE_OVERLAY_VERSION", async () => {
    await seedPerformanceRow({ creatorIdentityId: "creator-A", terminalKind: "success", latencyMs: 1000, capturedAt: new Date("2026-05-01") });
    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    for (const entry of out.values()) {
      expect(entry.metricsVersion).toBe("pcd-performance-overlay@1.0.0");
    }
  });

  it("populates windowStart from the input `since` and windowEnd at or after query time", async () => {
    const since = new Date("2026-04-16T00:00:00Z");
    const reader = new PrismaPcdCreatorPerformanceMetricsReader(prisma);
    const before = new Date();
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since },
    });
    const after = new Date();
    const m = out.get("creator-A")!;
    expect(m.windowStart.getTime()).toBe(since.getTime());
    expect(m.windowEnd.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(m.windowEnd.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
```

The task implementer must replace the `seedPerformanceRow` `throw` with a real seeder that follows SP19 reader test patterns (copy from `packages/db/src/stores/prisma-pcd-performance-snapshot-reader.test.ts` and parameterize `creatorIdentityId`).

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/db test -- prisma-pcd-creator-performance-metrics-reader
```

Expected: FAIL — module not found and/or seed helper throws.

- [ ] **Step 3: Implement the reader**

Create `packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts`. Use Task 1's recorded join path. **Example (Path A — `AssetRecord.creatorIdentityId` direct):**

```ts
// SP20 — Prisma-backed CreatorPerformanceMetrics reader.
//
// Aggregates PcdPerformanceSnapshot rows GROUPed by creatorIdentityId for a
// caller-supplied window. Computes sampleSize, per-terminal-kind counts,
// successRate, and medianLatencyMs entirely at the DB boundary
// (Guardrail H). Stamps every returned entry with
// PCD_PERFORMANCE_OVERLAY_VERSION (Guardrail C-2).
//
// MERGE-BACK: composer/runner instantiates this reader and threads its
// output into selectSyntheticCreator via the performanceHistory input.
// MERGE-BACK: 30-day default lives at caller site, not in this reader.
// MERGE-BACK: Switchboard may have a richer denormalized join — reconcile.
//
// Join path (per Task 1 findings, Path A — confirm at implementation time):
//   PcdPerformanceSnapshot.assetRecordId → AssetRecord.id
//   AssetRecord.creatorIdentityId        → grouping key

import { Prisma, type PrismaClient } from "@prisma/client";
import type { CreatorPerformanceMetrics } from "@creativeagent/schemas";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "../../../creative-pipeline/src/pcd/selector/performance-overlay-version.js";

export type FindMetricsForCreatorsInput = {
  creatorIdentityIds: readonly string[];
  window: { since: Date };
};

type AggregateRow = {
  creator_identity_id: string;
  sample_size: bigint;
  success_count: bigint;
  failure_count: bigint;
  manual_skip_count: bigint;
  median_latency_ms: number | null;
};

export class PrismaPcdCreatorPerformanceMetricsReader {
  constructor(private readonly client: Pick<PrismaClient, "$queryRaw">) {}

  async findMetricsForCreators(
    input: FindMetricsForCreatorsInput,
  ): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>> {
    const ids = input.creatorIdentityIds;
    const out = new Map<string, CreatorPerformanceMetrics>();
    if (ids.length === 0) return out;

    const since = input.window.since;
    const windowEnd = new Date();

    const rows = await this.client.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        ar."creatorIdentityId" AS creator_identity_id,
        COUNT(*)::bigint                                                          AS sample_size,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'success')::bigint            AS success_count,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'failure')::bigint            AS failure_count,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'manual_skip')::bigint        AS manual_skip_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pps."latencyMs")::float8      AS median_latency_ms
      FROM "PcdPerformanceSnapshot" pps
      INNER JOIN "AssetRecord" ar ON ar.id = pps."assetRecordId"
      WHERE pps."capturedAt" >= ${since}
        AND ar."creatorIdentityId" IN (${Prisma.join(ids)})
      GROUP BY ar."creatorIdentityId"
    `);

    for (const row of rows) {
      const sampleSize = Number(row.sample_size);
      const successCount = Number(row.success_count);
      const failureCount = Number(row.failure_count);
      const manualSkipCount = Number(row.manual_skip_count);
      const medianLatencyMs =
        row.median_latency_ms === null ? null : Math.round(row.median_latency_ms);
      const successRate = sampleSize === 0 ? 0 : successCount / sampleSize;
      out.set(row.creator_identity_id, {
        creatorIdentityId: row.creator_identity_id,
        sampleSize,
        successCount,
        failureCount,
        manualSkipCount,
        successRate,
        medianLatencyMs,
        windowStart: since,
        windowEnd,
        metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
      });
    }

    // Cold-start: every queried id MUST appear in the output map.
    for (const id of ids) {
      if (!out.has(id)) {
        out.set(id, {
          creatorIdentityId: id,
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
          windowStart: since,
          windowEnd,
          metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
        });
      }
    }

    return out;
  }
}
```

**Important Path-B alternative**: if Task 1's findings selected Path B (creatorIdentityId reached via `PcdIdentitySnapshot`), replace the `INNER JOIN "AssetRecord" ar ON ar.id = pps."assetRecordId"` clause with the two-join form. Keep the rest of the function shape identical.

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/db test -- prisma-pcd-creator-performance-metrics-reader
```

Expected: 6 tests pass.

If `percentile_cont` raises a Prisma-side type error, the canonical workaround is to add a `::float8` cast on the result (already in the SQL above). If the test database lacks `percentile_cont`, the database is not Postgres — escalate to the user; SP20 is Postgres-only by design (§9 risk #2 in the spec).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts \
        packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.test.ts
git commit -m "feat(pcd): SP20 task 6 — Prisma CreatorPerformanceMetrics reader (SQL aggregation)"
```

---

## Task 7: Widen SP13 schema fields

**Files:**
- Modify: `packages/schemas/src/pcd-synthetic-selector.ts`
- Modify: `packages/schemas/src/pcd-synthetic-selector.test.ts` (or sibling — locate existing test file in this task's Step 1)

Widen two forward-declared slots:
- `metricsSnapshotVersion: z.null()` → `z.string().min(1).nullable()`
- `performanceOverlayApplied: z.literal(false)` → `z.boolean()`

`selectorRank: z.literal(0)` stays as-is (Guardrail J).

- [ ] **Step 1: Read existing SP13 schema test file to anchor the test additions**

Run:

```
ls packages/schemas/src/pcd-synthetic-selector*
```

Locate the test file (may be `pcd-synthetic-selector.test.ts`). Read it. Note existing test names and the shape of decision fixtures.

- [ ] **Step 2: Write failing tests for the widened schema**

Add to the located test file:

```ts
// SP20 — schema widen verification.
describe("SyntheticCreatorSelectionDecisionSchema (SP20-widened slots)", () => {
  const successBase = {
    allowed: true as const,
    briefId: "brief-1",
    selectedCreatorIdentityId: "creator-A",
    fallbackCreatorIdentityIds: [] as readonly string[],
    selectedLicenseId: "license-1",
    selectedLockType: "hard_exclusive" as const,
    isSoftExclusivityOverride: false,
    selectorVersion: "pcd-selector@1.0.0",
    selectorRank: 0 as const,
    decisionReason: "primary_compatible (1 survivor, 0 license-blocked)",
  };

  it("accepts metricsSnapshotVersion as a non-empty string", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
      ...successBase,
      metricsSnapshotVersion: "pcd-performance-overlay@1.0.0",
      performanceOverlayApplied: true,
    });
    expect(parsed).toBeDefined();
  });

  it("accepts metricsSnapshotVersion as null", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
      ...successBase,
      metricsSnapshotVersion: null,
      performanceOverlayApplied: false,
    });
    expect(parsed).toBeDefined();
  });

  it("rejects metricsSnapshotVersion as an empty string", () => {
    expect(() =>
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        metricsSnapshotVersion: "",
        performanceOverlayApplied: true,
      }),
    ).toThrow();
  });

  it("accepts performanceOverlayApplied as true OR false", () => {
    for (const flag of [true, false]) {
      const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        metricsSnapshotVersion: flag ? "pcd-performance-overlay@1.0.0" : null,
        performanceOverlayApplied: flag,
      });
      expect(parsed).toBeDefined();
    }
  });

  it("keeps selectorRank locked at the literal 0 (Guardrail J)", () => {
    expect(() =>
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        selectorRank: 1,
        metricsSnapshotVersion: null,
        performanceOverlayApplied: false,
      }),
    ).toThrow();
  });
});
```

(If the existing test file uses a different decision-fixture pattern, adapt the fixture shape but keep the assertions exact.)

- [ ] **Step 3: Run, expect FAIL**

```
pnpm --filter @creativeagent/schemas test -- pcd-synthetic-selector
```

Expected: FAIL — schema still narrows `metricsSnapshotVersion` to `z.null()` and `performanceOverlayApplied` to `z.literal(false)`.

- [ ] **Step 4: Widen the schema**

In `packages/schemas/src/pcd-synthetic-selector.ts`, within `SuccessDecisionSchema`:

```ts
// BEFORE:
//   metricsSnapshotVersion: z.null(),
//   performanceOverlayApplied: z.literal(false),
//
// AFTER (SP20 widen):
    metricsSnapshotVersion: z.string().min(1).nullable(),
    performanceOverlayApplied: z.boolean(),
```

Update the top-of-file comment block to reflect that SP20 has shipped the widen. Change the lines:

```ts
// SP13 invariants encoded at schema level:
//   - selectorRank: z.literal(0)        — SP19 will widen
//   - performanceOverlayApplied: false  — SP19 will widen
//   - metricsSnapshotVersion: z.null()  — SP19 will widen to nullable string
```

to:

```ts
// SP13 invariants encoded at schema level:
//   - selectorRank: z.literal(0)                            — reserved (a future slice may widen)
//   - performanceOverlayApplied: z.boolean()                — SP20 widened (was z.literal(false))
//   - metricsSnapshotVersion: z.string().min(1).nullable()  — SP20 widened (was z.null())
```

Also update the inline comment immediately above `metricsSnapshotVersion`:

```ts
// SP13: strict z.null(). SP19 will widen to z.string().min(1).nullable()
// when the performance overlay populates this slot.
```

to:

```ts
// SP20 widened: was z.null() in SP13; SP20 populates with PCD_PERFORMANCE_OVERLAY_VERSION
// (read-through from the supplied performanceHistory map) when overlay is applied
// and the map is non-empty; null otherwise.
```

- [ ] **Step 5: Run, expect PASS**

```
pnpm --filter @creativeagent/schemas test -- pcd-synthetic-selector
```

Expected: all tests pass (existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-synthetic-selector.ts \
        packages/schemas/src/pcd-synthetic-selector.test.ts
git commit -m "feat(pcd): SP20 task 7 — widen SP13 metricsSnapshotVersion + performanceOverlayApplied"
```

---

## Task 8: Widen SP13 selector signature with optional `performanceHistory`

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

Extend `SelectSyntheticCreatorInput` with an optional `performanceHistory` field, threaded into `compareCandidates` but with the comparator body unchanged in this task (Guardrail G no-op). The result is: signature widened, behavior identical to SP13 even when overlay is supplied. Task 9 lights up the sub-tiebreaker logic.

This split-into-two-tasks discipline mirrors SP19's "schema → writer" and SP18's "schema → orchestrator" sequencing.

- [ ] **Step 1: Write the failing signature test**

Add to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts
import { buildCreatorPerformanceMetrics } from "./build-creator-performance-metrics.fixture.js";
import type { CreatorPerformanceMetrics } from "@creativeagent/schemas";

describe("selectSyntheticCreator — SP20 signature widen", () => {
  it("accepts performanceHistory as an optional input and produces a typed decision", () => {
    // Reuse an existing SP13 success-path fixture (locate one above and call it baseInput()).
    const performanceHistory = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A" })],
    ]);
    const decision = selectSyntheticCreator({
      ...baseInput(),
      performanceHistory,
    });
    expect(decision.allowed).toBe(true);
  });

  it("undefined performanceHistory produces decision with performanceOverlayApplied: false and metricsSnapshotVersion: null", () => {
    const decision = selectSyntheticCreator(baseInput());
    if (decision.allowed) {
      expect(decision.performanceOverlayApplied).toBe(false);
      expect(decision.metricsSnapshotVersion).toBeNull();
    }
  });
});
```

The task implementer must inspect `selector.test.ts` for an existing helper that builds a passing input (call it `baseInput()` above). If no such helper exists, distill one from the first passing test case in the file and add it as a top-of-file helper. This preserves the file's test-organization conventions.

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/creative-pipeline test -- selector.test
```

Expected: FAIL — `performanceHistory` not on `SelectSyntheticCreatorInput`.

- [ ] **Step 3: Widen the selector signature + decision population (no comparator change yet)**

In `packages/creative-pipeline/src/pcd/selector/selector.ts`:

1. Add the import at top:
```ts
import type { CreatorPerformanceMetrics } from "@creativeagent/schemas";
```

2. Widen the input type:
```ts
export type SelectSyntheticCreatorInput = {
  brief: CreativeBrief;
  now: Date;
  roster: readonly RosterEntry[];
  leases: readonly CreatorIdentityLicensePayload[];
  // SP20 — optional performance overlay; absent ⇒ SP13-equivalent decision.
  // The reader (Prisma or in-memory) supplies this Map; selector reads
  // metrics.metricsVersion through onto the decision (Guardrail C-2).
  // MERGE-BACK: Switchboard's composer always supplies this once runner
  // integration ships; optionality is a SP20-land-time accommodation.
  performanceHistory?: ReadonlyMap<string, CreatorPerformanceMetrics>;
};
```

3. In the success-branch return at the bottom of `selectSyntheticCreator`, replace:
```ts
metricsSnapshotVersion: null,
performanceOverlayApplied: false,
```
with:
```ts
metricsSnapshotVersion: resolveMetricsVersion(input.performanceHistory),
performanceOverlayApplied: input.performanceHistory !== undefined,
```

4. Add the helper at the bottom of the file (above the existing `function buildDecisionReason(...)` or below — co-locate with other private helpers):
```ts
// SP20 — read metrics.metricsVersion through from the supplied map (Guardrail C-2).
// Selector never imports PCD_PERFORMANCE_OVERLAY_VERSION directly.
// Returns null when the map is undefined OR empty; otherwise returns the
// metricsVersion of the first entry (reader contract: all entries share
// the same metricsVersion).
function resolveMetricsVersion(
  history: ReadonlyMap<string, CreatorPerformanceMetrics> | undefined,
): string | null {
  if (history === undefined) return null;
  const first = history.values().next();
  return first.done ? null : first.value.metricsVersion;
}
```

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/creative-pipeline test -- selector.test
```

Expected: all tests pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP20 task 8 — widen SP13 selector signature (optional performanceHistory)"
```

---

## Task 9: Light up the comparator sub-tiebreaker (position 4)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

Insert the SP20 performance comparator at position 4 (between SP12 `effectiveFrom` and the `creatorIdentityId` tiebreak). Cold-start no-op rule per Guardrail G.

- [ ] **Step 1: Write the failing comparator tests**

Add to `selector.test.ts`. The implementer must build a baseInput that returns multiple license-equivalent candidates so the new position-4 tiebreaker has work to do. Pattern:

```ts
describe("selectSyntheticCreator — SP20 comparator sub-tiebreaker", () => {
  // Build inputs where two candidates have identical (lockType, priorityRank, effectiveFrom)
  // so positions 1-3 of the comparator return 0 and position 4 decides.
  function twoEquivalentCandidatesInput(): SelectSyntheticCreatorInput {
    // Implementer: derive from baseInput() with two roster entries having identical
    // license shape but different creatorIdentityId (e.g., "creator-A" and "creator-B").
    // Both must compatible-pass and license-gate-pass.
    return {
      // ... brief, now, roster (with creator-A, creator-B), leases ...
    } as SelectSyntheticCreatorInput;
  }

  it("performance: better successRate wins among license-equivalent candidates", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 9, failureCount: 1, manualSkipCount: 0, successRate: 0.9 })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 10, successCount: 4, failureCount: 6, manualSkipCount: 0, successRate: 0.4 })],
    ]);
    const decision = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: perf });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("performance: lower medianLatencyMs wins as sub-sub-tiebreak when successRate ties", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 5, successCount: 5, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 2000 })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 5, successCount: 5, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 1000 })],
    ]);
    const decision = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: perf });
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-B");
    }
  });

  it("cold-start no-op: either side sampleSize === 0 returns to creatorIdentityId ASC tiebreak", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 0, failureCount: 10, manualSkipCount: 0, successRate: 0, medianLatencyMs: 5000 })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 0, successCount: 0, failureCount: 0, manualSkipCount: 0, successRate: 0, medianLatencyMs: null })],
    ]);
    const decision = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: perf });
    if (decision.allowed) {
      // Tied at position 4 ⇒ position 5 picks creator-A (ASC).
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("cold-start no-op: both sides cold-start preserves SP13 ASC behavior", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 0, successCount: 0, failureCount: 0, manualSkipCount: 0, successRate: 0, medianLatencyMs: null })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 0, successCount: 0, failureCount: 0, manualSkipCount: 0, successRate: 0, medianLatencyMs: null })],
    ]);
    const decision = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: perf });
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("missing entry for one candidate behaves like sampleSize === 0 (no-op)", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 10, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 500 })],
      // creator-B intentionally missing.
    ]);
    const decision = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: perf });
    if (decision.allowed) {
      // Comparator returns 0 → ASC → creator-A wins (already ASC-first anyway).
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```
pnpm --filter @creativeagent/creative-pipeline test -- selector.test
```

Expected: at least the "better successRate wins" and "lower latency wins" tests FAIL (comparator currently has no position-4 logic; falls through to creatorIdentityId ASC, which gives creator-A always).

- [ ] **Step 3: Widen the comparator**

In `packages/creative-pipeline/src/pcd/selector/selector.ts`:

1. Change `compareCandidates` to accept an extra optional parameter and use it. Replace the existing function with:

```ts
// SP13-vs-SP12: identical to SP12 pickStrongest EXCEPT the final tie-break
// uses creatorIdentityId (selector picks creators) rather than license.id
// (SP12 picks leases). Documented divergence; intentional.
//
// SP20 widen: position 4 performance sub-tiebreaker inserted between
// SP12 effectiveFrom and the creatorIdentityId ASC tiebreak. Cold-start
// no-op rule per Guardrail G — comparator returns 0 whenever either side
// is missing metrics or has sampleSize === 0.
function compareCandidates(
  a: AllowedCandidate,
  b: AllowedCandidate,
  performanceHistory: ReadonlyMap<string, CreatorPerformanceMetrics> | undefined,
): number {
  const la = a.gate.license;
  const lb = b.gate.license;
  const ra = LOCK_TYPE_RANK[la.lockType];
  const rb = LOCK_TYPE_RANK[lb.lockType];
  if (ra !== rb) return ra - rb;
  if (la.lockType === "priority_access" && lb.lockType === "priority_access") {
    const pa = la.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const pb = lb.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
  }
  if (la.effectiveFrom.getTime() !== lb.effectiveFrom.getTime()) {
    return la.effectiveFrom.getTime() - lb.effectiveFrom.getTime();
  }
  // SP20 position 4 — performance sub-tiebreaker (Guardrail G cold-start rule).
  if (performanceHistory !== undefined) {
    const am = performanceHistory.get(a.entry.creatorIdentity.id);
    const bm = performanceHistory.get(b.entry.creatorIdentity.id);
    if (am !== undefined && bm !== undefined && am.sampleSize > 0 && bm.sampleSize > 0) {
      if (am.successRate !== bm.successRate) return bm.successRate - am.successRate;
      // Both sampleSize > 0 ⇒ medianLatencyMs !== null by reader contract.
      if (am.medianLatencyMs !== bm.medianLatencyMs) {
        return (am.medianLatencyMs as number) - (bm.medianLatencyMs as number);
      }
    }
  }
  // Position 5 — final determinism tiebreak (unchanged from SP13).
  const cidA = a.entry.creatorIdentity.id;
  const cidB = b.entry.creatorIdentity.id;
  return cidA < cidB ? -1 : cidA > cidB ? 1 : 0;
}
```

2. Update the sort call inside `selectSyntheticCreator` to pass the new param:

```ts
// BEFORE:
//   const ranked = [...allowedCandidates].sort(compareCandidates);
// AFTER:
const ranked = [...allowedCandidates].sort((a, b) =>
  compareCandidates(a, b, input.performanceHistory),
);
```

- [ ] **Step 4: Run, expect PASS**

```
pnpm --filter @creativeagent/creative-pipeline test -- selector.test
```

Expected: all tests pass (existing + 5 new from this task + 2 from Task 8).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP20 task 9 — comparator position-4 performance sub-tiebreaker"
```

---

## Task 10: Comprehensive selector test additions (Guardrails A, F, G coverage)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

Extend selector coverage to lock the six Guardrail-A "contractual order NEVER yields to performance" tests, the Guardrail-F determinism test, and the Guardrail-G empty-history equivalence test.

- [ ] **Step 1: Add Guardrail-A contractual-dominance tests**

Add to `selector.test.ts`:

```ts
describe("selectSyntheticCreator — SP20 Guardrail A: contractual ordering NEVER yields to performance", () => {
  it("hard_exclusive with 0% success rate still outranks priority_access with 100% success rate", () => {
    // Implementer: build a roster where creator-A holds hard_exclusive and creator-B
    // holds priority_access. Assert decision picks creator-A regardless of perf.
    const decision = selectSyntheticCreator({
      ...hardExclusiveVsPriorityAccessInput(),
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 0, failureCount: 10, manualSkipCount: 0, successRate: 0, medianLatencyMs: 5000 })],
        ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 10, successCount: 10, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 500 })],
      ]),
    });
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("priority_access priorityRank: 1 with 0% success outranks priorityRank: 5 with 100% success", () => {
    const decision = selectSyntheticCreator({
      ...priorityRankInput(),
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 0, failureCount: 10, manualSkipCount: 0, successRate: 0, medianLatencyMs: 5000 })],
        ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 10, successCount: 10, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 500 })],
      ]),
    });
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("earlier effectiveFrom outranks later effectiveFrom regardless of performance", () => {
    const decision = selectSyntheticCreator({
      ...effectiveFromInput(),
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        ["creator-A-earlier", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A-earlier", sampleSize: 10, successCount: 0, failureCount: 10, manualSkipCount: 0, successRate: 0, medianLatencyMs: 5000 })],
        ["creator-B-later", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B-later", sampleSize: 10, successCount: 10, failureCount: 0, manualSkipCount: 0, successRate: 1, medianLatencyMs: 500 })],
      ]),
    });
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A-earlier");
    }
  });
});
```

The three input builders (`hardExclusiveVsPriorityAccessInput`, `priorityRankInput`, `effectiveFromInput`) plus `twoEquivalentCandidatesInput` and `baseInput` (referenced by Tasks 8–10) must be added as test-file-local helpers. **Canonical templates to copy from:**
- Existing SP13 test `selectSyntheticCreator — compatible-set filter` (selector.test.ts) shows how to build a `CreativeBrief` + `RosterEntry[]` from `SP11_SYNTHETIC_CREATOR_ROSTER`. Use `cherylRoster` + `briefForCheryl` as starting shape for `baseInput()`.
- Existing SP12 license-gate tests under `packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts` show how to build `CreatorIdentityLicensePayload` records with each lockType. Copy the helpers there to build leases with `hard_exclusive` vs `priority_access`, with varying `priorityRank`, and with varying `effectiveFrom`.
- For `twoEquivalentCandidatesInput`: pick two roster entries that share `(treatmentClass, market, vibe, ethnicityFamily, ageBand, pricePositioning)` (e.g., two SG/med_spa/omg_look/sg_chinese/mid_20s/entry creators if such pairs exist in the roster — verify by reading `synthetic-creator/seed.ts`). If no such pair exists in the seed, the implementer must add a second synthetic creator to the test-only roster (NOT to `seed.ts`) by constructing a `RosterEntry` literal in the helper. The seed file is frozen.
- Pair each candidate with a matching lease that grants `(clinicId, market, treatmentClass)` and shares lockType/priorityRank/effectiveFrom so positions 1-3 of the comparator return 0.

- [ ] **Step 2: Add Guardrail-F determinism test**

```ts
describe("selectSyntheticCreator — SP20 Guardrail F: now-insensitive with overlay", () => {
  it("varying input.now produces identical decisions with overlay applied", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 10, successCount: 7, failureCount: 3, manualSkipCount: 0, successRate: 0.7 })],
    ]);
    const at1 = selectSyntheticCreator({ ...baseInput(), now: new Date("2026-01-01"), performanceHistory: perf });
    const at2 = selectSyntheticCreator({ ...baseInput(), now: new Date("2027-06-15"), performanceHistory: perf });
    expect(at1).toEqual(at2);
  });
});
```

- [ ] **Step 3: Add Guardrail-G byte-equivalence tests**

```ts
describe("selectSyntheticCreator — SP20 Guardrail G: empty-history is SP13-equivalent", () => {
  it("undefined performanceHistory yields SP13-equivalent decision (modulo overlay metadata)", () => {
    const sp13 = selectSyntheticCreator(baseInput());
    const sp20Undefined = selectSyntheticCreator({ ...baseInput() });
    expect(sp20Undefined).toEqual(sp13);
  });

  it("empty Map performanceHistory yields SP13-equivalent decision body except metricsSnapshotVersion=null and performanceOverlayApplied=true", () => {
    const sp13 = selectSyntheticCreator(baseInput());
    const sp20EmptyMap = selectSyntheticCreator({
      ...baseInput(),
      performanceHistory: new Map<string, CreatorPerformanceMetrics>(),
    });
    if (sp13.allowed && sp20EmptyMap.allowed) {
      expect(sp20EmptyMap.performanceOverlayApplied).toBe(true);
      expect(sp20EmptyMap.metricsSnapshotVersion).toBeNull();
      // Every other field is identical.
      const { performanceOverlayApplied: _a, metricsSnapshotVersion: _b, ...rest13 } = sp13;
      const { performanceOverlayApplied: _c, metricsSnapshotVersion: _d, ...rest20 } = sp20EmptyMap;
      expect(rest20).toEqual(rest13);
    }
  });

  it("performanceHistory with only cold-start entries yields SP13-equivalent ordering", () => {
    const sp13 = selectSyntheticCreator(twoEquivalentCandidatesInput());
    const coldOnly = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A", sampleSize: 0, successCount: 0, failureCount: 0, manualSkipCount: 0, successRate: 0, medianLatencyMs: null })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B", sampleSize: 0, successCount: 0, failureCount: 0, manualSkipCount: 0, successRate: 0, medianLatencyMs: null })],
    ]);
    const sp20Cold = selectSyntheticCreator({ ...twoEquivalentCandidatesInput(), performanceHistory: coldOnly });
    if (sp13.allowed && sp20Cold.allowed) {
      expect(sp20Cold.selectedCreatorIdentityId).toBe(sp13.selectedCreatorIdentityId);
    }
  });
});
```

- [ ] **Step 4: Add Guardrail-C-2 metricsVersion read-through test**

```ts
describe("selectSyntheticCreator — SP20 Guardrail C-2: metricsVersion read-through", () => {
  it("metricsSnapshotVersion echoes metrics.metricsVersion from the supplied map", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A" })],
    ]);
    const decision = selectSyntheticCreator({ ...baseInput(), performanceHistory: perf });
    if (decision.allowed) {
      expect(decision.metricsSnapshotVersion).toBe("pcd-performance-overlay@1.0.0");
    }
  });
});
```

- [ ] **Step 5: Run, expect PASS**

```
pnpm --filter @creativeagent/creative-pipeline test -- selector.test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "test(pcd): SP20 task 10 — comprehensive selector overlay coverage (Guardrails A, F, G, C-2)"
```

---

## Task 11: SP20 anti-pattern test

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts`

Six anti-pattern assertions per design §6.4. Pattern matches `sp19-anti-patterns.test.ts`; the task implementer may copy that test file as a structural template and adjust.

- [ ] **Step 1: Write the failing anti-pattern test**

Create `packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts`:

```ts
// SP20 anti-pattern test. Six assertions per design §6.4. Keyed to SP19
// squash SHA 1d22d61 as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "1d22d61";

const SP20_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // SP13 carve-out (Guardrail B-1).
  "packages/schemas/src/pcd-synthetic-selector.ts",
  "packages/schemas/src/pcd-synthetic-selector.test.ts",
  "packages/creative-pipeline/src/pcd/selector/selector.ts",
  "packages/creative-pipeline/src/pcd/selector/selector.test.ts",
  // Barrel widen (Guardrail I).
  "packages/schemas/src/index.ts",
  // SP20-new files (§3.1 of design).
  "packages/schemas/src/pcd-creator-performance-metrics.ts",
  "packages/schemas/src/pcd-creator-performance-metrics.test.ts",
  "packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts",
  "packages/creative-pipeline/src/pcd/selector/performance-overlay-version.test.ts",
  "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts",
  "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts",
  "packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts",
  "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
  "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts",
  "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
  "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md",
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-plan.md",
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md",
];

// Anti-pattern allowlist updates Task 12 will add to prior tests are
// implicitly covered by listing those test files here.

const SP20_ALLOWLISTED_PRIOR_ANTIPATTERN_TEST_EDITS = new Set<string>();
// Filled at runtime by Task 12 step 2 via the find command.

function listAllSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist" || ent.name === ".worktrees") continue;
      out.push(...listAllSourceFiles(p));
    } else if (ent.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      out.push(p);
    }
  }
  return out;
}

function isTest(p: string): boolean {
  return p.endsWith(".test.ts") || p.endsWith(".test.tsx");
}

function isFixture(p: string): boolean {
  return p.endsWith(".fixture.ts");
}

describe("SP20 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP20 allowlist (freeze vs SP19 squash 1d22d61)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP20_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 12).
      if (/^packages\/creative-pipeline\/(src|test)\/pcd\/.*\/sp\d+[a-c]?-anti-patterns\.test\.ts$/.test(f)) continue;
      if (/^packages\/creative-pipeline\/(src|test)\/pcd\/sp\d+[a-c]?-anti-patterns\.test\.ts$/.test(f)) continue;
      offenders.push(f);
    }
    expect(offenders, `Unallowlisted edits since ${FREEZE_SHA}: ${offenders.join(", ")}`).toEqual([]);
  });

  it('#2 sole literal site for "pcd-performance-overlay@" — exactly one non-test source file', () => {
    const files = listAllSourceFiles(join(REPO_ROOT, "packages"));
    const hits: string[] = [];
    for (const f of files) {
      if (isTest(f) || isFixture(f)) continue;
      const body = readFileSync(f, "utf8");
      if (body.includes("pcd-performance-overlay@")) hits.push(relative(REPO_ROOT, f));
    }
    expect(hits).toEqual([
      "packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts",
    ]);
  });

  it("#3 sole runtime importer of PCD_PERFORMANCE_OVERLAY_VERSION — exactly the metrics reader", () => {
    const files = listAllSourceFiles(join(REPO_ROOT, "packages"));
    const importers: string[] = [];
    for (const f of files) {
      if (isTest(f) || isFixture(f)) continue;
      if (f.endsWith("performance-overlay-version.ts")) continue; // defining file
      const body = readFileSync(f, "utf8");
      if (/PCD_PERFORMANCE_OVERLAY_VERSION/.test(body)) importers.push(relative(REPO_ROOT, f));
    }
    expect(importers.sort()).toEqual([
      "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
      "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
    ]);
    // Explicit: selector.ts MUST NOT appear.
    expect(importers).not.toContain("packages/creative-pipeline/src/pcd/selector/selector.ts");
  });

  it("#4 no `crypto` imports in SP20 surface files", () => {
    const sp20Files = [
      "packages/schemas/src/pcd-creator-performance-metrics.ts",
      "packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts",
      "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts",
      "packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts",
      "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
      "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
    ];
    for (const f of sp20Files) {
      const body = readFileSync(join(REPO_ROOT, f), "utf8");
      expect(body).not.toMatch(/from\s+["']node:crypto["']/);
      expect(body).not.toMatch(/from\s+["']crypto["']/);
      expect(body).not.toMatch(/\bcreateHash\b/);
      expect(body).not.toMatch(/\brandomUUID\b/);
    }
  });

  it("#5 no SP20-dated Prisma migration (verify against pre-SP20 baseline at SHA 1d22d61)", () => {
    const migrationsDir = "packages/db/prisma/migrations";
    const baseline = execSync(`git ls-tree -r --name-only ${FREEZE_SHA} -- ${migrationsDir}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const baselineDirs = new Set<string>();
    for (const path of baseline) {
      // Extract migration dir name: "packages/db/prisma/migrations/<dir>/migration.sql"
      const m = path.match(/^packages\/db\/prisma\/migrations\/([^/]+)\//);
      if (m) baselineDirs.add(m[1]!);
    }
    const current = readdirSync(join(REPO_ROOT, migrationsDir)).filter((e) =>
      statSync(join(REPO_ROOT, migrationsDir, e)).isDirectory(),
    );
    const added = current.filter((d) => !baselineDirs.has(d));
    expect(added, `SP20 must add no migrations; found: ${added.join(", ")}`).toEqual([]);
  });

  it("#6 selector.ts contains no aggregation symbols", () => {
    const body = readFileSync(
      join(REPO_ROOT, "packages/creative-pipeline/src/pcd/selector/selector.ts"),
      "utf8",
    );
    expect(body).not.toMatch(/\.reduce\(/);
    expect(body).not.toMatch(/\bpercentile\b/i);
    expect(body).not.toMatch(/\bmedian\b/i);
    expect(body).not.toMatch(/\bquantile\b/i);
    // .sort is permitted (used by `[...allowedCandidates].sort(...)`).
  });
});
```

- [ ] **Step 2: Run, expect PASS (all six)**

```
pnpm --filter @creativeagent/creative-pipeline test -- sp20-anti-patterns
```

Expected: 6 tests pass. If #1 fails listing offenders, those are files that need to be either added to `SP20_ALLOWLISTED_EDITS` (if intentional and design-approved) or reverted (if accidental). If #5 misfires because the regex shape needs tightening, switch to a known-prior-migrations set check (list the SP1-SP19 migration directories explicitly).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts
git commit -m "test(pcd): SP20 task 11 — anti-pattern test (6 assertions, frozen vs 1d22d61)"
```

---

## Task 12: Discover + update prior anti-pattern test allowlists

**Files:**
- Modify: the prior anti-pattern test files discovered by `find`

Per locked plan requirement (no hardcoded count): discover, then update.

- [ ] **Step 1: Discover prior anti-pattern tests**

```
find packages/creative-pipeline -name "sp*-anti-patterns.test.ts" -not -name "sp20-anti-patterns.test.ts"
```

Expected output (as of 2026-05-16, may vary): 16 files (sp6, sp7, sp8, sp9, sp10a, sp10b, sp10c, sp11, sp12, sp13, sp14, sp15, sp16, sp17, sp18, sp19).

Save the list to a scratch text file for the steps below.

- [ ] **Step 2: For each discovered file, inspect for the source-freeze diff assertion**

For each path P in the list:

```
grep -n "git diff" P                       # locate the freeze-diff invocation (if any)
grep -n "ALLOWLIST\|ALLOWED\|allowlist" P  # locate any allowlist constant
```

If P has no freeze-diff assertion (e.g., a literal-only check), it does not need a SP20 allowlist entry. **Note which files DO and DO NOT need updating.**

- [ ] **Step 3: Update each file that has a freeze-diff assertion**

For each P that has a freeze-diff allowlist, add the three SP13 carve-out paths (and the new SP20 files, if the freeze regex would otherwise flag them — typically the regex is "files outside slice-N's allowed set" so SP20 files would already flag):

```ts
// SP20 carve-out — three forward-declared SP13 sites widened in SP20.
// See docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md §2.1 Guardrail B-1.
"packages/schemas/src/pcd-synthetic-selector.ts",
"packages/schemas/src/pcd-synthetic-selector.test.ts",
"packages/creative-pipeline/src/pcd/selector/selector.ts",
"packages/creative-pipeline/src/pcd/selector/selector.test.ts",
// SP20 also widens the schemas barrel and adds new files (covered by sp20-anti-patterns).
```

Where these lines go depends on each file's existing allowlist structure — adapt to match. Some files keep an `ALLOWED_NEW_FILES` set + an `ALLOWED_MODIFIED_FILES` set; some have a single union. Follow the existing structure.

- [ ] **Step 4: Verify each update by running that file**

```
pnpm --filter @creativeagent/creative-pipeline test -- <sliceN>-anti-patterns
```

Expected: PASS for each.

- [ ] **Step 5: Run the entire pcd test suite to catch any regression**

```
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/
git commit -m "test(pcd): SP20 task 12 — allowlist SP13 carve-out edits in prior anti-pattern tests"
```

---

## Task 13: Full repo verification + acceptance check against locked requirements

**Files:** none (verification + a final reading pass).

- [ ] **Step 1: Run full pipeline**

```
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check .
```

Expected: every command exits 0. `pnpm lint` is structurally broken on `main` per project baseline (per SP10C plan note) — `prettier --check` is the practical style gate.

- [ ] **Step 2: Manually verify the six locked plan requirements**

For each requirement, confirm:

1. **Verify the SQL join path first.** Task 1 findings file exists at `docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md` and is committed; Task 6's reader uses the chosen path.
   ```
   ls docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md
   ```

2. **No Prisma migration.**
   ```
   git diff --name-only 1d22d61..HEAD packages/db/prisma/migrations/
   ```
   Expected: empty output.

3. **No selector-side aggregation.**
   ```
   grep -nE "\.reduce\(|percentile|median|quantile" packages/creative-pipeline/src/pcd/selector/selector.ts
   ```
   Expected: empty output. (`.sort(...)` is permitted.)

4. **No selector import of PCD_PERFORMANCE_OVERLAY_VERSION.**
   ```
   grep -n "PCD_PERFORMANCE_OVERLAY_VERSION" packages/creative-pipeline/src/pcd/selector/selector.ts
   ```
   Expected: empty output.

5. **`performanceHistory` empty/undefined is SP13-equivalent except expected slots.** Verified by selector.test.ts cases added in Task 10 (Guardrail-G suite).
   ```
   pnpm --filter @creativeagent/creative-pipeline test -- selector.test -t "Guardrail G"
   ```
   Expected: 3 tests PASS.

6. **SP12 license ordering remains untouchable.** Verified by selector.test.ts cases added in Task 10 (Guardrail-A suite).
   ```
   pnpm --filter @creativeagent/creative-pipeline test -- selector.test -t "Guardrail A"
   ```
   Expected: 3 tests PASS.

- [ ] **Step 3: Confirm pinned constant census**

```
grep -rn "pcd-performance-overlay@" packages/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "\.fixture\.ts"
```

Expected: exactly one hit, in `packages/creative-pipeline/src/pcd/selector/performance-overlay-version.ts`.

- [ ] **Step 4: Run the SP20 anti-pattern test in isolation**

```
pnpm --filter @creativeagent/creative-pipeline test -- sp20-anti-patterns
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit a CHANGELOG-style note (optional, only if no prior commits did)**

If a prior task left an unflushed change, commit it. Otherwise skip.

```bash
git status
# (clean expected)
```

---

## Task 14: Open the PR

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
git push -u origin pcd/sp20-performance-overlay-rerank
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --title "feat(pcd): SP20 — performance-overlay re-rank (synthetic-creator selector widening)" --body "$(cat <<'EOF'
## Summary

- Widens SP13 selector with optional `performanceHistory` input that re-ranks contractually-equivalent SP12 candidates by SP19 historical successRate + medianLatencyMs.
- SP12 license ordering is **untouched**: performance is a position-4 sub-tiebreaker WITHIN buckets created by `(lockType, priorityRank, effectiveFrom)`.
- Cold-start no-op rule (Guardrail G): when either candidate has `sampleSize === 0` (or missing metrics), the SP20 sub-tiebreaker returns 0 → SP13-equivalent `creatorIdentityId` ASC tiebreak.
- 24th pinned constant `PCD_PERFORMANCE_OVERLAY_VERSION` lives at the metrics reader (selector never imports it; reads `metrics.metricsVersion` through from the supplied map).
- No Prisma migration.

## Test plan

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (full creative-pipeline + schemas + db packages)
- [ ] `pnpm exec prettier --check .`
- [ ] `sp20-anti-patterns.test.ts` passes (6 assertions, keyed to SP19 squash 1d22d61)
- [ ] All 16 prior `sp*-anti-patterns.test.ts` pass with the SP13 carve-out allowlist
- [ ] Empty-history equivalence test verifies SP13-byte-identical behavior at SP20 land time
- [ ] Guardrail-A "license dominates performance" tests cover all three contractual axes (lockType, priorityRank, effectiveFrom)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

`gh pr create` prints the URL. Surface it as the task result.

---

## Self-review notes

Spec coverage check — every numbered section of the design is implemented:

| Spec § | Plan task |
|---|---|
| §1 Scope & Strategy (mental model, inflection, NOT-in-scope) | Reflected throughout; explicit NOT-in-scope items enforced by Tasks 11–13 |
| §2.1 Guardrails A, B-1, C, D, E, F, G, H, I, J | A: Task 10; B-1: Tasks 7-9 + 11-12; C: Tasks 2, 7-9, 11; D: Tasks 4, 6, 11; E: Task 11 (#5); F: Task 10; G: Tasks 9, 10; H: Task 6; I: Task 2; J: Task 7 |
| §2.2 Q1-Q12 | All twelve are encoded in the tasks |
| §3.1 New files | Task 2 (constant), Task 3 (schema), Task 4 (fixture), Tasks 5-6 (readers), Task 11 (anti-pattern) |
| §3.2 Widened files | Task 7 (schema), Tasks 8-9 (selector), Task 10 (selector tests) |
| §3.3 Updated allowlists | Task 12 (discovery + update) |
| §4.1 CreatorPerformanceMetrics schema | Task 3 |
| §4.2 PCD_PERFORMANCE_OVERLAY_VERSION | Task 2 |
| §4.3 SP13 schema widen | Task 7 |
| §4.4 Selector input widen | Task 8 |
| §4.5 Comparator widen | Task 9 |
| §4.6 Decision population | Task 8 (initial), Task 9 (final after comparator) |
| §4.7 Metrics reader contract | Task 6 |
| §5 Data flow | Tasks 6, 8, 9 |
| §6 Test surface | Tasks 3, 4, 5, 6, 10, 11 |
| §7 MERGE-BACK markers | Tasks 2, 3, 6, 8 (each adds its markers inline) |
| §8 Out-of-scope | Implicit; Task 11 (#5) enforces no migration; Task 13 step 3 enforces single literal site |
| §10 Constant census 23→24 | Task 2 |

Placeholder scan: every code block contains complete, runnable code or runnable shell commands. Task 6 step 1's `seedPerformanceRow` is intentionally a copy-from-SP19 instruction — the design notes the project's existing SP19 reader test pattern as the canonical seeder template. Marked clearly.

Type consistency: `CreatorPerformanceMetrics` field names match across Tasks 3-11. `FindMetricsForCreatorsInput` matches in Tasks 5 and 6. `performanceHistory` field name + Map type matches across Tasks 8, 9, 10. `selectorRank` stays `z.literal(0)`, consistent across Tasks 7, 9 (where it's left alone in the comparator and the decision population).
