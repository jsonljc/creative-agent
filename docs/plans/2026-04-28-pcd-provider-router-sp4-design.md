---
date: 2026-04-28
tags: [pcd, sp4, provider-router, capability-matrix, identity-snapshot, design]
status: approved
---

# PCD SP4 — `ProviderRouter` + Capability Matrix + `PcdIdentitySnapshot` Writer Design

**Slice:** SP4 of the PCD vertical. SP1 (`05bc4655` in Switchboard, extracted as `creativeagent` `10a5ce0`), SP2 (`creativeagent` `cb7a378`, PR #1), and SP3 (`creativeagent` `715e325`, PR #2) have shipped.
**Goal:** Ship one coherent vertical that (a) introduces a declarative `PcdProviderCapabilityMatrix` plus `PCD_PROVIDER_CAPABILITY_VERSION`, (b) adds a tier-aware, store-injected `routePcdShot` that selects providers by matrix lookup and enforces three Tier 3 mandatory rules, and (c) adds a pure store-injected `writePcdIdentitySnapshot` that pins four version constants and validates Tier 3 invariants as a second line of defense.
**Source-of-truth spec:** `docs/plans/2026-04-27-pcd-identity-registry-design.md` — sections "Architecture", "Provider routing by tier", "Tier 3 mandatory routing rules", "Provider capability matrix (declarative)", "Identity snapshot".
**Upstream slices consumed:** SP2 design (`docs/plans/2026-04-28-pcd-tier-policy-sp2-design.md`) — the deterministic gate SP4 invokes per shot. SP3 design (`docs/plans/2026-04-28-pcd-registry-resolver-sp3-design.md`) — the per-job context SP4 consumes (with one additive contract revision in this slice).

This design document captures the design decisions made during brainstorming and the implementation contract for SP4. It is binding: SP4 ships exactly what is described here. Anything not described here is out of scope for SP4.

## Section 1 — Scope & non-goals

### In scope (SP4)

**Schemas (`packages/schemas/src/pcd-identity.ts`):**
- New `PcdRoutingDecisionReasonSchema` (Zod) defining the structured shape of the routing decision reason JSON.
- New `PcdSp4IdentitySnapshotInputSchema` defining the writer's input shape (where the three new fields are required, non-nullable). The writer accepts `PcdSp4IdentitySnapshotInputSchema`-shaped input only.
- Extended `PcdIdentitySnapshotSchema` with three new **nullable** fields: `shotSpecVersion`, `routerVersion`, `routingDecisionReason`. Nullable so the schema parses both pre-SP4 rows (NULL) and SP4-and-later rows (non-NULL).

**Migration (`packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql`):**
- One Prisma migration adding three nullable columns to `PcdIdentitySnapshot`: `shotSpecVersion TEXT`, `routerVersion TEXT`, `routingDecisionReason JSONB`. No defaults. Migration SQL has a comment explaining historical-compatibility nullability.

**Module files (`packages/creative-pipeline/src/pcd/`):**
- `provider-capability-matrix.ts` — declarative `PCD_PROVIDER_CAPABILITY_MATRIX` table + `PCD_PROVIDER_CAPABILITY_VERSION` const + `PcdProviderCapability` type. No logic.
- `tier3-routing-rules.ts` — predicate functions for the three Tier 3 rules + `assertTier3RoutingDecisionCompliant` + `Tier3RoutingViolationError` + `CampaignTakeStore` contract. Used by both router and writer.
- `provider-router.ts` — `routePcdShot(input, stores)` + `PCD_PROVIDER_ROUTER_VERSION` const + decision-shape types. Calls `decidePcdGenerationAccess` (SP2), looks up matrix, applies Tier 3 predicates, returns `PcdRoutingDecision`.
- `pcd-identity-snapshot-writer.ts` — `writePcdIdentitySnapshot(input, stores)`. Pins four version constants (three from imports, one from input), calls `assertTier3RoutingDecisionCompliant` against the input, persists via injected `PcdIdentitySnapshotStore`.
- Co-located `*.test.ts` for each module.

**SP3 resolver contract revision (additive):**
- `ResolvedPcdContext` (in `packages/creative-pipeline/src/pcd/registry-resolver.ts`) gains two stamped component-tier fields: `productTierAtResolution: IdentityTier`, `creatorTierAtResolution: IdentityTier`. The idempotency guard widens from 5 → 7 fields (both stamped tiers must be present and in `1|2|3`). The no-op path performs **zero** store calls and returns the resolved context entirely from the job row (restoring SP3's original "zero store calls on no-op" invariant).
- A malformed-resolved-job runtime guard throws `InvariantViolationError` if the resolved-core fields (IDs, `effectiveTier`, `allowedOutputTier`, `shotSpecVersion`) are present at current versions but `productTierAtResolution` or `creatorTierAtResolution` is NULL/invalid. The resolver does NOT fall back to registry reads in that case — silent fallback would reintroduce dual-authority routing.

**`CreativeJob` schema extension (binding):**
- One additive Prisma migration adds two nullable columns to `CreativeJob`: `productTierAtResolution INTEGER`, `creatorTierAtResolution INTEGER`. No rename of existing `effectiveTier` / `allowedOutputTier` columns. Nullable for historical compatibility; SP4-and-later resolutions always populate. Backfill stays conservative at Tier 1 (matches SP1 backfill semantic — see store widening below).

**Store widening (`packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`):**
- `CreatePcdIdentitySnapshotInput` widened with the three new nullable fields. The existing `create()` method's `data: input` spread already passes them through; no method-body change.

**Re-exports (`packages/creative-pipeline/src/index.ts`):**
- All four new public functions/constants/types added.

**Switchboard merge-back doc (`docs/SWITCHBOARD-CONTEXT.md`):**
- One line under SP4's section reserving `CampaignTakeStore` ownership for SP6 ApprovalLifecycle/campaign-take at merge-back.

### Out of scope (do not touch in SP4)

- `apps/api` wiring (does not exist in this repo; concrete store implementations land at merge-back).
- `decidePcdGenerationAccess` body changes (SP2; SP4 calls it, does not modify it).
- New `CreativeJob` schema fields (rejected during brainstorming — registry owns tier truth).
- New provider integrations (no Sora/Veo/Runway/Kling/HeyGen client work).
- Retry / fallback / circuit-breaker orchestration.
- UI / dashboard / chat integration.
- Performance optimizations.
- Async-job refactor; Inngest functions.
- QC scoring (SP5).
- Approval / Meta draft / consent revocation behavior (SP6).
- Backfill of legacy `PcdIdentitySnapshot` rows; null-→non-null follow-up migration.
- Identity adapter (Path 1) routing preference logic; adapter slot stays untouched.
- `registry-backfill.ts` / `tier-policy.ts` body modifications.
- `registry-resolver.ts` body changes beyond the additive contract revision listed above.
- Any concrete production implementer of `CampaignTakeStore`. Only test fakes ship in-tree; production implementer reserved for SP6 / merge-back.

### Layer rules (binding)

- All four new `creative-pipeline/src/pcd/*.ts` modules are pure orchestration.
- **Allowed imports:** `@creativeagent/schemas`, sibling files in `./pcd/`.
- **Forbidden imports** (forbidden-imports test in every new test file): `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `from "http"`, `from "https"`. The writer test file additionally forbids `./shot-spec-version.js`.
- Schema changes happen in `@creativeagent/schemas` (`pcd-identity.ts`).
- The Prisma migration plus the narrow snapshot-store input-type widening are the only edits inside `packages/db/`.
- Capability matrix is data, not logic. Router contains zero hardcoded provider names in conditionals — selection is matrix lookup keyed by `(shotType, effectiveTier, outputIntent)` filtered through Tier 3 predicates.

### Merge-back ownership note

SP4 owns the Tier 3 routing predicate and the injected `CampaignTakeStore` contract. SP4 does **not** own the production `CampaignTakeStore` implementation. The production implementation should be provided at merge-back through Switchboard's campaign / take / approval surface. Long-term ownership belongs under SP6 ApprovalLifecycle / campaign-take persistence, not `creative-pipeline` orchestration. Only the test fake exists in-tree.

`docs/SWITCHBOARD-CONTEXT.md` is updated with one line under SP4's section: "CampaignTakeStore is an SP4-declared orchestration dependency; production implementation is reserved for SP6 ApprovalLifecycle/campaign-take ownership at merge-back."

## Section 2 — File layout & exports

### `packages/schemas/src/pcd-identity.ts` (extended)

New exports:

```ts
export const PcdRoutingDecisionReasonSchema = z.object({
  capabilityRefIndex: z.number().int().nonnegative(),
  matchedShotType: PcdShotTypeSchema,
  matchedEffectiveTier: IdentityTierSchema,        // explicitly the effectiveTier
  matchedOutputIntent: OutputIntentSchema,
  tier3RulesApplied: z.array(
    z.enum(["first_last_frame_anchor", "performance_transfer", "edit_over_regenerate"]),
  ),
  candidatesEvaluated: z.number().int().nonnegative(),
  candidatesAfterTier3Filter: z.number().int().nonnegative(),
  selectionRationale: z.string().max(200),
});
export type PcdRoutingDecisionReason = z.infer<typeof PcdRoutingDecisionReasonSchema>;
```

Modified `PcdIdentitySnapshotSchema` — three new nullable fields appended:

```ts
shotSpecVersion: z.string().nullable(),
routerVersion: z.string().nullable(),
routingDecisionReason: PcdRoutingDecisionReasonSchema.nullable(),
```

New writer-input schema (separate, narrower):

```ts
export const PcdSp4IdentitySnapshotInputSchema = z.object({
  // Identity-side (required)
  assetRecordId: z.string(),
  productIdentityId: z.string(),
  productTierAtGeneration: IdentityTierSchema,
  productImageAssetIds: z.array(z.string()),
  productCanonicalTextHash: z.string(),
  productLogoAssetId: z.string().nullable(),
  creatorIdentityId: z.string(),
  avatarTierAtGeneration: IdentityTierSchema,
  avatarReferenceAssetIds: z.array(z.string()),
  voiceAssetId: z.string().nullable(),
  consentRecordId: z.string().nullable(),

  // Provider-side (filled from provider response)
  selectedProvider: z.string(),
  providerModelSnapshot: z.string(),
  seedOrNoSeed: z.string(),
  rewrittenPromptText: z.string().nullable(),

  // SP4-required forensic fields (REQUIRED for new writes)
  shotSpecVersion: z.string(),
  routerVersion: z.string(),
  routingDecisionReason: PcdRoutingDecisionReasonSchema,

  // Note: policyVersion + providerCapabilityVersion are pinned by the writer
  // from imports; not in this input. Caller cannot override.
});
export type PcdSp4IdentitySnapshotInput = z.infer<typeof PcdSp4IdentitySnapshotInputSchema>;
```

### `packages/db/prisma/schema.prisma` (PcdIdentitySnapshot model — three new fields)

```prisma
model PcdIdentitySnapshot {
  // ... existing fields unchanged ...

  // SP4 additions (nullable for historical compatibility)
  shotSpecVersion         String?
  routerVersion           String?
  routingDecisionReason   Json?

  // ... indexes unchanged; no new index on these ...
}
```

### `packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql`

```sql
-- SP4: add forensic version-pinning columns to PcdIdentitySnapshot.
-- Columns are nullable for historical compatibility (pre-SP4 / merge-back-time
-- Switchboard rows that predate this slice). SP4 writer treats them as
-- mandatory for any newly written snapshot. A future cleanup migration may
-- flip to NOT NULL once legacy rows are backfilled or archived.

ALTER TABLE "PcdIdentitySnapshot"
  ADD COLUMN "shotSpecVersion"        TEXT,
  ADD COLUMN "routerVersion"          TEXT,
  ADD COLUMN "routingDecisionReason"  JSONB;
```

### `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (narrow widening)

```ts
export interface CreatePcdIdentitySnapshotInput {
  // ... existing fields unchanged ...
  shotSpecVersion: string | null;
  routerVersion: string | null;
  routingDecisionReason: PcdRoutingDecisionReason | null;
}
```

The existing `create()` method's `data: input` spread already passes the new fields through to Prisma. No method-body change.

### `packages/creative-pipeline/src/pcd/registry-resolver.ts` (additive contract revision)

`ResolvedPcdContext` gains two **stamped** component-tier fields. All four tier-related fields are at-resolution stamps, written once at full-attach time and read directly from the job row on the no-op path:

```ts
export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  productTierAtResolution: IdentityTier;        // SP4 addition (stamped)
  creatorTierAtResolution: IdentityTier;        // SP4 addition (stamped)
  effectiveTier: IdentityTier;                  // existing; semantically: at-resolution stamp
  allowedOutputTier: IdentityTier;              // existing; semantically: at-resolution stamp
  shotSpecVersion: string;
};
```

Naming asymmetry is intentional: the `effectiveTier` / `allowedOutputTier` columns shipped in SP1 (migration `20260428065707_pcd_registry_sp1`) and renaming them now would force a column-rename migration that complicates merge-back into Switchboard. Inline comments and the design doc declare all four fields as at-resolution stamps.

`PcdResolvableJob` (resolver input) widens with two new optional fields the resolver reads from the job row: `productTierAtResolution?: IdentityTier | null`, `creatorTierAtResolution?: IdentityTier | null`.

`isResolvedPcdJob` widens from 5 → 7 fields. Both new fields must be present and in `1|2|3` for the no-op path to fire.

**Full-attach path**: computes both new fields from the registry reads it already does (`product.qualityTier` → `mapProductQualityTierToIdentityTier`, `creator.qualityTier` → `mapCreatorQualityTierToIdentityTier`), stamps them via `attachIdentityRefs`, returns them on the context. No new store reads beyond what the path already had.

**No-op path** (zero store calls, restoring SP3's original invariant):

```ts
if (isResolvedPcdJob(job)) {
  // No-op: every field is read from the job row (zero store calls).
  // Stamped at-resolution tier world is authoritative; current registry
  // state is not consulted here.
  return {
    productIdentityId: job.productIdentityId,
    creatorIdentityId: job.creatorIdentityId,
    productTierAtResolution: job.productTierAtResolution,
    creatorTierAtResolution: job.creatorTierAtResolution,
    effectiveTier: job.effectiveTier,
    allowedOutputTier: job.allowedOutputTier,
    shotSpecVersion: job.shotSpecVersion,
  };
}
```

**Malformed-resolved-job invariant guard**: if the 5-field core (IDs + `effectiveTier` + `allowedOutputTier` + `shotSpecVersion`) is present at current `PCD_SHOT_SPEC_VERSION` but `productTierAtResolution` or `creatorTierAtResolution` is NULL or outside `1|2|3`, the resolver throws `InvariantViolationError` naming the job ID. It does NOT fall back to registry reads. Silent fallback would silently reintroduce the dual-authority bug this slice exists to fix. The case is unreachable inside corrected SP4 (every SP4-resolution stamps both fields); the guard catches any future regression that forgets to stamp.

Rationale for adding `productTierAtResolution` / `creatorTierAtResolution` columns to `CreativeJob` (revising the prior decision): SP4's snapshot is supposed to be self-explanatory. Mixing stamped and current tier state across the same routing decision means a future investigator can't reconstruct "why was this provider chosen?" without joining mutable registry state. Stamping at resolution time makes the snapshot self-interpreting AND restores SP3's original "zero store calls on no-op" idempotency invariant.

### `packages/creative-pipeline/src/pcd/provider-capability-matrix.ts` (new)

```ts
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_PROVIDER_CAPABILITY_VERSION = "provider-capability@1.0.0";

export type PcdProviderCapability = {
  provider: string;
  tiers: ReadonlyArray<IdentityTier>;
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  supportsFirstLastFrame: boolean;
  supportsEditExtend: boolean;
  supportsPerformanceTransfer: boolean;
};

export const PCD_PROVIDER_CAPABILITY_MATRIX: ReadonlyArray<PcdProviderCapability> = [
  // Declarative rows. Author such that the matrix coverage tests in
  // provider-capability-matrix.test.ts pass against SP2's allowed-set.
  // Order is policy: routePcdShot picks first-match.
] as const;
```

Pure data + version const + type. No functions.

### `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts` (new)

```ts
import type {
  IdentityTier, OutputIntent, PcdShotType,
} from "@creativeagent/schemas";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";

export type CampaignTakeStore = {
  hasApprovedTier3TakeForCampaign(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<boolean>;
};

export type Tier3RoutingRuleStores = {
  campaignTakeStore: CampaignTakeStore;
};

export class Tier3RoutingViolationError extends Error {
  constructor(public readonly rule: "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate", public readonly provider: string) {
    super(`Tier 3 routing rule violated: ${rule} required but provider "${provider}" does not support it`);
    this.name = "Tier3RoutingViolationError";
  }
}

export class Tier3RoutingMetadataMismatchError extends Error {
  constructor(
    public readonly expected: ReadonlyArray<"first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate">,
    public readonly actual:   ReadonlyArray<"first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate">,
  ) {
    super(`Tier 3 routing metadata mismatch: expected rules [${expected.join(",")}] but routingDecisionReason.tier3RulesApplied was [${actual.join(",")}]`);
    this.name = "Tier3RoutingMetadataMismatchError";
  }
}

export function requiresFirstLastFrameAnchor(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
}): boolean;

export function requiresPerformanceTransfer(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
}): boolean;

export async function requiresEditOverRegenerate(
  input: {
    effectiveTier: IdentityTier;
    organizationId: string;
    campaignId: string;
  },
  stores: Tier3RoutingRuleStores,
): Promise<boolean>;

// Enforcement is derived from authoritative sources, not from forensic
// metadata. The function recomputes rule 1 / rule 2 from pure predicates
// and consumes the explicit editOverRegenerateRequired boolean for rule 3.
// tier3RulesApplied (forensic metadata from the routing decision) is
// validated for *consistency* but is never the enforcement input.
//
// Throws Tier3RoutingViolationError if any required rule's support flag is
// missing on selectedCapability. Throws Tier3RoutingMetadataMismatchError
// if tier3RulesApplied does not exactly equal the recomputed required-rule
// set.
export function assertTier3RoutingDecisionCompliant(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  tier3RulesApplied: ReadonlyArray<
    "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate"
  >;
  editOverRegenerateRequired: boolean;
}): void;
```

The async/sync split: rule 3 is the only rule needing I/O. The router calls `requiresEditOverRegenerate` once before matrix filtering, stamps the result onto the routing decision as `editOverRegenerateRequired`, and lists the rule in `tier3RulesApplied` only if it fired. The writer never re-queries the store.

**Enforcement vs. forensic separation (binding):**

- `assertTier3RoutingDecisionCompliant` derives the **required-rule set** from authoritative sources, not from `tier3RulesApplied`:
  - Rule 1 required ↔ `requiresFirstLastFrameAnchor({effectiveTier, shotType, outputIntent})` returns true (pure recompute).
  - Rule 2 required ↔ `requiresPerformanceTransfer({effectiveTier, shotType})` returns true (pure recompute).
  - Rule 3 required ↔ `editOverRegenerateRequired === true` (explicit boolean from input).
- For each required rule, assert `selectedCapability` has the matching support flag; throw `Tier3RoutingViolationError` on miss.
- Then assert `tier3RulesApplied` (forensic) **exactly equals** the recomputed required-rule set (set equality, order-independent); throw `Tier3RoutingMetadataMismatchError` on divergence.
- This closes the bypass where a caller passes `editOverRegenerateRequired: true, tier3RulesApplied: [], supportsEditExtend: false`: the recompute path identifies rule 3 as required, finds the capability missing the flag, and throws.

### `packages/creative-pipeline/src/pcd/provider-router.ts` (new)

```ts
import type {
  OutputIntent, PcdShotType, PcdTierDecision,
} from "@creativeagent/schemas";
import type { ResolvedPcdContext } from "./registry-resolver.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX, PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import {
  requiresFirstLastFrameAnchor, requiresPerformanceTransfer,
  requiresEditOverRegenerate, type CampaignTakeStore,
} from "./tier3-routing-rules.js";

export const PCD_PROVIDER_ROUTER_VERSION = "provider-router@1.0.0";

export type ProviderRouterStores = {
  campaignTakeStore: CampaignTakeStore;
};

// Approved campaign context — explicit union so non-campaign generation
// paths (drafts, internal previews, future test harnesses) do not need to
// fabricate a fake campaignId. Rule 3 (edit-over-regenerate) only activates
// under { kind: "campaign" }; the "none" branch short-circuits rule 3 to
// false without consulting campaignTakeStore.
export type ApprovedCampaignContext =
  | { kind: "campaign"; organizationId: string; campaignId: string }
  | { kind: "none" };

export type RoutePcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export type PcdRoutingDecision =
  | {
      allowed: false;
      denialKind: "ACCESS_POLICY";
      accessDecision: PcdTierDecision;
    }
  | {
      allowed: false;
      denialKind: "NO_PROVIDER_CAPABILITY";
      accessDecision: PcdTierDecision;             // unmutated; .allowed === true
      reason: "no provider satisfies tier3 routing rules for this shot";
      requiredActions: ReadonlyArray<"choose_safer_shot_type">;
      candidatesEvaluated: number;
      candidatesAfterTier3Filter: number;          // always 0 in this branch; tested, not literal-typed
    }
  | {
      allowed: true;
      accessDecision: PcdTierDecision;
      selectedCapability: PcdProviderCapability;
      selectedProvider: string;
      providerCapabilityVersion: typeof PCD_PROVIDER_CAPABILITY_VERSION;
      routerVersion: typeof PCD_PROVIDER_ROUTER_VERSION;
      decisionReason: PcdRoutingDecisionReason;
    };

export async function routePcdShot(
  input: RoutePcdShotInput,
  stores: ProviderRouterStores,
): Promise<PcdRoutingDecision>;
```

### `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts` (new)

```ts
import type {
  IdentityTier, OutputIntent, PcdIdentitySnapshot, PcdShotType,
  PcdSp4IdentitySnapshotInput,
} from "@creativeagent/schemas";
import { PcdSp4IdentitySnapshotInputSchema } from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "./tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION, type PcdProviderCapability } from "./provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "./provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "./tier3-routing-rules.js";

// Note: no import of PCD_SHOT_SPEC_VERSION — the writer must NOT re-pin the
// current shot-spec version. shotSpecVersion is carried through from input
// (SP3-stamped on the job).

export type PcdIdentitySnapshotStore = {
  createForShot(input: {
    // ... CreatePcdIdentitySnapshotInput shape, including the SP4 widening ...
  }): Promise<PcdIdentitySnapshot>;
};

export type WritePcdIdentitySnapshotInput = PcdSp4IdentitySnapshotInput & {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  editOverRegenerateRequired: boolean;
};

export type PcdIdentitySnapshotWriterStores = {
  pcdIdentitySnapshotStore: PcdIdentitySnapshotStore;
};

export async function writePcdIdentitySnapshot(
  input: WritePcdIdentitySnapshotInput,
  stores: PcdIdentitySnapshotWriterStores,
): Promise<PcdIdentitySnapshot>;
```

### `packages/creative-pipeline/src/index.ts` (re-exports added)

```ts
// SP4: provider routing + identity snapshot writer
export {
  PCD_PROVIDER_CAPABILITY_VERSION,
  PCD_PROVIDER_CAPABILITY_MATRIX,
  type PcdProviderCapability,
} from "./pcd/provider-capability-matrix.js";

export {
  PCD_PROVIDER_ROUTER_VERSION,
  routePcdShot,
  type RoutePcdShotInput,
  type PcdRoutingDecision,
  type ProviderRouterStores,
} from "./pcd/provider-router.js";

export {
  writePcdIdentitySnapshot,
  type WritePcdIdentitySnapshotInput,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotWriterStores,
} from "./pcd/pcd-identity-snapshot-writer.js";

export {
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  requiresEditOverRegenerate,
  assertTier3RoutingDecisionCompliant,
  Tier3RoutingViolationError,
  Tier3RoutingMetadataMismatchError,
  type CampaignTakeStore,
  type Tier3RoutingRuleStores,
} from "./pcd/tier3-routing-rules.js";

export type {
  ApprovedCampaignContext,
} from "./pcd/provider-router.js";
```

## Section 3 — Decision logic & invariants

### `routePcdShot` algorithm

```
Input: { resolvedContext, shotType, outputIntent, organizationId, campaignId }
Stores: { campaignTakeStore }

Step 1 — Tier policy gate (stamped tier world).
  accessDecision = decidePcdGenerationAccess({
    avatarTier:  resolvedContext.creatorTierAtResolution,
    productTier: resolvedContext.productTierAtResolution,
    shotType,
    outputIntent,
  })
  if (!accessDecision.allowed) {
    return { allowed: false, denialKind: "ACCESS_POLICY", accessDecision }
  }

Step 2 — Matrix candidate set.
  candidates = PCD_PROVIDER_CAPABILITY_MATRIX.filter(c =>
    c.tiers.includes(resolvedContext.effectiveTier)
    && c.shotTypes.includes(shotType)
    && c.outputIntents.includes(outputIntent)
  )
  candidatesEvaluated = candidates.length

Step 3 — Tier 3 rule application (only when effectiveTier === 3).
  tier3RulesApplied = []
  editOverRegenerateRequired = false                       // default for { kind: "none" }
  if (resolvedContext.effectiveTier === 3) {
    if (requiresFirstLastFrameAnchor({ effectiveTier, shotType, outputIntent })) {
      candidates = candidates.filter(c => c.supportsFirstLastFrame)
      tier3RulesApplied.push("first_last_frame_anchor")
    }
    if (requiresPerformanceTransfer({ effectiveTier, shotType })) {
      candidates = candidates.filter(c => c.supportsPerformanceTransfer)
      tier3RulesApplied.push("performance_transfer")
    }
    // Rule 3 only consults campaignTakeStore under { kind: "campaign" }.
    // Under { kind: "none" }, rule 3 short-circuits to false; no store call.
    if (approvedCampaignContext.kind === "campaign") {
      editOverRegenerateRequired = await requiresEditOverRegenerate(
        {
          effectiveTier,
          organizationId: approvedCampaignContext.organizationId,
          campaignId: approvedCampaignContext.campaignId,
        },
        stores,
      )
      if (editOverRegenerateRequired) {
        candidates = candidates.filter(c => c.supportsEditExtend)
        tier3RulesApplied.push("edit_over_regenerate")
      }
    }
  }
  candidatesAfterTier3Filter = candidates.length

Step 4 — Selection or empty-candidates denial.
  if (candidates.length === 0) {
    return {
      allowed: false,
      denialKind: "NO_PROVIDER_CAPABILITY",
      accessDecision,                           // unmutated
      reason: "no provider satisfies tier3 routing rules for this shot",
      requiredActions: ["choose_safer_shot_type"],
      candidatesEvaluated,
      candidatesAfterTier3Filter: 0,
    }
  }
  selected = candidates[0]                      // first-match deterministic order; matrix order is policy

Step 5 — Build decision.
  return {
    allowed: true,
    accessDecision,
    selectedCapability: selected,
    selectedProvider: selected.provider,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    decisionReason: {
      capabilityRefIndex: PCD_PROVIDER_CAPABILITY_MATRIX.indexOf(selected),
      matchedShotType: shotType,
      matchedEffectiveTier: resolvedContext.effectiveTier,
      matchedOutputIntent: outputIntent,
      tier3RulesApplied,
      candidatesEvaluated,
      candidatesAfterTier3Filter,
      selectionRationale: buildRationale(...),  // pure helper, deterministic short string
    },
  }
```

**Invariants:**

| Property | Guarantee |
|---|---|
| **Purity / I/O surface** | All I/O via injected `stores` (only `campaignTakeStore` for rule 3). No DB, no network, no time, no randomness. |
| **Determinism** | Same `(resolvedContext, shotType, outputIntent, campaignTakeStore-result)` → identical decision. Matrix iteration order is policy. |
| **No hardcoded provider names** | Router code references `selected.provider`, never string literals. Source-grep test enforces. |
| **No bypass** | Step 1's `decidePcdGenerationAccess` is unconditional. Step 4's empty-candidates branch is unconditional. |
| **Tier 3 closure** | All three rules applied for `effectiveTier === 3`. Rules 1 and 2 are pure recomputes. Rule 3 reads `campaignTakeStore` exactly once and only under `approvedCampaignContext.kind === "campaign"`. |
| **Campaign context boundary** | Under `kind: "none"`, rule 3 does not fire and `campaignTakeStore` is not consulted. Non-campaign generation paths do not need to fabricate a `campaignId`. |
| **Tier authority — single stamped world** | Every tier consulted by the router (`creatorTierAtResolution`, `productTierAtResolution`, `effectiveTier`) comes from the resolved-at-resolution stamp on the job row. The router never reads current registry `qualityTier` for any decision. Re-tiering a registry row after a job has been resolved does NOT change that job's routing. The pre-amend `productTier` / `creatorTier` (current-state) fields are removed from `ResolvedPcdContext` so a routing call site cannot accidentally read them. |
| **Distinguished denial** | Two denial kinds — `ACCESS_POLICY` (SP2 refused) and `NO_PROVIDER_CAPABILITY` (SP2 allowed but no provider survives Tier 3 filter). `accessDecision` unmutated in the second case. |

### `writePcdIdentitySnapshot` algorithm

```
Input: WritePcdIdentitySnapshotInput  (PcdSp4IdentitySnapshotInput plus Tier 3 fields)
Stores: { pcdIdentitySnapshotStore }

Step 1 — Validate input shape.
  PcdSp4IdentitySnapshotInputSchema.parse(input)   // throws ZodError on bad input

Step 2 — Tier 3 second line of defense.
  if (input.effectiveTier === 3) {
    assertTier3RoutingDecisionCompliant({
      effectiveTier:               input.effectiveTier,
      shotType:                    input.shotType,
      outputIntent:                input.outputIntent,
      selectedCapability:          input.selectedCapability,
      tier3RulesApplied:           input.routingDecisionReason.tier3RulesApplied,
      editOverRegenerateRequired:  input.editOverRegenerateRequired,
    })
    // Throws Tier3RoutingViolationError when selectedCapability lacks a flag
    // for a recomputed-required rule.
    // Throws Tier3RoutingMetadataMismatchError when tier3RulesApplied
    // (forensic) does not exactly equal the recomputed required-rule set.
    // Required-rule recompute uses pure predicates (rules 1, 2) plus the
    // explicit editOverRegenerateRequired boolean (rule 3). It does NOT
    // read tier3RulesApplied as enforcement input.
  }

Step 3 — Pin version constants from imports (NOT from input).
  payload = {
    ...persistableInputFields(input),
    policyVersion:             PCD_TIER_POLICY_VERSION,            // import-pinned
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,    // import-pinned
    routerVersion:             PCD_PROVIDER_ROUTER_VERSION,        // import-pinned
    shotSpecVersion:           input.shotSpecVersion,              // SP3-stamped, carried forward
  }

Step 4 — Persist.
  return stores.pcdIdentitySnapshotStore.createForShot(payload)
```

**Invariants:**

| Property | Guarantee |
|---|---|
| **Tier 3 governance** | Writer rejects `effectiveTier === 3` writes that violate the recomputed rule predicates. Two lines of defense (router + writer) using the same predicate module. |
| **Forensic-vs-enforcement separation** | Writer derives required-rule set from pure recomputes + explicit `editOverRegenerateRequired` boolean. `tier3RulesApplied` is validated for exact-match consistency (set equality) but never used as enforcement input. Caller cannot suppress a violation by lying in `tier3RulesApplied`. |
| **Version pinning — three from imports** | `policyVersion`, `providerCapabilityVersion`, `routerVersion` come from imports; caller cannot override. |
| **Version pinning — one from input** | `shotSpecVersion` comes from input (SP3-stamped value carried forward). The writer must not re-import `PCD_SHOT_SPEC_VERSION` — re-importing would forensically misrepresent the spec version the job was actually planned under. Forbidden-imports test enforces. |
| **Input validation** | Zod parse rejects malformed input deterministically. |
| **Idempotency boundary** | Owned by the store (`createForShot` semantics; one snapshot per shot enforced store-side). Writer makes a single store call per invocation; retries are caller's concern. |

### Error semantics

| Failure | Where | Behavior |
|---|---|---|
| Bad input shape | Writer Step 1 | `ZodError` propagates. |
| Tier 3 capability violation | Writer Step 2 | `Tier3RoutingViolationError` (from `tier3-routing-rules.ts`) propagates — selectedCapability missing a recomputed-required support flag. |
| Tier 3 metadata mismatch | Writer Step 2 | `Tier3RoutingMetadataMismatchError` propagates — `tier3RulesApplied` does not equal the recomputed required-rule set. |
| Empty matrix candidates after Tier 3 filter | Router Step 4 | Return `{ allowed: false, denialKind: "NO_PROVIDER_CAPABILITY", accessDecision }` with `accessDecision` unmutated; **does not throw**. Distinguished from `ACCESS_POLICY` denial. |
| Tier-policy denial | Router Step 1 | Return `{ allowed: false, denialKind: "ACCESS_POLICY", accessDecision }`. Caller does not call provider; does not call writer. |
| `campaignTakeStore` throws | Router Step 3 | Propagates. Treat as transient infrastructure error — caller's retry policy. |
| `pcdIdentitySnapshotStore.createForShot` throws | Writer Step 4 | Propagates. Caller's retry policy decides. |

## Section 4 — Test plan

Vitest, in-memory fakes, no DB, no network. Co-located tests for every new module.

### `provider-capability-matrix.test.ts`

- **Constant pinning:** `expect(PCD_PROVIDER_CAPABILITY_VERSION).toBe("provider-capability@1.0.0")`. Locks the value snapshots will pin.
- **Matrix shape:** every row passes a per-row Zod parse.
- **Matrix coverage (against SP2's allowed-set):** for every `(IdentityTier, PcdShotType, OutputIntent)` triple where `decidePcdGenerationAccess` returns `allowed: true`, assert at least one matrix row matches `(tiers ∋ T, shotTypes ∋ S, outputIntents ∋ O)`. Test imports `decidePcdGenerationAccess` (upstream contract — allowed). Test does NOT import any logic from `provider-capability-matrix.ts` other than the matrix data.
- **Tier 3 capability sufficiency (rule combinations, not per-rule):** for every `(shotType, outputIntent)` allowed at Tier 3 by SP2's policy, assert capability availability for **the union of required rule predicates** on a single matrix row:
  - Non-talking-head Tier 3 video shot: at least one row with `tiers ∋ 3, shotTypes ∋ S, outputIntents ∋ O, supportsFirstLastFrame === true`.
  - Tier 3 talking-head: at least one row with `supportsFirstLastFrame === true AND supportsPerformanceTransfer === true` on the same row.
  - Tier 3 video shot with rule 3 active: at least one row with `supportsFirstLastFrame === true AND supportsEditExtend === true` on the same row. For Tier 3 talking-head with rule 3 active: `supportsFirstLastFrame === true AND supportsPerformanceTransfer === true AND supportsEditExtend === true` on the same row.
- **No string-literal hardcoded providers in test source.**
- **Forbidden-imports check.**

### `tier3-routing-rules.test.ts`

- **`requiresFirstLastFrameAnchor` truth table** over `(effectiveTier ∈ {1,2,3}, shotType ∈ all 9 values, outputIntent ∈ all 4 values)`. Hand-listed expected truth set in the test file — NOT imported from `tier3-routing-rules.ts` — to prevent the "test imports same wrong table" failure mode.
- **`requiresPerformanceTransfer` truth table** over `(effectiveTier, shotType)`. `true` only for `(effectiveTier === 3, shotType === "talking_head")`.
- **`requiresEditOverRegenerate` (async):** stub `campaignTakeStore` returns `true`/`false`; assert predicate honors store result only when `effectiveTier === 3`. At Tier 1/2 the predicate short-circuits; store is not consulted.
- **`assertTier3RoutingDecisionCompliant` — capability checks:**
  - Tier 1/2 input → returns void.
  - Tier 3 + each rule recomputed-required + capability supports it + `tier3RulesApplied` matches recompute → returns void.
  - Tier 3 + each rule recomputed-required + capability missing the support flag → throws `Tier3RoutingViolationError` (matrix of three rules).
- **`assertTier3RoutingDecisionCompliant` — forensic-vs-enforcement separation (the bypass closure):**
  - Tier 3 + `editOverRegenerateRequired: true` + `tier3RulesApplied: []` (caller lies) + `supportsEditExtend: false` → throws `Tier3RoutingViolationError` (recompute identifies rule 3, finds support missing). Bypass via metadata-suppression is closed.
  - Tier 3 + rule 1 recomputed-required + `tier3RulesApplied: []` + capability supports rule 1 → throws `Tier3RoutingMetadataMismatchError` (capability is fine but forensic record is wrong).
  - Tier 3 + rule 1 NOT recomputed-required + `tier3RulesApplied: ["first_last_frame_anchor"]` → throws `Tier3RoutingMetadataMismatchError` (forensic claims a rule fired that was not required).
  - `tier3RulesApplied` order-independence: `["first_last_frame_anchor", "performance_transfer"]` and `["performance_transfer", "first_last_frame_anchor"]` are both accepted when both rules are required.
- **`Tier3RoutingViolationError` shape:** `name === "Tier3RoutingViolationError"`; `rule` and `provider` fields populated; `message` includes both.
- **`Tier3RoutingMetadataMismatchError` shape:** `name === "Tier3RoutingMetadataMismatchError"`; `expected` and `actual` rule-set fields populated.
- **Forbidden-imports check.**

### `provider-router.test.ts`

In-memory `campaignTakeStore` fake. No real matrix mutation; tests use the live `PCD_PROVIDER_CAPABILITY_MATRIX` import except in Part C and Part F, which use `vi.doMock`.

**Part A — Step 1 access-policy gate (stamped tier world).**
1. Tier-1 + non-restricted shot + `outputIntent: "final_export"` → `{ allowed: false, denialKind: "ACCESS_POLICY" }`. `accessDecision.allowed === false`.
2. Tier-1 + `outputIntent: "draft"` → `{ allowed: true, … }` (assuming matrix has a Tier-1 draft provider).
3. **Stamped component-tier passthrough:** resolver supplies `(productTierAtResolution=3, creatorTierAtResolution=1)`; assert router passes `(avatarTier=1, productTier=3)` to `decidePcdGenerationAccess`. SP2's denial reflects the asymmetric stamped state.

**Part B — Step 2/3 matrix filter.**
4. Tier-2 + `simple_ugc` + `final_export` + `approvedCampaignContext: { kind: "none" }` → first matching row selected.
5. Tier-3 + `face_closeup` + `final_export` + `{ kind: "none" }` → only rows with `supportsFirstLastFrame === true` survive (rule 1). `campaignTakeStore` not consulted.
6. Tier-3 + `talking_head` + `preview` + `{ kind: "none" }` → only rows with `supportsPerformanceTransfer === true` survive (rule 2). `campaignTakeStore` not consulted.
7. Tier-3 + `simple_ugc` + `final_export` + `{ kind: "campaign", … }`, `campaignTakeStore → true` → only rows with `supportsEditExtend === true` survive (rule 3). Asserts `campaignTakeStore.hasApprovedTier3TakeForCampaign` called exactly once.
8. Tier-3 + `simple_ugc` + `final_export` + `{ kind: "campaign", … }`, `campaignTakeStore → false` → rule 3 not applied; rule 1 still applies.
8a. Tier-3 + `simple_ugc` + `final_export` + `{ kind: "none" }` → rule 3 not applied; `campaignTakeStore` never called (asserted via fake recorder); rule 1 still applies.

**Part C — Step 4 empty candidates.** Wrapped in `describe`/`beforeEach`/`afterEach` calling `vi.resetModules()` and `vi.restoreAllMocks()`.
9. `vi.doMock("./provider-capability-matrix.js", …)` to provide a synthetic matrix where the rule-1-required Tier 3 face_closeup rows do not have `supportsFirstLastFrame`. Assert `{ allowed: false, denialKind: "NO_PROVIDER_CAPABILITY", accessDecision.allowed: true, candidatesAfterTier3Filter: 0 }`. Verifies `accessDecision` is unmutated (tier policy *did* allow the shot).

**Part D — Decision reason shape.**
10. Allowed Tier-2 case: `decisionReason.tier3RulesApplied === []`; `decisionReason.candidatesEvaluated >= 1`; `decisionReason.matchedEffectiveTier === 2`; `decisionReason.capabilityRefIndex` indexes back to the selected row in the live matrix.
11. Allowed Tier-3 case: `tier3RulesApplied` contains exactly the rules the test setup triggered.
12. `selectionRationale` is a non-empty string ≤200 chars.

**Part E — Determinism.**
13. Two consecutive calls with identical inputs and identical store responses → deep-equal decisions.

**Part F — First-match-is-policy.** Wrapped in module-mock isolation block.
14. `vi.doMock` with rows reordered: assert selected provider changes to match new first-match.

**Part G — End-to-end matrix sufficiency (router + matrix agree).**
For every `(shotType, outputIntent)` triple allowed at Tier 3 by SP2's policy:
15. With `approvedCampaignContext: { kind: "none" }`: `routePcdShot` returns `{ allowed: true }` (rules 1 and 2 are satisfiable on the live matrix). Asserts router and matrix agree end-to-end on rule 1/2 sufficiency.
16. With `approvedCampaignContext: { kind: "campaign", … }` and `campaignTakeStore → true`: `routePcdShot` returns `{ allowed: true }` (rule 1, optionally rule 2 for talking-head, AND rule 3 are simultaneously satisfiable on a single matrix row). Asserts the router can route every Tier-3-allowed shot under the most restrictive rule combination.
17. With `approvedCampaignContext: { kind: "campaign", … }` and `campaignTakeStore → false`: `routePcdShot` returns `{ allowed: true }` (only rules 1/2 active; rule 3 not required).

**Part H — Forbidden imports.** Same regex set plus `./shot-spec-version.js`.

### `pcd-identity-snapshot-writer.test.ts`

In-memory `pcdIdentitySnapshotStore` fake recording every `createForShot` call.

**Part A — Version pinning (the slice's heart).**
1. Caller passes input with extra `policyVersion: "tier-policy@bogus"` key (cast as `unknown`); assert `createForShot` payload's `policyVersion === PCD_TIER_POLICY_VERSION`.
2. Same for `providerCapabilityVersion`.
3. Same for `routerVersion`.
4. `shotSpecVersion` mirrors `input.shotSpecVersion` exactly. Caller-controlled (for SP3-stamped passthrough), not import-controlled.

**Part B — Tier 3 second-line-of-defense.**
5. Tier-1 input → no Tier 3 assertion call. Snapshot persists.
6. Tier-3 input with compliant `selectedCapability` and `tier3RulesApplied` matching the recompute → snapshot persists.
7. Tier-3 input with rule 1 recomputed-required + `supportsFirstLastFrame === false` → throws `Tier3RoutingViolationError`. **`createForShot` never called** — assert via fake's call recorder.
8. Same for rule 2.
9. Same for rule 3.
10. **Bypass closure (the slice's strongest test):** Tier-3 input with `editOverRegenerateRequired: true`, `tier3RulesApplied: []` (caller suppresses forensic record), `selectedCapability.supportsEditExtend: false` → throws `Tier3RoutingViolationError`. The recompute path identifies rule 3, finds capability missing the flag, throws regardless of forensic claim.
11. **Forensic mismatch:** Tier-3 input where `tier3RulesApplied` claims a rule that recompute did not require (or omits a rule recompute did require), but capability flags are otherwise consistent → throws `Tier3RoutingMetadataMismatchError`. `createForShot` never called.

**Part C — Input validation.**
12. Malformed input (missing `routingDecisionReason`) → `ZodError`. `createForShot` not called.
13. `routingDecisionReason` with bad sub-shape (`selectionRationale > 200 chars`) → `ZodError`.

**Part D — Persistence shape.**
14. Happy path: `createForShot` called exactly once with payload containing all SP4 forensic fields non-NULL. Per-field assertions.
15. Returned `PcdIdentitySnapshot` is the fake's response (writer doesn't transform).

**Part E — Forbidden imports.** Includes `./shot-spec-version.js`.

### `registry-resolver.test.ts` (additive deltas)

The original SP3 "zero store calls on no-op" idempotency test is **restored** (the pre-amend SP4 had relaxed it to "two finder calls + zero attach calls"; the amended SP4 re-asserts the original).

New `describe("SP4 additive contract deltas — stamped tier world", ...)` block:

16. Returns `productTierAtResolution` and `creatorTierAtResolution` in the full-attach path (derived from registry `qualityTier` mapping at resolution time and persisted via `attachIdentityRefs`).
17. No-op path returns the resolved context entirely from the job row — `findOrCreateForJobCalls === 0`, `findOrCreateStockForDeploymentCalls === 0`, `attachIdentityRefsCalls === 0`. (Restores the original SP3 invariant.)
18. **Malformed-resolved-job invariant:** a job carrying `effectiveTier=2`, `allowedOutputTier=2`, valid IDs, current `shotSpecVersion`, but `productTierAtResolution=null` (or invalid) → `resolvePcdRegistryContext` throws `InvariantViolationError` naming the job ID. Resolver does NOT fall back to registry reads (assert `findOrCreateForJobCalls === 0`).
19. Malformed case for missing `creatorTierAtResolution` symmetric to #18.
20. Idempotency guard widening: a job with the original 5 fields stamped but missing the two new fields is NOT considered resolved by `isResolvedPcdJob`. Tested via `resolvePcdRegistryContext` taking the full-attach path on such a job (a stale-version-shaped re-stamp).

### `provider-router.test.ts` (regression test for stamped-world authority — non-negotiable)

Added under a new `describe("regression — stamped-world authority", ...)` block:

R1. **"registry re-tiered after stamping does not change routing for an already-stamped job"** — given a fixed `ResolvedPcdContext` with `productTierAtResolution=3, creatorTierAtResolution=3, effectiveTier=3`, two consecutive `routePcdShot` calls with identical inputs return deep-equal decisions even when the test fakes for `productStore`/`creatorStore` would (if called) return different `qualityTier` values. The fakes record any call; the assertion is that they were never called. This test fails if anyone re-introduces a current-registry tier read inside the router.

R2. **"SP2 gate receives stamped component tiers, not any current value"** — spy on `decidePcdGenerationAccess`; assert `(avatarTier, productTier)` arguments equal `(creatorTierAtResolution, productTierAtResolution)` exactly.

## Section 5 — Hard guardrails for implementation

- No new provider integrations. Matrix is data only.
- No UI, no dashboard, no API route changes.
- No retry / fallback / circuit-breaker logic.
- No async-job refactor; SP4 ships zero Inngest functions.
- No QC scoring. No approval / Meta draft / consent revocation behavior.
- No backfill of legacy `PcdIdentitySnapshot` rows. No follow-up null-→non-null migration.
- No identity adapter (Path 1) routing preference logic.
- No edits to `registry-backfill.ts` body or `tier-policy.ts` body.
- No edits to `registry-resolver.ts` body except the locked SP3 deltas (stamped-tier context fields + no-op zero-store-call path + malformed-resolved invariant guard).
- Edits to `packages/db/src/stores/*`: the existing `prisma-pcd-identity-snapshot-store.ts` (snapshot store input-type widening + adapter export) AND `prisma-creative-job-store.ts` (`AttachIdentityRefsInput` widens with two stamped tier fields; `markRegistryBackfilled` writes both as `1`). No other store file modified.
- No new index on the three new snapshot columns or on the two new `CreativeJob` columns.
- **Single tier world (binding):** ProviderRouter consumes only stamped fields from `ResolvedPcdContext`. Pre-amend `productTier` / `creatorTier` (current-state) fields are removed from the context type so a routing call site cannot accidentally read them. Zero current-registry tier reads anywhere in the router.
- **No silent fallback (binding):** the resolver's malformed-resolved-job branch throws `InvariantViolationError` and never falls back to registry reads.
- **No rename (binding):** existing `effectiveTier` / `allowedOutputTier` columns on `CreativeJob` keep their names; only additive migration.
- No re-imports of `PCD_SHOT_SPEC_VERSION` inside the writer module (forbidden-imports test enforces).
- No hardcoded provider names in `provider-router.ts` conditionals.
- No mutation of `PCD_PROVIDER_CAPABILITY_MATRIX` or `accessDecision` at runtime.
- All Tier 3 rule logic lives in `tier3-routing-rules.ts`. Router and writer call into it; neither re-implements.
- All four new modules live in `packages/creative-pipeline/src/pcd/` with co-located `*.test.ts`.

## Section 6 — Acceptance criteria

The six locked acceptance conditions, expanded:

1. **Every PCD shot calls `decidePcdGenerationAccess` before provider selection.** Asserted by router Part A and Part B.
2. **`ProviderRouter` selects from `PCD_PROVIDER_CAPABILITY_MATRIX`, not hardcoded conditionals.** Asserted by router source-code grep test (no provider string literals in conditionals) and by Part F (matrix-reorder changes selection).
3. **Tier 3 mandatory rules cannot be bypassed by caller input.** Asserted by writer Part B — caller cannot construct a routing-decision-shaped object that bypasses rules 1, 2, or 3 because the writer revalidates.
4. **Snapshot writer persists `selectedProvider` plus all four pinned versions** (`policyVersion`, `providerCapabilityVersion`, `routerVersion`, `shotSpecVersion`). Asserted by writer Part A and Part D.
5. **Historical snapshots remain interpretable after matrix/router/access versions change.** Each version is its own column; `routingDecisionReason.capabilityRefIndex` indexes into the matrix at decision time.
6. **Tests prove:** Tier 3 mandatory route (Part B), non-Tier-3 allowed route (Part B), denied access path (Part A `ACCESS_POLICY`), unsupported provider capability path (Part C `NO_PROVIDER_CAPABILITY`), snapshot pins versions at write time (Part A version pinning).

Plus the additive SP3 contract revisions:

7. **`ResolvedPcdContext` carries stamped component tiers** (`productTierAtResolution`, `creatorTierAtResolution`). Asserted by SP3 resolver-test deltas (#16).
8. **Two new Prisma migrations** in this slice: one for the three nullable forensic columns on `PcdIdentitySnapshot`, one for the two stamped tier columns on `CreativeJob`. Both purely additive; no rename of existing columns. Verified by: exactly two new migration directories in `packages/db/prisma/migrations/`.
9. **Single stamped tier world.** Asserted by router regression test R1 ("registry re-tiered after stamping does not change routing") and R2 ("SP2 gate receives stamped component tiers").
10. **No-op resolver path makes zero store calls.** Asserted by resolver test #17 (restored from the pre-amend SP4 relaxation; matches SP3's original locked invariant).
11. **Malformed-resolved-job invariant.** Asserted by resolver tests #18 and #19 (resolver throws `InvariantViolationError`; never falls back to registry reads).
12. **Build / typecheck / lint green** across all packages: `pnpm install && pnpm db:generate && pnpm typecheck && pnpm test && pnpm lint`. Lint warnings count unchanged from `main`.

## Section 7 — Module file inventory (delta from `main`)

```
NEW:
  packages/creative-pipeline/src/pcd/provider-capability-matrix.ts
  packages/creative-pipeline/src/pcd/provider-capability-matrix.test.ts
  packages/creative-pipeline/src/pcd/tier3-routing-rules.ts
  packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts
  packages/creative-pipeline/src/pcd/provider-router.ts
  packages/creative-pipeline/src/pcd/provider-router.test.ts
  packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts
  packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts
  packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql
  packages/db/prisma/migrations/<timestamp>_pcd_creative_job_resolution_tiers/migration.sql

MODIFIED:
  packages/schemas/src/pcd-identity.ts
    + PcdRoutingDecisionReasonSchema
    + PcdSp4IdentitySnapshotInputSchema
    + 3 nullable fields on PcdIdentitySnapshotSchema (shotSpecVersion, routerVersion, routingDecisionReason)

  packages/db/prisma/schema.prisma
    + 3 nullable fields on PcdIdentitySnapshot model
    + 2 nullable fields on CreativeJob model (productTierAtResolution, creatorTierAtResolution)

  packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts
    + 3 fields on CreatePcdIdentitySnapshotInput (data-spread already passthrough)
    + adaptPcdIdentitySnapshotStore export (writer-contract bridge)

  packages/db/src/stores/prisma-creative-job-store.ts
    + 2 fields on AttachIdentityRefsInput (productTierAtResolution, creatorTierAtResolution)
    + markRegistryBackfilled writes both as 1 (SP1 conservative compatibility default)

  packages/creative-pipeline/src/pcd/registry-resolver.ts
    + 2 stamped fields on ResolvedPcdContext (productTierAtResolution, creatorTierAtResolution)
    + 2 optional fields on PcdResolvableJob (read from job row)
    + isResolvedPcdJob widens from 5 → 7 fields
    + Full-attach path stamps both new fields via attachIdentityRefs
    + No-op path returns from job row alone (zero store calls — restores SP3 invariant)
    + Malformed-resolved-job InvariantViolationError guard
    + Removes pre-amend current-state productTier / creatorTier fields from the context

  packages/creative-pipeline/src/pcd/registry-resolver.test.ts
    + Restores original "zero store calls on no-op" idempotency assertion
    + 5 SP4-additive tests (full-attach stamping, no-op zero-store, two malformed invariants, idempotency-guard widening)

  packages/creative-pipeline/src/pcd/provider-router.ts
    + Step 1 SP2 gate consumes resolvedContext.creatorTierAtResolution / productTierAtResolution
    + Zero current-registry tier reads anywhere in the body

  packages/creative-pipeline/src/pcd/provider-router.test.ts
    + Regression test R1 "registry re-tiered after stamping does not change routing"
    + Regression test R2 "SP2 gate receives stamped component tiers"

  packages/creative-pipeline/src/index.ts
    + SP4 re-exports

  docs/SWITCHBOARD-CONTEXT.md
    + 1 line on CampaignTakeStore merge-back ownership
```

## Design questions resolved during brainstorming

| Q | Answer | Rationale |
|---|---|---|
| Q1: Slice composition — one PR or split? | **A — one slice** (matrix + router + snapshot writer in one PR). | Auditability requires routing and persistence to land together. Splitting creates fake milestones — matrix without router is inert; router without snapshot writer makes non-durable decisions; without version pinning, historical behavior is uninterpretable. |
| Q2: Snapshot writer placement — pure function or Inngest step? | **A — pure async function with injected store.** | Defines the production invariant before choosing the runner. SP3 set the discipline. Writer can later be wrapped in `step.run` by any caller. Snapshot row's store-side uniqueness boundary handles idempotency, not Inngest retries. |
| Q3: Tier 3 rule enforcement — router-only, duplicated, or shared module? | **C — shared `tier3-routing-rules.ts`, used by both router and writer.** | Acceptance condition #3 requires writer-side enforcement. C avoids B's drift risk via single-source predicates. |
| Q3.1: Rule 3 implementation — real store, stub, or defer? | **C1 — real injected `CampaignTakeStore` contract** (in-tree test fakes only) **+ merge-back ownership note.** | C2 stub-always-false is fake compliance. C3 deferral creates a semantic mismatch with the design's "three Tier 3 rules" language. Production implementer reserved for SP6 ApprovalLifecycle ownership at merge-back. |
| Q4: Snapshot row schema — reuse SP1 columns or add fields? | **B + B1 — add three nullable columns** (`shotSpecVersion`, `routerVersion`, `routingDecisionReason`). | Acceptance condition #5 (historical snapshots remain interpretable) is the design justification for the migration. Three independent constants → three independent columns; no fusion. Nullable for historical compatibility (no DEFAULT fabrications). |
| Q5: Layer composition — one fused entry point or two modules? | **A — two separately-callable modules** (`routePcdShot`, `writePcdIdentitySnapshot`). No fused entry point. | Pre-provider routing and post-provider snapshot writing are distinct lifecycle phases; the provider call sits between them and is owned by `apps/api` / merge-back integration, not by `creative-pipeline`. |
| Q-extension: Component tier passthrough — extend ResolvedPcdContext, push to caller, or new store? | **(a) Extend `ResolvedPcdContext`** with stamped component-tier fields. | SP3 already computes both at resolution time. Avoids second registry-read surface in SP4 and avoids pushing registry knowledge back into the orchestration caller. |
| Q-extension-1: Add stamped component tiers to `CreativeJob`? | **Yes.** Add `productTierAtResolution` and `creatorTierAtResolution` as nullable columns. | **Reversal of the prior decision.** Code-review surfaced a split-brain bug: pre-amend SP4 routed the SP2 gate using current registry component tiers but the matrix/Tier 3 layers using stamped `effectiveTier`. Same shot could be Tier 1 for SP2 and Tier 3 for routing. Stamping component tiers at resolution time gives SP4 a single coherent decision world: stamped tier context governs SP2, matrix lookup, Tier 3 activation, provider selection, and snapshot interpretation uniformly. As a bonus, this also restores SP3's original "zero store calls on no-op" idempotency invariant (relaxed by the pre-amend SP4 design and now re-locked). The migration is purely additive (two nullable columns) and existing `effectiveTier` / `allowedOutputTier` columns are NOT renamed (avoiding merge-back churn). Backfill stays conservative at Tier 1 per SP1 semantic. |
| Q-extension-2: What if a resolved job is missing the stamped component tiers? | **Throw `InvariantViolationError`. Never fall back to registry reads.** | Silent fallback would silently reintroduce dual-authority routing. Unreachable inside corrected SP4 (every SP4 resolution stamps both); the guard is regression protection for any future code that forgets to stamp. |
| Section 3.1: Empty matrix candidates — fake tier-policy denial or distinguished? | **Distinguished.** Two `denialKind`s — `ACCESS_POLICY` and `NO_PROVIDER_CAPABILITY`. `accessDecision` unmutated in the second case. | Tier policy *allowed* the shot; provider routing failed because no provider satisfies required capability constraints. Different failure modes; do not collapse. |
| Section 3.3: `shotSpecVersion` — re-import current or carry from input? | **Carry from input** (SP3-stamped). Writer must not import `PCD_SHOT_SPEC_VERSION`. | Snapshot must record the spec version the job was planned under, not the current value at write time. Re-importing creates forensic drift. Forbidden-imports test enforces. |
| Review redline 1: should the writer enforce Tier 3 rules from `tier3RulesApplied`? | **No.** Enforcement derives required-rule set from pure recomputes (rules 1, 2) plus the explicit `editOverRegenerateRequired` boolean (rule 3). `tier3RulesApplied` is forensic metadata, validated for set equality only via `Tier3RoutingMetadataMismatchError`. | Forensic metadata is caller-controlled and can be falsified. Letting it drive enforcement creates a bypass. Recompute + explicit boolean closes the bypass; metadata mismatch is its own distinct error so forensic-record bugs don't masquerade as capability violations. |
| Review redline 2: name `matchedTier`. | **Renamed to `matchedEffectiveTier`.** | SP4 carries three tier concepts (`productTier`, `creatorTier`, `effectiveTier`); matrix lookup is keyed by `effectiveTier`. The decision-reason field name should say so. |
| Review redline 3: is `campaignId` always real? | **No.** Replaced flat `organizationId` + `campaignId` fields with explicit `ApprovedCampaignContext` discriminated union (`{ kind: "campaign", … } \| { kind: "none" }`). | Future non-campaign generation paths (drafts, internal previews, test harnesses) must not need to fabricate a `campaignId`. Under `kind: "none"`, rule 3 short-circuits to false and `campaignTakeStore` is not consulted. Semantically clean for "edit-over-regenerate within an approved-campaign context." |
| Review redline 4: matrix coverage tests. | **Added Part G end-to-end matrix-router agreement tests.** | Independent matrix sufficiency tests proved each rule has a provider; the new tests prove the router actually returns `allowed: true` for every Tier-3-allowed triple under the most restrictive rule combination. Closes the gap where independent rules each have a provider but no single provider satisfies the union. |
| Review redline 5: `candidatesAfterTier3Filter: 0` literal type. | **Widened to `number`.** | Literal numeric types compose poorly with helpers. The denial-branch invariant is preserved as a runtime test assertion (`expect(candidatesAfterTier3Filter).toBe(0)`), not a type-level constraint. |

## Architectural context

This SP4 module set sits at the **routing + snapshot persistence** position in the broader PCD orchestration:

```
PCD job submitted
  → PcdRegistryResolver        (SP3; ResolvedPcdContext now carries productTier + creatorTier — SP4 contract revision)
  → ShotSpecPlanner            (later)
  → PcdTierPolicy              (SP2; called by SP4 router per shot)
  → ProviderRouter             ◀── SP4 (this slice)
  → execution / provider call  (apps/api at merge-back)
  → PcdIdentitySnapshot writer ◀── SP4 (this slice)
  → QC                         (SP5)
  → Approval / export          (SP6)
```

The deliberate design choice: **routing is governed and persistence is forensically self-contained.** The router answers "given this resolved context, this shot, this output intent, and current campaign approval state — which provider may run this generation?" The writer answers "what was the exact provider, identity, and version state at the moment of generation?" Both share Tier 3 invariants via a single predicate module so router and writer cannot drift.

Every other concern — the actual provider call, retries, QC, consent, approval, export gating — lives downstream and consumes SP4's outputs.
