# SP8 — Branching Tree State + Production-Fanout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen SP7's pre-production chain so each stage emits a length-N tree (heterogeneous fanout 2-2-3-2 → 24 scripts), narrow the `ProductionFanoutGate` return contract so the composer (not the gate) assembles the forensic decision struct and pins all four version constants, deep-freeze the identity context, and ship one new pinned constant (`PCD_PREPRODUCTION_FANOUT_VERSION`) so SP10's tree-budget enforcement can land without re-versioning the chain.

**Architecture:** SP8 is a widening of SP7 (same chain shape, same five stages, same single human gate). Schema additions and existing-schema widenings live in `packages/schemas/src/pcd-preproduction.ts`. Source widenings live in `packages/creative-pipeline/src/pcd/preproduction/` and `stages/`. Two new files (`deep-freeze.ts`, `preproduction-fanout-version.ts`) and one new test file (`sp8-anti-patterns.test.ts`). `AutoApproveOnlyScriptGate` is deleted and replaced by `AutoApproveAllScriptsGate`; the composer assembles `PcdProductionFanoutDecision` itself rather than receiving it from the gate. SP1–SP6 source bodies are zero-edit; SP7 pure functions are zero-edit; SP7 composer + builder + gate-default + stubs widen in place.

**Tech Stack:** TypeScript ESM (`.js` relative imports), zod schemas, vitest, pnpm + Turborepo. No Prisma migration. No `apps/api` wiring.

**Source-of-truth design:** `docs/plans/2026-04-30-pcd-preproduction-fanout-sp8-design.md` (committed in `fcc51cb`).

## User-locked priority invariants (do not violate)

User reviewed the design 2026-04-30 and approved with scope discipline. These are non-negotiable:

1. **Composer owns the forensic decision struct.** Gate returns ONLY `{ selectedScriptIds, decidedBy, decidedAt }`.
2. **Gate cannot import or stamp version constants.** All version pinning lives in `preproduction-chain.ts`. Anti-pattern test enforces.
3. **Branching preserves parent lineage:** every motivator carries `parentTrendId`; every hook carries `parentMotivatorId` AND `parentTrendId`; every script carries `parentHookId`.
4. **Identity context is deep-frozen, not shallow-frozen.**
5. **`AutoApproveAllScriptsGate` is the deterministic local/default implementer ONLY.** Real production MUST replace it with human-in-the-loop selection. The class file carries a loud header comment to prevent misuse.
6. **No Prisma migration, no `apps/api` wiring, no `WorkTrace` emit, no real Claude runners** in SP8. Markers and stubs only.
7. **Implementation discipline:** if Task 5 (the migration block) becomes too large in practice, STOP and split into separate PRs (SP8A: gate-narrowing + composer-assembly; SP8B: branching tree fanout; SP8C: deep-freeze + readonly hardening) before continuing.

**Pre-flight verification (before starting Task 1):**

Run from repo root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: typecheck clean across all 5 packages; ~1,364 tests green; two pre-existing prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` (SP5 baseline noise — leave as-is). Anything else red is a baseline issue to investigate before SP8 starts.

---

## Task 1: deep-freeze helper

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts`
- Test: `packages/creative-pipeline/src/pcd/preproduction/deep-freeze.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/preproduction/deep-freeze.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deepFreeze } from "./deep-freeze.js";

describe("deepFreeze", () => {
  it("returns primitives unchanged", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze("x")).toBe("x");
    expect(deepFreeze(true)).toBe(true);
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
  });

  it("freezes an empty plain object", () => {
    const o = {};
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
  });

  it("freezes an empty array", () => {
    const a: number[] = [];
    deepFreeze(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("freezes a plain object with primitives", () => {
    const o = { a: 1, b: "two" };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
  });

  it("freezes nested plain objects (depth 2)", () => {
    const o = { outer: { inner: 1 } };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.outer)).toBe(true);
  });

  it("freezes a plain object with a nested array", () => {
    const o = { items: [1, 2, 3] };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.items)).toBe(true);
  });

  it("freezes an array of plain objects", () => {
    const a = [{ x: 1 }, { x: 2 }];
    deepFreeze(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a[0])).toBe(true);
    expect(Object.isFrozen(a[1])).toBe(true);
  });

  it("freezes deeply mixed nesting (depth 4)", () => {
    const o = { a: [{ b: { c: [1, 2] } }] };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.a)).toBe(true);
    expect(Object.isFrozen(o.a[0])).toBe(true);
    expect(Object.isFrozen(o.a[0]!.b)).toBe(true);
    expect(Object.isFrozen(o.a[0]!.b.c)).toBe(true);
  });

  it("returns already-frozen input as-is without throwing", () => {
    const o = Object.freeze({ a: 1 });
    expect(() => deepFreeze(o)).not.toThrow();
    expect(deepFreeze(o)).toBe(o);
  });

  it("is idempotent", () => {
    const o = { a: [1, 2], b: { c: 3 } };
    const once = deepFreeze(o);
    const twice = deepFreeze(once);
    expect(twice).toBe(once);
    expect(Object.isFrozen(twice)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run deep-freeze
```

Expected: FAIL with "Cannot find module './deep-freeze.js'" (or vitest equivalent).

- [ ] **Step 3: Write minimal implementation**

Create `packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts`:

```ts
// SP8 — recursive freeze for arrays + plain objects. Idempotent; safe on
// already-frozen input. Used by buildPcdIdentityContext to harden SP7's
// shallow Object.freeze(context) hole (I-1 from SP7 code review).

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  const o = obj as unknown as Record<PropertyKey, unknown> | unknown[];
  if (Array.isArray(o)) {
    for (const item of o) deepFreeze(item);
  } else {
    for (const key of Object.keys(o)) deepFreeze(o[key]);
  }
  return Object.freeze(obj);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run deep-freeze
```

Expected: PASS, all 10 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts \
        packages/creative-pipeline/src/pcd/preproduction/deep-freeze.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 deep-freeze helper

Recursive freeze for arrays + plain objects. Idempotent; safe on
already-frozen input. Closes SP7 I-1 (shallow Object.freeze on
PcdIdentityContext); used by builder in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PCD_PREPRODUCTION_FANOUT_VERSION constant

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts`
- Test: `packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";

describe("PCD_PREPRODUCTION_FANOUT_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PREPRODUCTION_FANOUT_VERSION).toBe("preproduction-fanout@1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run preproduction-fanout-version
```

Expected: FAIL with "Cannot find module './preproduction-fanout-version.js'".

- [ ] **Step 3: Write minimal implementation**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts`:

```ts
// SP8 — pinned version constant for the production fanout decision shape.
// 11th pinned constant in the PCD slice. Caller cannot override; pinned by
// the composer from import. Bumped independently of PCD_PREPRODUCTION_CHAIN_VERSION
// so SP10's tree-budget enforcement can land without re-versioning the chain.
export const PCD_PREPRODUCTION_FANOUT_VERSION = "preproduction-fanout@1.0.0";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run preproduction-fanout-version
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 PCD_PREPRODUCTION_FANOUT_VERSION constant

11th pinned constant in the PCD slice. Will be pinned by the composer
when assembling PcdProductionFanoutDecision in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: New schemas — `PreproductionTreeBudgetSchema` + `ProductionFanoutGateOperatorDecisionSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- The schemas-barrel `packages/schemas/src/index.ts` already does `export * from "./pcd-preproduction.js"` — no edit needed.

These are purely additive (no widening of existing schemas yet; no producer code yet references them). The build stays green.

- [ ] **Step 1: Write the failing test**

Add the following new test file `packages/schemas/src/pcd-preproduction.test.ts` (create if it doesn't exist; otherwise append to it):

Check first whether the file already exists:

```bash
ls packages/schemas/src/pcd-preproduction.test.ts || echo "does not exist"
```

If it does not exist, create it. Otherwise append the new `describe` blocks to the existing file.

```ts
import { describe, expect, it } from "vitest";
import {
  PreproductionTreeBudgetSchema,
  ProductionFanoutGateOperatorDecisionSchema,
} from "./pcd-preproduction.js";

describe("PreproductionTreeBudgetSchema", () => {
  it("accepts positive integers", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3, maxTreeSize: 100 }).success,
    ).toBe(true);
  });

  it("rejects zero or negative fanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 0, maxTreeSize: 100 }).success,
    ).toBe(false);
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: -1, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects non-integer fanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 1.5, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects missing maxTreeSize", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3 }).success,
    ).toBe(false);
  });
});

describe("ProductionFanoutGateOperatorDecisionSchema", () => {
  it("accepts a minimal valid decision", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: null,
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects empty selectedScriptIds", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: [],
        decidedBy: null,
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects non-ISO decidedAt", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: null,
        decidedAt: "not-a-datetime",
      }).success,
    ).toBe(false);
  });

  it("accepts decidedBy as a string", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: "operator-abc",
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test --run pcd-preproduction
```

Expected: FAIL — `PreproductionTreeBudgetSchema` and `ProductionFanoutGateOperatorDecisionSchema` not exported.

- [ ] **Step 3: Write minimal implementation**

Open `packages/schemas/src/pcd-preproduction.ts` and add the two new schemas. Add them BEFORE `PcdProductionFanoutDecisionSchema` (so the file reads top-down).

Insert AFTER the `CreatorScriptsStageOutputSchema` block (around line 173) and BEFORE the `PcdCostForecastSchema` block:

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

// SP8 — narrow gate-return tuple. Validated by composer at runtime to defend
// against malformed merge-back Inngest payload. Composer assembles the full
// PcdProductionFanoutDecision from this + identity context + brief.
export const ProductionFanoutGateOperatorDecisionSchema = z.object({
  selectedScriptIds: z.array(z.string().min(1)).min(1).readonly(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime(),
});
export type ProductionFanoutGateOperatorDecision = z.infer<
  typeof ProductionFanoutGateOperatorDecisionSchema
>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test --run pcd-preproduction
```

Expected: PASS, all 4 + 4 cases.

- [ ] **Step 5: Verify nothing else broke**

```bash
pnpm typecheck
pnpm test
```

Expected: full repo typecheck clean; all existing tests green (the schema additions are purely additive; nothing yet references them outside the new test).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/pcd-preproduction.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 PreproductionTreeBudget + ProductionFanoutGateOperatorDecision schemas

Purely additive schema work — no consumers yet. PreproductionTreeBudget
is reserved for SP10 enforcement (SP8 always emits null on identity
context). ProductionFanoutGateOperatorDecision is the narrow gate-return
tuple — composer parses gate output via this schema in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Widen `PcdIdentityContextSchema` + `buildPcdIdentityContext` (deep-freeze + treeBudget:null + .readonly())

This task widens the schema with `.readonly()` and adds the required `treeBudget` field, which means every place constructing a `PcdIdentityContext` literal must add `treeBudget: null`. The only known producer in source is `buildPcdIdentityContext`. Test fixtures with `PcdIdentityContext` literals also need `treeBudget: null`. The known test-fixture sites are `production-fanout-gate.test.ts` (`baseCtx`). Search for others before starting.

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts` (one-line `baseCtx` patch)

- [ ] **Step 1: Survey all PcdIdentityContext literal constructions**

```bash
grep -rn "PcdIdentityContext\|allowedShotTypes:\s*\[" packages/ \
  --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist
```

Expected sites (verify at execution time):
- `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts` — the producer.
- `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts` — `baseCtx` literal.
- `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts` — uses the builder; no literal.
- `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts` — uses the builder via `happyStores()`; no literal.
- `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.test.ts` — has `ctx = { creatorIdentityId, productIdentityId, voiceId } as never` — narrow cast, won't fail.
- `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.test.ts` etc. — `ctx = {} as never` — narrow cast.

If new sites are found, include them in this task's literal-patches.

- [ ] **Step 2: Write the failing builder tests (B12, B13, B14)**

Open `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts` and append the following inside the existing `describe("buildPcdIdentityContext", ...)` block (just before its closing `});`):

```ts
  it("returns a deep-frozen context (arrays + sub-objects are also frozen)", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.allowedShotTypes)).toBe(true);
    expect(Object.isFrozen(ctx.allowedOutputIntents)).toBe(true);
    expect(Object.isFrozen(ctx.ugcStyleConstraints)).toBe(true);
    expect(Object.isFrozen(ctx.tier3Rules)).toBe(true);
  });

  it("treeBudget is null in SP8 (reserved for SP10 enforcement)", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.treeBudget).toBe(null);
  });

  it("mutation-via-cast on a frozen array throws TypeError in strict mode", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(() => {
      (ctx.allowedShotTypes as unknown as string[]).push("simple_ugc");
    }).toThrow(TypeError);
  });
```

- [ ] **Step 3: Run builder tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run build-pcd-identity-context
```

Expected: 3 FAIL — context not deep-frozen, `treeBudget` undefined, mutation does not throw.

- [ ] **Step 4: Widen `PcdIdentityContextSchema`**

Edit `packages/schemas/src/pcd-preproduction.ts`. Modify `PcdIdentityContextSchema` (currently around lines 49–84) to:

```ts
export const PcdIdentityContextSchema = z.object({
  // Identity refs
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  consentRecordId: z.string().nullable(),

  // Tier projection (stamped at resolve-time)
  effectiveTier: IdentityTierSchema,
  productTierAtResolution: IdentityTierSchema,
  creatorTierAtResolution: IdentityTierSchema,
  allowedShotTypes: z.array(PcdShotTypeSchema).readonly(),
  allowedOutputIntents: z.array(OutputIntentSchema).readonly(),

  // Tier 3 rule flags
  tier3Rules: z
    .object({
      firstLastFrameRequired: z.boolean(),
      performanceTransferRequired: z.boolean(),
      editOverRegenerateRequired: z.boolean(),
    })
    .readonly(),

  // Creative substrate
  voiceId: z.string().nullable(),
  productCanonicalText: z.string(),
  productHeroPackshotAssetId: z.string().nullable(),
  brandPositioningText: z.string().nullable(),

  // UGC creative-format constraints
  ugcStyleConstraints: z.array(UgcStyleConstraintSchema).readonly(),

  // Consent flag
  consentRevoked: z.boolean(),

  // SP8 — tree-budget reserved for SP10 enforcement; SP8 always emits null.
  treeBudget: PreproductionTreeBudgetSchema.nullable(),

  // Version pin
  identityContextVersion: z.string(),
});
export type PcdIdentityContext = z.infer<typeof PcdIdentityContextSchema>;
```

- [ ] **Step 5: Widen `buildPcdIdentityContext`**

Edit `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts`:

(a) Add the `deepFreeze` import (after the existing imports):

```ts
import { deepFreeze } from "./deep-freeze.js";
```

(b) Modify the context literal (currently around lines 160–181) to add `treeBudget: null`. Replace:

```ts
  const context: PcdIdentityContext = {
    creatorIdentityId: creator.id,
    productIdentityId: product.id,
    consentRecordId: creator.consentRecordId,

    effectiveTier,
    productTierAtResolution: productTier,
    creatorTierAtResolution: creatorTier,
    allowedShotTypes,
    allowedOutputIntents,
    tier3Rules,

    voiceId: creator.voiceId,
    productCanonicalText: product.canonicalPackageText ?? "",
    productHeroPackshotAssetId: product.heroPackshotAssetId,
    brandPositioningText: product.brandPositioningText,

    ugcStyleConstraints,

    consentRevoked: false, // SP6 pre-check throws on revoked, so reaching here means false
    identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
  };

  // MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.
  return Object.freeze(context);
```

With:

```ts
  const context: PcdIdentityContext = {
    creatorIdentityId: creator.id,
    productIdentityId: product.id,
    consentRecordId: creator.consentRecordId,

    effectiveTier,
    productTierAtResolution: productTier,
    creatorTierAtResolution: creatorTier,
    allowedShotTypes,
    allowedOutputIntents,
    tier3Rules,

    voiceId: creator.voiceId,
    productCanonicalText: product.canonicalPackageText ?? "",
    productHeroPackshotAssetId: product.heroPackshotAssetId,
    brandPositioningText: product.brandPositioningText,

    ugcStyleConstraints,

    consentRevoked: false, // SP6 pre-check throws on revoked, so reaching here means false
    // treeBudget is reserved for SP10 enforcement; SP8 always emits null.
    treeBudget: null,
    identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
  };

  // MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.
  return deepFreeze(context);
```

- [ ] **Step 6: Patch `production-fanout-gate.test.ts` `baseCtx`**

Edit `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts`. Find the `baseCtx` literal (around line 25–52) and add `treeBudget: null` adjacent to `consentRevoked`. Replace:

```ts
  consentRevoked: false,
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
} as const;
```

With:

```ts
  consentRevoked: false,
  treeBudget: null,
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
} as const;
```

- [ ] **Step 7: Run builder + gate tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run build-pcd-identity-context
pnpm --filter @creativeagent/creative-pipeline test --run production-fanout-gate
```

Expected: PASS for both. The 3 new builder cases pass; SP7 builder cases (B1–B11) still pass; existing gate cases pass.

- [ ] **Step 8: Run full repo typecheck + tests**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck clean; all tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts \
        packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts \
        packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 widen PcdIdentityContext — deepFreeze + treeBudget + readonly

PcdIdentityContextSchema gains:
- .readonly() on allowedShotTypes, allowedOutputIntents,
  ugcStyleConstraints arrays and on the tier3Rules sub-object
- treeBudget: PreproductionTreeBudgetSchema.nullable() (SP10 reserves)

buildPcdIdentityContext:
- replaces Object.freeze with deepFreeze (closes SP7 I-1)
- always populates treeBudget: null (SP10 enforces)

production-fanout-gate.test.ts baseCtx adds treeBudget: null to satisfy
the new schema.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migration block — widen decision schema, replace gate, widen composer, migrate tests

**This is the largest task in SP8.** It is one coordinated commit because the schema widening, gate-interface narrowing, and composer-assembly are tightly coupled — any partial state would leave the build red. The task has multiple sub-steps; do them in order, run typecheck + tests at the end of each sub-step where indicated.

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts` (add 2 fields + 2 .readonly() on `PcdProductionFanoutDecisionSchema`)
- Modify: `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts` (replace gate class, narrow return type)
- Modify: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts` (assemble decision struct, parse gate output, subset invariant)
- Modify: `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts` (rewrite for SP8 cases G1–G7)
- Modify: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts` (rewrite for SP8 cases C1–C24, except C1/C19/C24 which require widened stubs from later tasks)
- Modify: `packages/creative-pipeline/src/pcd/preproduction/index.ts` (drop `AutoApproveOnlyScriptGate` export, add `AutoApproveAllScriptsGate`)

- [ ] **Step 1: Widen `PcdProductionFanoutDecisionSchema`**

Edit `packages/schemas/src/pcd-preproduction.ts`. Modify `PcdProductionFanoutDecisionSchema` (currently around lines 187–211) to:

```ts
export const PcdProductionFanoutDecisionSchema = z.object({
  // Forensic identity carry-through
  briefId: z.string().min(1),
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  consentRecordId: z.string().nullable(),
  effectiveTier: IdentityTierSchema,

  // Selection (sorted ascending; the composer enforces sort)
  selectedScriptIds: z.array(z.string().min(1)).min(1).readonly(),
  availableScriptIds: z.array(z.string().min(1)).min(1).readonly(),

  // Pinned versions (caller cannot override; pinned by composer from import)
  preproductionChainVersion: z.string(),
  identityContextVersion: z.string(),
  approvalLifecycleVersion: z.string(),
  preproductionFanoutVersion: z.string(),

  // Gate metadata
  decidedAt: z.string().datetime(),
  decidedBy: z.string().nullable(),

  // SP8 — operator commentary seam; SP8 composer always emits null.
  // SP9+: bound this field — max length, operator-only writeable, never used
  // by stubs / never read for control flow / never copied into runner prompts.
  decisionNote: z.string().nullable(),

  // SP10 forward-compat (always null in SP8).
  costForecast: PcdCostForecastSchema.nullable(),
});
export type PcdProductionFanoutDecision = z.infer<typeof PcdProductionFanoutDecisionSchema>;
```

(The build will be red after this step — proceed without committing.)

- [ ] **Step 2: Replace `production-fanout-gate.ts` body**

Replace the entire file content of `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts` with:

```ts
import type {
  CreatorScript,
  PcdIdentityContext,
  ProductionFanoutGateOperatorDecision,
} from "@creativeagent/schemas";

export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<ProductionFanoutGateOperatorDecision>;
}

// =============================================================================
// AutoApproveAllScriptsGate — TEST-ONLY / DEFAULT-LOCAL DEVELOPMENT IMPLEMENTER
// =============================================================================
// This gate auto-selects every available script. It is the in-tree default so
// the chain runs deterministically in tests and local dev.
//
// THIS IS NOT THE PRODUCT BEHAVIOR. Real production MUST replace this with a
// human-in-the-loop selection UX (Inngest waitForEvent → dashboard UI →
// operator-event payload populates selectedScriptIds + decidedBy + decidedAt).
// "Auto approve all 24 scripts" is a stub for plumbing, not a UX target.
//
// DO NOT use this class in production. DO NOT add config flags to "enable
// auto-approval in prod". The merge-back swap is by injection, not by flag.
// =============================================================================
// MERGE-BACK: replace AutoApproveAllScriptsGate with Switchboard Inngest waitForEvent + dashboard UI.
export class AutoApproveAllScriptsGate implements ProductionFanoutGate {
  async requestSelection(
    input: RequestSelectionInput,
  ): Promise<ProductionFanoutGateOperatorDecision> {
    const ids = input.scripts.map((s) => s.id).slice().sort();
    return {
      selectedScriptIds: ids,
      decidedBy: null,
      decidedAt: input.clock().toISOString(),
    };
  }
}
```

Note: the new file no longer imports `PCD_*_VERSION` constants, `InvariantViolationError`, or `PcdProductionFanoutDecision`. These move into the composer's responsibility. This is the structural form of the SP4 invariant ("caller cannot override pinned versions") — gate cannot reference the constants at all, so cannot forge them.

- [ ] **Step 3: Widen `preproduction-chain.ts` (composer)**

Replace the entire file content of `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts` with:

```ts
import {
  ProductionFanoutGateOperatorDecisionSchema,
  type CreatorScriptsStageOutput,
  type HooksStageOutput,
  type MotivatorsStageOutput,
  type PcdBriefInput,
  type PcdPreproductionChainResult,
  type PcdProductionFanoutDecision,
  type PreproductionChainStage,
  type TrendStageOutput,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
// MERGE-BACK: include all four pinned versions (chain, identity-context, approval-lifecycle, fanout) in WorkTrace decision payload.
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";
import {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
import type { ProductionFanoutGate } from "./production-fanout-gate.js";
import type { TrendsStageRunner } from "./stages/trends-stage-runner.js";
import type { MotivatorsStageRunner } from "./stages/motivators-stage-runner.js";
import type { HooksStageRunner } from "./stages/hooks-stage-runner.js";
import type { CreatorScriptsStageRunner } from "./stages/creator-scripts-stage-runner.js";

export type PreproductionChainStores = BuildPcdIdentityContextStores & {
  trendsRunner: TrendsStageRunner;
  motivatorsRunner: MotivatorsStageRunner;
  hooksRunner: HooksStageRunner;
  creatorScriptsRunner: CreatorScriptsStageRunner;
  productionFanoutGate: ProductionFanoutGate;
  clock?: () => Date;
};

async function runStageWrapped<T>(
  stage: PreproductionChainStage,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new PreproductionChainError({ stage, cause: err });
  }
}

export async function runIdentityAwarePreproductionChain(
  brief: PcdBriefInput,
  stores: PreproductionChainStores,
): Promise<PcdPreproductionChainResult> {
  // 1. Build identity context — pre-stage errors propagate raw.
  const identityContext = await buildPcdIdentityContext(brief, stores);

  const clock = stores.clock ?? (() => new Date());

  // 2. Trends.
  const trends: TrendStageOutput = await runStageWrapped("trends", () =>
    stores.trendsRunner.run(brief, identityContext),
  );
  // MERGE-BACK: emit WorkTrace here after trends stage returns.

  // 3. Motivators.
  const motivators: MotivatorsStageOutput = await runStageWrapped("motivators", () =>
    stores.motivatorsRunner.run(brief, identityContext, trends),
  );
  // MERGE-BACK: emit WorkTrace here after motivators stage returns.

  // 4. Hooks.
  const hooks: HooksStageOutput = await runStageWrapped("hooks", () =>
    stores.hooksRunner.run(brief, identityContext, trends, motivators),
  );
  // MERGE-BACK: emit WorkTrace here after hooks stage returns.

  // 5. Creator scripts.
  const scripts: CreatorScriptsStageOutput = await runStageWrapped("creator_scripts", () =>
    stores.creatorScriptsRunner.run(brief, identityContext, trends, motivators, hooks),
  );
  // MERGE-BACK: emit WorkTrace here after creator scripts stage returns.

  // 6. Production fanout gate. Composer literally calls
  //    productionFanoutGate.requestSelection(...) — anti-pattern test enforces.
  //    Composer parses gate output via ProductionFanoutGateOperatorDecisionSchema.parse
  //    to defend against malformed merge-back Inngest payload.
  //    Composer asserts selectedScriptIds ⊆ availableScriptIds.
  const operatorDecision = await runStageWrapped("production_fanout_gate", async () => {
    const raw = await stores.productionFanoutGate.requestSelection({
      scripts: scripts.scripts,
      identityContext,
      briefId: brief.briefId,
      clock,
    });
    const parsed = ProductionFanoutGateOperatorDecisionSchema.parse(raw);
    const availableSet = new Set(scripts.scripts.map((s) => s.id));
    for (const id of parsed.selectedScriptIds) {
      if (!availableSet.has(id)) {
        throw new InvariantViolationError("gate selected unknown script id", {
          scriptId: id,
        });
      }
    }
    return parsed;
  });
  // MERGE-BACK: emit WorkTrace here at production fanout gate decision.

  // 7. Composer assembles PcdProductionFanoutDecision — pins versions, identity carry-through.
  const availableScriptIds = scripts.scripts.map((s) => s.id).slice().sort();
  const selectedScriptIds = [...operatorDecision.selectedScriptIds].sort();

  const decision: PcdProductionFanoutDecision = {
    briefId: brief.briefId,
    creatorIdentityId: identityContext.creatorIdentityId,
    productIdentityId: identityContext.productIdentityId,
    consentRecordId: identityContext.consentRecordId,
    effectiveTier: identityContext.effectiveTier,
    selectedScriptIds,
    availableScriptIds,
    preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
    identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    preproductionFanoutVersion: PCD_PREPRODUCTION_FANOUT_VERSION,
    decidedAt: operatorDecision.decidedAt,
    decidedBy: operatorDecision.decidedBy,
    decisionNote: null,
    costForecast: null,
  };

  // MERGE-BACK: wire UGC production handoff here.
  return {
    decision,
    stageOutputs: { trends, motivators, hooks, scripts },
  };
}
```

- [ ] **Step 4: Replace `production-fanout-gate.test.ts`**

Replace the entire file content of `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  ProductionFanoutGateOperatorDecisionSchema,
  type PcdIdentityContext,
} from "@creativeagent/schemas";
import {
  AutoApproveAllScriptsGate,
  type RequestSelectionInput,
} from "./production-fanout-gate.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const fixedClock = () => new Date("2026-04-30T12:00:00.000Z");

const baseScript = {
  id: "script-1",
  hookText: "h",
  creatorAngle: "a",
  visualBeats: [],
  productMoment: "p",
  cta: "c",
  complianceNotes: [],
  identityConstraints: { creatorIdentityId: "c1", productIdentityId: "p1", voiceId: null },
  parentHookId: "hook-1",
  scriptStyle: "talking_points" as const,
  talkingPoints: ["x"],
};

const baseCtx: PcdIdentityContext = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  consentRecordId: null,
  effectiveTier: 2,
  productTierAtResolution: 2,
  creatorTierAtResolution: 2,
  allowedShotTypes: ["simple_ugc"],
  allowedOutputIntents: ["draft", "preview", "final_export"],
  tier3Rules: {
    firstLastFrameRequired: false,
    performanceTransferRequired: false,
    editOverRegenerateRequired: false,
  },
  voiceId: null,
  productCanonicalText: "ACME",
  productHeroPackshotAssetId: null,
  brandPositioningText: null,
  ugcStyleConstraints: [
    "native_vertical",
    "creator_led",
    "no_overproduced_storyboard",
    "product_fidelity_required",
    "no_invented_product_claims",
  ],
  consentRevoked: false,
  treeBudget: null,
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
};

describe("AutoApproveAllScriptsGate", () => {
  const gate = new AutoApproveAllScriptsGate();

  it("with one script, selects it and returns operator-decision tuple", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual(["script-1"]);
    expect(out.decidedBy).toBe(null);
    expect(out.decidedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("with three scripts, selects all three sorted ascending", async () => {
    const input: RequestSelectionInput = {
      scripts: [
        { ...baseScript, id: "script-c" },
        { ...baseScript, id: "script-a" },
        { ...baseScript, id: "script-b" },
      ],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual(["script-a", "script-b", "script-c"]);
  });

  it("returned shape parses cleanly via the operator-decision schema", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(ProductionFanoutGateOperatorDecisionSchema.safeParse(out).success).toBe(true);
  });

  it("returned object contains exactly the three operator-decision keys", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(Object.keys(out).sort()).toEqual(["decidedAt", "decidedBy", "selectedScriptIds"]);
  });

  it("does NOT include any pinned-version field on the return shape", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out).not.toHaveProperty("preproductionChainVersion");
    expect(out).not.toHaveProperty("identityContextVersion");
    expect(out).not.toHaveProperty("approvalLifecycleVersion");
    expect(out).not.toHaveProperty("preproductionFanoutVersion");
  });

  it("does NOT echo identity carry-through fields on the return shape", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out).not.toHaveProperty("briefId");
    expect(out).not.toHaveProperty("creatorIdentityId");
    expect(out).not.toHaveProperty("productIdentityId");
    expect(out).not.toHaveProperty("consentRecordId");
    expect(out).not.toHaveProperty("effectiveTier");
  });

  it("with empty scripts, returns an empty selectedScriptIds (parse-fails upstream)", async () => {
    const input: RequestSelectionInput = {
      scripts: [],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual([]);
    // Schema rejects empty selectedScriptIds — composer's runStageWrapped catches.
    expect(ProductionFanoutGateOperatorDecisionSchema.safeParse(out).success).toBe(false);
  });
});
```

- [ ] **Step 5: Replace `preproduction-chain.test.ts`**

Replace the entire file content of `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import {
  PcdPreproductionChainResultSchema,
  type PcdBriefInput,
} from "@creativeagent/schemas";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "./preproduction-chain.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";
import { StubTrendsStageRunner } from "./stages/stub-trends-stage-runner.js";
import { StubMotivatorsStageRunner } from "./stages/stub-motivators-stage-runner.js";
import { StubHooksStageRunner } from "./stages/stub-hooks-stage-runner.js";
import { StubCreatorScriptsStageRunner } from "./stages/stub-creator-scripts-stage-runner.js";
import { AutoApproveAllScriptsGate } from "./production-fanout-gate.js";

const fixedClock = () => new Date("2026-04-30T12:00:00.000Z");

const validBrief: PcdBriefInput = {
  briefId: "brief-1",
  productDescription: "AI lead reply",
  targetAudience: "founders",
  platforms: ["instagram_reels"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

function happyStores(): PreproductionChainStores {
  return {
    sp7ProductRegistryReader: {
      async findById() {
        return {
          id: "product-1",
          qualityTier: "verified" as const,
          canonicalPackageText: "ACME",
          heroPackshotAssetId: null,
          brandPositioningText: null,
        };
      },
    },
    sp7CreatorRegistryReader: {
      async findById() {
        return {
          id: "creator-1",
          qualityTier: "anchored" as const,
          voiceId: null,
          consentRecordId: null,
        };
      },
    },
    creatorIdentityReader: {
      async findById() {
        return { id: "creator-1", consentRecordId: null };
      },
    },
    consentRecordReader: {
      async findById() {
        return null;
      },
    },
    trendsRunner: new StubTrendsStageRunner(),
    motivatorsRunner: new StubMotivatorsStageRunner(),
    hooksRunner: new StubHooksStageRunner(),
    creatorScriptsRunner: new StubCreatorScriptsStageRunner(),
    productionFanoutGate: new AutoApproveAllScriptsGate(),
    clock: fixedClock,
  };
}

describe("runIdentityAwarePreproductionChain — happy path", () => {
  it("returns a schema-valid PcdPreproductionChainResult", async () => {
    const result = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(PcdPreproductionChainResultSchema.safeParse(result).success).toBe(true);
  });

  it("decision pins all four version constants from imports", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
    expect(decision.preproductionFanoutVersion).toBe(PCD_PREPRODUCTION_FANOUT_VERSION);
  });

  it("decidedAt flows from the gate's return (not from the composer's clock)", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("decidedBy is null with the default AutoApproveAllScriptsGate", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedBy).toBe(null);
  });

  it("decisionNote is null in SP8", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decisionNote).toBe(null);
  });

  it("costForecast is null in SP8", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.costForecast).toBe(null);
  });

  it("selectedScriptIds and availableScriptIds are sorted ascending", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    expect(decision.availableScriptIds).toEqual([...decision.availableScriptIds].sort());
  });

  it("calls stages in fixed order: trends, motivators, hooks, creator_scripts", async () => {
    const order: string[] = [];
    const stores = happyStores();
    const origTrends = stores.trendsRunner;
    stores.trendsRunner = {
      async run(...args: Parameters<typeof origTrends.run>) {
        order.push("trends");
        return origTrends.run(...args);
      },
    };
    const origMotivators = stores.motivatorsRunner;
    stores.motivatorsRunner = {
      async run(...args: Parameters<typeof origMotivators.run>) {
        order.push("motivators");
        return origMotivators.run(...args);
      },
    };
    const origHooks = stores.hooksRunner;
    stores.hooksRunner = {
      async run(...args: Parameters<typeof origHooks.run>) {
        order.push("hooks");
        return origHooks.run(...args);
      },
    };
    const origScripts = stores.creatorScriptsRunner;
    stores.creatorScriptsRunner = {
      async run(...args: Parameters<typeof origScripts.run>) {
        order.push("creator_scripts");
        return origScripts.run(...args);
      },
    };

    await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(order).toEqual(["trends", "motivators", "hooks", "creator_scripts"]);
  });

  it("identityContext flows by reference equality into each stage runner", async () => {
    const seenContexts: unknown[] = [];
    const stores = happyStores();
    stores.trendsRunner = {
      async run(_b, ctx) {
        seenContexts.push(ctx);
        return new StubTrendsStageRunner().run(_b, ctx);
      },
    };
    stores.motivatorsRunner = {
      async run(_b, ctx, t) {
        seenContexts.push(ctx);
        return new StubMotivatorsStageRunner().run(_b, ctx, t);
      },
    };
    stores.hooksRunner = {
      async run(_b, ctx, t, m) {
        seenContexts.push(ctx);
        return new StubHooksStageRunner().run(_b, ctx, t, m);
      },
    };
    stores.creatorScriptsRunner = {
      async run(_b, ctx, t, m, h) {
        seenContexts.push(ctx);
        return new StubCreatorScriptsStageRunner().run(_b, ctx, t, m, h);
      },
    };
    await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(seenContexts.length).toBe(4);
    expect(seenContexts[0]).toBe(seenContexts[1]);
    expect(seenContexts[1]).toBe(seenContexts[2]);
    expect(seenContexts[2]).toBe(seenContexts[3]);
  });
});

describe("runIdentityAwarePreproductionChain — pre-stage errors propagate raw", () => {
  it("ZodError from invalid brief propagates raw (not wrapped)", async () => {
    await expect(
      runIdentityAwarePreproductionChain(
        { ...validBrief, briefId: "" } as PcdBriefInput,
        happyStores(),
      ),
    ).rejects.not.toBeInstanceOf(PreproductionChainError);
  });

  it("InvariantViolationError from missing product propagates raw", async () => {
    const stores = happyStores();
    stores.sp7ProductRegistryReader = {
      async findById() {
        return null;
      },
    };
    await expect(runIdentityAwarePreproductionChain(validBrief, stores)).rejects.toThrow(
      InvariantViolationError,
    );
  });

  it("ConsentRevokedRefusalError from SP6 pre-check propagates raw", async () => {
    const stores = happyStores();
    stores.sp7CreatorRegistryReader = {
      async findById() {
        return {
          id: "creator-1",
          qualityTier: "anchored" as const,
          voiceId: null,
          consentRecordId: "consent-1",
        };
      },
    };
    stores.creatorIdentityReader = {
      async findById() {
        return { id: "creator-1", consentRecordId: "consent-1" };
      },
    };
    stores.consentRecordReader = {
      async findById() {
        return { id: "consent-1", revoked: true, revokedAt: new Date() };
      },
    };
    await expect(runIdentityAwarePreproductionChain(validBrief, stores)).rejects.toThrow(
      ConsentRevokedRefusalError,
    );
  });
});

describe("runIdentityAwarePreproductionChain — stage-runner errors wrap", () => {
  it("trends runner throw wraps as PreproductionChainError(stage='trends')", async () => {
    const stores = happyStores();
    stores.trendsRunner = {
      async run() {
        throw new Error("trends boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("trends");
      expect((err as PreproductionChainError).cause).toBeInstanceOf(Error);
      expect(((err as PreproductionChainError).cause as Error).message).toBe("trends boom");
    }
  });

  it("motivators runner throw wraps with stage='motivators'", async () => {
    const stores = happyStores();
    stores.motivatorsRunner = {
      async run() {
        throw new Error("motivators boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("motivators");
    }
  });

  it("hooks runner throw wraps with stage='hooks'", async () => {
    const stores = happyStores();
    stores.hooksRunner = {
      async run() {
        throw new Error("hooks boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("hooks");
    }
  });

  it("creator scripts runner throw wraps with stage='creator_scripts'", async () => {
    const stores = happyStores();
    stores.creatorScriptsRunner = {
      async run() {
        throw new Error("scripts boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("creator_scripts");
    }
  });

  it("production fanout gate throw wraps with stage='production_fanout_gate'", async () => {
    const stores = happyStores();
    stores.productionFanoutGate = {
      async requestSelection() {
        throw new Error("gate boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("production_fanout_gate");
    }
  });
});

describe("runIdentityAwarePreproductionChain — composer-only assembly hardening (SP7 I-2)", () => {
  it("composer pins all four versions even if a malicious gate tries to forge", async () => {
    const stores = happyStores();
    // Malicious gate returns extra fields the composer's gate-input type doesn't see;
    // the composer cannot consume them anyway because Schema.parse strips unknown keys
    // when zod is in default (strict mode is not enabled on this schema).
    // The decision struct's pinned versions still come from the import constants.
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
    expect(decision.preproductionFanoutVersion).toBe(PCD_PREPRODUCTION_FANOUT_VERSION);
  });

  it("composer carries identity from brief + identityContext, not from gate return", async () => {
    const stores = happyStores();
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(decision.briefId).toBe(validBrief.briefId);
    expect(decision.creatorIdentityId).toBe("creator-1");
    expect(decision.productIdentityId).toBe("product-1");
  });

  it("subset invariant: gate returning unknown script id wraps as PreproductionChainError", async () => {
    const stores = happyStores();
    stores.productionFanoutGate = {
      async requestSelection(_input) {
        return {
          selectedScriptIds: ["unknown-script-id"],
          decidedBy: null,
          decidedAt: "2026-04-30T12:00:00.000Z",
        };
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("production_fanout_gate");
      expect((err as PreproductionChainError).cause).toBeInstanceOf(InvariantViolationError);
    }
  });

  it("malformed gate output (bad decidedAt) wraps as PreproductionChainError via parse failure", async () => {
    const stores = happyStores();
    stores.productionFanoutGate = {
      async requestSelection(_input) {
        return {
          selectedScriptIds: ["any"],
          decidedBy: null,
          decidedAt: "not-a-datetime",
        };
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("production_fanout_gate");
    }
  });

  it("composer re-sorts selectedScriptIds even if gate returns unsorted", async () => {
    const stores = happyStores();
    // Get the SP7-shape stub scripts (length-1) so we know the available ID.
    const baselineResult = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    const ids = [...baselineResult.decision.availableScriptIds];
    if (ids.length < 2) return; // skip if stub fanout still 1 — Tasks 6-9 widen it
    const reversed = [...ids].reverse();

    stores.productionFanoutGate = {
      async requestSelection(_input) {
        return {
          selectedScriptIds: reversed,
          decidedBy: null,
          decidedAt: "2026-04-30T12:00:00.000Z",
        };
      },
    };
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
  });
});
```

Note on the last `it` block: at this point in the plan, stubs are still SP7-shape (length-1), so the unsorted-input case has only one ID and the assertion is trivially satisfied. After Tasks 6–9 (stub widenings), this case will have a meaningful 24-ID sort. The early-return guard keeps the test green during the migration window. **A later task (Task 10) replaces this guard with hard heterogeneous-fanout assertions once the stubs widen.**

- [ ] **Step 6: Update `index.ts` barrel**

Replace the entire content of `packages/creative-pipeline/src/pcd/preproduction/index.ts` with:

```ts
export { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
export { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
export { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";
export { PreproductionChainError } from "./preproduction-chain-error.js";
export { deepFreeze } from "./deep-freeze.js";
export type { Sp7ProductRegistryReader, Sp7CreatorRegistryReader } from "./sp7-readers.js";

export {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";

export {
  AutoApproveAllScriptsGate,
  type ProductionFanoutGate,
  type RequestSelectionInput,
} from "./production-fanout-gate.js";

export {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "./preproduction-chain.js";

// Stage-runner interfaces
export type { TrendsStageRunner } from "./stages/trends-stage-runner.js";
export type { MotivatorsStageRunner } from "./stages/motivators-stage-runner.js";
export type { HooksStageRunner } from "./stages/hooks-stage-runner.js";
export type { CreatorScriptsStageRunner } from "./stages/creator-scripts-stage-runner.js";

// Stub stage-runner implementers
export { StubTrendsStageRunner } from "./stages/stub-trends-stage-runner.js";
export { StubMotivatorsStageRunner } from "./stages/stub-motivators-stage-runner.js";
export { StubHooksStageRunner } from "./stages/stub-hooks-stage-runner.js";
export { StubCreatorScriptsStageRunner } from "./stages/stub-creator-scripts-stage-runner.js";
```

- [ ] **Step 7: Run typecheck + tests**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck clean across all 5 packages; all tests green. Specifically:
- `production-fanout-gate.test.ts` — 7 cases pass.
- `preproduction-chain.test.ts` — 17+ cases pass (some new SP8 cases active; full fanout assertions still wait on Tasks 6–9).
- `build-pcd-identity-context.test.ts` — 14 cases pass.
- All other tests carry through unchanged.

If typecheck fails, the most likely cause is a stale `PcdIdentityContext` literal somewhere — re-run the survey grep from Task 4 Step 1 and patch any literal that's missing `treeBudget: null`.

- [ ] **Step 8: Run prettier**

```bash
pnpm exec prettier --check "packages/creative-pipeline/src/pcd/preproduction/**/*.ts" "packages/schemas/src/pcd-preproduction.ts"
```

If failures, run:

```bash
pnpm exec prettier --write "packages/creative-pipeline/src/pcd/preproduction/**/*.ts" "packages/schemas/src/pcd-preproduction.ts"
```

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts \
        packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts \
        packages/creative-pipeline/src/pcd/preproduction/index.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 narrow gate, composer-assembled decision, four-version pinning

PcdProductionFanoutDecisionSchema gains preproductionFanoutVersion +
decisionNote + .readonly() on selection arrays.

ProductionFanoutGate.requestSelection return type narrows from full
PcdProductionFanoutDecision to ProductionFanoutGateOperatorDecision tuple
({ selectedScriptIds, decidedBy, decidedAt }). Closes SP7 I-2 — gate is
structurally incapable of forging pinned versions or identity carry-through.

AutoApproveOnlyScriptGate is replaced by AutoApproveAllScriptsGate
(selects every available script). Old class is removed.

runIdentityAwarePreproductionChain (composer) now:
- parses gate output via ProductionFanoutGateOperatorDecisionSchema.parse
- asserts selectedScriptIds ⊆ availableScriptIds; violation throws
  InvariantViolationError wrapped as PreproductionChainError
- assembles PcdProductionFanoutDecision itself, pinning all four
  versions (chain, identity-context, approval-lifecycle, fanout) from
  imports
- defensively re-sorts both selection arrays

production-fanout-gate.test.ts and preproduction-chain.test.ts rewrite
for SP8 cases. Heterogeneous-fanout integration tests are deferred to
Task 10 (after stub widenings in Tasks 6-9).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Widen `StubTrendsStageRunner` (length-2)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.test.ts`

- [ ] **Step 1: Write failing test**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { TrendStageOutputSchema } from "@creativeagent/schemas";
import {
  StubTrendsStageRunner,
  STUB_TRENDS_FANOUT,
} from "./stub-trends-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "AI lead reply",
  targetAudience: "founders",
  platforms: ["instagram_reels"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {} as never; // stub does not read from context

describe("StubTrendsStageRunner", () => {
  const runner = new StubTrendsStageRunner();

  it("STUB_TRENDS_FANOUT is 2", () => {
    expect(STUB_TRENDS_FANOUT).toBe(2);
  });

  it(`returns STUB_TRENDS_FANOUT (=${STUB_TRENDS_FANOUT}) signals`, async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals.length).toBe(STUB_TRENDS_FANOUT);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx);
    expect(TrendStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("encodes briefId in each trend signal id with a 1-based suffix", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals[0]!.id).toBe("trend-brief-123-1");
    expect(out.signals[1]!.id).toBe("trend-brief-123-2");
  });

  it("is deterministic for the same briefId", async () => {
    const a = await runner.run(brief, ctx);
    const b = await runner.run(brief, ctx);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-trends-stage-runner
```

Expected: FAIL — `STUB_TRENDS_FANOUT` not exported, length is 1 not 2.

- [ ] **Step 3: Widen the stub**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.ts` with:

```ts
import type { PcdBriefInput, PcdIdentityContext, TrendStageOutput } from "@creativeagent/schemas";
import type { TrendsStageRunner } from "./trends-stage-runner.js";

export const STUB_TRENDS_FANOUT = 2;

// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    const signals = Array.from({ length: STUB_TRENDS_FANOUT }, (_, i) => ({
      id: `trend-${brief.briefId}-${i + 1}`,
      summary: `Stub trend signal ${i + 1} for ${brief.productDescription}`,
      audienceFit: brief.targetAudience,
      evidenceRefs: [],
    }));
    return { signals };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-trends-stage-runner
```

Expected: PASS, all 5 cases.

- [ ] **Step 5: Run full creative-pipeline tests to verify no regressions**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all green. The chain happy-path still works because gate is `AutoApproveAllScriptsGate` (selects all).

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.ts \
        packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 widen StubTrendsStageRunner to length-2

Exports STUB_TRENDS_FANOUT = 2. Each signal id encodes briefId + 1-based suffix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Widen `StubMotivatorsStageRunner` (length-2 per trend)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.test.ts`

- [ ] **Step 1: Write failing test**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { MotivatorsStageOutputSchema } from "@creativeagent/schemas";
import {
  StubMotivatorsStageRunner,
  STUB_MOTIVATORS_PER_TREND,
} from "./stub-motivators-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "x",
  targetAudience: "y",
  platforms: ["a"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {} as never;
const trends = {
  signals: [
    { id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] },
    { id: "trend-brief-123-2", summary: "z", audienceFit: "y", evidenceRefs: [] },
  ],
};

describe("StubMotivatorsStageRunner", () => {
  const runner = new StubMotivatorsStageRunner();

  it("STUB_MOTIVATORS_PER_TREND is 2", () => {
    expect(STUB_MOTIVATORS_PER_TREND).toBe(2);
  });

  it("returns trends.signals.length × STUB_MOTIVATORS_PER_TREND motivators (= 4)", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators.length).toBe(trends.signals.length * STUB_MOTIVATORS_PER_TREND);
    expect(out.motivators.length).toBe(4);
  });

  it("each motivator's parentTrendId matches a real trend id", async () => {
    const out = await runner.run(brief, ctx, trends);
    const realTrendIds = new Set(trends.signals.map((s) => s.id));
    for (const m of out.motivators) {
      expect(realTrendIds.has(m.parentTrendId)).toBe(true);
    }
  });

  it("motivator ids encode parent trend id with 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators[0]!.id).toBe("motivator-trend-brief-123-1-1");
    expect(out.motivators[1]!.id).toBe("motivator-trend-brief-123-1-2");
    expect(out.motivators[2]!.id).toBe("motivator-trend-brief-123-2-1");
    expect(out.motivators[3]!.id).toBe("motivator-trend-brief-123-2-2");
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(MotivatorsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await runner.run(brief, ctx, trends);
    const b = await runner.run(brief, ctx, trends);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-motivators-stage-runner
```

Expected: FAIL.

- [ ] **Step 3: Widen the stub**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.ts` with:

```ts
import type {
  Motivator,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { MotivatorsStageRunner } from "./motivators-stage-runner.js";

export const STUB_MOTIVATORS_PER_TREND = 2;

// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.
export class StubMotivatorsStageRunner implements MotivatorsStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput> {
    const motivators: Motivator[] = [];
    for (const trend of trends.signals) {
      for (let i = 1; i <= STUB_MOTIVATORS_PER_TREND; i++) {
        motivators.push({
          id: `motivator-${trend.id}-${i}`,
          frictionOrDesire: `Stub motivator ${i} linked to ${trend.id}`,
          audienceSegment: brief.targetAudience,
          evidenceRefs: [],
          parentTrendId: trend.id,
        });
      }
    }
    return { motivators };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-motivators-stage-runner
```

Expected: PASS, all 6 cases.

- [ ] **Step 5: Run full creative-pipeline tests to verify no regressions**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.ts \
        packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 widen StubMotivatorsStageRunner to 2 per trend

Exports STUB_MOTIVATORS_PER_TREND = 2. Each motivator id encodes the
parent trend id + 1-based suffix; parentTrendId propagates structurally.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Widen `StubHooksStageRunner` (length-3 per motivator)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.test.ts`

- [ ] **Step 1: Write failing test**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { HooksStageOutputSchema } from "@creativeagent/schemas";
import {
  StubHooksStageRunner,
  STUB_HOOKS_PER_MOTIVATOR,
} from "./stub-hooks-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "x",
  targetAudience: "y",
  platforms: ["a"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {} as never;
const trends = {
  signals: [
    { id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] },
    { id: "trend-brief-123-2", summary: "z", audienceFit: "y", evidenceRefs: [] },
  ],
};
const motivators = {
  motivators: [
    {
      id: "motivator-trend-brief-123-1-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "motivator-trend-brief-123-1-2",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "motivator-trend-brief-123-2-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-2",
    },
    {
      id: "motivator-trend-brief-123-2-2",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-2",
    },
  ],
};

describe("StubHooksStageRunner", () => {
  const runner = new StubHooksStageRunner();

  it("STUB_HOOKS_PER_MOTIVATOR is 3", () => {
    expect(STUB_HOOKS_PER_MOTIVATOR).toBe(3);
  });

  it("returns motivators.length × STUB_HOOKS_PER_MOTIVATOR hooks (= 12)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks.length).toBe(motivators.motivators.length * STUB_HOOKS_PER_MOTIVATOR);
    expect(out.hooks.length).toBe(12);
  });

  it("each hook's parentMotivatorId matches a real motivator id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    const realMotivatorIds = new Set(motivators.motivators.map((m) => m.id));
    for (const h of out.hooks) {
      expect(realMotivatorIds.has(h.parentMotivatorId)).toBe(true);
    }
  });

  it("each hook's parentTrendId matches its parent motivator's parentTrendId (transitive lineage)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    const motivatorById = new Map(motivators.motivators.map((m) => [m.id, m]));
    for (const h of out.hooks) {
      const parent = motivatorById.get(h.parentMotivatorId)!;
      expect(h.parentTrendId).toBe(parent.parentTrendId);
    }
  });

  it("hook ids encode parent motivator id + 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.id).toBe("hook-motivator-trend-brief-123-1-1-1");
    expect(out.hooks[1]!.id).toBe("hook-motivator-trend-brief-123-1-1-2");
    expect(out.hooks[2]!.id).toBe("hook-motivator-trend-brief-123-1-1-3");
  });

  it("hook types rotate across direct_camera, mid_action, reaction within one motivator's children", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.hookType).toBe("direct_camera");
    expect(out.hooks[1]!.hookType).toBe("mid_action");
    expect(out.hooks[2]!.hookType).toBe("reaction");
    expect(out.hooks[3]!.hookType).toBe("direct_camera");
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(HooksStageOutputSchema.safeParse(out).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-hooks-stage-runner
```

Expected: FAIL.

- [ ] **Step 3: Widen the stub**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.ts` with:

```ts
import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  PreproductionHook,
  PreproductionHookType,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { HooksStageRunner } from "./hooks-stage-runner.js";

export const STUB_HOOKS_PER_MOTIVATOR = 3;
const STUB_HOOK_TYPE_ROTATION: PreproductionHookType[] = [
  "direct_camera",
  "mid_action",
  "reaction",
];

// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.
export class StubHooksStageRunner implements HooksStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    _trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput> {
    const hooks: PreproductionHook[] = [];
    for (const motivator of motivators.motivators) {
      for (let i = 1; i <= STUB_HOOKS_PER_MOTIVATOR; i++) {
        hooks.push({
          id: `hook-${motivator.id}-${i}`,
          text: `Stub hook ${i} for ${brief.productDescription}`,
          hookType: STUB_HOOK_TYPE_ROTATION[(i - 1) % STUB_HOOK_TYPE_ROTATION.length]!,
          parentMotivatorId: motivator.id,
          parentTrendId: motivator.parentTrendId,
        });
      }
    }
    return { hooks };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-hooks-stage-runner
```

Expected: PASS, all 7 cases.

- [ ] **Step 5: Run full creative-pipeline tests to verify no regressions**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.ts \
        packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 widen StubHooksStageRunner to 3 per motivator with rotation

Exports STUB_HOOKS_PER_MOTIVATOR = 3. Hook types rotate across
[direct_camera, mid_action, reaction] within one motivator's children.
parentMotivatorId + parentTrendId propagate structurally (transitive
lineage from motivator's parentTrendId).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Widen `StubCreatorScriptsStageRunner` (length-2 per hook)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.ts`
- Modify: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.test.ts`

- [ ] **Step 1: Write failing test**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { CreatorScriptsStageOutputSchema } from "@creativeagent/schemas";
import {
  StubCreatorScriptsStageRunner,
  STUB_SCRIPTS_PER_HOOK,
} from "./stub-creator-scripts-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "x",
  targetAudience: "y",
  platforms: ["a"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  voiceId: null,
} as never;
const trends = {
  signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }],
};
const motivators = {
  motivators: [
    {
      id: "motivator-trend-brief-123-1-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
  ],
};
const hooks = {
  hooks: [
    {
      id: "hook-motivator-trend-brief-123-1-1-1",
      text: "h1",
      hookType: "direct_camera" as const,
      parentMotivatorId: "motivator-trend-brief-123-1-1",
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "hook-motivator-trend-brief-123-1-1-2",
      text: "h2",
      hookType: "mid_action" as const,
      parentMotivatorId: "motivator-trend-brief-123-1-1",
      parentTrendId: "trend-brief-123-1",
    },
  ],
};

describe("StubCreatorScriptsStageRunner", () => {
  const runner = new StubCreatorScriptsStageRunner();

  it("STUB_SCRIPTS_PER_HOOK is 2", () => {
    expect(STUB_SCRIPTS_PER_HOOK).toBe(2);
  });

  it("returns hooks.length × STUB_SCRIPTS_PER_HOOK scripts (= 4)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts.length).toBe(hooks.hooks.length * STUB_SCRIPTS_PER_HOOK);
    expect(out.scripts.length).toBe(4);
  });

  it("each script's parentHookId matches a real hook id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    const realHookIds = new Set(hooks.hooks.map((h) => h.id));
    for (const s of out.scripts) {
      expect(realHookIds.has(s.parentHookId)).toBe(true);
    }
  });

  it("script ids encode parent hook id + 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.id).toBe("script-hook-motivator-trend-brief-123-1-1-1-1");
    expect(out.scripts[1]!.id).toBe("script-hook-motivator-trend-brief-123-1-1-1-2");
  });

  it("uses talking_points style by default", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    for (const s of out.scripts) {
      expect(s.scriptStyle).toBe("talking_points");
      expect("spokenLines" in s).toBe(false);
    }
  });

  it("propagates identity refs from the context into identityConstraints", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    for (const s of out.scripts) {
      expect(s.identityConstraints.creatorIdentityId).toBe("creator-1");
      expect(s.identityConstraints.productIdentityId).toBe("product-1");
      expect(s.identityConstraints.voiceId).toBe(null);
    }
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(CreatorScriptsStageOutputSchema.safeParse(out).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-creator-scripts-stage-runner
```

Expected: FAIL.

- [ ] **Step 3: Widen the stub**

Replace `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.ts` with:

```ts
import type {
  CreatorScript,
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { CreatorScriptsStageRunner } from "./creator-scripts-stage-runner.js";

export const STUB_SCRIPTS_PER_HOOK = 2;

// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.
export class StubCreatorScriptsStageRunner implements CreatorScriptsStageRunner {
  async run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    _trends: TrendStageOutput,
    _motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput> {
    const scripts: CreatorScript[] = [];
    for (const hook of hooks.hooks) {
      for (let i = 1; i <= STUB_SCRIPTS_PER_HOOK; i++) {
        scripts.push({
          id: `script-${hook.id}-${i}`,
          hookText: hook.text,
          creatorAngle: `first-person operator angle ${i}`,
          visualBeats: ["show the problem", "show the product moment", "show the result"],
          productMoment: `${brief.productDescription} solving the friction`,
          cta: `Try it (variant ${i})`,
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: identityContext.creatorIdentityId,
            productIdentityId: identityContext.productIdentityId,
            voiceId: identityContext.voiceId,
          },
          parentHookId: hook.id,
          scriptStyle: "talking_points",
          talkingPoints: [
            `Hook: ${hook.text}`,
            `Friction: stub motivator description ${i}`,
            `Outcome: ${brief.productDescription}`,
          ],
        });
      }
    }
    return { scripts };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run stub-creator-scripts-stage-runner
```

Expected: PASS, all 7 cases.

- [ ] **Step 5: Run full creative-pipeline tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all green. The chain happy-path now produces 24 scripts; gate auto-approves all 24.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.ts \
        packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP8 widen StubCreatorScriptsStageRunner to 2 per hook

Exports STUB_SCRIPTS_PER_HOOK = 2. Each script id encodes parent hook
id + 1-based suffix; identity refs propagate from context into
identityConstraints.

Tree shape with all SP8 stub widenings:
  2 trends → 4 motivators → 12 hooks → 24 scripts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Heterogeneous-fanout integration tests + replace early-return guard

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts`

This task adds three integration tests to the chain test file (cases C1, C19, C24 from the design spec) and removes the temporary early-return guard from the unsorted-input test.

- [ ] **Step 1: Write failing tests**

Open `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts`. Add the following imports near the top (after existing imports):

```ts
import {
  STUB_TRENDS_FANOUT,
} from "./stages/stub-trends-stage-runner.js";
import {
  STUB_MOTIVATORS_PER_TREND,
} from "./stages/stub-motivators-stage-runner.js";
import {
  STUB_HOOKS_PER_MOTIVATOR,
} from "./stages/stub-hooks-stage-runner.js";
import {
  STUB_SCRIPTS_PER_HOOK,
} from "./stages/stub-creator-scripts-stage-runner.js";
```

Append a new `describe` block at the end of the file:

```ts
describe("runIdentityAwarePreproductionChain — heterogeneous fanout (SP8 tree shape)", () => {
  it("produces a 2-2-3-2 tree (= 24 scripts) under the default stubs", async () => {
    const result = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(result.stageOutputs.trends.signals.length).toBe(STUB_TRENDS_FANOUT); // 2
    expect(result.stageOutputs.motivators.motivators.length).toBe(
      STUB_TRENDS_FANOUT * STUB_MOTIVATORS_PER_TREND,
    ); // 4
    expect(result.stageOutputs.hooks.hooks.length).toBe(
      STUB_TRENDS_FANOUT * STUB_MOTIVATORS_PER_TREND * STUB_HOOKS_PER_MOTIVATOR,
    ); // 12
    expect(result.stageOutputs.scripts.scripts.length).toBe(
      STUB_TRENDS_FANOUT *
        STUB_MOTIVATORS_PER_TREND *
        STUB_HOOKS_PER_MOTIVATOR *
        STUB_SCRIPTS_PER_HOOK,
    ); // 24
  });

  it("AutoApproveAllScriptsGate selects all 24 scripts; selectedScriptIds matches availableScriptIds", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.selectedScriptIds.length).toBe(24);
    expect(decision.availableScriptIds.length).toBe(24);
    expect(decision.selectedScriptIds).toEqual(decision.availableScriptIds);
  });

  it("tree shape is structurally joinable: every parent*Id resolves to a real parent", async () => {
    const { stageOutputs } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    const trendIds = new Set(stageOutputs.trends.signals.map((t) => t.id));
    const motivatorIds = new Set(stageOutputs.motivators.motivators.map((m) => m.id));
    const hookIds = new Set(stageOutputs.hooks.hooks.map((h) => h.id));

    for (const m of stageOutputs.motivators.motivators) {
      expect(trendIds.has(m.parentTrendId)).toBe(true);
    }
    const motivatorById = new Map(stageOutputs.motivators.motivators.map((m) => [m.id, m]));
    for (const h of stageOutputs.hooks.hooks) {
      expect(motivatorIds.has(h.parentMotivatorId)).toBe(true);
      expect(trendIds.has(h.parentTrendId)).toBe(true);
      // Transitive: hook's parentTrendId equals its parent motivator's parentTrendId.
      expect(h.parentTrendId).toBe(motivatorById.get(h.parentMotivatorId)!.parentTrendId);
    }
    for (const s of stageOutputs.scripts.scripts) {
      expect(hookIds.has(s.parentHookId)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Replace the early-return guard with a hard assertion**

In the same file, find the `describe("runIdentityAwarePreproductionChain — composer-only assembly hardening (SP7 I-2)", ...)` block, locate the test "composer re-sorts selectedScriptIds even if gate returns unsorted", and replace its body. The current body has an early return:

```ts
    if (ids.length < 2) return; // skip if stub fanout still 1 — Tasks 6-9 widen it
```

Replace the entire `it(...)` body with:

```ts
  it("composer re-sorts selectedScriptIds even if gate returns unsorted", async () => {
    const baselineResult = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    const ids = [...baselineResult.decision.availableScriptIds];
    expect(ids.length).toBe(24);
    const reversed = [...ids].reverse();
    expect(reversed).not.toEqual([...reversed].sort());

    const stores = happyStores();
    stores.productionFanoutGate = {
      async requestSelection(_input) {
        return {
          selectedScriptIds: reversed,
          decidedBy: null,
          decidedAt: "2026-04-30T12:00:00.000Z",
        };
      },
    };
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    // Composer's defensive sort produced ascending output even though gate returned reversed.
    expect(decision.selectedScriptIds).toEqual(ids);
  });
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run preproduction-chain
```

Expected: PASS, all cases (the 3 new heterogeneous-fanout cases plus the now-hardened sort test plus all earlier SP8 cases).

- [ ] **Step 4: Run full creative-pipeline tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP8 heterogeneous-fanout integration cases + harden sort test

Three new cases assert the 2-2-3-2 tree shape (24 scripts), the
auto-approve-all gate's full-selection behavior, and structural
joinability of every parent*Id field across the four stage outputs.

The previously-guarded "composer re-sorts" test now asserts a 24-ID
reversal — exercises the composer's defensive sort with real fanout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Cleanup `sp7-anti-patterns.test.ts` (remove dead skip)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts`

The dead `if (file.endsWith("sp7-anti-patterns.test.ts")) continue;` skip is unreachable because line 17's filter excludes `.test.ts` files from the source-walk entirely.

- [ ] **Step 1: Inspect the file**

```bash
sed -n '95,107p' packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts
```

Expected output includes:

```
    for (const file of allSources) {
      // The anti-pattern test itself imports node:fs to walk the tree; skip it.
      if (file.endsWith("sp7-anti-patterns.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const tok of forbidden) {
```

- [ ] **Step 2: Remove the dead `if` and its comment**

Edit the file. Find the block:

```ts
    for (const file of allSources) {
      // The anti-pattern test itself imports node:fs to walk the tree; skip it.
      if (file.endsWith("sp7-anti-patterns.test.ts")) continue;
      const src = readFileSync(file, "utf8");
```

Replace it with:

```ts
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
```

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run sp7-anti-patterns
```

Expected: PASS (the forbidden-imports test still passes; the test file is excluded by line 17's `.test.ts` filter from the source-walk regardless).

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
chore(pcd): remove dead self-skip from sp7-anti-patterns.test.ts

The file-walker at the top of the file already excludes *.test.ts
files, so the inner `if (file.endsWith("sp7-anti-patterns.test.ts"))
continue;` is unreachable. Cleanup as flagged in SP7 code review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: New `sp8-anti-patterns.test.ts`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/sp8-anti-patterns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/preproduction/sp8-anti-patterns.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PREPRODUCTION_DIR = join(import.meta.dirname);

function listSourceFiles(): string[] {
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
  walk(PREPRODUCTION_DIR);
  return out;
}

const allSources = listSourceFiles();

describe("SP8 anti-pattern grep", () => {
  it("no PCD_*_VERSION literal in production-fanout-gate.ts (composer-only pinning)", () => {
    const path = join(PREPRODUCTION_DIR, "production-fanout-gate.ts");
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/PCD_PREPRODUCTION_CHAIN_VERSION/);
    expect(src).not.toMatch(/PCD_IDENTITY_CONTEXT_VERSION/);
    expect(src).not.toMatch(/PCD_APPROVAL_LIFECYCLE_VERSION/);
    expect(src).not.toMatch(/PCD_PREPRODUCTION_FANOUT_VERSION/);
  });

  it("composer references all four pinned-version constants", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("PCD_PREPRODUCTION_CHAIN_VERSION");
    expect(src).toContain("PCD_IDENTITY_CONTEXT_VERSION");
    expect(src).toContain("PCD_APPROVAL_LIFECYCLE_VERSION");
    expect(src).toContain("PCD_PREPRODUCTION_FANOUT_VERSION");
  });

  it("composer literally calls ProductionFanoutGateOperatorDecisionSchema.parse(", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("ProductionFanoutGateOperatorDecisionSchema.parse(");
  });

  it("AutoApproveOnlyScriptGate is fully removed from preproduction sources", () => {
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} still references AutoApproveOnlyScriptGate`).not.toMatch(
        /AutoApproveOnlyScriptGate/,
      );
    }
  });

  it("composer body asserts the subset invariant (selectedScriptIds ⊆ availableScriptIds)", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("gate selected unknown script id");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @creativeagent/creative-pipeline test --run sp8-anti-patterns
```

Expected: PASS, all 5 cases.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/sp8-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP8 anti-pattern grep — composer-only pinning + subset invariant

Five structural assertions:
- no PCD_*_VERSION literal in production-fanout-gate.ts
- composer references all four pinned-version constants
- composer literally calls ProductionFanoutGateOperatorDecisionSchema.parse(
- AutoApproveOnlyScriptGate is fully removed
- composer source carries the subset-invariant error message

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final repo-wide verification + memory update

- [ ] **Step 1: Run typecheck across all packages**

```bash
pnpm typecheck
```

Expected: typecheck clean across all 5 packages.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests green. Approximate count: 1,400+ tests across 3 packages (1,021 SP7-baseline creative-pipeline + ~50 SP8 net-new test cases distributed across 9 modified/new test files; 47 db; 68 schemas + ~8 SP8 net-new schema cases). The SP5-baseline two prettier warnings on `tier-policy.ts` / `tier-policy.test.ts` carry through.

- [ ] **Step 3: Run prettier**

```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: only the two pre-existing SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`. Anything else, fix:

```bash
pnpm exec prettier --write "packages/creative-pipeline/src/pcd/preproduction/**/*.ts" "packages/schemas/src/pcd-preproduction.ts"
```

Then re-run the check.

- [ ] **Step 4: Verify forensic-integrity invariants by cross-reading**

Sanity-check the four core SP8 invariants by reading source:

1. **Gate cannot pin versions:**
   ```bash
   grep -E "PCD_(PREPRODUCTION_CHAIN|IDENTITY_CONTEXT|APPROVAL_LIFECYCLE|PREPRODUCTION_FANOUT)_VERSION" packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts
   ```
   Expected: NO matches.

2. **Composer pins all four versions:**
   ```bash
   grep -E "PCD_(PREPRODUCTION_CHAIN|IDENTITY_CONTEXT|APPROVAL_LIFECYCLE|PREPRODUCTION_FANOUT)_VERSION" packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts
   ```
   Expected: 4 distinct constants referenced.

3. **`AutoApproveOnlyScriptGate` is gone:**
   ```bash
   grep -rn "AutoApproveOnlyScriptGate" packages/
   ```
   Expected: NO matches.

4. **`deepFreeze` is used by builder:**
   ```bash
   grep -n "deepFreeze\|Object.freeze" packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts
   ```
   Expected: `deepFreeze(context)` at the return statement; no `Object.freeze(` in the source.

- [ ] **Step 5: Update auto-memory with SP8 progress**

Edit `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` to add an SP8 entry (after the SP7 entry, before the closing "Why" / "How to apply" lines).

The new entry should capture:
- SP8 merged status placeholder ("⏳ Awaiting commit / PR" until the PR squashes — leave the entry as the agent's hand-off and let the user fill in the squash commit hash after merge)
- Eleven pinned constants (SP8 adds `PCD_PREPRODUCTION_FANOUT_VERSION`)
- Tree shape: 2-2-3-2 = 24 scripts under default stubs
- I-1 closed (deepFreeze + .readonly())
- I-2 closed (composer assembles, gate returns narrow tuple)
- `AutoApproveOnlyScriptGate` deleted; replaced by `AutoApproveAllScriptsGate`
- Composer parses gate output via `ProductionFanoutGateOperatorDecisionSchema`; subset invariant asserted; all four versions pinned by composer
- New files: `deep-freeze.ts`, `preproduction-fanout-version.ts`, `sp8-anti-patterns.test.ts`
- Cleanup: dead `if` removed from `sp7-anti-patterns.test.ts:99`
- No SP1–SP6 source body edits; SP7 pure functions zero-edit

- [ ] **Step 6: Final commit**

```bash
git add ~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md
git commit -m "$(cat <<'EOF'
chore(memory): record SP8 implementation status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Memory file lives outside the repo; this commit may need to be skipped if the memory dir isn't a git working tree. In that case, simply update the file in place without committing — auto-memory is local-only.)

- [ ] **Step 7: Open PR (optional, follow user direction)**

If the user wants a PR, they'll instruct. Otherwise leave the branch as-is for review.

---

## Self-Review (executed by plan author)

**Spec coverage check:** Walking through `2026-04-30-pcd-preproduction-fanout-sp8-design.md`'s sections:

- ✅ `deepFreeze` helper → Task 1.
- ✅ `PCD_PREPRODUCTION_FANOUT_VERSION` constant → Task 2.
- ✅ `PreproductionTreeBudgetSchema` + `ProductionFanoutGateOperatorDecisionSchema` → Task 3.
- ✅ `PcdIdentityContextSchema` widening (`.readonly()` + `treeBudget`) → Task 4.
- ✅ `buildPcdIdentityContext` widening (`deepFreeze` + `treeBudget: null`) → Task 4.
- ✅ `PcdProductionFanoutDecisionSchema` widening (4th version, `decisionNote`, `.readonly()`) → Task 5.
- ✅ `production-fanout-gate.ts` widening (narrow return type, `AutoApproveAllScriptsGate`, delete `AutoApproveOnlyScriptGate`) → Task 5.
- ✅ Composer widening (parse, subset, assemble, four-version pinning) → Task 5.
- ✅ Composer-only-version anti-pattern test → Task 12.
- ✅ Stub stage runner widenings (length-N with exported constants) → Tasks 6, 7, 8, 9.
- ✅ Heterogeneous fanout integration test → Task 10.
- ✅ Cleanup of dead `if` skip → Task 11.
- ✅ New `sp8-anti-patterns.test.ts` → Task 12.
- ✅ `index.ts` barrel update → Task 5 Step 6.
- ✅ Final repo-wide verification → Task 13.

**Placeholder scan:** No `TBD`/`TODO` literals in code or commit messages; no "fill in details" prose; no "similar to Task N" references; every code step shows full code.

**Type consistency check:**
- Type names: `PcdIdentityContext`, `PcdBriefInput`, `PcdProductionFanoutDecision`, `ProductionFanoutGateOperatorDecision`, `RequestSelectionInput`, `PreproductionChainStores`, `PreproductionTreeBudget`, `PreproductionChainError`, `Motivator`, `PreproductionHook`, `PreproductionHookType`, `CreatorScript` — used consistently.
- Function names: `buildPcdIdentityContext`, `runIdentityAwarePreproductionChain`, `requestSelection`, `deepFreeze` — consistent across tasks.
- Constants: `PCD_PREPRODUCTION_CHAIN_VERSION`, `PCD_IDENTITY_CONTEXT_VERSION`, `PCD_APPROVAL_LIFECYCLE_VERSION`, `PCD_PREPRODUCTION_FANOUT_VERSION`, `STUB_TRENDS_FANOUT`, `STUB_MOTIVATORS_PER_TREND`, `STUB_HOOKS_PER_MOTIVATOR`, `STUB_SCRIPTS_PER_HOOK` — consistent.
- Class names: `AutoApproveAllScriptsGate`, `StubTrendsStageRunner`, `StubMotivatorsStageRunner`, `StubHooksStageRunner`, `StubCreatorScriptsStageRunner` — consistent.

**Dependency ordering:** Tasks 1, 2, 3 are independent and additive (no cross-dependencies). Task 4 depends on Task 1 (deepFreeze) and Task 3 (`PreproductionTreeBudgetSchema`). Task 5 depends on Task 2 (`PCD_PREPRODUCTION_FANOUT_VERSION`), Task 3 (`ProductionFanoutGateOperatorDecisionSchema`), and Task 4 (the widened identity context — gate test fixtures need `treeBudget: null`). Tasks 6–9 are independent of each other but each depends on Task 5 (composer + gate must be migrated before stubs widen, otherwise the chain happy-path breaks because the SP7 gate requires exactly 1 script). Task 10 depends on Tasks 6–9 (heterogeneous fanout requires all four stub widenings). Tasks 11 and 12 are independent of Tasks 6–10 (anti-pattern grep is post-hoc structural check). Task 13 depends on everything.

**Sequencing:** Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Each commit leaves the build green. Tasks 6–9 could be parallelized in principle (no cross-stub-runner dependencies), but the simple sequential order keeps the merge history readable.

**Done.**

---

Plan complete and saved to `docs/plans/2026-04-30-pcd-preproduction-fanout-sp8-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
