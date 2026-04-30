# Synthetic Creator Roster on PCD — Design Spec

**Date:** 2026-04-30
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (brainstorming session)
**Target slices:** SP10+ (synthetic-creator track), additive to SP1–SP9 already shipped

---

## 1. Problem & Strategy

UGC for regulated aesthetic verticals (med spa, dental aesthetics, anti-ageing, halal wellness) is bottlenecked by real-creator sourcing: discovery, contracting, consent paperwork, repeat shoots. A curated library of platform-owned synthetic personas — each locked to a stable visual identity, pre-tuned to a market × treatment × vibe — collapses time-to-asset, cost-per-variation, and clinic brand-safety surface.

The strategic constraint: this product's existing moat is consent-verified real creator identity (the PCD vertical, SP1–SP9). Synthetic personas must **extend** that governance model, not bypass it. A synthetic creator is a first-class PCD identity with platform ownership replacing creator consent and per-clinic licensing replacing direct usage rights.

### What this is, and what it is not

This system is **not** a creative generator, UGC tool, or content factory. Structurally it is a **controlled synthetic supply infrastructure with governance guarantees**:

| Layer | Role |
|---|---|
| Creator (PCD) | Supply node |
| Script | Behavioral layer |
| Selector | Allocation engine |
| License | Market control |
| Performance snapshot | Learning memory |

It is closer in shape to an ad-auction / inventory-allocation system than to a creative tool. That framing matters because it sets the success bar: this only wins when it functions as **closed-loop creative optimisation tied to revenue outcomes**, not when it produces clever visuals in isolation.

### Wedge anchoring (this is an amplifier, not the wedge)

The product wedge remains lead capture / "never miss a lead" (Alex). This synthetic-creator system is the **acquisition-side amplifier** that closes the funnel:

```
Acquisition (synthetic creator + script) → Conversion (Alex) → Signal (CAPI / outcomes)
                          ▲                                              │
                          └──────────── better acquisition ◄─────────────┘
```

The eventual learning loop pulls from **conversion outcomes**, not just ad-platform metrics. v1 ships with ad-platform metrics (CTR / ROAS) in `PcdPerformanceSnapshot`; the schema is intentionally extensible so CAPI / Alex-conversion signal can fold in later as an additional metric dimension without changing the selector contract.

**Implication for positioning and v1 scope:** this design must not be sold or shipped as a standalone creative tool — that path loses differentiation and becomes a HeyGen / Runway clone. It is shipped attached to lead-capture / conversion infrastructure or it is not shipped at all.

### Strategic decisions locked

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Market-exclusive leasing** (B), with a path to a hybrid free-core tier (D) once volume justifies it. **v1 ships with time-boxed leases (default 30 days, renewable) and a softer `priority_access` lock type** to avoid early-stage supply lockup. Hard exclusivity is the eventual shape, not the launch shape. | Synthetic personas burn out through over-exposure (early HeyGen problem). Per-(market × treatment-class) exclusivity preserves differentiation; maps cleanly onto the existing PCD `tier` concept. **Early-stage friction risk:** with a 10-character roster, hard locks would surface "no creator available" failures during clinic onboarding — fatal for product feel. Time-boxing + soft tiers de-risks this without abandoning the long-term model. |
| Q2 | **Single `CreatorIdentity` table with `kind: "real" \| "synthetic"` discriminator** + extension tables for kind-specific fields. (Codebase note: PCD spans `ProductIdentity` + `CreatorIdentity`; synthetic personas are creators, so the discriminator lands on `CreatorIdentity`.) | Mechanical merge-back to Switchboard (additive only, no renames). SP2 tier policy and SP4 routing work unchanged. |
| Q3 | **`DisclosureTemplate` registry**, keyed by (jurisdiction × platform × treatment-class), platform-owned and version-controlled. Snapshot resolved text into provenance. | Only model where SP9 can attest to disclosure compliance per asset. Centralised templates scale; per-clinic copy creates silent compliance drift. |
| Q4 | **Two-stage selection**: LLM `PreproductionAnalysis` emits a typed `CreativeBrief`; pure deterministic `SyntheticCreatorSelector` emits `(creatorIdentityId, fallbacks[])`. | Mirrors `PcdTierPolicy` shape from SP2. Required for SP9 forensic guarantee — same brief + same versions → same creator, every time. |
| Q5 | **Two-tier deterministic selection with versioned performance snapshots.** Static compatible-set filter + optional overlay re-ranks using a frozen `PcdPerformanceSnapshot`. The selector never reads live mutable metrics. | Preserves replayability. `(brief, selectorVersion, metricsSnapshotVersion)` always yields the same `creatorIdentityId`. Enables learning loop without breaking governance. |
| Q6 | **Scripts are first-class records** (`ScriptTemplate` table), addressable by ID, reusable across briefs. | Without script-level identity, performance attribution stops at the creator and you can't disambiguate "Cheryl worked" from "the skeptic-hook script worked". |

The core architectural principle that follows from Q4 + Q5:

> Performance can influence future selection decisions, but only through a versioned snapshot — never through live mutable reads.

This keeps Switchboard a governed operating system, not a vibes-based generator.

---

## 2. Pipeline Architecture

```
PreproductionAnalysis (LLM, reviewable)
        │
        ▼
CreativeBrief (typed, packages/schemas)
        │
        ▼
SyntheticCreatorSelector (pure, deterministic)
   ├─ compatible-set filter (rules over treatmentClass, market,
   │  vibe, pricePositioning, hardConstraints, mutuallyExclusiveWith)
   └─ performance overlay (versioned snapshot, optional)
        │
        ▼
SyntheticCreatorSelectionDecision
        │
        ▼
License Gate ── CreatorIdentityLicense active for (creatorIdentityId, clinicId, market, treatmentClass)?
        │   on miss → walk fallbacks → exhaust → fail LICENSE_UNAVAILABLE
        ▼
Disclosure Resolution ── DisclosureTemplate for (jurisdiction, platform, treatmentClass)?
        │   on miss → fail DISCLOSURE_UNRESOLVABLE
        │   on hit → snapshot text into job
        ▼
ScriptSelector (pure, deterministic) → scriptId
        │   compatible ScriptTemplate where compatibleCreatorIdentityIds CONTAINS creatorIdentityId
        │   AND vibe = brief.vibe
        ▼
Provider Routing (SP4 — locked DALL-E + Kling per character)
        │
        ▼
Generation
        │
        ▼
QC Gate (SP5) ── face-descriptor match against locked physicalDescriptors
        │   on drift > threshold → bounded regeneration retry (default 3)
        │   on retry exhaustion → fail QC_DRIFT_UNRESOLVED
        ▼
Provenance Write (SP9, extended chain)
```

Every box upstream of Generation is pure or pure-at-the-edges. Determinism is preserved end-to-end given `(brief, selectorVersion, metricsSnapshotVersion, scriptSelectorVersion)`.

---

## 3. Data Model (additive only)

### Codebase anchoring note

This codebase has no unified `Pcd` table — PCD is the conjunction of two existing models, `ProductIdentity` and `CreatorIdentity`, paired into `PcdIdentitySnapshot` at job time. Synthetic personas are *creators*, so all `kind: "real" | "synthetic"` discrimination and synthetic-only fields land on `CreatorIdentity`. References below use `creatorIdentityId` (FK to `CreatorIdentity.id`) — the standard FK in this repo.

### 3.1 Existing `CreatorIdentity` table — one new column

```
CreatorIdentity.kind: enum("real", "synthetic")  default "real"
```

Zero impact on existing rows. Real `CreatorIdentity` rows continue to flow through SP6 consent enforcement (via existing `consentRecordId`); synthetic `CreatorIdentity` rows flow through the parallel license gate (§3.3). Existing fields like `voice`, `personality`, `appearanceRules`, and `environmentSet` remain meaningful for both kinds — synthetic rows populate them from the locked persona spec rather than from real-creator intake.

### 3.2 `CreatorIdentitySynthetic` — extension table

Extension table for synthetic-only fields. One row per synthetic `CreatorIdentity`. (Real-kind rows have no row in this table.)

| Column | Type | Notes |
|---|---|---|
| `creatorIdentityId` | FK → `CreatorIdentity.id` | Primary key |
| `treatmentClass` | enum | `med_spa`, `dental`, `anti_ageing`, `halal_wellness` (no `slimming` in v1) |
| `vibe` | enum | `omg_look`, `quiet_confidence`, `telling_her_friend`, `seven_days_later`, `just_left_clinic`, `softly_glowing` |
| `market` | enum | `SG`, `MY`, `HK` |
| `ethnicityFamily` | enum | `sg_chinese`, `my_chinese`, `thai_chinese`, `filipino_sg`, `my_malay`, `hk_chinese` |
| `ageBand` | enum | `gen_z` (≤24), `mid_20s` (25–29), `early_30s` (30–34), `mid_30s_plus` (35+) |
| `pricePositioning` | enum | `entry`, `standard`, `premium` |
| `physicalDescriptors` | JSONB | Locked descriptor set (face shape, skin tone, eye shape, hair, build, age read). Distinct from existing `CreatorIdentity.appearanceRules` — descriptors here are the immutable spec; `appearanceRules` may carry generation-time annotations. |
| `dallePromptLocked` | text | Verbatim prompt; never paraphrased at job time |
| `klingDirection` | JSONB | Setting / motion / energy / lighting / NO list |
| `voiceCaptionStyle` | JSONB | Voice cadence + caption style descriptors. Co-exists with existing `CreatorIdentity.voice`; this column captures synthetic-specific caption style (lowercase / fragments / Gen Z slang) that doesn't fit the real-creator voice schema. |
| `mutuallyExclusiveWithIds` | FK[] → `CreatorIdentity.id` | Same-campaign exclusion (e.g., Nana ↔ Bua) |
| `status` | enum | `active`, `retired` — selector compatible-set filter. (Existing `CreatorIdentity.isActive: Boolean` remains the global on/off; this column captures synthetic-specific lifecycle states without overloading `isActive`.) |

### 3.3 `CreatorIdentityLicense` — leasing record

The Q1=B gate, with v1-friendly soft tiers to avoid early supply lockup. One row per active lease. Although structurally usable for any `CreatorIdentity`, the license gate runs only when `CreatorIdentity.kind = "synthetic"` — real creators continue to flow through `consentRecordId` and SP6.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `creatorIdentityId` | FK → `CreatorIdentity.id` | |
| `clinicId` | FK → `Clinic.id` | |
| `market` | enum | Lease scope |
| `treatmentClass` | enum | Lease scope |
| `lockType` | enum | `hard_exclusive` \| `priority_access` \| `soft_exclusive` |
| `exclusivityScope` | enum | `market_treatment` (B-tier) \| `free` (D-tier, future) |
| `effectiveFrom` | timestamp | |
| `effectiveTo` | timestamp | Default `effectiveFrom + 30 days` for v1; renewable; nullable means indefinite |
| `priorityRank` | int | For `priority_access` only — lower wins; orders concurrent priority leases |
| `status` | enum | `active`, `suspended`, `expired`, `superseded` |

**Lock-type semantics** (license gate behaviour):

- `hard_exclusive` — only the holder can use the creator in this `(market, treatmentClass)`. Any competing job hits `LICENSE_UNAVAILABLE`. Long-term shape; reserve for high-paying anchor clinics.
- `priority_access` — multiple clinics can hold leases concurrently; selector prefers the lowest `priorityRank` holder when generating, but other holders still get the creator if the primary is at capacity or unavailable. **v1 default for new clinics.**
- `soft_exclusive` — single primary holder, but other clinics can request usage with a flag (`isSoftExclusivityOverride: true`) recorded in provenance for transparency. Useful when one clinic wants exclusivity but the platform can't yet honour it strictly.

License gate at job-creation time: find the strongest applicable lease for `(creatorIdentityId, clinicId, market, treatmentClass)` with current time in window. Hard locks block; priority locks order; soft locks emit warnings but pass.

### 3.4 `DisclosureTemplate` — registry

Append-only, version-controlled.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `jurisdictionCode` | enum | `SG`, `MY`, `HK` |
| `platform` | enum | `meta`, `tiktok`, `red`, `youtube_shorts` |
| `treatmentClass` | enum | Joins `CreatorIdentitySynthetic.treatmentClass` |
| `version` | int | Monotonic per (jurisdiction, platform, treatmentClass) tuple |
| `text` | text | Disclosure copy |
| `effectiveFrom` | timestamp | |
| `effectiveTo` | timestamp | Nullable; on supersession the next version sets prior `effectiveTo` |

### 3.5 `ScriptTemplate` — first-class scripts (Q6)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `vibe` | enum | Match selector key |
| `treatmentClass` | enum | |
| `text` | text | Atomic script body — hook + body + CTA bundled into a single addressable record |
| `compatibleCreatorIdentityIds` | FK[] → `CreatorIdentity.id` | Restricts which synthetic creators can voice this script |
| `version` | int | |
| `status` | enum | `active`, `retired` |

**v1 atomicity:** one `ScriptTemplate` = one full script. The character cards' separate "Sample hook" and "Sample CTA" fields are seeds content authors use to compose full scripts; they are not separate records. This keeps lineage simple (one `scriptId` per asset) and still supports per-script performance attribution — if Cheryl with a skeptic-style script outperforms Cheryl with a hype-style script, the two scripts are distinct rows. Sub-element decomposition (hook ID + body ID + CTA ID per asset) is reserved for a future slice.

### 3.6 `PcdPerformanceSnapshot` — frozen reference data

Read-only after write. The Q5 overlay reads this; the selector never touches live aggregations.

| Column | Type | Notes |
|---|---|---|
| `version` | string | E.g. `"snap-2026-04-30"` |
| `generatedAt` | timestamp | |
| `dimensions` | JSONB | `{creator, treatmentClass, market, platform, vibe}` keys |
| `metrics` | JSONB | Per-cell `{roas, ctr, cvr, sampleSize}` |
| `methodologyRef` | string | Pointer to the aggregation job version that produced it |

### 3.7 `SyntheticCreatorSelectionDecision` — persisted decision record

One row per job. Referenced by SP9 provenance.

```
{
  briefId: uuid,
  selectedCreatorIdentityId: uuid,
  fallbackCreatorIdentityIds: uuid[],
  selectorVersion: string,        // git SHA of selector module
  selectorRank: int,              // 0 = primary, 1+ = fallback walked to
  metricsSnapshotVersion: string | null,
  performanceOverlayApplied: bool,
  decisionReason: string          // human-readable, e.g. "primary_compatible" | "fallback_license_miss"
}
```

---

## 4. Per-Job Flow

1. Pre-production runs LLM analysis on clinic brief → emits typed `CreativeBrief`.
2. Selector applies compatible-set filter: `treatmentClass`, `market`, `vibe`, `pricePositioning`, `mutuallyExclusiveWithIds`, hard constraints. Operates over `CreatorIdentity` rows joined to `CreatorIdentitySynthetic` where `kind = "synthetic"`.
3. If `metricsSnapshotVersion` provided, overlay re-ranks compatible set. Otherwise default order is by `(CreatorIdentitySynthetic.pricePositioning DESC, CreatorIdentity.id ASC)` — deterministic and content-blind, and gives premium-positioned creators primary preference when no performance signal is available.
4. Emit `SyntheticCreatorSelectionDecision`. `selectorRank: 0` = primary; `1..n` = fallback chain.
5. License gate: find active `CreatorIdentityLicense` for `(selectedCreatorIdentityId, clinicId, market, treatmentClass)`. On miss, advance `selectorRank`, retry. On chain exhaustion, hard-fail `LICENSE_UNAVAILABLE`.
6. Disclosure gate: resolve `DisclosureTemplate` for `(jurisdictionCode, platform, treatmentClass)`. On miss, hard-fail `DISCLOSURE_UNRESOLVABLE`. On hit, snapshot text + version into job.
7. Script selection: deterministic pick from `ScriptTemplate` where `compatibleCreatorIdentityIds CONTAINS selectedCreatorIdentityId AND vibe = brief.vibe AND treatmentClass = brief.treatmentClass AND status = 'active'`. Tie-break by `(version DESC, id ASC)` — newest version wins, then deterministic by id. The selected script's `id` and `version` are recorded in provenance.
8. SP4 routes to character's locked DALL-E + Kling pairing using `CreatorIdentitySynthetic.dallePromptLocked` verbatim.
9. Generation produces asset.
10. SP5 QC runs face-descriptor match against `physicalDescriptors`. On drift > threshold, bounded retry (default 3). On retry exhaustion, fail `QC_DRIFT_UNRESOLVED`.
11. SP9 provenance written.

---

## 5. SP9 Provenance Extension (additive only)

Existing 12 pinned constants from `617a5a2` and lineage zod schemas from `f9f33ea` are unchanged. New keys appended:

```
creatorIdentityKind:         "synthetic"
creatorIdentityId:           <selected creator>
selectorVersion:             <git SHA>
selectorRank:                0..n
metricsSnapshotVersion:      <snap version or null>
performanceOverlayApplied:   bool
licenseId:                   <CreatorIdentityLicense.id at job time>
disclosureTemplateId:        <DisclosureTemplate.id>
disclosureTemplateVersion:   <version at resolution>
resolvedDisclosureText:      <snapshot text, not live ref>
scriptId:                    <ScriptTemplate.id>
scriptVersion:               <version at selection>
modelVersions:               { dalle: "...", kling: "..." }
promptHash:                  sha256(dallePromptLocked)
```

These are additive to the existing SP9 lineage chain (`briefId → trendId → motivatorId → hookId → scriptId`) — `creatorIdentityId` slots between `briefId` and `scriptId` as the new identity-bound rung. Pre-SP10 rows continue to read fine (all new columns nullable, no FK constraints required).

Replay guarantee: given identical `(briefId, selectorVersion, metricsSnapshotVersion, scriptSelectorVersion)`, the selector and script-selector are pure functions and produce identical outputs. Generation is non-deterministic at the model layer, but the *decision lineage* up to generation is exactly reproducible.

---

## 6. The Learning Loop

### 6.1 Snapshot regeneration — configurable cadence

A `MetricsAggregator` job emits a new `PcdPerformanceSnapshot` row at a configurable cadence:

- **Early stage (low data volume): daily snapshots.** Sample sizes are tiny; weekly cadence under-learns and misses momentum windows. Run daily until per-cell sample size reaches a threshold (default `n=200` per `(creator × treatmentClass × market × platform × vibe)` cell).
- **Steady state: weekly snapshots.** Once data is dense, weekly cadence is sufficient and reduces churn in the selector's overlay output.
- **Cadence is itself versioned.** The `MetricsAggregator` job version is recorded on each snapshot's `methodologyRef`. Switching from daily to weekly is a deliberate change visible in provenance.

Snapshots are immutable once written regardless of cadence. Faster cadence does not break replay guarantees — it just produces more snapshot versions to choose from.

### 6.2 Low-confidence boost heuristic

When per-cell `sampleSize < n_threshold`, the overlay should not let thin data dominate the rank. v1 default:

- Below threshold: blend cell metric with the rolled-up parent dimension (e.g., creator-level average across all platforms when `(creator × platform)` cell is sparse).
- Blend weight = `sampleSize / n_threshold`, clipped to `[0, 1]`.
- The exact blending function is part of `selectorVersion` (deterministic, replayable).

This protects the loop from "Cheryl ran 5 times in Hong Kong on RED, all flopped, retire Cheryl" — small-sample noise can't override the larger evidence base. As data grows, the heuristic naturally fades.

### 6.3 Script-weight bias in the overlay (critical)

In the medical-aesthetic / UGC space, **script angle (skeptic, friend, reveal, results-debrief) is expected to dominate creator on performance attribution**. Creator drives trust and relatability; script drives CTR and watch-through. The overlay weighting must reflect this asymmetry:

- v1 default weighting in the overlay's score function: **`scriptWeight ≈ 0.6, creatorWeight ≈ 0.4`** as the starting prior.
- Weights are themselves part of `selectorVersion`; tunable as data accumulates.
- Risk if not done: over-optimising the creator picker, under-optimising scripts, misattributing wins. With Q6 (scripts as first-class records), the data is there to do this right — the weighting just has to lean into it.

Future: joint scoring over `(creator × script)` cells rather than additive blending. Out of v1 scope.

### 6.4 New jobs reference the latest snapshot

Job creation pins the latest snapshot version into the brief's `metricsSnapshotVersion` field. Old assets keep their original snapshot reference — historical provenance never silently changes.

### 6.5 Evolution operations

- **Kill bad creators:** set `CreatorIdentitySynthetic.status = "retired"` (synthetic-specific lifecycle) or `CreatorIdentity.isActive = false` (global on/off). Selector excludes from future compatible sets. Existing assets and their provenance are unaffected.
- **Clone high performers:** create a new `CreatorIdentity` row (`kind: "synthetic"`) + `CreatorIdentitySynthetic` row with derivative `physicalDescriptors` and a fresh `dallePromptLocked`. New ID = new lineage; clone relationship lives in metadata, not the lineage chain.
- **Evolve vibes:** add a new `vibe` enum value + new `ScriptTemplate`s scoped to specific creators via `compatibleCreatorIdentityIds`.
- **Performance overlay weighting:** the overlay's weighting logic is itself versioned (part of `selectorVersion`). Tuning weights (including the script vs creator bias from §6.3) = bumping `selectorVersion`.

### 6.6 Why this preserves governance

The loop is `selection → variation → evaluation → feedback`. Feedback enters only through:
1. New snapshot versions (selector reads frozen data, never live)
2. New `selectorVersion` (selector logic, including weighting and cadence, can be tuned)
3. New `CreatorIdentity` (`kind: "synthetic"`) / `ScriptTemplate` rows (catalogue evolution)
4. Status changes on existing rows (retirement)

Each is auditable, reversible, and traceable in provenance. No knob mutates assets retroactively.

---

## 7. Compliance & The Six Gaps

| Gap | Resolution |
|---|---|
| **Slimming missing from roster** | Excluded from v1 with documented rationale: slimming is the most heavily regulated of the four candidate verticals (MY MCMC + Healthcare Act, SG HSA, HK Trade Description Ordinance). Re-evaluate in Phase 2 once `DisclosureTemplate` registry is battle-tested on lower-risk verticals. |
| **Disclosure strategy unspecified** | `DisclosureTemplate` registry (Q3=A) — jurisdiction × platform × treatment-class, mandatory gate at job creation, snapshotted into provenance. |
| **PCD architecture lane** | Single `CreatorIdentity` table + `kind` discriminator + `CreatorIdentitySynthetic` extension table (Q2=A, anchored on the actual codebase model). Zero structural change to shipped SP1–SP9 surface. |
| **Drift control beyond prompt-locking** | Two-layer: (a) `dallePromptLocked` verbatim per character; (b) per-character ID-anchor reference image set (DALL-E variation seed or Midjourney `--cref`-equivalent), used both at generation and as the QC gate's reference. SP5 face-match enforces. Bounded regeneration retries on drift fail. |
| **Skeptic-converted vibe missing** | Documented Phase 3 addition. Highest-converting med spa creative often pairs a skeptic frame with a result; worth adding a creator + scripts for it once v1 is in market. Not v1 scope. |
| **Nana / Bua substitutability** | `CreatorIdentitySynthetic.mutuallyExclusiveWithIds[]` enforced in selector compatible-set filter. Same-campaign deduplication is a selector concern, not a downstream one. |

---

## 8. Drift Control — Operational Detail

Locked descriptors reduce drift but don't eliminate it. v1 stack covers **identity-level drift** only; **vibe-level drift** is a known gap, deferred to a later slice but tracked here so it doesn't get lost.

### 8.1 v1 — identity-level QC

1. **Prompt locking** — `CreatorIdentitySynthetic.dallePromptLocked` is the single source of truth. Generation pipeline pastes verbatim; never paraphrases or templates.
2. **ID anchor** — each character has a reference image set committed at character creation (DALL-E seed image, Midjourney character reference, or a small per-character LoRA). Provider routing layer (SP4) injects the anchor into every generation call.
3. **Face-descriptor match (SP5)** — between generated asset and reference set. Threshold tunable per character (premium positioning = stricter).
4. **Bounded retry** — 3 retries default. After exhaustion, hard-fail and surface to human review queue. No silent fallback to "best of N drift" assets.

### 8.2 Operational risk: silent retry-cost drag

Bounded retries protect quality, but uncontrolled retry rates create invisible operational cost (extra DALL-E + Kling calls) and silent failure-rate spikes. v1 must surface:

- **Per-character retry rate** as an ops metric: `retries / total_attempts`, alerting if a character crosses (default) 30% over a rolling window. A character regularly needing retries is a signal that the locked prompt or ID anchor needs revision, not an excuse to raise the threshold.
- **Per-job retry count** in `SyntheticCreatorSelectionDecision` metadata, propagated into provenance so the SP9 lineage shows whether an asset was a clean first-pass or a recovered third retry.
- **Hard-fail rate** (`QC_DRIFT_UNRESOLVED`) as a separate alert — distinct from retry-rate, since a high hard-fail rate means the character should be temporarily retired, not just monitored.

### 8.3 v2 gap — vibe-level / perceptual QC

Identity-level QC catches "Cheryl's face changed." It does **not** catch:

- **Vibe drift** — Cheryl rendered in a calm composed pose for an "Omg Look" brief. Face matches; energy doesn't.
- **Energy drift** — facial expressions reading mature when the character spec is Gen Z chaos.
- **Context drift** — the bathroom mirror lighting that's part of the brief gets replaced by beauty lighting.

Performance depends on perceptual + emotional consistency, not just facial geometry. v2 will need:

- **Vibe-tag classification** on generated assets (separate model run; classify into `omg_look | quiet_confidence | …`); reject if mismatched against `brief.vibe`.
- **Setting/lighting heuristics** — caption-the-image, check for keywords matching the locked Kling direction's "Setting" / "Lighting" fields.
- These checks are deferred to a later slice; the schema here intentionally has room (`CreatorIdentitySynthetic.klingDirection` is structured) so v2 work is additive.

### 8.4 Cost & rationale

A reference-image regeneration run is cheaper than the cumulative campaign damage of Cheryl-in-ad-12 not looking — or feeling — like Cheryl-in-ad-1. But silent retry drag is more expensive than people realise; the ops surface in §8.2 is non-negotiable from v1.

---

## 9. Test Strategy

- **Pure modules unit-tested with fixtures:**
  - `SyntheticCreatorSelector(brief, snapshot)` — table-driven cases covering compatible-set filter, overlay re-ranking, `mutuallyExclusiveWith`, fallback ordering.
  - `ScriptSelector(brief, creatorIdentityId)` — table-driven across vibe × treatment.
  - `DisclosureResolver(jurisdiction, platform, treatmentClass)` — coverage matrix per supported jurisdiction × platform × treatment-class.
  - `LicenseGate(creatorIdentityId, clinicId, market, treatmentClass, now)` — active / suspended / expired / out-of-window.
- **SP9 attestation tests:**
  - For a frozen brief + frozen `selectorVersion` + frozen `metricsSnapshotVersion`, the same `creatorIdentityId` is chosen across N runs.
  - Provenance records contain all required new fields and pass the lineage zod schemas.
- **Integration tests:**
  - End-to-end: brief in → asset metadata + provenance out, with stubbed model calls.
  - License-fail / disclosure-fail / QC-drift-fail paths each produce the expected hard-fail.
- **No mocking of the registry tables in DB tests** — real Postgres, real fixtures (matching existing CreativeAgent test conventions).

Co-located `*.test.ts` per CLAUDE.md.

---

## 10. Merge-back to Switchboard

Strictly additive at every layer:

- **Schema changes:** one column on existing `CreatorIdentity` (`kind`, default `"real"`). Six new tables: `CreatorIdentitySynthetic`, `CreatorIdentityLicense`, `DisclosureTemplate`, `ScriptTemplate`, `PcdPerformanceSnapshot`, `SyntheticCreatorSelectionDecision`. Additive provenance columns on existing `PcdIdentitySnapshot`. Zero renames, zero column drops, zero data backfills against tables already on Switchboard `main`.
- **Provenance:** additive fields only. Existing 12 pinned constants and lineage zod schemas keep their meaning.
- **Package boundaries unchanged:** `packages/schemas/` gets new files for `creative-brief.ts`, `creator-identity-synthetic.ts`, `disclosure-template.ts`, `creator-identity-license.ts`, `script-template.ts`, `pcd-performance-snapshot.ts`. `packages/db/` gets corresponding stores. `packages/creative-pipeline/` gets `synthetic-creator-selector/`, `script-selector/`, `disclosure-resolver/`, `license-gate/`, `metrics-aggregator/`.
- **Sed-pass for `@creativeagent/*` → `@switchboard/*`** still works mechanically.
- **No imports from outside the PCD scope** introduced (per `CLAUDE.md` merge-back rules). If selector logic eventually needs Switchboard-side concepts (e.g. a `Clinic` type richer than the local stub), define a minimal local contract; let Switchboard supply the real one at merge time.

---

## 11. Out of v1 Scope (explicit)

- Real-PCD changes
- Slimming vertical
- Skeptic-converted vibe + character
- D-tier free pool (post-volume)
- Multi-character ads (two synthetic creators in the same asset)
- Mid-campaign creator swaps without a new lineage chain
- Dynamic disclosure copy (clinic-supplied overrides — Q3=D, planned v1.5)
- Cross-jurisdiction creator transferability (each character is currently single-market by design)
- Real-creator + synthetic-creator hybrid casts in the same asset
- Vibe-level / perceptual QC (§8.3 — identity-level QC ships in v1; vibe-level deferred)
- Joint `(creator × script)` scoring in the overlay (§6.3 — additive script-bias weighting ships in v1)
- **Standalone-product positioning.** This is not shipped or sold as a creative tool independent of the lead-capture / conversion stack (§1 wedge anchoring). Bundling decisions belong to the GTM doc, not this spec, but the technical scope here is explicitly the amplifier track.

---

## 12. Open Questions / Known Unknowns

1. **Disclosure copy authorship** — does v1 ship with a fixed set of jurisdiction × platform × treatment-class templates drafted in advance, or with a registry shape and one seed template that legal fills in pre-launch?
2. **Reference image source-of-truth** — for the ID anchor, the option set is (a) commit reference images to the repo as binary assets, (b) store in object storage and reference by URL, (c) train a small per-character LoRA and reference its checkpoint hash, (d) some combination. Tradeoff: reproducibility-from-repo (a) vs. asset-size hygiene (b) vs. consistency-strength (c). Affects merge-back.
3. **Performance overlay weighting function** — v1 default is `scriptWeight ≈ 0.6, creatorWeight ≈ 0.4` with low-confidence parent-blend (§6.2, §6.3). Worth scoping a more sophisticated function (Bayesian, multi-armed bandit, joint `(creator × script)` scoring) for v2 once enough data exists.
4. **Fallback exhaustion UX** — when the selector walks the full fallback chain and all are license-unavailable, does the job hard-fail to the clinic or queue for human review? Lock-type tiers (§3.3) reduce frequency but don't eliminate the case.
5. **Snapshot regeneration cadence** — daily early / weekly steady-state is the v1 plan, gated by per-cell sample size threshold (§6.1). Threshold value (`n=200` default) is a guess; tune from real spend velocity.
6. **Treatment-class taxonomy stability** — the four-class enum is tight enough for v1 but might fragment as the roster grows (e.g. "med_spa" → "fillers" / "skin_boosters" / "laser"). Keep as a single enum for now; plan a hierarchical migration if/when it stops fitting.
7. **Lease default duration** — 30 days per §3.3 is the v1 default. Shorter (14 days) reduces lockup risk further but increases renewal churn for the clinic. Likely needs A/B observation post-launch.
8. **Retry-rate alert thresholds** — 30% (§8.2) is a guess; real number depends on per-character drift behaviour observed in pilot.
9. **CAPI / conversion-signal feed** — when does the `PcdPerformanceSnapshot` schema gain a `conversionMetric` dimension fed from Alex / CAPI rather than ad-platform CTR/ROAS? This is the key "wedge anchoring" hookup (§1) and is out of scope for v1, but the integration shape should be sketched before SP10 ships so the schema doesn't need a backwards-incompatible migration.

---

## 13. Implementation Slicing (preview, not a plan)

Likely slice ordering for the writing-plans phase. Each slice is independently shippable:

- **SP10** — `CreativeBrief` schema + `CreatorIdentity.kind` column + `CreatorIdentitySynthetic` table + 10-character seed data
- **SP11** — `CreatorIdentityLicense` table + license-gate module
- **SP12** — `DisclosureTemplate` registry + disclosure-resolver module
- **SP13** — `SyntheticCreatorSelector` (compatible-set only, no overlay)
- **SP14** — `ScriptTemplate` table + `ScriptSelector` (deterministic, vibe-matched)
- **SP15** — Provider routing extension for `kind: synthetic` (locked DALL-E + Kling)
- **SP16** — SP9 provenance extension (new fields + zod schema additions)
- **SP17** — `PcdPerformanceSnapshot` + `MetricsAggregator` job
- **SP18** — Performance overlay in selector
- **SP19** — SP5 QC face-match for synthetic
- **SP20** — End-to-end integration tests + first clinic onboarding

Sequencing TBD in the implementation plan. SP10–SP14 are largely parallelisable.

---

## 14. Critique Folded In (audit trail)

This spec went through one round of strategic review after the initial draft. The critique surfaced five concrete weaknesses; each is addressed in the spec body. Recorded here so the next reviewer can see what was challenged and how the design evolved.

| # | Critique | Where addressed | Resolution |
|---|---|---|---|
| C1 | **Bottleneck is scripts, not creators.** Hook angle (skeptic, friend, reveal) drives CTR; creator drives trust. Risk: over-optimise creators, under-optimise scripts, misattribute wins. | §6.3 | Overlay weighting biased `scriptWeight ≈ 0.6, creatorWeight ≈ 0.4` from v1. Joint scoring deferred but tracked in §11 / §12. |
| C2 | **Hard exclusivity creates early-stage supply lockup.** With a 10-character roster, hard locks surface "no creator available" failures during onboarding — fatal for product feel. | §1 (Q1 row), §3.3 | Three lock-types (`hard_exclusive`, `priority_access`, `soft_exclusive`); v1 default is `priority_access` with 30-day time-boxed leases. |
| C3 | **QC catches face drift, not vibe drift.** Identity-level QC misses energy / setting / emotional drift, which is what actually drives performance. Retry loops also create silent operational drag. | §8.1–§8.4 | v1 ships identity-level QC (face-match) + retry-rate ops surface (alerts at 30%) + per-job retry counts in provenance. Vibe-level / perceptual QC explicitly listed as a v2 gap (§8.3, §11). |
| C4 | **Weekly snapshot cadence is too slow for early-stage learning.** Tiny sample sizes mean weekly cadence misses momentum windows; loop is governance-perfect but growth-suboptimal. | §6.1, §6.2 | Configurable cadence — daily early-stage until per-cell `n=200`, weekly thereafter. Low-confidence boost heuristic blends sparse cells with parent-dimension averages. Both versioned via `selectorVersion`. |
| C5 | **Positioning risk: this is amplifier, not wedge.** If shipped as a standalone "AI creator tool" the product loses differentiation and becomes a HeyGen / Runway clone. The wedge stays lead capture (Alex). | §1 (subsections "What this is" + "Wedge anchoring"), §11 | Spec now explicitly frames the system as supply infrastructure attached to the conversion stack, with the eventual learning loop pulling from CAPI / Alex conversion signals. Standalone-product positioning listed as out-of-scope. |

The structural thesis from the critique — *this is not a creative generator, it is a controlled synthetic supply infrastructure with governance guarantees* — is now stated in §1 and is the framing the implementation plans should preserve.

---

*End of design spec. Awaiting user review per brainstorming skill review gate before transitioning to writing-plans.*
