# PCD SP22 — Generation Composer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the second impure orchestrator in the PCD vertical — an async per-shot generation-routing composer that ties SP4/SP16 routing to `writePcdIdentitySnapshotWithCostForecast` (SP10A) / `writePcdIdentitySnapshotWithSyntheticRouting` (SP18) persistence, returning the routing decision plus the written snapshot.

**Architecture:** Free-standing async function `composeGenerationRouting(input, stores)` in `packages/creative-pipeline/src/pcd/generation/`. SP22 branches only on `syntheticSelection` presence (synthetic → SP16 which owns synthetic eligibility; non-synthetic → SP4). Decision-shape → writer mapping: SP4 allowed OR SP16 delegated_to_generic_router with allowed sp4Decision → `writePcdIdentitySnapshotWithCostForecast`; SP16 synthetic_pairing allowed → `writePcdIdentitySnapshotWithSyntheticRouting`; any denial → no write. The composer synthesizes SP4-shaped `selectedCapability` (all flags `true`, not persisted) + honestly-recomputed `tier3RulesApplied` (persisted) for the synthetic write path to satisfy SP18's inherited Tier 3 invariant without source edits to SP18 / SP4 / `tier3-routing-rules.ts`. The composer file imports **only** `@creativeagent/schemas` and same-package modules — never `@creativeagent/db`. Concrete Prisma stores live in `@creativeagent/db` and are wired in by the runner/app layer at merge-back.

**Tech Stack:** TypeScript (ESM, `.js` extensions in relative imports), Zod 3.x, Prisma 5 with Postgres, Vitest. Conventional Commits; co-located tests; 400-line soft file-size limit per `CLAUDE.md`.

**Branch:** `pcd/sp22-generation-composer` in worktree `.worktrees/sp22`. (If `.worktrees/sp22` does not yet exist, create the worktree via the `superpowers:using-git-worktrees` skill before executing Task 1.)

**Anti-pattern freeze SHA:** `ece1347` (SP21 squash on `main`, 2026-05-16).

**Spec:** `docs/plans/2026-05-16-pcd-sp22-generation-composer-design.md` (commit `9e693bc`).

**Locked plan requirements (user, 2026-05-16):**
1. Composer MUST NOT import `@creativeagent/db`. Stores types only.
2. Generic write path MUST be `writePcdIdentitySnapshotWithCostForecast` (SP10A). Never bare SP4 or SP9.
3. Synthetic-pairing write path MUST be `writePcdIdentitySnapshotWithSyntheticRouting` (SP18). Never SP10A.
4. SP16 `delegated_to_generic_router` with allowed `sp4Decision` MUST go to `writePcdIdentitySnapshotWithCostForecast`, NOT to `writePcdIdentitySnapshotWithSyntheticRouting`.
5. `now` MUST be derived from `input.now`. The anti-pattern test bans zero-arg `new Date()` inside the composer body.
6. No new pinned constant. PCD constant census stays at **24**.
7. No edits to SP1–SP21 source bodies; SP22 is strictly additive.
8. No Prisma migration; no schema change.
9. Synthetic-pairing `selectedProvider` MUST be the composite `${imageProvider}+${videoProvider}` — two legal values: `"dalle+kling"`, `"dalle+seedance"`.
10. Synthesized `selectedCapability` for synthetic writes MUST have all three support flags (`supportsFirstLastFrame`, `supportsEditExtend`, `supportsPerformanceTransfer`) set to `true` (consumed by invariant, not persisted).
11. Synthetic-pairing `tier3RulesApplied` MUST be the honestly-recomputed required set using the three predicates from `tier3-routing-rules.ts`.
12. Step 1 consistency assert (synthetic `creatorIdentityId === resolvedContext.creatorIdentityId`) MUST throw `InvariantViolationError` before any router/writer fires.
13. Task 1 schema-verification gate precedes any composer code — per SP20 + SP21 lesson.
14. Task 13 anti-pattern assertions MUST be cross-checked against design §7 line-by-line before declaring green — per `feedback_design_plan_antipattern_reconciliation.md`.

---

## Pre-flight (one-time, before Task 1)

The worktree should already exist at `.worktrees/sp22` on branch `pcd/sp22-generation-composer` (created via `superpowers:using-git-worktrees`). All subsequent task commands run from inside that worktree.

```bash
cd .worktrees/sp22
git status                                # clean, on pcd/sp22-generation-composer
git log --oneline -1                      # 9e693bc docs(pcd): SP22 generation-composer design

pnpm install
pnpm db:generate
pnpm typecheck && pnpm test && pnpm exec prettier --check .
```

Expected: clean. If anything fails on a clean checkout, stop and investigate — that is not an SP22 concern but must be resolved before adding new code.

---

## Task 1: Verify §11.3 resolution (no code; investigation + commit a finding note)

**Files:**
- Read: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts`
- Read: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts`
- Read: `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts`
- Create: `docs/plans/2026-05-16-pcd-sp22-task1-verification.md`

The design's §11.3 resolution assumes three specific SP18-writer + Tier-3-invariant properties. Task 1 confirms each before any composer code is written. **If any property differs from §11.3, halt and redesign.** Per the SP20 + SP21 lesson.

- [ ] **Step 1: Confirm `selectedCapability` is NOT in the SP18 writer payload allowlist**

Open `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts` lines 89-151 (the `PcdSp4IdentitySnapshotInputSchema.parse(...)` block + the `payload` object construction). Record:

- The list of keys inside `PcdSp4IdentitySnapshotInputSchema.parse({...})` (the "first allowlist" — fields accepted from input).
- The list of keys inside the constructed `payload` object (the "second allowlist" — fields actually persisted).

Confirm: **`selectedCapability` does NOT appear in either allowlist.** It is consumed only by the `assertTier3RoutingDecisionCompliant({ ..., selectedCapability: input.snapshot.selectedCapability, ... })` call at line 77-84.

- [ ] **Step 2: Confirm `tier3RulesApplied` IS persisted (via `routingDecisionReason`)**

In the same file, locate the `payload` object's `routingDecisionReason: parsed.routingDecisionReason` line. `parsed.routingDecisionReason` carries the `tier3RulesApplied` field (per the `PcdSp4IdentitySnapshotInputSchema` shape — `routingDecisionReason` is a structured `PcdRoutingDecisionReason` whose schema includes `tier3RulesApplied`).

Confirm: **the `tier3RulesApplied` value SP22 supplies inside `routingDecisionReason` will be persisted.**

- [ ] **Step 3: Confirm the Tier 3 invariant uses exactly the three predicates SP22 plans to recompute**

Open `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts` lines 98-156 (`assertTier3RoutingDecisionCompliant`). Confirm:

- Line 106: short-circuits on `input.effectiveTier !== 3`.
- Lines 112-117: calls `requiresFirstLastFrameAnchor({ effectiveTier, shotType, outputIntent })`.
- Lines 121-126: calls `requiresPerformanceTransfer({ effectiveTier, shotType })`.
- Lines 129-131: pushes `"edit_over_regenerate"` iff `input.editOverRegenerateRequired === true`.
- Lines 135-145: capability flag check (`supportsFirstLastFrame`, `supportsPerformanceTransfer`, `supportsEditExtend`).
- Lines 151-155: forensic-consistency check (recomputed required as set === supplied `tier3RulesApplied` as set).

Confirm: SP22 importing `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`, `requiresEditOverRegenerate` and applying them with identical arguments produces an identical required set.

- [ ] **Step 4: Write the findings note**

Create `docs/plans/2026-05-16-pcd-sp22-task1-verification.md` with four sections:

1. Quoted excerpt of the SP18 writer payload construction (lines 89-151) with `selectedCapability` absence highlighted.
2. Quoted excerpt of `assertTier3RoutingDecisionCompliant` (lines 98-156).
3. Confirmation table for the three properties:
   | Property | Expected (§11.3) | Observed | Match? |
   |---|---|---|---|
   | `selectedCapability` persisted? | NO | NO | ✅ |
   | `tier3RulesApplied` persisted via `routingDecisionReason`? | YES | YES | ✅ |
   | Invariant predicates match SP22's recompute? | `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`, `editOverRegenerateRequired` flag | same | ✅ |
4. Sign-off sentence: "§11.3 resolution verified against current SP18 + tier3-routing-rules surface; no deviations. Task 3 may proceed."

If any row is ❌, write the deviation up + halt. Otherwise proceed.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/2026-05-16-pcd-sp22-task1-verification.md
git commit -m "docs(pcd): SP22 task 1 — verify §11.3 resolution against current SP18 + tier3 surface"
```

---

## Task 2: SP22 anti-pattern test baseline (empty test, suite turns red)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts`

Per the SP21 pattern: land the anti-pattern test file early so any forbidden change made later in the slice fails the suite immediately. The full assertions are filled in at Task 13; this step lands only the skeleton with an `expect(true).toBe(false)` placeholder so the suite turns red until the slice is complete.

- [ ] **Step 1: Create the empty anti-pattern test file**

Create `packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts`:

```ts
// SP22 anti-pattern test. Assertions per design §7 + plan Task 13.
// Keyed to SP21 squash SHA ece1347 as the freeze baseline.

import { describe, it, expect } from "vitest";

describe("SP22 anti-patterns", () => {
  it("placeholder — filled in at Task 13", () => {
    // Intentionally red until Task 13 lands the real assertions.
    expect(true).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts
```

Expected: 1 failed (the placeholder).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts
git commit -m "test(pcd): SP22 anti-pattern test baseline (red until Task 13)"
```

---

## Task 3: Type definitions + barrel export (compile-only)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`
- Create: `packages/creative-pipeline/src/pcd/generation/index.ts`

Define the input, stores, result, and helper types. No composer body yet — types only. This lets every subsequent test reference the types without forward declarations.

- [ ] **Step 1: Create the types-only composer file**

Create `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`:

```ts
// SP22 — Generation-routing composer. Second impure orchestrator in the
// PCD vertical (SP21 was the first).
//
// Routes per shot: synthetic-selection present → SP16; otherwise → SP4.
// Maps the routing decision to the matching writer:
//   SP4 allowed                                      → writePcdIdentitySnapshotWithCostForecast
//   SP16 delegated_to_generic_router + sp4 allowed   → writePcdIdentitySnapshotWithCostForecast
//   SP16 synthetic_pairing allowed                   → writePcdIdentitySnapshotWithSyntheticRouting
//   any denial                                       → no write
//
// LAYERING GUARDRAIL — this file MUST NOT import from @creativeagent/db.
// Concrete Prisma stores live in @creativeagent/db and are wired in by the
// runner/app layer (// MERGE-BACK).
//
// CLOCK DISCIPLINE — composer MUST NOT call zero-arg new Date(). All "now"
// flows through input.now + stores.clock. SP22 anti-pattern #3 enforces.
//
// INVARIANT — delegation-to-SP4 is NEVER a synthetic-provenance write. SP22
// anti-pattern + unit-test enforces.
//
// COST-FORECAST ASYMMETRY — generic-path writes persist costForecastReason;
// synthetic-pairing writes do not (no SP18+SP10A combined writer exists).
// SP22.1 reserved.
//
// MERGE-BACK markers:
//   1. Inngest step wrapping at the call site (Switchboard runner owns).
//   2. WorkTrace emission at composer entry / writer-call / composer exit.
//   3. Operator-facing per-shot routing-decision dashboards.
//   4. Real provider invocation downstream of SP22 (runner owns).
//   5. Runner-side per-brief caching of the loaded synthetic identity payload.
//   6. SP22.1 — SP18+SP10A combined writer closes the cost-forecast asymmetry.
//   7. SP10C cost-budget remains chain-level upstream of SP22 (directional only).
//   8. Step 1 consistency assert may migrate to runner-side at merge-back.

import type {
  CreatorIdentitySyntheticPayload,
  IdentityTier,
  OutputIntent,
  PcdIdentitySnapshot,
  PcdRoutingDecision,
  PcdRoutingDecisionReason,
  PcdShotType,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import type { ApprovedCampaignContext, ProviderRouterStores } from "../provider-router.js";
import type { PcdProviderCapability } from "../provider-capability-matrix.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import type { StampPcdProvenanceInput } from "../provenance/stamp-pcd-provenance.js";
import type { WritePcdIdentitySnapshotWithCostForecastStores } from "../cost/write-pcd-identity-snapshot-with-cost-forecast.js";
import type { WritePcdIdentitySnapshotWithSyntheticRoutingStores } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";

export type SyntheticSelectionContext = {
  // MUST equal input.routing.resolvedContext.creatorIdentityId. Step 1 of the
  // composer body asserts this; mismatch throws InvariantViolationError.
  creatorIdentityId: string;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  videoProviderChoice: "kling" | "seedance";
};

export type ComposeGenerationRoutingInput = {
  routing: {
    resolvedContext: ResolvedPcdContext;
    shotType: PcdShotType;
    outputIntent: OutputIntent;
    approvedCampaignContext: ApprovedCampaignContext;
    syntheticSelection?: SyntheticSelectionContext;
  };
  snapshotPersistence: {
    assetRecordId: string;
    productIdentityId: string;
    productTierAtGeneration: IdentityTier;
    productImageAssetIds: string[];
    productCanonicalTextHash: string;
    productLogoAssetId: string | null;
    creatorIdentityId: string;
    avatarTierAtGeneration: IdentityTier;
    avatarReferenceAssetIds: string[];
    voiceAssetId: string | null;
    consentRecordId: string | null;
    providerModelSnapshot: string;
    seedOrNoSeed: string;
    rewrittenPromptText: string | null;
    shotSpecVersion: string | null;
  };
  provenance: StampPcdProvenanceInput;
  costHints?: { durationSec?: number; tokenCount?: number };
  now: Date;
};

export type ComposeGenerationRoutingStores = ProviderRouterStores &
  WritePcdIdentitySnapshotWithCostForecastStores &
  WritePcdIdentitySnapshotWithSyntheticRoutingStores;

export type ComposeGenerationRoutingResult =
  | {
      outcome: "routed_and_written";
      writerKind:
        | "writePcdIdentitySnapshotWithCostForecast"
        | "writePcdIdentitySnapshotWithSyntheticRouting";
      decision:
        | (PcdRoutingDecision & { allowed: true })
        | (SyntheticPcdRoutingDecision & { allowed: true; kind: "synthetic_pairing" })
        | (SyntheticPcdRoutingDecision & {
            kind: "delegated_to_generic_router";
            sp4Decision: PcdRoutingDecision & { allowed: true };
          });
      snapshot: PcdIdentitySnapshot;
    }
  | {
      outcome: "denied";
      // Verbatim — any denial branch of either router union, including a
      // delegation envelope wrapping a denied sp4Decision.
      decision: PcdRoutingDecision | SyntheticPcdRoutingDecision;
    };

// Types-only signature — implementation lands in Tasks 4-9.
// Re-exports below ensure type-only usage compiles cleanly before any body
// exists.
export type ComposeGenerationRouting = (
  input: ComposeGenerationRoutingInput,
  stores: ComposeGenerationRoutingStores,
) => Promise<ComposeGenerationRoutingResult>;

// Avoid "declared but never used" lint by re-exporting the helper-shape types
// downstream consumers may want; PcdProviderCapability + PcdRoutingDecisionReason
// are used in the Step 5b synthesis (added at Task 8).
export type { PcdProviderCapability, PcdRoutingDecisionReason };
```

- [ ] **Step 2: Create the barrel export**

Create `packages/creative-pipeline/src/pcd/generation/index.ts`:

```ts
export type {
  ComposeGenerationRouting,
  ComposeGenerationRoutingInput,
  ComposeGenerationRoutingResult,
  ComposeGenerationRoutingStores,
  SyntheticSelectionContext,
} from "./compose-generation-routing.js";
```

- [ ] **Step 3: Run typecheck and confirm compile**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/index.ts
git commit -m "feat(pcd): SP22 type definitions for composeGenerationRouting"
```

---

## Task 4: Step 1 consistency assert (test + impl)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

Add the function body's skeleton and the first behavioral check — Step 1 throws when `syntheticSelection.creatorIdentityId !== resolvedContext.creatorIdentityId`.

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  CreatorIdentitySyntheticPayload,
  PcdPreproductionChainResult,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { composeGenerationRouting } from "./compose-generation-routing.js";

const FIXED_NOW = new Date("2026-05-16T12:00:00.000Z");

function buildResolvedContext(
  overrides: Partial<ResolvedPcdContext> = {},
): ResolvedPcdContext {
  return {
    creatorIdentityId: "creator_resolved_1",
    productIdentityId: "product_resolved_1",
    creatorTierAtResolution: 2,
    productTierAtResolution: 2,
    effectiveTier: 2,
    ...overrides,
  };
}

function buildSyntheticIdentity(
  overrides: Partial<CreatorIdentitySyntheticPayload> = {},
): CreatorIdentitySyntheticPayload {
  return {
    creatorIdentityId: "creator_resolved_1",
    status: "active",
    market: "SG",
    treatmentClass: "med_spa",
    vibe: "warm",
    ethnicityFamily: "east_asian",
    ageBand: "25_34",
    pricePositioning: "mid",
    dallePromptLocked: "studio shot, soft light, neutral background",
    klingDirection: {
      setting: "studio-bright",
      motion: "subtle-dolly",
      energy: "calm",
      lighting: "soft",
      avoid: ["shaky-cam"],
    },
    seedanceDirection: null,
    ...overrides,
  };
}

function buildSnapshotPersistence(): {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: 1 | 2 | 3;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: 1 | 2 | 3;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  shotSpecVersion: string | null;
} {
  return {
    assetRecordId: "asset_1",
    productIdentityId: "product_resolved_1",
    productTierAtGeneration: 2,
    productImageAssetIds: [],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "creator_resolved_1",
    avatarTierAtGeneration: 2,
    avatarReferenceAssetIds: [],
    voiceAssetId: null,
    consentRecordId: "consent_1",
    providerModelSnapshot: "model-1.0",
    seedOrNoSeed: "seed:42",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
  };
}

function buildProvenance(): {
  briefId: string;
  creatorIdentityId: string;
  scriptId: string;
  chainResult: PcdPreproductionChainResult;
  fanoutDecisionId: string;
} {
  // Minimal chainResult shape so SP9 lineage walk succeeds.
  return {
    briefId: "brief_1",
    creatorIdentityId: "creator_resolved_1",
    scriptId: "script_1",
    chainResult: {
      stageOutputs: {
        trends: { signals: [{ id: "trend_1", parentSignalIds: [] }] },
        motivators: { motivators: [{ id: "motivator_1", parentTrendId: "trend_1" }] },
        hooks: { hooks: [{ id: "hook_1", parentMotivatorId: "motivator_1" }] },
        scripts: { scripts: [{ id: "script_1", parentHookId: "hook_1" }] },
      },
      // Other PcdPreproductionChainResult fields are unused by the lineage
      // walk; satisfy the schema with empty/default values if required.
    } as unknown as PcdPreproductionChainResult,
    fanoutDecisionId: "fanout_1",
  };
}

function buildStores() {
  return {
    campaignTakeStore: { hasApprovedTier3TakeForCampaign: vi.fn() },
    pcdSp10IdentitySnapshotStore: { createForShotWithCostForecast: vi.fn() },
    pcdSp18IdentitySnapshotStore: { createForShotWithSyntheticRouting: vi.fn() },
    costEstimator: { estimate: vi.fn() },
    creatorIdentityReader: { findById: vi.fn() },
    consentRecordReader: { findActiveByCreator: vi.fn() },
    clock: () => FIXED_NOW,
  };
}

describe("composeGenerationRouting — Step 1 consistency assert", () => {
  it("throws InvariantViolationError when syntheticSelection.creatorIdentityId differs from resolvedContext.creatorIdentityId", async () => {
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({ creatorIdentityId: "creator_A" }),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_B", // mismatch
          syntheticIdentity: buildSyntheticIdentity({ creatorIdentityId: "creator_B" }),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    await expect(composeGenerationRouting(input, stores)).rejects.toThrow(InvariantViolationError);

    // No router or writer called.
    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: FAIL (`composeGenerationRouting is not a function` or similar — the file currently has only types).

- [ ] **Step 3: Write the minimal implementation**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts` and replace the `ComposeGenerationRouting` type-only declaration (and the trailing `export type` re-exports) with the body skeleton:

```ts
// Replace the lines starting with `export type ComposeGenerationRouting = (...)`
// down through the trailing `export type { PcdProviderCapability, PcdRoutingDecisionReason };`
// with:

import { InvariantViolationError } from "../invariant-violation-error.js";

export async function composeGenerationRouting(
  input: ComposeGenerationRoutingInput,
  stores: ComposeGenerationRoutingStores,
): Promise<ComposeGenerationRoutingResult> {
  // Step 1 — Optional consistency assert.
  if (input.routing.syntheticSelection !== undefined) {
    if (
      input.routing.syntheticSelection.creatorIdentityId !==
      input.routing.resolvedContext.creatorIdentityId
    ) {
      throw new InvariantViolationError(
        "synthetic selection creatorIdentityId mismatch with resolvedContext",
        {
          syntheticSelectionId: input.routing.syntheticSelection.creatorIdentityId,
          resolvedContextId: input.routing.resolvedContext.creatorIdentityId,
        },
      );
    }
  }

  // Step 2-5 — implemented in Tasks 5-9.
  throw new Error("composeGenerationRouting: body not yet implemented past Step 1");

  // Suppress "unused parameter" linting until Tasks 5-9 use these.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void stores;
}
```

Also remove the placeholder `void stores` line once it would cause a downstream "Unreachable code" warning — leave it in for Task 4 only.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "Step 1 consistency assert"
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 Step 1 consistency assert (synthetic-selection ID match)"
```

---

## Task 5: Generic-route happy path (Case A) — test + impl through Steps 2 + 3 Case A + 4

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

`routePcdShot` returns allowed → composer calls `writePcdIdentitySnapshotWithCostForecast` with reconstructed `snapshot` + threaded `provenance` + post-routing-built `costForecast`.

- [ ] **Step 1: Write the failing test**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
import type { PcdIdentitySnapshot, PcdCostEstimate } from "@creativeagent/schemas";

function buildSnapshotReturn(): PcdIdentitySnapshot {
  // Minimal PcdIdentitySnapshot — used as the writer-mock return so the test
  // can confirm SP22 forwards it to the result.snapshot field.
  return { id: "snap_returned_1" } as unknown as PcdIdentitySnapshot;
}

function buildCostEstimateReturn(): PcdCostEstimate {
  return {
    estimatedUsd: 0.42,
    currency: "USD",
    lineItems: [{ kind: "model", units: 1, unitUsd: 0.42, totalUsd: 0.42 }],
    estimatorVersion: "stub-cost-estimator@1.0.0",
  };
}

describe("composeGenerationRouting — generic-route happy path (Case A)", () => {
  it("routes via SP4 and writes via writePcdIdentitySnapshotWithCostForecast with reconstructed args", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    // For SP9 stampPcdProvenance — consent re-check needs the reader to succeed.
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        // tier 2 simple_ugc draft → matches SP4 matrix without tier3 rules.
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      costHints: { durationSec: 8 },
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return; // narrow for TS
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithCostForecast");
    expect(result.snapshot).toEqual(buildSnapshotReturn());

    // Synthetic writer not called.
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();

    // SP10A writer called exactly once with the expected shape.
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(1);
    const writerCall = stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mock.calls[0]!;
    const writerPayload = writerCall[0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toEqual(expect.any(String));
    expect(writerPayload.assetRecordId).toBe("asset_1");
    expect(writerPayload.shotSpecVersion).toBe("shot-spec@1.0.0");

    // Cost estimator called with provider+model+shotType+outputIntent+durationSec.
    expect(stores.costEstimator.estimate).toHaveBeenCalledTimes(1);
    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(estimateInput.provider).toEqual(writerPayload.selectedProvider);
    expect(estimateInput.model).toBe("model-1.0");
    expect(estimateInput.shotType).toBe("simple_ugc");
    expect(estimateInput.outputIntent).toBe("draft");
    expect(estimateInput.durationSec).toBe(8);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "generic-route happy path"
```

Expected: FAIL (composer throws "body not yet implemented past Step 1").

- [ ] **Step 3: Implement Steps 2 + 3 Case A + 4 of the composer body**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`. Add the new imports at the top of the import block:

```ts
import { routePcdShot } from "../provider-router.js";
import { writePcdIdentitySnapshotWithCostForecast } from "../cost/write-pcd-identity-snapshot-with-cost-forecast.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
```

Replace the body's "Step 2-5 not yet implemented" throw with:

```ts
  // Step 2 — Route. Branch only on syntheticSelection presence.
  let routingDecision: PcdRoutingDecision | SyntheticPcdRoutingDecision;
  if (input.routing.syntheticSelection !== undefined) {
    // Synthetic branch — implemented in Task 6.
    throw new Error("synthetic branch not yet implemented");
  } else {
    routingDecision = await routePcdShot(
      {
        resolvedContext: input.routing.resolvedContext,
        shotType: input.routing.shotType,
        outputIntent: input.routing.outputIntent,
        approvedCampaignContext: input.routing.approvedCampaignContext,
      },
      { campaignTakeStore: stores.campaignTakeStore },
    );
  }

  // Step 3 — Map decision shape to write path.
  // Case A: SP4 allowed.
  if (
    !("kind" in routingDecision) &&
    routingDecision.allowed === true
  ) {
    // Step 4 — Generic write path.
    const sp4Decision = routingDecision;
    const snapshotInput: WritePcdIdentitySnapshotInput = {
      ...input.snapshotPersistence,
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      selectedCapability: sp4Decision.selectedCapability,
      selectedProvider: sp4Decision.selectedProvider,
      routerVersion: sp4Decision.routerVersion,
      routingDecisionReason: sp4Decision.decisionReason,
      editOverRegenerateRequired:
        sp4Decision.decisionReason.tier3RulesApplied.includes("edit_over_regenerate"),
    };
    const costForecast = {
      provider: sp4Decision.selectedProvider,
      model: input.snapshotPersistence.providerModelSnapshot,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      durationSec: input.costHints?.durationSec,
      tokenCount: input.costHints?.tokenCount,
    };
    const snapshot = await writePcdIdentitySnapshotWithCostForecast(
      { snapshot: snapshotInput, provenance: input.provenance, costForecast },
      {
        pcdSp10IdentitySnapshotStore: stores.pcdSp10IdentitySnapshotStore,
        costEstimator: stores.costEstimator,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithCostForecast",
      decision: routingDecision,
      snapshot,
    };
  }

  // Cases B + C + denials — implemented in Tasks 6, 8, 9, 10.
  throw new Error("decision-shape mapping not yet implemented for this branch");
```

Remove the `void stores;` stub from Task 4 — `stores` is now used.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "generic-route happy path"
```

Expected: PASS.

- [ ] **Step 5: Re-run the Step 1 test to confirm no regression**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "Step 1 consistency assert"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 generic-route Case A — writePcdIdentitySnapshotWithCostForecast"
```

---

## Task 6: Synthetic-route kling happy path (Case C, tier ≤ 2) — test + add synthetic branch + Step 5

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

Add SP16 invocation + Case C kling-branch handling. Synthesize `selectedCapability` (all flags true), `routingDecisionReason` shim, `selectedProvider = "dalle+kling"`.

- [ ] **Step 1: Write the failing test**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
describe("composeGenerationRouting — synthetic-route kling happy path (Case C)", () => {
  it("routes via SP16 and writes via writePcdIdentitySnapshotWithSyntheticRouting with selectedProvider='dalle+kling'", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        // tier 2 — Tier 3 invariant short-circuits.
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithSyntheticRouting");

    // Generic writer not called.
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.costEstimator.estimate).not.toHaveBeenCalled();

    // SP18 writer called exactly once with selectedProvider = "dalle+kling".
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerCall = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]!;
    const writerPayload = writerCall[0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toBe("dalle+kling");
    expect(writerPayload.imageProvider).toBe("dalle");
    expect(writerPayload.videoProvider).toBe("kling");
    expect(writerPayload.videoProviderChoice).toBe("kling");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "synthetic-route kling happy path"
```

Expected: FAIL (composer throws "synthetic branch not yet implemented").

- [ ] **Step 3: Add SP16 + SP18 imports + helper for synthetic write path**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`. Add to the import block:

```ts
import { routeSyntheticPcdShot } from "../synthetic-router/route-synthetic-pcd-shot.js";
import { writePcdIdentitySnapshotWithSyntheticRouting } from "../synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.js";
```

Replace the body's synthetic-branch placeholder (the `throw new Error("synthetic branch not yet implemented");` line inside the `if (input.routing.syntheticSelection !== undefined)` block) with:

```ts
    routingDecision = await routeSyntheticPcdShot(
      {
        resolvedContext: input.routing.resolvedContext,
        syntheticIdentity: input.routing.syntheticSelection.syntheticIdentity,
        shotType: input.routing.shotType,
        outputIntent: input.routing.outputIntent,
        videoProviderChoice: input.routing.syntheticSelection.videoProviderChoice,
        approvedCampaignContext: input.routing.approvedCampaignContext,
      },
      { campaignTakeStore: stores.campaignTakeStore },
    );
```

Add the Case C handling AFTER the Case A block, BEFORE the "decision-shape mapping not yet implemented" throw:

```ts
  // Case C: SP16 synthetic-pairing allowed.
  if (
    "kind" in routingDecision &&
    routingDecision.kind === "synthetic_pairing" &&
    routingDecision.allowed === true
  ) {
    // Step 5 — Synthetic-pairing write path.
    // Tier 3 recompute (Step 5a) added at Task 8 — tier-3 + synthetic
    // invariant interaction. At Task 6 the test runs at tier 2, so the
    // invariant short-circuits and these synthesized values pass through
    // without recompute.
    const selectedProvider = `${routingDecision.imageProvider}+${routingDecision.videoProvider}`;
    const selectedCapability: PcdProviderCapability = {
      provider: selectedProvider,
      tiers: [input.routing.resolvedContext.effectiveTier],
      shotTypes: [input.routing.shotType],
      outputIntents: [input.routing.outputIntent],
      supportsFirstLastFrame: true,
      supportsEditExtend: true,
      supportsPerformanceTransfer: true,
    };
    const routingDecisionReason: PcdRoutingDecisionReason = {
      capabilityRefIndex: routingDecision.pairingRefIndex,
      matchedShotType: input.routing.shotType,
      matchedEffectiveTier: input.routing.resolvedContext.effectiveTier,
      matchedOutputIntent: input.routing.outputIntent,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: routingDecision.decisionReason.selectionRationale,
    };
    const snapshotInput: WritePcdIdentitySnapshotInput = {
      ...input.snapshotPersistence,
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      selectedCapability,
      selectedProvider,
      routerVersion: routingDecision.syntheticRouterVersion,
      routingDecisionReason,
      editOverRegenerateRequired: false,
    };
    const snapshot = await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: snapshotInput,
        provenance: input.provenance,
        syntheticRouting: { syntheticDecision: routingDecision },
      },
      {
        pcdSp18IdentitySnapshotStore: stores.pcdSp18IdentitySnapshotStore,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithSyntheticRouting",
      decision: routingDecision,
      snapshot,
    };
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "synthetic-route kling happy path"
```

Expected: PASS.

- [ ] **Step 5: Re-run all SP22 tests so far**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: 3 passing (Step 1, Case A, Case C kling).

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 synthetic-route Case C kling — writePcdIdentitySnapshotWithSyntheticRouting"
```

---

## Task 7: Synthetic-route seedance happy path (Case C, seedance branch)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`

The composer code already handles seedance via the same Case C block (`${imageProvider}+${videoProvider}` builds `"dalle+seedance"`). This task confirms via test; if it passes immediately, the only change is the test file.

- [ ] **Step 1: Write the failing test**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
describe("composeGenerationRouting — synthetic-route seedance happy path (Case C)", () => {
  it("routes via SP16 and writes via writePcdIdentitySnapshotWithSyntheticRouting with selectedProvider='dalle+seedance'", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "product_demo" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({
            seedanceDirection: {
              setting: "outdoor-park",
              motion: "static",
              energy: "calm",
              lighting: "natural",
              avoid: ["fast-cuts"],
            },
          }),
          videoProviderChoice: "seedance" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithSyntheticRouting");
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);

    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toBe("dalle+seedance");
    expect(writerPayload.videoProvider).toBe("seedance");
    expect(writerPayload.videoProviderChoice).toBe("seedance");
  });
});
```

- [ ] **Step 2: Run the test and confirm it passes immediately**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "synthetic-route seedance happy path"
```

Expected: PASS (no impl change needed — Case C already handles seedance).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "test(pcd): SP22 synthetic-route Case C seedance coverage"
```

---

## Task 8: Tier-3 synthetic invariant interaction (§11.3 resolution under test)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

The Task 6 implementation works at tier ≤ 2 because the SP4 Tier 3 invariant short-circuits. Tier 3 + publishable + video shots make the invariant fire, and the current static `selectedCapability` would (a) be fine because all support flags are `true` and (b) the empty `tier3RulesApplied` would FAIL the forensic consistency check. Task 8 adds the Step 5a recompute logic from design §3.

- [ ] **Step 1: Write the failing test — tier 3 + talking_head + final_export + synthetic kling**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
describe("composeGenerationRouting — Tier-3 synthetic invariant interaction (§11.3)", () => {
  it("tier 3 + talking_head + final_export + synthetic kling: writer called once with recomputed tier3RulesApplied=[performance_transfer]", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "talking_head" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;

    // Writer was called (the invariant did NOT throw).
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;

    // Persisted routingDecisionReason contains the honestly-recomputed
    // required set for tier 3 + talking_head + final_export (publishable).
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    const tier3Applied = reason.tier3RulesApplied as ReadonlyArray<string>;
    expect(new Set(tier3Applied)).toEqual(
      new Set(["first_last_frame_anchor", "performance_transfer"]),
    );

    // editOverRegenerateRequired is false (no campaign context).
    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
  });

  it("tier 3 + product_demo + final_export + campaign + approved-take=true + synthetic seedance: tier3RulesApplied includes edit_over_regenerate", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockResolvedValue(true);
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "product_demo" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({
            seedanceDirection: {
              setting: "studio-dark",
              motion: "subtle-dolly",
              energy: "calm",
              lighting: "moody",
              avoid: ["fast-cuts"],
            },
          }),
          videoProviderChoice: "seedance" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;

    // campaignTakeStore was queried (Step 5a side-call).
    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).toHaveBeenCalledTimes(1);
    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mock.calls[0]![0]).toEqual({
      organizationId: "org_1",
      campaignId: "camp_1",
    });

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    const tier3Applied = reason.tier3RulesApplied as ReadonlyArray<string>;
    // first_last_frame_anchor (publishable video) + edit_over_regenerate (approved take).
    // product_demo is NOT talking_head so performance_transfer is NOT required.
    expect(new Set(tier3Applied)).toEqual(
      new Set(["first_last_frame_anchor", "edit_over_regenerate"]),
    );
  });

  it("tier ≤ 2 synthetic skips Step 5a recompute (campaignTakeStore not called, tier3RulesApplied=[])", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(), // tier 2
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    await composeGenerationRouting(input, stores);

    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    expect(reason.tier3RulesApplied).toEqual([]);
  });

  it("campaignTakeStore throws on tier 3 + campaign synthetic → composer rethrows, writer not called", async () => {
    const stores = buildStores();
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockRejectedValue(
      new Error("db unavailable"),
    );

    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "talking_head" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("db unavailable");
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "Tier-3 synthetic invariant"
```

Expected: tier-3 tests fail because (a) the static `tier3RulesApplied: []` does NOT match the recomputed required set inside the invariant — `Tier3RoutingMetadataMismatchError` thrown by the writer.

- [ ] **Step 3: Add tier3 helper imports**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`. Add to the import block:

```ts
import {
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type Tier3Rule,
} from "../tier3-routing-rules.js";
```

- [ ] **Step 4: Replace the Case C block with Step 5a + 5b**

Locate the Case C block from Task 6. Replace it with:

```ts
  // Case C: SP16 synthetic-pairing allowed.
  if (
    "kind" in routingDecision &&
    routingDecision.kind === "synthetic_pairing" &&
    routingDecision.allowed === true
  ) {
    // Step 5a — Recompute the SP4 tier-3 "required" set using the same
    // predicates the SP18 writer's invariant uses, so the forensic-consistency
    // check passes by construction (§11.3 resolution).
    let editOverRegenerateRequired = false;
    if (
      input.routing.resolvedContext.effectiveTier === 3 &&
      input.routing.approvedCampaignContext.kind === "campaign"
    ) {
      editOverRegenerateRequired = await requiresEditOverRegenerate(
        {
          effectiveTier: 3,
          organizationId: input.routing.approvedCampaignContext.organizationId,
          campaignId: input.routing.approvedCampaignContext.campaignId,
        },
        { campaignTakeStore: stores.campaignTakeStore },
      );
    }
    const tier3RulesApplied: Tier3Rule[] = [];
    if (
      requiresFirstLastFrameAnchor({
        effectiveTier: input.routing.resolvedContext.effectiveTier,
        shotType: input.routing.shotType,
        outputIntent: input.routing.outputIntent,
      })
    ) {
      tier3RulesApplied.push("first_last_frame_anchor");
    }
    if (
      requiresPerformanceTransfer({
        effectiveTier: input.routing.resolvedContext.effectiveTier,
        shotType: input.routing.shotType,
      })
    ) {
      tier3RulesApplied.push("performance_transfer");
    }
    if (editOverRegenerateRequired) {
      tier3RulesApplied.push("edit_over_regenerate");
    }

    // Step 5b — Build synthesized SP4-shaped values (per §11.3).
    const selectedProvider = `${routingDecision.imageProvider}+${routingDecision.videoProvider}`;
    const selectedCapability: PcdProviderCapability = {
      // NOT persisted by SP18 writer — consumed only by the Tier 3 invariant.
      // All support flags TRUE because synthetic pairings supersede capability
      // filtering by SP16 design (line 22-24 of route-synthetic-pcd-shot.ts).
      provider: selectedProvider,
      tiers: [input.routing.resolvedContext.effectiveTier],
      shotTypes: [input.routing.shotType],
      outputIntents: [input.routing.outputIntent],
      supportsFirstLastFrame: true,
      supportsEditExtend: true,
      supportsPerformanceTransfer: true,
    };
    const routingDecisionReason: PcdRoutingDecisionReason = {
      // capabilityRefIndex carries SP16's pairingRefIndex (label-shim — the
      // authoritative SP16 record is the separately-persisted
      // syntheticRoutingDecisionReason written by SP18's own stamper).
      capabilityRefIndex: routingDecision.pairingRefIndex,
      matchedShotType: input.routing.shotType,
      matchedEffectiveTier: input.routing.resolvedContext.effectiveTier,
      matchedOutputIntent: input.routing.outputIntent,
      tier3RulesApplied,
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: routingDecision.decisionReason.selectionRationale,
    };
    const snapshotInput: WritePcdIdentitySnapshotInput = {
      ...input.snapshotPersistence,
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      selectedCapability,
      selectedProvider,
      routerVersion: routingDecision.syntheticRouterVersion,
      routingDecisionReason,
      editOverRegenerateRequired,
    };
    const snapshot = await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: snapshotInput,
        provenance: input.provenance,
        syntheticRouting: { syntheticDecision: routingDecision },
      },
      {
        pcdSp18IdentitySnapshotStore: stores.pcdSp18IdentitySnapshotStore,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithSyntheticRouting",
      decision: routingDecision,
      snapshot,
    };
  }
```

- [ ] **Step 5: Run all SP22 tests and confirm green**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: all passing (Step 1, Case A, Case C kling tier 2, Case C seedance tier 2, all four Tier-3 invariant tests).

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 Step 5a tier-3 recompute (synthetic invariant resolution per §11.3)"
```

---

## Task 9: Synthetic delegation (Case B) — the SP10A-not-SP18 invariant

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

SP16 returns `delegated_to_generic_router` for shot types absent from the synthetic-pairing matrix (`script_only`, `storyboard`). With an allowed `sp4Decision`, SP22 must write via `writePcdIdentitySnapshotWithCostForecast`, NOT via `writePcdIdentitySnapshotWithSyntheticRouting`. This is the locked invariant.

- [ ] **Step 1: Write the failing test**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
describe("composeGenerationRouting — synthetic delegation Case B (the SP10A-not-SP18 invariant)", () => {
  it("SP16 delegated_to_generic_router with allowed sp4Decision: writePcdIdentitySnapshotWithCostForecast called, SP18 writer NOT called", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        // script_only is OUT of the synthetic-pairing matrix → SP16 delegates to SP4.
        shotType: "script_only" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithCostForecast");

    // KEY INVARIANT: SP18 writer NOT called on delegation.
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
    // SP10A writer called.
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(1);

    // Confirm the writer was given the sp4Decision's selectedProvider (NOT a composite).
    const writerPayload = stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mock.calls[0]![0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).not.toContain("+");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "synthetic delegation Case B"
```

Expected: FAIL (composer throws "decision-shape mapping not yet implemented" for the delegation envelope).

- [ ] **Step 3: Add Case B handling**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`. Add the Case B block AFTER the Case A block (the existing `if (!("kind" in routingDecision) && routingDecision.allowed === true) { ... }`) and BEFORE the Case C block:

```ts
  // Case B: SP16 delegated_to_generic_router with allowed sp4Decision.
  // INVARIANT: delegation is NEVER a synthetic-provenance write.
  if (
    "kind" in routingDecision &&
    routingDecision.kind === "delegated_to_generic_router" &&
    routingDecision.sp4Decision.allowed === true
  ) {
    const sp4Decision = routingDecision.sp4Decision;
    const snapshotInput: WritePcdIdentitySnapshotInput = {
      ...input.snapshotPersistence,
      effectiveTier: input.routing.resolvedContext.effectiveTier,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      selectedCapability: sp4Decision.selectedCapability,
      selectedProvider: sp4Decision.selectedProvider,
      routerVersion: sp4Decision.routerVersion,
      routingDecisionReason: sp4Decision.decisionReason,
      editOverRegenerateRequired:
        sp4Decision.decisionReason.tier3RulesApplied.includes("edit_over_regenerate"),
    };
    const costForecast = {
      provider: sp4Decision.selectedProvider,
      model: input.snapshotPersistence.providerModelSnapshot,
      shotType: input.routing.shotType,
      outputIntent: input.routing.outputIntent,
      durationSec: input.costHints?.durationSec,
      tokenCount: input.costHints?.tokenCount,
    };
    const snapshot = await writePcdIdentitySnapshotWithCostForecast(
      { snapshot: snapshotInput, provenance: input.provenance, costForecast },
      {
        pcdSp10IdentitySnapshotStore: stores.pcdSp10IdentitySnapshotStore,
        costEstimator: stores.costEstimator,
        creatorIdentityReader: stores.creatorIdentityReader,
        consentRecordReader: stores.consentRecordReader,
        clock: stores.clock,
      },
    );
    return {
      outcome: "routed_and_written",
      writerKind: "writePcdIdentitySnapshotWithCostForecast",
      decision: routingDecision,
      snapshot,
    };
  }
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "synthetic delegation Case B"
```

Expected: PASS.

- [ ] **Step 5: Re-run all SP22 tests so far**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 Case B — delegation routes to writePcdIdentitySnapshotWithCostForecast (never SP18)"
```

---

## Task 10: Denial-no-write tests (6 cases) + impl

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`

Cover the six denial branches: SP4 ACCESS_POLICY, SP4 NO_PROVIDER_CAPABILITY, SP16 ACCESS_POLICY, SP16 NO_DIRECTION_AUTHORED, delegation envelope with denied sp4Decision (ACCESS_POLICY + NO_PROVIDER_CAPABILITY). Add the default-return-denied branch.

- [ ] **Step 1: Write the failing tests**

Append to `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`:

```ts
describe("composeGenerationRouting — denial branches return decision verbatim, no write", () => {
  it("SP4 ACCESS_POLICY denial (tier 3 + simple_ugc + final_export — disallowed combo)", async () => {
    // ACCESS_POLICY denial requires a tier policy reject; use creator tier 1 +
    // product tier 3 + a publishable intent that the SP2 policy refuses for
    // mismatched tiers. Adjust based on actual SP2 rules — if this combo
    // does not deny, swap to one that does by reading
    // packages/creative-pipeline/src/pcd/tier-policy.ts.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    // Generic SP4 decision (no `kind` discriminator).
    expect("kind" in result.decision).toBe(false);
    expect(result.decision.allowed).toBe(false);
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("SP4 NO_PROVIDER_CAPABILITY denial (tier 3 + label_closeup + final_export with no matching capability)", async () => {
    // Pick a (tier, shot, intent) triple that exists in the matrix but where
    // the tier 3 rule filter empties the candidate set. If no such triple
    // currently exists with the matrix as shipped, this test stays as a
    // placeholder via vi.spyOn(routePcdShot) — but prefer a real triple if
    // one exists. Verify against
    // packages/creative-pipeline/src/pcd/provider-capability-matrix.ts.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "label_closeup" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
  });

  it("SP16 ACCESS_POLICY denial (synthetic + tier policy reject)", async () => {
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect("kind" in result.decision).toBe(true);
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("SP16 NO_DIRECTION_AUTHORED denial (seedance choice with seedanceDirection=null)", async () => {
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({ seedanceDirection: null }),
          videoProviderChoice: "seedance" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("Delegation envelope wrapping a denied sp4Decision (script_only + tier policy reject)", async () => {
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "script_only" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect("kind" in result.decision).toBe(true);
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts -t "denial branches"
```

Expected: FAIL (composer throws "decision-shape mapping not yet implemented" on every denial).

- [ ] **Step 3: Add the default denial-return at the end of the body**

Open `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`. Replace the trailing `throw new Error("decision-shape mapping not yet implemented for this branch");` with:

```ts
  // Any denial — verbatim pass-through. Covers SP4 ACCESS_POLICY,
  // SP4 NO_PROVIDER_CAPABILITY, SP16 ACCESS_POLICY,
  // SP16 NO_DIRECTION_AUTHORED, and delegation envelopes wrapping a
  // denied sp4Decision.
  return { outcome: "denied", decision: routingDecision };
```

- [ ] **Step 4: Run all SP22 tests and confirm green**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts \
        packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "feat(pcd): SP22 denial-no-write — all denial branches return decision verbatim"
```

---

## Task 11: Cost-forecast input construction tests + writer error propagation

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`

Two test groups: (a) confirm the cost-forecast input is constructed correctly post-routing for the generic AND delegation paths; (b) confirm writer/router/estimator throws propagate.

- [ ] **Step 1: Append the test code**

```ts
describe("composeGenerationRouting — cost-forecast input plumbing post-routing", () => {
  it("generic path: cost-forecast input mirrors provider, model, shotType, outputIntent, costHints", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "preview" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        providerModelSnapshot: "specific-model-1.2.3",
      },
      provenance: buildProvenance(),
      costHints: { durationSec: 12, tokenCount: 8000 },
      now: FIXED_NOW,
    };
    await composeGenerationRouting(input, stores);

    expect(stores.costEstimator.estimate).toHaveBeenCalledTimes(1);
    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(estimateInput.model).toBe("specific-model-1.2.3");
    expect(estimateInput.shotType).toBe("simple_ugc");
    expect(estimateInput.outputIntent).toBe("preview");
    expect(estimateInput.durationSec).toBe(12);
    expect(estimateInput.tokenCount).toBe(8000);
    expect(estimateInput.provider).toEqual(expect.any(String));
  });

  it("delegation path: cost-forecast uses sp4Decision.selectedProvider (NOT the synthetic composite)", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });
    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "script_only" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await composeGenerationRouting(input, stores);

    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    // Must NOT contain a '+' — that would indicate a synthetic composite leaked
    // into the cost forecast.
    expect(estimateInput.provider).not.toContain("+");
  });
});

describe("composeGenerationRouting — error propagation", () => {
  it("writePcdIdentitySnapshotWithCostForecast throws → composer rethrows", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockRejectedValue(
      new Error("snapshot store failure"),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });
    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("snapshot store failure");
  });

  it("writePcdIdentitySnapshotWithSyntheticRouting throws → composer rethrows", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockRejectedValue(
      new Error("sp18 store failure"),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });
    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("sp18 store failure");
  });

  it("router throws (campaignTakeStore failure on generic tier-3 + campaign path) → composer rethrows, no writer called", async () => {
    // SP4 router Step 3 calls requiresEditOverRegenerate(...) which queries
    // campaignTakeStore for tier 3 + campaign context. A throwing store
    // surfaces as router throw → composer rethrow.
    const stores = buildStores();
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockRejectedValue(
      new Error("campaign-take db failure"),
    );
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "preview" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("campaign-take db failure");
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run all SP22 tests and confirm green**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: all passing (these tests should pass without composer changes — they verify the existing implementation).

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "test(pcd): SP22 cost-forecast plumbing + writer error propagation coverage"
```

---

## Task 12: `editOverRegenerateRequired` derivation test (generic path + delegation path coverage)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts`

The synthetic-path Step 5a derivation is covered by Task 8. This task covers the generic + delegation paths where `editOverRegenerateRequired` is derived from `routingDecisionReason.tier3RulesApplied`.

- [ ] **Step 1: Append the test code**

```ts
describe("composeGenerationRouting — editOverRegenerateRequired derivation (generic + delegation paths)", () => {
  it("generic path: tier 3 + approved campaign take → editOverRegenerateRequired=true flows into writer payload", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockResolvedValue(true);
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findActiveByCreator.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });
    // Pick a (tier 3, shot, intent) triple that has an edit-extend-capable
    // provider in the matrix so SP4 routes successfully when the tier 3 rule
    // fires. Verify against
    // packages/creative-pipeline/src/pcd/provider-capability-matrix.ts —
    // adjust shotType / outputIntent if necessary.
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "product_in_hand" as const,
        outputIntent: "preview" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await composeGenerationRouting(input, stores);

    const writerPayload = stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mock.calls[0]![0] as Record<string, unknown>;
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    const tier3Applied = reason.tier3RulesApplied as ReadonlyArray<string>;
    expect(tier3Applied).toContain("edit_over_regenerate");
  });
});
```

- [ ] **Step 2: Run all SP22 tests and confirm green**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts
git commit -m "test(pcd): SP22 editOverRegenerateRequired derivation on generic tier-3 path"
```

---

## Task 13: SP22 anti-pattern assertions filled in (cross-check against design §7)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts`

Replace the Task 2 placeholder with the eight assertions from design §7. **Before declaring green, cross-check this file line-by-line against design §7 per `feedback_design_plan_antipattern_reconciliation.md`.**

- [ ] **Step 1: Replace the anti-pattern test file**

Overwrite `packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts`:

```ts
// SP22 anti-pattern test. Eight assertions per design §7.
// Keyed to SP21 squash SHA ece1347 as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "ece1347";

const SP22_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // Task 3 — composer types + barrel.
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts",
  "packages/creative-pipeline/src/pcd/generation/index.ts",
  // Tasks 4-12 — composer test file.
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts",
  // Task 2 + this file.
  "packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp22-task1-verification.md",
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
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts",
);

describe("SP22 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP22 allowlist (freeze vs SP21 squash ece1347)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP22_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 14 sweep).
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

  it("#3 composer body contains no zero-arg `new Date()` (system-clock read); derivation from input.now is permitted", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(bodyNoLineComments).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("#4 composer does not reference forbidden identifiers", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const forbidden of [
      "Inngest",
      "process.env",
      "console.log",
      "console.info",
      "fetch(",
      "selectSyntheticCreator",
      "assertConsentNotRevokedForGeneration",
      "runIdentityAwarePreproductionChain",
    ]) {
      expect(bodyNoLineComments).not.toContain(forbidden);
    }
  });

  it("#5 composer does not import from forbidden sibling dirs", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lines = body.split("\n");
    const importLines = lines.filter((line) => /^\s*import\b/.test(line));
    const forbidden = [
      /from\s+["']\.\.\/selector\//,
      /from\s+["']\.\.\/synthetic-creator\//,
      /from\s+["']\.\.\/qc-/,
      /from\s+["']\.\.\/qc-providers/,
      /from\s+["']\.\.\/consent-/,
      /from\s+["']\.\.\/performance-snapshot\//,
      /from\s+["']\.\.\/preproduction\//,
      /from\s+["']\.\.\/cost-budget\//,
    ];
    for (const pattern of forbidden) {
      for (const line of importLines) {
        expect(line, `forbidden import: ${line}`).not.toMatch(pattern);
      }
    }
  });

  it("#6 writer-import singularity: each canonical writer imported exactly once and called exactly once; no other identity-snapshot writer imported", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const importMatches = body.match(/import\s+\{[^}]*\}\s+from\s+["'][^"']+["']/g) ?? [];
    const allImports = importMatches.join("\n");

    // Canonical writers — imported AND referenced exactly once.
    for (const name of [
      "writePcdIdentitySnapshotWithCostForecast",
      "writePcdIdentitySnapshotWithSyntheticRouting",
    ]) {
      const importHits = (allImports.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      const bodyHits = (body.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      expect(importHits, `${name} imported ${importHits} times`).toBe(1);
      // bodyHits counts both the import line and the call site → expect 2.
      expect(bodyHits, `${name} referenced ${bodyHits} times`).toBe(2);
    }

    // Forbidden writers — not imported.
    for (const forbidden of [
      "writePcdIdentitySnapshotWithProvenance",
    ]) {
      expect(allImports, `${forbidden} must not be imported`).not.toContain(forbidden);
    }
    // The SP4 bare `writePcdIdentitySnapshot` is allowed to appear as a TYPE
    // import (WritePcdIdentitySnapshotInput) but not as a value reference.
    // Strip the type import line before checking.
    const importLines = body.split("\n").filter((l) => /^\s*import\b/.test(l));
    const valueRefBody = body
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l) && !/^\s*\/\//.test(l))
      .join("\n");
    expect(
      valueRefBody,
      "bare writePcdIdentitySnapshot must not appear in composer body",
    ).not.toMatch(/\bwritePcdIdentitySnapshot\s*\(/);
    // (Type import lines such as `import type { WritePcdIdentitySnapshotInput }`
    // are explicitly allowed — verify the import block contains the type form.)
    expect(
      importLines.some((l) => /WritePcdIdentitySnapshotInput/.test(l)),
      "composer should import WritePcdIdentitySnapshotInput as a type",
    ).toBe(true);
  });

  it("#7 router-import singularity: routePcdShot + routeSyntheticPcdShot each imported once and called once", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    for (const name of ["routePcdShot", "routeSyntheticPcdShot"]) {
      const hits = (body.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      // Each appears once in import + once at call site → expect 2.
      expect(hits, `${name} referenced ${hits} times`).toBe(2);
    }
  });

  it("#8 PCD pinned-constant census stays at 24 (no new PCD_*_VERSION export introduced since ece1347)", () => {
    const schemasDir = "packages/schemas/src";
    const baselineFiles = execSync(`git ls-tree -r --name-only ${FREEZE_SHA} -- ${schemasDir}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    const currentFiles = listAllSourceFiles(join(REPO_ROOT, schemasDir))
      .map((p) => relative(REPO_ROOT, p))
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    expect(currentFiles.sort()).toEqual(baselineFiles.sort());
  });

  it("#9 composer file size under 300 lines", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lineCount = body.split("\n").length;
    expect(lineCount, `composer is ${lineCount} lines`).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Reconciliation gate — cross-check this file against design §7 line-by-line**

Open `docs/plans/2026-05-16-pcd-sp22-generation-composer-design.md` and re-read §7 (Anti-pattern assertions). Step through each numbered design assertion (§7 #1 through §7 #8) and confirm a corresponding test exists above. The mapping is:

| Design §7 # | Test # in this file | Match? |
|---|---|---|
| §7 #1 (no `@creativeagent/db` import) | #2 | ✅ |
| §7 #2 (no zero-arg `new Date()`) | #3 | ✅ |
| §7 #3 (no forbidden sibling imports) | #5 | ✅ |
| §7 #4 (no forbidden identifier references) | #4 | ✅ |
| §7 #5 (writer-import singularity) | #6 | ✅ |
| §7 #6 (router-import singularity) | #7 | ✅ |
| §7 #7 (constant census stays at 24) | #8 | ✅ |
| §7 #8 (file size under 300 lines) | #9 | ✅ |

Plus #1 (allowlist sweep vs freeze SHA) is the SP21-precedent enforcement test, not in design §7 numbered list but inherited.

If any row is ❌ — design or plan deviation. Fix BEFORE proceeding to Step 3.

- [ ] **Step 3: Run the anti-pattern tests**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts
```

Expected: 9 passing.

If any fail:
- Test #1 (allowlist) — likely a file edited that is NOT in `SP22_ALLOWLISTED_EDITS`. EITHER add to the allowlist if legitimate (e.g. a missed test file) OR investigate the unallowlisted edit.
- Test #5 (forbidden imports) — likely a sibling import slipped in; remove it.
- Test #6 (writer singularity) — likely the wrong writer was imported; fix the import.
- Test #9 (size) — composer body grew past 300 lines; split if necessary.

- [ ] **Step 4: Run ALL SP22 tests (composer + anti-patterns) and confirm green**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/generation/
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts
git commit -m "test(pcd): SP22 anti-pattern assertions filled in (cross-checked vs design §7)"
```

---

## Task 14: Allowlist sweep across prior `sp*-anti-patterns.test.ts` + final verification gate

**Files:**
- Modify: discovered set of prior `sp*-anti-patterns.test.ts` whose allowlist needs SP22 additions.

The new `generation/` directory + new composer + new anti-pattern test file may trip prior slices' anti-pattern allowlists. Discover the failing set and extend each narrowly (no pre-emptive widening). Per SP21 lesson #9: prefer tightening prior tests' import-scope grep over comment-side workarounds.

- [ ] **Step 1: Discover the failing prior anti-pattern tests**

```bash
find packages -name "sp*-anti-patterns.test.ts" -print
```

Expected output: a list of prior anti-pattern tests (sp6, sp9, sp10a, sp10b, sp10c, sp11, sp12, sp13, sp14, sp15, sp16, sp17, sp18, sp19, sp20, sp21). Run all of them:

```bash
pnpm exec vitest run $(find packages -name "sp*-anti-patterns.test.ts" -not -name "sp22-*" -print)
```

Record the set of FAILING tests + the assertion that fired. The expected failures are allowlist tests (test #1) on prior slices that did not anticipate the SP22 `generation/` directory.

- [ ] **Step 2: For each failing test, extend the allowlist narrowly**

For each failing prior anti-pattern test, open it and locate its `ALLOWLISTED_EDITS` array. Add the four SP22 files:

```ts
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts",
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts",
  "packages/creative-pipeline/src/pcd/generation/index.ts",
  "packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts",
```

PLUS the three plan docs (if the prior allowlists track docs):

```ts
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp22-task1-verification.md",
```

Do NOT pre-emptively widen with regex; add the exact file paths.

If a prior anti-pattern test fails on a forbidden-import or forbidden-identifier check (NOT the allowlist), this means SP22's composer references an identifier the prior slice forbade for ITSELF. That is almost certainly a false positive — verify the failing prior test inspects only its OWN source file (not the SP22 composer file). If it does inspect SP22's composer by accident (a too-broad glob), tighten the prior test's source-path narrowing rather than working around the composer.

- [ ] **Step 3: Run all anti-pattern tests + composer tests**

```bash
pnpm exec vitest run packages/creative-pipeline/src/pcd/
```

Expected: all passing.

- [ ] **Step 4: Commit allowlist sweep**

```bash
# Commit the discovered allowlist edits separately so the change is traceable.
git add $(git diff --name-only | grep "sp.*-anti-patterns.test.ts")
git commit -m "test(pcd): SP22 allowlist sweep — extend prior sp*-anti-patterns.test.ts for generation/"
```

- [ ] **Step 5: Final verification gate inside the worktree**

```bash
pnpm typecheck && pnpm test && pnpm lint && git diff --name-only main...HEAD | xargs pnpm exec prettier --check
```

Expected: all four green. If `prettier --check` flags any file, run `pnpm exec prettier --write <file>` and amend the most recent SP22 commit (or create a fix-up commit if amending would mix concerns).

If anti-pattern tests fail again on this final gate, the Task 13 lesson "Task 13 allowlist cascade — later commits can re-break the sweep" applies — budget one fix-up commit to re-extend the prior allowlists.

- [ ] **Step 6: PR readiness check**

```bash
git log --oneline ece1347..HEAD
```

Expected: a clean linear history of SP22 commits, each with a meaningful conventional-commit message. The PR title for the squash-merge should be:

```
feat(pcd): SP22 — generation composer (second impure PCD orchestrator)
```

Body should reference design + plan paths and call out the cost-forecast asymmetry + SP22.1 reservation.

---

## Done

The slice is complete when:
- ✅ `composeGenerationRouting(input, stores)` lives in `packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts`.
- ✅ All SP22 unit tests pass (Task 4-12 cover ~21 cases per design §8).
- ✅ All SP22 anti-pattern tests pass (Task 13: 9 assertions per design §7 + the SP21-precedent allowlist sweep).
- ✅ The Task 1 verification note exists and confirms §11.3 still holds.
- ✅ All prior `sp*-anti-patterns.test.ts` pass (Task 14 sweep).
- ✅ Worktree-side `pnpm typecheck && pnpm test && pnpm lint && prettier --check` is green (Task 14 Step 5).
- ✅ PCD pinned-constant census stays at **24**.
- ✅ No edits to SP1–SP21 source bodies; no schema change; no migration.
- ✅ Composer file is under 300 lines and does not import `@creativeagent/db`.

Next slices (reserved, out of SP22 scope):
- **SP22.1** — combined SP10A+SP18 writer to close the cost-forecast asymmetry on synthetic-pairing writes (per §6 + §11.3).
- **SP23+** — terminal-state writer composer wrapping SP19 `PcdPerformanceSnapshot`.
- **SP24+** — QC composer wrapping SP5 evaluation.

Merge-back to Switchboard is the endgame.
