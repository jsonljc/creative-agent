# SP10B — Tree-Budget Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land tree-shape enforcement for the PCD pre-production chain so brief breadth cannot silently produce production fanout that exceeds operator-set ceilings. Count-only enforcement (`maxBranchFanout` + `maxTreeSize`); cost-gate (`maxEstimatedUsd`) deferred to SP10C with the schema slot widened-but-null in SP10B. **First slice with abort/prune authority** in the PCD vertical — SP10B WILL throw `TreeBudgetExceededError` on violation.

**Architecture:** Sibling subdir `pcd/budget/` mirroring SP7's `pcd/preproduction/`, SP9's `pcd/provenance/`, and SP10A's `pcd/cost/` layout. New 14th pinned constant `PCD_TREE_BUDGET_VERSION`. New top-level orchestrator `runIdentityAwarePreproductionChainWithBudget` that wraps SP7's chain (calls it as a pure function — does NOT edit SP7 source), runs the chain to completion, then validates the resulting tree shape against the resolved budget. Pure orchestration — no Prisma migration, no db-package adapter.

**Tech Stack:** TypeScript ESM, Vitest, Zod. pnpm workspace. Co-located `*.test.ts` (creative-pipeline) / `__tests__/*.test.ts` (schemas). `pnpm exec prettier --check` as the practical style gate.

**Source spec:** `docs/plans/2026-05-01-pcd-tree-budget-sp10b-design.md` — read it before starting, especially §0 (18 accepted risks) and §3 (Q1–Q16 architectural locks).

**Branch:** `sp10b-tree-budget` (created in §0 setup; design doc staged on `main` is the base — first commit of this branch will be the design doc itself).

---

## §0. Pre-flight context

**You are working in `~/creativeagent`, a TypeScript pnpm monorepo with 5 packages. SP10B touches two:**

- `packages/schemas` — zod-only schemas (Layer 1)
- `packages/creative-pipeline` — pure orchestration (Layer 3)

**Note: SP10B does NOT touch `packages/db`.** No Prisma migration, no adapter, no schema.prisma edit. The slice is pure orchestration.

**Hard rules (from CLAUDE.md and the design spec — non-negotiable):**

1. ESM only. Relative imports must end in `.js` (TypeScript-compiled). Example: `import { foo } from "./bar.js";`.
2. No `any`. Use `unknown` and narrow.
3. No `console.log`. Use `console.warn` / `console.error` if needed (likely never in SP10B).
4. Conventional Commits per task: `feat(pcd):`, `test(pcd):`, `chore(pcd):`, `docs(pcd):`.
5. Co-located tests for creative-pipeline (`*.test.ts` next to source). Schemas tests live in `packages/schemas/src/__tests__/*.test.ts`.
6. **`pnpm lint` is structurally broken on origin/main** — do NOT try to fix. Use `pnpm exec prettier --check <files>` as the style gate.
7. Two pre-existing prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` are baseline noise (now 10 slices deferred). DO NOT fix them in SP10B.
8. **No edits to SP1–SP10A source bodies.** Allowed edits outside `pcd/budget/`:
   - `packages/schemas/src/pcd-preproduction.ts` (widen `PreproductionTreeBudgetSchema` with one field — Task 2)
   - `packages/schemas/src/__tests__/pcd-preproduction.test.ts` (update 4 existing fixtures + add 5-6 new tests — Task 2)
   - `packages/creative-pipeline/src/index.ts` (re-export SP10B surface — Task 8)
   - `docs/SWITCHBOARD-CONTEXT.md` (new SP10B section — Task 10)
   - The auto-memory file at `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (final task only)
9. **All work commits to branch `sp10b-tree-budget`.** Do NOT push to remote unless explicitly asked.
10. **Anti-pattern test #4 baselines against `afa16de`** (SP10A squash, current `main` HEAD) — the structural source-freeze guard. If SP11 lands first, the rebase swaps the baseline ref; that is a one-line edit at the merge step, NOT a Task 9 concern.

**One-time setup before starting:**

- [ ] **Verify starting state**

```bash
git status
git log -3 --oneline
git rev-parse HEAD
```

Expected: on branch `main`, last commit is `afa16de feat(pcd): SP10 — cost-forecast wiring (SP10A)`, working tree has the SP10B design doc staged (`A  docs/plans/2026-05-01-pcd-tree-budget-sp10b-design.md`). If the design doc is not staged, stop and surface to the user — the SP10B brainstorm/design step has not completed.

- [ ] **Create SP10B branch + commit the design doc as its first commit**

```bash
git checkout -b sp10b-tree-budget
git commit -m "docs(pcd): SP10B — tree-budget enforcement design"
git log -2 --oneline
```

Expected: branch `sp10b-tree-budget` created; `afa16de` is parent; design-doc commit is HEAD.

- [ ] **Verify baseline tests pass**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
```

Expected: typecheck clean across all 5 packages; ~1,489 tests pass (SP10A baseline — 1,449 SP9 + ~40 SP10A net). If the baseline is broken, stop and surface to the user — do not proceed with SP10B on a red baseline.

- [ ] **Verify Prisma client is generated** (defensive — SP10B does not edit Prisma but baseline tests in db package require the client)

```bash
pnpm db:generate
```

Expected: success.

---

## §1. File structure

**New files (under `packages/creative-pipeline/src/pcd/budget/`):**

| File                                                         | Responsibility                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `tree-budget-version.ts`                                     | Pinned constant `PCD_TREE_BUDGET_VERSION`. Sole import site.                                                                      |
| `tree-budget-exceeded-error.ts`                              | Error class. Carries `reason`, `budget`, `violations`, `meta`.                                                                    |
| `sp10b-budget-reader.ts`                                     | `Sp10bBudgetReader` interface + input type. Type-only.                                                                            |
| `static-default-budget-reader.ts`                            | `StaticDefaultBudgetReader` + `STATIC_DEFAULT_BUDGET` constant + `STATIC_DEFAULT_BUDGET_READER_VERSION`. Returns non-null always. |
| `tree-shape-validator.ts`                                    | Pure validator. Sole importer of `PCD_TREE_BUDGET_VERSION`. Returns `ValidateTreeShapeOutput` with `meta` always populated.       |
| `run-identity-aware-preproduction-chain-with-budget.ts`      | Orchestrator. Wraps SP7 chain. Returns `{ result, budgetMeta }` outcome wrapper.                                                  |
| `index.ts`                                                   | Public surface barrel.                                                                                                            |
| `tree-budget-version.test.ts`                                | Constant-equality test (1 test).                                                                                                  |
| `tree-budget-exceeded-error.test.ts`                         | Construction, name, message, meta carry, violations carry (5 tests).                                                              |
| `static-default-budget-reader.test.ts`                       | Determinism, ignored-inputs, shape, non-null return, version constant (4-5 tests).                                                |
| `tree-shape-validator.test.ts`                               | Happy + each violation level + priority lock + tied-fanout sort + SP8-stub passes default (12-14 tests).                          |
| `run-identity-aware-preproduction-chain-with-budget.test.ts` | Full orchestrator path with mocked stores, null-budget bypass, SP10C-bleed throw, propagation (10-12 tests).                      |
| `sp10b-anti-patterns.test.ts`                                | 9 structural grep assertions.                                                                                                     |

**Modified files (allowlist; deviations fail SP10B anti-pattern test #4):**

| File                                                                                   | Change                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/pcd-preproduction.ts`                                            | Widen `PreproductionTreeBudgetSchema` with `maxEstimatedUsd: z.number().positive().nullable()`. One field added. (Task 2) |
| `packages/schemas/src/__tests__/pcd-preproduction.test.ts`                             | Update 4 existing fixtures with `maxEstimatedUsd: null` + add 5-6 new tests for the new field. (Task 2)                   |
| `packages/creative-pipeline/src/index.ts`                                              | Re-export SP10B surface (`./pcd/budget/index.js`). (Task 8)                                                               |
| `docs/SWITCHBOARD-CONTEXT.md`                                                          | Add SP10B merge-back surface section after SP10A. (Task 10)                                                               |
| `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` | Add SP10B entry. (Task 10)                                                                                                |

**Files NOT changed (verified by anti-pattern test #4):** every SP1-SP10A source file body. No `pcd/preproduction/`, `pcd/cost/`, `pcd/provenance/` edits. No `packages/db/` edits. No `schema.prisma` edit. No new migration directory.

---

## Task 1: `PCD_TREE_BUDGET_VERSION` constant

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts`
- Test: `packages/creative-pipeline/src/pcd/budget/tree-budget-version.test.ts`

This is the 14th pinned constant in the PCD slice. Sole import site is the validator (Task 6); composer-only version pinning lock #6 is enforced by anti-pattern test #1 (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-budget-version.test.ts
import { describe, expect, it } from "vitest";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";

describe("PCD_TREE_BUDGET_VERSION", () => {
  it("equals the exact pinned literal", () => {
    expect(PCD_TREE_BUDGET_VERSION).toBe("pcd-tree-budget@1.0.0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-budget-version.test.ts
```

Expected: FAIL — module not found (`tree-budget-version.ts` doesn't exist yet).

- [ ] **Step 3: Create the constant file**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts
// SP10B — 14th pinned constant in the PCD slice. Sole import site is
// tree-shape-validator.ts (composer-only pinning lock — sp10b-anti-patterns
// test #1 enforces). DO NOT import this constant anywhere else; the literal
// "pcd-tree-budget@" must not appear in any other source file.
export const PCD_TREE_BUDGET_VERSION = "pcd-tree-budget@1.0.0";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-budget-version.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts packages/creative-pipeline/src/pcd/budget/tree-budget-version.test.ts
```

Expected: clean. If warnings, run `pnpm exec prettier --write` on the same files.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts packages/creative-pipeline/src/pcd/budget/tree-budget-version.test.ts
git commit -m "feat(pcd): SP10B Task 1 — PCD_TREE_BUDGET_VERSION constant (14th pinned)"
```

---

## Task 2: Schema widen — `PreproductionTreeBudgetSchema.maxEstimatedUsd`

**Files:**

- Modify: `packages/schemas/src/pcd-preproduction.ts:47-53` (`PreproductionTreeBudgetSchema` definition)
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts:434-461` (4 fixtures + new field tests)

The widening is the only schema edit in SP10B. The new field is `nullable` (per Q1=C lock — SP10B always populates `null`; SP10C lights it up). All 4 existing test fixtures must be updated in the same commit because the field is non-optional and they will fail to parse otherwise. CLAUDE.md discipline: schema changes and call-site updates ship in the same commit.

- [ ] **Step 1: Read the current state of both files**

```bash
cat packages/schemas/src/pcd-preproduction.ts | sed -n '45,55p'
cat packages/schemas/src/__tests__/pcd-preproduction.test.ts | sed -n '430,465p'
```

Expected output for the schema:

```ts
// SP8 — tree-budget schema. Reserved for SP10 enforcement; SP8 always emits
// null on PcdIdentityContext.treeBudget. Both fields required when budget exists.
export const PreproductionTreeBudgetSchema = z
  .object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
  })
  .readonly();
export type PreproductionTreeBudget = z.infer<typeof PreproductionTreeBudgetSchema>;
```

Expected output for the test (~line 434):

```ts
describe("PreproductionTreeBudgetSchema", () => {
  it("accepts a valid budget", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3, maxTreeSize: 100 }).success,
    ).toBe(true);
  });

  it("rejects non-positive maxBranchFanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 0, maxTreeSize: 100 }).success,
    ).toBe(false);
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: -1, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects non-integer maxBranchFanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 1.5, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects missing maxTreeSize", () => {
    expect(PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Update the 4 existing fixtures FIRST (these will fail under the widen until they include `maxEstimatedUsd: null`)**

Edit `packages/schemas/src/__tests__/pcd-preproduction.test.ts`:

Replace the four `safeParse` calls inside the existing 4 `it(...)` blocks (lines ~437, 443, 446, 452) so each input object includes `maxEstimatedUsd: null`. The "rejects missing maxTreeSize" test at ~line 457 stays unchanged (it tests rejection of an incomplete shape; absence of `maxEstimatedUsd` is irrelevant once `maxTreeSize` is missing — Zod fails on the first missing field). Concretely:

```ts
describe("PreproductionTreeBudgetSchema", () => {
  it("accepts a valid budget", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
        maxEstimatedUsd: null,
      }).success,
    ).toBe(true);
  });

  it("rejects non-positive maxBranchFanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 0,
        maxTreeSize: 100,
        maxEstimatedUsd: null,
      }).success,
    ).toBe(false);
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: -1,
        maxTreeSize: 100,
        maxEstimatedUsd: null,
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer maxBranchFanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 1.5,
        maxTreeSize: 100,
        maxEstimatedUsd: null,
      }).success,
    ).toBe(false);
  });

  it("rejects missing maxTreeSize", () => {
    expect(PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3 }).success).toBe(false);
  });

  // ---- SP10B widen: new tests for maxEstimatedUsd ----

  it("accepts maxEstimatedUsd: null (SP10B default)", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
        maxEstimatedUsd: null,
      }).success,
    ).toBe(true);
  });

  it("accepts maxEstimatedUsd as a positive number (SP10C will populate)", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
        maxEstimatedUsd: 100,
      }).success,
    ).toBe(true);
  });

  it("rejects negative maxEstimatedUsd", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
        maxEstimatedUsd: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects zero maxEstimatedUsd (positive excludes zero)", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
        maxEstimatedUsd: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects missing maxEstimatedUsd (non-optional after SP10B widen)", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({
        maxBranchFanout: 3,
        maxTreeSize: 100,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run the schema tests to verify they FAIL on the widen-required cases**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-preproduction.test.ts
```

Expected: FAIL on the 4 updated fixture tests (because `maxEstimatedUsd` is not yet declared in the schema, but the test passes `maxEstimatedUsd: null` which is currently rejected by zod's strict object as an unknown key — actually this depends on whether `.readonly()` zod enables strict mode; for `z.object()` extra keys are stripped silently by default, so the existing tests will still PASS at this point because zod is lenient on extra keys). The new "accepts maxEstimatedUsd: null" test will pass for the same lenient-strip reason; the "rejects negative" / "rejects zero" / "rejects missing" tests will FAIL because zod accepts the extra-stripped object.

This is expected. Proceed to Step 4 to do the schema widen, which will make the rejection tests fire.

- [ ] **Step 4: Widen `PreproductionTreeBudgetSchema`**

Edit `packages/schemas/src/pcd-preproduction.ts:47-53`:

```ts
// SP8 — tree-budget schema. SP10B widens with maxEstimatedUsd as a forward-
// declared slot for SP10C (cost-budget enforcement); SP10B always populates
// it as null. Both fanout/size fields required when budget exists.
export const PreproductionTreeBudgetSchema = z
  .object({
    maxBranchFanout: z.number().int().positive(),
    maxTreeSize: z.number().int().positive(),
    // SP10B forward-declared; SP10C populates. Always null in SP10B.
    maxEstimatedUsd: z.number().positive().nullable(),
  })
  .readonly();
export type PreproductionTreeBudget = z.infer<typeof PreproductionTreeBudgetSchema>;
```

The header comment is updated to reflect SP10B's widen rationale.

- [ ] **Step 5: Re-run the schema tests to verify they ALL pass**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-preproduction.test.ts
```

Expected: PASS on all tests including the 5 new SP10B-widen tests.

- [ ] **Step 6: Run the full schemas package test suite**

```bash
pnpm --filter @creativeagent/schemas exec vitest run
```

Expected: PASS. (The widen does not affect any other schema; existing snapshot/identity tests untouched.)

- [ ] **Step 7: Run the full creative-pipeline test suite (defensive)**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS. SP7's `runIdentityAwarePreproductionChain` writes literal `treeBudget: null` (the OUTER nullable on `PcdIdentityContext`) — it does not construct a literal `PreproductionTreeBudget` object, so the widen does not break it. If any test fails, surface to the user before proceeding (audit gap).

- [ ] **Step 8: Prettier-check**

```bash
pnpm exec prettier --check packages/schemas/src/pcd-preproduction.ts packages/schemas/src/__tests__/pcd-preproduction.test.ts
```

Expected: clean. If warnings, run `pnpm exec prettier --write` on the same files.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP10B Task 2 — widen PreproductionTreeBudgetSchema with maxEstimatedUsd"
```

---

## Task 3: `Sp10bBudgetReader` interface

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts`

Type-only file. No runtime behavior, no co-located test (the type is exercised structurally by Tasks 4 and 7's tests). The interface is the SP10B-declared merge-back surface — Switchboard owns the production implementer at merge-back.

- [ ] **Step 1: Create the file**

```ts
// packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts
// SP10B — Budget reader contract. Production implementer at merge-back fetches
// per-organization defaults with brief-level overrides from a Switchboard-side
// OrganizationBudget table. SP10B ships only the contract + a deterministic stub
// (StaticDefaultBudgetReader, see static-default-budget-reader.ts).
//
// Returns null = "no budget configured" (orchestrator falls through to the
// chain without enforcement). Returns non-null = "enforce this budget."
import type { PreproductionTreeBudget } from "@creativeagent/schemas";

export type Sp10bBudgetReaderInput = {
  briefId: string;
  organizationId: string | null;
};

export type Sp10bBudgetReader = {
  resolveBudget(input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null>;
};
```

- [ ] **Step 2: Typecheck the new file**

```bash
pnpm --filter @creativeagent/creative-pipeline exec tsc --noEmit
```

Expected: clean (no errors).

- [ ] **Step 3: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts
git commit -m "feat(pcd): SP10B Task 3 — Sp10bBudgetReader interface"
```

---

## Task 4: `StaticDefaultBudgetReader` stub

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts`
- Test: `packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.test.ts`

Deterministic stub that returns `STATIC_DEFAULT_BUDGET = { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null }` regardless of input. This is the loud-stub-value choice locked by §0 risk #4. SP8-stub fanout (2→4→12→24, max-fanout=3, total=42) PASSES this default — local dev runs without enforcement violations.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.test.ts
import { describe, expect, it } from "vitest";
import {
  STATIC_DEFAULT_BUDGET,
  STATIC_DEFAULT_BUDGET_READER_VERSION,
  StaticDefaultBudgetReader,
} from "./static-default-budget-reader.js";

describe("StaticDefaultBudgetReader", () => {
  it("returns the STATIC_DEFAULT_BUDGET unchanged for any input", async () => {
    const reader = new StaticDefaultBudgetReader();
    const result = await reader.resolveBudget({ briefId: "any", organizationId: null });
    expect(result).toBe(STATIC_DEFAULT_BUDGET);
  });

  it("ignores briefId and organizationId (loud-stub posture)", async () => {
    const reader = new StaticDefaultBudgetReader();
    const a = await reader.resolveBudget({ briefId: "brief-a", organizationId: "org-1" });
    const b = await reader.resolveBudget({ briefId: "brief-b", organizationId: "org-2" });
    expect(a).toBe(b);
  });

  it("returns a non-null budget always (rolls out enforcement by default)", async () => {
    const reader = new StaticDefaultBudgetReader();
    const result = await reader.resolveBudget({ briefId: "x", organizationId: null });
    expect(result).not.toBeNull();
  });

  it("STATIC_DEFAULT_BUDGET has the expected three-field shape", () => {
    expect(STATIC_DEFAULT_BUDGET).toEqual({
      maxBranchFanout: 5,
      maxTreeSize: 50,
      maxEstimatedUsd: null,
    });
  });

  it("STATIC_DEFAULT_BUDGET_READER_VERSION equals the exact pinned literal", () => {
    expect(STATIC_DEFAULT_BUDGET_READER_VERSION).toBe("static-default-budget-reader@1.0.0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/static-default-budget-reader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the stub reader**

```ts
// packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts
// MERGE-BACK: replace with Switchboard org-budget reader (production reads
// per-organization defaults with brief-level overrides from OrganizationBudget).
// Stub is deterministic for tests + local development. DO NOT add config flags
// or environment-driven fan-in — the swap is by injection, not by feature flag.
import type { PreproductionTreeBudget } from "@creativeagent/schemas";
import type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";

export const STATIC_DEFAULT_BUDGET_READER_VERSION = "static-default-budget-reader@1.0.0";

// Loud-stub values — SP8-stub fanout (2→4→12→24, max-fanout=3, total=42)
// passes this budget. Production wiring at merge-back swaps in a per-org reader.
export const STATIC_DEFAULT_BUDGET: PreproductionTreeBudget = Object.freeze({
  maxBranchFanout: 5,
  maxTreeSize: 50,
  maxEstimatedUsd: null,
});

export class StaticDefaultBudgetReader implements Sp10bBudgetReader {
  async resolveBudget(_input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null> {
    return STATIC_DEFAULT_BUDGET;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/static-default-budget-reader.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.test.ts
git commit -m "feat(pcd): SP10B Task 4 — StaticDefaultBudgetReader + STATIC_DEFAULT_BUDGET stub"
```

---

## Task 5: `TreeBudgetExceededError` error class

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts`
- Test: `packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.test.ts`

The error class carries the validator's full output — `reason` (priority-ordered), `budget` (in effect), `violations` (level-by-level for fanout violations), `meta` (full `TreeShapeMeta` with `perStageCounts` + `fanoutLevels`). Symmetric with the success-path `outcome.budgetMeta` so `try`/`catch` consumers render the same per-stage breakdown as the happy path.

**Note:** This task imports `FanoutLevelObservation` and `TreeShapeMeta` types from `tree-shape-validator.ts`, which doesn't exist yet (Task 6). To keep tasks isolated, this task creates a forward-declared types-only file `tree-shape-types.ts` first OR co-locates the types inline; the design's intent (per Q6 source) is that the error file imports `from "./tree-shape-validator.js"`. We follow the design exactly, which means **Task 5 must run AFTER Task 6 produces the validator**. To keep TDD ordering clean within Task 5, Step 1 below stubs the import path with a minimal types-only helper file `tree-shape-types.ts`, and Task 6 will replace it (re-export from validator).

Actually — simpler: just define the types in Task 5 here and have Task 6's validator IMPORT them from this file. This inverts the design's import direction (validator imports types from error file) but is structurally cleaner: the error file is type-light and the validator is the consumer. **Locking this:** the types live here in Task 5; validator imports from `./tree-budget-exceeded-error.js`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.test.ts
import { describe, expect, it } from "vitest";
import {
  TreeBudgetExceededError,
  type FanoutLevelObservation,
  type TreeShapeMeta,
} from "./tree-budget-exceeded-error.js";

const sampleMeta: TreeShapeMeta = {
  treeBudgetVersion: "pcd-tree-budget@1.0.0",
  observedTreeSize: 60,
  observedMaxBranchFanout: 7,
  perStageCounts: { trends: 5, motivators: 10, hooks: 20, scripts: 25 },
  fanoutLevels: [
    { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
    { level: "hooks_per_motivator", parentId: "motivator-1", fanout: 4 },
    { level: "motivators_per_trend", parentId: "trend-1", fanout: 2 },
  ],
};
const sampleBudget = { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null };

describe("TreeBudgetExceededError", () => {
  it("constructs with reason, budget, violations, meta", () => {
    const violations: FanoutLevelObservation[] = [
      { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
    ];
    const err = new TreeBudgetExceededError({
      reason: "max_branch_fanout_exceeded",
      budget: sampleBudget,
      violations,
      meta: sampleMeta,
    });
    expect(err.reason).toBe("max_branch_fanout_exceeded");
    expect(err.budget).toBe(sampleBudget);
    expect(err.violations).toBe(violations);
    expect(err.meta).toBe(sampleMeta);
  });

  it("has name 'TreeBudgetExceededError'", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.name).toBe("TreeBudgetExceededError");
  });

  it("formats message with the reason", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.message).toBe("tree budget exceeded: max_tree_size_exceeded");
  });

  it("size violations carry empty violations array", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.violations).toHaveLength(0);
  });

  it("fanout violations can carry 1-3 entries (multi-level fail)", () => {
    const violations: FanoutLevelObservation[] = [
      { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
      { level: "hooks_per_motivator", parentId: "motivator-1", fanout: 6 },
    ];
    const err = new TreeBudgetExceededError({
      reason: "max_branch_fanout_exceeded",
      budget: sampleBudget,
      violations,
      meta: sampleMeta,
    });
    expect(err.violations).toHaveLength(2);
    expect(err.violations[0].level).toBe("scripts_per_hook");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-budget-exceeded-error.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the error class with co-located types**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts
// SP10B — Error class for tree-budget violations. Carries the validator's full
// output (reason + budget + violations + meta) for operator forensics. Symmetric
// with the success-path outcome.budgetMeta so try/catch consumers render the
// same per-stage breakdown as the happy path.
//
// MERGE-BACK: surface this error to dashboard with retry-with-raised-budget UI.
//             Switchboard's dashboard owns the operator-facing form; SP10B emits
//             enough context to drive it (perStageCounts, fanoutLevels, violations).

import type { PreproductionTreeBudget } from "@creativeagent/schemas";

// Per-fanout-level observed maximum. Used by both the validator (to report
// observed shape) and this error (to report which levels exceeded the budget).
// Lossless — neither path collapses information into a single string.
export type FanoutLevelObservation = {
  level: "motivators_per_trend" | "hooks_per_motivator" | "scripts_per_hook";
  parentId: string;
  fanout: number;
};

// Always-populated tree-shape facts. Surfaced on success AND failure paths so
// callers can render the breakdown without re-walking the tree.
export type TreeShapeMeta = {
  treeBudgetVersion: string;
  observedTreeSize: number;
  observedMaxBranchFanout: number;
  perStageCounts: {
    trends: number;
    motivators: number;
    hooks: number;
    scripts: number;
  };
  // All three fanout levels, sorted by fanout desc (ties broken by stable
  // level order: motivators_per_trend → hooks_per_motivator → scripts_per_hook).
  // Length always 3 (one entry per fanout level).
  fanoutLevels: readonly FanoutLevelObservation[];
};

export class TreeBudgetExceededError extends Error {
  readonly name = "TreeBudgetExceededError";
  readonly reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
  readonly budget: PreproductionTreeBudget;
  readonly violations: readonly FanoutLevelObservation[];
  readonly meta: TreeShapeMeta;

  constructor(args: {
    reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
    budget: PreproductionTreeBudget;
    violations: readonly FanoutLevelObservation[];
    meta: TreeShapeMeta;
  }) {
    super(`tree budget exceeded: ${args.reason}`);
    this.reason = args.reason;
    this.budget = args.budget;
    this.violations = args.violations;
    this.meta = args.meta;
    Object.setPrototypeOf(this, TreeBudgetExceededError.prototype);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-budget-exceeded-error.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.test.ts
git commit -m "feat(pcd): SP10B Task 5 — TreeBudgetExceededError + FanoutLevelObservation/TreeShapeMeta types"
```

---

## Task 6: `validateTreeShapeAgainstBudget` pure validator

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts`
- Test: `packages/creative-pipeline/src/pcd/budget/tree-shape-validator.test.ts`

Pure synchronous function. Sole import site for `PCD_TREE_BUDGET_VERSION`. **Validation priority lock:** `maxTreeSize` is checked before `maxBranchFanout` — if both are exceeded, `reason === "max_tree_size_exceeded"`. Anti-pattern test #9 (Task 9) enforces source-level ordering.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-shape-validator.test.ts
import { describe, expect, it } from "vitest";
import type { PcdPreproductionChainResult, PreproductionTreeBudget } from "@creativeagent/schemas";
import { validateTreeShapeAgainstBudget } from "./tree-shape-validator.js";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";

// Helper: build a minimal valid PcdPreproductionChainResult with explicit shape.
// trends → motivators → hooks → scripts with parent-id propagation.
function buildResult(opts: {
  trends: number;
  motivatorsPerTrend: number[]; // length === trends
  hooksPerMotivator: number[][]; // length === trends, each inner length === motivatorsPerTrend[i]
  scriptsPerHook: number[][][]; // shape mirrors hooksPerMotivator
}): PcdPreproductionChainResult {
  const trends = Array.from({ length: opts.trends }, (_, t) => ({
    id: `trend-${t}`,
    summary: `s${t}`,
    audienceFit: "x",
    evidenceRefs: [],
  }));

  const motivators = trends.flatMap((trend, t) =>
    Array.from({ length: opts.motivatorsPerTrend[t] }, (_, m) => ({
      id: `mot-${t}-${m}`,
      frictionOrDesire: "f",
      audienceSegment: "a",
      evidenceRefs: [],
      parentTrendId: trend.id,
    })),
  );

  const hooks = motivators.flatMap((mot, mIdx) => {
    const t = Number(mot.id.split("-")[1]);
    const m = Number(mot.id.split("-")[2]);
    const count = opts.hooksPerMotivator[t][m];
    return Array.from({ length: count }, (_, h) => ({
      id: `hook-${t}-${m}-${h}`,
      text: "h",
      hookType: "direct_camera" as const,
      parentMotivatorId: mot.id,
      parentTrendId: mot.parentTrendId,
    }));
  });

  const scripts = hooks.flatMap((hook) => {
    const [_, t, m, h] = hook.id.split("-");
    const count = opts.scriptsPerHook[Number(t)][Number(m)][Number(h)];
    return Array.from({ length: count }, (_, s) => ({
      id: `script-${t}-${m}-${h}-${s}`,
      hookText: "x",
      creatorAngle: "x",
      visualBeats: [],
      productMoment: "x",
      cta: "x",
      complianceNotes: [],
      identityConstraints: {
        creatorIdentityId: "c1",
        productIdentityId: "p1",
        voiceId: null,
      },
      parentHookId: hook.id,
      scriptStyle: "spoken_lines" as const,
      spokenLines: ["line"],
    }));
  });

  return {
    decision: {
      briefId: "b1",
      creatorIdentityId: "c1",
      productIdentityId: "p1",
      consentRecordId: null,
      effectiveTier: 1,
      selectedScriptIds: [scripts[0].id],
      availableScriptIds: scripts.map((s) => s.id),
      preproductionChainVersion: "x",
      identityContextVersion: "x",
      approvalLifecycleVersion: "x",
      preproductionFanoutVersion: "x",
      decidedAt: "2026-05-01T00:00:00.000Z",
      decidedBy: null,
      decisionNote: null,
      costForecast: null,
    },
    stageOutputs: {
      trends: { signals: trends },
      motivators: { motivators },
      hooks: { hooks },
      scripts: { scripts },
    },
  };
}

const within: PreproductionTreeBudget = {
  maxBranchFanout: 5,
  maxTreeSize: 50,
  maxEstimatedUsd: null,
};
const tight: PreproductionTreeBudget = {
  maxBranchFanout: 2,
  maxTreeSize: 10,
  maxEstimatedUsd: null,
};
const tinySize: PreproductionTreeBudget = {
  maxBranchFanout: 100,
  maxTreeSize: 5,
  maxEstimatedUsd: null,
};
const tinyFanout: PreproductionTreeBudget = {
  maxBranchFanout: 1,
  maxTreeSize: 1000,
  maxEstimatedUsd: null,
};

describe("validateTreeShapeAgainstBudget", () => {
  it("happy path — within budget returns ok with populated meta", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.meta.treeBudgetVersion).toBe(PCD_TREE_BUDGET_VERSION);
      expect(out.meta.observedTreeSize).toBe(4); // 1+1+1+1
      expect(out.meta.observedMaxBranchFanout).toBe(1);
      expect(out.meta.perStageCounts).toEqual({ trends: 1, motivators: 1, hooks: 1, scripts: 1 });
      expect(out.meta.fanoutLevels).toHaveLength(3);
    }
  });

  it("max_tree_size_exceeded — violations is empty", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[3]]], // total 1+1+1+3 = 6 > tinySize.maxTreeSize=5
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinySize });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_tree_size_exceeded");
      expect(out.violations).toHaveLength(0);
      expect(out.meta.observedTreeSize).toBe(6);
    }
  });

  it("max_branch_fanout_exceeded at motivators_per_trend level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [2], // > tinyFanout.maxBranchFanout=1
      hooksPerMotivator: [[1, 1]],
      scriptsPerHook: [[[1], [1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "motivators_per_trend")).toBe(true);
    }
  });

  it("max_branch_fanout_exceeded at hooks_per_motivator level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[3]], // > tinyFanout.maxBranchFanout=1
      scriptsPerHook: [[[1, 1, 1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "hooks_per_motivator")).toBe(true);
    }
  });

  it("max_branch_fanout_exceeded at scripts_per_hook level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[3]]], // > tinyFanout.maxBranchFanout=1
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "scripts_per_hook")).toBe(true);
    }
  });

  it("multi-level fanout violation — violations sorted desc by fanout", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[5]], // 5 > 2
      scriptsPerHook: [[[3, 3, 3, 3, 3]]], // each hook has 3 scripts > 2
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 2, maxTreeSize: 1000, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.length).toBeGreaterThanOrEqual(2);
      // Sort: desc by fanout
      for (let i = 1; i < out.violations.length; i++) {
        expect(out.violations[i - 1].fanout).toBeGreaterThanOrEqual(out.violations[i].fanout);
      }
    }
  });

  it("PRIORITY LOCK — if both dimensions exceeded, reason is always max_tree_size_exceeded", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [3], // fanout 3 > tight.maxBranchFanout=2
      hooksPerMotivator: [[3, 3, 3]],
      scriptsPerHook: [
        [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
      ],
      // total = 1+3+9+9 = 22 > tight.maxTreeSize=10
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tight });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_tree_size_exceeded");
      expect(out.violations).toHaveLength(0); // size-reason has empty violations
    }
  });

  it("tied-fanout stable sort — equal fanouts preserve insertion order", () => {
    // All three levels have fanout = 1, no violation. Assert sort stability.
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // All three fanouts are 1, so sort is stable → insertion order:
      // motivators_per_trend → hooks_per_motivator → scripts_per_hook
      expect(out.meta.fanoutLevels[0].level).toBe("motivators_per_trend");
      expect(out.meta.fanoutLevels[1].level).toBe("hooks_per_motivator");
      expect(out.meta.fanoutLevels[2].level).toBe("scripts_per_hook");
    }
  });

  it("SP8-stub shape (2→4→12→24) passes STATIC_DEFAULT_BUDGET (5,50,null)", () => {
    // Hand-build a tree mirroring the SP8 stub: 2 trends, each → 2 motivators (4 total),
    // each motivator → 3 hooks (12 total), each hook → 2 scripts (24 total).
    const result = buildResult({
      trends: 2,
      motivatorsPerTrend: [2, 2],
      hooksPerMotivator: [
        [3, 3],
        [3, 3],
      ],
      scriptsPerHook: [
        [
          [2, 2, 2],
          [2, 2, 2],
        ],
        [
          [2, 2, 2],
          [2, 2, 2],
        ],
      ],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.meta.observedTreeSize).toBe(2 + 4 + 12 + 24); // 42
      expect(out.meta.observedMaxBranchFanout).toBe(3); // hooks-per-motivator
    }
  });

  it("exact-limit edge — observedTreeSize === maxTreeSize is OK (strict >)", () => {
    // total = 1+1+1+2 = 5
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[2]]],
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 5, maxTreeSize: 5, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(true);
  });

  it("exactly-1-over edge — observedTreeSize === maxTreeSize + 1 fails", () => {
    // total = 1+1+1+2 = 5
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[2]]],
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 5, maxTreeSize: 4, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("max_tree_size_exceeded");
  });

  it("meta.fanoutLevels always has length 3 (one per level), even when no violation", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.meta.fanoutLevels).toHaveLength(3);
    const levels = out.meta.fanoutLevels.map((f) => f.level).sort();
    expect(levels).toEqual(["hooks_per_motivator", "motivators_per_trend", "scripts_per_hook"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-shape-validator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the validator**

```ts
// packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts
// SP10B — Pure tree-shape validator. Sole import site for PCD_TREE_BUDGET_VERSION
// (composer-only pinning lock — sp10b-anti-patterns test #1 enforces).
//
// Validation priority lock: maxTreeSize is checked FIRST; maxBranchFanout SECOND.
// If both dimensions are exceeded, the reason is always "max_tree_size_exceeded".
// Anti-pattern test #9 enforces source-level ordering (the literal
// "observedTreeSize > budget.maxTreeSize" appears before any reference to
// "budget.maxBranchFanout"). DO NOT reorder these checks.

import type { PcdPreproductionChainResult, PreproductionTreeBudget } from "@creativeagent/schemas";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
import type { FanoutLevelObservation, TreeShapeMeta } from "./tree-budget-exceeded-error.js";

export type ValidateTreeShapeInput = {
  result: PcdPreproductionChainResult;
  budget: PreproductionTreeBudget;
};

export type ValidateTreeShapeOutput =
  | {
      ok: true;
      meta: TreeShapeMeta;
    }
  | {
      ok: false;
      reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
      violations: readonly FanoutLevelObservation[];
      meta: TreeShapeMeta;
    };

// Re-export for convenience — callers can import these types from either file.
export type { FanoutLevelObservation, TreeShapeMeta } from "./tree-budget-exceeded-error.js";

export function validateTreeShapeAgainstBudget(
  input: ValidateTreeShapeInput,
): ValidateTreeShapeOutput {
  const { result, budget } = input;
  const { trends, motivators, hooks, scripts } = result.stageOutputs;

  const perStageCounts = {
    trends: trends.signals.length,
    motivators: motivators.motivators.length,
    hooks: hooks.hooks.length,
    scripts: scripts.scripts.length,
  };
  const observedTreeSize =
    perStageCounts.trends +
    perStageCounts.motivators +
    perStageCounts.hooks +
    perStageCounts.scripts;

  const motivatorsPerTrend = topFanout(motivators.motivators, (m) => m.parentTrendId);
  const hooksPerMotivator = topFanout(hooks.hooks, (h) => h.parentMotivatorId);
  const scriptsPerHook = topFanout(scripts.scripts, (s) => s.parentHookId);

  // Stable insertion order. JS Array.prototype.sort is stable as of ES2019,
  // so equal-fanout entries preserve their declared order:
  // motivators_per_trend → hooks_per_motivator → scripts_per_hook.
  const fanoutLevels: FanoutLevelObservation[] = [
    {
      level: "motivators_per_trend",
      parentId: motivatorsPerTrend.parentId,
      fanout: motivatorsPerTrend.fanout,
    },
    {
      level: "hooks_per_motivator",
      parentId: hooksPerMotivator.parentId,
      fanout: hooksPerMotivator.fanout,
    },
    {
      level: "scripts_per_hook",
      parentId: scriptsPerHook.parentId,
      fanout: scriptsPerHook.fanout,
    },
  ].sort((a, b) => b.fanout - a.fanout);

  const observedMaxBranchFanout = fanoutLevels[0].fanout;

  const meta: TreeShapeMeta = {
    treeBudgetVersion: PCD_TREE_BUDGET_VERSION,
    observedTreeSize,
    observedMaxBranchFanout,
    perStageCounts,
    fanoutLevels,
  };

  // Priority lock: tree size FIRST.
  if (observedTreeSize > budget.maxTreeSize) {
    return { ok: false, reason: "max_tree_size_exceeded", violations: [], meta };
  }

  // Then branch fanout.
  const violations = fanoutLevels.filter((f) => f.fanout > budget.maxBranchFanout);
  if (violations.length > 0) {
    return { ok: false, reason: "max_branch_fanout_exceeded", violations, meta };
  }

  return { ok: true, meta };
}

// Internal helper. Returns the parent id with the highest child count, plus
// that count. Empty arrays return { parentId: "", fanout: 0 } — not reachable
// in SP10B because SP7 schemas enforce min-1 length per stage, but defensive.
// Ties broken by first-seen parentId (deterministic by Map iteration order).
function topFanout<T>(
  xs: readonly T[],
  key: (x: T) => string,
): { parentId: string; fanout: number } {
  const counts = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let topParent = "";
  let topCount = 0;
  for (const [parent, count] of counts) {
    if (count > topCount) {
      topParent = parent;
      topCount = count;
    }
  }
  return { parentId: topParent, fanout: topCount };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/tree-shape-validator.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts packages/creative-pipeline/src/pcd/budget/tree-shape-validator.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts packages/creative-pipeline/src/pcd/budget/tree-shape-validator.test.ts
git commit -m "feat(pcd): SP10B Task 6 — validateTreeShapeAgainstBudget pure validator with priority lock"
```

---

## Task 7: `runIdentityAwarePreproductionChainWithBudget` orchestrator

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts`
- Test: `packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts`

The orchestrator is **deliberately small** (~55 LOC excluding imports). All complexity lives in the validator. Composer body untouched (it's a pure function call to SP7's chain). Returns `RunPreproductionChainWithBudgetOutcome { result, budgetMeta }` — the wrapper exposes the validator's `meta` to callers without forcing a re-walk of the tree (Q16 lock).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
import { describe, expect, it, vi } from "vitest";
import type {
  PcdBriefInput,
  PcdPreproductionChainResult,
  PreproductionTreeBudget,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
import {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
} from "./run-identity-aware-preproduction-chain-with-budget.js";

const sampleBrief: PcdBriefInput = {
  briefId: "b1",
  productDescription: "p",
  targetAudience: "a",
  platforms: ["instagram"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

// Build a minimal valid PcdPreproductionChainResult (small tree).
function smallResult(): PcdPreproductionChainResult {
  return {
    decision: {
      briefId: "b1",
      creatorIdentityId: "c1",
      productIdentityId: "p1",
      consentRecordId: null,
      effectiveTier: 1,
      selectedScriptIds: ["s-0-0-0-0"],
      availableScriptIds: ["s-0-0-0-0"],
      preproductionChainVersion: "x",
      identityContextVersion: "x",
      approvalLifecycleVersion: "x",
      preproductionFanoutVersion: "x",
      decidedAt: "2026-05-01T00:00:00.000Z",
      decidedBy: null,
      decisionNote: null,
      costForecast: null,
    },
    stageOutputs: {
      trends: { signals: [{ id: "t-0", summary: "s", audienceFit: "x", evidenceRefs: [] }] },
      motivators: {
        motivators: [
          {
            id: "m-0-0",
            frictionOrDesire: "f",
            audienceSegment: "a",
            evidenceRefs: [],
            parentTrendId: "t-0",
          },
        ],
      },
      hooks: {
        hooks: [
          {
            id: "h-0-0-0",
            text: "h",
            hookType: "direct_camera",
            parentMotivatorId: "m-0-0",
            parentTrendId: "t-0",
          },
        ],
      },
      scripts: {
        scripts: [
          {
            id: "s-0-0-0-0",
            hookText: "x",
            creatorAngle: "x",
            visualBeats: [],
            productMoment: "x",
            cta: "x",
            complianceNotes: [],
            identityConstraints: {
              creatorIdentityId: "c1",
              productIdentityId: "p1",
              voiceId: null,
            },
            parentHookId: "h-0-0-0",
            scriptStyle: "spoken_lines",
            spokenLines: ["line"],
          },
        ],
      },
    },
  };
}

// Helper: build a stores object with all SP7 fields stubbed + budgetReader injectable.
function buildStores(opts: {
  budget: PreproductionTreeBudget | null;
  chainResult?: PcdPreproductionChainResult;
  chainThrows?: unknown;
  organizationId?: string | null;
  resolveBudgetThrows?: unknown;
}): RunIdentityAwarePreproductionChainWithBudgetStores {
  const fakeStore = {} as never; // SP7 stages will not be invoked because we mock the chain at the import boundary
  return {
    // SP7 stub fields (typed but not exercised — we mock the chain directly)
    sp7ProductRegistryReader: { findById: vi.fn() } as never,
    sp7CreatorRegistryReader: { findById: vi.fn() } as never,
    creatorIdentityReader: { findById: vi.fn() } as never,
    consentRecordReader: { findById: vi.fn() } as never,
    trendsRunner: { run: vi.fn() } as never,
    motivatorsRunner: { run: vi.fn() } as never,
    hooksRunner: { run: vi.fn() } as never,
    creatorScriptsRunner: { run: vi.fn() } as never,
    productionFanoutGate: { requestSelection: vi.fn() } as never,
    clock: () => new Date("2026-05-01T00:00:00.000Z"),
    budgetReader: {
      resolveBudget: opts.resolveBudgetThrows
        ? vi.fn().mockRejectedValue(opts.resolveBudgetThrows)
        : vi.fn().mockResolvedValue(opts.budget),
    },
    organizationId: opts.organizationId ?? null,
  };
}

// Mock SP7's runIdentityAwarePreproductionChain so we control the result without
// running real stage runners. Vitest hoists vi.mock to the top of the file.
vi.mock("../preproduction/preproduction-chain.js", () => ({
  runIdentityAwarePreproductionChain: vi.fn(),
}));
import { runIdentityAwarePreproductionChain } from "../preproduction/preproduction-chain.js";

describe("runIdentityAwarePreproductionChainWithBudget", () => {
  it("happy path — budget resolved, chain runs, validator passes, returns { result, budgetMeta }", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.result).toBeDefined();
    expect(outcome.budgetMeta).not.toBeNull();
    expect(outcome.budgetMeta?.observedTreeSize).toBe(4);
    expect(outcome.budgetMeta?.fanoutLevels).toHaveLength(3);
  });

  it("null-budget bypass — returns { result, budgetMeta: null }", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({ budget: null });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.result).toBeDefined();
    expect(outcome.budgetMeta).toBeNull();
  });

  it("non-null maxEstimatedUsd throws InvariantViolationError (SP10C-bleed protection)", async () => {
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    await expect(
      runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    // Chain MUST NOT have been called — invariant fires before chain run.
    expect(runIdentityAwarePreproductionChain).not.toHaveBeenCalled();
  });

  it("validator fail-path — throws TreeBudgetExceededError carrying meta + violations", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 1, maxEstimatedUsd: null }, // observed=4 > 1
    });
    try {
      await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TreeBudgetExceededError);
      if (err instanceof TreeBudgetExceededError) {
        expect(err.reason).toBe("max_tree_size_exceeded");
        expect(err.budget.maxTreeSize).toBe(1);
        expect(err.meta.observedTreeSize).toBe(4);
        expect(err.violations).toHaveLength(0);
      }
    }
  });

  it("chain throw is propagated raw", async () => {
    const chainErr = new Error("chain blew up");
    vi.mocked(runIdentityAwarePreproductionChain).mockRejectedValueOnce(chainErr);
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    await expect(runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores)).rejects.toBe(
      chainErr,
    );
  });

  it("reader throw is propagated raw (chain MUST NOT run)", async () => {
    const readerErr = new Error("reader blew up");
    const stores = buildStores({ budget: null, resolveBudgetThrows: readerErr });
    await expect(runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores)).rejects.toBe(
      readerErr,
    );
    expect(runIdentityAwarePreproductionChain).not.toHaveBeenCalled();
  });

  it("reader is called BEFORE the chain (ordering invariant)", async () => {
    const callOrder: string[] = [];
    vi.mocked(runIdentityAwarePreproductionChain).mockImplementationOnce(async () => {
      callOrder.push("chain");
      return smallResult();
    });
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    stores.budgetReader.resolveBudget = vi.fn().mockImplementationOnce(async () => {
      callOrder.push("reader");
      return { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null };
    });
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(callOrder).toEqual(["reader", "chain"]);
  });

  it("reader receives briefId and organizationId from input", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
      organizationId: "org-42",
    });
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(stores.budgetReader.resolveBudget).toHaveBeenCalledWith({
      briefId: "b1",
      organizationId: "org-42",
    });
  });

  it("reader gets organizationId: null when stores.organizationId is undefined", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    delete (stores as { organizationId?: string | null }).organizationId;
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(stores.budgetReader.resolveBudget).toHaveBeenCalledWith({
      briefId: "b1",
      organizationId: null,
    });
  });

  it("validator ok-path forwards validation.meta unchanged into outcome.budgetMeta", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.budgetMeta?.treeBudgetVersion).toBe("pcd-tree-budget@1.0.0");
    expect(outcome.budgetMeta?.perStageCounts).toEqual({
      trends: 1,
      motivators: 1,
      hooks: 1,
      scripts: 1,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the orchestrator**

```ts
// packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts
// SP10B — Production callsite that wraps SP7's chain with a tree-budget gate.
//
// Returns RunPreproductionChainWithBudgetOutcome { result, budgetMeta } so callers
// get computed tree shape on the success path without re-walking the tree (Q16).
//
// Calls budgetReader.resolveBudget(); if null, returns { result, budgetMeta: null }
// (gated bypass). If non-null and maxEstimatedUsd is non-null, throws
// InvariantViolationError (SP10C-bleed protection — SP10B is count-only).
// Otherwise runs SP7's chain to completion, then validates tree shape against budget.
// Throws TreeBudgetExceededError on violation; returns the wrapped outcome on pass.
//
// MERGE-BACK: dashboard surfaces TreeBudgetExceededError with retry-with-raised-budget UI.

import type { PcdBriefInput, PcdPreproductionChainResult } from "@creativeagent/schemas";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "../preproduction/preproduction-chain.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { Sp10bBudgetReader } from "./sp10b-budget-reader.js";
import { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
import { validateTreeShapeAgainstBudget, type TreeShapeMeta } from "./tree-shape-validator.js";

export type RunIdentityAwarePreproductionChainWithBudgetStores = PreproductionChainStores & {
  budgetReader: Sp10bBudgetReader;
  organizationId?: string | null;
};

export type RunPreproductionChainWithBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when reader returned null (gated bypass); populated otherwise.
  budgetMeta: TreeShapeMeta | null;
};

export async function runIdentityAwarePreproductionChainWithBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithBudgetStores,
): Promise<RunPreproductionChainWithBudgetOutcome> {
  // 1. Resolve budget. Reader throws → propagated raw.
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved — value or null)

  // 2. SP10C-bleed protection: SP10B is count-only.
  if (budget !== null && budget.maxEstimatedUsd !== null) {
    // MERGE-BACK: SP10C will populate budget.maxEstimatedUsd; SP10B asserts null here.
    throw new InvariantViolationError(
      "maxEstimatedUsd is reserved for SP10C; SP10B is count-only",
      { budget },
    );
  }

  // 3. Run SP7 chain to completion. Errors propagated raw.
  const result = await runIdentityAwarePreproductionChain(brief, stores);

  // 4. Skip gate if no budget configured (legacy / pre-rollout paths).
  if (budget === null) return { result, budgetMeta: null };

  // 5. Validate tree shape against budget.
  const validation = validateTreeShapeAgainstBudget({ result, budget });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (budget gate passed)
    return { result, budgetMeta: validation.meta };
  }

  // 6. Throw on violation.
  // MERGE-BACK: emit WorkTrace here (budget gate violated)
  throw new TreeBudgetExceededError({
    reason: validation.reason,
    budget,
    violations: validation.violations,
    meta: validation.meta,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Run the full creative-pipeline test suite (defensive — Vitest module-mock should not leak across files)**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS. If unrelated tests fail because the `vi.mock("../preproduction/preproduction-chain.js")` leaked, scope the mock with `vi.doMock` + `vi.unmock` inside the SP10B test file. (Vitest's `vi.mock` is per-file so this should not happen, but verify.)

- [ ] **Step 6: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
git commit -m "feat(pcd): SP10B Task 7 — runIdentityAwarePreproductionChainWithBudget orchestrator"
```

---

## Task 8: Public surface barrel + creative-pipeline barrel re-export

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts` (append SP10B re-export at the end)

The barrel exports SP10B's full public surface. Anti-pattern test #1 (Task 9) asserts the version-constant literal `"pcd-tree-budget@"` appears only in `tree-budget-version.ts` (the constant file) and `tree-shape-validator.ts` (the importer) — the barrel re-exports the constant by name, not by literal value, so this is safe.

- [ ] **Step 1: Create the budget barrel**

```ts
// packages/creative-pipeline/src/pcd/budget/index.ts
// SP10B — Tree-budget enforcement public surface.
export { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
export {
  TreeBudgetExceededError,
  type FanoutLevelObservation,
  type TreeShapeMeta,
} from "./tree-budget-exceeded-error.js";
export type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";
export {
  StaticDefaultBudgetReader,
  STATIC_DEFAULT_BUDGET_READER_VERSION,
  STATIC_DEFAULT_BUDGET,
} from "./static-default-budget-reader.js";
export {
  validateTreeShapeAgainstBudget,
  type ValidateTreeShapeInput,
  type ValidateTreeShapeOutput,
} from "./tree-shape-validator.js";
export {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "./run-identity-aware-preproduction-chain-with-budget.js";
```

- [ ] **Step 2: Append SP10B re-export to the package barrel**

Edit `packages/creative-pipeline/src/index.ts`. After the existing SP6 `assertConsentNotRevokedForEdit` export block (the file's current tail), append:

```ts
// SP10B: tree-budget enforcement
export * from "./pcd/budget/index.js";
```

(Note the leading blank line for readability — match the spacing of the existing export blocks.)

- [ ] **Step 3: Verify typecheck across the full package**

```bash
pnpm --filter @creativeagent/creative-pipeline exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Verify the re-export resolves end-to-end**

```bash
node --input-type=module --eval "import('@creativeagent/creative-pipeline').then(m => { console.log(typeof m.runIdentityAwarePreproductionChainWithBudget, typeof m.TreeBudgetExceededError, typeof m.PCD_TREE_BUDGET_VERSION); })"
```

Expected: `function function string` (or similar — the orchestrator and error class are functions, the constant is a string).

If the package isn't built, run `pnpm build` first or skip this end-to-end check (the typecheck above is the primary gate).

- [ ] **Step 5: Run the full creative-pipeline test suite**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS.

- [ ] **Step 6: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/index.ts packages/creative-pipeline/src/index.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/index.ts packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP10B Task 8 — barrel exports for pcd/budget/ + package re-export"
```

---

## Task 9: SP10B anti-pattern tests (`sp10b-anti-patterns.test.ts`)

**Files:**

- Create: `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`

Nine structural assertions enforcing the SP10B-specific guardrails. Pattern mirrors `sp10a-anti-patterns.test.ts` (read it for precedent).

**Critical:** Assertion #4 (no edits to SP1-SP10A bodies) baselines against `afa16de` (current `main` HEAD = SP10A squash). The git-diff approach uses `git log --grep` to discover the baseline SHA, with shallow-clone fallback — same pattern as `sp10a-anti-patterns.test.ts:163-173`.

**Critical:** Assertion #9 (validation priority lock) needs a `codeOnly` filter to strip line-comments before regex matching, so the design's documentation comments mentioning `maxBranchFanout` don't false-positive. Match SP5's precedent in `qc-evaluator.ts` tests.

- [ ] **Step 1: Read the SP10A reference test**

```bash
cat packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
```

Expected: 8 assertions, ~196 lines. Note especially:

- Lines 10-26: `listSourceFiles(root)` walker.
- Lines 32-43: composer-only version pinning assertion (template for SP10B #1).
- Lines 86-102: `codeOnly` filter pattern (template for SP10B #9).
- Lines 149-195: git-diff baseline assertion (template for SP10B #4).
- Lines 104-117: forbidden-imports list (template for SP10B #5).

- [ ] **Step 2: Create the SP10B anti-pattern test**

```ts
// packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BUDGET_DIR = join(import.meta.dirname);
const PCD_DIR = join(BUDGET_DIR, "..");

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".test.ts")) continue;
      if (!full.endsWith(".ts")) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

const budgetSources = listSourceFiles(BUDGET_DIR);

describe("SP10B anti-pattern grep", () => {
  it("PCD_TREE_BUDGET_VERSION literal lives only in tree-budget-version.ts and tree-shape-validator.ts (composer-only pinning)", () => {
    const allowed = new Set([
      join(BUDGET_DIR, "tree-budget-version.ts"),
      join(BUDGET_DIR, "tree-shape-validator.ts"),
    ]);
    for (const file of budgetSources) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_TREE_BUDGET_VERSION literal`).not.toMatch(
        /"pcd-tree-budget@/,
      );
    }
    // Sanity — tree-budget-version.ts itself does contain the literal.
    expect(readFileSync(join(BUDGET_DIR, "tree-budget-version.ts"), "utf8")).toContain(
      '"pcd-tree-budget@1.0.0"',
    );
  });

  it("throw-not-mutate selection — no SP10B source mutates selectedScriptIds or availableScriptIds", () => {
    for (const file of budgetSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} mutates selectedScriptIds`).not.toMatch(/selectedScriptIds\s*=/);
      expect(src, `${file} mutates availableScriptIds`).not.toMatch(/availableScriptIds\s*=/);
      expect(src, `${file} pushes to selectedScriptIds`).not.toMatch(
        /selectedScriptIds[\s\S]*?\.(push|splice|pop)\(/,
      );
      expect(src, `${file} pushes to availableScriptIds`).not.toMatch(
        /availableScriptIds[\s\S]*?\.(push|splice|pop)\(/,
      );
    }
  });

  it("throw discipline — orchestrator file DOES contain `throw new TreeBudgetExceededError`", () => {
    const orchestrator = readFileSync(
      join(BUDGET_DIR, "run-identity-aware-preproduction-chain-with-budget.ts"),
      "utf8",
    );
    expect(orchestrator).toMatch(/throw\s+new\s+TreeBudgetExceededError\(/);
  });

  it("forbidden imports — SP10B source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of budgetSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${file} imports @prisma/client`).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, `${file} imports inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${file} imports node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${file} imports node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${file} imports crypto`).not.toMatch(/from\s+["']crypto["']/);
    }
  });

  it("schema slot widening — pcd-preproduction.ts contains `maxEstimatedUsd: z.number().positive().nullable()`", () => {
    const schemaPath = join(
      BUDGET_DIR,
      "..",
      "..",
      "..",
      "..",
      "schemas",
      "src",
      "pcd-preproduction.ts",
    );
    const src = readFileSync(schemaPath, "utf8");
    expect(src, "schema must declare maxEstimatedUsd as nullable positive number").toMatch(
      /maxEstimatedUsd:\s*z\.number\(\)\.positive\(\)\.nullable\(\)/,
    );
  });

  it("maxEstimatedUsd === null invariant — orchestrator throws InvariantViolationError on non-null", () => {
    const orchestrator = readFileSync(
      join(BUDGET_DIR, "run-identity-aware-preproduction-chain-with-budget.ts"),
      "utf8",
    );
    // Both pieces must be present — the comparison and the throw.
    expect(orchestrator).toMatch(/budget\.maxEstimatedUsd\s*!==\s*null/);
    expect(orchestrator).toMatch(/throw\s+new\s+InvariantViolationError/);
  });

  it("reader contract immutability — sp10b-budget-reader.ts declares all required-shape fields", () => {
    const src = readFileSync(join(BUDGET_DIR, "sp10b-budget-reader.ts"), "utf8");
    for (const field of ["briefId", "organizationId", "resolveBudget"]) {
      expect(src, `sp10b-budget-reader.ts missing required field: ${field}`).toContain(field);
    }
  });

  it("validation priority lock — observedTreeSize is checked BEFORE budget.maxBranchFanout", () => {
    const src = readFileSync(join(BUDGET_DIR, "tree-shape-validator.ts"), "utf8");
    // Strip line-comments (SP5 codeOnly precedent) so doc-comments mentioning
    // either symbol do not trigger the assertion.
    const codeOnly = src
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    const sizeIdx = codeOnly.search(/observedTreeSize\s*>\s*budget\.maxTreeSize/);
    const fanoutIdx = codeOnly.search(/budget\.maxBranchFanout/);
    expect(sizeIdx, "observedTreeSize check must appear in source").toBeGreaterThan(-1);
    expect(fanoutIdx, "budget.maxBranchFanout reference must appear in source").toBeGreaterThan(-1);
    expect(
      sizeIdx,
      "validation priority lock — observedTreeSize > budget.maxTreeSize must come before budget.maxBranchFanout",
    ).toBeLessThan(fanoutIdx);
  });

  it("SP1–SP10A source bodies are unchanged since the SP10A baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/pcd-preproduction.ts",
      "packages/schemas/src/__tests__/pcd-preproduction.test.ts",
    ]);

    let sp10aSha = "";
    try {
      sp10aSha = execSync(
        'git log --grep="SP10 — cost-forecast wiring" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9/SP10A.
      return;
    }
    if (sp10aSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp10aSha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10B net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/budget/")) continue;
      if (file.startsWith("docs/")) continue;
      if (allowedEdits.has(file)) continue;

      expect(allowedEdits.has(file), `SP10B modified disallowed file: ${file}`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the anti-pattern test to verify all 9 assertions pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/sp10b-anti-patterns.test.ts
```

Expected: PASS (9 tests). If any fails, the SP10B implementation has drifted from the design contract — investigate and fix before proceeding.

Common failure modes:

- Assertion #1 fails: someone imported `PCD_TREE_BUDGET_VERSION` outside the validator. Move the import OR allow it in the assertion's allowlist (but only if architecturally justified — usually the right fix is removing the import).
- Assertion #4 fails on the `git log --grep` lookup: branch was created from a SHA that doesn't have the SP10A commit message. Ensure §0 setup put `afa16de` in the parent chain.
- Assertion #8 fails: someone reordered the validator's checks. Restore size-first ordering.
- Assertion #9 (anti-#4-SP1-SP10A-freeze) fails: a file outside the allowlist was edited. Either (a) revert the edit, or (b) if the edit is justified (e.g. SP11 landed first and a coordination edit is needed), update the allowlist with a comment explaining why.

- [ ] **Step 4: Run the full creative-pipeline test suite**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS.

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
git commit -m "test(pcd): SP10B Task 9 — sp10b-anti-patterns structural assertions (9 tests)"
```

---

## Task 10: SWITCHBOARD-CONTEXT.md update + memory update + final verification

**Files:**

- Modify: `docs/SWITCHBOARD-CONTEXT.md` (append SP10B section after SP10A)
- Modify: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (append SP10B entry)

This task wraps up the slice: documents merge-back surfaces, updates persistent memory for future sessions, and runs full verification.

- [ ] **Step 1: Read the existing SP10A merge-back section**

```bash
grep -n "^### SP10A" docs/SWITCHBOARD-CONTEXT.md
sed -n "$(grep -n '^### SP10A' docs/SWITCHBOARD-CONTEXT.md | head -1 | cut -d: -f1),\$p" docs/SWITCHBOARD-CONTEXT.md
```

Expected: existing `### SP10A (cost-forecast wiring) — SHIPPED in creativeagent` section. Note its structure — three subsections: "SP10A-declared merge-back surfaces", "Schema reconciliation at merge-back", "Architectural seams the merge-back does NOT need to rewrite".

- [ ] **Step 2: Append SP10B section to `docs/SWITCHBOARD-CONTEXT.md`**

Append the following at the end of the file (after the SP10A section):

```markdown
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
- The SP7 composer body (`runIdentityAwarePreproductionChain`) is untouched. SP10B added a parallel orchestrator (`runIdentityAwarePreproductionChainWithBudget`) that calls SP7's chain as a pure function and adds budget gating around the call. Anti-pattern test #4 enforces SP1-SP10A source-body freeze.
- SP10B is the FIRST slice with abort/prune authority. Forecast-only invariant from SP10A no longer applies — `TreeBudgetExceededError` is the canonical SP10B-introduced exception, asserted in the orchestrator (anti-pattern test #3 catches "return false" refactors that lose the throw).

**SP10B is observability + enforcement on count only.** Cost-budget enforcement (`maxEstimatedUsd` field; coarse pre-routing estimator contract) is reserved for SP10C. Field widened in SP10B as nullable, populated null. Orchestrator structurally asserts `budget.maxEstimatedUsd === null` at gate time and throws `InvariantViolationError` if non-null (SP10C-bleed protection).

**SP10B compatibility with SP8 stub fanout:** the local-dev default chain shape (2 trends × 2 motivators × 3 hooks × 2 scripts = 42 nodes; max-fanout 3) PASSES `STATIC_DEFAULT_BUDGET` (`{maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null}`). Local development runs with no budget violations. Tests that exercise the fail path use tighter test-only budgets.
```

- [ ] **Step 3: Update auto-memory with SP10B entry**

Edit `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. At the appropriate position (chronologically — SP10B is after SP10A), add:

```markdown
- **SP10B — Tree-budget enforcement:** ✅ Implementation complete on `creativeagent` branch `sp10b-tree-budget` (squash + PR pending). 10 implementation tasks completed. Highlights:
  - **First slice with abort/prune authority** in the PCD vertical. Forecast-only invariant from SP10A no longer applies; SP10B WILL throw on budget violation.
  - **Count-only enforcement (Q1=C lock).** `maxBranchFanout` + `maxTreeSize` gates; `maxEstimatedUsd` field widened on `PreproductionTreeBudgetSchema` but populated `null` (SP10C will light it up).
  - **14th pinned constant:** `PCD_TREE_BUDGET_VERSION = "pcd-tree-budget@1.0.0"`. Composer-only pinning lock holds — only `tree-budget-version.ts` (the constant file) and `tree-shape-validator.ts` (the importer) contain the literal.
  - **Post-chain enforcement (Q2 lock).** New top-level orchestrator `runIdentityAwarePreproductionChainWithBudget` wraps SP7's `runIdentityAwarePreproductionChain` as a pure function call; runs the chain to completion, then validates the resulting tree shape. Throws `TreeBudgetExceededError` on violation; returns `{ result, budgetMeta }` outcome wrapper on success.
  - **Validation priority lock (Q10).** `maxTreeSize` is checked first; if both dimensions are exceeded, `reason === "max_tree_size_exceeded"`. Anti-pattern test #9 enforces source-level ordering.
  - **Lossless violation reporting (Q10).** `meta.fanoutLevels` always carries 3 entries (motivators_per_trend, hooks_per_motivator, scripts_per_hook), sorted by fanout desc. `violations` (failure path only) carries every level whose top-fanout exceeded `budget.maxBranchFanout`. Replaces an earlier single-`parentIdAtViolation` design that was lossy.
  - **Outcome wrapper (Q16).** Orchestrator returns `RunPreproductionChainWithBudgetOutcome { result, budgetMeta: TreeShapeMeta | null }`. `budgetMeta === null` discriminates the gated-bypass case (reader returned null) from the gated-success case. Symmetry with `TreeBudgetExceededError.meta` on the failure path.
  - **No Prisma migration. No db-package adapter. No `PcdIdentitySnapshot` widen.** SP10B is pure orchestration. Forensic trail at merge-back lives in WorkTrace via 3 `// MERGE-BACK: emit WorkTrace here` markers.
  - **Schema widen** is the only schema edit: `PreproductionTreeBudgetSchema.maxEstimatedUsd: z.number().positive().nullable()`. 4 existing test fixtures in `pcd-preproduction.test.ts` updated with `maxEstimatedUsd: null` in the same commit + 5-6 new tests for the new field.
  - **`PcdIdentityContext.treeBudget` reserved slot stays null** (SP8 reservation). Populating it would require editing `buildPcdIdentityContext.ts` (forbidden). Budget lives in orchestrator runtime closure, not in identity context.
  - **9 anti-pattern grep assertions:** composer-only version pinning, throw-not-mutate selection, throw discipline (positive assertion), forbidden imports, schema-slot widening, maxEstimatedUsd-null invariant, reader contract immutability, validation priority lock, SP1-SP10A source-body freeze (baselines against `afa16de`).
  - **SP8-stub fanout (2→4→12→24, max-fanout=3, total=42) PASSES `STATIC_DEFAULT_BUDGET` (5, 50, null)** by design. Local dev runs without budget violations.
  - **Subdir layout:** `packages/creative-pipeline/src/pcd/budget/` (sibling to `pcd/preproduction/`, `pcd/provenance/`, `pcd/cost/`). 7 source files (version, error, reader contract, stub reader, validator, orchestrator, barrel) + 6 co-located test files.
  - **User-accepted risks (recorded in design §0):** 18 explicit risks including post-chain compute waste, dual-mode rollout (some orgs gated, some not), `treeSize` includes trends (operator-mental-model gap), 3-way invariant lock-step does NOT extend to SP10B (chain-level, not per-asset).
  - **Final state:** ~46-56 net SP10B tests across creative-pipeline + schemas packages all green; full repo typecheck clean across all 5 packages; prettier clean modulo the 2 SP5-baseline warnings on tier-policy.ts/tier-policy.test.ts (unchanged — now 10 slices deferred).
```

Update the top-of-file `description` line as well to reflect the SP10B addition (find the existing `description:` field in the YAML frontmatter and update its date/scope).

- [ ] **Step 4: Final verification — full repo typecheck + tests + prettier**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/ packages/schemas/src/pcd-preproduction.ts packages/schemas/src/__tests__/pcd-preproduction.test.ts packages/creative-pipeline/src/index.ts docs/SWITCHBOARD-CONTEXT.md docs/plans/2026-05-01-pcd-tree-budget-sp10b-design.md docs/plans/2026-05-01-pcd-tree-budget-sp10b-plan.md
```

Expected:

- typecheck: clean across all 5 packages.
- vitest: ~46-56 net new SP10B tests on top of the SP10A baseline (~1,489) — final count should be in the ~1,535-1,545 range.
- prettier: clean (modulo the 2 pre-existing tier-policy warnings, which are NOT in the file list above).

If any of these fail, fix before committing.

- [ ] **Step 5: Verify all 9 SP10B anti-pattern assertions still pass post-cleanup**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/budget/sp10b-anti-patterns.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 6: Verify the design + plan docs are committed (the plan was authored on `main` and is staged in §0; ensure it's now in branch history)**

```bash
git log --oneline sp10b-tree-budget ^main
```

Expected: a clean linear sequence of ~10 task commits + 1 design-doc commit + 1 final wrap-up commit (this task). Verify each commit message matches Conventional Commits format.

- [ ] **Step 7: Commit the docs + memory update**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "docs(pcd): SP10B — merge-back surface + slice progress memory update"
# memory file is outside the repo and committed by hand to your dotfiles location separately if you keep it under VCS;
# otherwise it's a local file edit and not part of the branch history.
```

(If your `~/.claude/projects/...` directory is under VCS, commit there as well. Otherwise the file edit is local-only.)

- [ ] **Step 8: Final state check**

```bash
git status
git log --oneline -15
```

Expected: working tree clean; branch `sp10b-tree-budget` has design + 10 task commits + final docs commit.

---

## §2. Self-review checklist (run after every task above)

After each task commit, do a 30-second sanity check:

1. **Test count delta:** Did the test count go up by approximately the expected amount? If a task says "5 tests" and the test count went up by 4, investigate before proceeding.
2. **Typecheck:** `pnpm typecheck` should be clean. If a task introduced a TS error elsewhere (e.g. by changing a public type), the issue must be fixed in the same commit.
3. **Prettier:** every new and modified file should pass `pnpm exec prettier --check`. If not, run `pnpm exec prettier --write` and amend or follow up.
4. **No SP1-SP10A source-body edits:** if you find yourself editing a file outside the allowlist in §1, stop. Re-read §0 hard rule #8 — the rule is non-negotiable.

---

## §3. PR template (when ready)

```markdown
## Summary

- Lands tree-shape enforcement for the PCD pre-production chain. Count-only (`maxBranchFanout` + `maxTreeSize`); cost-budget enforcement (`maxEstimatedUsd`) deferred to SP10C.
- First slice with abort/prune authority in the PCD vertical. Throws `TreeBudgetExceededError` on violation.
- New `pcd/budget/` subdir + 14th pinned constant `PCD_TREE_BUDGET_VERSION`. No Prisma migration, no db-package adapter, no edits to SP1-SP10A source bodies.

## Test plan

- [ ] `pnpm typecheck` — clean across all 5 packages
- [ ] `pnpm exec vitest run --no-coverage` — all tests pass (final count ~1,535-1,545)
- [ ] `pnpm exec vitest run src/pcd/budget/sp10b-anti-patterns.test.ts` — all 9 structural assertions pass
- [ ] `pnpm exec prettier --check packages/creative-pipeline/src/pcd/budget/ packages/schemas/src/pcd-preproduction.ts ...` — clean
- [ ] Local-dev SP7+SP8 stub chain runs through the new orchestrator without budget violation (uses `STATIC_DEFAULT_BUDGET`)
- [ ] Tight test-only budget triggers `TreeBudgetExceededError` with populated `meta` + `violations`

## Spec

- Design: `docs/plans/2026-05-01-pcd-tree-budget-sp10b-design.md`
- Plan: `docs/plans/2026-05-01-pcd-tree-budget-sp10b-plan.md`

## Accepted risks (highlights — full list in design §0)

1. `maxEstimatedUsd` deferred to SP10C; field widened-but-null in SP10B.
2. Post-chain enforcement: chain runs to completion before gate fires (compute-waste assumption load-bearing — see §0 risk #18).
3. Dual-mode operation: `null` budget bypasses gate (rollout-friendly per §0 risk #16).
4. `treeSize` includes trends (operator-mental-model gap — see §0 risk #17).
5. `PcdIdentityContext.treeBudget` slot stays null in SP10B; stage runners cannot read budget.

## §4. Plan summary

10 tasks, ~46-56 net new tests, zero Prisma migrations, single schema widen.

| Task | Concern                                              | Files                                             |
| ---- | ---------------------------------------------------- | ------------------------------------------------- |
| 1    | `PCD_TREE_BUDGET_VERSION` constant                   | `tree-budget-version.{ts,test.ts}`                |
| 2    | Schema widen + fixture updates                       | `pcd-preproduction.ts` + its test                 |
| 3    | `Sp10bBudgetReader` interface (type-only)            | `sp10b-budget-reader.ts`                          |
| 4    | `StaticDefaultBudgetReader` stub                     | `static-default-budget-reader.{ts,test.ts}`       |
| 5    | `TreeBudgetExceededError` class + types              | `tree-budget-exceeded-error.{ts,test.ts}`         |
| 6    | Pure validator + priority lock                       | `tree-shape-validator.{ts,test.ts}`               |
| 7    | Orchestrator + outcome wrapper                       | `run-identity-aware-...-with-budget.{ts,test.ts}` |
| 8    | Public surface barrel + package re-export            | `index.ts` (budget) + package `index.ts`          |
| 9    | Anti-pattern grep tests (9 assertions)               | `sp10b-anti-patterns.test.ts`                     |
| 10   | SWITCHBOARD-CONTEXT.md + memory + final verification | `docs/SWITCHBOARD-CONTEXT.md` + memory            |
```
