# SP16 — PCD Synthetic Provider Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the PCD synthetic-creator provider-routing layer: a pure `routeSyntheticPcdShot({resolvedContext, syntheticIdentity, shotType, outputIntent, approvedCampaignContext}, stores)` wrapping SP4's `routePcdShot` for non-pairing shots and emitting a locked DALL-E + Kling pairing decision for in-pairing shots, plus a 1-row `PCD_SYNTHETIC_PROVIDER_PAIRING` matrix, the 20th pinned PCD constant `PCD_SYNTHETIC_ROUTER_VERSION` and 21st pinned constant `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION`, plus a net-new zod analogue `PcdRoutingDecisionSchema` for SP4's TypeScript-only `PcdRoutingDecision` type so the delegation branch round-trips.

**Architecture:** Pure wrapping function over caller-supplied `CreatorIdentitySyntheticPayload` (matches SP15's bare-`creatorIdentityId` philosophy — loose coupling, pure decider over snapshot). Three-branch decision union: synthetic-pairing-allowed, synthetic-pairing-denied (`ACCESS_POLICY`), and `delegated_to_generic_router` (carries embedded `sp4Decision: PcdRoutingDecision`). Locked artifacts (`dallePromptLocked` text + `klingDirection` structured object) carried verbatim on the success branch — no transformation, no hashing. SP4 source body frozen; tier3 generic routing rules deliberately do NOT apply to in-pairing shots. Zero Prisma migration, zero DB-package consumer.

**Tech Stack:** TypeScript 5, pnpm workspaces, Turbo, Vitest, Zod 3.x, conventional commits.

**Spec:** `docs/plans/2026-05-15-pcd-synthetic-provider-routing-sp16-design.md` (committed in `2a33f0f` + `c4820fb`).

---

## Worktree & Subagent Discipline

**This plan executes inside `.worktrees/sp16` on branch `pcd/sp16-synthetic-provider-routing`.** Create the worktree via the `superpowers:using-git-worktrees` skill before starting Task 1. The SP16 design spec on the current `sp16-design` branch is the input contract; copy or rebase as needed when the worktree comes up.

**Every subagent prompt MUST start with this preamble:**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pwd                                    # MUST output: /Users/jasonli/creativeagent/.worktrees/sp16
git branch --show-current              # MUST output: pcd/sp16-synthetic-provider-routing
```

If either check fails the subagent must **stop and report**, not "fix" it. The `feedback_subagent_worktree_drift` memory records what happens when this gate is skipped.

**No edits to SP1–SP15 source bodies.** SP4 in particular is frozen: `routePcdShot`, `PCD_PROVIDER_CAPABILITY_MATRIX`, `tier3-routing-rules.ts`, `provider-router.ts` are read-only this slice. The only allowed cross-slice changes are allowlist maintenance in Task 13. Task 12's `sp16-anti-patterns.test.ts` includes a frozen-source-body check keyed against `9dca008` (SP15 merge tip on main).

**Schemas barrel widening lands in Task 2, NOT Task 14.** SP14 / SP15 surfaced this as a real blocker: subsequent tasks (Task 5+) import `SyntheticPcdRoutingDecision`, `PcdRoutingDecisionParsed`, etc. from `@creativeagent/schemas`. If the schemas barrel hasn't been widened by then, the import fails. Bake it into Task 2 alongside the first-consumer module.

---

## File Structure

### New files (10)

```
packages/schemas/src/
  pcd-synthetic-router.ts                                 [Task 2]
  __tests__/pcd-synthetic-router.test.ts                  [Task 2]

packages/creative-pipeline/src/pcd/synthetic-router/
  synthetic-router-version.ts                             [Task 3 — 20th pinned constant]
  synthetic-router-version.test.ts                        [Task 3]
  synthetic-provider-pairing.ts                           [Task 4 — matrix + 21st pinned constant]
  synthetic-provider-pairing.test.ts                      [Task 4]
  route-synthetic-pcd-shot.ts                             [Tasks 5–11]
  route-synthetic-pcd-shot.test.ts                        [Tasks 5–11]
  sp16-anti-patterns.test.ts                              [Task 12]
  index.ts                                                [Task 14]
```

### Modified files (2 + 7 allowlist)

```
packages/schemas/src/index.ts                             [Task 2 — schemas barrel widened upfront]
packages/creative-pipeline/src/index.ts                   [Task 14]

7 prior anti-pattern tests (Task 13 — allowlist widening only):
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts
```

`sp6-anti-patterns.test.ts`, `sp7-anti-patterns.test.ts`, `sp8-anti-patterns.test.ts`, `sp11-anti-patterns.test.ts`, `sp12-anti-patterns.test.ts` do NOT have an `allowedEdits` set — verified at plan time via `grep -L allowedEdits packages/**/sp*anti-patterns*.test.ts`. Skip those; no allowlist work.

---

### Task 1: Pre-flight checks

**Goal:** Confirm starting state matches expectations before any new code lands. Catches schema drift, missing baseline, accidental migrations.

**Files:** none modified.

- [ ] **Step 1.1: Verify SP15 baseline test count is green**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test 2>&1 | tail -20
```

Expected (totals from the three test packages):
- `@creativeagent/schemas:test`  — `247 passed`
- `@creativeagent/db:test`       — `105 passed | 2 skipped`
- `@creativeagent/creative-pipeline:test` — `1535 passed`
- Grand total: **1887 passed + 2 skipped (1889 with skips)**.

If the count differs by more than ±5, stop and reconcile before continuing — the SP16 PR must end at this baseline + ~52 net new SP16 tests.

- [ ] **Step 1.2: Confirm no accidental Prisma migration is in progress**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git diff 9dca008..HEAD -- packages/db/prisma/schema.prisma
git diff 9dca008..HEAD -- packages/db/prisma/migrations/
```

Expected: both diffs empty. SP16 has zero Prisma migration. If non-empty, stop and investigate before proceeding.

- [ ] **Step 1.3: Verify the established `z.union` carve-out is still the source convention**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
grep -n "z\\.discriminatedUnion\\|z\\.union" \
  packages/schemas/src/pcd-disclosure-template.ts \
  packages/schemas/src/pcd-script-template.ts \
  packages/schemas/src/pcd-synthetic-selector.ts
```

Expected: every match is `z.union([` (today). If any file has switched to `z.discriminatedUnion`, mirror that factory in Task 2 instead — and update the SP16 NB comment to reflect the current truth. Do not rationalise away the divergence; either match the source or stop and report.

- [ ] **Step 1.4: Verify SP4 / SP11 / SP2 source surfaces referenced by the spec actually exist**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
grep -nE "^export (async function routePcdShot|type (RoutePcdShotInput|ProviderRouterStores|ApprovedCampaignContext|PcdRoutingDecision)|const PCD_PROVIDER_ROUTER_VERSION)" \
  packages/creative-pipeline/src/pcd/provider-router.ts
grep -nE "^export (async function decidePcdGenerationAccess|type (DecidePcdGenerationAccessInput))|^export const PCD_TIER_POLICY_VERSION" \
  packages/creative-pipeline/src/pcd/tier-policy.ts
grep -nE "dallePromptLocked|klingDirection|KlingDirectionSchema|CreatorIdentitySyntheticPayloadSchema" \
  packages/schemas/src/creator-identity-synthetic.ts
grep -nE "^export type (ResolvedPcdContext)" \
  packages/creative-pipeline/src/pcd/registry-resolver.ts
```

Expected: all five files report the symbols above. The SP16 plan hard-codes these exact import paths; a rename would break the plan.

- [ ] **Step 1.5: Verify SP11 roster is re-exported from the slice barrel**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
grep -n "SP11_SYNTHETIC_CREATOR_ROSTER" \
  packages/creative-pipeline/src/pcd/synthetic-creator/index.ts \
  packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts
```

Expected: at least one match in `index.ts` (re-export line) AND at least one in `seed.ts` (the original `export const`). The Task-6 test fixture imports from `../synthetic-creator/index.js`. If `index.ts` does NOT re-export the roster, switch every test-fixture import in this plan from `../synthetic-creator/index.js` to `../synthetic-creator/seed.js` before proceeding (one-line search/replace inside `route-synthetic-pcd-shot.test.ts`).

- [ ] **Step 1.6: No commit — pre-flight is read-only.**

The worktree is clean after Step 1.6. Proceed to Task 2.

---

### Task 2: Zod surface — `pcd-synthetic-router.ts` (+ schemas barrel widen upfront)

**Goal:** Land the two zod schemas — `PcdRoutingDecisionSchema` (net-new analogue of SP4's TS-only type, owned by SP16 per design J13/U1) and `SyntheticPcdRoutingDecisionSchema` (SP16's three-branch decision union: synthetic allowed, synthetic denied, delegated). Widen the schemas barrel in the same task.

**Files:**
- Create: `packages/schemas/src/pcd-synthetic-router.ts`
- Create: `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 2.1: Write the failing schema tests**

Create `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdRoutingDecisionSchema,
  SyntheticPcdRoutingDecisionSchema,
} from "../pcd-synthetic-router.js";

const goodAccessDecisionAllowed = {
  allowed: true as const,
  effectiveTier: 3 as const,
};

const goodAccessDecisionDenied = {
  allowed: false as const,
  effectiveTier: 1 as const,
  requiredAvatarTier: 2 as const,
  requiredProductTier: 2 as const,
  reason: "generation requires avatarTier>=2 and productTier>=2",
  requiredActions: ["upgrade_avatar_identity", "upgrade_product_identity"] as const,
};

const goodKlingDirection = {
  setting: "Clinic bathroom",
  motion: "Lean in then pull back",
  energy: "Open mouth excited",
  lighting: "Fluorescent",
  avoid: ["Slow pans"],
} as const;

describe("PcdRoutingDecisionSchema", () => {
  it("round-trips SP4 ACCESS_POLICY denial", () => {
    const v = {
      allowed: false as const,
      denialKind: "ACCESS_POLICY" as const,
      accessDecision: goodAccessDecisionDenied,
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("round-trips SP4 NO_PROVIDER_CAPABILITY denial", () => {
    const v = {
      allowed: false as const,
      denialKind: "NO_PROVIDER_CAPABILITY" as const,
      accessDecision: goodAccessDecisionAllowed,
      reason: "no provider satisfies tier3 routing rules for this shot" as const,
      requiredActions: ["choose_safer_shot_type"] as const,
      candidatesEvaluated: 2,
      candidatesAfterTier3Filter: 0,
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("round-trips SP4 allowed-success", () => {
    const v = {
      allowed: true as const,
      accessDecision: goodAccessDecisionAllowed,
      selectedCapability: {
        provider: "runway",
        tiers: [3] as const,
        shotTypes: ["simple_ugc"] as const,
        outputIntents: ["draft"] as const,
        supportsFirstLastFrame: true,
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
      selectedProvider: "runway",
      providerCapabilityVersion: "provider-capability@1.0.0",
      routerVersion: "provider-router@1.0.0",
      decisionReason: {
        capabilityRefIndex: 2,
        matchedShotType: "simple_ugc" as const,
        matchedEffectiveTier: 3 as const,
        matchedOutputIntent: "draft" as const,
        tier3RulesApplied: ["first_last_frame_anchor"],
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
        selectionRationale: "tier=3 shot=simple_ugc intent=draft → runway (tier3 rules [first_last_frame_anchor])",
      },
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("rejects allowed-success with missing decisionReason.selectionRationale", () => {
    const v = {
      allowed: true as const,
      accessDecision: goodAccessDecisionAllowed,
      selectedCapability: {
        provider: "runway",
        tiers: [3] as const,
        shotTypes: ["simple_ugc"] as const,
        outputIntents: ["draft"] as const,
        supportsFirstLastFrame: true,
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
      selectedProvider: "runway",
      providerCapabilityVersion: "provider-capability@1.0.0",
      routerVersion: "provider-router@1.0.0",
      decisionReason: {
        capabilityRefIndex: 2,
        matchedShotType: "simple_ugc" as const,
        matchedEffectiveTier: 3 as const,
        matchedOutputIntent: "draft" as const,
        tier3RulesApplied: [],
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
      },
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).toThrow();
  });
});

const goodSyntheticAllowed = {
  allowed: true as const,
  kind: "synthetic_pairing" as const,
  accessDecision: goodAccessDecisionAllowed,
  imageProvider: "dalle" as const,
  videoProvider: "kling" as const,
  dallePromptLocked: "Vertical lo-fi selfie photo. Young Chinese woman, 23.",
  klingDirection: goodKlingDirection,
  pairingRefIndex: 0,
  pairingVersion: "pcd-synthetic-provider-pairing@1.0.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
  decisionReason: {
    matchedShotType: "simple_ugc" as const,
    matchedOutputIntent: "draft" as const,
    selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
  },
};

const goodSyntheticDenied = {
  allowed: false as const,
  kind: "synthetic_pairing" as const,
  denialKind: "ACCESS_POLICY" as const,
  accessDecision: goodAccessDecisionDenied,
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
};

const goodDelegated = {
  kind: "delegated_to_generic_router" as const,
  reason: "shot_type_not_in_synthetic_pairing" as const,
  shotType: "script_only" as const,
  sp4Decision: {
    allowed: true as const,
    accessDecision: goodAccessDecisionAllowed,
    selectedCapability: {
      provider: "openai_text",
      tiers: [3] as const,
      shotTypes: ["script_only"] as const,
      outputIntents: ["draft"] as const,
      supportsFirstLastFrame: false,
      supportsEditExtend: true,
      supportsPerformanceTransfer: false,
    },
    selectedProvider: "openai_text",
    providerCapabilityVersion: "provider-capability@1.0.0",
    routerVersion: "provider-router@1.0.0",
    decisionReason: {
      capabilityRefIndex: 1,
      matchedShotType: "script_only" as const,
      matchedEffectiveTier: 3 as const,
      matchedOutputIntent: "draft" as const,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "tier=3 shot=script_only intent=draft → openai_text (no tier3 rules)",
    },
  },
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
};

describe("SyntheticPcdRoutingDecisionSchema", () => {
  it("round-trips synthetic-pairing allowed", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodSyntheticAllowed)).not.toThrow();
  });

  it("round-trips synthetic-pairing denial (ACCESS_POLICY)", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodSyntheticDenied)).not.toThrow();
  });

  it("round-trips delegation envelope", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodDelegated)).not.toThrow();
  });

  it('rejects allowed branch with imageProvider !== "dalle"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, imageProvider: "midjourney" }),
    ).toThrow();
  });

  it('rejects allowed branch with videoProvider !== "kling"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, videoProvider: "runway" }),
    ).toThrow();
  });

  it("rejects allowed branch with empty dallePromptLocked", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, dallePromptLocked: "" }),
    ).toThrow();
  });

  it("rejects allowed branch with dallePromptLocked.length > 4000", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({
        ...goodSyntheticAllowed,
        dallePromptLocked: "x".repeat(4001),
      }),
    ).toThrow();
  });

  it("rejects allowed branch with malformed klingDirection (missing field)", () => {
    const { lighting: _drop, ...partial } = goodKlingDirection;
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, klingDirection: partial }),
    ).toThrow();
  });

  it('rejects denial branch with kind !== "synthetic_pairing"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticDenied, kind: "something_else" }),
    ).toThrow();
  });

  it("rejects every branch missing syntheticRouterVersion", () => {
    const { syntheticRouterVersion: _a, ...allowedNoVer } = goodSyntheticAllowed;
    const { syntheticRouterVersion: _b, ...deniedNoVer } = goodSyntheticDenied;
    const { syntheticRouterVersion: _c, ...delegatedNoVer } = goodDelegated;
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(allowedNoVer)).toThrow();
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(deniedNoVer)).toThrow();
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(delegatedNoVer)).toThrow();
  });

  it("rejects delegation branch with non-`shot_type_not_in_synthetic_pairing` reason", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodDelegated, reason: "other_reason" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/schemas test pcd-synthetic-router
```

Expected: FAIL with module-not-found.

- [ ] **Step 2.3: Create the zod schema**

Create `packages/schemas/src/pcd-synthetic-router.ts`:

```ts
// PCD slice SP16 — Synthetic-creator provider-routing zod surface. Two
// schemas:
//   1. PcdRoutingDecisionSchema — net-new zod analogue of SP4's
//      TypeScript-only PcdRoutingDecision (defined inline in
//      packages/creative-pipeline/src/pcd/provider-router.ts). SP4 ships
//      the TS type but no zod schema; SP16's delegation branch needs a
//      zod-parseable union for round-tripping decisions. The structure
//      here is the authoritative parse contract; the SP4 TS type is a
//      structural subset.
//   2. SyntheticPcdRoutingDecisionSchema — SP16's own three-branch
//      decision union: synthetic-pairing allowed, synthetic-pairing
//      denied (ACCESS_POLICY), and delegated_to_generic_router (carries
//      the embedded SP4 decision wholesale).
//
// MERGE-BACK: At Switchboard integration time, SP4's TS type and the
// PcdRoutingDecisionSchema below must be kept in sync. SP17 will be the
// first slice to persist PcdRoutingDecision, at which point SP17 owns
// the source-of-truth move (likely into pcd-provenance.ts or a net-new
// pcd-provider-router.ts). For now SP16 owns this schema. The drift
// between SP4's TS type and this zod schema is mitigated by real-call
// drift tests in route-synthetic-pcd-shot.test.ts (Task 11).
//
// Decision struct is zod-only in SP16. Persistence is SP17's
// responsibility (SP9 provenance widen) — SP17 will add imageProvider,
// videoProvider, syntheticRouterVersion, pairingVersion, and
// sha256(dallePromptLocked) to PcdIdentitySnapshot per umbrella §5
// line 263. Whether SP17 also persists klingDirection verbatim, or
// hashes it, is SP17's decision.
import { z } from "zod";
import { KlingDirectionSchema } from "./creator-identity-synthetic.js";
import {
  IdentityTierSchema,
  OutputIntentSchema,
  PcdShotTypeSchema,
} from "./pcd-identity.js";
import { PcdTierDecisionSchema } from "./pcd-tier-policy.js";

// SP4 PcdRoutingDecision — three structural branches mirrored verbatim.
// `provider` stays as a free string — SP4 has no exported provider enum
// (rows use literals "openai_text" / "runway" / "kling" / "heygen").
// Tightening here would risk drift if SP4 adds a row. Same rationale for
// `tier3RulesApplied` (free string array — SP4 owns the literal set).
export const PcdRoutingDecisionSchema = z.union([
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema,
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("NO_PROVIDER_CAPABILITY"),
      accessDecision: PcdTierDecisionSchema,
      reason: z.literal("no provider satisfies tier3 routing rules for this shot"),
      requiredActions: z.array(z.literal("choose_safer_shot_type")).readonly(),
      candidatesEvaluated: z.number().int().min(0),
      candidatesAfterTier3Filter: z.number().int().min(0),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(true),
      accessDecision: PcdTierDecisionSchema,
      selectedCapability: z
        .object({
          provider: z.string().min(1),
          tiers: z.array(IdentityTierSchema).readonly(),
          shotTypes: z.array(PcdShotTypeSchema).readonly(),
          outputIntents: z.array(OutputIntentSchema).readonly(),
          supportsFirstLastFrame: z.boolean(),
          supportsEditExtend: z.boolean(),
          supportsPerformanceTransfer: z.boolean(),
        })
        .readonly(),
      selectedProvider: z.string().min(1),
      providerCapabilityVersion: z.string().min(1),
      routerVersion: z.string().min(1),
      decisionReason: z
        .object({
          capabilityRefIndex: z.number().int().min(0),
          matchedShotType: PcdShotTypeSchema,
          matchedEffectiveTier: IdentityTierSchema,
          matchedOutputIntent: OutputIntentSchema,
          tier3RulesApplied: z.array(z.string().min(1)).readonly(),
          candidatesEvaluated: z.number().int().min(0),
          candidatesAfterTier3Filter: z.number().int().min(0),
          selectionRationale: z.string().min(1).max(200),
        })
        .readonly(),
    })
    .readonly(),
]);
export type PcdRoutingDecisionParsed = z.infer<typeof PcdRoutingDecisionSchema>;

// NB: `z.union` not `z.discriminatedUnion`. Same NB carve-out as SP13 /
// SP14 / SP15 — Zod 3.x's discriminatedUnion factory does not see literal
// discriminators on branches wrapped in `.readonly()`. `z.union` parses
// by trying members in order; semantically equivalent for our three-
// branch decision shape.
export const SyntheticPcdRoutingDecisionSchema = z.union([
  // Synthetic path — tier policy denied.
  z
    .object({
      allowed: z.literal(false),
      kind: z.literal("synthetic_pairing"),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema,
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),
  // Synthetic path — allowed.
  z
    .object({
      allowed: z.literal(true),
      kind: z.literal("synthetic_pairing"),
      accessDecision: PcdTierDecisionSchema,
      imageProvider: z.literal("dalle"),
      videoProvider: z.literal("kling"),
      dallePromptLocked: z.string().min(1).max(4000),
      klingDirection: KlingDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      pairingVersion: z.string().min(1),
      syntheticRouterVersion: z.string().min(1),
      decisionReason: z
        .object({
          matchedShotType: PcdShotTypeSchema,
          matchedOutputIntent: OutputIntentSchema,
          selectionRationale: z.string().min(1).max(200),
        })
        .readonly(),
    })
    .readonly(),
  // Delegation path — out-of-pairing shot type, SP4 ran.
  z
    .object({
      kind: z.literal("delegated_to_generic_router"),
      reason: z.literal("shot_type_not_in_synthetic_pairing"),
      shotType: PcdShotTypeSchema,
      sp4Decision: PcdRoutingDecisionSchema,
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),
]);
export type SyntheticPcdRoutingDecision = z.infer<typeof SyntheticPcdRoutingDecisionSchema>;
```

- [ ] **Step 2.4: Widen the schemas barrel (upfront — SP14/SP15 lesson)**

Edit `packages/schemas/src/index.ts` — append after the SP15 line:

```ts

// SP16 — synthetic creator provider routing
export * from "./pcd-synthetic-router.js";
```

- [ ] **Step 2.5: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/schemas test pcd-synthetic-router
pnpm --filter @creativeagent/schemas typecheck
```

Expected: all 14 tests PASS. Typecheck clean.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/schemas/src/pcd-synthetic-router.ts \
        packages/schemas/src/__tests__/pcd-synthetic-router.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP16 task 2 — PcdRoutingDecisionSchema + SyntheticPcdRoutingDecisionSchema zod + barrel widen"
```

---

### Task 3: 20th pinned PCD constant — `synthetic-router-version.ts`

**Goal:** Land `PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.0.0"` in exactly one non-test source file. The anti-pattern test in Task 12 enforces single-source.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

describe("PCD_SYNTHETIC_ROUTER_VERSION", () => {
  it('is the literal "pcd-synthetic-router@1.0.0"', () => {
    expect(PCD_SYNTHETIC_ROUTER_VERSION).toBe("pcd-synthetic-router@1.0.0");
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test synthetic-router-version
```

Expected: FAIL with module-not-found.

- [ ] **Step 3.3: Create the constant**

Create `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts`:

```ts
// PCD slice SP16 — 20th pinned PCD constant.
// Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION
// (which versions the pairing data, not the routing logic).
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.0.0";
```

- [ ] **Step 3.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test synthetic-router-version
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.test.ts
git commit -m "feat(pcd): SP16 task 3 — PCD_SYNTHETIC_ROUTER_VERSION (20th pinned constant)"
```

---

### Task 4: Pairing matrix + 21st pinned PCD constant — `synthetic-provider-pairing.ts`

**Goal:** Land the single-row `PCD_SYNTHETIC_PROVIDER_PAIRING` matrix and the 21st pinned PCD constant `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.0.0"`. Programmatic shape tests assert the row's content and exclusions.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
  type SyntheticProviderPairing,
} from "./synthetic-provider-pairing.js";

describe("PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION", () => {
  it('is the literal "pcd-synthetic-provider-pairing@1.0.0"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION).toBe("pcd-synthetic-provider-pairing@1.0.0");
  });
});

describe("PCD_SYNTHETIC_PROVIDER_PAIRING — v1 matrix", () => {
  it("has exactly one row", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(1);
  });

  it('row 0 imageProvider === "dalle"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].imageProvider).toBe("dalle");
  });

  it('row 0 videoProvider === "kling"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].videoProvider).toBe("kling");
  });

  it("row 0 shotTypes is exactly the seven video-modality shot types", () => {
    const expected = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes].sort()).toEqual(
      [...expected].sort(),
    );
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.length).toBe(expected.length);
  });

  it("row 0 outputIntents is exactly the four standard output intents", () => {
    const expected = ["draft", "preview", "final_export", "meta_draft"];
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].outputIntents].sort()).toEqual(
      [...expected].sort(),
    );
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].outputIntents.length).toBe(expected.length);
  });

  it('row 0 shotTypes does NOT include "script_only" (delegation reachability lock)', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.includes("script_only" as never)).toBe(
      false,
    );
  });

  it('row 0 shotTypes does NOT include "storyboard" (delegation reachability lock)', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.includes("storyboard" as never)).toBe(
      false,
    );
  });

  it("matrix entries are typed as SyntheticProviderPairing (compile-time + runtime check on shape keys)", () => {
    const row: SyntheticProviderPairing = PCD_SYNTHETIC_PROVIDER_PAIRING[0];
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(["imageProvider", "outputIntents", "shotTypes", "videoProvider"]);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test synthetic-provider-pairing
```

Expected: FAIL with module-not-found.

- [ ] **Step 4.3: Create the matrix module**

Create `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts`:

```ts
// PCD slice SP16 — Synthetic provider pairing data.
//
// Declarative synthetic pairing matrix. v1 single-row covers all
// video-modality shot types defined in SP2's PcdShotType enum. Authoring
// intent: every synthetic-creator shot at a video-modality shot type uses
// the locked DALL-E + Kling pairing. Out-of-pairing shot types
// (script_only, storyboard) are deliberately absent — those route via
// SP4's existing matrix through the delegation branch of
// SyntheticPcdRoutingDecision.
//
// MERGE-BACK: Future modalities (e.g., voice for talking_head — different
// model pairing) add NEW rows. Adding a row that overlaps shot-types with
// the existing row requires a row-precedence rule (first-match? explicit
// priority?) — that's a future-PR design call. v1's single row makes the
// question moot.
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

// PCD slice SP16 — 21st pinned PCD constant.
// Pairing-data version. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (which
// versions the routing logic, not the data). Bumped when matrix membership
// changes in any way that can affect routing decisions.
//
// MERGE-BACK: Same provenance-replay assessment as router version.
export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.0.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling";
};

export const PCD_SYNTHETIC_PROVIDER_PAIRING: ReadonlyArray<SyntheticProviderPairing> = [
  {
    shotTypes: [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    imageProvider: "dalle",
    videoProvider: "kling",
  },
] as const;
```

- [ ] **Step 4.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test synthetic-provider-pairing
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 8 tests PASS. Typecheck clean.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts
git commit -m "feat(pcd): SP16 task 4 — PCD_SYNTHETIC_PROVIDER_PAIRING matrix (single row) + 21st pinned constant"
```

---

### Task 5: Router skeleton — `route-synthetic-pcd-shot.ts`

**Goal:** Land the function signature, input/output types, and a stub body that always delegates. This proves the import surface compiles before any routing logic exists. Subsequent tasks fill in the four steps and tests.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 5.1: Write the skeleton import-surface test**

Create `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  routeSyntheticPcdShot,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";

describe("routeSyntheticPcdShot — module surface", () => {
  it("exports an async function and a RouteSyntheticPcdShotInput type", () => {
    expect(typeof routeSyntheticPcdShot).toBe("function");
    // Type-only: a value of RouteSyntheticPcdShotInput would compile here.
    const _typeOnly: RouteSyntheticPcdShotInput | undefined = undefined;
    expect(_typeOnly).toBeUndefined();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
```

Expected: FAIL with module-not-found.

- [ ] **Step 5.3: Create the skeleton**

Create `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`:

```ts
// PCD slice SP16 — Synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling pairing).
//
// Composition (one inline `Step N` comment per body step, filled in
// across Tasks 6–8):
//   1. Look up pairing matrix row by (shotType, outputIntent).
//   2. If no row matches → delegate to SP4's routePcdShot and wrap.
//   3. Tier policy gate (SP2's decidePcdGenerationAccess) — denial path.
//   4. Build synthetic pairing decision (locked artifacts read verbatim
//      from input.syntheticIdentity).
//
// Algorithm is intentionally tier3-rule-free for the synthetic path: the
// locked pairing supersedes generic capability filtering by design
// (umbrella §4 line 92, line 238). For the delegation path, SP4's own
// tier3 logic fires inside the delegated call.
//
// MERGE-BACK: Caller (SP21 composer) supplies the synthetic identity
// payload via PrismaCreatorIdentitySyntheticReader.findByCreatorIdentityId
// (SP11 reader). SP16 itself never reads. SP21 is responsible for
// asserting `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`.
// Mirrors SP12 / SP13 / SP14 / SP15 snapshot pattern.

import type {
  CreatorIdentitySyntheticPayload,
  OutputIntent,
  PcdShotType,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { routePcdShot } from "../provider-router.js";
import type {
  ApprovedCampaignContext,
  ProviderRouterStores,
} from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision> {
  // Skeleton — Tasks 6/7/8 fill in the body. Always delegate for now.
  const sp4Decision = await routePcdShot(
    {
      resolvedContext: input.resolvedContext,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
      approvedCampaignContext: input.approvedCampaignContext,
    },
    stores,
  );
  return {
    kind: "delegated_to_generic_router",
    reason: "shot_type_not_in_synthetic_pairing",
    shotType: input.shotType,
    sp4Decision,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
  };
}
```

- [ ] **Step 5.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS. Typecheck clean.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "feat(pcd): SP16 task 5 — routeSyntheticPcdShot skeleton (always-delegate stub)"
```

---

### Task 6: Step 1 (matrix lookup) + Step 2 (delegation branch) + delegation-path tests

**Goal:** Implement the matrix-lookup + delegation pathway so that out-of-pairing shot types (`script_only`, `storyboard`) trip the `delegated_to_generic_router` branch and embed the SP4 decision unchanged. The success path stays stubbed until Tasks 7–8.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 6.1: Append delegation-path tests + shared fixtures**

Replace the contents of `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  routeSyntheticPcdShot,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";
import type {
  ApprovedCampaignContext,
  ProviderRouterStores,
} from "../provider-router.js";
import type { CampaignTakeStore } from "../tier3-routing-rules.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "../shot-spec-version.js";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/index.js";

const cheryl = SP11_SYNTHETIC_CREATOR_ROSTER[0].synthetic;

function makeContext(overrides: Partial<ResolvedPcdContext> = {}): ResolvedPcdContext {
  return {
    productIdentityId: "p-1",
    creatorIdentityId: cheryl.creatorIdentityId,
    productTierAtResolution: 3,
    creatorTierAtResolution: 3,
    effectiveTier: 3,
    allowedOutputTier: 3,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    ...overrides,
  };
}

function makeCampaignTakeStore(
  returns: boolean,
  log: { calls: number },
): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      log.calls += 1;
      return returns;
    },
  };
}

const NO_CAMPAIGN: ApprovedCampaignContext = { kind: "none" };
const WITH_CAMPAIGN: ApprovedCampaignContext = {
  kind: "campaign",
  organizationId: "org-1",
  campaignId: "camp-1",
};

function makeInput(
  overrides: Partial<RouteSyntheticPcdShotInput> = {},
): RouteSyntheticPcdShotInput {
  return {
    resolvedContext: makeContext(),
    syntheticIdentity: cheryl,
    shotType: "simple_ugc",
    outputIntent: "draft",
    approvedCampaignContext: NO_CAMPAIGN,
    ...overrides,
  };
}

describe("routeSyntheticPcdShot — delegation branch (out-of-pairing shot types)", () => {
  it('script_only delegates to SP4 and wraps the decision', async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "script_only" }), stores);
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.reason).toBe("shot_type_not_in_synthetic_pairing");
    expect(result.shotType).toBe("script_only");
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
    expect(result.sp4Decision).toBeDefined();
  });

  it("storyboard delegates to SP4 and wraps the decision", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "storyboard" }), stores);
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.shotType).toBe("storyboard");
  });

  it("delegation embeds SP4 success — tier-3 storyboard → openai_text", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({ shotType: "storyboard", outputIntent: "draft" }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision.allowed).toBe(true);
    if (!result.sp4Decision.allowed) return;
    expect(result.sp4Decision.selectedProvider).toBe("openai_text");
  });

  it("delegation embeds SP4 ACCESS_POLICY denial when SP2 denies the shot", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "script_only",
        outputIntent: "final_export",
      }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision.allowed).toBe(false);
    if (result.sp4Decision.allowed) return;
    expect(result.sp4Decision.denialKind).toBe("ACCESS_POLICY");
  });

  it("WITH_CAMPAIGN tier-3 storyboard delegates and SP4 path runs (campaign-take store may be consulted)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        shotType: "storyboard",
        outputIntent: "draft",
        approvedCampaignContext: WITH_CAMPAIGN,
      }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
  });

  it("delegation branch carries syntheticRouterVersion verbatim", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "script_only" }), stores);
    if (result.kind !== "delegated_to_generic_router") throw new Error("expected delegation");
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
  });
});

export { cheryl, makeContext, makeInput, makeCampaignTakeStore, NO_CAMPAIGN, WITH_CAMPAIGN };
```

- [ ] **Step 6.2: Run tests to verify the new delegation tests pass already (the skeleton always delegates)**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
```

Expected: all 6 delegation tests PASS (the Task-5 skeleton delegates unconditionally, and Task-6 tests only target out-of-pairing shot types).

- [ ] **Step 6.3: Replace the stub body with a real Step 1 + Step 2 implementation**

Replace the body of `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts` with:

```ts
// PCD slice SP16 — Synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling pairing).
//
// Composition (one inline `Step N` comment per body step):
//   1. Look up pairing matrix row by (shotType, outputIntent).
//   2. If no row matches → delegate to SP4's routePcdShot and wrap.
//   3. Tier policy gate (SP2's decidePcdGenerationAccess) — denial path. [Task 7]
//   4. Build synthetic pairing decision (locked artifacts read verbatim
//      from input.syntheticIdentity). [Task 8]
//
// Algorithm is intentionally tier3-rule-free for the synthetic path: the
// locked pairing supersedes generic capability filtering by design
// (umbrella §4 line 92, line 238). For the delegation path, SP4's own
// tier3 logic fires inside the delegated call.
//
// MERGE-BACK: Caller (SP21 composer) supplies the synthetic identity
// payload via PrismaCreatorIdentitySyntheticReader.findByCreatorIdentityId
// (SP11 reader). SP16 itself never reads. SP21 is responsible for
// asserting `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`.
// Mirrors SP12 / SP13 / SP14 / SP15 snapshot pattern.

import type {
  CreatorIdentitySyntheticPayload,
  OutputIntent,
  PcdShotType,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { routePcdShot } from "../provider-router.js";
import type {
  ApprovedCampaignContext,
  ProviderRouterStores,
} from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SYNTHETIC_PROVIDER_PAIRING } from "./synthetic-provider-pairing.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision> {
  // Step 1 — Pairing matrix lookup. Find a row whose shotTypes contains
  // input.shotType AND outputIntents contains input.outputIntent.
  // First-match wins (v1 has only one row).
  const pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(
    (p) => p.shotTypes.includes(input.shotType) && p.outputIntents.includes(input.outputIntent),
  );
  const pairing = pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined;

  // Step 2 — Out-of-pairing shot type → delegate to SP4.
  if (pairing === undefined) {
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: input.resolvedContext,
        shotType: input.shotType,
        outputIntent: input.outputIntent,
        approvedCampaignContext: input.approvedCampaignContext,
      },
      stores,
    );
    return {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: input.shotType,
      sp4Decision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Steps 3 + 4 land in Tasks 7 + 8. For now, still delegate so existing
  // tests keep passing while we incrementally fill in the synthetic path.
  // `pairing` and `pairingRefIndex` are used above in the lookup +
  // undefined-check; TypeScript's noUnusedLocals is satisfied. Task 7
  // will replace this fall-through with the tier-policy gate and Task 8
  // will replace it with the success-branch return.
  const sp4Decision = await routePcdShot(
    {
      resolvedContext: input.resolvedContext,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
      approvedCampaignContext: input.approvedCampaignContext,
    },
    stores,
  );
  return {
    kind: "delegated_to_generic_router",
    reason: "shot_type_not_in_synthetic_pairing",
    shotType: input.shotType,
    sp4Decision,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
  };
}
```

- [ ] **Step 6.4: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 6 delegation tests PASS. The pairing lookup runs but is unused; the typecheck stays clean because of the `void pairing; void pairingRefIndex;` discards.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "feat(pcd): SP16 task 6 — pairing-matrix lookup (Step 1) + delegation branch (Step 2) + 6 delegation tests"
```

---

### Task 7: Step 3 (tier policy gate) + denial-path tests

**Goal:** Land the synthetic-path tier-policy gate. When `decidePcdGenerationAccess` denies the shot (e.g., tier-1 + `final_export`), return the `synthetic_pairing` `ACCESS_POLICY` denial branch instead of falling through to delegation. Step 4 (success branch) still stubbed — in-pairing allowed shots fall through to delegation until Task 8.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 7.1: Append the denial-path tests**

Append to `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts` (above the trailing `export {...}` line):

```ts
describe("routeSyntheticPcdShot — synthetic-path ACCESS_POLICY denial (Step 3)", () => {
  it("tier-1 face_closeup → denied (face_closeup needs avatarTier>=3)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    expect(result).toMatchObject({
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    });
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) return;
    expect(result.accessDecision.allowed).toBe(false);
  });

  it("tier-1 simple_ugc + final_export → denied (final_export needs both tiers >= 2)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect(result.denialKind).toBe("ACCESS_POLICY");
  });

  it("denial branch does NOT carry imageProvider/videoProvider/locked-artifacts", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect("imageProvider" in result).toBe(false);
    expect("videoProvider" in result).toBe(false);
    expect("dallePromptLocked" in result).toBe(false);
    expect("klingDirection" in result).toBe(false);
  });

  it("denial branch returns BEFORE consulting SP4 (campaignTakeStore never called)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    expect(log.calls).toBe(0);
  });

  it("denial branch syntheticRouterVersion is stamped", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
  });
});
```

- [ ] **Step 7.2: Run tests to verify the new denial tests fail**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
```

Expected: 5 new denial tests FAIL (the body still always delegates for in-pairing shot types). 6 delegation tests still PASS.

- [ ] **Step 7.3: Add Step 3 to the body**

Edit `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`. Add an import for the tier-policy decider near the top:

```ts
import { decidePcdGenerationAccess } from "../tier-policy.js";
```

Replace the bottom-of-function fall-through (the `void pairing; void pairingRefIndex;` block from Task 6) with:

```ts
  // Step 3 — Tier policy gate. SP4 also runs this for its own path; we run
  // it here independently because Step 4 short-circuits before any
  // routePcdShot call.
  const accessDecision = decidePcdGenerationAccess({
    avatarTier: input.resolvedContext.creatorTierAtResolution,
    productTier: input.resolvedContext.productTierAtResolution,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
  });
  if (!accessDecision.allowed) {
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 4 lands in Task 8. For now, in-pairing allowed shots fall through
  // to delegation so the existing happy-path delegation tests keep passing.
  // `pairing`, `pairingRefIndex`, and `accessDecision` are all used above
  // (lookup, undefined-check, and tier-policy gate respectively); Task 8
  // will reference them in the success-branch return.
  const sp4Decision = await routePcdShot(
    {
      resolvedContext: input.resolvedContext,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
      approvedCampaignContext: input.approvedCampaignContext,
    },
    stores,
  );
  return {
    kind: "delegated_to_generic_router",
    reason: "shot_type_not_in_synthetic_pairing",
    shotType: input.shotType,
    sp4Decision,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
  };
```

- [ ] **Step 7.4: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 11 tests PASS (5 new denial + 6 prior delegation). Typecheck clean.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "feat(pcd): SP16 task 7 — tier-policy gate (Step 3) + 5 ACCESS_POLICY denial-path tests"
```

---

### Task 8: Step 4 (synthetic-pairing success branch) + happy-path matrix tests + version pin invariants + locked-artifact byte-equality

**Goal:** Replace the in-pairing fall-through with the real success branch. Cover all 28 (video shot type × output intent) combos parametrically. Lock locked-artifact byte-equality, version-pin invariants, and `pairingRefIndex === 0`. `decisionReason.selectionRationale` content + 200-char cap is Task 9; `buildSyntheticSelectionRationale` is introduced inline here as a placeholder one-liner that Task 9 hardens.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 8.1: Append happy-path tests**

Append to `route-synthetic-pcd-shot.test.ts` (still above the trailing `export {...}`):

```ts
import { PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION } from "./synthetic-provider-pairing.js";

const VIDEO_SHOT_TYPES = [
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
] as const;

const OUTPUT_INTENTS = ["draft", "preview", "final_export", "meta_draft"] as const;

describe("routeSyntheticPcdShot — synthetic-pairing success (Step 4)", () => {
  for (const shotType of VIDEO_SHOT_TYPES) {
    for (const outputIntent of OUTPUT_INTENTS) {
      it(`tier-3 ${shotType} + ${outputIntent} → allowed synthetic_pairing`, async () => {
        const log = { calls: 0 };
        const stores: ProviderRouterStores = {
          campaignTakeStore: makeCampaignTakeStore(false, log),
        };
        const result = await routeSyntheticPcdShot(
          makeInput({ shotType, outputIntent }),
          stores,
        );
        expect(result).toMatchObject({
          allowed: true,
          kind: "synthetic_pairing",
          imageProvider: "dalle",
          videoProvider: "kling",
          pairingRefIndex: 0,
          pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
          syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
        });
        if (result.kind !== "synthetic_pairing" || result.allowed !== true) return;
        // Locked-artifact byte equality.
        expect(result.dallePromptLocked).toBe(cheryl.dallePromptLocked);
        expect(result.klingDirection).toEqual(cheryl.klingDirection);
        // decisionReason fields echo input.
        expect(result.decisionReason.matchedShotType).toBe(shotType);
        expect(result.decisionReason.matchedOutputIntent).toBe(outputIntent);
      });
    }
  }

  it("perturbing dallePromptLocked by one char shifts the success-branch dallePromptLocked by one char (verbatim)", async () => {
    const tweaked = { ...cheryl, dallePromptLocked: cheryl.dallePromptLocked + "X" };
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ syntheticIdentity: tweaked }), stores);
    if (result.kind !== "synthetic_pairing" || result.allowed !== true) {
      throw new Error("expected synthetic_pairing allowed");
    }
    expect(result.dallePromptLocked).toBe(cheryl.dallePromptLocked + "X");
    expect(result.dallePromptLocked.endsWith("X")).toBe(true);
  });

  it("perturbing klingDirection.setting shifts the success-branch klingDirection.setting (verbatim)", async () => {
    const tweaked = {
      ...cheryl,
      klingDirection: { ...cheryl.klingDirection, setting: "Different setting!" },
    };
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ syntheticIdentity: tweaked }), stores);
    if (result.kind !== "synthetic_pairing" || result.allowed !== true) {
      throw new Error("expected synthetic_pairing allowed");
    }
    expect(result.klingDirection.setting).toBe("Different setting!");
  });
});
```

- [ ] **Step 8.2: Run tests to verify the new happy-path tests fail**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
```

Expected: 30 new happy-path tests FAIL (28 parametric + 2 byte-equality). All prior tests still PASS.

- [ ] **Step 8.3: Replace the Step-4 fall-through with the real success branch**

Edit `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`. Add the new pairing-version import near the top (next to the existing pairing import):

```ts
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
} from "./synthetic-provider-pairing.js";
```

Replace the Step-4 fall-through block (the `void pairing; void pairingRefIndex; void accessDecision;` plus the trailing delegation) with:

```ts
  // Step 4 — Build synthetic pairing decision. Locked artifacts read
  // verbatim from input.syntheticIdentity. No transformation, no hashing
  // (SP17 owns sha256(dallePromptLocked) at persistence time).
  const matchedShotType = input.shotType;
  const matchedOutputIntent = input.outputIntent;
  const selectionRationale =
    `synthetic-pairing tier=${input.resolvedContext.effectiveTier} shot=${matchedShotType} intent=${matchedOutputIntent} → dalle+kling`;
  return {
    allowed: true,
    kind: "synthetic_pairing",
    accessDecision,
    imageProvider: pairing.imageProvider,
    videoProvider: pairing.videoProvider,
    dallePromptLocked: input.syntheticIdentity.dallePromptLocked,
    klingDirection: input.syntheticIdentity.klingDirection,
    pairingRefIndex,
    pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    decisionReason: {
      matchedShotType,
      matchedOutputIntent,
      selectionRationale:
        selectionRationale.length > 200 ? selectionRationale.slice(0, 200) : selectionRationale,
    },
  };
```

After this edit, the file no longer needs the trailing delegation block for in-pairing shots; remove it.

- [ ] **Step 8.4: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 41 tests PASS (28 parametric happy-path + 2 byte-equality + 5 denial + 6 delegation). Typecheck clean.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "feat(pcd): SP16 task 8 — synthetic-pairing success branch (Step 4) + 30 happy-path tests covering 28 (shotType × outputIntent) combos"
```

---

### Task 9: `buildSyntheticSelectionRationale` extraction + content tests + 200-char cap

**Goal:** Lift the inline `selectionRationale` string-build into a small named helper for testability and cap-enforcement coverage. Preserves byte-equal output for the existing happy-path tests.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 9.1: Append rationale-content tests**

Append to `route-synthetic-pcd-shot.test.ts`:

```ts
import { buildSyntheticSelectionRationale } from "./route-synthetic-pcd-shot.js";

describe("buildSyntheticSelectionRationale", () => {
  it('contains "synthetic-pairing", "dalle+kling", tier number, shotType, outputIntent', () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft");
    expect(out).toContain("synthetic-pairing");
    expect(out).toContain("dalle+kling");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=simple_ugc");
    expect(out).toContain("intent=draft");
  });

  it("never exceeds 200 chars", () => {
    for (const tier of [1, 2, 3] as const) {
      for (const shot of VIDEO_SHOT_TYPES) {
        for (const intent of OUTPUT_INTENTS) {
          expect(buildSyntheticSelectionRationale(tier, shot, intent).length).toBeLessThanOrEqual(
            200,
          );
        }
      }
    }
  });

  it("template form mirrors SP4's buildSelectionRationale shape (tier=, shot=, intent=, →)", () => {
    expect(buildSyntheticSelectionRationale(3, "talking_head", "preview")).toBe(
      "synthetic-pairing tier=3 shot=talking_head intent=preview → dalle+kling",
    );
  });
});
```

- [ ] **Step 9.2: Run tests to verify the new tests fail (helper not exported)**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
```

Expected: 3 new rationale tests FAIL with `buildSyntheticSelectionRationale is not exported`.

- [ ] **Step 9.3: Extract the helper**

Edit `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`. Add a new named export above `routeSyntheticPcdShot`:

```ts
import type { IdentityTier } from "@creativeagent/schemas";

export function buildSyntheticSelectionRationale(
  effectiveTier: IdentityTier,
  shotType: PcdShotType,
  outputIntent: OutputIntent,
): string {
  const out = `synthetic-pairing tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → dalle+kling`;
  return out.length > 200 ? out.slice(0, 200) : out;
}
```

In Step 4's body, replace the inline `selectionRationale` build with the helper call:

```ts
    decisionReason: {
      matchedShotType,
      matchedOutputIntent,
      selectionRationale: buildSyntheticSelectionRationale(
        input.resolvedContext.effectiveTier,
        matchedShotType,
        matchedOutputIntent,
      ),
    },
```

- [ ] **Step 9.4: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: all 44 tests PASS (3 new + 41 prior). Typecheck clean. The 28 parametric happy-path tests still pass byte-equal because the helper output is byte-equal to the prior inline build.

- [ ] **Step 9.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "feat(pcd): SP16 task 9 — extract buildSyntheticSelectionRationale + 3 rationale tests (200-char cap, template form)"
```

---

### Task 10: Determinism property test

**Goal:** Lock the replay invariant — identical input produces deep-equal decisions across both the synthetic and delegation paths.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 10.1: Append the determinism test**

Append to `route-synthetic-pcd-shot.test.ts`:

```ts
describe("routeSyntheticPcdShot — determinism", () => {
  it("identical input twice → deep-equal decisions (synthetic path)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const inputA = makeInput({ shotType: "simple_ugc", outputIntent: "draft" });
    const inputB = makeInput({ shotType: "simple_ugc", outputIntent: "draft" });
    const a = await routeSyntheticPcdShot(inputA, stores);
    const b = await routeSyntheticPcdShot(inputB, stores);
    expect(a).toEqual(b);
  });

  it("identical input twice → deep-equal decisions (delegation path)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const inputA = makeInput({ shotType: "script_only", outputIntent: "draft" });
    const inputB = makeInput({ shotType: "script_only", outputIntent: "draft" });
    const a = await routeSyntheticPcdShot(inputA, stores);
    const b = await routeSyntheticPcdShot(inputB, stores);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 10.2: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 2 new determinism tests PASS. All 46 tests now PASS. Typecheck clean.

- [ ] **Step 10.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "test(pcd): SP16 task 10 — determinism property tests (synthetic + delegation paths)"
```

---

### Task 11: Stores-ignored / stores-used tests + PcdRoutingDecisionSchema drift verification (real SP4 outputs)

**Goal:** Lock two structural invariants and one cross-slice safety net:
- Synthetic-pairing path is pure: replacing the campaign-take store with a throw-on-call mock still succeeds.
- Delegation path actually consults the campaign-take store when SP4 needs it (tier-3 + WITH_CAMPAIGN).
- **U1 mitigation:** real `routePcdShot` outputs for the two reachable SP4 branches round-trip through `PcdRoutingDecisionSchema.parse()` deep-equal.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 11.1: Append the three test groups**

Append to `route-synthetic-pcd-shot.test.ts`:

```ts
import { routePcdShot } from "../provider-router.js";
import { PcdRoutingDecisionSchema } from "@creativeagent/schemas";

describe("routeSyntheticPcdShot — stores discipline", () => {
  it("synthetic path: campaignTakeStore throw-on-any-call mock, in-pairing shot still succeeds", async () => {
    const stores: ProviderRouterStores = {
      campaignTakeStore: {
        hasApprovedTier3TakeForCampaign: async () => {
          throw new Error("synthetic path must not consult campaignTakeStore");
        },
      },
    };
    const result = await routeSyntheticPcdShot(
      makeInput({ shotType: "simple_ugc", outputIntent: "draft" }),
      stores,
    );
    expect(result.kind).toBe("synthetic_pairing");
    if (result.kind !== "synthetic_pairing") return;
    expect(result.allowed).toBe(true);
  });

  it("delegation path: routePcdShot is invoked and its decision is returned verbatim on sp4Decision", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        shotType: "storyboard",
        outputIntent: "draft",
        approvedCampaignContext: WITH_CAMPAIGN,
      }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision).toBeDefined();
    expect(result.sp4Decision.allowed).toBe(true);
    if (!result.sp4Decision.allowed) return;
    // SP4 picks openai_text for storyboard; this proves routePcdShot ran
    // (the synthetic path would have set imageProvider/videoProvider, not
    // selectedProvider).
    expect(result.sp4Decision.selectedProvider).toBe("openai_text");
  });
});

describe("routeSyntheticPcdShot — PcdRoutingDecisionSchema drift verification (real SP4 outputs)", () => {
  it("real SP4 ACCESS_POLICY denial round-trips through PcdRoutingDecisionSchema.parse()", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(sp4Decision.allowed).toBe(false);
    const parsed = PcdRoutingDecisionSchema.parse(sp4Decision);
    expect(parsed).toEqual(sp4Decision);
  });

  it("real SP4 allowed success round-trips through PcdRoutingDecisionSchema.parse()", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: makeContext(),
        shotType: "simple_ugc",
        outputIntent: "draft",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(sp4Decision.allowed).toBe(true);
    const parsed = PcdRoutingDecisionSchema.parse(sp4Decision);
    expect(parsed).toEqual(sp4Decision);
  });

  // NB: NO_PROVIDER_CAPABILITY is structurally unreachable under SP4's v1
  // matrix (runway covers every video shot type at every tier with
  // supportsFirstLastFrame + supportsEditExtend + supportsPerformanceTransfer
  // all true; openai_text covers script/storyboard). That branch is exercised
  // via the hand-built fixture in packages/schemas/src/__tests__/pcd-synthetic-router.test.ts
  // (Task 2). If a future SP4 matrix tightening introduces a reachable
  // NO_PROVIDER_CAPABILITY path, promote the hand-fixture to a real-call test
  // here at that time.
});
```

- [ ] **Step 11.2: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 4 new tests PASS (2 stores discipline + 2 drift verification). All 50 tests now PASS. Typecheck clean.

- [ ] **Step 11.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "test(pcd): SP16 task 11 — stores discipline + PcdRoutingDecisionSchema real-output drift verification"
```

---

### Task 12: Anti-pattern tests — `sp16-anti-patterns.test.ts`

**Goal:** Six structural assertions guarding SP16 invariants. Mirrors SP14/SP15's `sp1X-anti-patterns.test.ts` shape, with the SP16-specific blacklists (no SP4 internals leakage, no cross-slice tokens) and frozen-source-body check keyed to `9dca008` (SP15 merge tip on main).

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`

- [ ] **Step 12.1: Write the anti-pattern test**

Create `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`:

```ts
// SP16 anti-pattern grep tests. These guard against:
//   1. Single-source router-version pin ("pcd-synthetic-router@1.0.0"
//      appears in exactly one non-test source file:
//      synthetic-router-version.ts).
//   2. Single-source pairing-version pin ("pcd-synthetic-provider-pairing@1.0.0"
//      appears in exactly one non-test source file:
//      synthetic-provider-pairing.ts).
//   3. Router purity (no Date.now, no new Date, no Math.random, no
//      @creativeagent/db, no @prisma/client, no inngest, no node:fs|http|https,
//      no crypto). Tighter than SP10C (no clock pull at all).
//   4. No SP4-internals leakage in the pipeline-side router. Allowed SP4
//      symbols: routePcdShot, ApprovedCampaignContext, ProviderRouterStores.
//      Forbidden: PCD_PROVIDER_CAPABILITY_MATRIX, Tier3Rule, requiresFirstLastFrameAnchor,
//      requiresPerformanceTransfer, requiresEditOverRegenerate, tier3-routing-rules,
//      supportsFirstLastFrame, supportsEditExtend, supportsPerformanceTransfer,
//      capabilityRefIndex, buildSelectionRationale, tier3RulesApplied. The
//      schemas-side pcd-synthetic-router.ts is OUT of scope here because
//      PcdRoutingDecisionSchema legitimately mirrors SP4's contract.
//   5. No cross-slice token leakage in pcd/synthetic-router/ sources.
//      `creatorIdentityId` and `syntheticIdentity` are explicitly allowed
//      (SP11 concepts; SP16 takes them as input parameters).
//   6. Frozen SP1-SP15 source bodies (allowlist edits only) — keyed against 9dca008.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_PROVIDER_PAIRING } from "./synthetic-provider-pairing.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const ROUTER_DIR = path.join(
  REPO_ROOT,
  "packages/creative-pipeline/src/pcd/synthetic-router",
);
const ROUTER_VERSION_PATH = path.join(ROUTER_DIR, "synthetic-router-version.ts");
const PAIRING_PATH = path.join(ROUTER_DIR, "synthetic-provider-pairing.ts");
const ROUTER_PATH = path.join(ROUTER_DIR, "route-synthetic-pcd-shot.ts");

function grepFiles(pattern: string, scope: string): string[] {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

describe("SP16 anti-patterns", () => {
  it('PCD_SYNTHETIC_ROUTER_VERSION literal "pcd-synthetic-router@1.0.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-router@1\\.0\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      ),
    ).toBe(true);
  });

  it('PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION literal "pcd-synthetic-provider-pairing@1.0.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-provider-pairing@1\\.0\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      ),
    ).toBe(true);
  });

  it("non-test pcd/synthetic-router sources are pure — no clock reads, no randomness, no I/O imports, no crypto", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      expect(src, `${filePath}: Date.now()`).not.toMatch(/Date\.now\(\)/);
      expect(src, `${filePath}: new Date(`).not.toMatch(/new\s+Date\(/);
      expect(src, `${filePath}: Math.random`).not.toMatch(/Math\.random\(/);
      expect(src, `${filePath}: @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${filePath}: @prisma/client`).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, `${filePath}: inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${filePath}: node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${filePath}: node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${filePath}: node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${filePath}: crypto`).not.toMatch(/from\s+["']crypto["']/);
      expect(src, `${filePath}: node:crypto`).not.toMatch(/from\s+["']node:crypto["']/);
      expect(src, `${filePath}: PrismaClient`).not.toMatch(/PrismaClient/);
    }
  });

  it("no SP4-internals leakage in pcd/synthetic-router pipeline sources (allowed: routePcdShot, ApprovedCampaignContext, ProviderRouterStores)", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
    const FORBIDDEN_SP4_INTERNALS = [
      "PCD_PROVIDER_CAPABILITY_MATRIX",
      "Tier3Rule",
      "requiresFirstLastFrameAnchor",
      "requiresPerformanceTransfer",
      "requiresEditOverRegenerate",
      "tier3-routing-rules",
      "tier3RulesApplied",
      "supportsFirstLastFrame",
      "supportsEditExtend",
      "supportsPerformanceTransfer",
      "capabilityRefIndex",
      "buildSelectionRationale",
    ];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of FORBIDDEN_SP4_INTERNALS) {
        expect(
          src.includes(token),
          `${filePath} must not reference SP4 internal: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("no cross-slice tokens in pcd/synthetic-router source — SP13 / SP14 / SP15 / SP17+ / SP18+ / SP19+ / SP20+ all forbidden; creatorIdentityId + syntheticIdentity allowed", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
    const FORBIDDEN_SP13 = [
      "SyntheticCreatorSelectionDecision",
      "selectedCreatorIdentityId",
      "fallbackCreatorIdentityIds",
      "selectorRank",
      "metricsSnapshotVersion",
      "performanceOverlayApplied",
    ];
    const FORBIDDEN_SP14 = [
      "DisclosureResolutionDecision",
      "disclosureTemplateId",
      "resolverVersion",
    ];
    const FORBIDDEN_SP15 = ["ScriptSelectionDecision", "scriptTemplateId", "scriptText"];
    const FORBIDDEN_SP17_PLUS = [
      "PcdIdentitySnapshot",
      "provenance_widen",
      "promptHash",
      "sha256(",
    ];
    const FORBIDDEN_SP18_PLUS = ["PcdPerformanceSnapshot", "performance_snapshot"];
    const FORBIDDEN_SP19_PLUS = ["overlayWeight"];
    const FORBIDDEN_SP20_PLUS = ["face_descriptor", "qc_face"];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of [
        ...FORBIDDEN_SP13,
        ...FORBIDDEN_SP14,
        ...FORBIDDEN_SP15,
        ...FORBIDDEN_SP17_PLUS,
        ...FORBIDDEN_SP18_PLUS,
        ...FORBIDDEN_SP19_PLUS,
        ...FORBIDDEN_SP20_PLUS,
      ]) {
        expect(
          src.includes(token),
          `${filePath} must not reference cross-slice token: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("pairing matrix integrity (defense in depth — duplicates synthetic-provider-pairing.test.ts assertions)", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(1);
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].imageProvider).toBe("dalle");
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].videoProvider).toBe("kling");
    const expectedShots = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes].sort()).toEqual(
      [...expectedShots].sort(),
    );
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].outputIntents].sort()).toEqual(
      ["draft", "final_export", "meta_draft", "preview"].sort(),
    );
  });

  it("SP1–SP15 source bodies are unchanged since the SP15 baseline (allowlist edits only)", () => {
    const SP15_BASELINE = "9dca008"; // SP15-on-main merge tip
    const allowedEdits = new Set([
      // SP16 net-new schema (Task 2)
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      "packages/schemas/src/index.ts",
      // SP16 net-new pipeline subdir
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/index.ts",
      // SP16 barrel widening (Task 14)
      "packages/creative-pipeline/src/index.ts",
      // SP16 design + plan docs
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-sp16-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-sp16-plan.md",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP15_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      return; // shallow clone — skip
    }
    if (baselineSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${baselineSha} HEAD`, {
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 13)
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts")
        continue;
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP15_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 12.2: Run the anti-pattern test**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test sp16-anti-patterns
```

Expected: 7 assertions PASS. (Note: the frozen-source-body assertion will pass because no prior anti-pattern tests have been modified yet — Task 13 widens them.)

- [ ] **Step 12.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts
git commit -m "test(pcd): SP16 task 12 — sp16-anti-patterns.test.ts (7 structural assertions)"
```

---

### Task 13: Allowlist Maintenance — Widen 7 Prior Anti-Pattern Tests

**Goal:** Add SP16's net-new files to the frozen-source-body allowlists in the 7 prior anti-pattern tests, so each of them passes after SP16 ships. The pattern matches what SP15 did to widen SP14: append `if (file === ...) continue;` lines (NOT `allowedEdits` — that set is per-slice).

**Files modified:**
- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts`

- [ ] **Step 13.1: For EACH of the 7 prior anti-pattern test files, locate the frozen-source-body `it(...)` block (the one that constructs `allowedEdits`) and append the following SP16-skip block immediately AFTER the existing skip-prefix `continue;` chain (the section ending in the SP15 file-equality continues, and BEFORE the `expect(allowedEdits.has(file), ...)` line)**

Exact lines to append in every prior test (paste verbatim):

```ts
      // SP16 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP16 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      if (file === "packages/schemas/src/pcd-synthetic-router.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts") continue;
```

That is the same diff for all 7 files: a 4-line append block (3 `continue;` lines + 1 comment) inside the frozen-source-body `it(...)` block.

**Defensive note:** before editing each file, re-grep to confirm no prior pass has already added an SP16-skip block:

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
grep -L "synthetic-router" \
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts \
  packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts
```

Expected: all 7 paths returned (no file already references `synthetic-router`). If a path is omitted, that file already has the skip block — leave it alone.

- [ ] **Step 13.2: Run the full creative-pipeline anti-pattern suite — verify all 8 anti-pattern tests (7 prior widened + new SP16) pass**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm --filter @creativeagent/creative-pipeline test anti-patterns
```

Expected: every anti-pattern test passes. The frozen-source-body assertions in the 7 prior tests now accept SP16's net-new files.

- [ ] **Step 13.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts
git commit -m "test(pcd): SP16 task 13 — widen 7 prior anti-pattern allowlists for SP16 files"
```

---

### Task 14: Barrel Re-exports (creative-pipeline only — schemas already widened in Task 2)

**Goal:** Create the slice barrel for the synthetic-router subdir and surface its symbols through `packages/creative-pipeline/src/index.ts`. The schemas barrel was already widened in Task 2.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 14.1: Create the slice barrel**

Create `packages/creative-pipeline/src/pcd/synthetic-router/index.ts`:

```ts
export { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";
export {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
  type SyntheticProviderPairing,
} from "./synthetic-provider-pairing.js";
export {
  routeSyntheticPcdShot,
  buildSyntheticSelectionRationale,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";
```

- [ ] **Step 14.2: Widen the creative-pipeline barrel**

Edit `packages/creative-pipeline/src/index.ts` — append at the bottom:

```ts

// SP16 — synthetic creator provider routing
export * from "./pcd/synthetic-router/index.js";
```

- [ ] **Step 14.3: Run typecheck across all packages**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm typecheck
```

Expected: typecheck clean across all 5 packages.

- [ ] **Step 14.4: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git add packages/creative-pipeline/src/pcd/synthetic-router/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP16 task 14 — barrel re-exports (creative-pipeline)"
```

---

### Task 15: Final Full-Repo Sweep — typecheck + test + prettier + open PR

**Goal:** Verify the slice is end-to-end green and open the PR. Target counts: SP15 baseline (1887 passed + 2 skipped) + ~80 SP16 net-new tests (the 28-combo parametric `it()` block in Task 8 is the bulk) ≈ **~1965–1970 passing**, 2 skipped unchanged.

- [ ] **Step 15.1: Run typecheck across the repo**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm typecheck
```

Expected: clean across all packages.

- [ ] **Step 15.2: Run the full test suite**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm test 2>&1 | tail -20
```

Expected per-package totals (approx):
- `@creativeagent/schemas:test`  — `~261 passed` (247 baseline + ~14 SP16 schema)
- `@creativeagent/db:test`       — `105 passed | 2 skipped` (no change)
- `@creativeagent/creative-pipeline:test` — `~1601 passed` (1535 baseline + ~66 SP16 pipeline: 1 router-version + 8 pairing-matrix + ~50 router-function + 7 anti-pattern)

The exact passing count may drift by ±10 depending on how the parametric block in Task 8 landed (28 separate `it()` calls vs. one `it()` with a loop body — the plan calls for 28 separate calls for better failure messages). If the **skipped count changes** from 2, investigate before declaring victory.

- [ ] **Step 15.3: Run prettier check**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: only the 2 pre-existing SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`. **SP16 introduces no new prettier warnings.** If new warnings appear, run `pnpm exec prettier --write <path>` on the offending file(s) and commit the fix as part of this task.

- [ ] **Step 15.4: Open the PR**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp16
git push -u origin pcd/sp16-synthetic-provider-routing
gh pr create --title "feat(pcd): SP16 — synthetic provider routing (locked DALL-E + Kling pairing wrap of SP4)" --body "$(cat <<'EOF'
## Summary
- Adds `routeSyntheticPcdShot({resolvedContext, syntheticIdentity, shotType, outputIntent, approvedCampaignContext}, stores)` — pure wrapper around SP4's `routePcdShot` that emits a locked DALL-E + Kling pairing decision for in-pairing video shot types and transparently delegates to SP4 for `script_only` / `storyboard`. Three-branch decision union: synthetic-pairing allowed (carries `dallePromptLocked` + `klingDirection` verbatim), synthetic-pairing `ACCESS_POLICY` denial, and `delegated_to_generic_router` (carries embedded `sp4Decision: PcdRoutingDecision`).
- Ships the single-row `PCD_SYNTHETIC_PROVIDER_PAIRING` matrix covering all seven video-modality shot types × four output intents, plus the 20th and 21st pinned PCD constants `PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.0.0"` and `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.0.0"` under the single-source rule.
- Net-new zod schema `PcdRoutingDecisionSchema` (analogue of SP4's TypeScript-only `PcdRoutingDecision`) so the delegation envelope round-trips. SP16 owns this schema for now per design J13/U1; SP17 will likely centralize it when persistence becomes a concern. Drift between SP4's TS type and the zod schema is mitigated by real-call drift verification tests against `routePcdShot` outputs for the two reachable SP4 branches.
- Zero edits to SP4 (`provider-router.ts`, `provider-capability-matrix.ts`, `tier3-routing-rules.ts`). Zero new Prisma model, zero migration, zero DB-package consumer.

## Test plan
- [ ] `pnpm typecheck` clean across all 5 packages
- [ ] `pnpm test` — ~1965 passing, 2 skipped (SP15 baseline 1887 + ~80 SP16 net-new; the 28-combo parametric `it()` block in Task 8 is the bulk)
- [ ] `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"` — only the 2 pre-existing SP5-baseline warnings
- [ ] All 8 anti-pattern tests pass (7 prior allowlists widened in Task 13 + new SP16 in Task 12)
- [ ] `routeSyntheticPcdShot` returns `imageProvider: "dalle"` + `videoProvider: "kling"` on every (video shot × output intent) combo at tier 3
- [ ] SP4's `routePcdShot` outputs round-trip byte-equal through `PcdRoutingDecisionSchema.parse()` for both reachable branches (`ACCESS_POLICY` denial + allowed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened against `main`. Squash-merge after CI green.

---

## Spec coverage cross-walk

| Spec section | Plan task(s) |
|---|---|
| §1 Scope & strategy | All tasks; explicit OOS notes in PR description |
| §2.1 Q1 (wrap, don't extend SP4) | Tasks 5–8 (wrapper-only; SP4 frozen by Task 12 anti-pattern #6) |
| §2.1 Q2 (declarative single-row pairing matrix) | Task 4 + Task 12 anti-pattern #6 |
| §2.1 Q3 (locked artifacts verbatim on success) | Task 8 (`dallePromptLocked` + `klingDirection` echo tests) |
| §2.1 Q4 (no SP11 widen — fields already exist) | Task 1.4 pre-flight grep + Task 8 happy-path uses cheryl payload as-is |
| §2.1 Q5 (three branches in v1; NO_SYNTHETIC_PROVIDER_PAIRING reserved name only) | Task 2 zod (3 branches, no 4th); Task 8 (success + denial); Task 6 (delegation) |
| §2.1 Q6 (20th + 21st pinned constants single-source) | Tasks 3 + 4 + Task 12 anti-pattern #1, #2 |
| §2.1 Q7 (`allowed` + `kind` discriminants) | Task 2 zod surface |
| §2.1 Q8 (tier policy gate inside synthetic path) | Task 7 (Step 3) |
| §2.1 Q9 (no tier3 generic rules on synthetic path) | Task 12 anti-pattern #4 + Task 8 (success branch carries no `tier3RulesApplied`) |
| §2.1 Q10 (synthetic identity passed as data) | Task 5 (`syntheticIdentity` is a bare input field, not a store) |
| §2.1 Q11 (coupled `imageProvider: "dalle"` + `videoProvider: "kling"`) | Task 4 matrix + Task 8 success branch |
| §2.1 Q12 (failure-mode coverage = ACCESS_POLICY + embedded sp4Decision) | Tasks 6 + 7 + 11 |
| §2.2 J1 (decision struct field set) | Task 2 zod + Task 8 success branch shape |
| §2.2 J2 (subdir = `pcd/synthetic-router/`) | All pipeline-side files in Tasks 3–12 |
| §2.2 J3 (file layout = router-version + pairing + route + tests) | Tasks 3, 4, 5–11, 12 |
| §2.2 J4 (purity envelope) | Task 12 anti-pattern #3 |
| §2.2 J5 (re-use SP4 stores type) | Task 5 imports `ProviderRouterStores` from SP4 |
| §2.2 J6 (input contract) | Task 5 type definition |
| §2.2 J7 (matrix shotTypes verbatim, exclude script/storyboard) | Task 4 matrix + Task 4 tests + Task 12 anti-pattern #6 |
| §2.2 J8 (no SP4-internals leakage) | Task 12 anti-pattern #4 |
| §2.2 J9 (no separate seed file) | Matrix authored in source per Task 4; no seed file in §3.1 |
| §2.2 J10 (rationale string template + 200-char cap) | Task 9 |
| §2.2 J11 (no sha256 in SP16) | Task 12 anti-pattern #3 forbids `crypto` import |
| §2.2 J12 (no creator/context cross-validation in SP16) | Task 5 input shape — no validation; SP21 owns |
| §2.2 J13 / U1 (SP16 owns PcdRoutingDecisionSchema) | Task 2 schema + Task 11 drift verification |
| §3.1 File layout | Tasks 2 (schemas), 3, 4, 5, 12, 14 |
| §3.2 Zod surface | Task 2 |
| §3.3 Version constants | Tasks 3 + 4 |
| §3.4 Pairing matrix | Task 4 |
| §3.5 Pure router function | Tasks 5–9 |
| §3.6 Slice barrel | Task 14 |
| §3.7 Barrel re-exports | Task 2 (schemas), Task 14 (creative-pipeline) |
| §4.1 Pseudocode | Tasks 6 (Step 1+2), 7 (Step 3), 8 (Step 4) |
| §4.2 buildSyntheticSelectionRationale | Task 9 |
| §4.3 Determinism guarantees | Task 10 + Task 12 anti-pattern #3 |
| §5.1 Router unit tests (~24) | Tasks 6, 7, 8, 9, 10, 11 |
| §5.2 Pairing matrix tests (~8) | Task 4 |
| §5.3 Zod surface tests (~14) | Task 2 |
| §5.4 Anti-pattern tests (6 assertions, +1 frozen = 7) | Task 12 |
| §5.5 Allowlist maintenance | Task 13 |
| §5.6 Integration / cross-package | Task 15 |
| §6 Merge-back markers | Comment markers embedded in source per task (Task 2 schema, Task 3 router-version, Task 4 pairing-version + matrix, Task 5 routeSyntheticPcdShot signature) |
| §9 Implementation slicing preview | Aligned 1:1 with this plan's Tasks 1–15 |

---

*End of plan. Use superpowers:subagent-driven-development to execute task-by-task.*
