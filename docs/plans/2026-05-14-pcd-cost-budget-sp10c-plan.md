# SP10C — Cost-Budget Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land cost-budget enforcement for the PCD pre-production chain so brief breadth cannot silently produce production fanout that exceeds operator-set dollar ceilings. Lights up `PreproductionTreeBudgetSchema.maxEstimatedUsd` (widened-but-null since SP10B). **Second slice with abort/prune authority** in the PCD vertical — SP10C WILL throw `CostBudgetExceededError` on violation.

**Architecture:** Sibling subdir `pcd/cost-budget/` mirroring SP7's `pcd/preproduction/`, SP9's `pcd/provenance/`, SP10A's `pcd/cost/`, SP10B's `pcd/budget/`. New 15th pinned constant `PCD_COST_BUDGET_VERSION`. New top-level orchestrator `runIdentityAwarePreproductionChainWithCostBudget` that COMPOSES SP10B's orchestrator (calls it with a `{...budget, maxEstimatedUsd: null}` stripped budget via a wrapper reader — does NOT edit SP10B source), then runs a post-SP10B coarse pre-routing cost gate. Pure orchestration — no Prisma migration, no db-package adapter. One new schema file: `pcd-cost-budget.ts` (CoarseCostEstimatorOutputSchema + CostBudgetMetaSchema). Existing `PreproductionTreeBudgetSchema` is NOT widened further; SP10B's `maxEstimatedUsd: z.number().positive().nullable()` is the slot SP10C populates.

**Tech Stack:** TypeScript ESM, Vitest, Zod. pnpm workspace. Co-located `*.test.ts` (creative-pipeline) / `__tests__/*.test.ts` (schemas). `pnpm exec prettier --check` as the practical style gate.

**Source spec:** `docs/plans/2026-05-14-pcd-cost-budget-sp10c-design.md` — read it before starting, especially §0 (18 accepted risks) and §3 (Q1–Q16 architectural locks).

**Branch:** `sp10c-cost-budget` (created in §0 setup; design doc staged on `main` is the base — first commit of this branch will be the design doc itself).

---

## §0. Pre-flight context

**You are working in `~/creativeagent`, a TypeScript pnpm monorepo with 5 packages. SP10C touches two:**

- `packages/schemas` — zod-only schemas (Layer 1)
- `packages/creative-pipeline` — pure orchestration (Layer 3)

**Note: SP10C does NOT touch `packages/db`.** No Prisma migration, no adapter, no `schema.prisma` edit. Pure orchestration.

**Hard rules (from CLAUDE.md and the design spec — non-negotiable):**

1. ESM only. Relative imports must end in `.js` (TypeScript-compiled). Example: `import { foo } from "./bar.js";`.
2. No `any`. Use `unknown` and narrow.
3. No `console.log`. Use `console.warn` / `console.error` if needed (likely never in SP10C).
4. Conventional Commits per task: `feat(pcd):`, `test(pcd):`, `chore(pcd):`, `docs(pcd):`.
5. Co-located tests for creative-pipeline (`*.test.ts` next to source). Schemas tests live in `packages/schemas/src/__tests__/*.test.ts`.
6. **`pnpm lint` is structurally broken on origin/main** — do NOT try to fix. Use `pnpm exec prettier --check <files>` as the style gate.
7. Two pre-existing prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` are baseline noise (now 12 slices deferred). DO NOT fix them in SP10C.
8. **No edits to SP1–SP10B source bodies.** Allowed edits outside `pcd/cost-budget/`:
   - `packages/schemas/src/pcd-cost-budget.ts` (NEW — Task 2)
   - `packages/schemas/src/__tests__/pcd-cost-budget.test.ts` (NEW — Task 2)
   - `packages/schemas/src/index.ts` (re-export the new schema file — Task 2)
   - `packages/creative-pipeline/src/index.ts` (re-export SP10C surface — Task 8)
   - `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` (allowlist edit — Task 9)
   - `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` (allowlist edit — Task 9)
   - `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` (allowlist edit — Task 9)
   - `docs/SWITCHBOARD-CONTEXT.md` (new SP10C section — Task 10)
   - The auto-memory file at `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (Task 10 only)
9. **All work commits to branch `sp10c-cost-budget`.** Do NOT push to remote unless explicitly asked.
10. **Anti-pattern test #4 baselines against `6ddd736`** (SP10B squash, current `main` HEAD). If SP11 lands first, the rebase swaps the baseline ref; that is a one-line edit at the merge step, NOT a Task 9 concern.
11. **The SP10B count-only invariant is load-bearing.** SP10C calls SP10B with a stripped budget (`{...raw, maxEstimatedUsd: null}` via a wrapper reader). DO NOT edit SP10B source, DO NOT touch `sp10b-anti-patterns.test.ts` test #6 ("maxEstimatedUsd === null invariant"). Test #6 stays unchanged because SP10C preserves the invariant structurally via the wrapper.

**One-time setup before starting:**

- [ ] **Verify starting state**

```bash
git status
git log -3 --oneline
git rev-parse HEAD
```

Expected: on branch `main`, last commit is `6ddd736 feat(pcd): SP10B — tree-budget enforcement (#10)`, working tree has the SP10C design doc staged (`A  docs/plans/2026-05-14-pcd-cost-budget-sp10c-design.md`). If the design doc is not staged, stop and surface to the user — the SP10C brainstorm/design step has not completed.

- [ ] **Create SP10C branch + commit the design doc as its first commit**

```bash
git checkout -b sp10c-cost-budget
git commit -m "docs(pcd): SP10C — cost-budget enforcement design"
git log -2 --oneline
```

Expected: branch `sp10c-cost-budget` created; `6ddd736` is parent; design-doc commit is HEAD.

- [ ] **Verify baseline tests pass**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
```

Expected: typecheck clean across all 5 packages; ~1,535-1,545 tests pass (SP10B baseline — SP10A baseline ~1,489 + ~46-56 SP10B net). If the baseline is broken, stop and surface to the user — do not proceed with SP10C on a red baseline.

- [ ] **Verify Prisma client is generated** (defensive — SP10C does not edit Prisma but baseline tests in db package require the client)

```bash
pnpm db:generate
```

Expected: success.

---

## §1. File structure

**New files (under `packages/creative-pipeline/src/pcd/cost-budget/`):**

| File                                                                | Responsibility                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cost-budget-version.ts`                                            | Pinned constant `PCD_COST_BUDGET_VERSION`. Sole import site: `cost-budget-validator.ts`.                                        |
| `coarse-cost-estimator.ts`                                          | `CoarseCostEstimator` interface + input/output types. Type-only.                                                                |
| `stub-coarse-cost-estimator.ts`                                     | `StubCoarseCostEstimator` + `STUB_COARSE_COST_ESTIMATOR_VERSION`. Deterministic `$1.50 × scriptCount` stub.                     |
| `cost-budget-exceeded-error.ts`                                     | Error class. Carries `meta: CostBudgetMeta`.                                                                                    |
| `cost-budget-validator.ts`                                          | Pure validator. Sole importer of `PCD_COST_BUDGET_VERSION`. Assembles `CostBudgetMeta` and returns `{ok, meta}`.                |
| `run-identity-aware-preproduction-chain-with-cost-budget.ts`        | Orchestrator. Builds identityContext, resolves budget, calls SP10B with stripped budget via wrapper, runs cost gate.            |
| `index.ts`                                                          | Public surface barrel.                                                                                                          |
| `cost-budget-version.test.ts`                                       | Constant-equality test (1 test).                                                                                                |
| `cost-budget-exceeded-error.test.ts`                                | Construction, name, message, meta carry, defensive zod parse (5 tests).                                                         |
| `stub-coarse-cost-estimator.test.ts`                                | Determinism, scaling, ignored-inputs, currency, version (5-6 tests).                                                            |
| `cost-budget-validator.test.ts`                                     | Happy + edge thresholds + meta version pin + meta carry-throughs (8-10 tests).                                                  |
| `run-identity-aware-preproduction-chain-with-cost-budget.test.ts`   | Full orchestrator paths: null bypass, count-only, full enforcement, error propagation, stripping invariant (14-16 tests).       |
| `sp10c-anti-patterns.test.ts`                                       | 9 structural grep assertions.                                                                                                   |

**New files (under `packages/schemas/src/`):**

| File                                          | Responsibility                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pcd-cost-budget.ts`                          | `CoarseCostEstimatorOutputSchema` + `CostBudgetMetaSchema` + types.                     |
| `__tests__/pcd-cost-budget.test.ts`           | Schema validation tests (8-10 tests).                                                   |

**Modified files (allowlist; deviations fail SP10C anti-pattern test #4):**

| File                                                                                   | Change                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/index.ts`                                                        | Re-export `./pcd-cost-budget.js`. (Task 2)                                                                            |
| `packages/creative-pipeline/src/index.ts`                                              | Re-export `./pcd/cost-budget/index.js`. (Task 8)                                                                      |
| `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`              | Add `pcd/cost-budget/` to freeze allowlist. (Task 9)                                                                  |
| `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`                  | Add `pcd/cost-budget/` to freeze allowlist. (Task 9)                                                                  |
| `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`                | Add `pcd/cost-budget/` to freeze allowlist. (Task 9)                                                                  |
| `docs/SWITCHBOARD-CONTEXT.md`                                                          | Add SP10C merge-back surface section after SP10B. (Task 10)                                                           |
| `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` | Add SP10C entry. (Task 10)                                                                                            |

**Files NOT changed (verified by anti-pattern test #4):**

- `packages/schemas/src/pcd-preproduction.ts` — `PreproductionTreeBudgetSchema` stays unchanged since SP10B. Anti-pattern test #6 freeze-asserts.
- Every SP1–SP10B source body in `packages/creative-pipeline/src/pcd/`. No `pcd/preproduction/`, `pcd/cost/`, `pcd/provenance/`, or `pcd/budget/` source-body edits.
- `packages/db/prisma/schema.prisma`. No `packages/db/src/stores/*` edits.
- No new migration directory.

---

## Task 1: `PCD_COST_BUDGET_VERSION` constant

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts`
- Test: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.test.ts`

This is the 15th pinned constant in the PCD slice. Sole import site is the validator (Task 6); composer-only version pinning lock #6 is enforced by anti-pattern test #1 (Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.test.ts
import { describe, expect, it } from "vitest";
import { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";

describe("PCD_COST_BUDGET_VERSION", () => {
  it("equals the exact pinned literal", () => {
    expect(PCD_COST_BUDGET_VERSION).toBe("pcd-cost-budget@1.0.0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-version.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the constant file**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts
// SP10C — 15th pinned constant in the PCD slice. Sole import site is
// cost-budget-validator.ts (composer-only pinning lock — sp10c-anti-patterns
// test #1 enforces). DO NOT import this constant anywhere else; the literal
// "pcd-cost-budget@" must not appear in any other source file.
export const PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0";
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-version.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.test.ts
```

Expected: clean. If warnings, run `pnpm exec prettier --write` on the same files.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.test.ts
git commit -m "feat(pcd): SP10C Task 1 — PCD_COST_BUDGET_VERSION constant (15th pinned)"
```

---

## Task 2: New schema file `pcd-cost-budget.ts`

**Files:**

- Create: `packages/schemas/src/pcd-cost-budget.ts`
- Create: `packages/schemas/src/__tests__/pcd-cost-budget.test.ts`
- Modify: `packages/schemas/src/index.ts` (re-export new file)

Two zod schemas ship together: `CoarseCostEstimatorOutputSchema` (validates the contract-shape of estimator output for defense-in-depth parsing) and `CostBudgetMetaSchema` (the forensic meta record carried on success outcome and error). Both schemas lock `currency: z.literal("USD")` per design §0 risk #10. The `PreproductionTreeBudgetSchema` is NOT widened — SP10B's slot is the field SP10C populates.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/schemas/src/__tests__/pcd-cost-budget.test.ts
import { describe, expect, it } from "vitest";
import {
  CoarseCostEstimatorOutputSchema,
  CostBudgetMetaSchema,
} from "../pcd-cost-budget.js";

describe("CoarseCostEstimatorOutputSchema", () => {
  const valid = {
    estimatedUsd: 12.5,
    currency: "USD" as const,
    lineItems: [{ label: "stub", estimatedUsd: 12.5 }],
    estimatorVersion: "stub@1.0.0",
  };

  it("accepts a valid output", () => {
    expect(CoarseCostEstimatorOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts estimatedUsd === 0 (nonnegative)", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({ ...valid, estimatedUsd: 0 }).success,
    ).toBe(true);
  });

  it("rejects negative estimatedUsd", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({ ...valid, estimatedUsd: -1 }).success,
    ).toBe(false);
  });

  it("rejects non-USD currency", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({ ...valid, currency: "EUR" }).success,
    ).toBe(false);
  });

  it("rejects empty estimatorVersion", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({ ...valid, estimatorVersion: "" }).success,
    ).toBe(false);
  });
});

describe("CostBudgetMetaSchema", () => {
  const valid = {
    costBudgetVersion: "pcd-cost-budget@1.0.0",
    estimatorVersion: "stub@1.0.0",
    estimatedUsd: 12.5,
    currency: "USD" as const,
    threshold: 100,
    lineItems: [{ label: "stub", estimatedUsd: 12.5 }],
    estimatedAt: "2026-05-14T00:00:00.000Z",
  };

  it("accepts a valid meta", () => {
    expect(CostBudgetMetaSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative estimatedUsd", () => {
    expect(
      CostBudgetMetaSchema.safeParse({ ...valid, estimatedUsd: -1 }).success,
    ).toBe(false);
  });

  it("rejects non-positive threshold (zero excluded)", () => {
    expect(CostBudgetMetaSchema.safeParse({ ...valid, threshold: 0 }).success).toBe(false);
    expect(CostBudgetMetaSchema.safeParse({ ...valid, threshold: -1 }).success).toBe(false);
  });

  it("rejects bad ISO timestamp", () => {
    expect(
      CostBudgetMetaSchema.safeParse({ ...valid, estimatedAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects missing field", () => {
    const { estimatorVersion: _ev, ...incomplete } = valid;
    expect(CostBudgetMetaSchema.safeParse(incomplete).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-cost-budget.test.ts
```

Expected: FAIL — module `../pcd-cost-budget.js` does not exist.

- [ ] **Step 3: Create the schema file**

```ts
// packages/schemas/src/pcd-cost-budget.ts
// SP10C — Cost-budget enforcement schemas. Two zod schemas:
//   1. CoarseCostEstimatorOutputSchema — defense-in-depth parser for the
//      injected CoarseCostEstimator's output. Locks currency to "USD".
//   2. CostBudgetMetaSchema — forensic record carried on the SP10C orchestrator
//      success outcome (costMeta) AND on CostBudgetExceededError.meta (failure).
//      Single source of truth for dashboard rendering on both paths.
import { z } from "zod";

export const CoarseCostEstimatorOutputSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatorVersion: z.string().min(1),
});
export type CoarseCostEstimatorOutputSchemaType = z.infer<typeof CoarseCostEstimatorOutputSchema>;

export const CostBudgetMetaSchema = z.object({
  costBudgetVersion: z.string().min(1),
  estimatorVersion: z.string().min(1),
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  threshold: z.number().positive(),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
  estimatedAt: z.string().datetime(),
});
export type CostBudgetMeta = z.infer<typeof CostBudgetMetaSchema>;
```

- [ ] **Step 4: Re-export from the schemas barrel**

Read the current end of `packages/schemas/src/index.ts`:

```bash
tail -5 packages/schemas/src/index.ts
```

Append one line:

```ts
export * from "./pcd-cost-budget.js";
```

- [ ] **Step 5: Run the schema tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-cost-budget.test.ts
```

Expected: PASS (9-10 tests).

- [ ] **Step 6: Run the full schemas package test suite**

```bash
pnpm --filter @creativeagent/schemas exec vitest run
```

Expected: PASS. (The new file does not affect existing schemas.)

- [ ] **Step 7: Prettier-check**

```bash
pnpm exec prettier --check packages/schemas/src/pcd-cost-budget.ts packages/schemas/src/__tests__/pcd-cost-budget.test.ts packages/schemas/src/index.ts
```

Expected: clean. If warnings, run `pnpm exec prettier --write`.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/pcd-cost-budget.ts packages/schemas/src/__tests__/pcd-cost-budget.test.ts packages/schemas/src/index.ts
git commit -m "feat(pcd): SP10C Task 2 — pcd-cost-budget schemas (CoarseCostEstimatorOutput + CostBudgetMeta)"
```

---

## Task 3: `CoarseCostEstimator` interface

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts`

Type-only file. No runtime behavior, no co-located test (the type is exercised structurally by Tasks 4 and 7's tests). The interface is the SP10C-declared merge-back surface — Switchboard ad-optimizer team owns the production implementer.

- [ ] **Step 1: Create the file**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts
// SP10C — Coarse pre-routing cost estimator contract.
//
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). SP10C ships only the contract + a deterministic
// stub (StubCoarseCostEstimator, see stub-coarse-cost-estimator.ts).
//
// Shape rationale (see design Q1):
//   - briefId — forensic traceability and per-brief override pricing lookups.
//   - identityContext — carries tier projection (effectiveTier, productTierAtResolution,
//     creatorTierAtResolution), allowed shot/intent universe (allowedShotTypes,
//     allowedOutputIntents), UGC constraints, tier-3 rule flags. The estimator
//     uses these to compute a tier/intent-weighted worst-case-or-average estimate
//     over the provider-capability matrix.
//   - scriptCount — per-asset multiplier. From chainResult.stageOutputs.scripts.scripts.length.
//   - NOT in the contract:
//       provider/model (unknown at gate time — SP4 routing is downstream of fanout),
//       shotTypeMix/outputIntentMix (per-script shotType is not in CreatorScriptSchema;
//         identityContext.allowedShotTypes covers the universe),
//       organizationId (already encoded in the budget value via the reader).
//   - currency: "USD" — single-currency by design (§0 risk #10).
//   - estimatorVersion — orthogonal to PCD_COST_BUDGET_VERSION; tags the cost MODEL
//     (not the schema). Lets mixed-version analytics work. Same precedent as SP10A.
import type { PcdIdentityContext } from "@creativeagent/schemas";

export type CoarseCostEstimatorInput = {
  briefId: string;
  identityContext: PcdIdentityContext;
  scriptCount: number;
};

export type CoarseCostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  lineItems: Array<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CoarseCostEstimator = {
  estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput>;
};
```

- [ ] **Step 2: Typecheck the new file**

```bash
pnpm --filter @creativeagent/creative-pipeline exec tsc --noEmit
```

Expected: clean (no errors).

- [ ] **Step 3: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts
git commit -m "feat(pcd): SP10C Task 3 — CoarseCostEstimator interface"
```

---

## Task 4: `StubCoarseCostEstimator`

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts`
- Test: `packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts`

Deterministic `$1.50 × scriptCount` stub. Ignores `briefId` and `identityContext` beyond the scriptCount multiplier — loud-stub posture per design §0 risk #4. Ships `STUB_COARSE_COST_ESTIMATOR_VERSION` (parallel to SP10A's `STUB_COST_ESTIMATOR_VERSION` — stub-internal, NOT part of the PCD pinned-constants count).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts
import { describe, expect, it } from "vitest";
import type { PcdIdentityContext } from "@creativeagent/schemas";
import {
  StubCoarseCostEstimator,
  STUB_COARSE_COST_ESTIMATOR_VERSION,
} from "./stub-coarse-cost-estimator.js";

function sampleIdentityContext(): PcdIdentityContext {
  return {
    creatorIdentityId: "c1",
    productIdentityId: "p1",
    consentRecordId: null,
    effectiveTier: 1,
    productTierAtResolution: 1,
    creatorTierAtResolution: 1,
    allowedShotTypes: [],
    allowedOutputIntents: [],
    tier3Rules: {
      firstLastFrameRequired: false,
      performanceTransferRequired: false,
      editOverRegenerateRequired: false,
    },
    voiceId: null,
    productCanonicalText: "",
    productHeroPackshotAssetId: null,
    brandPositioningText: null,
    ugcStyleConstraints: [],
    consentRevoked: false,
    treeBudget: null,
    identityContextVersion: "identity-context@1.0.0",
  };
}

describe("StubCoarseCostEstimator", () => {
  it("STUB_COARSE_COST_ESTIMATOR_VERSION equals the exact literal", () => {
    expect(STUB_COARSE_COST_ESTIMATOR_VERSION).toBe("stub-coarse-cost-estimator@1.0.0");
  });

  it("is deterministic — same scriptCount produces same estimate", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const a = await stub.estimate({ briefId: "b1", identityContext: ctx, scriptCount: 10 });
    const b = await stub.estimate({ briefId: "b2", identityContext: ctx, scriptCount: 10 });
    expect(a.estimatedUsd).toBe(b.estimatedUsd);
    expect(a.currency).toBe(b.currency);
  });

  it("scales linearly with scriptCount", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const one = await stub.estimate({ briefId: "b", identityContext: ctx, scriptCount: 1 });
    const ten = await stub.estimate({ briefId: "b", identityContext: ctx, scriptCount: 10 });
    expect(ten.estimatedUsd).toBeCloseTo(one.estimatedUsd * 10, 5);
  });

  it("returns currency `USD`", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({ briefId: "b", identityContext: ctx, scriptCount: 5 });
    expect(out.currency).toBe("USD");
  });

  it("carries the stub estimatorVersion", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({ briefId: "b", identityContext: ctx, scriptCount: 5 });
    expect(out.estimatorVersion).toBe(STUB_COARSE_COST_ESTIMATOR_VERSION);
  });

  it("zero-script edge returns zero estimatedUsd", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({ briefId: "b", identityContext: ctx, scriptCount: 0 });
    expect(out.estimatedUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the stub file**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts
// SP10C — Deterministic stub coarse cost estimator. Local default for tests
// and pre-merge-back development.
//
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). Stub is deterministic for tests + local
// development. DO NOT add config flags or environment-driven fan-in — the swap
// is by injection, not by feature flag.
import type {
  CoarseCostEstimator,
  CoarseCostEstimatorInput,
  CoarseCostEstimatorOutput,
} from "./coarse-cost-estimator.js";

export const STUB_COARSE_COST_ESTIMATOR_VERSION = "stub-coarse-cost-estimator@1.0.0";

// Loud-stub value. NOT a Switchboard-pricing claim. Real per-tier × per-shot-type
// pricing lives in the merge-back-time Switchboard ad-optimizer implementer.
const STUB_USD_PER_SCRIPT = 1.5;

export class StubCoarseCostEstimator implements CoarseCostEstimator {
  async estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput> {
    const estimatedUsd = input.scriptCount * STUB_USD_PER_SCRIPT;
    return {
      estimatedUsd,
      currency: "USD",
      lineItems: [
        {
          label: `${input.scriptCount} × $${STUB_USD_PER_SCRIPT.toFixed(2)} per-script (stub)`,
          estimatedUsd,
        },
      ],
      estimatorVersion: STUB_COARSE_COST_ESTIMATOR_VERSION,
    };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.test.ts
git commit -m "feat(pcd): SP10C Task 4 — StubCoarseCostEstimator (loud-stub default for local dev + tests)"
```

---

## Task 5: `CostBudgetExceededError`

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts`
- Test: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.test.ts`

Error class extends `Error`. Carries `meta: CostBudgetMeta` for operator forensics — symmetric with the success-path `outcome.costMeta`. Message format prefixes the violation reason for log readability.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.test.ts
import { describe, expect, it } from "vitest";
import type { CostBudgetMeta } from "@creativeagent/schemas";
import { CostBudgetMetaSchema } from "@creativeagent/schemas";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";

const sampleMeta: CostBudgetMeta = {
  costBudgetVersion: "pcd-cost-budget@1.0.0",
  estimatorVersion: "stub-coarse-cost-estimator@1.0.0",
  estimatedUsd: 250.0,
  currency: "USD",
  threshold: 100.0,
  lineItems: [{ label: "x", estimatedUsd: 250.0 }],
  estimatedAt: "2026-05-14T00:00:00.000Z",
};

describe("CostBudgetExceededError", () => {
  it("constructs with name and meta", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.name).toBe("CostBudgetExceededError");
    expect(err.meta).toEqual(sampleMeta);
  });

  it("is an Error instance", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err).toBeInstanceOf(Error);
  });

  it("message includes dollar-formatted estimate and threshold", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.message).toContain("$250.00");
    expect(err.message).toContain("$100.00");
  });

  it("meta is a valid CostBudgetMeta (defensive round-trip)", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(CostBudgetMetaSchema.safeParse(err.meta).success).toBe(true);
  });

  it("meta is carried by-reference (no deep clone — caller owns the object)", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.meta).toBe(sampleMeta);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-exceeded-error.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the error class**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts
// SP10C — Thrown when the coarse cost estimate exceeds budget.maxEstimatedUsd.
// Carries the full CostBudgetMeta for operator forensics — symmetric with
// the success-path outcome.costMeta so dashboard renders the same fields
// either way.
//
// MERGE-BACK: surface CostBudgetExceededError to dashboard with retry-with-
// raised-budget UI alongside SP10B's TreeBudgetExceededError UI.
import type { CostBudgetMeta } from "@creativeagent/schemas";

export class CostBudgetExceededError extends Error {
  readonly meta: CostBudgetMeta;

  constructor(args: { meta: CostBudgetMeta }) {
    super(
      `cost budget exceeded: estimated $${args.meta.estimatedUsd.toFixed(2)} > threshold $${args.meta.threshold.toFixed(2)}`,
    );
    this.name = "CostBudgetExceededError";
    this.meta = args.meta;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-exceeded-error.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.test.ts
git commit -m "feat(pcd): SP10C Task 5 — CostBudgetExceededError class"
```

---

## Task 6: `validateCostAgainstBudget` pure validator

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts`
- Test: `packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.test.ts`

Pure synchronous function. Zero I/O, zero stores. Sole import site for `PCD_COST_BUDGET_VERSION` (composer-only pinning lock #6 — anti-pattern test #1 enforces). Strict `>` semantics: `estimatedUsd === threshold` passes; `estimatedUsd > threshold` fails.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.test.ts
import { describe, expect, it } from "vitest";
import type { CoarseCostEstimatorOutput } from "./coarse-cost-estimator.js";
import { validateCostAgainstBudget } from "./cost-budget-validator.js";

function sampleEstimate(overrides: Partial<CoarseCostEstimatorOutput> = {}): CoarseCostEstimatorOutput {
  return {
    estimatedUsd: 50,
    currency: "USD",
    lineItems: [{ label: "x", estimatedUsd: 50 }],
    estimatorVersion: "stub@1.0.0",
    ...overrides,
  };
}

const sampleAt = "2026-05-14T00:00:00.000Z";

describe("validateCostAgainstBudget", () => {
  it("ok when estimate < threshold", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 50 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
    expect(out.meta.estimatedUsd).toBe(50);
    expect(out.meta.threshold).toBe(100);
  });

  it("ok when estimate === threshold (strict > semantics — equality passes)", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 100 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
  });

  it("fail when estimate > threshold by one cent", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 100.01 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(false);
    expect(out.meta.estimatedUsd).toBe(100.01);
  });

  it("ok when estimate is zero", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 0 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
  });

  it("meta carries costBudgetVersion pinned from import", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
  });

  it("meta carries estimatorVersion from input estimate", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatorVersion: "real-estimator@2.5.0" }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.estimatorVersion).toBe("real-estimator@2.5.0");
  });

  it("meta carries lineItems from input estimate", () => {
    const lineItems = [
      { label: "a", estimatedUsd: 25 },
      { label: "b", estimatedUsd: 25 },
    ];
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ lineItems }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.lineItems).toEqual(lineItems);
  });

  it("meta carries threshold from input", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 137.42,
      estimatedAt: sampleAt,
    });
    expect(out.meta.threshold).toBe(137.42);
  });

  it("meta carries estimatedAt from input", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 100,
      estimatedAt: "2026-12-25T12:34:56.789Z",
    });
    expect(out.meta.estimatedAt).toBe("2026-12-25T12:34:56.789Z");
  });

  it("meta is populated on both ok and fail paths (lossless symmetry)", () => {
    const ok = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 50 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    const fail = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 150 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(ok.meta.costBudgetVersion).toBe(fail.meta.costBudgetVersion);
    expect(ok.meta.currency).toBe(fail.meta.currency);
    expect(ok.meta.estimatedAt).toBe(fail.meta.estimatedAt);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-validator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the validator**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts
// SP10C — Pure synchronous validator. Compares the coarse cost estimate
// against the budget threshold and assembles a CostBudgetMeta forensic
// record. Strict > semantics — estimate === threshold passes.
//
// Sole import site for PCD_COST_BUDGET_VERSION (composer-only pinning lock,
// sp10c-anti-patterns test #1 enforces). Returns a structured result so the
// orchestrator decides whether to throw — same precedent as SP10B's
// validateTreeShapeAgainstBudget.
import type { CostBudgetMeta } from "@creativeagent/schemas";
import type { CoarseCostEstimatorOutput } from "./coarse-cost-estimator.js";
import { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";

export type ValidateCostAgainstBudgetInput = {
  estimate: CoarseCostEstimatorOutput;
  threshold: number; // budget.maxEstimatedUsd — non-null by precondition (orchestrator gates the call)
  estimatedAt: string; // ISO timestamp captured at orchestrator level via stores.clock()
};

export type ValidateCostAgainstBudgetOutput =
  | { ok: true; meta: CostBudgetMeta }
  | { ok: false; meta: CostBudgetMeta };

export function validateCostAgainstBudget(
  input: ValidateCostAgainstBudgetInput,
): ValidateCostAgainstBudgetOutput {
  const meta: CostBudgetMeta = {
    costBudgetVersion: PCD_COST_BUDGET_VERSION,
    estimatorVersion: input.estimate.estimatorVersion,
    estimatedUsd: input.estimate.estimatedUsd,
    currency: input.estimate.currency,
    threshold: input.threshold,
    lineItems: input.estimate.lineItems,
    estimatedAt: input.estimatedAt,
  };
  return input.estimate.estimatedUsd > input.threshold
    ? { ok: false, meta }
    : { ok: true, meta };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/cost-budget-validator.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.test.ts
git commit -m "feat(pcd): SP10C Task 6 — validateCostAgainstBudget pure validator"
```

---

## Task 7: `runIdentityAwarePreproductionChainWithCostBudget` orchestrator

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts`
- Test: `packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts`

The orchestrator is the heart of SP10C. It:

1. Builds identityContext at SP10C entry (for the estimator).
2. Resolves budget at SP10C top level (full budget including `maxEstimatedUsd`).
3. Null budget → bypass all enforcement; run SP7 chain directly.
4. Non-null budget → call SP10B with a `stripMaxUsdReader` wrapper that strips `maxEstimatedUsd` to `null`. SP10B's count-only invariant holds; SP10B throws `TreeBudgetExceededError` on count violation (propagated raw).
5. `budget.maxEstimatedUsd === null` → cost gate skipped; return `{result, budgetMeta, costMeta: null}`.
6. Non-null `maxEstimatedUsd` → call coarse estimator with defense-in-depth zod parse.
7. Run validator. Throw `CostBudgetExceededError` on fail; return wider outcome on pass.

Outcome wrapper exposes `{result, budgetMeta, costMeta}` — three-state matrix (design Q16).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts
import { describe, expect, it, vi } from "vitest";
import type {
  PcdBriefInput,
  PreproductionTreeBudget,
} from "@creativeagent/schemas";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
import { TreeBudgetExceededError } from "../budget/tree-budget-exceeded-error.js";
import { StaticDefaultBudgetReader } from "../budget/static-default-budget-reader.js";
import { StubCoarseCostEstimator } from "./stub-coarse-cost-estimator.js";
import {
  runIdentityAwarePreproductionChainWithCostBudget,
  type RunIdentityAwarePreproductionChainWithCostBudgetStores,
} from "./run-identity-aware-preproduction-chain-with-cost-budget.js";

// Reuse SP10B test fixtures conceptually — SP10C must build the full SP7+SP10B
// store dependency surface. The cleanest test pattern is to import the SP10B
// orchestrator's fixture helpers if exported, or replicate the minimal shape
// inline. See SP10B's run-identity-aware-preproduction-chain-with-budget.test.ts
// for the canonical fixture shape (stubProductRegistryReader, stubCreatorRegistryReader,
// stubConsentReader, four stub stage runners, ProductionFanoutGate, etc).
//
// For brevity these tests assume a helper `buildSp10cTestStores()` colocated
// with the test that returns a complete, working stores object. The helper
// uses the existing SP7+SP8 stub runners and SP10B's StaticDefaultBudgetReader
// (or a vi-mocked variant for budget-shape tests).

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

// Test stores helper. Pattern copied from SP10B's test file — includes ALL
// SP7+SP10B stores plus SP10C's coarseCostEstimator. budgetReader is overridable
// to test different budget shapes.
function buildSp10cTestStores(args: {
  budget: PreproductionTreeBudget | null;
}): RunIdentityAwarePreproductionChainWithCostBudgetStores {
  // Implementer note: copy the helper from
  // packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts
  // (functions buildSp10bTestStores / stub stage runners / stub registry readers /
  // ProductionFanoutGate). Add coarseCostEstimator: new StubCoarseCostEstimator()
  // and replace budgetReader with one that returns args.budget.
  //
  // If SP10B's helper is not exported, REPLICATE the structure inline here.
  // Anti-pattern test #5 (forbidden imports) will fail if you import from
  // `../budget/*.test.ts` — only production modules are importable.
  throw new Error(
    "Implementer: copy the SP10B test-store helper here (see SP10B run-with-budget.test.ts).",
  );
}

describe("runIdentityAwarePreproductionChainWithCostBudget", () => {
  it("null-budget bypass — all three meta fields null on outcome, chain still runs", async () => {
    const stores = buildSp10cTestStores({ budget: null });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).toBeNull();
    expect(out.costMeta).toBeNull();
    expect(out.result.stageOutputs.scripts.scripts.length).toBeGreaterThan(0);
  });

  it("count-only budget (maxEstimatedUsd: null) — costMeta null, budgetMeta populated", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).not.toBeNull();
    expect(out.costMeta).toBeNull();
  });

  it("full count+cost budget happy path — all three meta fields populated", async () => {
    // SP8 stub fanout = 42 nodes, 24 scripts. StubCoarseCostEstimator = 24 × $1.50 = $36.
    // Threshold $100 passes.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).not.toBeNull();
    expect(out.costMeta).not.toBeNull();
    expect(out.costMeta?.estimatedUsd).toBe(36);
    expect(out.costMeta?.threshold).toBe(100);
    expect(out.costMeta?.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
  });

  it("cost gate fails — throws CostBudgetExceededError with meta", async () => {
    // 24 × $1.50 = $36, threshold $10 → fails.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 10 },
    });
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(CostBudgetExceededError);
    try {
      await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    } catch (err) {
      expect(err).toBeInstanceOf(CostBudgetExceededError);
      const e = err as CostBudgetExceededError;
      expect(e.meta.estimatedUsd).toBe(36);
      expect(e.meta.threshold).toBe(10);
      expect(e.meta.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
    }
  });

  it("cost equals threshold — passes (strict > semantics)", async () => {
    // 24 × $1.50 = $36 exactly.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 36 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.costMeta?.estimatedUsd).toBe(36);
  });

  it("SP10B throws TreeBudgetExceededError — propagated raw, estimator NEVER called", async () => {
    // Tight count budget that the SP8 stub chain violates.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 2, maxTreeSize: 10, maxEstimatedUsd: 1000 },
    });
    // Wrap the estimator to detect calls.
    const estimateSpy = vi.spyOn(stores.coarseCostEstimator, "estimate");
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(TreeBudgetExceededError);
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("budgetReader throws — propagated raw", async () => {
    const stores = buildSp10cTestStores({ budget: null });
    stores.budgetReader = {
      async resolveBudget() {
        throw new Error("budget reader failure");
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrow("budget reader failure");
  });

  it("estimator throws — propagated raw", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    stores.coarseCostEstimator = {
      async estimate() {
        throw new Error("estimator failure");
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrow("estimator failure");
  });

  it("estimator output zod parse fails — ZodError propagated raw", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    stores.coarseCostEstimator = {
      // Return a malformed output (negative estimatedUsd). Zod parse must reject.
      async estimate() {
        return {
          estimatedUsd: -1,
          currency: "USD" as const,
          lineItems: [],
          estimatorVersion: "broken@0.0.0",
        };
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrowError(/estimatedUsd|nonnegative|Number must/);
  });

  it("budget reader called for the top-level fetch AND inside SP10B via stripMaxUsdReader", async () => {
    // The reader is called twice per gated run (§3 Q2 lock). Once at SP10C
    // entry, once via the stripMaxUsdReader wrapper inside SP10B.
    const callCount = { n: 0 };
    const stores = buildSp10cTestStores({ budget: null });
    stores.budgetReader = {
      async resolveBudget() {
        callCount.n += 1;
        return { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 };
      },
    };
    await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(callCount.n).toBe(2);
  });

  it("SP10B sees stripped budget (maxEstimatedUsd: null) via the wrapper", async () => {
    // Spy on the underlying reader. The first call (SP10C top-level) should
    // see no transformation; the second call (inside SP10B via stripMaxUsdReader)
    // is the wrapper invoking the original reader — but the BUDGET PASSED TO
    // SP10B is stripped. The way to assert this: have the budget reader return
    // a budget with maxEstimatedUsd: 100, then assert SP10B's invariant
    // assertion did NOT throw (it would throw InvariantViolationError if the
    // non-null budget reached SP10B's gate).
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    // If SP10C did NOT strip, SP10B would have thrown InvariantViolationError.
    // Reaching this assertion means stripping worked.
    expect(out.budgetMeta).not.toBeNull();
  });

  it("identityContext is built once at SP10C entry (estimator receives it)", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    let capturedIdentityContext: unknown = null;
    stores.coarseCostEstimator = {
      async estimate(input) {
        capturedIdentityContext = input.identityContext;
        return {
          estimatedUsd: 10,
          currency: "USD",
          lineItems: [{ label: "x", estimatedUsd: 10 }],
          estimatorVersion: "test@1.0.0",
        };
      },
    };
    await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(capturedIdentityContext).not.toBeNull();
    // identityContext shape sanity (one field is enough to confirm it's the real
    // PcdIdentityContext, not a stub or shim).
    expect((capturedIdentityContext as { identityContextVersion: string }).identityContextVersion).toBe(
      "identity-context@1.0.0",
    );
  });

  it("scriptCount in estimator call equals result.stageOutputs.scripts.scripts.length", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 1000 },
    });
    let capturedScriptCount = -1;
    stores.coarseCostEstimator = {
      async estimate(input) {
        capturedScriptCount = input.scriptCount;
        return {
          estimatedUsd: 10,
          currency: "USD",
          lineItems: [],
          estimatorVersion: "t@1.0.0",
        };
      },
    };
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(capturedScriptCount).toBe(out.result.stageOutputs.scripts.scripts.length);
  });

  it("clock injection — estimatedAt uses stores.clock() when present", async () => {
    const fixedDate = new Date("2026-12-25T12:00:00.000Z");
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 1000 },
    });
    stores.clock = () => fixedDate;
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.costMeta?.estimatedAt).toBe("2026-12-25T12:00:00.000Z");
  });
});
```

**Implementer note:** the test helper `buildSp10cTestStores` must replicate the SP10B test-store pattern. The reference implementation lives in
`packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.test.ts`. Read it before writing the helper. The shape includes:

- Stub `Sp7ProductRegistryReader` and `Sp7CreatorRegistryReader` that return minimal valid identities.
- Stub `consentRecordReader` returning a non-revoked consent record.
- Four stub stage runners (Trends, Motivators, Hooks, CreatorScripts) — already exported from `pcd/preproduction/stages/`.
- `AutoApproveAllScriptsGate` as the `productionFanoutGate`.
- `StaticDefaultBudgetReader` (or override) as `budgetReader`.
- `new StubCoarseCostEstimator()` as `coarseCostEstimator`.
- `organizationId: null`.
- `clock: () => new Date("2026-05-14T00:00:00.000Z")` for deterministic timestamps.

The full helper code is ~80 LOC and is identical structurally to SP10B's. **Copy-paste from SP10B's test file, then add `coarseCostEstimator` and rename the type.** Do NOT import from a `.test.ts` file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts
```

Expected: FAIL — module not found / helper not implemented.

- [ ] **Step 3: Create the orchestrator**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts
// SP10C — Production callsite that wraps SP10B's count-gated chain with a
// post-chain coarse cost-budget gate.
//
// Returns RunPreproductionChainWithCostBudgetOutcome { result, budgetMeta, costMeta }
// so callers get computed tree shape + cost on the success path without
// re-walking the tree or re-calling the estimator (design Q16).
//
// Composition order:
//   1. buildPcdIdentityContext (for estimator input)
//   2. budgetReader.resolveBudget (top-level, full budget including maxEstimatedUsd)
//   3. null budget → bypass SP10C entirely (run SP7 chain directly, return all null meta)
//   4. SP10B (count gate) called with stripMaxUsdReader wrapper (maxEstimatedUsd: null)
//      to preserve SP10B's load-bearing count-only invariant.
//   5. maxEstimatedUsd null → cost gate skipped, return {result, budgetMeta, costMeta: null}
//   6. coarseCostEstimator.estimate → defense-in-depth zod parse
//   7. validateCostAgainstBudget → throw CostBudgetExceededError on fail
//
// MERGE-BACK: dashboard surfaces CostBudgetExceededError with retry-with-raised-
// budget UI alongside SP10B's TreeBudgetExceededError UI.

import type {
  CostBudgetMeta,
  PcdBriefInput,
  PcdPreproductionChainResult,
} from "@creativeagent/schemas";
import { CoarseCostEstimatorOutputSchema } from "@creativeagent/schemas";
import { buildPcdIdentityContext } from "../preproduction/build-pcd-identity-context.js";
import { runIdentityAwarePreproductionChain } from "../preproduction/preproduction-chain.js";
import {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "../budget/run-identity-aware-preproduction-chain-with-budget.js";
import type { Sp10bBudgetReader } from "../budget/sp10b-budget-reader.js";
import type { TreeShapeMeta } from "../budget/tree-shape-validator.js";
import type { CoarseCostEstimator } from "./coarse-cost-estimator.js";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
import { validateCostAgainstBudget } from "./cost-budget-validator.js";

export type RunIdentityAwarePreproductionChainWithCostBudgetStores =
  RunIdentityAwarePreproductionChainWithBudgetStores & {
    coarseCostEstimator: CoarseCostEstimator;
  };

export type RunPreproductionChainWithCostBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when top-level budget was null (whole SP10C orchestrator bypassed).
  // Populated when SP10B ran (count gate succeeded).
  budgetMeta: TreeShapeMeta | null;
  // null when top-level budget was null OR budget.maxEstimatedUsd was null.
  // Populated when the cost gate ran and passed. (On cost-gate failure
  // CostBudgetExceededError is thrown; the error itself carries `meta: CostBudgetMeta`
  // for symmetric forensics.)
  costMeta: CostBudgetMeta | null;
};

export async function runIdentityAwarePreproductionChainWithCostBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithCostBudgetStores,
): Promise<RunPreproductionChainWithCostBudgetOutcome> {
  // Step 1 — Build identityContext at SP10C entry (for estimator). SP7 will
  // build it again internally; double-build accepted per design §0 risk #2.
  const identityContext = await buildPcdIdentityContext(brief, stores);

  // Step 2 — Resolve full budget at SP10C top level (including maxEstimatedUsd).
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved at SP10C top level)

  // Step 3 — Null-budget bypass: run SP7 chain directly without SP10B/SP10C gates.
  if (budget === null) {
    const result = await runIdentityAwarePreproductionChain(brief, stores);
    return { result, budgetMeta: null, costMeta: null };
  }

  // Step 4 — Wrap the reader so SP10B sees a count-only budget. Preserves
  // SP10B's load-bearing maxEstimatedUsd === null invariant structurally.
  const stripMaxUsdReader: Sp10bBudgetReader = {
    async resolveBudget(input) {
      const raw = await stores.budgetReader.resolveBudget(input);
      if (raw === null) return null;
      return { ...raw, maxEstimatedUsd: null };
    },
  };
  const sp10bStores: RunIdentityAwarePreproductionChainWithBudgetStores = {
    ...stores,
    budgetReader: stripMaxUsdReader,
  };
  const sp10bOutcome: RunPreproductionChainWithBudgetOutcome =
    await runIdentityAwarePreproductionChainWithBudget(brief, sp10bStores);
  // MERGE-BACK: emit WorkTrace here (count gate passed via SP10B)

  const { result, budgetMeta } = sp10bOutcome;

  // Step 5 — Cost gate skipped if maxEstimatedUsd is null.
  if (budget.maxEstimatedUsd === null) {
    // MERGE-BACK: emit WorkTrace here (cost gate skipped — maxEstimatedUsd null)
    return { result, budgetMeta, costMeta: null };
  }

  // Step 6 — Coarse cost estimator. Errors propagated raw.
  const scriptCount = result.stageOutputs.scripts.scripts.length;
  const rawEstimate = await stores.coarseCostEstimator.estimate({
    briefId: brief.briefId,
    identityContext,
    scriptCount,
  });
  // Defense-in-depth zod parse on the estimator output. Catches malformed
  // estimator implementations (e.g. non-USD currency, negative usd).
  const estimate = CoarseCostEstimatorOutputSchema.parse(rawEstimate);

  // Step 7 — Validator. Pure synchronous. Assembles meta with version pin.
  const estimatedAt = (stores.clock?.() ?? new Date()).toISOString();
  const validation = validateCostAgainstBudget({
    estimate,
    threshold: budget.maxEstimatedUsd,
    estimatedAt,
  });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (cost gate passed)
    return { result, budgetMeta, costMeta: validation.meta };
  }

  // Step 8 — Throw on violation.
  // MERGE-BACK: emit WorkTrace here (cost gate violated)
  throw new CostBudgetExceededError({ meta: validation.meta });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts
```

Expected: PASS (14 tests).

If a test fails on the helper-not-implemented error, return to Step 1 and complete the helper. Common helper-implementation pitfall: forgetting to wire `coarseCostEstimator` into the stores object.

- [ ] **Step 5: Run the full creative-pipeline test suite (defensive)**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS. No SP1-SP10B test regression.

- [ ] **Step 6: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.test.ts
git commit -m "feat(pcd): SP10C Task 7 — runIdentityAwarePreproductionChainWithCostBudget orchestrator"
```

---

## Task 8: Public surface barrel + creative-pipeline re-export

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts` (add one line)

Public surface for SP10C. Re-exports the pinned constant, error class, estimator types, stub estimator, validator, and orchestrator (+ store + outcome types).

- [ ] **Step 1: Create the barrel**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/index.ts
// SP10C — Public surface barrel.
export { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";
export { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
export type {
  CoarseCostEstimator,
  CoarseCostEstimatorInput,
  CoarseCostEstimatorOutput,
} from "./coarse-cost-estimator.js";
export {
  StubCoarseCostEstimator,
  STUB_COARSE_COST_ESTIMATOR_VERSION,
} from "./stub-coarse-cost-estimator.js";
export {
  validateCostAgainstBudget,
  type ValidateCostAgainstBudgetInput,
  type ValidateCostAgainstBudgetOutput,
} from "./cost-budget-validator.js";
export {
  runIdentityAwarePreproductionChainWithCostBudget,
  type RunIdentityAwarePreproductionChainWithCostBudgetStores,
  type RunPreproductionChainWithCostBudgetOutcome,
} from "./run-identity-aware-preproduction-chain-with-cost-budget.js";
```

- [ ] **Step 2: Re-export from creative-pipeline barrel**

Read current end of `packages/creative-pipeline/src/index.ts`:

```bash
tail -5 packages/creative-pipeline/src/index.ts
```

Append one line:

```ts
export * from "./pcd/cost-budget/index.js";
```

- [ ] **Step 3: Typecheck the barrel chain**

```bash
pnpm --filter @creativeagent/creative-pipeline exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Verify the SP10C surface is importable from the package root**

Quick verification (one-off check, not committed):

```bash
node --input-type=module -e "import { PCD_COST_BUDGET_VERSION, CostBudgetExceededError, StubCoarseCostEstimator, runIdentityAwarePreproductionChainWithCostBudget } from '@creativeagent/creative-pipeline'; console.warn(PCD_COST_BUDGET_VERSION, typeof CostBudgetExceededError, typeof StubCoarseCostEstimator, typeof runIdentityAwarePreproductionChainWithCostBudget);"
```

Expected: prints `pcd-cost-budget@1.0.0 function function function`.

If this fails with `Cannot find module @creativeagent/creative-pipeline`, the package may need a build first: `pnpm --filter @creativeagent/creative-pipeline build`. The build is also exercised by the full test suite later.

- [ ] **Step 5: Run the full creative-pipeline test suite**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS.

- [ ] **Step 6: Prettier-check**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/index.ts packages/creative-pipeline/src/index.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/index.ts packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP10C Task 8 — public surface barrel + creative-pipeline re-export"
```

---

## Task 9: `sp10c-anti-patterns.test.ts` + allowlist maintenance edits

**Files:**

- Create: `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts` (allowlist)
- Modify: `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` (allowlist)
- Modify: `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` (allowlist)

Nine structural assertions for SP10C (design Q13). Plus three small allowlist edits to upstream anti-pattern tests — same SP10A → SP10B precedent. **`sp10b-anti-patterns.test.ts` test #6 ("maxEstimatedUsd === null invariant") is NOT edited** — SP10C preserves SP10B's count-only invariant via the stripMaxUsdReader wrapper, so the invariant assertion stays valid.

- [ ] **Step 1: Read the SP10B anti-pattern test as a template**

```bash
cat packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
```

Note the structure: `listSourceFiles` walker, per-assertion `it(...)` blocks, and the source-freeze assertion using `git log --grep` + `git diff --name-only`.

- [ ] **Step 2: Create the SP10C anti-pattern test**

```ts
// packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COST_BUDGET_DIR = join(import.meta.dirname);
const PCD_DIR = join(COST_BUDGET_DIR, "..");

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

const costBudgetSources = listSourceFiles(COST_BUDGET_DIR);

describe("SP10C anti-pattern grep", () => {
  it("PCD_COST_BUDGET_VERSION literal lives only in cost-budget-version.ts and cost-budget-validator.ts (composer-only pinning)", () => {
    const allowed = new Set([
      join(COST_BUDGET_DIR, "cost-budget-version.ts"),
      join(COST_BUDGET_DIR, "cost-budget-validator.ts"),
    ]);
    for (const file of costBudgetSources) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_COST_BUDGET_VERSION literal`).not.toMatch(
        /"pcd-cost-budget@/,
      );
    }
    // Sanity — cost-budget-version.ts itself does contain the literal.
    expect(readFileSync(join(COST_BUDGET_DIR, "cost-budget-version.ts"), "utf8")).toContain(
      '"pcd-cost-budget@1.0.0"',
    );
  });

  it("throw-not-mutate selection — no SP10C source mutates selectedScriptIds or availableScriptIds", () => {
    for (const file of costBudgetSources) {
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

  it("throw discipline — orchestrator file DOES contain `throw new CostBudgetExceededError`", () => {
    const orchestrator = readFileSync(
      join(COST_BUDGET_DIR, "run-identity-aware-preproduction-chain-with-cost-budget.ts"),
      "utf8",
    );
    expect(orchestrator).toMatch(/throw\s+new\s+CostBudgetExceededError\(/);
  });

  it("forbidden imports — SP10C source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of costBudgetSources) {
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

  it("schema slot unchanged — PreproductionTreeBudgetSchema continues to declare `maxEstimatedUsd: z.number().positive().nullable()`", () => {
    const schemaPath = join(
      COST_BUDGET_DIR,
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

  it("SP10B invariant preserved — orchestrator file unchanged (load-bearing for SP10C structural composition)", () => {
    const sp10bOrchestrator = readFileSync(
      join(
        COST_BUDGET_DIR,
        "..",
        "budget",
        "run-identity-aware-preproduction-chain-with-budget.ts",
      ),
      "utf8",
    );
    // SP10C composes SP10B by calling it with a stripped budget. SP10B's
    // count-only assertion is what makes that composition safe. If this
    // assertion fails, someone removed SP10B's structural guard — SP10C's
    // architecture is no longer safe.
    expect(sp10bOrchestrator).toMatch(/budget\.maxEstimatedUsd\s*!==\s*null/);
    expect(sp10bOrchestrator).toMatch(/throw\s+new\s+InvariantViolationError/);
  });

  it("estimator contract immutability — coarse-cost-estimator.ts declares all required-shape fields", () => {
    const src = readFileSync(join(COST_BUDGET_DIR, "coarse-cost-estimator.ts"), "utf8");
    for (const field of [
      "briefId",
      "identityContext",
      "scriptCount",
      "estimate",
      "estimatedUsd",
      "currency",
      "lineItems",
      "estimatorVersion",
    ]) {
      expect(src, `coarse-cost-estimator.ts missing required field: ${field}`).toContain(field);
    }
  });

  it("stripMaxUsdReader invariant — SP10C orchestrator strips maxEstimatedUsd before calling SP10B", () => {
    const src = readFileSync(
      join(COST_BUDGET_DIR, "run-identity-aware-preproduction-chain-with-cost-budget.ts"),
      "utf8",
    );
    // Strip line-comments (SP5 codeOnly precedent) so doc-comments mentioning
    // `maxEstimatedUsd: null` do not trigger false positives.
    const codeOnly = src
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(
      codeOnly,
      "orchestrator code must strip maxEstimatedUsd to null before calling SP10B",
    ).toMatch(/maxEstimatedUsd:\s*null/);
  });

  it("SP1–SP10B source bodies are unchanged since the SP10B baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/schemas/src/pcd-cost-budget.ts",
      "packages/schemas/src/__tests__/pcd-cost-budget.test.ts",
      "packages/schemas/src/index.ts",
      "packages/creative-pipeline/src/index.ts",
      // SP9 + SP10A + SP10B anti-pattern tests are widened in this slice
      // to allowlist pcd/cost-budget/ — same precedent SP10B established
      // when it allowlisted pcd/budget/ in SP9 + SP10A's freeze tests.
      "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts",
    ]);

    let sp10bSha = "";
    try {
      sp10bSha = execSync(
        'git log --grep="SP10B — tree-budget enforcement" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9/SP10A/SP10B.
      return;
    }
    if (sp10bSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp10bSha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10C net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
      if (file.startsWith("docs/")) continue;
      if (allowedEdits.has(file)) continue;

      expect(allowedEdits.has(file), `SP10C modified disallowed file: ${file}`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the SP10C anti-pattern test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/sp10c-anti-patterns.test.ts
```

Expected: PASS (9 tests). If the source-freeze assertion (#9) fails because of SP9/SP10A/SP10B allowlist edits, proceed to Step 4 (those edits land in the same commit as the SP10C anti-pattern test).

If any other assertion fails, the SP10C implementation has drifted from the design contract — investigate and fix before proceeding.

Common failure modes:
- Assertion #1 fails: someone imported `PCD_COST_BUDGET_VERSION` outside the validator. Move the import OR (rarely justified) widen the allowlist.
- Assertion #5 fails: someone widened `PreproductionTreeBudgetSchema`. Revert — SP10C does not edit that schema.
- Assertion #6 fails: someone edited SP10B's orchestrator. Revert — SP10B is frozen.
- Assertion #8 fails: someone refactored the orchestrator to pass the raw budget to SP10B. Restore the `stripMaxUsdReader` wrapper.

- [ ] **Step 4: Update the SP9 anti-pattern test allowlist**

Edit `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`. Find the source-freeze assertion (search for `allowedEdits = new Set`) and add `"packages/creative-pipeline/src/pcd/cost-budget/"` to the prefix-skip list, OR if the allowlist is a flat file-name set, add the SP10C test file path. The pattern was set by SP10A → SP10B (which added a similar widen to SP9's test); read the existing allowlist for the canonical line shape.

The exact edit depends on how SP9's test currently filters. If it has a `startsWith` prefix-skip for SP10B (`if (file.startsWith("packages/creative-pipeline/src/pcd/budget/")) continue;`), add a parallel:

```ts
if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
```

Quick way to find the right spot:

```bash
grep -n "pcd/budget" packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts
```

Add the SP10C prefix-skip line immediately after.

- [ ] **Step 5: Update the SP10A anti-pattern test allowlist**

Same edit pattern as Step 4:

```bash
grep -n "pcd/budget" packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
```

Add the SP10C prefix-skip line immediately after the SP10B prefix-skip.

- [ ] **Step 6: Update the SP10B anti-pattern test allowlist**

```bash
grep -n "allowedEdits = new Set" packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
```

SP10B's test has an `allowedEdits` flat-set. Add the three SP10C-affected anti-pattern test files OR (cleaner) add the prefix-skip pattern. Implementer's choice — match the existing SP10B style. **Do NOT remove or invert any SP10B assertion** — only widen the allowlist for legitimate SP10C-introduced edits.

Concretely:

```ts
const allowedEdits = new Set([
  // ... existing entries ...
  "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts",
  "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts",
]);
```

becomes (if needed; SP10B's test #9 only fires when files OUTSIDE the cost-budget prefix change, so the `if (file.startsWith("pcd/cost-budget/")) continue;` skip is the cleaner edit):

Add the prefix-skip:

```ts
if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
```

immediately after the `pcd/budget/` skip line. **Verify this does not break SP10B's freeze** — SP10C is net-new under `pcd/cost-budget/`, so the skip is legitimately additive.

- [ ] **Step 7: Run all four anti-pattern tests to verify they still pass**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run \
  src/pcd/provenance/sp9-anti-patterns.test.ts \
  src/pcd/cost/sp10a-anti-patterns.test.ts \
  src/pcd/budget/sp10b-anti-patterns.test.ts \
  src/pcd/cost-budget/sp10c-anti-patterns.test.ts
```

Expected: PASS (all four files; net assertion count up to ~35).

If SP9/SP10A/SP10B tests fail with "modified disallowed file" against an SP10C-created file, the prefix-skip edit didn't land. Re-check Steps 4-6.

- [ ] **Step 8: Run the full creative-pipeline test suite**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run
```

Expected: PASS.

- [ ] **Step 9: Prettier-check**

```bash
pnpm exec prettier --check \
  packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
```

Expected: clean.

- [ ] **Step 10: Commit (one commit covering the anti-pattern test + the three allowlist edits)**

```bash
git add packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
git commit -m "test(pcd): SP10C Task 9 — sp10c-anti-patterns structural assertions (9 tests) + allowlist maintenance"
```

---

## Task 10: SWITCHBOARD-CONTEXT.md update + memory update + final verification

**Files:**

- Modify: `docs/SWITCHBOARD-CONTEXT.md` (append SP10C section after SP10B)
- Modify: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (append SP10C entry)

This task wraps up the slice: documents merge-back surfaces, updates persistent memory for future sessions, and runs full verification.

- [ ] **Step 1: Read the existing SP10B merge-back section**

```bash
grep -n "^### SP10B" docs/SWITCHBOARD-CONTEXT.md
```

Note its structure — three subsections: "SP10B-declared merge-back surfaces", "Schema reconciliation at merge-back", "Architectural seams the merge-back does NOT need to rewrite", plus the SP10B-specific count-only and SP8-stub-compatibility notes.

- [ ] **Step 2: Append SP10C section to `docs/SWITCHBOARD-CONTEXT.md`**

Append the following at the end of the file (after the SP10B section):

```markdown
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
```

- [ ] **Step 3: Update auto-memory with SP10C entry**

Edit `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. Append after the SP10B entry:

```markdown
- **SP10C — Cost-budget enforcement:** ✅ Implementation complete on `creativeagent` branch `sp10c-cost-budget` (squash + PR pending). 10 implementation tasks completed. Highlights:
  - **Second slice with abort/prune authority** in the PCD vertical. SP10C throws `CostBudgetExceededError` on cost-gate violation. SP10A's forecast-only invariant continues to NOT apply to abort-authority slices.
  - **Coarse pre-routing cost estimator (Q1 lock).** New `CoarseCostEstimator` interface takes `{briefId, identityContext, scriptCount}` — provider/model unknown at gate time (SP4 routing is downstream of fanout). `StubCoarseCostEstimator` ships a deterministic `$1.50 × scriptCount` loud-stub.
  - **15th pinned constant:** `PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0"`. Composer-only pinning lock holds — only `cost-budget-version.ts` and `cost-budget-validator.ts` (the importer) contain the literal. `STUB_COARSE_COST_ESTIMATOR_VERSION` is stub-internal (not in PCD pinned count, mirrors SP10A's `STUB_COST_ESTIMATOR_VERSION` precedent).
  - **Post-SP10B enforcement (Q2 lock).** New top-level orchestrator `runIdentityAwarePreproductionChainWithCostBudget` builds identityContext, resolves the full budget, calls SP10B with a `stripMaxUsdReader` wrapper (preserves SP10B's load-bearing `maxEstimatedUsd === null` invariant), then runs the coarse cost estimator + validator. Throws `CostBudgetExceededError` on violation; returns `{ result, budgetMeta, costMeta }` outcome wrapper on success.
  - **Three-state outcome wrapper (Q16).** `RunPreproductionChainWithCostBudgetOutcome { result, budgetMeta: TreeShapeMeta | null, costMeta: CostBudgetMeta | null }`. (a) all null = null-budget bypass, (b) budgetMeta populated + costMeta null = count-only mode, (c) all three populated = count + cost enforcement.
  - **No edits to SP10B body (Q7 lock).** Option (c) chosen: SP10C COMPOSES SP10B by calling it as a pure function with a stripped budget via `stripMaxUsdReader`. SP10B's count-only invariant assertion is load-bearing for SP10C — `sp10b-anti-patterns.test.ts` test #6 stays unchanged. Anti-pattern test #6 in SP10C asserts SP10B's invariant text continues to exist (defensive — SP10C's architecture breaks if someone removes SP10B's structural guard).
  - **New schema file (Task 2):** `packages/schemas/src/pcd-cost-budget.ts` ships `CoarseCostEstimatorOutputSchema` + `CostBudgetMetaSchema`. Single-currency `z.literal("USD")` lock. `PreproductionTreeBudgetSchema` is NOT widened further — SP10B's `maxEstimatedUsd: z.number().positive().nullable()` slot is what SP10C populates.
  - **9 anti-pattern grep assertions:** composer-only version pinning, throw-not-mutate, throw discipline (positive `CostBudgetExceededError`), forbidden imports, schema-slot freeze (PreproductionTreeBudgetSchema unchanged), SP10B invariant preserved (load-bearing), estimator contract immutability, stripMaxUsdReader invariant, SP1-SP10B source-body freeze (baselines against `6ddd736`).
  - **No Prisma migration. No db-package adapter.** SP10C is pure orchestration. Forensic trail at merge-back lives in WorkTrace via 5 `// MERGE-BACK: emit WorkTrace here` markers + dashboard UX markers.
  - **`PcdProductionFanoutDecision.costForecast` slot stays null (Q4 lock).** SP7 composer untouched. SP10C's cost data flows through the outcome wrapper, not the SP7 decision struct.
  - **Subdir layout:** `packages/creative-pipeline/src/pcd/cost-budget/` (sibling to `pcd/preproduction/`, `pcd/provenance/`, `pcd/cost/`, `pcd/budget/`). 7 source files (version, error, estimator contract, stub estimator, validator, orchestrator, barrel) + 6 co-located test files + 1 new schema file + 1 new schema test.
  - **Allowlist maintenance (Task 9):** SP9 + SP10A + SP10B anti-pattern freeze tests each had `pcd/cost-budget/` added to their prefix-skip list. Same SP10A → SP10B precedent. Three ~3-line edits.
  - **User-accepted risks (recorded in design §0):** 18 explicit risks including identityContext built twice per gated run, coarse estimator structurally less accurate than SP10A's per-asset routed estimator, SP10C does NOT close the bare-writer callsite invariant, single-currency lock, throw-on-violation produces non-resumable chain, dual-mode operation permitted (gated vs ungated per org).
  - **Final state:** ~50-60 net SP10C tests across creative-pipeline + schemas packages all green; full repo typecheck clean across all 5 packages; prettier clean modulo the 2 SP5-baseline warnings on tier-policy.ts/tier-policy.test.ts (unchanged — now 12 slices deferred).
```

Also update the YAML frontmatter `description:` field to reflect SP10C completion. Find the existing `description:` line at the top of the file and update its scope to include SP10C.

- [ ] **Step 4: Final verification — full repo typecheck + tests + prettier**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
pnpm exec prettier --check \
  packages/creative-pipeline/src/pcd/cost-budget/ \
  packages/schemas/src/pcd-cost-budget.ts \
  packages/schemas/src/__tests__/pcd-cost-budget.test.ts \
  packages/schemas/src/index.ts \
  packages/creative-pipeline/src/index.ts \
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
  docs/SWITCHBOARD-CONTEXT.md \
  docs/plans/2026-05-14-pcd-cost-budget-sp10c-design.md \
  docs/plans/2026-05-14-pcd-cost-budget-sp10c-plan.md
```

Expected:

- typecheck: clean across all 5 packages.
- vitest: ~50-60 net new SP10C tests on top of the SP10B baseline (~1,535-1,545) — final count should be in the ~1,585-1,605 range.
- prettier: clean (modulo the 2 pre-existing tier-policy warnings, which are NOT in the file list above).

If any of these fail, fix before committing.

- [ ] **Step 5: Verify all 9 SP10C anti-pattern assertions still pass post-cleanup**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost-budget/sp10c-anti-patterns.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 6: Verify the design + plan docs are committed (the plan was authored on `main` and is staged in §0; ensure it's now in branch history)**

```bash
git log --oneline sp10c-cost-budget ^main
```

Expected: a clean linear sequence — design-doc commit + ~10 task commits + 1 final wrap-up commit (this task). Verify each commit message matches Conventional Commits format.

- [ ] **Step 7: Commit the docs + memory update**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "docs(pcd): SP10C — merge-back surface + slice progress memory update"
# memory file at ~/.claude/projects/... is outside the repo unless that directory
# is under VCS — commit there separately if it is.
```

- [ ] **Step 8: Final state check**

```bash
git status
git log --oneline -15
```

Expected: working tree clean; branch `sp10c-cost-budget` has design + 10 task commits + final docs commit.

---

## §2. Self-review checklist (run after every task above)

After each task commit, do a 30-second sanity check:

1. **Test count delta:** Did the test count go up by approximately the expected amount? If a task says "5 tests" and the test count went up by 4, investigate before proceeding.
2. **Typecheck:** `pnpm typecheck` should be clean. If a task introduced a TS error elsewhere (e.g. by changing a public type), the issue must be fixed in the same commit.
3. **Prettier:** every new and modified file should pass `pnpm exec prettier --check`. If not, run `pnpm exec prettier --write` and amend or follow up.
4. **No SP1-SP10B source-body edits:** if you find yourself editing a file outside the allowlist in §1, stop. Re-read §0 hard rule #8 — the rule is non-negotiable.
5. **SP10B invariant preserved:** if you find yourself tempted to edit `packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts` or invert/remove `sp10b-anti-patterns.test.ts` test #6, STOP. SP10C's architecture depends on that invariant. Re-read §0 hard rule #11 and design §0 risk #17.

---

## §3. PR template (when ready)

```markdown
## Summary

- Lands cost-budget enforcement for the PCD pre-production chain. Lights up `PreproductionTreeBudgetSchema.maxEstimatedUsd` (widened-but-null since SP10B).
- Second slice with abort/prune authority in the PCD vertical. Throws `CostBudgetExceededError` on cost-gate violation.
- New `pcd/cost-budget/` subdir + 15th pinned constant `PCD_COST_BUDGET_VERSION`. New `pcd-cost-budget.ts` schema file. No Prisma migration, no db-package adapter, no edits to SP1-SP10B source bodies.
- SP10B's count-only invariant preserved structurally via a `stripMaxUsdReader` wrapper — SP10B sees a stripped budget and its `maxEstimatedUsd === null` assertion continues to hold.

## Test plan

- [ ] `pnpm typecheck` — clean across all 5 packages
- [ ] `pnpm exec vitest run --no-coverage` — all tests pass (final count ~1,585-1,605)
- [ ] `pnpm exec vitest run src/pcd/cost-budget/sp10c-anti-patterns.test.ts` — all 9 structural assertions pass
- [ ] `pnpm exec vitest run src/pcd/budget/sp10b-anti-patterns.test.ts` — SP10B's 9 assertions ALL still pass (including #6, the load-bearing maxEstimatedUsd-null invariant)
- [ ] `pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost-budget/ packages/schemas/src/pcd-cost-budget.ts ...` — clean
- [ ] Local-dev SP7+SP8 stub chain runs through the SP10C orchestrator with `STATIC_DEFAULT_BUDGET` (cost gate skipped because `maxEstimatedUsd: null`); same chain runs through with a custom budget `{maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100}` produces `costMeta.estimatedUsd === 36` (24 scripts × $1.50)
- [ ] Tight test-only budget `{maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 10}` triggers `CostBudgetExceededError` with populated `meta`

## Spec

- Design: `docs/plans/2026-05-14-pcd-cost-budget-sp10c-design.md`
- Plan: `docs/plans/2026-05-14-pcd-cost-budget-sp10c-plan.md`

## Accepted risks (highlights — full list in design §0)

- Coarse pre-routing estimator is provably less accurate than SP10A's per-asset routed estimator. Operator dashboards must surface both numbers explicitly.
- identityContext is built twice on the SP10C-gated success path (once at SP10C entry for the estimator, once inside SP7 chain). Merge-back may optimize.
- `PcdProductionFanoutDecision.costForecast` STAYS null (forbidden to edit SP7 composer). Cost data flows through the outcome wrapper.
- Single-currency `"USD"` lock. Multi-currency is a future `PCD_COST_BUDGET_VERSION@2.0.0` bump.
- Throw-on-violation produces a non-resumable chain.
- Dual-mode operation permitted (gated vs. ungated per org).
- SP10B's count-only invariant is load-bearing for SP10C's architecture — removing it breaks SP10C structural composition.
```

---

## §4. Architectural diagram (for PR reviewers)

```
                   ┌────────────────────────────────────────────────┐
                   │  runIdentityAwarePreproductionChainWithCostBudget │
                   │             [SP10C — NEW]                       │
                   └─┬──────────────────────────────────────────────┘
                     │
                     ├─ Step 1 ─▶ buildPcdIdentityContext  ─┐
                     │           (SP7 — UNCHANGED)            │
                     │                                        │ (identityContext
                     ├─ Step 2 ─▶ stores.budgetReader        │  cached for
                     │           .resolveBudget               │  estimator)
                     │           (top-level fetch)            │
                     │                                        │
                     ├─ Step 3 ─▶ budget === null?           │
                     │   yes──▶ runIdentityAwarePreproductionChain
                     │            (SP7 — UNCHANGED)
                     │            → return { result, all-null meta }
                     │
                     ├─ Step 4 ─▶ runIdentityAwarePreproductionChainWithBudget
                     │           (SP10B — UNCHANGED)
                     │           passes stripMaxUsdReader wrapper
                     │           → SP10B sees maxEstimatedUsd: null
                     │           → SP10B count gate enforced
                     │           → returns { result, budgetMeta }
                     │
                     ├─ Step 5 ─▶ budget.maxEstimatedUsd === null?
                     │   yes──▶ return { result, budgetMeta, costMeta: null }
                     │
                     ├─ Step 6 ─▶ stores.coarseCostEstimator.estimate
                     │           ({ briefId, identityContext, scriptCount })
                     │           → defense-in-depth zod parse
                     │
                     ├─ Step 7 ─▶ validateCostAgainstBudget
                     │   ok ───▶ return { result, budgetMeta, costMeta }
                     │   fail ─▶ throw CostBudgetExceededError({ meta })
                     │
                     ▼
              (caller destructures success outcome OR catches error)
```

**Throw boundaries (no try/catch anywhere):**

| Source of throw                                 | Reaches caller as                  |
| ----------------------------------------------- | ---------------------------------- |
| `buildPcdIdentityContext`                       | (raw — InvariantViolationError etc) |
| `budgetReader.resolveBudget`                    | (raw)                               |
| SP10B (count gate)                              | `TreeBudgetExceededError` (raw)     |
| SP10B (chain)                                   | `PreproductionChainError` (raw)     |
| `coarseCostEstimator.estimate`                  | (raw)                               |
| `CoarseCostEstimatorOutputSchema.parse`         | `ZodError` (raw)                    |
| `validateCostAgainstBudget` returns ok: false  | `CostBudgetExceededError` (thrown by orchestrator) |

---

## §5. End-of-plan checklist

After all 10 tasks ship:

- [ ] 15 PCD pinned constants total (SP2 + SP3 + SP4 + SP5 + SP6 + SP7 + SP8 + SP9 + SP10A + SP10B + SP10C = 15).
- [ ] `pcd/cost-budget/` subdir is the 6th pcd/ sibling (after pcd/preproduction/, pcd/provenance/, pcd/cost/, pcd/budget/, and pcd top-level).
- [ ] All four anti-pattern tests pass: sp7-anti-patterns, sp9-anti-patterns, sp10a-anti-patterns, sp10b-anti-patterns, sp10c-anti-patterns. Total assertion count up to ~40-45.
- [ ] SP10B test #6 (`maxEstimatedUsd === null invariant`) still passes — load-bearing for SP10C.
- [ ] `docs/SWITCHBOARD-CONTEXT.md` has 3 SP10 subsections (SP10A, SP10B, SP10C).
- [ ] Memory file has SP10C entry.
- [ ] Working tree clean on branch `sp10c-cost-budget`.
- [ ] Merge-back checklist (for future Switchboard PR): inject real `CoarseCostEstimator` from ad-optimizer team, swap `StaticDefaultBudgetReader` for the production `OrganizationBudget` reader, implement WorkTrace at all 5 SP10C markers, wire dashboard UX for `CostBudgetExceededError`.
