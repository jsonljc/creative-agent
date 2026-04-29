# PCD SP7 — Identity-Aware Pre-Production Chain + Single Production Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SP7 of the PCD vertical — the first synergy slice. A pure store-injected composer (`runIdentityAwarePreproductionChain`) that takes a `PcdBriefInput`, builds an immutable `PcdIdentityContext` at the head (consent pre-check + tier projection + creative substrate + UGC style constraints), runs four stage runners (trends → motivators → hooks → creator scripts) with no per-stage human gates, and ends at a single `ProductionFanoutGate.requestSelection` returning a forensic `PcdProductionFanoutDecision`. Stub stage runners and an `AutoApproveOnlyScriptGate` default ship in-tree; real Switchboard implementations come at merge-back. No Prisma migration. Two new pinned constants. Thirteen `// MERGE-BACK:` markers.

**Architecture:** Single async pure-function composer over fixed call sequence. Identity context is `Object.freeze`d before the first stage runner sees it. Stage-runner runtime errors wrap in `PreproductionChainError({ stage, cause })`; pre-stage errors (zod, `ConsentRevokedRefusalError`, `InvariantViolationError`) propagate raw. `selectedScriptIds` and `availableScriptIds` are sorted ascending. Decision struct pins three versions from imports (`PCD_PREPRODUCTION_CHAIN_VERSION`, `PCD_IDENTITY_CONTEXT_VERSION`, reused `PCD_APPROVAL_LIFECYCLE_VERSION`). `decidedAt` comes from injected clock for deterministic tests.

**Tech Stack:** TypeScript ESM, Vitest, Zod, pnpm + Turborepo. Layer rules per `CLAUDE.md`: schemas (zod-only) → db (schemas + Prisma) → creative-pipeline (schemas + db + inngest). SP7 lives entirely in creative-pipeline + schemas; no `db` changes.

**Source-of-truth design:** `docs/plans/2026-04-29-pcd-preproduction-chain-sp7-design.md` (commit `b3d46d6`). **Read this entirely before starting any task** — it carries the locked decisions Q4–Q14, the schema bodies, the 13 merge-back markers, and the six non-obvious conclusions.

**Implementation clarification (resolves one design-doc imprecision):**

The design doc says `buildPcdIdentityContext` "wraps SP3's `resolvePcdRegistryContext`." In implementation, the function does NOT literally call SP3's resolver. Reason: SP3's resolver takes a `PcdResolvableJob` (with `organizationId`, `deploymentId`, `productDescription`, `productImages`) and persists via `jobStore.attachIdentityRefs`. SP7's pre-job `PcdBriefInput` doesn't have those fields, and SP7 must not persist. Instead:

- SP7 defines two new reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) that read product/creator rows by ID and return the fields SP7 needs (`qualityTier` + creative substrate).
- SP7 calls SP6's `assertConsentNotRevokedForGeneration` directly using SP6's existing `CreatorIdentityReader` + `ConsentRecordReader` (no change to SP6).
- SP7 duplicates SP3's pure `qualityTier → IdentityTier` mapping logic (small pure switch). Acceptable per the locked "no SP1–SP6 source body changes" rule.
- The composition is structurally equivalent to SP3+SP6's lifecycle moment, adapted for the pre-job brief surface.

**Upstream context to read once before Task 0:**

- `CLAUDE.md` — repo conventions (ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft / 600-line hard file limit).
- `docs/SWITCHBOARD-CONTEXT.md` — merge-back rules.
- `docs/plans/2026-04-27-pcd-identity-registry-design.md` — original PCD identity registry design (sections "Tier gating rules", "Tier 3 mandatory routing rules", "Identity snapshot").
- `docs/plans/2026-04-29-pcd-lifecycle-gates-sp6-design.md` — SP6 design; SP7 reuses `assertConsentNotRevokedForGeneration` + `ConsentRevokedRefusalError` + `InvariantViolationError` + `CreatorIdentityReader` + `ConsentRecordReader` exports. SP7's testing-strategy + anti-pattern-grep style mirror SP6.
- `packages/schemas/src/pcd-identity.ts` — existing schemas (`IdentityTierSchema`, `PcdShotTypeSchema`, `OutputIntentSchema`, `AvatarQualityTier`, `ProductQualityTier`).
- `packages/creative-pipeline/src/pcd/registry-resolver.ts` — for the qualityTier → IdentityTier mapping (`mapProductQualityTierToIdentityTier`, `mapCreatorQualityTierToIdentityTier`, `computeEffectiveTier`). SP7 duplicates the pure logic.
- `packages/creative-pipeline/src/pcd/tier-policy.ts` — `decidePcdGenerationAccess` is what SP7's tier-projection consumes.
- `packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts` — SP6 pre-check signature.

**Pre-existing tooling baseline (per `docs/plans/2026-04-29-pcd-qc-gates-sp5-baseline.md`):** `pnpm lint` is structurally broken on `main` (ESLint not installed in any package). SP7 uses `pnpm exec prettier --check` as the practical style gate, matching SP4/SP5/SP6 precedent. Final verification command is `pnpm build && pnpm test && pnpm typecheck && pnpm exec prettier --check '**/*.ts'`.

---

## File structure (locked)

**NEW files:**

```
packages/schemas/src/pcd-preproduction.ts                 # all SP7 zod schemas
packages/schemas/src/__tests__/pcd-preproduction.test.ts  # schema test cases

packages/creative-pipeline/src/pcd/preproduction/
  index.ts                                  # barrel re-exports
  preproduction-chain-version.ts            # PCD_PREPRODUCTION_CHAIN_VERSION
  preproduction-chain-version.test.ts
  identity-context-version.ts               # PCD_IDENTITY_CONTEXT_VERSION
  identity-context-version.test.ts
  preproduction-chain-error.ts              # PreproductionChainError class
  preproduction-chain-error.test.ts
  sp7-readers.ts                            # Sp7ProductRegistryReader + Sp7CreatorRegistryReader interfaces
  build-pcd-identity-context.ts             # buildPcdIdentityContext
  build-pcd-identity-context.test.ts
  production-fanout-gate.ts                 # ProductionFanoutGate + AutoApproveOnlyScriptGate
  production-fanout-gate.test.ts
  preproduction-chain.ts                    # runIdentityAwarePreproductionChain
  preproduction-chain.test.ts
  sp7-anti-patterns.test.ts                 # cross-cutting anti-pattern grep + forbidden-imports
  stages/
    trends-stage-runner.ts                  # interface
    motivators-stage-runner.ts              # interface
    hooks-stage-runner.ts                   # interface
    creator-scripts-stage-runner.ts         # interface
    stub-trends-stage-runner.ts             # default
    stub-trends-stage-runner.test.ts
    stub-motivators-stage-runner.ts         # default
    stub-motivators-stage-runner.test.ts
    stub-hooks-stage-runner.ts              # default
    stub-hooks-stage-runner.test.ts
    stub-creator-scripts-stage-runner.ts    # default
    stub-creator-scripts-stage-runner.test.ts
```

**MODIFIED files:**

```
packages/schemas/src/index.ts                       # re-export new SP7 schemas
packages/creative-pipeline/src/index.ts             # re-export SP7 surfaces
docs/SWITCHBOARD-CONTEXT.md                         # SP7 merge-back notes
```

**NO migration**. NO changes to `packages/db/`. NO changes to SP1–SP6 source bodies.

---

## Task 0: Pre-flight — sync, branch, baseline check

**Files:**
- None (environment setup).

- [ ] **Step 1: Sync local main with origin/main**

```bash
cd ~/creativeagent
git checkout main
git fetch origin
git reset --hard origin/main
git log --oneline -3
```

Expected: `c250018 feat(pcd): SP6 — approval / final-export / meta-draft / consent-revocation lifecycle gates (#5)` is the most recent commit on origin/main. The local `b3d46d6 docs(pcd): SP7 design ...` is a local-only commit ahead of main; ensure either it lives on a branch or the SP7 branch is created from a tip that includes it.

If `b3d46d6` is on local `main` but not on `origin/main`, push it before Task 0 sync OR create the SP7 branch from local main BEFORE syncing:

```bash
git checkout -b feat/pcd-sp7-preproduction-chain   # from local main containing b3d46d6
git log --oneline -3
```

Expected: includes `b3d46d6 docs(pcd): SP7 design — identity-aware pre-production chain + single production gate`.

- [ ] **Step 2: Confirm SP7 branch is current**

```bash
git branch --show-current
```

Expected: `feat/pcd-sp7-preproduction-chain`.

- [ ] **Step 3: Verify baseline build/test/typecheck/prettier**

```bash
pnpm install
pnpm db:generate
pnpm build
pnpm test
pnpm typecheck
pnpm exec prettier --check '**/*.ts' '!**/dist/**' '!**/node_modules/**'
```

Expected: build succeeds across 5 packages; SP6 baseline ~1,200+ tests pass; typecheck clean; prettier check clean (modulo the two pre-existing tier-policy.ts warnings noted in SP5 baseline — these are not SP7's regression).

- [ ] **Step 4: Confirm SP1/SP3/SP6 surfaces SP7 will compose**

```bash
grep -nE "export (function|class|const|type) (assertConsentNotRevokedForGeneration|ConsentRevokedRefusalError|InvariantViolationError|CreatorIdentityReader|ConsentRecordReader|decidePcdGenerationAccess|PCD_APPROVAL_LIFECYCLE_VERSION|PcdShotTypeSchema|OutputIntentSchema|IdentityTierSchema)" \
  packages/creative-pipeline/src/index.ts \
  packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts \
  packages/creative-pipeline/src/pcd/lifecycle-readers.ts \
  packages/creative-pipeline/src/pcd/tier-policy.ts \
  packages/creative-pipeline/src/pcd/approval-lifecycle-version.ts \
  packages/schemas/src/pcd-identity.ts \
  packages/schemas/src/index.ts 2>&1 | head -40
```

Expected: each named export resolves. SP7's plan depends on all of these; if any is missing, the slice tag is wrong (SP6 not actually merged or partial).

- [ ] **Step 5: Confirm Prisma model field names SP7's reader implementers will eventually wrap**

```bash
grep -nE "model (CreatorIdentity|ProductIdentity|ProductImage)" packages/db/prisma/schema.prisma
grep -nE "qualityTier|consentRecordId|voiceId|canonicalPackageText|viewType" packages/db/prisma/schema.prisma | head -30
```

Expected: `CreatorIdentity` has `qualityTier`, `consentRecordId`, possibly `voiceId`. `ProductIdentity` has `qualityTier`, `canonicalPackageText`. `ProductImage` has `viewType`. SP7 ships interfaces only — Prisma adapters in `packages/db/` are NOT in SP7 scope (deferred to merge-back).

- [ ] **Step 6: No commit — environment-only task. Proceed to Task 1.**

---

## Task 1: Add `PreproductionChainStageEnumSchema` to a new schemas file

**Files:**
- Create: `packages/schemas/src/pcd-preproduction.ts`
- Create: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

This task seeds the new schemas file with the smallest schema first so subsequent tasks can append.

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/pcd-preproduction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PreproductionChainStageEnumSchema } from "../pcd-preproduction.js";

describe("PreproductionChainStageEnumSchema", () => {
  it("accepts every documented stage name", () => {
    const stages = [
      "trends",
      "motivators",
      "hooks",
      "creator_scripts",
      "production_fanout_gate",
    ];
    for (const s of stages) {
      expect(PreproductionChainStageEnumSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects undocumented stage names", () => {
    expect(PreproductionChainStageEnumSchema.safeParse("storyboard").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("scripts").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `Cannot find module '../pcd-preproduction.js'`.

- [ ] **Step 3: Create the new schemas file with the enum**

Create `packages/schemas/src/pcd-preproduction.ts`:

```ts
// SP7 — Identity-Aware Pre-Production Chain schemas.
// Source of truth: docs/plans/2026-04-29-pcd-preproduction-chain-sp7-design.md
import { z } from "zod";
import { IdentityTierSchema, OutputIntentSchema, PcdShotTypeSchema } from "./pcd-identity.js";

// Stage discriminant for PreproductionChainError. Also used by anti-pattern
// grep tests to enforce that no SP7 source dispatches by stage name outside
// the error-class discriminator.
export const PreproductionChainStageEnumSchema = z.enum([
  "trends",
  "motivators",
  "hooks",
  "creator_scripts",
  "production_fanout_gate",
]);
export type PreproductionChainStage = z.infer<typeof PreproductionChainStageEnumSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (2 tests).

- [ ] **Step 5: Re-export from `packages/schemas/src/index.ts`**

Append at the end of `packages/schemas/src/index.ts`:

```ts
// SP7 — preproduction chain
export * from "./pcd-preproduction.js";
```

- [ ] **Step 6: Verify barrel export works**

```bash
pnpm --filter @creativeagent/schemas typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP7 — seed pcd-preproduction schemas with stage enum"
```

---

## Task 2: Add `UgcStyleConstraintSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/schemas/src/__tests__/pcd-preproduction.test.ts`:

```ts
import { UgcStyleConstraintSchema } from "../pcd-preproduction.js";

describe("UgcStyleConstraintSchema", () => {
  it("accepts the five locked constraint values", () => {
    const values = [
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ];
    for (const v of values) {
      expect(UgcStyleConstraintSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects undocumented constraints", () => {
    expect(UgcStyleConstraintSchema.safeParse("polished_brand_film").success).toBe(false);
    expect(UgcStyleConstraintSchema.safeParse("").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `UgcStyleConstraintSchema is not exported`.

- [ ] **Step 3: Append the schema**

Append to `packages/schemas/src/pcd-preproduction.ts`:

```ts
// UGC creative-format constraints. Lives in PcdIdentityContext so every stage
// runner consumes the same UGC-format ground truth — prevents drift toward
// polished ad-film language.
export const UgcStyleConstraintSchema = z.enum([
  "native_vertical",                  // 9:16 selfie-style framing
  "creator_led",                      // first-person creator voice
  "no_overproduced_storyboard",       // no studio-shoot framing
  "product_fidelity_required",        // canonical text/logo faithfulness
  "no_invented_product_claims",       // no claims absent from registry
]);
export type UgcStyleConstraint = z.infer<typeof UgcStyleConstraintSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add UgcStyleConstraintSchema"
```

---

## Task 3: Add `PcdBriefInputSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

- [ ] **Step 1: Append failing test**

Append:

```ts
import { PcdBriefInputSchema } from "../pcd-preproduction.js";

describe("PcdBriefInputSchema", () => {
  const valid = {
    briefId: "brief-1",
    productDescription: "AI WhatsApp lead-reply assistant",
    targetAudience: "Solo founders running paid traffic",
    platforms: ["instagram_reels", "tiktok"],
    brandVoice: null,
    references: [],
    creatorIdentityRef: "creator-1",
    productIdentityRef: "product-1",
  };

  it("accepts a minimal valid brief", () => {
    expect(PcdBriefInputSchema.safeParse(valid).success).toBe(true);
  });

  it("requires briefId", () => {
    const { briefId: _b, ...withoutId } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutId).success).toBe(false);
  });

  it("requires creatorIdentityRef", () => {
    const { creatorIdentityRef: _c, ...withoutCreator } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutCreator).success).toBe(false);
  });

  it("requires productIdentityRef", () => {
    const { productIdentityRef: _p, ...withoutProduct } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutProduct).success).toBe(false);
  });

  it("allows brandVoice to be null or undefined", () => {
    expect(PcdBriefInputSchema.safeParse({ ...valid, brandVoice: null }).success).toBe(true);
    const { brandVoice: _bv, ...withoutBrandVoice } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutBrandVoice).success).toBe(true);
  });

  it("allows references to be omitted", () => {
    const { references: _r, ...withoutRefs } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutRefs).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `PcdBriefInputSchema is not exported`.

- [ ] **Step 3: Append the schema**

Append to `packages/schemas/src/pcd-preproduction.ts`:

```ts
export const PcdBriefInputSchema = z.object({
  briefId: z.string().min(1),
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(z.string().min(1)),
  brandVoice: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  creatorIdentityRef: z.string().min(1),
  productIdentityRef: z.string().min(1),
});
export type PcdBriefInput = z.infer<typeof PcdBriefInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add PcdBriefInputSchema"
```

---

## Task 4: Add `PcdIdentityContextSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

- [ ] **Step 1: Append failing test**

Append:

```ts
import { PcdIdentityContextSchema } from "../pcd-preproduction.js";

describe("PcdIdentityContextSchema", () => {
  const valid = {
    creatorIdentityId: "creator-1",
    productIdentityId: "product-1",
    consentRecordId: null,
    effectiveTier: 2,
    productTierAtResolution: 2,
    creatorTierAtResolution: 2,
    allowedShotTypes: ["simple_ugc", "talking_head"],
    allowedOutputIntents: ["draft", "preview", "final_export"],
    tier3Rules: {
      firstLastFrameRequired: false,
      performanceTransferRequired: false,
      editOverRegenerateRequired: false,
    },
    voiceId: null,
    productCanonicalText: "ACME Pro 200ml Hand Cream",
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
    identityContextVersion: "identity-context@1.0.0",
  };

  it("accepts a fully populated context", () => {
    expect(PcdIdentityContextSchema.safeParse(valid).success).toBe(true);
  });

  it("requires identityContextVersion", () => {
    const { identityContextVersion: _v, ...withoutVersion } = valid;
    expect(PcdIdentityContextSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("rejects effectiveTier=0 or 4", () => {
    expect(PcdIdentityContextSchema.safeParse({ ...valid, effectiveTier: 0 }).success).toBe(false);
    expect(PcdIdentityContextSchema.safeParse({ ...valid, effectiveTier: 4 }).success).toBe(false);
  });

  it("rejects unknown shot type in allowedShotTypes", () => {
    expect(
      PcdIdentityContextSchema.safeParse({
        ...valid,
        allowedShotTypes: ["unknown_shot"],
      }).success,
    ).toBe(false);
  });

  it("requires all tier3Rules sub-flags", () => {
    expect(
      PcdIdentityContextSchema.safeParse({
        ...valid,
        tier3Rules: { firstLastFrameRequired: false },
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `PcdIdentityContextSchema is not exported`.

- [ ] **Step 3: Append the schema**

Append to `packages/schemas/src/pcd-preproduction.ts`:

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
  allowedShotTypes: z.array(PcdShotTypeSchema),
  allowedOutputIntents: z.array(OutputIntentSchema),

  // Tier 3 rule flags
  tier3Rules: z.object({
    firstLastFrameRequired: z.boolean(),
    performanceTransferRequired: z.boolean(),
    editOverRegenerateRequired: z.boolean(),
  }),

  // Creative substrate
  voiceId: z.string().nullable(),
  productCanonicalText: z.string(),
  productHeroPackshotAssetId: z.string().nullable(),
  brandPositioningText: z.string().nullable(),

  // UGC creative-format constraints
  ugcStyleConstraints: z.array(UgcStyleConstraintSchema),

  // Consent flag
  consentRevoked: z.boolean(),

  // Version pin
  identityContextVersion: z.string(),
});
export type PcdIdentityContext = z.infer<typeof PcdIdentityContextSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add PcdIdentityContextSchema with tier projection + ugc style constraints"
```

---

## Task 5: Add stage-output schemas (trends, motivators, hooks)

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

Three schemas in one task because they're symmetric and small. Creator scripts (discriminated union) is its own task.

- [ ] **Step 1: Append failing test**

Append:

```ts
import {
  TrendStageOutputSchema,
  MotivatorsStageOutputSchema,
  HooksStageOutputSchema,
  HookTypeSchema,
} from "../pcd-preproduction.js";

describe("TrendStageOutputSchema", () => {
  const valid = {
    signals: [
      {
        id: "trend-1",
        summary: "Solo founders are losing leads after-hours",
        audienceFit: "founder/operator",
        evidenceRefs: [],
      },
    ],
  };
  it("accepts length-1 signal list", () => {
    expect(TrendStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty signals list", () => {
    expect(TrendStageOutputSchema.safeParse({ signals: [] }).success).toBe(false);
  });
  it("requires id, summary, audienceFit, evidenceRefs per signal", () => {
    expect(
      TrendStageOutputSchema.safeParse({
        signals: [{ id: "trend-1", summary: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("MotivatorsStageOutputSchema", () => {
  const valid = {
    motivators: [
      {
        id: "motivator-1",
        frictionOrDesire: "Slow lead reply kills conversion",
        audienceSegment: "solo-founder",
        evidenceRefs: [],
        parentTrendId: "trend-1",
      },
    ],
  };
  it("accepts length-1 motivators list with parentTrendId", () => {
    expect(MotivatorsStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires parentTrendId per motivator", () => {
    const noParent = { motivators: [{ ...valid.motivators[0], parentTrendId: undefined }] };
    expect(MotivatorsStageOutputSchema.safeParse(noParent).success).toBe(false);
  });
});

describe("HookTypeSchema", () => {
  it("accepts the four UGC hook types", () => {
    for (const v of ["direct_camera", "mid_action", "reaction", "text_overlay_start"]) {
      expect(HookTypeSchema.safeParse(v).success).toBe(true);
    }
  });
  it("rejects unknown hook types", () => {
    expect(HookTypeSchema.safeParse("voiceover_static").success).toBe(false);
  });
});

describe("HooksStageOutputSchema", () => {
  const valid = {
    hooks: [
      {
        id: "hook-1",
        text: "Still losing WhatsApp leads after running ads?",
        hookType: "direct_camera" as const,
        parentMotivatorId: "motivator-1",
        parentTrendId: "trend-1",
      },
    ],
  };
  it("accepts length-1 hooks list with both parent IDs", () => {
    expect(HooksStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires both parentMotivatorId and parentTrendId", () => {
    const { parentMotivatorId: _m, ...rest } = valid.hooks[0]!;
    expect(HooksStageOutputSchema.safeParse({ hooks: [rest] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `TrendStageOutputSchema is not exported`.

- [ ] **Step 3: Append the schemas**

Append:

```ts
export const TrendSignalSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  audienceFit: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export const TrendStageOutputSchema = z.object({
  signals: z.array(TrendSignalSchema).min(1),
});
export type TrendStageOutput = z.infer<typeof TrendStageOutputSchema>;

export const MotivatorSchema = z.object({
  id: z.string().min(1),
  frictionOrDesire: z.string().min(1),
  audienceSegment: z.string(),
  evidenceRefs: z.array(z.string()),
  parentTrendId: z.string().min(1),
});
export type Motivator = z.infer<typeof MotivatorSchema>;

export const MotivatorsStageOutputSchema = z.object({
  motivators: z.array(MotivatorSchema).min(1),
});
export type MotivatorsStageOutput = z.infer<typeof MotivatorsStageOutputSchema>;

export const HookTypeSchema = z.enum([
  "direct_camera",
  "mid_action",
  "reaction",
  "text_overlay_start",
]);
export type HookType = z.infer<typeof HookTypeSchema>;

export const HookSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  hookType: HookTypeSchema,
  parentMotivatorId: z.string().min(1),
  parentTrendId: z.string().min(1),
});
export type Hook = z.infer<typeof HookSchema>;

export const HooksStageOutputSchema = z.object({
  hooks: z.array(HookSchema).min(1),
});
export type HooksStageOutput = z.infer<typeof HooksStageOutputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (~22 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add trend/motivator/hook stage-output schemas"
```

---

## Task 6: Add `CreatorScriptSchema` (discriminated union) + `CreatorScriptsStageOutputSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

The script schema is a zod discriminated union on `scriptStyle: "spoken_lines" | "talking_points"` — exactly one variant per script.

- [ ] **Step 1: Append failing test**

Append:

```ts
import {
  CreatorScriptSchema,
  CreatorScriptsStageOutputSchema,
} from "../pcd-preproduction.js";

describe("CreatorScriptSchema", () => {
  const baseFields = {
    id: "script-1",
    hookText: "Still losing WhatsApp leads after running ads?",
    creatorAngle: "founder explaining the hidden leak",
    visualBeats: ["show inbox", "show instant reply", "show booking"],
    productMoment: "Lead → reply → booking",
    cta: "Try Switchboard",
    complianceNotes: [],
    identityConstraints: {
      creatorIdentityId: "creator-1",
      productIdentityId: "product-1",
      voiceId: null,
    },
    parentHookId: "hook-1",
  };

  it("accepts a spoken_lines script", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: ["Most businesses don't lose leads because the ads are bad."],
      }).success,
    ).toBe(true);
  });

  it("accepts a talking_points script", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "talking_points",
        talkingPoints: ["Slow reply kills leads.", "Switchboard auto-replies."],
      }).success,
    ).toBe(true);
  });

  it("rejects a script with both spokenLines and talkingPoints", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: ["x"],
        talkingPoints: ["y"],
      }).success,
    ).toBe(false);
  });

  it("rejects a script with neither spokenLines nor talkingPoints", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
      }).success,
    ).toBe(false);
  });

  it("rejects a script with empty spokenLines list", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: [],
      }).success,
    ).toBe(false);
  });

  it("requires parentHookId", () => {
    const { parentHookId: _p, ...rest } = baseFields;
    expect(
      CreatorScriptSchema.safeParse({
        ...rest,
        scriptStyle: "spoken_lines",
        spokenLines: ["x"],
      }).success,
    ).toBe(false);
  });
});

describe("CreatorScriptsStageOutputSchema", () => {
  it("accepts length-1 scripts list", () => {
    const valid = {
      scripts: [
        {
          id: "script-1",
          hookText: "x",
          creatorAngle: "y",
          visualBeats: [],
          productMoment: "z",
          cta: "w",
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: "c1",
            productIdentityId: "p1",
            voiceId: null,
          },
          parentHookId: "h1",
          scriptStyle: "talking_points" as const,
          talkingPoints: ["a"],
        },
      ],
    };
    expect(CreatorScriptsStageOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty scripts list", () => {
    expect(CreatorScriptsStageOutputSchema.safeParse({ scripts: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `CreatorScriptSchema is not exported`.

- [ ] **Step 3: Append the schemas**

Append:

```ts
export const CreatorScriptIdentityConstraintsSchema = z.object({
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  voiceId: z.string().nullable(),
});
export type CreatorScriptIdentityConstraints = z.infer<
  typeof CreatorScriptIdentityConstraintsSchema
>;

const CreatorScriptBaseShape = z.object({
  id: z.string().min(1),
  hookText: z.string().min(1),
  creatorAngle: z.string(),
  visualBeats: z.array(z.string()),
  productMoment: z.string(),
  cta: z.string(),
  complianceNotes: z.array(z.string()),
  identityConstraints: CreatorScriptIdentityConstraintsSchema,
  parentHookId: z.string().min(1),
});

// Discriminated union: exactly one of spokenLines OR talkingPoints. Per the
// SP7 design Q10 lock — neither both nor neither is valid.
export const CreatorScriptSchema = z.discriminatedUnion("scriptStyle", [
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("spoken_lines"),
    spokenLines: z.array(z.string()).min(1),
  }).strict(),
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("talking_points"),
    talkingPoints: z.array(z.string()).min(1),
  }).strict(),
]);
export type CreatorScript = z.infer<typeof CreatorScriptSchema>;

export const CreatorScriptsStageOutputSchema = z.object({
  scripts: z.array(CreatorScriptSchema).min(1),
});
export type CreatorScriptsStageOutput = z.infer<typeof CreatorScriptsStageOutputSchema>;
```

The `.strict()` calls reject objects with extra keys — this is what enforces "no `talkingPoints` field in a `spoken_lines` script."

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (~30 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add CreatorScript discriminated-union schema"
```

---

## Task 7: Add `PcdCostForecastSchema`, `PcdProductionFanoutDecisionSchema`, `PcdPreproductionChainResultSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts`
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts`

- [ ] **Step 1: Append failing test**

Append:

```ts
import {
  PcdCostForecastSchema,
  PcdProductionFanoutDecisionSchema,
  PcdPreproductionChainResultSchema,
} from "../pcd-preproduction.js";

describe("PcdCostForecastSchema", () => {
  it("accepts a forecast with empty line items", () => {
    expect(
      PcdCostForecastSchema.safeParse({
        estimatedUsd: 0,
        currency: "USD",
        lineItems: [],
      }).success,
    ).toBe(true);
  });
  it("rejects negative estimatedUsd", () => {
    expect(
      PcdCostForecastSchema.safeParse({
        estimatedUsd: -1,
        currency: "USD",
        lineItems: [],
      }).success,
    ).toBe(false);
  });
});

describe("PcdProductionFanoutDecisionSchema", () => {
  const valid = {
    briefId: "brief-1",
    creatorIdentityId: "creator-1",
    productIdentityId: "product-1",
    consentRecordId: null,
    effectiveTier: 2,
    selectedScriptIds: ["script-1"],
    availableScriptIds: ["script-1"],
    preproductionChainVersion: "preproduction-chain@1.0.0",
    identityContextVersion: "identity-context@1.0.0",
    approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    decidedAt: "2026-04-29T12:00:00.000Z",
    decidedBy: null,
    costForecast: null,
  };

  it("accepts a fully populated decision", () => {
    expect(PcdProductionFanoutDecisionSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty selectedScriptIds", () => {
    expect(
      PcdProductionFanoutDecisionSchema.safeParse({ ...valid, selectedScriptIds: [] }).success,
    ).toBe(false);
  });
  it("rejects empty availableScriptIds", () => {
    expect(
      PcdProductionFanoutDecisionSchema.safeParse({ ...valid, availableScriptIds: [] }).success,
    ).toBe(false);
  });
  it("rejects malformed decidedAt", () => {
    expect(
      PcdProductionFanoutDecisionSchema.safeParse({ ...valid, decidedAt: "not-a-date" }).success,
    ).toBe(false);
  });
  it("accepts non-null costForecast", () => {
    expect(
      PcdProductionFanoutDecisionSchema.safeParse({
        ...valid,
        costForecast: { estimatedUsd: 1.5, currency: "USD", lineItems: [] },
      }).success,
    ).toBe(true);
  });
});

describe("PcdPreproductionChainResultSchema", () => {
  it("requires both decision and stageOutputs", () => {
    expect(PcdPreproductionChainResultSchema.safeParse({ decision: {} }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: FAIL with `PcdCostForecastSchema is not exported`.

- [ ] **Step 3: Append the schemas**

Append:

```ts
export const PcdCostForecastSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.string().min(1),
  lineItems: z.array(
    z.object({
      label: z.string().min(1),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
});
export type PcdCostForecast = z.infer<typeof PcdCostForecastSchema>;

export const PcdProductionFanoutDecisionSchema = z.object({
  // Forensic identity carry-through
  briefId: z.string().min(1),
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  consentRecordId: z.string().nullable(),
  effectiveTier: IdentityTierSchema,

  // Selection (sorted ascending; the gate adapter enforces sort)
  selectedScriptIds: z.array(z.string().min(1)).min(1),
  availableScriptIds: z.array(z.string().min(1)).min(1),

  // Pinned versions (caller cannot override; pinned by import)
  preproductionChainVersion: z.string(),
  identityContextVersion: z.string(),
  approvalLifecycleVersion: z.string(),

  // Gate metadata
  decidedAt: z.string().datetime(),
  decidedBy: z.string().nullable(),

  // SP10 forward-compat (always null in SP7)
  costForecast: PcdCostForecastSchema.nullable(),
});
export type PcdProductionFanoutDecision = z.infer<typeof PcdProductionFanoutDecisionSchema>;

export const PcdPreproductionChainResultSchema = z.object({
  decision: PcdProductionFanoutDecisionSchema,
  stageOutputs: z.object({
    trends: TrendStageOutputSchema,
    motivators: MotivatorsStageOutputSchema,
    hooks: HooksStageOutputSchema,
    scripts: CreatorScriptsStageOutputSchema,
  }),
});
export type PcdPreproductionChainResult = z.infer<typeof PcdPreproductionChainResultSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/schemas test -- pcd-preproduction
```

Expected: PASS (~38 tests total).

- [ ] **Step 5: Verify the entire schemas package builds + typechecks**

```bash
pnpm --filter @creativeagent/schemas build
pnpm --filter @creativeagent/schemas typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP7 — add cost-forecast + fanout-decision + chain-result schemas"
```

---

## Task 8: Version constants — `PCD_PREPRODUCTION_CHAIN_VERSION` and `PCD_IDENTITY_CONTEXT_VERSION`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.test.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/identity-context-version.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/identity-context-version.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";

describe("PCD_PREPRODUCTION_CHAIN_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PREPRODUCTION_CHAIN_VERSION).toBe("preproduction-chain@1.0.0");
  });
});
```

Create `packages/creative-pipeline/src/pcd/preproduction/identity-context-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

describe("PCD_IDENTITY_CONTEXT_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_IDENTITY_CONTEXT_VERSION).toBe("identity-context@1.0.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction
```

Expected: FAIL with `Cannot find module './preproduction-chain-version.js'` and similar for identity-context.

- [ ] **Step 3: Create the version files**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.ts`:

```ts
// SP7 — pinned version constant for the identity-aware pre-production chain.
// Caller cannot override; pinned by import in the composer and the gate adapter.
export const PCD_PREPRODUCTION_CHAIN_VERSION = "preproduction-chain@1.0.0";
```

Create `packages/creative-pipeline/src/pcd/preproduction/identity-context-version.ts`:

```ts
// SP7 — pinned version constant for the immutable PcdIdentityContext.
export const PCD_IDENTITY_CONTEXT_VERSION = "identity-context@1.0.0";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.test.ts \
        packages/creative-pipeline/src/pcd/preproduction/identity-context-version.ts \
        packages/creative-pipeline/src/pcd/preproduction/identity-context-version.test.ts
git commit -m "feat(pcd): SP7 — pinned version constants for chain + identity context"
```

---

## Task 9: `PreproductionChainError` class

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PreproductionChainError } from "./preproduction-chain-error.js";

describe("PreproductionChainError", () => {
  it("populates name, stage, and cause", () => {
    const cause = new Error("downstream boom");
    const err = new PreproductionChainError({ stage: "trends", cause });
    expect(err.name).toBe("PreproductionChainError");
    expect(err.stage).toBe("trends");
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new PreproductionChainError({ stage: "hooks", cause: new Error("x") });
    expect(err).toBeInstanceOf(Error);
  });

  it("PII bound: enumerable own properties expose only name + stage (no cause)", () => {
    const cause = new Error("brief secret");
    const err = new PreproductionChainError({ stage: "creator_scripts", cause });
    const ownKeys = Object.keys(err);
    // `cause` is non-enumerable so it does not leak when JSON.stringify is called
    // by Inngest/telemetry layers without explicit unwrapping.
    expect(ownKeys).toContain("stage");
    expect(ownKeys).not.toContain("cause");
  });

  it("accepts production_fanout_gate as stage", () => {
    const err = new PreproductionChainError({
      stage: "production_fanout_gate",
      cause: new Error("y"),
    });
    expect(err.stage).toBe("production_fanout_gate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction-chain-error
```

Expected: FAIL with `Cannot find module './preproduction-chain-error.js'`.

- [ ] **Step 3: Implement the class**

Create `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.ts`:

```ts
import type { PreproductionChainStage } from "@creativeagent/schemas";

// SP7 — wraps stage-runner / production-gate runtime failures with a stage
// discriminant. Pre-stage errors (zod, ConsentRevokedRefusalError,
// InvariantViolationError) propagate raw and are NOT wrapped.
export class PreproductionChainError extends Error {
  readonly name = "PreproductionChainError";
  readonly stage: PreproductionChainStage;
  // `cause` is non-enumerable so JSON.stringify(err) does not leak the
  // underlying error's content to Inngest/telemetry layers without an
  // explicit unwrap. Tests assert this PII bound.
  readonly cause: unknown;

  constructor(args: { stage: PreproductionChainStage; cause: unknown }) {
    super(`Preproduction chain failed at stage ${args.stage}`);
    this.stage = args.stage;
    Object.defineProperty(this, "cause", {
      value: args.cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction-chain-error
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.test.ts
git commit -m "feat(pcd): SP7 — PreproductionChainError with stage discriminant + non-enumerable cause"
```

---

## Task 10: SP7 reader interfaces — `Sp7ProductRegistryReader` + `Sp7CreatorRegistryReader`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/sp7-readers.ts`

These are type-only interfaces. No runtime test is required because the interface itself has no behavior; tests in Tasks 11 and 12 exercise the interfaces via fakes.

- [ ] **Step 1: Create the interfaces file**

Create `packages/creative-pipeline/src/pcd/preproduction/sp7-readers.ts`:

```ts
import type { AvatarQualityTier, ProductQualityTier } from "@creativeagent/schemas";

// SP7 — wider readers than SP6's narrow consent-only readers. Read product
// and creator registry rows by ID and return the fields the SP7 chain needs:
// qualityTier (for SP7-side tier mapping), creative substrate fields, and
// the consent record reference (forwarded to SP6's pre-check).
//
// Note: SP7 does NOT call SP3's `resolvePcdRegistryContext`. SP3 takes a
// PcdResolvableJob (with organizationId/deploymentId/productDescription/
// productImages) and persists via jobStore.attachIdentityRefs. SP7's pre-job
// brief surface doesn't fit that signature, and SP7 must not persist. SP7
// duplicates SP3's pure qualityTier→IdentityTier mapping locally.
//
// `// MERGE-BACK: Switchboard wires a real Prisma adapter implementing both
// readers from packages/db/. The interfaces stay; the implementers swap.`

export interface Sp7ProductRegistryReader {
  findById(productIdentityId: string): Promise<{
    id: string;
    qualityTier: ProductQualityTier;
    canonicalPackageText: string | null;
    heroPackshotAssetId: string | null;
    brandPositioningText: string | null;
  } | null>;
}

export interface Sp7CreatorRegistryReader {
  findById(creatorIdentityId: string): Promise<{
    id: string;
    qualityTier: AvatarQualityTier;
    voiceId: string | null;
    consentRecordId: string | null;
  } | null>;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/sp7-readers.ts
git commit -m "feat(pcd): SP7 — reader interfaces for product + creator registry"
```

---

## Task 11: Stage runner interfaces (4 files, type-only)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/trends-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/motivators-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/hooks-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/creator-scripts-stage-runner.ts`

One concern per file. Interface only; tests exercise via stub implementers in Task 12.

- [ ] **Step 1: Create `trends-stage-runner.ts`**

```ts
import type {
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

// SP7 — trends stage. Real Switchboard runner is Claude-driven; this repo
// only ships the interface + a deterministic stub.
export interface TrendsStageRunner {
  run(brief: PcdBriefInput, identityContext: PcdIdentityContext): Promise<TrendStageOutput>;
}
```

- [ ] **Step 2: Create `motivators-stage-runner.ts`**

```ts
import type {
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface MotivatorsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput>;
}
```

- [ ] **Step 3: Create `hooks-stage-runner.ts`**

```ts
import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface HooksStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput>;
}
```

- [ ] **Step 4: Create `creator-scripts-stage-runner.ts`**

```ts
import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface CreatorScriptsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput>;
}
```

- [ ] **Step 5: Verify typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/
git commit -m "feat(pcd): SP7 — four stage-runner interfaces (one per file)"
```

---

## Task 12: Stub stage runners (4 files + tests, deterministic length-1 outputs)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.test.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.test.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.test.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.test.ts`

Each stub: one `// MERGE-BACK:` marker on the class. Deterministic length-1 output derived from the brief's `briefId` and the prior stage's id. Tests assert determinism, schema validity, and parent-id linkage.

### 12a — Stub trends runner

- [ ] **Step 1: Failing test**

Create `stub-trends-stage-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TrendStageOutputSchema } from "@creativeagent/schemas";
import { StubTrendsStageRunner } from "./stub-trends-stage-runner.js";

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

  it("returns a length-1 trend signal list", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx);
    expect(TrendStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("is deterministic for the same briefId", async () => {
    const a = await runner.run(brief, ctx);
    const b = await runner.run(brief, ctx);
    expect(a).toEqual(b);
  });

  it("encodes briefId in the trend signal id", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals[0]!.id).toContain("brief-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- stub-trends
```

Expected: FAIL.

- [ ] **Step 3: Implement the stub**

```ts
import type { PcdBriefInput, PcdIdentityContext, TrendStageOutput } from "@creativeagent/schemas";
import type { TrendsStageRunner } from "./trends-stage-runner.js";

// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    return {
      signals: [
        {
          id: `trend-${brief.briefId}-1`,
          summary: `Stub trend signal for ${brief.productDescription}`,
          audienceFit: brief.targetAudience,
          evidenceRefs: [],
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- stub-trends
```

Expected: PASS.

### 12b — Stub motivators runner

- [ ] **Step 1: Failing test**

Create `stub-motivators-stage-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MotivatorsStageOutputSchema } from "@creativeagent/schemas";
import { StubMotivatorsStageRunner } from "./stub-motivators-stage-runner.js";

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
const trends = { signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }] };

describe("StubMotivatorsStageRunner", () => {
  const runner = new StubMotivatorsStageRunner();

  it("returns a length-1 motivators list", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(MotivatorsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("links each motivator to a parentTrendId from the input trends", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators[0]!.parentTrendId).toBe("trend-brief-123-1");
  });

  it("is deterministic for the same inputs", async () => {
    const a = await runner.run(brief, ctx, trends);
    const b = await runner.run(brief, ctx, trends);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the stub**

Create `stub-motivators-stage-runner.ts`:

```ts
import type {
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { MotivatorsStageRunner } from "./motivators-stage-runner.js";

// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.
export class StubMotivatorsStageRunner implements MotivatorsStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput> {
    const parentTrendId = trends.signals[0]!.id;
    return {
      motivators: [
        {
          id: `motivator-${brief.briefId}-1`,
          frictionOrDesire: `Stub motivator linked to ${parentTrendId}`,
          audienceSegment: brief.targetAudience,
          evidenceRefs: [],
          parentTrendId,
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

### 12c — Stub hooks runner

- [ ] **Step 1: Failing test**

Create `stub-hooks-stage-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HooksStageOutputSchema } from "@creativeagent/schemas";
import { StubHooksStageRunner } from "./stub-hooks-stage-runner.js";

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
const trends = { signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }] };
const motivators = {
  motivators: [
    { id: "motivator-brief-123-1", frictionOrDesire: "f", audienceSegment: "y", evidenceRefs: [], parentTrendId: "trend-brief-123-1" },
  ],
};

describe("StubHooksStageRunner", () => {
  const runner = new StubHooksStageRunner();

  it("returns a length-1 hooks list", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(HooksStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("links each hook to parentMotivatorId AND parentTrendId", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.parentMotivatorId).toBe("motivator-brief-123-1");
    expect(out.hooks[0]!.parentTrendId).toBe("trend-brief-123-1");
  });

  it("uses a default hookType from the four-value enum", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(["direct_camera", "mid_action", "reaction", "text_overlay_start"]).toContain(
      out.hooks[0]!.hookType,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the stub**

```ts
import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { HooksStageRunner } from "./hooks-stage-runner.js";

// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.
export class StubHooksStageRunner implements HooksStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput> {
    const parentTrendId = trends.signals[0]!.id;
    const parentMotivatorId = motivators.motivators[0]!.id;
    return {
      hooks: [
        {
          id: `hook-${brief.briefId}-1`,
          text: `Stub hook for ${brief.productDescription}`,
          hookType: "direct_camera",
          parentMotivatorId,
          parentTrendId,
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

### 12d — Stub creator-scripts runner

- [ ] **Step 1: Failing test**

Create `stub-creator-scripts-stage-runner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreatorScriptsStageOutputSchema } from "@creativeagent/schemas";
import { StubCreatorScriptsStageRunner } from "./stub-creator-scripts-stage-runner.js";

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
const trends = { signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }] };
const motivators = {
  motivators: [
    { id: "motivator-brief-123-1", frictionOrDesire: "f", audienceSegment: "y", evidenceRefs: [], parentTrendId: "trend-brief-123-1" },
  ],
};
const hooks = {
  hooks: [
    {
      id: "hook-brief-123-1",
      text: "h",
      hookType: "direct_camera" as const,
      parentMotivatorId: "motivator-brief-123-1",
      parentTrendId: "trend-brief-123-1",
    },
  ],
};

describe("StubCreatorScriptsStageRunner", () => {
  const runner = new StubCreatorScriptsStageRunner();

  it("returns a length-1 scripts list", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(CreatorScriptsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("uses talking_points style by default (no spokenLines field)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    const script = out.scripts[0]!;
    expect(script.scriptStyle).toBe("talking_points");
    expect("spokenLines" in script).toBe(false);
  });

  it("links script.parentHookId to the input hook id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.parentHookId).toBe("hook-brief-123-1");
  });

  it("propagates identity refs from the context into identityConstraints", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.identityConstraints.creatorIdentityId).toBe("creator-1");
    expect(out.scripts[0]!.identityConstraints.productIdentityId).toBe("product-1");
    expect(out.scripts[0]!.identityConstraints.voiceId).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the stub**

```ts
import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { CreatorScriptsStageRunner } from "./creator-scripts-stage-runner.js";

// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.
export class StubCreatorScriptsStageRunner implements CreatorScriptsStageRunner {
  async run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    _trends: TrendStageOutput,
    _motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput> {
    const hook = hooks.hooks[0]!;
    return {
      scripts: [
        {
          id: `script-${brief.briefId}-1`,
          hookText: hook.text,
          creatorAngle: "first-person operator explaining the friction",
          visualBeats: ["show the problem", "show the product moment", "show the result"],
          productMoment: `${brief.productDescription} solving the friction`,
          cta: "Try it",
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
            `Friction: stub motivator description`,
            `Outcome: ${brief.productDescription}`,
          ],
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit (all four stubs)**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/stages/stub-*.ts \
        packages/creative-pipeline/src/pcd/preproduction/stages/stub-*.test.ts
git commit -m "feat(pcd): SP7 — four deterministic stub stage runners with merge-back markers"
```

---

## Task 13: `ProductionFanoutGate` adapter + `AutoApproveOnlyScriptGate`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts`

The default implementer enforces "exactly one script" via `InvariantViolationError`. SP7's invariant is single-script; SP8 widens.

- [ ] **Step 1: Write the failing test**

Create `production-fanout-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PCD_APPROVAL_LIFECYCLE_VERSION,
  InvariantViolationError,
  PcdProductionFanoutDecisionSchema,
} from "@creativeagent/creative-pipeline";
import {
  AutoApproveOnlyScriptGate,
  type RequestSelectionInput,
} from "./production-fanout-gate.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");

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

const baseCtx = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  consentRecordId: null,
  effectiveTier: 2 as const,
  productTierAtResolution: 2 as const,
  creatorTierAtResolution: 2 as const,
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
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
} as const;

describe("AutoApproveOnlyScriptGate", () => {
  const gate = new AutoApproveOnlyScriptGate();

  it("selects the only script and returns a forensic decision struct", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const decision = await gate.requestSelection(input);

    expect(PcdProductionFanoutDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.briefId).toBe("brief-1");
    expect(decision.creatorIdentityId).toBe("creator-1");
    expect(decision.productIdentityId).toBe("product-1");
    expect(decision.consentRecordId).toBe(null);
    expect(decision.effectiveTier).toBe(2);
    expect(decision.selectedScriptIds).toEqual(["script-1"]);
    expect(decision.availableScriptIds).toEqual(["script-1"]);
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
    expect(decision.decidedAt).toBe("2026-04-29T12:00:00.000Z");
    expect(decision.decidedBy).toBe(null);
    expect(decision.costForecast).toBe(null);
  });

  it("throws InvariantViolationError on zero scripts", async () => {
    const input: RequestSelectionInput = {
      scripts: [],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    await expect(gate.requestSelection(input)).rejects.toThrow(InvariantViolationError);
  });

  it("throws InvariantViolationError on two scripts (SP7 invariant: single-script)", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript, { ...baseScript, id: "script-2" }],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    await expect(gate.requestSelection(input)).rejects.toThrow(InvariantViolationError);
  });

  it("returned selectedScriptIds and availableScriptIds are sorted ascending", async () => {
    // With one script in SP7, sortedness is trivial; the assertion locks
    // the contract for SP8's N-script world.
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const decision = await gate.requestSelection(input);
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    expect(decision.availableScriptIds).toEqual([...decision.availableScriptIds].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- production-fanout-gate
```

Expected: FAIL with `Cannot find module './production-fanout-gate.js'`.

- [ ] **Step 3: Implement the adapter + default**

Create `production-fanout-gate.ts`:

```ts
import {
  PCD_APPROVAL_LIFECYCLE_VERSION,
} from "../approval-lifecycle-version.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type {
  CreatorScript,
  PcdIdentityContext,
  PcdProductionFanoutDecision,
} from "@creativeagent/schemas";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";

export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision>;
}

// MERGE-BACK: replace AutoApproveOnlyScriptGate with Switchboard Inngest waitForEvent + dashboard UI.
export class AutoApproveOnlyScriptGate implements ProductionFanoutGate {
  async requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision> {
    if (input.scripts.length !== 1) {
      throw new InvariantViolationError(
        "AutoApproveOnlyScriptGate requires exactly one script",
        { scriptsLength: input.scripts.length },
      );
    }
    const script = input.scripts[0]!;
    const sortedIds = [script.id].slice().sort();
    return {
      briefId: input.briefId,
      creatorIdentityId: input.identityContext.creatorIdentityId,
      productIdentityId: input.identityContext.productIdentityId,
      consentRecordId: input.identityContext.consentRecordId,
      effectiveTier: input.identityContext.effectiveTier,
      selectedScriptIds: sortedIds,
      availableScriptIds: sortedIds,
      preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
      identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
      decidedAt: input.clock().toISOString(),
      decidedBy: null,
      costForecast: null,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- production-fanout-gate
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts \
        packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.test.ts
git commit -m "feat(pcd): SP7 — ProductionFanoutGate adapter + AutoApproveOnlyScriptGate default"
```

---

## Task 14: `buildPcdIdentityContext`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts`

This task is the largest pure function in SP7. It composes SP6's pre-check + SP7's two registry readers + tier projection + creative substrate read + ugc style constraint population. Failures from SP6 / zod / `InvariantViolationError` propagate raw.

- [ ] **Step 1: Write the failing test**

Create `build-pcd-identity-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ConsentRevokedRefusalError,
  InvariantViolationError,
  PcdIdentityContextSchema,
  type PcdBriefInput,
} from "@creativeagent/creative-pipeline";
import { buildPcdIdentityContext } from "./build-pcd-identity-context.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const validBrief: PcdBriefInput = {
  briefId: "brief-1",
  productDescription: "AI lead reply assistant",
  targetAudience: "solo founders",
  platforms: ["instagram_reels", "tiktok"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

function fakeStores(opts: {
  productQuality?: "url_imported" | "verified" | "canonical";
  creatorQuality?: "stock" | "anchored" | "soul_id";
  productNotFound?: boolean;
  creatorNotFound?: boolean;
  creatorConsentRecordId?: string | null;
  consentRevoked?: boolean;
  consentRecordExists?: boolean;
} = {}) {
  const productQuality = opts.productQuality ?? "verified";
  const creatorQuality = opts.creatorQuality ?? "anchored";
  const consentRecordId = opts.creatorConsentRecordId ?? null;

  return {
    sp7ProductRegistryReader: {
      async findById(id: string) {
        if (opts.productNotFound) return null;
        if (id !== "product-1") return null;
        return {
          id: "product-1",
          qualityTier: productQuality,
          canonicalPackageText: "ACME Pro",
          heroPackshotAssetId: "asset-hero-1",
          brandPositioningText: null,
        };
      },
    },
    sp7CreatorRegistryReader: {
      async findById(id: string) {
        if (opts.creatorNotFound) return null;
        if (id !== "creator-1") return null;
        return {
          id: "creator-1",
          qualityTier: creatorQuality,
          voiceId: "voice-1",
          consentRecordId,
        };
      },
    },
    creatorIdentityReader: {
      async findById(id: string) {
        if (opts.creatorNotFound) return null;
        if (id !== "creator-1") return null;
        return { id: "creator-1", consentRecordId };
      },
    },
    consentRecordReader: {
      async findById(id: string) {
        if (!opts.consentRecordExists && consentRecordId !== null) {
          // simulate dangling reference if test wants it
          if (opts.consentRecordExists === false) return null;
        }
        if (id === consentRecordId) {
          return { id, revoked: opts.consentRevoked ?? false, revokedAt: opts.consentRevoked ? new Date() : null };
        }
        return null;
      },
    },
  };
}

describe("buildPcdIdentityContext", () => {
  it("returns a frozen, schema-valid context for a clean brief at tier 2/2", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(PcdIdentityContextSchema.safeParse(ctx).success).toBe(true);
    expect(ctx.creatorIdentityId).toBe("creator-1");
    expect(ctx.productIdentityId).toBe("product-1");
    expect(ctx.effectiveTier).toBe(2);
    expect(ctx.productTierAtResolution).toBe(2);
    expect(ctx.creatorTierAtResolution).toBe(2);
    expect(ctx.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
  });

  it("propagates ZodError raw on invalid brief (does NOT wrap)", async () => {
    await expect(
      buildPcdIdentityContext({ ...validBrief, briefId: "" } as PcdBriefInput, fakeStores()),
    ).rejects.toThrow(/briefId|String must contain at least 1/i);
  });

  it("throws InvariantViolationError when product registry returns null", async () => {
    await expect(
      buildPcdIdentityContext(validBrief, fakeStores({ productNotFound: true })),
    ).rejects.toThrow(InvariantViolationError);
  });

  it("throws InvariantViolationError when creator registry returns null", async () => {
    await expect(
      buildPcdIdentityContext(validBrief, fakeStores({ creatorNotFound: true })),
    ).rejects.toThrow(InvariantViolationError);
  });

  it("propagates ConsentRevokedRefusalError when SP6 pre-check fails", async () => {
    await expect(
      buildPcdIdentityContext(
        validBrief,
        fakeStores({
          creatorConsentRecordId: "consent-1",
          consentRevoked: true,
          consentRecordExists: true,
        }),
      ),
    ).rejects.toThrow(ConsentRevokedRefusalError);
  });

  it("computes effectiveTier = min(productTier, creatorTier)", async () => {
    const ctx = await buildPcdIdentityContext(
      validBrief,
      fakeStores({ productQuality: "url_imported", creatorQuality: "soul_id" }),
    );
    expect(ctx.productTierAtResolution).toBe(1);
    expect(ctx.creatorTierAtResolution).toBe(3);
    expect(ctx.effectiveTier).toBe(1);
  });

  it("at effectiveTier=3 sets all tier3Rules flags true (with talking_head allowed)", async () => {
    const ctx = await buildPcdIdentityContext(
      validBrief,
      fakeStores({ productQuality: "canonical", creatorQuality: "soul_id" }),
    );
    expect(ctx.effectiveTier).toBe(3);
    expect(ctx.tier3Rules.firstLastFrameRequired).toBe(true);
    expect(ctx.tier3Rules.editOverRegenerateRequired).toBe(true);
    // performanceTransferRequired is conditional on talking_head being in allowedShotTypes,
    // which it is at tier 3.
    expect(ctx.tier3Rules.performanceTransferRequired).toBe(true);
  });

  it("at effectiveTier<3 sets all tier3Rules flags false", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.tier3Rules.firstLastFrameRequired).toBe(false);
    expect(ctx.tier3Rules.performanceTransferRequired).toBe(false);
    expect(ctx.tier3Rules.editOverRegenerateRequired).toBe(false);
  });

  it("populates ugcStyleConstraints with the full five-value enum list", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.ugcStyleConstraints).toEqual([
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ]);
  });

  it("reads creative substrate (voiceId, productCanonicalText, heroPackshotAssetId)", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.voiceId).toBe("voice-1");
    expect(ctx.productCanonicalText).toBe("ACME Pro");
    expect(ctx.productHeroPackshotAssetId).toBe("asset-hero-1");
  });

  it("forwards consentRevoked=false when consent is intact", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.consentRevoked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- build-pcd-identity-context
```

Expected: FAIL with `Cannot find module './build-pcd-identity-context.js'`.

- [ ] **Step 3: Implement `buildPcdIdentityContext`**

Create `build-pcd-identity-context.ts`:

```ts
import {
  IdentityTierSchema,
  type AvatarQualityTier,
  type IdentityTier,
  type PcdBriefInput,
  type PcdIdentityContext,
  type PcdShotType,
  type ProductQualityTier,
  PcdBriefInputSchema,
  PcdShotTypeSchema,
  OutputIntentSchema,
  type OutputIntent,
} from "@creativeagent/schemas";
import {
  assertConsentNotRevokedForGeneration,
  decidePcdGenerationAccess,
  InvariantViolationError,
  type ConsentRecordReader,
  type CreatorIdentityReader,
} from "@creativeagent/creative-pipeline";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import type {
  Sp7CreatorRegistryReader,
  Sp7ProductRegistryReader,
} from "./sp7-readers.js";

export type BuildPcdIdentityContextStores = {
  sp7ProductRegistryReader: Sp7ProductRegistryReader;
  sp7CreatorRegistryReader: Sp7CreatorRegistryReader;
  creatorIdentityReader: CreatorIdentityReader;
  consentRecordReader: ConsentRecordReader;
};

// Pure tier mapping — duplicates SP3's pure logic (SP3 source is not edited).
function mapProductQualityTier(t: ProductQualityTier): IdentityTier {
  switch (t) {
    case "url_imported":
      return 1;
    case "verified":
      return 2;
    case "canonical":
      return 3;
  }
}

function mapCreatorQualityTier(t: AvatarQualityTier): IdentityTier {
  switch (t) {
    case "stock":
      return 1;
    case "anchored":
      return 2;
    case "soul_id":
      return 3;
  }
}

function computeEffectiveTier(p: IdentityTier, c: IdentityTier): IdentityTier {
  return (p <= c ? p : c) as IdentityTier;
}

const ALL_SHOT_TYPES = PcdShotTypeSchema.options as readonly PcdShotType[];
const ALL_OUTPUT_INTENTS = OutputIntentSchema.options as readonly OutputIntent[];

function projectAllowedShotTypes(
  productTier: IdentityTier,
  creatorTier: IdentityTier,
): PcdShotType[] {
  return ALL_SHOT_TYPES.filter((shotType) => {
    const decision = decidePcdGenerationAccess({
      avatarTier: creatorTier,
      productTier,
      shotType,
      outputIntent: "preview",
    });
    return decision.allowed === true;
  });
}

function projectAllowedOutputIntents(
  productTier: IdentityTier,
  creatorTier: IdentityTier,
): OutputIntent[] {
  return ALL_OUTPUT_INTENTS.filter((outputIntent) =>
    ALL_SHOT_TYPES.some(
      (shotType) =>
        decidePcdGenerationAccess({
          avatarTier: creatorTier,
          productTier,
          shotType,
          outputIntent,
        }).allowed === true,
    ),
  );
}

function projectTier3Rules(
  effectiveTier: IdentityTier,
  allowedShotTypes: readonly PcdShotType[],
): PcdIdentityContext["tier3Rules"] {
  const isTier3 = effectiveTier === 3;
  return {
    firstLastFrameRequired: isTier3,
    performanceTransferRequired: isTier3 && allowedShotTypes.includes("talking_head"),
    editOverRegenerateRequired: isTier3,
  };
}

const DEFAULT_UGC_STYLE_CONSTRAINTS = [
  "native_vertical",
  "creator_led",
  "no_overproduced_storyboard",
  "product_fidelity_required",
  "no_invented_product_claims",
] as const;

export async function buildPcdIdentityContext(
  brief: PcdBriefInput,
  stores: BuildPcdIdentityContextStores,
): Promise<PcdIdentityContext> {
  // 1. Validate brief — propagates ZodError raw.
  const validated = PcdBriefInputSchema.parse(brief);

  // 2. Read product registry by ref.
  const product = await stores.sp7ProductRegistryReader.findById(validated.productIdentityRef);
  if (product === null) {
    throw new InvariantViolationError("product identity not found", {
      productIdentityRef: validated.productIdentityRef,
    });
  }

  // 3. Read creator registry by ref.
  const creator = await stores.sp7CreatorRegistryReader.findById(validated.creatorIdentityRef);
  if (creator === null) {
    throw new InvariantViolationError("creator identity not found", {
      creatorIdentityRef: validated.creatorIdentityRef,
    });
  }

  // 4. SP6 consent pre-check — propagates ConsentRevokedRefusalError /
  //    InvariantViolationError raw.
  await assertConsentNotRevokedForGeneration(
    { creatorIdentityId: creator.id },
    {
      creatorIdentityReader: stores.creatorIdentityReader,
      consentRecordReader: stores.consentRecordReader,
    },
  );

  // 5. Project tiers.
  const productTier = mapProductQualityTier(product.qualityTier);
  const creatorTier = mapCreatorQualityTier(creator.qualityTier);
  const effectiveTier = computeEffectiveTier(productTier, creatorTier);

  // Validate via schema as a defense-in-depth check.
  IdentityTierSchema.parse(effectiveTier);

  const allowedShotTypes = projectAllowedShotTypes(productTier, creatorTier);
  const allowedOutputIntents = projectAllowedOutputIntents(productTier, creatorTier);
  const tier3Rules = projectTier3Rules(effectiveTier, allowedShotTypes);

  // 6. Populate UGC style constraints.
  const ugcStyleConstraints = [...DEFAULT_UGC_STYLE_CONSTRAINTS];

  // 7. Build the immutable context.
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

  // 8. MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.
  return Object.freeze(context);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- build-pcd-identity-context
```

Expected: PASS (~11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts \
        packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.test.ts
git commit -m "feat(pcd): SP7 — buildPcdIdentityContext composes SP6 pre-check + tier projection + substrate"
```

---

## Task 15: `runIdentityAwarePreproductionChain` composer

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts`
- Create: `packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts`

The composer's anti-pattern test surface is large: it must literally call `productionFanoutGate.requestSelection(` and (transitively via `buildPcdIdentityContext`) `assertConsentNotRevokedForGeneration(`. Stage-runner errors wrap; pre-stage errors propagate raw.

- [ ] **Step 1: Write the failing test**

Create `preproduction-chain.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  ConsentRevokedRefusalError,
  InvariantViolationError,
  PcdPreproductionChainResultSchema,
  PCD_APPROVAL_LIFECYCLE_VERSION,
  type PcdBriefInput,
} from "@creativeagent/creative-pipeline";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "./preproduction-chain.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { StubTrendsStageRunner } from "./stages/stub-trends-stage-runner.js";
import { StubMotivatorsStageRunner } from "./stages/stub-motivators-stage-runner.js";
import { StubHooksStageRunner } from "./stages/stub-hooks-stage-runner.js";
import { StubCreatorScriptsStageRunner } from "./stages/stub-creator-scripts-stage-runner.js";
import { AutoApproveOnlyScriptGate } from "./production-fanout-gate.js";

const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");

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
    productionFanoutGate: new AutoApproveOnlyScriptGate(),
    clock: fixedClock,
  };
}

describe("runIdentityAwarePreproductionChain — happy path", () => {
  it("returns a schema-valid PcdPreproductionChainResult", async () => {
    const result = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(PcdPreproductionChainResultSchema.safeParse(result).success).toBe(true);
  });

  it("decision pins all three versions from imports", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("decidedAt matches injected clock output exactly", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedAt).toBe("2026-04-29T12:00:00.000Z");
  });

  it("decidedBy is null with the default AutoApproveOnlyScriptGate", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedBy).toBe(null);
  });

  it("costForecast is null in SP7", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.costForecast).toBe(null);
  });

  it("selectedScriptIds and availableScriptIds are sorted", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    expect(decision.availableScriptIds).toEqual([...decision.availableScriptIds].sort());
  });

  it("calls stages in fixed order: trends, motivators, hooks, creator_scripts", async () => {
    const order: string[] = [];
    const stores = happyStores();
    const wrap = <T extends { run: (...a: never[]) => Promise<unknown> }>(name: string, runner: T) =>
      ({
        run: async (...args: never[]) => {
          order.push(name);
          return runner.run(...args);
        },
      }) as T;
    stores.trendsRunner = wrap("trends", stores.trendsRunner);
    stores.motivatorsRunner = wrap("motivators", stores.motivatorsRunner);
    stores.hooksRunner = wrap("hooks", stores.hooksRunner);
    stores.creatorScriptsRunner = wrap("creator_scripts", stores.creatorScriptsRunner);

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
    stores.sp7ProductRegistryReader = { async findById() { return null; } };
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction-chain.test
```

Expected: FAIL with `Cannot find module './preproduction-chain.js'`.

- [ ] **Step 3: Implement the composer**

Create `preproduction-chain.ts`:

```ts
import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdPreproductionChainResult,
  PreproductionChainStage,
  TrendStageOutput,
} from "@creativeagent/schemas";
import {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload.
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
  const decision = await runStageWrapped("production_fanout_gate", () =>
    stores.productionFanoutGate.requestSelection({
      scripts: scripts.scripts,
      identityContext,
      briefId: brief.briefId,
      clock,
    }),
  );
  // MERGE-BACK: emit WorkTrace here at production fanout gate decision.

  // MERGE-BACK: wire UGC production handoff here.
  return {
    decision,
    stageOutputs: { trends, motivators, hooks, scripts },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- preproduction-chain.test
```

Expected: PASS (~17 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts \
        packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.test.ts
git commit -m "feat(pcd): SP7 — runIdentityAwarePreproductionChain composer with stage-wrapping + clock injection"
```

---

## Task 16: SP7 anti-pattern grep + forbidden-imports tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts`

Mirrors SP6's `sp6-anti-patterns.test.ts` style.

- [ ] **Step 1: Create the cross-cutting test**

Create `packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SP7_DIR = join(__dirname);

function listSp7SourceFiles(): string[] {
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
  walk(SP7_DIR);
  return out;
}

function readCodeOnly(file: string): string {
  // Strip line comments and block comments before regex matching so doc-comments
  // describing the anti-pattern don't trip the grep.
  const src = readFileSync(file, "utf8");
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const allSources = listSp7SourceFiles();

describe("SP7 anti-pattern grep", () => {
  it("no `if (stage ===` outside preproduction-chain-error.ts", () => {
    for (const file of allSources) {
      if (file.endsWith("preproduction-chain-error.ts")) continue;
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'if (stage ==='`).not.toMatch(/if\s*\(\s*stage\s*===/);
    }
  });

  it("no `if (intent ===`, `if (effectiveTier ===`, `if (shotType ===` in any SP7 source", () => {
    for (const file of allSources) {
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'if (intent ==='`).not.toMatch(/if\s*\(\s*intent\s*===/);
      expect(code, `${file} contains 'if (effectiveTier ==='`).not.toMatch(
        /if\s*\(\s*effectiveTier\s*===/,
      );
      expect(code, `${file} contains 'if (shotType ==='`).not.toMatch(
        /if\s*\(\s*shotType\s*===/,
      );
    }
  });

  it("preproduction-chain.ts literally calls productionFanoutGate.requestSelection(", () => {
    const path = join(SP7_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("productionFanoutGate.requestSelection(");
  });

  it("build-pcd-identity-context.ts literally calls assertConsentNotRevokedForGeneration(", () => {
    const path = join(SP7_DIR, "build-pcd-identity-context.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("assertConsentNotRevokedForGeneration(");
  });

  it("no `prisma.`, `assetRecord.update`, or `WorkTrace` token in any SP7 source", () => {
    for (const file of allSources) {
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'prisma.'`).not.toMatch(/\bprisma\./);
      expect(code, `${file} contains 'assetRecord.update'`).not.toMatch(/assetRecord\.update/);
      expect(code, `${file} contains 'WorkTrace'`).not.toMatch(/\bWorkTrace\b/);
    }
  });

  it("no Switchboard parent-system imports in any SP7 source", () => {
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports ApprovalLifecycle`).not.toMatch(
        /import.*\bApprovalLifecycle\b/,
      );
      expect(src, `${file} imports ExportLifecycle`).not.toMatch(
        /import.*\bExportLifecycle\b/,
      );
      expect(src, `${file} imports core/approval`).not.toMatch(/import.*core\/approval/);
    }
  });
});

describe("SP7 forbidden imports", () => {
  it("no SP7 source imports @creativeagent/db, @prisma/client, inngest, node fs/http/https, or crypto", () => {
    const forbidden = [
      "@creativeagent/db",
      "@prisma/client",
      "inngest",
      "node:fs",
      "node:http",
      "node:https",
      "crypto",
    ];
    for (const file of allSources) {
      // The anti-pattern test itself imports node:fs to walk the tree; skip it.
      if (file.endsWith("sp7-anti-patterns.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const tok of forbidden) {
        const re = new RegExp(`from\\s+['"]${tok}['"]`);
        expect(src, `${file} imports ${tok}`).not.toMatch(re);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test -- sp7-anti-patterns
```

Expected: PASS. If any source file fails an assertion, fix the source — the test is the contract, not the test's expectation.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/sp7-anti-patterns.test.ts
git commit -m "test(pcd): SP7 — anti-pattern grep + forbidden-imports cross-cutting test"
```

---

## Task 17: Subdir barrel + creative-pipeline package re-exports

**Files:**
- Create: `packages/creative-pipeline/src/pcd/preproduction/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 1: Create the subdir barrel**

Create `packages/creative-pipeline/src/pcd/preproduction/index.ts`:

```ts
export { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
export { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
export { PreproductionChainError } from "./preproduction-chain-error.js";
export type {
  Sp7ProductRegistryReader,
  Sp7CreatorRegistryReader,
} from "./sp7-readers.js";

export {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";

export {
  AutoApproveOnlyScriptGate,
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

- [ ] **Step 2: Append to creative-pipeline package index**

Append at the end of `packages/creative-pipeline/src/index.ts`:

```ts
// SP7: identity-aware pre-production chain + single production gate
export * from "./pcd/preproduction/index.js";
```

- [ ] **Step 3: Verify build**

```bash
pnpm --filter @creativeagent/creative-pipeline build
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP7 — barrel re-exports for preproduction subdir"
```

---

## Task 18: Update `docs/SWITCHBOARD-CONTEXT.md` with SP7 merge-back notes

**Files:**
- Modify: `docs/SWITCHBOARD-CONTEXT.md`

- [ ] **Step 1: Append SP7 section**

Append after the existing SP6 section in `docs/SWITCHBOARD-CONTEXT.md`:

```markdown
### SP7 (preproduction chain) — SHIPPED in creativeagent

**SP7-declared merge-back surfaces (production wiring at merge-back):**

- Four stub stage runners → real Switchboard Claude-driven runners. New file `creator-scripts-stage-runner.ts` at merge-back supersedes both Switchboard's existing `script-writer.ts` and the UGC pipeline's `ugc-script-writer.ts`. New file `motivators-stage-runner.ts` at merge-back is net-new (no current Switchboard equivalent at top level — funnel-friction-translator's role moves up).
- `AutoApproveOnlyScriptGate` → Switchboard Inngest `step.waitForEvent` adapter wrapping a new event pair: `creative-pipeline/preproduction.gate.requested` (emitted by the SP7 composer at the gate boundary) and `creative-pipeline/preproduction.gate.approved` (emitted by the dashboard UI). Operator selection payload populates `decidedBy` and `selectedScriptIds`.
- `WorkTrace` emit — every SP7 stage boundary carries a `// MERGE-BACK: emit WorkTrace here` marker. Five markers in `preproduction-chain.ts` (after each of four stages + at gate decision) plus one in `build-pcd-identity-context.ts` after the context is built, plus the `// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload` directive. Plus `// MERGE-BACK: wire UGC production handoff here` on the composer's return.
- Two new SP7 reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) — wider than SP6's narrow consent-only readers. Production wiring at merge-back is a Prisma adapter from `packages/db/`; SP7 ships interfaces only. Both readers consume existing SP1 ProductIdentity / CreatorIdentity columns; no schema changes required.

**Schema reconciliation at merge-back:**

- No Prisma migration. SP7 is pure orchestration. All schema additions are zod-only in `packages/schemas/src/pcd-preproduction.ts`.
- `ProductIdentity.brandPositioningText` — SP7 reads this field if it exists on the merge-back-time ProductIdentity schema; otherwise `null`. SP7 does not widen `ProductIdentity`. If Switchboard's main has not added the column by merge-back, the reader returns `null` for the field and the schema accepts the null.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP7 composer + builder + gate + four stage runners are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/preproduction/` changes at merge-back — only the injected stub runners + default gate swap (real Claude runners + Inngest waitForEvent adapter) and the markers get implementations.
- `PreproductionChainError` lives in this repo; merge-back keeps the class verbatim.
- `PCD_PREPRODUCTION_CHAIN_VERSION` and `PCD_IDENTITY_CONTEXT_VERSION` are SP7's two new pinned constants. The PCD slice carries ten total pinned constants after SP7.
- SP7 introduces NO circular dependency. Pre-production stages (Switchboard's `stages/`, `ugc/`) import from `pcd/preproduction/` at merge-back; the reverse direction does not exist. SP7 lives inside pcd/ rather than as a sibling synergy/ subdir per the design's Q11 lock.

**SP7 does not call SP3's `resolvePcdRegistryContext`.** The design doc describes SP7 as "wrapping" SP3, which is structural composition language — in implementation, SP7's `buildPcdIdentityContext` reads product/creator registry directly via two new SP7-specific reader interfaces (`Sp7ProductRegistryReader`, `Sp7CreatorRegistryReader`) and duplicates SP3's pure `qualityTier → IdentityTier` mapping locally. SP3's source is not edited. SP3's resolver expects a `PcdResolvableJob` with `organizationId`/`deploymentId`/`productDescription`/`productImages` and persists via `jobStore.attachIdentityRefs`; SP7's pre-job `PcdBriefInput` doesn't fit that signature, and SP7 must not persist.
```

- [ ] **Step 2: Commit**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "docs(pcd): SP7 — merge-back surface notes in SWITCHBOARD-CONTEXT"
```

---

## Task 19: Final verification — full build/test/typecheck/prettier across all packages

**Files:**
- None (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
cd ~/creativeagent
pnpm install
pnpm db:generate
pnpm build
pnpm test
pnpm typecheck
pnpm exec prettier --check '**/*.ts' '!**/dist/**' '!**/node_modules/**'
```

Expected:

- `pnpm build`: clean across 5 packages.
- `pnpm test`: SP6 baseline (~1,200+ tests) + SP7's new tests (~60+ across schemas + creative-pipeline). Total ~1,260+ tests, all green.
- `pnpm typecheck`: clean across 5 packages.
- `pnpm exec prettier --check`: clean modulo the two pre-existing tier-policy.ts warnings noted in SP5 baseline.

If any check fails, fix in-place and re-run. Do NOT proceed until all four pass.

- [ ] **Step 2: Confirm zero edits to SP1–SP6 source bodies**

```bash
git diff --stat origin/main..HEAD -- \
  packages/creative-pipeline/src/pcd/registry-resolver.ts \
  packages/creative-pipeline/src/pcd/registry-backfill.ts \
  packages/creative-pipeline/src/pcd/tier-policy.ts \
  packages/creative-pipeline/src/pcd/provider-router.ts \
  packages/creative-pipeline/src/pcd/provider-capability-matrix.ts \
  packages/creative-pipeline/src/pcd/tier3-routing-rules.ts \
  packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts \
  packages/creative-pipeline/src/pcd/qc-evaluator.ts \
  packages/creative-pipeline/src/pcd/qc-gate-matrix.ts \
  packages/creative-pipeline/src/pcd/qc-aggregator.ts \
  packages/creative-pipeline/src/pcd/qc-face-similarity.ts \
  packages/creative-pipeline/src/pcd/qc-logo-similarity.ts \
  packages/creative-pipeline/src/pcd/qc-ocr-match.ts \
  packages/creative-pipeline/src/pcd/qc-geometry.ts \
  packages/creative-pipeline/src/pcd/approval-advancement.ts \
  packages/creative-pipeline/src/pcd/final-export-gate.ts \
  packages/creative-pipeline/src/pcd/meta-draft-gate.ts \
  packages/creative-pipeline/src/pcd/consent-revocation.ts \
  packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts \
  packages/creative-pipeline/src/pcd/consent-pre-check-edit.ts
```

Expected: empty output. SP7 does not edit any SP1–SP6 source body. (Only `packages/creative-pipeline/src/index.ts` is modified, and that's a barrel-export-only change.)

- [ ] **Step 3: Confirm no Prisma changes**

```bash
git diff --stat origin/main..HEAD -- packages/db/
```

Expected: empty output. SP7 does not touch `packages/db/`.

- [ ] **Step 4: No commit — verification-only task. Proceed to Task 20.**

---

## Task 20: Open PR

**Files:**
- None (PR creation).

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/pcd-sp7-preproduction-chain
```

- [ ] **Step 2: Open PR with summary + test plan**

```bash
gh pr create --title "feat(pcd): SP7 — identity-aware pre-production chain + single production gate" --body "$(cat <<'EOF'
## Summary

- Ships SP7 of the PCD vertical — first synergy slice. Pure store-injected composer takes a `PcdBriefInput`, builds an immutable `PcdIdentityContext` at brief-input (consent pre-check + tier projection + creative substrate + UGC style constraints), runs four stage runners (`trends → motivators → hooks → creator scripts`) with no per-stage human gates, and ends at one `ProductionFanoutGate.requestSelection` call returning a forensic `PcdProductionFanoutDecision`.
- Storyboard is dropped — UGC ads do not need it; the creator script (production recipe) is the approval object.
- Two new pinned version constants (`PCD_PREPRODUCTION_CHAIN_VERSION`, `PCD_IDENTITY_CONTEXT_VERSION`); existing `PCD_APPROVAL_LIFECYCLE_VERSION` reused on the gate decision.
- Stub stage runners + `AutoApproveOnlyScriptGate` ship in-tree with 13 `// MERGE-BACK:` markers. Real Claude-driven runners + Inngest-waitForEvent gate are deferred to merge-back per `docs/SWITCHBOARD-CONTEXT.md` SP7 section.
- No Prisma migration. Zero edits to SP1–SP6 source bodies. ~60+ new tests; SP6 baseline ~1,200 tests still green.

## Test plan

- [ ] `pnpm build` clean across 5 packages
- [ ] `pnpm test` — all schemas + creative-pipeline tests green (~1,260+ total)
- [ ] `pnpm typecheck` clean across 5 packages
- [ ] `pnpm exec prettier --check '**/*.ts'` clean (modulo two pre-existing tier-policy.ts SP5-baseline warnings)
- [ ] `sp7-anti-patterns.test.ts` enforces: no `if (stage ===` outside error class; no `if (intent|effectiveTier|shotType ===`; composer literally calls `productionFanoutGate.requestSelection(`; builder transitively calls `assertConsentNotRevokedForGeneration(`; no `prisma.`/`assetRecord.update`/`WorkTrace` token in SP7 source; no `ApprovalLifecycle`/`ExportLifecycle`/`core/approval` import.
- [ ] Forbidden imports test enforces: no `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs|http|https`, `crypto` in any SP7 source.
- [ ] Determinism: every test asserting `decidedAt` injects a fixed clock; `PcdIdentityContext` is `Object.freeze`d before stage runners see it.
- [ ] Failure semantics: `ZodError` / `ConsentRevokedRefusalError` / `InvariantViolationError` propagate raw; stage-runner / gate-runtime errors wrap in `PreproductionChainError({ stage, cause })` with non-enumerable `cause` for PII safety.

## Design + plan

- Design: `docs/plans/2026-04-29-pcd-preproduction-chain-sp7-design.md`
- Plan: `docs/plans/2026-04-29-pcd-preproduction-chain-sp7-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

The `gh pr create` command prints the PR URL. Capture it for the implementation handoff.

---

## Out-of-band: SP7 acceptance summary

After PR merges, update memory file `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` to mark SP7 as shipped (commit hash + PR number + test count). Mirror the SP1–SP6 entries' style.
