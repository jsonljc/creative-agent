# PCD SP2 — `PcdTierPolicy` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PCD tier policy gate — a single pure function plus four Zod schemas — exactly as specified in `docs/plans/2026-04-28-pcd-tier-policy-sp2-design.md`.

**Architecture:** SP2 is a deterministic gate. Schemas live in `@creativeagent/schemas`; the pure function lives in `@creativeagent/creative-pipeline` and depends only on schemas. No DB, no I/O, no router, no provider, no snapshot, no QC, no approval, no consent.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod, Vitest, pnpm workspaces.

---

## Reference reading (before any task)

1. `docs/plans/2026-04-28-pcd-tier-policy-sp2-design.md` — the source of truth. Read all four sections.
2. `docs/plans/2026-04-28-pcd-sp2-handoff.md` — context on what SP1 shipped.
3. `packages/schemas/src/pcd-identity.ts` — existing `IdentityTierSchema` to reuse.
4. `packages/creative-pipeline/src/pcd/registry-backfill.test.ts` — reference for Vitest style in this repo.

## File structure (locked)

| Path | Action | Purpose |
|---|---|---|
| `packages/schemas/src/pcd-tier-policy.ts` | **Create** | Defines `PcdShotTypeSchema`, `OutputIntentSchema`, `PcdRequiredActionSchema`, `PcdTierDecisionSchema` and inferred TS types. |
| `packages/schemas/src/__tests__/pcd-tier-policy.test.ts` | **Create** | Schema validation tests. |
| `packages/schemas/src/index.ts` | **Modify** | Re-export the new schemas/types. |
| `packages/creative-pipeline/src/pcd/tier-policy.ts` | **Create** | Exports `PCD_TIER_POLICY_VERSION` and `decidePcdGenerationAccess`. |
| `packages/creative-pipeline/src/pcd/tier-policy.test.ts` | **Create** | Cross-product matrix + named acceptance + contract + forbidden-imports tests. |
| `packages/creative-pipeline/src/index.ts` | **Modify** | Re-export `decidePcdGenerationAccess` and `PCD_TIER_POLICY_VERSION`. |

No other files are touched.

## Hard guardrails

- `tier-policy.ts` may import only from `@creativeagent/schemas`.
- No `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `http`, `https`.
- No provider/router/resolver imports.
- No `Date.now()`, `Math.random()`, `console.log`, side effects, exceptions for valid schema input.
- No expansion into snapshot writing, routing, resolver logic, adapter behavior, QC, approval, compliance, consent, Meta draft creation, model selection, prompt construction, camera controls, video generation, or any Higgsfield-style orchestration.

---

## Task 1: Add the four schemas with validation tests

**Files:**
- Create: `packages/schemas/src/pcd-tier-policy.ts`
- Create: `packages/schemas/src/__tests__/pcd-tier-policy.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `packages/schemas/src/__tests__/pcd-tier-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdShotTypeSchema,
  OutputIntentSchema,
  PcdRequiredActionSchema,
  PcdTierDecisionSchema,
  type PcdShotType,
  type OutputIntent,
  type PcdRequiredAction,
  type PcdTierDecision,
} from "../pcd-tier-policy.js";

describe("PcdShotTypeSchema", () => {
  it("accepts every shot type and rejects meta_ad_draft", () => {
    const valid: PcdShotType[] = [
      "script_only",
      "storyboard",
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const v of valid) expect(PcdShotTypeSchema.parse(v)).toBe(v);
    expect(() => PcdShotTypeSchema.parse("meta_ad_draft")).toThrow();
    expect(() => PcdShotTypeSchema.parse("garbage")).toThrow();
  });
});

describe("OutputIntentSchema", () => {
  it("accepts the four intents", () => {
    const valid: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
    for (const v of valid) expect(OutputIntentSchema.parse(v)).toBe(v);
    expect(() => OutputIntentSchema.parse("publish")).toThrow();
  });
});

describe("PcdRequiredActionSchema", () => {
  it("accepts the four canonical actions", () => {
    const valid: PcdRequiredAction[] = [
      "upgrade_avatar_identity",
      "upgrade_product_identity",
      "use_lower_output_intent",
      "choose_safer_shot_type",
    ];
    for (const v of valid) expect(PcdRequiredActionSchema.parse(v)).toBe(v);
    expect(() => PcdRequiredActionSchema.parse("nope")).toThrow();
  });
});

describe("PcdTierDecisionSchema", () => {
  it("parses an allowed minimal decision", () => {
    const parsed = PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 2 });
    expect(parsed.allowed).toBe(true);
    expect(parsed.effectiveTier).toBe(2);
    expect(parsed.reason).toBeUndefined();
    expect(parsed.requiredActions).toBeUndefined();
  });

  it("parses a blocked decision with optional fields", () => {
    const decision: PcdTierDecision = {
      allowed: false,
      effectiveTier: 1,
      requiredAvatarTier: 3,
      requiredProductTier: 2,
      reason: "generation requires avatarTier>=3 and productTier>=2",
      requiredActions: ["upgrade_avatar_identity", "upgrade_product_identity"],
    };
    const parsed = PcdTierDecisionSchema.parse(decision);
    expect(parsed).toEqual(decision);
  });

  it("rejects out-of-range tiers", () => {
    expect(() => PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 4 })).toThrow();
    expect(() => PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-tier-policy`
Expected: FAIL with module-not-found on `../pcd-tier-policy.js`.

- [ ] **Step 3: Create the schema module**

Create `packages/schemas/src/pcd-tier-policy.ts`:

```ts
import { z } from "zod";
import { IdentityTierSchema } from "./pcd-identity.js";

export const PcdShotTypeSchema = z.enum([
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
]);
export type PcdShotType = z.infer<typeof PcdShotTypeSchema>;

export const OutputIntentSchema = z.enum([
  "draft",
  "preview",
  "final_export",
  "meta_draft",
]);
export type OutputIntent = z.infer<typeof OutputIntentSchema>;

export const PcdRequiredActionSchema = z.enum([
  "upgrade_avatar_identity",
  "upgrade_product_identity",
  "use_lower_output_intent",
  "choose_safer_shot_type",
]);
export type PcdRequiredAction = z.infer<typeof PcdRequiredActionSchema>;

export const PcdTierDecisionSchema = z.object({
  allowed: z.boolean(),
  effectiveTier: IdentityTierSchema,
  requiredAvatarTier: IdentityTierSchema.optional(),
  requiredProductTier: IdentityTierSchema.optional(),
  reason: z.string().optional(),
  requiredActions: z.array(PcdRequiredActionSchema).optional(),
});
export type PcdTierDecision = z.infer<typeof PcdTierDecisionSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-tier-policy`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-tier-policy.ts packages/schemas/src/__tests__/pcd-tier-policy.test.ts
git commit -m "feat(schemas): add PCD tier-policy schemas (SP2)"
```

---

## Task 2: Re-export schemas from `@creativeagent/schemas` index

**Files:**
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Add the re-export line**

Open `packages/schemas/src/index.ts` and add a line so it reads:

```ts
// PCD Identity Registry — public schema surface
export * from "./pcd-identity.js";
export * from "./pcd-tier-policy.js";
export * from "./creator-identity.js";
export * from "./creative-job.js";
```

- [ ] **Step 2: Typecheck the schemas package**

Run: `pnpm --filter @creativeagent/schemas typecheck`
Expected: 0 errors.

- [ ] **Step 3: Verify consumers can import the new symbols**

Run: `pnpm typecheck`
Expected: 0 errors across all packages.

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/index.ts
git commit -m "feat(schemas): re-export PCD tier-policy schemas (SP2)"
```

---

## Task 3: Scaffold `tier-policy.ts` and lock the version constant

**Files:**
- Create: `packages/creative-pipeline/src/pcd/tier-policy.ts`
- Create: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

- [ ] **Step 1: Write the version-constant test**

Create `packages/creative-pipeline/src/pcd/tier-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_TIER_POLICY_VERSION, decidePcdGenerationAccess } from "./tier-policy.js";

describe("PCD_TIER_POLICY_VERSION", () => {
  it("is locked to tier-policy@1.0.0 (SP4 snapshot writer pins this value)", () => {
    expect(PCD_TIER_POLICY_VERSION).toBe("tier-policy@1.0.0");
  });
});

describe("decidePcdGenerationAccess (smoke)", () => {
  it("is callable", () => {
    const decision = decidePcdGenerationAccess({
      shotType: "simple_ugc",
      outputIntent: "draft",
    });
    expect(decision.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with stub implementation**

Create `packages/creative-pipeline/src/pcd/tier-policy.ts`:

```ts
import {
  type IdentityTier,
  type OutputIntent,
  type PcdShotType,
  type PcdTierDecision,
} from "@creativeagent/schemas";

export const PCD_TIER_POLICY_VERSION = "tier-policy@1.0.0";

export type DecidePcdGenerationAccessInput = {
  avatarTier?: IdentityTier;
  productTier?: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
};

export function decidePcdGenerationAccess(
  input: DecidePcdGenerationAccessInput,
): PcdTierDecision {
  const effectiveTier = (Math.min(input.avatarTier ?? 1, input.productTier ?? 1) as IdentityTier);

  // Step 1 — Draft shortcut.
  if (input.outputIntent === "draft") {
    return { allowed: true, effectiveTier };
  }

  // Full logic wired in Task 4.
  return { allowed: true, effectiveTier };
}
```

> The stub returns `allowed: true` for every non-draft case. Task 4 replaces the function body with the real logic. The stub is intentionally minimal so Task 4 is a focused diff.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/tier-policy.ts packages/creative-pipeline/src/pcd/tier-policy.test.ts
git commit -m "feat(pipeline): scaffold PcdTierPolicy with version constant (SP2)"
```

---

## Task 4: Implement the full decision logic

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/tier-policy.ts`
- Modify: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

This task adds the 8 spec-required named acceptance tests (red), then completes the implementation (green). The named tests collectively drive every branch of the decision logic.

- [ ] **Step 1: Add the 8 named acceptance tests**

Append to `packages/creative-pipeline/src/pcd/tier-policy.test.ts`:

```ts
import type { PcdShotType, PcdTierDecision } from "@creativeagent/schemas";

const ALL_SHOT_TYPES: PcdShotType[] = [
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];

describe("PcdTierPolicy — spec-required acceptance assertions", () => {
  it("1. Tier 3 avatar + Tier 1 product cannot final_export", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 1,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBe(1);
    expect(d.requiredProductTier).toBe(2);
    expect(d.requiredActions).toContain("upgrade_product_identity");
    expect(d.requiredActions).toContain("use_lower_output_intent");
  });

  it("2. Tier 1 avatar + Tier 3 product cannot final_export", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 3,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBe(1);
    expect(d.requiredAvatarTier).toBe(2);
    expect(d.requiredActions).toContain("upgrade_avatar_identity");
    expect(d.requiredActions).toContain("use_lower_output_intent");
  });

  it("3. Tier 2 + Tier 2 can standard final_export (non-restricted shot)", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d).toEqual({ allowed: true, effectiveTier: 2 });
  });

  it("4. label_closeup requires productTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 2,
      shotType: "label_closeup",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredProductTier).toBe(3);

    const allowed = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 3,
      shotType: "label_closeup",
      outputIntent: "preview",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 3 });
  });

  it("5. face_closeup requires avatarTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 3,
      shotType: "face_closeup",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredAvatarTier).toBe(3);

    const allowed = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 3,
      shotType: "face_closeup",
      outputIntent: "preview",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 3 });
  });

  it("6. object_insert requires productTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 2,
      shotType: "object_insert",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredProductTier).toBe(3);
  });

  it("7. meta_draft requires effectiveTier>=2; SP2 does NOT enforce approval/compliance (SP6 owns those)", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "meta_draft",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredAvatarTier).toBe(2);

    // Tier-sufficient meta_draft passes the SP2 gate. SP6 layers approval + compliance.
    const allowed = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "meta_draft",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 2 });
  });

  it("8. outputIntent=draft is always allowed regardless of tier", () => {
    for (const a of [undefined, 1, 2, 3] as const) {
      for (const p of [undefined, 1, 2, 3] as const) {
        for (const shotType of ALL_SHOT_TYPES) {
          const d: PcdTierDecision = decidePcdGenerationAccess({
            avatarTier: a,
            productTier: p,
            shotType,
            outputIntent: "draft",
          });
          expect(d.allowed).toBe(true);
          expect(Object.keys(d).sort()).toEqual(["allowed", "effectiveTier"]);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify failures**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: FAIL on tests 1, 2, 4, 5, 6, 7 (the stub returns `allowed: true` for everything except draft); tests 3 and 8 may already pass.

- [ ] **Step 3: Replace `decidePcdGenerationAccess` with the full implementation**

In `packages/creative-pipeline/src/pcd/tier-policy.ts`, add `PcdRequiredAction` to the import block:

```ts
import {
  type IdentityTier,
  type OutputIntent,
  type PcdRequiredAction,
  type PcdShotType,
  type PcdTierDecision,
} from "@creativeagent/schemas";
```

Then replace the body of `decidePcdGenerationAccess` with:

```ts
export function decidePcdGenerationAccess(
  input: DecidePcdGenerationAccessInput,
): PcdTierDecision {
  const a: IdentityTier = (input.avatarTier ?? 1) as IdentityTier;
  const p: IdentityTier = (input.productTier ?? 1) as IdentityTier;
  const effectiveTier: IdentityTier = (a <= p ? a : p) as IdentityTier;

  // Step 1 — Draft shortcut. Internal-only, never publishable.
  if (input.outputIntent === "draft") {
    return { allowed: true, effectiveTier };
  }

  // Steps 2–4 — Compose total requirements.
  let requiredAvatarTier: IdentityTier = 1;
  let requiredProductTier: IdentityTier = 1;
  if (input.shotType === "face_closeup") requiredAvatarTier = 3;
  if (input.shotType === "label_closeup") requiredProductTier = 3;
  if (input.shotType === "object_insert") requiredProductTier = 3;
  if (input.outputIntent === "final_export" || input.outputIntent === "meta_draft") {
    if (requiredAvatarTier < 2) requiredAvatarTier = 2;
    if (requiredProductTier < 2) requiredProductTier = 2;
  }

  // Step 5 — Compare actuals and aggregate actions.
  const actions: PcdRequiredAction[] = [];
  if (a < requiredAvatarTier) actions.push("upgrade_avatar_identity");
  if (p < requiredProductTier) actions.push("upgrade_product_identity");
  if (
    (input.outputIntent === "final_export" || input.outputIntent === "meta_draft") &&
    effectiveTier < 2
  ) {
    if (!actions.includes("use_lower_output_intent")) {
      actions.push("use_lower_output_intent");
    }
  }

  // Step 6 — Decide.
  const passes = actions.length === 0;
  if (passes) {
    return { allowed: true, effectiveTier };
  }

  return {
    allowed: false,
    effectiveTier,
    requiredAvatarTier,
    requiredProductTier,
    reason: buildReason(requiredAvatarTier, requiredProductTier),
    requiredActions: canonicalize(actions),
  };
}

function buildReason(reqA: IdentityTier, reqP: IdentityTier): string {
  const aboveA = reqA > 1;
  const aboveP = reqP > 1;
  if (aboveA && aboveP) {
    return `generation requires avatarTier>=${reqA} and productTier>=${reqP}`;
  }
  if (aboveA) return `generation requires avatarTier>=${reqA}`;
  return `generation requires productTier>=${reqP}`;
}

const ACTION_ORDER: readonly PcdRequiredAction[] = [
  "upgrade_avatar_identity",
  "upgrade_product_identity",
  "use_lower_output_intent",
  "choose_safer_shot_type",
];

function canonicalize(actions: PcdRequiredAction[]): PcdRequiredAction[] {
  const set = new Set(actions);
  return ACTION_ORDER.filter((a) => set.has(a));
}
```

The full file should now contain: the import block, `PCD_TIER_POLICY_VERSION`, the `DecidePcdGenerationAccessInput` type, `decidePcdGenerationAccess` (with the full body above), `buildReason`, `ACTION_ORDER`, and `canonicalize`. No other top-level symbols.

- [ ] **Step 4: Run all tier-policy tests**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: PASS on all 8 named acceptance tests + the version constant + smoke tests from Task 3.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/tier-policy.ts packages/creative-pipeline/src/pcd/tier-policy.test.ts
git commit -m "feat(pipeline): implement PcdTierPolicy decision logic (SP2)"
```

---

## Task 5: Add the 576-case cross-product matrix

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

The matrix uses an **expected-outcome computer** with rule tables defined **locally in the test file** — they must NOT import from `tier-policy.ts`. This guards against the "implementation wrong, test imports same wrong table, test still passes" failure mode.

- [ ] **Step 1: Append the matrix block to the test file**

```ts
import type { OutputIntent as OI } from "@creativeagent/schemas";

type AvatarTierInput = 1 | 2 | 3 | undefined;
type ProductTierInput = 1 | 2 | 3 | undefined;

const ALL_OUTPUT_INTENTS: OI[] = ["draft", "preview", "final_export", "meta_draft"];

// Test-local rule tables. DO NOT import from tier-policy.ts.
const SHOT_TYPE_REQ: Record<PcdShotType, { avatar?: 2 | 3; product?: 2 | 3 }> = {
  script_only: {},
  storyboard: {},
  simple_ugc: {},
  talking_head: {},
  product_demo: {},
  product_in_hand: {},
  face_closeup: { avatar: 3 },
  label_closeup: { product: 3 },
  object_insert: { product: 3 },
};

const INTENT_REQ: Record<OI, { effective?: 2 } | "draft_shortcut"> = {
  draft: "draft_shortcut",
  preview: {},
  final_export: { effective: 2 },
  meta_draft: { effective: 2 },
};

function expectedDecision(
  avatarTier: AvatarTierInput,
  productTier: ProductTierInput,
  shotType: PcdShotType,
  outputIntent: OI,
): PcdTierDecision {
  const a = (avatarTier ?? 1) as 1 | 2 | 3;
  const p = (productTier ?? 1) as 1 | 2 | 3;
  const effectiveTier = (a <= p ? a : p) as 1 | 2 | 3;

  if (INTENT_REQ[outputIntent] === "draft_shortcut") {
    return { allowed: true, effectiveTier };
  }

  const shot = SHOT_TYPE_REQ[shotType];
  const intent = INTENT_REQ[outputIntent] as { effective?: 2 };

  let reqA: 1 | 2 | 3 = 1;
  let reqP: 1 | 2 | 3 = 1;
  if (shot.avatar) reqA = shot.avatar;
  if (shot.product) reqP = shot.product;
  if (intent.effective === 2) {
    if (reqA < 2) reqA = 2;
    if (reqP < 2) reqP = 2;
  }

  const actions: string[] = [];
  if (a < reqA) actions.push("upgrade_avatar_identity");
  if (p < reqP) actions.push("upgrade_product_identity");
  if (
    (outputIntent === "final_export" || outputIntent === "meta_draft") &&
    effectiveTier < 2
  ) {
    actions.push("use_lower_output_intent");
  }

  if (actions.length === 0) return { allowed: true, effectiveTier };

  const reason =
    reqA > 1 && reqP > 1
      ? `generation requires avatarTier>=${reqA} and productTier>=${reqP}`
      : reqA > 1
        ? `generation requires avatarTier>=${reqA}`
        : `generation requires productTier>=${reqP}`;

  return {
    allowed: false,
    effectiveTier,
    requiredAvatarTier: reqA,
    requiredProductTier: reqP,
    reason,
    requiredActions: actions as PcdTierDecision["requiredActions"],
  };
}

const TIER_INPUTS: AvatarTierInput[] = [undefined, 1, 2, 3];

const MATRIX_ROWS: Array<{
  a: AvatarTierInput;
  p: ProductTierInput;
  s: PcdShotType;
  i: OI;
  expected: PcdTierDecision;
}> = [];
for (const a of TIER_INPUTS) {
  for (const p of TIER_INPUTS) {
    for (const s of ALL_SHOT_TYPES) {
      for (const i of ALL_OUTPUT_INTENTS) {
        MATRIX_ROWS.push({ a, p, s, i, expected: expectedDecision(a, p, s, i) });
      }
    }
  }
}

describe("PcdTierPolicy — full cross-product matrix (576 cases)", () => {
  it.each(MATRIX_ROWS)(
    "a=$a p=$p shot=$s intent=$i",
    ({ a, p, s, i, expected }) => {
      const actual = decidePcdGenerationAccess({
        avatarTier: a,
        productTier: p,
        shotType: s,
        outputIntent: i,
      });
      expect(actual).toEqual(expected);
    },
  );

  it("matrix size is exactly 576", () => {
    expect(MATRIX_ROWS.length).toBe(576);
  });
});
```

- [ ] **Step 2: Run the matrix**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: PASS on all 576 matrix cases plus the existing tests.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/tier-policy.test.ts
git commit -m "test(pipeline): full cross-product matrix for PcdTierPolicy (SP2)"
```

---

## Task 6: Add contract tests (purity, shape, reason, schema round-trip)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

- [ ] **Step 1: Append the contract block**

```ts
import { PcdTierDecisionSchema } from "@creativeagent/schemas";

describe("PcdTierPolicy — contract & shape", () => {
  it("determinism smoke: two calls with the same blocked input return deeply equal results", () => {
    const input = {
      avatarTier: 1,
      productTier: 1,
      shotType: "face_closeup",
      outputIntent: "final_export",
    } as const;
    const a = decidePcdGenerationAccess(input);
    const b = decidePcdGenerationAccess(input);
    expect(a).toEqual(b);
  });

  it("determinism smoke: two calls with the same allowed input return deeply equal results", () => {
    const input = {
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "preview",
    } as const;
    const a = decidePcdGenerationAccess(input);
    const b = decidePcdGenerationAccess(input);
    expect(a).toEqual(b);
  });

  it("allowed decision shape is minimal: only allowed + effectiveTier", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "preview",
    });
    expect(Object.keys(d).sort()).toEqual(["allowed", "effectiveTier"]);
  });

  it("blocked decision: requiredActions are deduplicated and in canonical order", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 1,
      shotType: "face_closeup",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.requiredActions).toEqual([
      "upgrade_avatar_identity",
      "upgrade_product_identity",
      "use_lower_output_intent",
    ]);
  });

  describe("reason-string rule", () => {
    it("both tiers above 1 required", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 1,
        productTier: 1,
        shotType: "face_closeup",
        outputIntent: "final_export",
      });
      expect(d.reason).toBe("generation requires avatarTier>=3 and productTier>=2");
    });

    it("only avatar required above 1", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 1,
        productTier: 3,
        shotType: "face_closeup",
        outputIntent: "preview",
      });
      expect(d.reason).toBe("generation requires avatarTier>=3");
    });

    it("only product required above 1", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 3,
        productTier: 1,
        shotType: "label_closeup",
        outputIntent: "preview",
      });
      expect(d.reason).toBe("generation requires productTier>=3");
    });
  });

  it("schema round-trip: every matrix output passes PcdTierDecisionSchema.parse", () => {
    for (const row of MATRIX_ROWS) {
      const actual = decidePcdGenerationAccess({
        avatarTier: row.a,
        productTier: row.p,
        shotType: row.s,
        outputIntent: row.i,
      });
      expect(() => PcdTierDecisionSchema.parse(actual)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: PASS on all contract tests.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/tier-policy.test.ts
git commit -m "test(pipeline): contract & shape tests for PcdTierPolicy (SP2)"
```

---

## Task 7: Add the forbidden-imports guard test

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

- [ ] **Step 1: Append the import-guard block**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

describe("PcdTierPolicy — forbidden imports guard (Layer 2 purity)", () => {
  it("tier-policy.ts source contains no forbidden module references", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "tier-policy.ts"), "utf8");
    const banned = [
      "@creativeagent/db",
      "@prisma/client",
      "inngest",
      'from "node:fs"',
      "from 'node:fs'",
      'from "http"',
      "from 'http'",
      'from "https"',
      "from 'https'",
    ];
    for (const needle of banned) {
      expect(source).not.toContain(needle);
    }
  });
});
```

> **Note on `node:fs`:** the import guard test itself uses `node:fs` to read the source file, but the guard *only* inspects `tier-policy.ts`, not the test file. `tier-policy.ts` must remain free of all listed banned imports.

- [ ] **Step 2: Run all tier-policy tests**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- tier-policy`
Expected: PASS — the guard finds no forbidden imports in `tier-policy.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/tier-policy.test.ts
git commit -m "test(pipeline): forbidden-imports guard for PcdTierPolicy (SP2)"
```

---

## Task 8: Re-export from `creative-pipeline` package index and final verification

**Files:**
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 1: Add the re-export**

Open `packages/creative-pipeline/src/index.ts` and update to:

```ts
// PCD — Product/Creator Definition primitives
// SP1: registry-backfill (Inngest function)
// SP2: tier-policy (pure deterministic gate)
export * from "./pcd/registry-backfill.js";
export { decidePcdGenerationAccess, PCD_TIER_POLICY_VERSION } from "./pcd/tier-policy.js";
export type { DecidePcdGenerationAccessInput } from "./pcd/tier-policy.js";
```

- [ ] **Step 2: Run the full repo verification suite**

Run each in order:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expected:
- `typecheck`: 0 errors across all packages.
- `test`: all tests pass; in particular every test under `pcd-tier-policy.test.ts` (schemas) and `tier-policy.test.ts` (pipeline) is green.
- `lint`: 0 errors. Pre-existing warnings unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/index.ts
git commit -m "feat(pipeline): export PcdTierPolicy from package index (SP2)"
```

- [ ] **Step 4: Final sanity check on file inventory**

Run: `git diff --stat 51dbbf5..HEAD`

Expected files changed (no others):
- `packages/schemas/src/pcd-tier-policy.ts` (new)
- `packages/schemas/src/__tests__/pcd-tier-policy.test.ts` (new)
- `packages/schemas/src/index.ts` (modified — one added line)
- `packages/creative-pipeline/src/pcd/tier-policy.ts` (new)
- `packages/creative-pipeline/src/pcd/tier-policy.test.ts` (new)
- `packages/creative-pipeline/src/index.ts` (modified — added re-exports)

If any other file appears in the diff, stop and reconcile against the design doc before continuing.

---

## Done. SP2 ships.

When all tasks pass:
- 4 new schemas exported from `@creativeagent/schemas`.
- 1 pure function + 1 version constant exported from `@creativeagent/creative-pipeline`.
- Full 576-case matrix + 8 named acceptance + contract + forbidden-imports tests green.
- Zero behavior change to live PCD execution; nothing reads from this gate yet.
- SP3 will wire `decidePcdGenerationAccess` into PCD job creation.
- SP4 will pin `PCD_TIER_POLICY_VERSION` into `PcdIdentitySnapshot`.
