# SP10A — Cost-Forecast Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land per-asset cost-forecast observability for the PCD vertical. Inject a `CostEstimator` interface, stamp a forensic record at provenance-write time, persist on a new `costForecastReason Json?` column on `PcdIdentitySnapshot`. Forecast-only — no abort, no prune, no budget gate.

**Architecture:** Sibling subdir `pcd/cost/` mirroring SP7's `pcd/preproduction/` and SP9's `pcd/provenance/` layout. New 13th pinned constant `PCD_COST_FORECAST_VERSION`. New top-level orchestrator `writePcdIdentitySnapshotWithCostForecast` that **composes** SP9's `stampPcdProvenance` (pure call — does NOT edit SP9 source) and SP10A's `stampPcdCostForecast`, runs the SP4 invariant assertion (3-way lock-step with SP4 + SP9), persists 27-field row via new `createForShotWithCostForecast` Prisma store method.

**Tech Stack:** TypeScript ESM, Vitest, Zod, Prisma. pnpm workspace. Co-located `*.test.ts` (creative-pipeline) / `__tests__/*.test.ts` (schemas) / `__tests__/*.test.ts` (db). `pnpm exec prettier --check` as the practical style gate.

**Source spec:** `docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md` — read it before starting, especially §0 (12 accepted risks) and §3 (Q1–Q8 architectural locks).

**Branch:** `sp10a-cost-forecast` (already created; design doc commit `590d8c7` is the base).

---

## §0. Pre-flight context

**You are working in `~/creativeagent`, a TypeScript pnpm monorepo with 5 packages. SP10A touches three:**
- `packages/schemas` — zod-only schemas (Layer 1)
- `packages/creative-pipeline` — pure orchestration (Layer 3, depends on schemas + db's interfaces but not db's runtime)
- `packages/db` — Prisma adapters (Layer 2)

**Hard rules (from CLAUDE.md and the design spec — non-negotiable):**
1. ESM only. Relative imports must end in `.js` (TypeScript-compiled). Example: `import { foo } from "./bar.js";`.
2. No `any`. Use `unknown` and narrow.
3. No `console.log`. Use `console.warn` / `console.error` if needed (likely never in SP10A).
4. Conventional Commits per task: `feat(pcd):`, `test(pcd):`, `chore(pcd):`.
5. Co-located tests for creative-pipeline (`*.test.ts` next to source). Schemas tests live in `packages/schemas/src/__tests__/*.test.ts`. DB tests live in `packages/db/src/stores/__tests__/*.test.ts`.
6. **`pnpm lint` is structurally broken on origin/main** — do NOT try to fix. Use `pnpm exec prettier --check <files>` as the style gate.
7. Two pre-existing prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` are baseline noise (now 9 slices deferred). DO NOT fix them in SP10A.
8. **No edits to SP1–SP9 source bodies.** Allowed edits outside `pcd/cost/`:
   - `packages/schemas/src/index.ts` (re-export new schemas file)
   - `packages/creative-pipeline/src/index.ts` (re-export SP10A surface)
   - `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (widen with new method + adapter; existing SP4 + SP9 bodies preserved byte-equivalent)
   - `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts` (add SP10A round-trip tests)
   - `packages/db/prisma/schema.prisma` (one line added)
   - `packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/migration.sql` (new file)
   - `docs/SWITCHBOARD-CONTEXT.md` (new SP10A section)
   - The auto-memory file at `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (final task only)
9. **All work commits to branch `sp10a-cost-forecast`.** Do NOT push to remote unless explicitly asked.

**One-time setup before starting:**

- [ ] **Verify branch state**

```bash
git status
git log -3 --oneline
```

Expected: on branch `sp10a-cost-forecast`, last commit is `590d8c7 docs(pcd): SP10A — fold 5 user-raised watchpoints into §0 risks`, working tree clean.

- [ ] **Verify baseline tests pass**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
```

Expected: typecheck clean across all 5 packages; ~1,449 tests pass (SP9 baseline). If the baseline is broken, stop and surface to the user — do not proceed with SP10A on a red baseline.

- [ ] **Verify Prisma client is generated**

```bash
pnpm db:generate
```

Expected: success. Prisma client is needed for the db package tests.

---

## §1. File structure

**New files (under `packages/creative-pipeline/src/pcd/cost/`):**

| File | Responsibility |
|---|---|
| `cost-forecast-version.ts` | Pinned constant `PCD_COST_FORECAST_VERSION`. Sole import site. |
| `cost-estimator.ts` | `CostEstimator` interface + input/output types. Type-only. |
| `stub-cost-estimator.ts` | `StubCostEstimator` deterministic test/local default + `STUB_COST_ESTIMATOR_VERSION`. |
| `stamp-pcd-cost-forecast.ts` | Pure store-injected stamper. Calls injected estimator, pins version constant, returns `PcdSp10CostForecastReason`. |
| `pcd-sp10-identity-snapshot-store.ts` | `PcdSp10IdentitySnapshotStore` contract type. |
| `write-pcd-identity-snapshot-with-cost-forecast.ts` | Orchestrator. Composes SP9 stamper + SP10A stamper + SP4 invariant + Prisma store. |
| `index.ts` | Public surface barrel. |
| `cost-forecast-version.test.ts` | Constant-equality test. |
| `stub-cost-estimator.test.ts` | Determinism + version carry + payload shape. |
| `stamp-pcd-cost-forecast.test.ts` | Estimator invocation, version pinning, payload shape, error propagation. |
| `write-pcd-identity-snapshot-with-cost-forecast.test.ts` | Full orchestrator path with mocked stores. |
| `sp10a-anti-patterns.test.ts` | 8 structural grep assertions. |

**New files (under `packages/schemas/src/`):**

| File | Responsibility |
|---|---|
| `pcd-cost-forecast.ts` | `PcdSp10CostLineItemSchema` + `PcdSp10CostForecastReasonSchema`. |
| `__tests__/pcd-cost-forecast.test.ts` | Schema parse/reject/literal-currency tests. |

**New files (under `packages/db/`):**

| File | Responsibility |
|---|---|
| `prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/migration.sql` | Single `ALTER TABLE` adding `costForecastReason JSONB`. |

**Modified files (allowlist; deviations fail the SP10A anti-pattern test):**

| File | Change |
|---|---|
| `packages/schemas/src/index.ts` | Re-export `pcd-cost-forecast.js`. |
| `packages/creative-pipeline/src/index.ts` | Re-export SP10A surface (`./pcd/cost/index.js`). |
| `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` | Add `createForShotWithCostForecast` method + `adaptPcdSp10IdentitySnapshotStore` adapter. SP4 `create()` + SP9 `createForShotWithProvenance()` bodies preserved byte-equivalent. |
| `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts` | Add SP10A round-trip tests (mocked-prisma style). |
| `packages/db/prisma/schema.prisma` | Add `costForecastReason Json?` to `PcdIdentitySnapshot` model. |
| `docs/SWITCHBOARD-CONTEXT.md` | Add SP10A merge-back surface section after SP9. |
| `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` | Add SP10A entry (final task). |

---

## Task 1: `PCD_COST_FORECAST_VERSION` constant

**Goal:** Land the 13th pinned constant. Sole import site.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts`
- Test: `packages/creative-pipeline/src/pcd/cost/cost-forecast-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/cost/cost-forecast-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";

describe("PCD_COST_FORECAST_VERSION", () => {
  it("equals the literal 'pcd-cost-forecast@1.0.0'", () => {
    expect(PCD_COST_FORECAST_VERSION).toBe("pcd-cost-forecast@1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/cost-forecast-version.test.ts
```

Expected: FAIL — module `./cost-forecast-version.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts`:

```ts
// SP10A — pinned version constant for per-asset cost-forecast forensics.
// 13th pinned constant in the PCD slice. Caller cannot override; pinned by
// stamp-pcd-cost-forecast.ts from import. Bumped independently of
// PCD_PROVENANCE_VERSION so cost-shape evolution is decoupled from
// lineage-shape evolution.
export const PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/cost-forecast-version.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 5: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts packages/creative-pipeline/src/pcd/cost/cost-forecast-version.test.ts
```

Expected: clean. If not, run `pnpm exec prettier --write` on the two files and re-check.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts packages/creative-pipeline/src/pcd/cost/cost-forecast-version.test.ts
git commit -m "feat(pcd): SP10A task 1 — PCD_COST_FORECAST_VERSION constant"
```

---

## Task 2: SP10A zod schemas (`pcd-cost-forecast.ts`)

**Goal:** Land `PcdSp10CostLineItemSchema` and `PcdSp10CostForecastReasonSchema`. Both `.readonly()`. Currency locked to `"USD"` literal.

**Files:**
- Create: `packages/schemas/src/pcd-cost-forecast.ts`
- Test: `packages/schemas/src/__tests__/pcd-cost-forecast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/pcd-cost-forecast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdSp10CostLineItemSchema,
  PcdSp10CostForecastReasonSchema,
} from "../pcd-cost-forecast.js";

describe("PcdSp10CostLineItemSchema", () => {
  it("parses a valid line item", () => {
    const parsed = PcdSp10CostLineItemSchema.parse({
      label: "video-generation",
      estimatedUsd: 0.42,
    });
    expect(parsed.label).toBe("video-generation");
    expect(parsed.estimatedUsd).toBe(0.42);
  });

  it("rejects empty label", () => {
    expect(() =>
      PcdSp10CostLineItemSchema.parse({ label: "", estimatedUsd: 0.42 }),
    ).toThrow();
  });

  it("rejects negative estimatedUsd", () => {
    expect(() =>
      PcdSp10CostLineItemSchema.parse({ label: "x", estimatedUsd: -0.01 }),
    ).toThrow();
  });

  it("accepts zero estimatedUsd", () => {
    expect(() =>
      PcdSp10CostLineItemSchema.parse({ label: "free", estimatedUsd: 0 }),
    ).not.toThrow();
  });
});

describe("PcdSp10CostForecastReasonSchema", () => {
  const valid = {
    estimatedUsd: 1.23,
    currency: "USD" as const,
    lineItems: [{ label: "x", estimatedUsd: 1.23 }],
    costForecastVersion: "pcd-cost-forecast@1.0.0",
    estimatorVersion: "stub-cost-estimator@1.0.0",
    estimatedAt: "2026-04-30T12:00:00.000Z",
  };

  it("parses a valid forecast reason", () => {
    const parsed = PcdSp10CostForecastReasonSchema.parse(valid);
    expect(parsed.currency).toBe("USD");
    expect(parsed.lineItems).toHaveLength(1);
  });

  it("locks currency to literal 'USD'", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, currency: "EUR" }),
    ).toThrow();
  });

  it("rejects empty costForecastVersion", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, costForecastVersion: "" }),
    ).toThrow();
  });

  it("rejects empty estimatorVersion", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatorVersion: "" }),
    ).toThrow();
  });

  it("rejects non-datetime estimatedAt", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatedAt: "not-a-date" }),
    ).toThrow();
  });

  it("rejects negative estimatedUsd", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatedUsd: -0.01 }),
    ).toThrow();
  });

  it("accepts empty lineItems array", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, lineItems: [] }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-cost-forecast.test.ts
```

Expected: FAIL — module `../pcd-cost-forecast.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/pcd-cost-forecast.ts`:

```ts
// PCD slice SP10A — Cost-forecast forensic record. Bridges the injected
// CostEstimator's runtime output to the per-asset PcdIdentitySnapshot's
// new costForecastReason Json column.
//
// Shape: full forensic struct; one record per asset; pinned costForecastVersion
// orthogonal to the runtime estimatorVersion the estimator returned.
import { z } from "zod";

export const PcdSp10CostLineItemSchema = z
  .object({
    label: z.string().min(1),
    estimatedUsd: z.number().nonnegative(),
  })
  .readonly();
export type PcdSp10CostLineItem = z.infer<typeof PcdSp10CostLineItemSchema>;

export const PcdSp10CostForecastReasonSchema = z
  .object({
    estimatedUsd: z.number().nonnegative(),
    currency: z.literal("USD"),
    lineItems: z.array(PcdSp10CostLineItemSchema).readonly(),
    costForecastVersion: z.string().min(1),
    estimatorVersion: z.string().min(1),
    estimatedAt: z.string().datetime(),
  })
  .readonly();
export type PcdSp10CostForecastReason = z.infer<typeof PcdSp10CostForecastReasonSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-cost-forecast.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Format**

```bash
pnpm exec prettier --check packages/schemas/src/pcd-cost-forecast.ts packages/schemas/src/__tests__/pcd-cost-forecast.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-cost-forecast.ts packages/schemas/src/__tests__/pcd-cost-forecast.test.ts
git commit -m "feat(pcd): SP10A task 2 — PcdSp10CostLineItem + PcdSp10CostForecastReason zod schemas"
```

---

## Task 3: Schemas barrel re-export

**Goal:** Make the new schemas reachable via `@creativeagent/schemas`.

**Files:**
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Read current barrel state**

```bash
grep -n "pcd-provenance" packages/schemas/src/index.ts
```

Expected: at least one line re-exporting `./pcd-provenance.js`. SP10A's re-export goes adjacent to it.

- [ ] **Step 2: Add the re-export**

Edit `packages/schemas/src/index.ts`. Locate the line `export * from "./pcd-provenance.js";` and add directly below it:

```ts
export * from "./pcd-cost-forecast.js";
```

- [ ] **Step 3: Verify import resolves through the barrel**

```bash
pnpm --filter @creativeagent/schemas exec vitest run src/__tests__/pcd-cost-forecast.test.ts
pnpm typecheck
```

Expected: PASS + typecheck clean. (The schemas tests already import from `../pcd-cost-forecast.js` directly — the barrel re-export is verified by typecheck and downstream imports in later tasks.)

- [ ] **Step 4: Format**

```bash
pnpm exec prettier --check packages/schemas/src/index.ts
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/index.ts
git commit -m "feat(pcd): SP10A task 3 — re-export pcd-cost-forecast from schemas barrel"
```

---

## Task 4: `CostEstimator` interface

**Goal:** Type-only contract surface. No test (no runtime). Consumed by `StubCostEstimator` (Task 5) which gets the test coverage.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/cost-estimator.ts`

- [ ] **Step 1: Write the file**

Create `packages/creative-pipeline/src/pcd/cost/cost-estimator.ts`:

```ts
// SP10A — Injected per-asset cost estimator contract.
//
// MERGE-BACK: replace with Switchboard cost estimator (ad-optimizer team owns
// the production cost model — FX rates, volume tiers, contract pricing).
//
// Shape rationale:
//   - provider AND model — cost varies by tier (e.g. Sora-1.0 vs Sora-Pro).
//   - shotType / outputIntent — typed as plain string (not enums) so
//     merge-back can plug in any Switchboard provider naming without
//     re-versioning the SP10A contract.
//   - durationSec / tokenCount — optional; the estimator decides how to
//     fold them in (or ignore them).
//   - currency: "USD" — single-currency by design. Multi-currency is a
//     future PCD_COST_FORECAST_VERSION bump.
//   - estimatorVersion — orthogonal to PCD_COST_FORECAST_VERSION; tags the
//     cost MODEL (not the schema). Lets mixed-version analytics work.
export type CostEstimatorInput = {
  provider: string;
  model: string;
  shotType: string;
  outputIntent: string;
  durationSec?: number;
  tokenCount?: number;
};

export type CostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  lineItems: Array<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CostEstimator = {
  estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput>;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/cost-estimator.ts
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/cost-estimator.ts
git commit -m "feat(pcd): SP10A task 4 — CostEstimator injected interface"
```

---

## Task 5: `StubCostEstimator` deterministic implementer

**Goal:** Default test/local estimator. Deterministic synthetic numbers keyed on `(provider, model, shotType, outputIntent)`. Returns `STUB_COST_ESTIMATOR_VERSION` literally so test assertions can assert version carry.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts`
- Test: `packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  StubCostEstimator,
  STUB_COST_ESTIMATOR_VERSION,
} from "./stub-cost-estimator.js";

describe("StubCostEstimator", () => {
  const estimator = new StubCostEstimator();

  it("returns the literal STUB_COST_ESTIMATOR_VERSION as estimatorVersion", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.estimatorVersion).toBe(STUB_COST_ESTIMATOR_VERSION);
  });

  it("returns currency 'USD'", async () => {
    const result = await estimator.estimate({
      provider: "veo",
      model: "veo-2.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.currency).toBe("USD");
  });

  it("is deterministic — same input returns same output", async () => {
    const input = {
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 15,
    };
    const a = await estimator.estimate(input);
    const b = await estimator.estimate(input);
    expect(a).toEqual(b);
  });

  it("returns nonnegative estimatedUsd", async () => {
    const result = await estimator.estimate({
      provider: "x",
      model: "y",
      shotType: "z",
      outputIntent: "w",
    });
    expect(result.estimatedUsd).toBeGreaterThanOrEqual(0);
  });

  it("returns nonempty lineItems with label + estimatedUsd shape", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
    for (const item of result.lineItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.estimatedUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("estimatedUsd is the sum of lineItems.estimatedUsd (within float tolerance)", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 30,
      tokenCount: 1000,
    });
    const sum = result.lineItems.reduce((acc, it) => acc + it.estimatedUsd, 0);
    expect(Math.abs(result.estimatedUsd - sum)).toBeLessThan(0.0001);
  });

  it("durationSec scales the estimate linearly above the base", async () => {
    const base = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 1,
    });
    const longer = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 10,
    });
    expect(longer.estimatedUsd).toBeGreaterThan(base.estimatedUsd);
  });

  it("falls back to a default for unknown provider×model combinations", async () => {
    const result = await estimator.estimate({
      provider: "unknown-vendor",
      model: "unknown-model",
      shotType: "x",
      outputIntent: "y",
    });
    expect(result.estimatedUsd).toBeGreaterThan(0);
    expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/stub-cost-estimator.test.ts
```

Expected: FAIL — module `./stub-cost-estimator.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts`:

```ts
import type {
  CostEstimator,
  CostEstimatorInput,
  CostEstimatorOutput,
} from "./cost-estimator.js";

// MERGE-BACK: real Switchboard cost estimator replaces this in production.
// Stub is deterministic for tests + local development. DO NOT add config
// flags or environment-driven fan-in — the swap is by injection, not by
// feature flag (matches SP8 AutoApproveAllScriptsGate precedent).
export const STUB_COST_ESTIMATOR_VERSION = "stub-cost-estimator@1.0.0";

// Per-provider×model base price (USD). Numbers are synthetic — not based on
// real billing. Picked to give visible spread for tests so determinism + scaling
// assertions can verify shape, not absolute correctness.
const PROVIDER_MODEL_BASE_USD: Record<string, number> = {
  "sora|sora-1.0": 0.4,
  "sora|sora-pro": 0.9,
  "veo|veo-2.0": 0.3,
  "runway|gen-3": 0.5,
  "kling|kling-1.6": 0.25,
  "heygen|avatar-3": 0.6,
};

const DEFAULT_BASE_USD = 0.5;
const PER_SECOND_USD = 0.05;
const PER_THOUSAND_TOKENS_USD = 0.02;

export class StubCostEstimator implements CostEstimator {
  async estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput> {
    const key = `${input.provider}|${input.model}`;
    const base = PROVIDER_MODEL_BASE_USD[key] ?? DEFAULT_BASE_USD;
    const durationCharge =
      input.durationSec !== undefined ? input.durationSec * PER_SECOND_USD : 0;
    const tokenCharge =
      input.tokenCount !== undefined
        ? (input.tokenCount / 1000) * PER_THOUSAND_TOKENS_USD
        : 0;

    const lineItems: Array<{ label: string; estimatedUsd: number }> = [
      { label: `${input.provider}-${input.model}-base`, estimatedUsd: base },
    ];
    if (durationCharge > 0) {
      lineItems.push({ label: "duration-seconds", estimatedUsd: durationCharge });
    }
    if (tokenCharge > 0) {
      lineItems.push({ label: "token-thousands", estimatedUsd: tokenCharge });
    }

    const estimatedUsd = lineItems.reduce((acc, it) => acc + it.estimatedUsd, 0);

    return {
      estimatedUsd,
      currency: "USD",
      lineItems,
      estimatorVersion: STUB_COST_ESTIMATOR_VERSION,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/stub-cost-estimator.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.test.ts
git commit -m "feat(pcd): SP10A task 5 — StubCostEstimator deterministic test/local default"
```

---

## Task 6: `stampPcdCostForecast` pure stamper

**Goal:** Pure store-injected function that calls the injected `CostEstimator`, pins `PCD_COST_FORECAST_VERSION` from import, defense-in-depth zod-parses input + output, returns a `PcdSp10CostForecastReason` for the orchestrator's persistence path.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts`
- Test: `packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { StubCostEstimator, STUB_COST_ESTIMATOR_VERSION } from "./stub-cost-estimator.js";
import { stampPcdCostForecast } from "./stamp-pcd-cost-forecast.js";
import type { CostEstimator } from "./cost-estimator.js";

const validInput = {
  provider: "sora",
  model: "sora-1.0",
  shotType: "live_action_video",
  outputIntent: "meta_creative",
  durationSec: 15,
};

describe("stampPcdCostForecast", () => {
  it("calls the injected estimator with the provided input", async () => {
    const estimator: CostEstimator = {
      estimate: vi.fn(async () => ({
        estimatedUsd: 1.0,
        currency: "USD" as const,
        lineItems: [{ label: "x", estimatedUsd: 1.0 }],
        estimatorVersion: "test@1.0.0",
      })),
    };
    await stampPcdCostForecast(validInput, { costEstimator: estimator });
    expect(estimator.estimate).toHaveBeenCalledWith(validInput);
  });

  it("pins PCD_COST_FORECAST_VERSION from import (not from estimator)", async () => {
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(result.costForecastVersion).toBe("pcd-cost-forecast@1.0.0");
  });

  it("carries the estimator's runtime estimatorVersion verbatim", async () => {
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(result.estimatorVersion).toBe(STUB_COST_ESTIMATOR_VERSION);
  });

  it("stamps estimatedAt from injected clock", async () => {
    const fixedDate = new Date("2026-04-30T12:00:00.000Z");
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
      clock: () => fixedDate,
    });
    expect(result.estimatedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("falls back to current Date when no clock provided", async () => {
    const before = Date.now();
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    const stampedAt = new Date(result.estimatedAt).getTime();
    const after = Date.now();
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);
  });

  it("returns a payload that round-trips through PcdSp10CostForecastReasonSchema", async () => {
    const { PcdSp10CostForecastReasonSchema } = await import(
      "@creativeagent/schemas"
    );
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(() => PcdSp10CostForecastReasonSchema.parse(result)).not.toThrow();
  });

  it("rejects empty provider via input zod parse", async () => {
    await expect(
      stampPcdCostForecast(
        { ...validInput, provider: "" },
        { costEstimator: new StubCostEstimator() },
      ),
    ).rejects.toThrow();
  });

  it("rejects empty model via input zod parse", async () => {
    await expect(
      stampPcdCostForecast(
        { ...validInput, model: "" },
        { costEstimator: new StubCostEstimator() },
      ),
    ).rejects.toThrow();
  });

  it("propagates estimator errors raw", async () => {
    const estimator: CostEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator crashed");
      }),
    };
    await expect(
      stampPcdCostForecast(validInput, { costEstimator: estimator }),
    ).rejects.toThrow("estimator crashed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/stamp-pcd-cost-forecast.test.ts
```

Expected: FAIL — module `./stamp-pcd-cost-forecast.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts`:

```ts
import { z } from "zod";
import {
  type PcdSp10CostForecastReason,
  PcdSp10CostForecastReasonSchema,
} from "@creativeagent/schemas";
import type { CostEstimator, CostEstimatorInput } from "./cost-estimator.js";
import { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";

/**
 * SP10A — Pure store-injected stamper. Calls the injected CostEstimator
 * once per asset, pins PCD_COST_FORECAST_VERSION from import (composer-only
 * pinning lock), and returns the forensic record for the SP10A orchestrator's
 * persistence path.
 *
 * FORECAST-ONLY: this function does NOT mutate selection, prune branches,
 * or compare estimatedUsd against any threshold. sp10a-anti-patterns.test.ts
 * enforces structurally. Budget enforcement is SP10B's domain.
 */
export type StampPcdCostForecastInput = CostEstimatorInput;

export type StampPcdCostForecastStores = {
  costEstimator: CostEstimator;
  clock?: () => Date;
};

const StampPcdCostForecastInputSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  shotType: z.string().min(1),
  outputIntent: z.string().min(1),
  durationSec: z.number().nonnegative().optional(),
  tokenCount: z.number().nonnegative().optional(),
});

export async function stampPcdCostForecast(
  input: StampPcdCostForecastInput,
  stores: StampPcdCostForecastStores,
): Promise<PcdSp10CostForecastReason> {
  // Step 1 — defense-in-depth zod parse on the input.
  StampPcdCostForecastInputSchema.parse(input);

  // Step 2 — call injected estimator. Errors propagate raw.
  const estimate = await stores.costEstimator.estimate(input);

  // MERGE-BACK: emit WorkTrace here (estimator returned)

  // Step 3 — assemble forensic record. costForecastVersion is pinned from
  // import (SP10A composer-only pinning lock). estimatorVersion is carried
  // from the estimator's return (orthogonal — see cost-estimator.ts comment).
  // estimatedAt from clock() at call time.
  const estimatedAt = (stores.clock?.() ?? new Date()).toISOString();
  const reason: PcdSp10CostForecastReason = {
    estimatedUsd: estimate.estimatedUsd,
    currency: estimate.currency,
    lineItems: estimate.lineItems,
    costForecastVersion: PCD_COST_FORECAST_VERSION,
    estimatorVersion: estimate.estimatorVersion,
    estimatedAt,
  };

  // Step 4 — defense-in-depth zod parse on the assembled record.
  // Catches malformed estimator output before persistence.
  PcdSp10CostForecastReasonSchema.parse(reason);

  // MERGE-BACK: emit WorkTrace here (cost forecast assembled)

  return reason;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/stamp-pcd-cost-forecast.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.test.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.test.ts
git commit -m "feat(pcd): SP10A task 6 — stampPcdCostForecast pure store-injected stamper"
```

---

## Task 7: `PcdSp10IdentitySnapshotStore` contract type

**Goal:** Type-only store contract, mirrors SP9's `PcdSp9IdentitySnapshotStore` shape but extends with cost. Imported only by the SP10A orchestrator (Task 10).

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts`

- [ ] **Step 1: Write the file**

Create `packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts`:

```ts
import type {
  PcdIdentitySnapshot,
  PcdSp9ProvenancePayload,
  PcdSp10CostForecastReason,
} from "@creativeagent/schemas";
import type { PcdIdentitySnapshotStoreInput } from "../pcd-identity-snapshot-writer.js";

/**
 * SP10A — additive store contract. Imported only by the SP10A orchestrator
 * (write-pcd-identity-snapshot-with-cost-forecast.ts) and implemented by the
 * Prisma adapter at packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts.
 *
 * The SP4 contract (PcdIdentitySnapshotStore.createForShot) is preserved
 * verbatim. The SP9 contract (PcdSp9IdentitySnapshotStore.createForShotWithProvenance)
 * is preserved verbatim. This contract widens the persistence shape with the
 * SP10A cost forecast reason. The Prisma adapter implements all three.
 *
 * MERGE-BACK: at merge-back, Switchboard's apps/api wires this store into the
 * production runner's per-asset snapshot path via writePcdIdentitySnapshotWithCostForecast.
 */
export type PcdSp10IdentitySnapshotStore = {
  createForShotWithCostForecast(
    input: PcdIdentitySnapshotStoreInput &
      PcdSp9ProvenancePayload & {
        costForecastReason: PcdSp10CostForecastReason;
      },
  ): Promise<PcdIdentitySnapshot>;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts
git commit -m "feat(pcd): SP10A task 7 — PcdSp10IdentitySnapshotStore contract type"
```

---

## Task 8: Prisma schema widen + migration

**Goal:** Add `costForecastReason Json?` column to `PcdIdentitySnapshot`. Single additive nullable migration. No new index.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:294` (add one line after `lineageDecisionReason       Json?`)
- Create: `packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/migration.sql`

- [ ] **Step 1: Inspect current schema state at the model**

```bash
grep -n "lineageDecisionReason" packages/db/prisma/schema.prisma
```

Expected: hit `lineageDecisionReason       Json?` at line ~294.

- [ ] **Step 2: Edit `schema.prisma`**

Locate the SP9 lineage block in the `PcdIdentitySnapshot` model:

```prisma
  // SP9 — creative-source provenance lineage. All columns nullable for
  // historical compatibility (pre-SP9 rows remain readable). Two indexes
  // (briefId, scriptId) for the leaf-to-root anchor queries operators run.
  briefId                     String?
  trendId                     String?
  motivatorId                 String?
  hookId                      String?
  scriptId                    String?
  lineageDecisionReason       Json?
```

Add the SP10A column directly below `lineageDecisionReason       Json?`:

```prisma
  // SP10A — per-asset cost forecast forensic record. Nullable for historical
  // compatibility (pre-SP10A rows remain readable). No flat numeric column
  // and no new index in SP10A; range queries use Postgres JSON operators.
  // See docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md §0 risk #9.
  costForecastReason          Json?
```

The line goes BEFORE the `createdAt                   DateTime        @default(now())` line and BEFORE any `@@index` lines.

- [ ] **Step 3: Create the migration directory and file**

```bash
mkdir -p packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast
```

Create `packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/migration.sql`:

```sql
-- SP10A — per-asset cost forecast forensic record. Additive nullable column;
-- pre-SP10A rows remain readable. No index — range queries use JSON operators
-- on the Json column. See docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md.

ALTER TABLE "PcdIdentitySnapshot"
ADD COLUMN "costForecastReason" JSONB;
```

- [ ] **Step 4: Generate Prisma client**

```bash
pnpm db:generate
```

Expected: success. The generated client now exposes `costForecastReason` on `PcdIdentitySnapshot`.

- [ ] **Step 5: Apply migration locally (or skip if no local DB)**

If you have a local Postgres at `DATABASE_URL`:

```bash
pnpm db:migrate
```

Expected: applies migration successfully. If no local DB, skip — CI / merge-back applies later. The generated client from Step 4 is what the typecheck depends on.

- [ ] **Step 6: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean. The `db` package's generated types now include `costForecastReason`.

- [ ] **Step 7: Format**

```bash
pnpm exec prettier --check packages/db/prisma/schema.prisma
```

Note: prettier may not have a Prisma plugin; if it does not understand `.prisma` files, it will report no errors and skip them. That's fine.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260430130000_pcd_identity_snapshot_sp10a_cost_forecast/
git commit -m "feat(pcd): SP10A task 8 — costForecastReason Json column + Prisma migration"
```

---

## Task 9: Prisma adapter — `createForShotWithCostForecast` + `adaptPcdSp10IdentitySnapshotStore`

**Goal:** Widen `PrismaPcdIdentitySnapshotStore` with the SP10A method. Ship `adaptPcdSp10IdentitySnapshotStore` adapter. SP4 `create()` and SP9 `createForShotWithProvenance()` bodies preserved byte-equivalent.

**Files:**
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts`

- [ ] **Step 1: Read the existing file**

```bash
cat packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts
```

Note the SP9 pattern: `CreatePcdIdentitySnapshotWithProvenanceInput extends CreatePcdIdentitySnapshotInput` adds the lineage fields. SP10A extends that further with one cost field.

- [ ] **Step 2: Read the existing test file**

```bash
cat packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts
```

Note the test style: mocked-prisma via `vi.fn()` (NOT real DB integration). The SP9 test mocks `pcdIdentitySnapshot.create` and asserts the data argument. SP10A tests follow the same style.

- [ ] **Step 3: Write the failing test**

Add to `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts` (append at the end of the existing `describe` block; if multiple describe blocks exist, add a new one after them):

```ts
describe("PrismaPcdIdentitySnapshotStore.createForShotWithCostForecast (SP10A)", () => {
  function makeMockPrisma() {
    return {
      pcdIdentitySnapshot: {
        create: vi.fn(async (args: unknown) => ({ id: "snap_1", ...((args as { data: object }).data) })),
      },
    };
  }

  const baseInput = {
    assetRecordId: "asset_1",
    productIdentityId: "prod_1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: [] as string[],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "creator_1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: [] as string[],
    voiceAssetId: null,
    consentRecordId: "consent_1",
    policyVersion: "tier-policy@1.0.0",
    providerCapabilityVersion: "provider-capability@1.0.0",
    selectedProvider: "sora",
    providerModelSnapshot: "sora-1.0",
    seedOrNoSeed: "seed:42",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
    routerVersion: "provider-router@1.0.0",
    routingDecisionReason: null,
    briefId: "brief_1",
    trendId: "trend_1",
    motivatorId: "motivator_1",
    hookId: "hook_1",
    scriptId: "script_1",
    lineageDecisionReason: {
      decidedAt: "2026-04-30T12:00:00.000Z",
      fanoutDecisionId: "fanout_1",
      chainVersion: "preproduction-chain@1.0.0",
      provenanceVersion: "pcd-provenance@1.0.0",
    },
    costForecastReason: {
      estimatedUsd: 1.23,
      currency: "USD" as const,
      lineItems: [{ label: "x", estimatedUsd: 1.23 }],
      costForecastVersion: "pcd-cost-forecast@1.0.0",
      estimatorVersion: "stub-cost-estimator@1.0.0",
      estimatedAt: "2026-04-30T12:00:00.000Z",
    },
  };

  it("persists costForecastReason as the assembled JSON object", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.costForecastReason).toEqual(baseInput.costForecastReason);
  });

  it("persists lineage fields alongside the cost forecast (SP9 + SP10A composed)", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.briefId).toBe("brief_1");
    expect(dataArg.scriptId).toBe("script_1");
    expect(dataArg.lineageDecisionReason).toEqual(baseInput.lineageDecisionReason);
  });

  it("persists null routingDecisionReason as Prisma.JsonNull", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    // Prisma.JsonNull is the symbolic null marker; assertion is structural —
    // the value must NOT be JS null (which would be ambiguous in JSON columns).
    expect(dataArg.routingDecisionReason).not.toBe(null);
  });

  it("preserves legacy create() behavior unchanged (SP4 path)", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    const legacyInput = { ...baseInput };
    // Strip SP9 + SP10A fields to make a SP4-shaped input
    delete (legacyInput as Record<string, unknown>).briefId;
    delete (legacyInput as Record<string, unknown>).trendId;
    delete (legacyInput as Record<string, unknown>).motivatorId;
    delete (legacyInput as Record<string, unknown>).hookId;
    delete (legacyInput as Record<string, unknown>).scriptId;
    delete (legacyInput as Record<string, unknown>).lineageDecisionReason;
    delete (legacyInput as Record<string, unknown>).costForecastReason;
    await store.create(legacyInput as never);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.costForecastReason).toBeUndefined();
    expect(dataArg.lineageDecisionReason).toBeUndefined();
  });
});

describe("adaptPcdSp10IdentitySnapshotStore", () => {
  it("forwards createForShotWithCostForecast to the Prisma store", async () => {
    const prisma = {
      pcdIdentitySnapshot: {
        create: vi.fn(async () => ({ id: "snap_1" })),
      },
    };
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    const adapter = adaptPcdSp10IdentitySnapshotStore(store);
    expect(typeof adapter.createForShotWithCostForecast).toBe("function");
    // Smoke call to ensure the forward delegates without throwing.
    const baseInput = {
      assetRecordId: "asset_1",
      productIdentityId: "prod_1",
      productTierAtGeneration: 2 as const,
      productImageAssetIds: [] as string[],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 2 as const,
      avatarReferenceAssetIds: [] as string[],
      voiceAssetId: null,
      consentRecordId: "consent_1",
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "sora",
      providerModelSnapshot: "sora-1.0",
      seedOrNoSeed: "seed:42",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      briefId: "brief_1",
      trendId: "trend_1",
      motivatorId: "motivator_1",
      hookId: "hook_1",
      scriptId: "script_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fanout_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
      costForecastReason: {
        estimatedUsd: 1.23,
        currency: "USD" as const,
        lineItems: [{ label: "x", estimatedUsd: 1.23 }],
        costForecastVersion: "pcd-cost-forecast@1.0.0",
        estimatorVersion: "stub-cost-estimator@1.0.0",
        estimatedAt: "2026-04-30T12:00:00.000Z",
      },
    };
    await adapter.createForShotWithCostForecast(baseInput);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
  });
});
```

If the existing test file does not import `adaptPcdSp10IdentitySnapshotStore` yet, add it to the existing import line at the top of the file. The existing top imports `PrismaPcdIdentitySnapshotStore` and the existing SP9 adapter; widen to include `adaptPcdSp10IdentitySnapshotStore`:

```ts
import {
  PrismaPcdIdentitySnapshotStore,
  adaptPcdIdentitySnapshotStore,
  adaptPcdSp9IdentitySnapshotStore,
  adaptPcdSp10IdentitySnapshotStore,
} from "../prisma-pcd-identity-snapshot-store.js";
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/db exec vitest run src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts
```

Expected: FAIL — `adaptPcdSp10IdentitySnapshotStore` not exported, OR `createForShotWithCostForecast` not a method on `PrismaPcdIdentitySnapshotStore`.

- [ ] **Step 5: Widen `prisma-pcd-identity-snapshot-store.ts`**

Edit `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`. Top imports widen:

```ts
import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
  PcdRoutingDecisionReason,
  PcdSp10CostForecastReason,
} from "@creativeagent/schemas";
```

After the existing `CreatePcdIdentitySnapshotWithProvenanceInput` interface, add the SP10A input interface:

```ts
// SP10A — wider input. Same shape as SP9's input, plus the cost forecast
// reason. Used only by createForShotWithCostForecast.
export interface CreatePcdIdentitySnapshotWithCostForecastInput
  extends CreatePcdIdentitySnapshotWithProvenanceInput {
  costForecastReason: PcdSp10CostForecastReason;
}
```

Inside the `PrismaPcdIdentitySnapshotStore` class, after `createForShotWithProvenance()`, add:

```ts
  // SP10A — additive persistence path. Writes the SP9 25-field shape PLUS
  // the SP10A cost forecast reason. Legacy create() and SP9
  // createForShotWithProvenance() are preserved unchanged.
  async createForShotWithCostForecast(
    input: CreatePcdIdentitySnapshotWithCostForecastInput,
  ): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, lineageDecisionReason, costForecastReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
        lineageDecisionReason: lineageDecisionReason as unknown as object,
        costForecastReason: costForecastReason as unknown as object,
      },
    }) as unknown as PcdIdentitySnapshot;
  }
```

After the existing `adaptPcdSp9IdentitySnapshotStore` block, add:

```ts
// SP10A adapter — bridges the SP10A orchestrator's PcdSp10IdentitySnapshotStore
// contract to the Prisma createForShotWithCostForecast() method. Production
// wiring at merge-back consumes this adapter from the apps/api layer.
export type PcdSp10IdentitySnapshotStoreAdapter = {
  createForShotWithCostForecast(
    input: CreatePcdIdentitySnapshotWithCostForecastInput,
  ): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdSp10IdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdSp10IdentitySnapshotStoreAdapter {
  return {
    createForShotWithCostForecast: (input) => store.createForShotWithCostForecast(input),
  };
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/db exec vitest run src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts
```

Expected: PASS — all existing SP4 + SP9 tests still pass + 5 new SP10A tests pass.

- [ ] **Step 7: Format**

```bash
pnpm exec prettier --check packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts
git commit -m "feat(pcd): SP10A task 9 — Prisma createForShotWithCostForecast + adapter"
```

---

## Task 10: `writePcdIdentitySnapshotWithCostForecast` orchestrator

**Goal:** New top-level orchestrator. Composes SP9's `stampPcdProvenance` (pure call), SP10A's `stampPcdCostForecast`, runs SP4 invariant assertion + Zod parse + version-pin path. 3-way lock-step with SP4 + SP9.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts`
- Test: `packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts`

**Reference (do NOT edit):** `packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts`. SP10A orchestrator structurally parallels it — same imports, same six-arg `assertTier3RoutingDecisionCompliant` shape, same allowlist `PcdSp4IdentitySnapshotInputSchema.parse` field set. Read the SP9 orchestrator before writing the SP10A orchestrator.

- [ ] **Step 1: Read the SP9 orchestrator**

```bash
cat packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts
```

Note: the SP9 orchestrator (a) imports the four version constants directly, (b) calls `stampPcdProvenance` first, (c) asserts Tier 3 second, (d) zod-parses the SP4 subset third, (e) assembles the payload pinning the four versions, (f) calls the SP9 store. SP10A mirrors structurally.

- [ ] **Step 2: Write the failing test**

Create `packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  PcdPreproductionChainResultSchema,
  type PcdPreproductionChainResult,
  type PcdIdentitySnapshot,
} from "@creativeagent/schemas";
import { writePcdIdentitySnapshotWithCostForecast } from "./write-pcd-identity-snapshot-with-cost-forecast.js";
import { StubCostEstimator } from "./stub-cost-estimator.js";
import type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";

// Build a minimal valid chain result — enough for the lineage walk to succeed.
function makeChainResult(): PcdPreproductionChainResult {
  return {
    decision: {
      briefId: "brief_1",
      creatorIdentityId: "creator_1",
      productIdentityId: "prod_1",
      consentRecordId: "consent_1",
      effectiveTier: 2,
      selectedScriptIds: ["script_1"],
      availableScriptIds: ["script_1"],
      preproductionChainVersion: "preproduction-chain@1.0.0",
      identityContextVersion: "identity-context@1.0.0",
      approvalLifecycleVersion: "pcd-approval-lifecycle@1.0.0",
      preproductionFanoutVersion: "preproduction-fanout@1.0.0",
      decidedAt: "2026-04-30T12:00:00.000Z",
      decidedBy: "operator_1",
      decisionNote: null,
      costForecast: null,
    },
    stageOutputs: {
      trends: { signals: [{ id: "trend_1", summary: "s", audienceFit: "a", evidenceRefs: [] }] },
      motivators: {
        motivators: [
          {
            id: "motivator_1",
            frictionOrDesire: "f",
            audienceSegment: "a",
            evidenceRefs: [],
            parentTrendId: "trend_1",
          },
        ],
      },
      hooks: {
        hooks: [
          {
            id: "hook_1",
            text: "t",
            hookType: "direct_camera",
            parentMotivatorId: "motivator_1",
            parentTrendId: "trend_1",
          },
        ],
      },
      scripts: {
        scripts: [
          {
            id: "script_1",
            scriptStyle: "spoken_lines",
            spokenLines: ["line"],
            hookText: "h",
            creatorAngle: "a",
            visualBeats: [],
            productMoment: "p",
            cta: "c",
            complianceNotes: [],
            identityConstraints: {
              creatorIdentityId: "creator_1",
              productIdentityId: "prod_1",
              voiceId: null,
            },
            parentHookId: "hook_1",
          },
        ],
      },
    },
  };
}

function makeBaseInput() {
  const chainResult = PcdPreproductionChainResultSchema.parse(makeChainResult());
  return {
    snapshot: {
      assetRecordId: "asset_1",
      productIdentityId: "prod_1",
      productTierAtGeneration: 2 as const,
      productImageAssetIds: [] as string[],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 2 as const,
      avatarReferenceAssetIds: [] as string[],
      voiceAssetId: null,
      consentRecordId: "consent_1",
      effectiveTier: 2 as const,
      shotType: "live_action_video" as const,
      outputIntent: "meta_creative" as const,
      selectedProvider: "sora",
      providerModelSnapshot: "sora-1.0",
      seedOrNoSeed: "seed:42",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      // SP4 Tier 3 invariant inputs — make them pass for tier 2 (no Tier 3 rules apply).
      selectedCapability: { firstLastFrameSupported: false, performanceTransferSupported: false },
      editOverRegenerateRequired: false,
      routingDecisionReason: { tier3RulesApplied: [] },
    },
    provenance: {
      briefId: "brief_1",
      creatorIdentityId: "creator_1",
      scriptId: "script_1",
      chainResult,
      fanoutDecisionId: "fanout_1",
    },
    costForecast: {
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 15,
    },
  };
}

function makeStores(overrides: Partial<{
  store: PcdSp10IdentitySnapshotStore;
  consentRevoked: boolean;
}> = {}) {
  const persistedSnapshot: PcdIdentitySnapshot = { id: "snap_1" } as PcdIdentitySnapshot;
  const defaultStore: PcdSp10IdentitySnapshotStore = {
    createForShotWithCostForecast: vi.fn(async () => persistedSnapshot),
  };
  return {
    pcdSp10IdentitySnapshotStore: overrides.store ?? defaultStore,
    creatorIdentityReader: {
      findById: vi.fn(async () => ({
        id: "creator_1",
        consentRecordId: "consent_1",
      })),
    },
    consentRecordReader: {
      findById: vi.fn(async () => ({
        id: "consent_1",
        revoked: overrides.consentRevoked ?? false,
        revocable: true,
        revokedAt: null,
        expiresAt: null,
      })),
    },
    costEstimator: new StubCostEstimator(),
    clock: () => new Date("2026-04-30T12:00:00.000Z"),
  };
}

describe("writePcdIdentitySnapshotWithCostForecast", () => {
  it("persists a snapshot when consent is valid (happy path)", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    const result = await writePcdIdentitySnapshotWithCostForecast(input, stores);
    expect(result).toBeDefined();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(
      1,
    );
  });

  it("calls the SP9 stamper before the cost stamper", async () => {
    const stores = makeStores();
    const calls: string[] = [];
    stores.consentRecordReader.findById = vi.fn(async (id: string) => {
      calls.push(`consent:${id}`);
      return {
        id: "consent_1",
        revoked: false,
        revocable: true,
        revokedAt: null,
        expiresAt: null,
      };
    });
    const baseEstimator = new StubCostEstimator();
    stores.costEstimator = {
      estimate: vi.fn(async (i) => {
        calls.push("estimator");
        return baseEstimator.estimate(i);
      }),
    };
    await writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores);
    // Consent check (inside SP9 stamper) must run before estimator call (SP10A stamper).
    const consentIdx = calls.findIndex((c) => c.startsWith("consent:"));
    const estimatorIdx = calls.indexOf("estimator");
    expect(consentIdx).toBeGreaterThanOrEqual(0);
    expect(estimatorIdx).toBeGreaterThan(consentIdx);
  });

  it("does NOT call the cost estimator when consent is revoked", async () => {
    const stores = makeStores({ consentRevoked: true });
    const baseEstimator = new StubCostEstimator();
    const estimateSpy = vi.fn(async (i) => baseEstimator.estimate(i));
    stores.costEstimator = { estimate: estimateSpy };
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("does NOT call the store when consent is revoked", async () => {
    const stores = makeStores({ consentRevoked: true });
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
  });

  it("persists a 27-field row with both lineage AND cost stamped", async () => {
    const stores = makeStores();
    await writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores);
    const dataArg = (
      stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    // SP4 base
    expect(dataArg.assetRecordId).toBe("asset_1");
    expect(dataArg.policyVersion).toBe("tier-policy@1.0.0");
    // SP9 lineage
    expect(dataArg.briefId).toBe("brief_1");
    expect(dataArg.scriptId).toBe("script_1");
    expect(dataArg.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
    // SP10A cost
    expect(dataArg.costForecastReason.costForecastVersion).toBe("pcd-cost-forecast@1.0.0");
    expect(dataArg.costForecastReason.estimatorVersion).toBe("stub-cost-estimator@1.0.0");
  });

  it("propagates ZodError on bad provenance input", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    (input.provenance as Record<string, unknown>).briefId = ""; // invalid
    await expect(
      writePcdIdentitySnapshotWithCostForecast(input, stores),
    ).rejects.toThrow();
  });

  it("propagates ZodError on bad cost-forecast input", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    (input.costForecast as Record<string, unknown>).provider = ""; // invalid
    await expect(
      writePcdIdentitySnapshotWithCostForecast(input, stores),
    ).rejects.toThrow();
  });

  it("propagates estimator errors raw", async () => {
    const stores = makeStores();
    stores.costEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator down");
      }),
    };
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow("estimator down");
  });

  it("does NOT call the store when estimator throws", async () => {
    const stores = makeStores();
    stores.costEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator down");
      }),
    };
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts
```

Expected: FAIL — module `./write-pcd-identity-snapshot-with-cost-forecast.js` not found.

- [ ] **Step 4: Write the implementation**

Create `packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts`:

```ts
import {
  type PcdIdentitySnapshot,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "../tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "../provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "../provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "../tier3-routing-rules.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import {
  stampPcdProvenance,
  type StampPcdProvenanceInput,
  type StampPcdProvenanceStores,
} from "../provenance/stamp-pcd-provenance.js";
import {
  stampPcdCostForecast,
  type StampPcdCostForecastInput,
  type StampPcdCostForecastStores,
} from "./stamp-pcd-cost-forecast.js";
import type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";

/**
 * SP10A — Production callsite that bridges SP9's lineage stamp with the
 * SP10A cost-forecast stamp. Composes SP9's pure stamper (which itself does
 * the consent re-check), composes SP10A's pure stamper, runs the SP4 invariant
 * path (3-way lock-step with SP4 + SP9), then persists a 27-field row.
 *
 * The SP4 writer body and the SP9 orchestrator body are preserved verbatim.
 * SP10A is the NEW callsite; merge-back-time production runner is required
 * to call this one when cost observability is desired (and at merge-back, all
 * production callsites should call this one).
 *
 * MERGE-BACK: pick fanoutDecisionId convention (Inngest event id vs synth hash).
 * MERGE-BACK: cost estimator injection — Switchboard ad-optimizer team owns
 *             the production CostEstimator implementer.
 */

export type WritePcdIdentitySnapshotWithCostForecastInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  costForecast: StampPcdCostForecastInput;
};

export type WritePcdIdentitySnapshotWithCostForecastStores = {
  pcdSp10IdentitySnapshotStore: PcdSp10IdentitySnapshotStore;
} & StampPcdProvenanceStores &
  StampPcdCostForecastStores;

export async function writePcdIdentitySnapshotWithCostForecast(
  input: WritePcdIdentitySnapshotWithCostForecastInput,
  stores: WritePcdIdentitySnapshotWithCostForecastStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance via SP9 pure compose. SP9 stamper does:
  //   (a) lineage walk (script→hook→motivator→trend→brief)
  //   (b) consent re-check via SP6 assertConsentNotRevokedForGeneration
  //   (c) payload assembly with PCD_PREPRODUCTION_CHAIN_VERSION + PCD_PROVENANCE_VERSION
  // Throws ConsentRevokedRefusalError / InvariantViolationError / ZodError.
  // All propagated raw; cost estimator NOT called on failure.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — Stamp cost forecast via SP10A pure compose. Calls injected
  // CostEstimator; pins PCD_COST_FORECAST_VERSION; defense-in-depth zod-parses
  // input + output. Estimator NOT called if Step 1 threw.
  // Throws ZodError or estimator errors. All propagated raw.
  const costForecastReason = await stampPcdCostForecast(input.costForecast, {
    costEstimator: stores.costEstimator,
    clock: stores.clock,
  });

  // Step 3 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError.
  // Store is never called if this throws. Six-argument call shape
  // structurally identical to SP4 writer + SP9 orchestrator
  // (sp10a-anti-patterns.test.ts enforces).
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 4 — Defense-in-depth Zod parse on the SP4 input subset. Mirrors
  // SP4 writer + SP9 orchestrator allowlist forwarding. Throws ZodError.
  const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
    assetRecordId: input.snapshot.assetRecordId,
    productIdentityId: input.snapshot.productIdentityId,
    productTierAtGeneration: input.snapshot.productTierAtGeneration,
    productImageAssetIds: input.snapshot.productImageAssetIds,
    productCanonicalTextHash: input.snapshot.productCanonicalTextHash,
    productLogoAssetId: input.snapshot.productLogoAssetId,
    creatorIdentityId: input.snapshot.creatorIdentityId,
    avatarTierAtGeneration: input.snapshot.avatarTierAtGeneration,
    avatarReferenceAssetIds: input.snapshot.avatarReferenceAssetIds,
    voiceAssetId: input.snapshot.voiceAssetId,
    consentRecordId: input.snapshot.consentRecordId,
    selectedProvider: input.snapshot.selectedProvider,
    providerModelSnapshot: input.snapshot.providerModelSnapshot,
    seedOrNoSeed: input.snapshot.seedOrNoSeed,
    rewrittenPromptText: input.snapshot.rewrittenPromptText,
    shotSpecVersion: input.snapshot.shotSpecVersion,
    routerVersion: input.snapshot.routerVersion,
    routingDecisionReason: input.snapshot.routingDecisionReason,
  });

  // Step 5 — Pin version constants from imports + carry shotSpecVersion (SP3 stamp).
  // Same four imports as SP4 + SP9. PCD_COST_FORECAST_VERSION is NOT imported here —
  // it lives inside the SP10A stamper and is carried via costForecastReason.
  // (Composer-only version pinning lock — sp10a-anti-patterns.test.ts enforces.)
  const payload = {
    assetRecordId: parsed.assetRecordId,
    productIdentityId: parsed.productIdentityId,
    productTierAtGeneration: parsed.productTierAtGeneration,
    productImageAssetIds: parsed.productImageAssetIds,
    productCanonicalTextHash: parsed.productCanonicalTextHash,
    productLogoAssetId: parsed.productLogoAssetId,
    creatorIdentityId: parsed.creatorIdentityId,
    avatarTierAtGeneration: parsed.avatarTierAtGeneration,
    avatarReferenceAssetIds: parsed.avatarReferenceAssetIds,
    voiceAssetId: parsed.voiceAssetId,
    consentRecordId: parsed.consentRecordId,
    selectedProvider: parsed.selectedProvider,
    providerModelSnapshot: parsed.providerModelSnapshot,
    seedOrNoSeed: parsed.seedOrNoSeed,
    rewrittenPromptText: parsed.rewrittenPromptText,
    policyVersion: PCD_TIER_POLICY_VERSION,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    shotSpecVersion: parsed.shotSpecVersion,
    routingDecisionReason: parsed.routingDecisionReason,
    // SP9 lineage
    briefId: provenance.briefId,
    trendId: provenance.trendId,
    motivatorId: provenance.motivatorId,
    hookId: provenance.hookId,
    scriptId: provenance.scriptId,
    lineageDecisionReason: provenance.lineageDecisionReason,
    // SP10A cost forecast
    costForecastReason,
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 6 — Persist via SP10A store. SP4 store path NOT called.
  return stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast(payload);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts
git commit -m "feat(pcd): SP10A task 10 — writePcdIdentitySnapshotWithCostForecast orchestrator"
```

---

## Task 11: `pcd/cost/index.ts` barrel + creative-pipeline barrel re-export

**Goal:** Wire SP10A surface into the package's public exports.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 1: Write the cost subdir barrel**

Create `packages/creative-pipeline/src/pcd/cost/index.ts`:

```ts
// SP10A — Cost-forecast public surface.
export { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";
export type {
  CostEstimator,
  CostEstimatorInput,
  CostEstimatorOutput,
} from "./cost-estimator.js";
export {
  StubCostEstimator,
  STUB_COST_ESTIMATOR_VERSION,
} from "./stub-cost-estimator.js";
export {
  stampPcdCostForecast,
  type StampPcdCostForecastInput,
  type StampPcdCostForecastStores,
} from "./stamp-pcd-cost-forecast.js";
export {
  writePcdIdentitySnapshotWithCostForecast,
  type WritePcdIdentitySnapshotWithCostForecastInput,
  type WritePcdIdentitySnapshotWithCostForecastStores,
} from "./write-pcd-identity-snapshot-with-cost-forecast.js";
export type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";
```

- [ ] **Step 2: Read current creative-pipeline barrel**

```bash
grep -n "provenance" packages/creative-pipeline/src/index.ts
```

Expected: a line like `export * from "./pcd/provenance/index.js";`. SP10A re-export goes adjacent.

- [ ] **Step 3: Add re-export to creative-pipeline barrel**

Edit `packages/creative-pipeline/src/index.ts`. Locate the SP9 line `export * from "./pcd/provenance/index.js";` and add directly below it:

```ts
export * from "./pcd/cost/index.js";
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/index.ts packages/creative-pipeline/src/index.ts
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/index.ts packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP10A task 11 — pcd/cost/ barrel + creative-pipeline barrel re-export"
```

---

## Task 12: SP10A anti-pattern tests (`sp10a-anti-patterns.test.ts`)

**Goal:** 8 structural grep assertions enforcing the design's locks. Run last so all source files exist.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`

**Reference (do NOT edit):** `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`. SP10A test follows the same structure (file walker, allowlist edits, `git diff` against the SP9 baseline commit).

- [ ] **Step 1: Identify the SP9 baseline commit**

```bash
git log --grep="SP9 — creative-source provenance" --max-count=1 --format=%H
```

Expected: `f30da16` (or whatever the local hash is). The SP10A anti-pattern test diffs against this commit; if the local hash differs, use the local one in the test.

- [ ] **Step 2: Write the test**

Create `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`:

```ts
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COST_DIR = join(import.meta.dirname);
const PCD_DIR = join(COST_DIR, "..");
const PROVENANCE_DIR = join(PCD_DIR, "provenance");

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

const costSources = listSourceFiles(COST_DIR);

describe("SP10A anti-pattern grep", () => {
  it("PCD_COST_FORECAST_VERSION literal lives only in cost-forecast-version.ts (composer-only pinning)", () => {
    const allowed = join(COST_DIR, "cost-forecast-version.ts");
    for (const file of costSources) {
      if (file === allowed) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_COST_FORECAST_VERSION literal`).not.toMatch(
        /"pcd-cost-forecast@/,
      );
    }
    // Sanity — cost-forecast-version.ts itself does contain the literal.
    expect(readFileSync(allowed, "utf8")).toContain('"pcd-cost-forecast@1.0.0"');
  });

  it("orchestrator imports the same four version constants as SP4 writer + SP9 orchestrator (3-way lock-step)", () => {
    const sp4 = readFileSync(join(PCD_DIR, "pcd-identity-snapshot-writer.ts"), "utf8");
    const sp9 = readFileSync(
      join(PROVENANCE_DIR, "write-pcd-identity-snapshot-with-provenance.ts"),
      "utf8",
    );
    const sp10 = readFileSync(
      join(COST_DIR, "write-pcd-identity-snapshot-with-cost-forecast.ts"),
      "utf8",
    );
    for (const constant of [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ]) {
      expect(sp4, `SP4 should reference ${constant}`).toContain(constant);
      expect(sp9, `SP9 orchestrator should reference ${constant}`).toContain(constant);
      expect(sp10, `SP10A orchestrator should reference ${constant}`).toContain(constant);
    }
    // All three orchestrators must call the Tier 3 invariant assertion with
    // the six-argument shape. Drift between SP4 / SP9 / SP10A logic is a
    // structural defect.
    expect(sp4).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp9).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp10).toContain("assertTier3RoutingDecisionCompliant({");
  });

  it("forecast-only invariant — no SP10A source mutates selection arrays", () => {
    for (const file of costSources) {
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

  it("forecast-only invariant — no SP10A source compares estimatedUsd against literals or contains budget-throw classes", () => {
    for (const file of costSources) {
      const src = readFileSync(file, "utf8");
      // Strip line-comments before matching (SP5 codeOnly precedent — comments
      // mentioning the anti-pattern do not themselves trigger).
      const codeOnly = src
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      expect(codeOnly, `${file} contains budget-style throw class`).not.toMatch(
        /throw\s+new\s+\w*(?:Budget|OverLimit|CostExceeded|CostBudget)\w*/i,
      );
      expect(codeOnly, `${file} compares estimatedUsd against a literal`).not.toMatch(
        /estimatedUsd\s*[<>=!]+/,
      );
    }
  });

  it("forbidden imports — SP10A source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of costSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${file} imports @prisma/client`).not.toMatch(
        /from\s+["']@prisma\/client["']/,
      );
      expect(src, `${file} imports inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${file} imports node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${file} imports node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${file} imports crypto`).not.toMatch(/from\s+["']crypto["']/);
    }
  });

  it("single-currency lock — pcd-cost-forecast.ts schema declares currency: z.literal('USD')", () => {
    // Schemas live outside the COST_DIR; read the schemas package file directly.
    const schemaPath = join(
      COST_DIR,
      "..",
      "..",
      "..",
      "..",
      "..",
      "schemas",
      "src",
      "pcd-cost-forecast.ts",
    );
    const src = readFileSync(schemaPath, "utf8");
    expect(src, "schema must lock currency to literal 'USD'").toMatch(
      /currency:\s*z\.literal\(["']USD["']\)/,
    );
  });

  it("estimator contract — cost-estimator.ts declares all five required-shape fields", () => {
    const src = readFileSync(join(COST_DIR, "cost-estimator.ts"), "utf8");
    // Catches accidental field removal in the contract.
    for (const field of ["provider", "model", "shotType", "outputIntent", "estimatorVersion"]) {
      expect(src, `cost-estimator.ts missing required field declaration: ${field}`).toContain(
        field,
      );
    }
  });

  it("SP1–SP9 source bodies are unchanged since the SP9 baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/index.ts",
      "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts",
      "packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts",
      "packages/schemas/src/pcd-cost-forecast.ts",
      "packages/schemas/src/__tests__/pcd-cost-forecast.test.ts",
      "packages/db/prisma/schema.prisma",
    ]);

    let sp9Sha = "";
    try {
      sp9Sha = execSync(
        'git log --grep="SP9 — creative-source provenance" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9.
      return;
    }
    if (sp9Sha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp9Sha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10A net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost/")) continue;
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      if (file.endsWith(".prisma")) continue;
      if (file.startsWith("docs/")) continue;
      if (allowedEdits.has(file)) continue;

      expect(allowedEdits.has(file), `SP10A modified disallowed file: ${file}`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/sp10a-anti-patterns.test.ts
```

Expected: PASS, 8 tests. If any fails, the SP10A source has drifted from a structural lock — investigate and fix the source, NOT the test.

- [ ] **Step 4: Format**

```bash
pnpm exec prettier --check packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
git commit -m "test(pcd): SP10A task 12 — anti-pattern grep tests (8 structural assertions)"
```

---

## Task 13: SWITCHBOARD-CONTEXT.md update + memory update + final verification

**Goal:** Document the SP10A merge-back surface. Update the auto-memory file. Run the full repo gate (typecheck + tests + prettier) and confirm green.

**Files:**
- Modify: `docs/SWITCHBOARD-CONTEXT.md` (add SP10A section after the SP9 section)
- Modify: `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` (add SP10A entry)

- [ ] **Step 1: Read the SP9 SWITCHBOARD-CONTEXT.md section**

```bash
grep -n "### SP9" docs/SWITCHBOARD-CONTEXT.md
```

Expected: at least one `### SP9` heading. SP10A section goes after the entire SP9 section.

- [ ] **Step 2: Append SP10A section to SWITCHBOARD-CONTEXT.md**

Open `docs/SWITCHBOARD-CONTEXT.md` in your editor. Locate the end of the `### SP9 (creative-source provenance) — SHIPPED in creativeagent` section (it ends with the "Architectural seams the merge-back does NOT need to rewrite" bullet list). Add a new section directly after, BEFORE `## Conventions inherited from Switchboard`:

```markdown
### SP10A (cost-forecast wiring) — SHIPPED in creativeagent

**SP10A-declared merge-back surfaces (production wiring at merge-back):**

- `CostEstimator` injection — Switchboard ad-optimizer team owns the production `CostEstimator` implementer. Real estimator reads FX rates, volume tiers, contract pricing. SP10A ships only the contract + a deterministic `StubCostEstimator`. `// MERGE-BACK: replace with Switchboard cost estimator` marker on the stub class declaration.
- `adaptPcdSp10IdentitySnapshotStore(prismaStore)` ships in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` and returns the SP10A contract shape. Wire as:
  ```ts
  writePcdIdentitySnapshotWithCostForecast(input, {
    pcdSp10IdentitySnapshotStore: adaptPcdSp10IdentitySnapshotStore(prismaStore),
    costEstimator: switchboardCostEstimator,
    creatorIdentityReader, consentRecordReader, clock,
  });
  ```
- `WorkTrace` emit — every SP10A state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Two markers in `stamp-pcd-cost-forecast.ts` (after estimator return, after assembly), one in `write-pcd-identity-snapshot-with-cost-forecast.ts` (orchestrator pre-persist).
- Production runner discipline — at merge-back, all production callsites should call `writePcdIdentitySnapshotWithCostForecast` to get cost observability. Legacy SP4 `writePcdIdentitySnapshot` and SP9 `writePcdIdentitySnapshotWithProvenance` callsites remain valid for tests + ad-hoc backfills but write `costForecastReason = null`.
- `fanoutDecisionId` convention — still caller-supplied, inherited from SP9. Same `// MERGE-BACK: pick fanoutDecisionId convention` marker. SP10A does not lock this.
- Gate-time `PcdProductionFanoutDecision.costForecast` stays `null` in SP10A. Slot remains reserved for a future slice with a coarse pre-routing estimator variant.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.costForecastReason` — one new column added by SP10A migration `20260430130000_pcd_identity_snapshot_sp10a_cost_forecast`. If Switchboard `main` has not added an equivalent independently, the SP10A migration applies cleanly. If Switchboard added a same-semantic column with a different name, reconcile by renaming SP10A's column in the migration before merge-back.
- No FK constraints. The cost record is a self-contained Json struct.
- No flat numeric column on `PcdIdentitySnapshot`. Merge-back analytics may add `estimatedUsdCents Int?` + `(scriptId, estimatedUsdCents)` index; deferred per design §0 risk #9.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP10A stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/cost/` changes at merge-back — only the injected estimator + readers swap (Prisma-backed via `adaptPcdSp10IdentitySnapshotStore`, real cost estimator via Switchboard ad-optimizer) and the `// MERGE-BACK:` markers get implementations.
- `PCD_COST_FORECAST_VERSION` is the 13th pinned constant. The PCD slice carries 13 total pinned constants after SP10A.
- SP10A introduces NO circular dependency. `pcd/cost/` imports from `pcd/provenance/` (SP9 stamper, version constant) and from `pcd/` top-level (SP4 invariant, writer types, SP6 reader types). Reverse direction does not exist; `sp10a-anti-patterns.test.ts` enforces the source-freeze.
- The SP9 orchestrator body (`writePcdIdentitySnapshotWithProvenance`) is untouched. SP10A added a parallel orchestrator (`writePcdIdentitySnapshotWithCostForecast`) that COMPOSES SP9's pure stamper (`stampPcdProvenance`) and adds SP10A cost stamping. Anti-pattern test enforces SP4/SP9/SP10A invariant logic stays in 3-way lock-step.
- SP10A is observability-only. Tree-budget enforcement is reserved for SP10B (separate squash, separate version pin `PCD_TREE_BUDGET_VERSION`).
```

- [ ] **Step 3: Update the auto-memory file**

Edit `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. Update:

(a) The frontmatter `description` line — bump the date and slice marker to reflect SP10A:

```yaml
description: Tracks which PCD slices (SP1–SP10A) have shipped on the creativeagent repo and the merge-back-to-Switchboard contract. Updated 2026-04-30 with SP10A merge.
```

(b) Append a new bullet after the SP9 entry, mirroring the SP9 entry's level of detail. Use the local commit SHA of the SP10A squash (replace `<SHA>` with the actual hash from `git log -1 --oneline` after merge):

```markdown
- **SP10A — Cost-forecast wiring:** ✅ Merged 2026-04-30 to `creativeagent` `main` as squash commit `<SHA>` (PR #N). 12 implementation tasks completed via subagent-driven execution. Highlights:
  - First half of SP10. Forecast-only — no abort, no prune, no budget gate. SP10B (tree-budget enforcement) is a separate future slice.
  - **13th pinned constant:** `PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0"`. Composer-only pinning lock holds — only `stamp-pcd-cost-forecast.ts` imports it; anti-pattern test enforces.
  - **Per-asset stamping at provenance-write time only.** `PcdProductionFanoutDecision.costForecast` stays `null` in SP10A — gate-time forecast deferred (gate predates provider routing under the locked Q2 contract).
  - **Injected `CostEstimator` interface** with `provider/model/shotType/outputIntent` + optional `durationSec/tokenCount`. `StubCostEstimator` is deterministic for tests + local default; real estimator at merge-back (Switchboard ad-optimizer team).
  - **No edits to SP1–SP9 source bodies.** Orchestrator (`writePcdIdentitySnapshotWithCostForecast`) COMPOSES SP9's `stampPcdProvenance` (pure call, no source edit). 3-way invariant lock-step with SP4 + SP9 enforced via anti-pattern test.
  - **Additive Prisma migration** `20260430130000_pcd_identity_snapshot_sp10a_cost_forecast`: 1 nullable Json column (`costForecastReason`). No backfill; pre-SP10A rows remain null forever. No new index — analytics flattening (estimatedUsdCents Int? + index) deferred to merge-back.
  - **Subdir layout:** `packages/creative-pipeline/src/pcd/cost/` (sibling to `pcd/preproduction/` and `pcd/provenance/`). 7 source files (cost-forecast-version, cost-estimator, stub-cost-estimator, stamp, store contract, orchestrator, barrel) + 1 anti-pattern test + 4 co-located test files + 1 schemas file (pcd-cost-forecast.ts).
  - **Single-currency lock:** `currency: z.literal("USD")` in schema; anti-pattern test enforces. Multi-currency is a future `PCD_COST_FORECAST_VERSION@2.0.0` bump.
  - **User-accepted risks (recorded in plan §0):** 12 explicit risks including 3-way invariant duplication as SP11+ debt, JSON-only cost queries needing future flat column, estimator-version drift in analytics, no campaign-level forecast preview at gate time, fanoutDecisionId as de-facto cross-asset cost join key.
  - **Final state:** ~1,490+ tests across 3 packages all green; typecheck clean across all 5 packages; prettier clean modulo the 2 SP5-baseline warnings on tier-policy.ts/tier-policy.test.ts (unchanged — now 9 slices deferred).
```

(Note: replace `<SHA>` with the actual squash commit hash and `#N` with the PR number once those exist. If running this task before merge, leave them as placeholders and update post-merge.)

- [ ] **Step 4: Run full repo gate**

```bash
pnpm typecheck
pnpm exec vitest run --no-coverage
```

Expected: typecheck clean across all 5 packages; total test count ~1,490+ (was 1,449 SP9 baseline; SP10A adds ~40–55 net tests).

- [ ] **Step 5: Run prettier on the whole repo**

```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,md}" "docs/**/*.md"
```

Expected: clean modulo the 2 baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` (do NOT fix in SP10A).

- [ ] **Step 6: Sanity-check the SP1–SP9 source freeze manually**

```bash
git diff f30da16 HEAD -- \
  packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts \
  packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts \
  packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts \
  packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts \
  packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts \
  packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts \
  packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts \
  packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts \
  packages/creative-pipeline/src/pcd/provider-capability-matrix.ts \
  packages/creative-pipeline/src/pcd/provider-router.ts
```

Expected: empty output (no diff). If any file shows a diff, an SP1–SP9 source body was accidentally edited — revert before proceeding.

- [ ] **Step 7: Acceptance checklist**

Verify each item:

- [ ] 13 commits on the SP10A branch (one per task) — `git log --oneline sp10a-cost-forecast ^main | wc -l` ≥ 13
- [ ] All 13 tasks above completed
- [ ] Anti-pattern test passes (`pnpm --filter @creativeagent/creative-pipeline exec vitest run src/pcd/cost/sp10a-anti-patterns.test.ts`)
- [ ] Full repo tests pass (~1,490+ tests)
- [ ] Typecheck clean across all 5 packages
- [ ] Prettier clean modulo 2 SP5-baseline warnings
- [ ] No SP1–SP9 source body diffs (Step 6)
- [ ] `PCD_COST_FORECAST_VERSION` = `"pcd-cost-forecast@1.0.0"` (literal exact match)
- [ ] One Prisma migration added; one column added
- [ ] No new index on `PcdIdentitySnapshot`
- [ ] `PcdProductionFanoutDecision.costForecast` schema slot is unchanged (still null in SP10A — verify by `grep "costForecast: PcdCostForecastSchema" packages/schemas/src/pcd-preproduction.ts`)
- [ ] `docs/SWITCHBOARD-CONTEXT.md` has SP10A section
- [ ] Auto-memory file updated with SP10A bullet (post-merge SHA can be filled in later)

- [ ] **Step 8: Format the docs and memory updates**

```bash
pnpm exec prettier --check docs/SWITCHBOARD-CONTEXT.md
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git add ~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md
git commit -m "$(cat <<'EOF'
docs(pcd): SP10A task 13 — merge-back surface + memory update + final verification

Closes the SP10A slice. 13th pinned constant landed
(PCD_COST_FORECAST_VERSION); per-asset cost forecast persisted on
new PcdIdentitySnapshot.costForecastReason Json column; injected
CostEstimator contract; SP9 orchestrator composed without source-body
edit; 3-way SP4/SP9/SP10A invariant lock-step enforced.
Forecast-only — no abort, no prune.

Final state verified: typecheck clean, ~1,490+ tests green,
prettier clean modulo 2 SP5-baseline warnings (now 9 slices deferred).

EOF
)"
```

(If your system stages the auto-memory file with `git add` and that path is outside the repo, omit the second `git add` line — the auto-memory file persists outside git regardless.)

---

## §2. Self-review checklist (run after writing every task above)

Before opening a PR, confirm:

1. **Spec coverage:** Every section of `docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md` §3 (Q1–Q8 locks), §4 (what ships), §5 (data flow), §7 (module layout) maps to a task above.
2. **No placeholders:** Search the plan for "TBD", "TODO", "implement later" — none remain.
3. **Type consistency:** `PcdSp10CostForecastReason` used consistently across schemas, stamper, store contract, Prisma adapter, orchestrator. No drift between e.g. `PcdSp10CostForecastReason` vs `PcdSp10CostForecast`.
4. **Field-name consistency:** `lineItems` (not `breakdown`) everywhere — schema, estimator return, stub, stamper, store, orchestrator.
5. **Version-pin lock:** `PCD_COST_FORECAST_VERSION` imported only by `stamp-pcd-cost-forecast.ts`. No other source file mentions the literal `"pcd-cost-forecast@"`. Anti-pattern test #1 enforces.
6. **3-way lock-step:** SP4 writer + SP9 orchestrator + SP10A orchestrator all import the same four version constants and call `assertTier3RoutingDecisionCompliant({...})` with the same six-argument shape. Anti-pattern test #2 enforces.

---

## §3. PR template (when ready)

```
Title: feat(pcd): SP10 — cost-forecast wiring (SP10A)

## Summary
- Lands per-asset cost-forecast observability on PcdIdentitySnapshot.
- 13th pinned constant: PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0".
- Injected CostEstimator interface; production model lives in Switchboard at merge-back.
- New top-level orchestrator writePcdIdentitySnapshotWithCostForecast composes
  SP9's stampPcdProvenance (pure call — no SP9 source body edit).
- One additive Prisma migration: costForecastReason Json? on PcdIdentitySnapshot.
- Forecast-only: no abort, no prune, no budget gate. SP10B is a separate slice.

## Test plan
- [ ] pnpm typecheck clean across all 5 packages
- [ ] pnpm exec vitest run --no-coverage — ~1,490+ tests pass
- [ ] pnpm exec prettier --check clean modulo 2 SP5-baseline warnings
- [ ] sp10a-anti-patterns.test.ts — 8 structural assertions all pass
- [ ] git diff against SP9 baseline (f30da16) shows no SP1–SP9 source body edits

## Spec
- Design: docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md
- Plan: docs/plans/2026-04-30-pcd-cost-forecast-sp10a-plan.md

## Accepted risks
12 explicit risks documented in design §0. Most load-bearing: 3-way invariant
duplication (SP11+ debt), JSON-only cost queries (future flat column needed),
bare-writer callsite still valid (production runner discipline at merge-back).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## §4. Plan summary

**13 tasks. ~40–55 net new tests. 1 Prisma migration (1 column). 13th pinned constant.**

| Task | Subject | Files touched | Tests added |
|---|---|---|---|
| 1 | `PCD_COST_FORECAST_VERSION` constant | 2 new | 1 |
| 2 | SP10A zod schemas | 2 new | 12 |
| 3 | Schemas barrel re-export | 1 modified | 0 |
| 4 | `CostEstimator` interface | 1 new | 0 (type-only) |
| 5 | `StubCostEstimator` | 2 new | 8 |
| 6 | `stampPcdCostForecast` | 2 new | 9 |
| 7 | `PcdSp10IdentitySnapshotStore` contract | 1 new | 0 (type-only) |
| 8 | Prisma schema widen + migration | 2 new + 1 modified | 0 |
| 9 | Prisma adapter widen | 2 modified | 5 |
| 10 | Orchestrator | 2 new | 9 |
| 11 | Barrels | 2 modified | 0 |
| 12 | Anti-pattern tests | 1 new | 8 |
| 13 | Docs + memory + final verification | 2 modified | 0 |

**Estimated total:** ~52 new tests across 7 new test files + 1 widened existing test file. Within the 40–55 design-doc estimate.
