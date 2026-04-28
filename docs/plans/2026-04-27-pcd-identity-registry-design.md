---
date: 2026-04-27
tags: [switchboard, pcd, design, registry, ugc]
status: active
---

# PCD Identity Registry & Tier-Gated Generation — Design Spec

**Project:** Switchboard / Performance Creative Director (PCD)
**Created:** 2026-04-27
**Status:** Design approved, pending implementation plan

## Problem

PCD today (Stages 1–5: concept → copy → image → approval → Kling video) generates each ad cold. There is no canonical avatar or product registry, no continuity across jobs, no tier-aware fidelity gating, and no per-shot provider routing. The result: identity drift across multi-shot campaigns, hallucinated package labels, no reusable spokespeople, no symmetric way to reason about output fidelity.

The goal is Higgsfield SOUL ID-grade UGC quality, while keeping Switchboard's governance doctrine intact (deterministic gates, audit, sealed approvals, no bypass).

## Decision

In-place upgrade of the existing PCD agent. Add a registry of avatar and product identities, each on a three-tier fidelity ladder. A deterministic policy engine gates shot types, provider routes, final export, and Meta draft creation. All existing PCD jobs are mechanically backfilled to Tier 1.

No PCD fork. No parallel "PCD v2" agent. One PCD, one registry, one approval path.

## Core model

Two independent identity axes, same ladder:

| Tier | Name | Avatar minimum | Product minimum |
|---|---|---|---|
| 1 | Draft | Stock prompt avatar | URL import |
| 2 | Ad-Ready | Master image + locked `voice_id` | URL + hero packshot + canonical package text |
| 3 | Lock | 10+ photos + voice + wardrobe + consent record (SOUL ID-grade) | Full asset pack: front/back/side + macro label + cutout + dimensions + color spec + logo + OCR text |

Every PCD job derives:

```
effectiveTier = min(avatarTier, productTier)
```

The user does not pick the tier. The system derives it from the resolved identities. This prevents the failure where one side is high-fidelity and the other is fake.

## Tier gating rules

Backend-enforced. Shot-type-specific, not just global.

| Condition | Requirement |
|---|---|
| `outputIntent = draft` | Always allowed |
| `final_export` | `effectiveTier ≥ 2` |
| `meta_draft` | `effectiveTier ≥ 2` + approval + compliance check |
| `label_closeup` | `productTier = 3` |
| `face_closeup` | `avatarTier = 3` |
| `face_closeup + label_closeup` | both = 3 |
| `object_insert` | `productTier = 3` |

Reference policy function (TypeScript):

```ts
type IdentityTier = 1 | 2 | 3;

type PcdShotType =
  | "script_only" | "storyboard"
  | "simple_ugc" | "talking_head" | "product_demo"
  | "product_in_hand" | "face_closeup" | "label_closeup"
  | "object_insert" | "meta_ad_draft";

type PcdTierDecision = {
  allowed: boolean;
  effectiveTier: IdentityTier;
  requiredAvatarTier?: IdentityTier;
  requiredProductTier?: IdentityTier;
  reason?: string;
  requiredActions?: string[];
};

function decidePcdGenerationAccess(input: {
  avatarTier?: IdentityTier;
  productTier?: IdentityTier;
  shotType: PcdShotType;
  outputIntent: "draft" | "preview" | "final_export" | "meta_draft";
}): PcdTierDecision { /* ... see implementation plan ... */ }
```

## Architecture

```
PCD job submitted
  → PcdRegistryResolver        (resolve/create identities, compute effectiveTier)
  → PcdTierPolicy              (allow/deny per shot type + output intent)
  → ShotSpecPlanner            (writes identity refs into shot spec)
  → ProviderRouter (tier-aware) (consults declarative PcdProviderCapabilityMatrix)
  → Inngest execution
  → IdentitySnapshot           (frozen into WorkTrace at generation time)
  → AssetRecord + WorkTrace lineage
  → QC gates
  → ApprovalLifecycle
  → Export / Meta draft (tier-gated)
```

### Package placement (locked)

Strict separation — no DB / provider / credential code in `packages/core`.

```
packages/schemas/
  pcd-identity.schema.ts          # AvatarIdentity, ProductIdentity, ConsentRecord, etc.
  pcd-tier-policy.schema.ts       # IdentityTier, PcdShotType, PcdTierDecision, OutputIntent
  pcd-shot-spec.schema.ts         # ShotSpec contract with identity refs
  pcd-capability-matrix.schema.ts # Provider capability shape

packages/creative-pipeline/src/pcd/
  registry-resolver.ts            # pure orchestration (no DB imports)
  tier-policy.ts                  # pure deterministic function
  tier-policy.test.ts             # exhaustive matrix tests
  provider-router.ts              # consults capability matrix, no hardcoded if/else
  provider-capability-matrix.ts   # declarative table (see below)
  shot-spec-planner.ts
  identity-snapshot.ts            # builder for PcdIdentitySnapshot

apps/api/src/
  routes/pcd-*.ts                 # HTTP routes
  stores/prisma-pcd-registry-store.ts  # DB
  inngest/pcd-*.ts                # background jobs
  providers/pcd-*-adapter.ts      # provider credentials and adapters
```

Rule: `schemas` = types/contracts; `creative-pipeline` = orchestration logic; `apps/api` = DB, routes, providers, credentials, side effects. `packages/core` is not touched by any of this.

### Components

- **PcdRegistryResolver** (`packages/creative-pipeline`) — runs at job creation. Resolves or creates `AvatarIdentity` and `ProductIdentity`, computes `effectiveTier`, attaches them to the job before shot planning. New required job fields: `productIdentityId`, `avatarIdentityId`, `effectiveTier`, `allowedOutputTier`, `shotSpecVersion`. DB access is delegated through a store interface implemented in `apps/api`.
- **PcdTierPolicy** (`packages/creative-pipeline`) — pure deterministic function. No I/O, no time, no randomness. Backend-enforced; UI explains, backend gates. Exhaustive unit tests (see Tier policy test matrix below).
- **PcdProviderCapabilityMatrix** (`packages/schemas` shape, `packages/creative-pipeline` data) — declarative table consumed by `ProviderRouter`. No hardcoded if/else routing.
- **Tier-aware ProviderRouter** — looks up `(shotType, effectiveTier, outputIntent)` in the capability matrix and selects providers. Path 2 first (provider-native references: Veo subject images, Runway References, Kling element binding, Sora `input_reference`). Path 1 (per-avatar trained identity adapter) is a v2 slot.
- **PcdIdentitySnapshot** (`packages/creative-pipeline`) — frozen at every generation. See *Identity snapshot* section.
- **QC gates** — face similarity (against canonical avatar set), logo similarity, OCR package-text match, geometry/scale checks, color delta. Hard-blocks approval when a tier-required gate fails. Lives alongside the existing audit ledger; not a separate service.
- **ApprovalLifecycle integration** — final export and Meta draft creation require tier pass + QC pass + human approval, in that order.

### Provider routing by tier

**Tier 1 — Draft.** LLM, image concept model, cheap storyboard generation. No video final export.

**Tier 2 — Ad-Ready.** HeyGen / Synthesia / Kling avatar; Runway / Kling image-to-video; product recontext; basic QC.

**Tier 3 — Lock.** SOUL ID-class custom avatar path; performance transfer (Act-Two-style); object insertion; first-frame / last-frame video; late-stage product compositing; OCR / logo / face QC; mandatory approval.

### Tier 3 mandatory routing rules (consistency floor)

To hit ~85–90% of Higgsfield SOUL ID consistency on Path 2 (provider-native references, no per-avatar trained adapter), the router **must** apply these rules at Tier 3. They are not optional optimizations:

1. **First-and-last-frame anchoring on every Tier 3 video shot.** The master image (or an approved prior take) is the first frame; the router either generates or selects a locked end frame and forces the provider to interpolate. No fresh text-to-video generations at Tier 3. Provider hooks: Sora `input_reference`, Runway `promptImage` first/last, Veo start/end-frame.
2. **Performance transfer is the default for Tier 3 talking-head shots.** Route to Runway Act-Two, Kling motion-control + lip-sync, or HeyGen / Synthesia digital twin — never to open text-to-video. Identity is supplied as a fixed reference; only motion and lip-sync are generated.
3. **Edit-over-regenerate within a campaign.** Once a Tier 3 shot is approved, every variant is an `edit` or `extend` off the approved take — not a new generation from prompt. Sora edits/extensions, Runway first/last `promptImage` continuation, Veo object-insertion are the canonical paths. Fresh re-generation requires explicit operator override and is logged in lineage.

These rules are enforced in `ProviderRouter` and validated in QC; a Tier 3 final export produced via a fresh text-to-video path is rejected.

### Provider capability matrix (declarative)

`ProviderRouter` does **not** contain hardcoded provider selection logic. All routing is data-driven from a declarative matrix:

```ts
export const PCD_PROVIDER_CAPABILITY_MATRIX: PcdProviderCapability[] = [
  {
    provider: "kling",
    tiers: [2, 3],
    shotTypes: ["simple_ugc", "product_demo", "product_in_hand"],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: false,
  },
  {
    provider: "runway",
    tiers: [2, 3],
    shotTypes: ["product_demo", "object_insert", "simple_ugc", "talking_head"],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: true,   // Act-Two
  },
  {
    provider: "heygen",
    tiers: [2, 3],
    shotTypes: ["talking_head", "face_closeup"],
    supportsFirstLastFrame: false,
    supportsEditExtend: false,
    supportsPerformanceTransfer: true,   // digital twin
  },
  // ...
];
```

The matrix is versioned (`providerCapabilityVersion`), and the version in effect at generation time is captured in the identity snapshot.

### Tier policy test matrix

`PcdTierPolicy` is the heart of the system. It must be exhaustively unit-tested across the full cross-product:

- `avatarTier`: 1 / 2 / 3
- `productTier`: 1 / 2 / 3
- `shotType`: every value in `PcdShotType`
- `outputIntent`: `draft` / `preview` / `final_export` / `meta_draft`

Required acceptance assertions:

- Tier 3 avatar + Tier 1 product **cannot** final export.
- Tier 1 avatar + Tier 3 product **cannot** final export.
- Tier 2 + Tier 2 **can** standard final export.
- `label_closeup` requires `productTier = 3`.
- `face_closeup` requires `avatarTier = 3`.
- `object_insert` requires `productTier = 3`.
- `meta_draft` requires `effectiveTier ≥ 2` + approval pass + compliance check pass.
- `outputIntent = draft` is always allowed regardless of tier.

### Forward-compatibility slot for trained identity adapters (Path 1)

`AvatarIdentity` reserves an `identityAdapter` field for v2:

```ts
identityAdapter: null | {
  provider: "internal_lora" | "ip_adapter" | "instantid" | "provider_native";
  modelRef: string;          // storage URI or provider-side ID
  trainedAt: ISODateString;
  trainedFromAssetIds: string[];  // which AvatarIdentity photos were used
  tenantId: string;
  status: "training" | "ready" | "deprecated";
}
```

Day one this is always `null`. When Path 1 ships, the training pipeline writes this row and `ProviderRouter` prefers the trained adapter over generic provider references for that avatar. No schema migration, no tenant re-onboarding.

## Data model

```ts
ProductIdentity {
  id
  orgId
  sourceUrl
  title
  description
  brandName
  sku
  packageType
  canonicalPackageText
  dimensionsMm
  colorSpec
  logoAssetId
  qualityTier: "url_imported" | "verified" | "canonical"
  lockStatus: "draft" | "verified" | "locked" | "deprecated"
}

ProductImage {
  id
  productIdentityId
  viewType:
    | "hero_front" | "back" | "side" | "three_quarter"
    | "macro_label" | "transparent_cutout" | "logo" | "fallback_scraped"
  uri
  resolution
  hasReadableLabel
  ocrText
  backgroundType
  approvedForGeneration
}

ProductQcResult {
  productIdentityId
  assetId
  logoSimilarityScore
  packageOcrMatchScore
  colorDeltaScore
  geometryMatchScore
  scaleConfidence
  passFail
  warnings
}

AvatarIdentity {
  id
  orgId
  displayName
  avatarType: "stock" | "anchored" | "soul_id"
  masterImageUri
  voiceId
  wardrobeSpec
  consentRecordId
  qualityTier: "stock" | "anchored" | "soul_id"
  identityAdapter: null | TrainedIdentityAdapter   // v2 slot, day-one always null
  status
}

AvatarVariant   { variantId, avatarId, lookName, wardrobeTags, hairMakeupTags, locale, providerAssetRefsJson }
AvatarMotionRef { motionRefId, avatarId, drivingClipUri, gestureTags, expressionTags, fps, durationMs }
VoiceAsset      { voiceId, provider, providerVoiceId, sampleUri, languageCodes, prosodySpec, consentRecordId }
ConsentRecord   { id, personName, scopeOfUse, territory, mediaTypes, revocable, recordingUri, effectiveAt, expiresAt }
```

Existing `AssetRecord` is reused for uploaded/generated media. No parallel PCD-only media store.

### Separation of concerns: identity tier vs. approval vs. QC vs. export

These four states are independent and must not be conflated in implementation:

| State | Owner | Means |
|---|---|---|
| **Identity quality (`qualityTier`)** | `AvatarIdentity` / `ProductIdentity` | What references exist. Tier 3 product means enough material to *attempt* Tier 3 generation, not that any output is safe. |
| **Approval state** | `ApprovalLifecycle` | Whether a human has approved usage of the resolved identities or a generated asset. |
| **QC state** | `ProductQcResult` / face / logo gates | Whether a specific generated output passed automated checks. |
| **Export state** | `ExportLifecycle` | Whether the asset can leave the system (Meta draft, DAM publish, etc.). |

Final export requires all four to align: `qualityTier ≥ required`, `approval = approved`, `qc = pass`, `export gate = open`. A failure in any one blocks export.

### Identity snapshot (frozen at generation)

Every generation freezes the identity state into a `PcdIdentitySnapshot` written into `WorkTrace` at the moment of provider call. This is non-negotiable — without it, lineage becomes fuzzy when product/avatar records evolve later.

```ts
PcdIdentitySnapshot {
  // Product side
  productIdentityId: string
  productTierAtGeneration: IdentityTier
  productImageAssetIds: string[]          // exact images sent to provider
  productCanonicalTextHash: string        // hash of canonical text used for OCR gate
  productLogoAssetId: string | null

  // Avatar side
  avatarIdentityId: string
  avatarTierAtGeneration: IdentityTier
  avatarReferenceAssetIds: string[]       // exact reference photos / driving clips
  voiceAssetId: string | null
  consentRecordId: string | null

  // Policy / routing version
  policyVersion: string                   // PcdTierPolicy version
  providerCapabilityVersion: string       // PcdProviderCapabilityMatrix version
  selectedProvider: string
  providerModelSnapshot: string           // pinned model ID, e.g. sora-2-pro-2025-10-06
  seedOrNoSeed: string                    // seed value or "no-seed" sentinel
  rewrittenPromptText: string | null      // when provider rewrote the prompt
}
```

Snapshots are immutable. They live on `WorkTrace`, not on the identity rows.

## Backfill

Mechanical, no magical upgrades.

- For every existing PCD job: if product data exists but no `ProductIdentity`, create one at `qualityTier = url_imported` (Tier 1).
- If avatar prompt/persona exists but no `AvatarIdentity`, create one at `avatarType = stock` (Tier 1).
- If generated assets exist, link them into `AssetRecord` lineage where possible.
- Mark `registryBackfilled = true`, `fidelityTierAtGeneration = 1`.

Old jobs become read/write compatible at Tier 1. They are **not** retroactively trusted as canonical assets. New tier-gated actions (final export, Meta draft) on backfilled jobs require asset upgrades.

## UI model

PCD job UI shows two columns of fidelity status, plus one derived line:

```
Product Fidelity     Avatar Fidelity
[✓] URL imported     [✓] Stock avatar
[ ] Hero packshot    [ ] Master image
[ ] Macro label      [ ] Voice asset
[ ] Cutout           [ ] 10+ reference photos
[ ] Dimensions       [ ] Consent record

Current generation level: Draft
Available now:  scripts, concepts, storyboards
To unlock UGC video:  upgrade product and avatar to Ad-Ready
To unlock label/face closeups:  upgrade both to Lock
```

Asset upgrade UX is a ladder, never a wall. Onboarding starts at "paste your product URL" — never "upload 9 assets before you can continue."

## Compliance hooks

- `ConsentRecord` is required to upgrade an avatar to Tier 3 if `avatarType ≠ synthetic`.
- Label-visible outputs must pass OCR match against `ProductIdentity.canonicalPackageText`.
- Logo-visible outputs must pass logo-similarity match against `ProductIdentity.logoAssetId`.
- FTC disclosure: any Tier 2+ output flagged as testimonial-style requires human review of the script claims path. (Disclosure UX is out of scope for this spec; hook is reserved.)

### Consent revocation behavior (explicit)

When `ConsentRecord.revoked = true`:

- **Block** new generations using that avatar.
- **Block** new edits / extensions of prior generations (because the model still consumes the same identity references).
- **Block** new Meta drafts of any asset whose `IdentitySnapshot.consentRecordId` matches the revoked record.
- **Block** re-export of prior generated assets unless an explicit legal/owner override is recorded with reason and approver.
- **Mark** existing generated assets as `consent_revoked_after_generation = true` so they are visually flagged in the dashboard.
- **Do not delete** historical `WorkTrace` or `IdentitySnapshot` rows. Audit integrity is preserved; only future actions are blocked.

Revocation propagation is enforced at `ApprovalLifecycle` and `ExportLifecycle`, not just at generation time.

## Sprint plan

Implementation invariants (apply to every sprint):
- In-place upgrade of existing PCD. No fork. No "PCD v2" agent.
- Do not introduce BullMQ. Do not bypass `PlatformIngress`, `WorkTrace`, `AssetRecord`, Inngest, Outbox, or `ApprovalLifecycle`.
- Schemas in `packages/schemas`. Pure tier policy and provider routing logic in `packages/creative-pipeline/src/pcd`. DB-backed stores, routes, Inngest jobs, and provider adapters in `apps/api`. No DB imports from `packages/core`.

| Sprint | Scope | Acceptance criteria |
|---|---|---|
| SP1 | Registry schema + backfill migration. Tables: `ProductIdentity`, `ProductImage`, `AvatarIdentity` extensions, `AvatarVariant`, `AvatarMotionRef`, `VoiceAsset`, `ConsentRecord`, `ProductQcResult`, `asset_lineage_edge`, `PcdIdentitySnapshot` columns on `WorkTrace`. | All existing PCD jobs have `productIdentityId`, `avatarIdentityId`, `effectiveTier = 1`, `registryBackfilled = true` after migration. No auto-upgrades. |
| SP2 | `PcdTierPolicy` as a pure deterministic backend-enforced function with the full test matrix (avatarTier × productTier × shotType × outputIntent). | A Tier 1 job cannot create final export or Meta ad draft even if the frontend tries. All matrix assertions in *Tier policy test matrix* pass. |
| SP3 | `PcdRegistryResolver` inside existing PCD job creation. Every new PCD job must resolve `productIdentityId`, `avatarIdentityId`, `effectiveTier`, `allowedOutputTier`, `shotSpecVersion` before shot planning. | All new PCD jobs carry the five required fields before any provider call. Pure orchestration; DB access via store interface. |
| SP4 | Declarative `PcdProviderCapabilityMatrix` + tier-aware `ProviderRouter` + Tier 3 mandatory rules. | Same shot request routes differently by tier through the matrix (no hardcoded if/else). **Tier 3 enforced:** no fresh text-to-video, first/last-frame anchoring on every video, performance transfer default for talking-head, edit-over-regenerate within campaign. |
| SP5 | QC gates: OCR package text match (label-visible), logo similarity (logo-visible), face similarity (face-visible), geometry/scale (product-in-hand / object-insert). | A label-visible output without OCR match cannot be approved for final export. Each gate is independently togglable per shot type. |
| SP6 | Approval + Meta draft + export enforcement, including consent revocation propagation. | Final export requires tier pass + QC pass + approval pass. Meta draft additionally requires compliance check pass. Consent revocation blocks future generations, edits, extensions, Meta drafts, and re-export of prior assets without override. |

## What's deliberately out of scope

- **Cross-tenant stock avatar pool.** Schema-compatible (`avatar_type: synthetic`, `org_id` nullable in future), but not built.
- **Path 1 trained identity adapters** (DreamBooth / LoRA / InstantID-style per-avatar fine-tuning). Reserved as v2 "Pro Avatar" upgrade.
- **FTC disclosure UX.** Compliance hooks reserved, surface UX deferred.
- **Multi-tenant provider rate-limit pooling.** Existing per-deployment provider credentials remain canonical.

## Resolved implementation contracts

- **Package placement:** `PcdRegistryResolver` lives in `packages/creative-pipeline/src/pcd/`. Schemas in `packages/schemas`. DB stores, routes, providers in `apps/api`. `packages/core` is not touched.
- **Schema location:** `ProductIdentity` and all PCD identity types live in `packages/schemas` (under `pcd-identity.schema.ts`). Same module exports types consumed by `creative-pipeline` and `apps/api`.
- **Backfill migration:** Prisma migration adds columns/tables; a separate Inngest backfill job populates `ProductIdentity` / `AvatarIdentity` rows from existing PCD job data. Idempotent. Mark `registryBackfilled = true` per job.
- **QC engine ownership:** extends the existing audit ledger; not a new service. Lives in `apps/api/src/qc/` as a small module called by `ApprovalLifecycle`.

## Consistency target (qualitative goal, not build metric)

Day one, Tier 3 aims for **materially improved multi-shot continuity** vs. current PCD, achieved through provider-native references plus the three mandatory Tier 3 routing rules (first/last-frame anchoring, performance transfer for talking-head, edit-over-regenerate). Path 1 (trained per-avatar identity adapters via the reserved `identityAdapter` slot) closes the remaining gap in v2 without registry changes or tenant re-onboarding.

The "85–90% of Higgsfield SOUL ID" framing is internal directional context — **not** a build acceptance metric. Build acceptance uses the measurable QC metrics below.

### Measurable QC metrics (build targets)

The system tracks these per-tenant and per-campaign. Acceptance thresholds are tuned from real data, not guessed up front.

- **Face similarity pass rate** — share of face-visible outputs whose embedding distance to canonical avatar refs falls under threshold.
- **Product OCR pass rate** — share of label-visible outputs whose extracted text matches `ProductIdentity.canonicalPackageText` within edit-distance threshold.
- **Logo similarity pass rate** — share of logo-visible outputs that match `ProductIdentity.logoAssetId` under threshold.
- **Manual approval rate** — share of generations that pass human review on first submission.
- **Regeneration rate** — average regenerations per approved final export. Target: low. Trend matters more than absolute.
- **Cross-shot identity drift score** — average pairwise face-embedding distance across all face-visible takes within a campaign.

## Non-obvious conclusions

- **Continuity is not a model. It is a registry.** No single video model maintains identity well enough on its own. The registry is the substrate; providers are interchangeable.
- **Tier is derived, not chosen.** Letting users pick a tier creates the exact failure mode this design exists to prevent (high-fidelity face on a hallucinated label, or vice versa).
- **Symmetry is the architecture.** Avatar and product use the same tier ladder, the same gating function, the same registry shape. This is what makes the tier policy tractable.
- **Backfill must be boring.** Any attempt to "upgrade" old jobs into higher tiers automatically would break the trust contract. Tier 1 means Tier 1.
