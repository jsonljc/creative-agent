# PCD SP17 — Synthetic Provider Routing: Seedance Extension — Design Spec

**Date:** 2026-05-15
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (solo brainstorming, 4 review-gate sections, dialogue compressed at user's instruction)
**Predecessor slice:** SP16 (synthetic provider routing, squash `04f14b1`, PR #16 — single-row matrix → kling)
**Successor slice reserved by name:** SP18 (snapshot/provenance widen on `PcdIdentitySnapshot`, will persist `imageProvider`, `videoProvider`, `videoProviderChoice`, `syntheticRouterVersion`, `pairingVersion`, `promptHash`, `syntheticRoutingDecisionReason Json` — formerly the SP17 plan in pre-brainstorm framing; pivoted to SP18 once Seedance entered scope)

---

## 1. Scope & Strategy

SP17 widens SP16's synthetic routing layer so the end user (via composer) picks the video provider per shot from a two-row pairing matrix: **Kling** (existing) or **Seedance** (new). Image side (DALL-E) is unchanged. The choice flows in via a new `videoProviderChoice: "kling" | "seedance"` required input parameter on `RouteSyntheticPcdShotInput`; the matrix gates legality; the per-character `seedanceDirection` (structured `{setting, motion, energy, lighting, avoid[]}` mirroring `KlingDirection` exactly, distinct named type) is read verbatim into the success decision. **When Seedance is selected and legal, the per-character `seedanceDirection` is copied verbatim into the success decision. If it is null, the router denies with `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` — a distinct denial kind, never `ACCESS_POLICY`, never silent fallback.**

**Key inflection (SP16 → SP17):** SP16's decision was deterministic from `(shotType, outputIntent)` alone. SP17 makes provider selection user-driven within matrix-gated legality. The matrix grows from 1 row to 2; the decision union grows from 3 branches to 5 (synthetic-allowed-kling, synthetic-allowed-seedance, synthetic-denied-ACCESS_POLICY, synthetic-denied-NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER, delegation-to-SP4). `seedanceDirection` is nullable on the SP11 payload — existing 30 roster creators stay kling-only until a future content/backfill slice.

**Scope guardrail (user-approved, §2.1 below):** SP17 may edit the SP16 canonical router body only to widen it from one video provider to two. It must NOT introduce a parallel `routeSyntheticPcdShotV2`, hidden fallback behavior, runtime provider execution, persistence writes onto `PcdIdentitySnapshot`, or composer coupling. The router is being widened, not superseded.

**What SP17 deliberately does NOT do:**

- **No snapshot/provenance persistence widen.** SP18 owns `PcdIdentitySnapshot` provenance fields (`imageProvider`, `videoProvider`, `videoProviderChoice`, `syntheticRouterVersion`, `pairingVersion`, `promptHash`, `syntheticRoutingDecisionReason Json`). SP17 does add a single nullable `seedanceDirection Json?` column to `CreatorIdentitySynthetic` because the router needs a typed source artifact to deny or allow Seedance honestly — without it, the router can only work against in-memory test fixtures, which is too artificial. `CreatorIdentitySynthetic` is the authored identity source; widening it is the correct substrate.
- **No `INVALID_VIDEO_PROVIDER_CHOICE` scaffolding.** Reserved-by-name in §4.4; zero source presence.
- **No roster backfill.** 30 SP11 roster creators stay `seedanceDirection: null` after SP17 lands. The SP11 seed file is unchanged.
- **No real Seedance API call.** Provider-call layer is out of PCD scope.
- **No composer wiring** (SP21).
- **No SP4 edits** (`routePcdShot`, `PCD_PROVIDER_CAPABILITY_MATRIX`, `tier3-routing-rules.ts`). Delegation calls SP4 unchanged.
- **No SP12/SP13 edits.** License gate + synthetic-creator selector are upstream of SP17.
- **No silent fallback** Kling↔Seedance (schema-locked per §4.2).
- **No `klingDirection` ↔ `seedanceDirection` auto-derivation.** They are semantically distinct artifacts even at v1's shared shape.
- **No `voiceCaptionStyle` widen** — Seedance has no voice impact at the artifact layer.

---

## 2. Locked decisions

### 2.1 Scope guardrail (user-approved)

> SP17 may edit the SP16 canonical router body only to widen it from one video provider to two. It must NOT introduce a parallel `routeSyntheticPcdShotV2`, hidden fallback behavior (no auto-degrade to Kling when Seedance lacks direction), runtime provider execution, persistence writes onto `PcdIdentitySnapshot`, or composer coupling. The router is being widened, not superseded. Missing Seedance direction produces `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` — a distinct denial kind, never `ACCESS_POLICY`, never silent fallback.

This guardrail is enforced as source-level + behavioral assertions in `sp17-anti-patterns.test.ts` (§5.4).

### 2.2 Decisions settled in this brainstorm

| # | Decision | Rationale |
|---|---|---|
| Q1 | **SP17 is matrix extension + SP11 artifact widen ONLY; snapshot/provenance persistence is deferred to SP18.** | Brainstorm pivot: original SP17 framing (provenance widen) became SP18 once Seedance entered scope. The umbrella roster spec §5 line 263 fields all land on `PcdIdentitySnapshot` in SP18. SP17 ships routing + per-creator artifact substrate only. |
| Q2 | **Seedance is an alternative video provider, not parallel or additional-modality.** End user picks Kling OR Seedance per shot (mutually exclusive). | User direction. Avoids A/B/parallel-outputs concerns. Both providers consume the same DALL-E keyframe — they're alternative animation engines for the same image anchor. |
| Q3 | **`seedanceDirection` is a structured object that mirrors `KlingDirection` shape exactly** — `{setting, motion, energy, lighting, avoid[]}`. **Distinct named zod schema and TypeScript type** to prevent cross-binding. | User direction. Same field set is the v1 reality (the structured-direction concept is the unit; the model behind it differs). Distinct types make `kling-choice requires klingDirection` and `seedance-choice requires seedanceDirection` un-bypassable at the type-system layer. Easier to evolve Seedance's shape later without breaking Kling. |
| Q4 | **`seedanceDirection` is nullable on `CreatorIdentitySyntheticPayloadSchema`** — existing 30 SP11 roster creators stay kling-only at SP17 land. A future content slice backfills. | User direction. Don't fake Seedance coverage. Don't auto-derive from Kling. Don't silently fall back to Kling unless that fallback is explicitly modeled (it isn't). The system preserves the truth: Kling is production-authored; Seedance is structurally supported but not yet roster-authored. |
| Q5 | **End user picks video provider via new required input `videoProviderChoice: "kling" \| "seedance"` on `RouteSyntheticPcdShotInput`.** Choice is per-shot, not per-character or per-org. | User direction. SP21 composer resolves the choice (user UI, persisted job state, or campaign default — SP21's call). SP17 ships it as a typed required input, agnostic to origin. |
| Q6 | **Matrix gates legality.** Both providers' rows in v1 cover the full 7 video shot types × 4 output intents — no `INVALID_VIDEO_PROVIDER_CHOICE` reachable in v1. | User direction. Maximum end-user agency in v1; matrix is the source of truth for future provider-specific narrowing. |
| Q7 | **Matrix grows from 1 row to 2 rows partitioned by `videoProvider`.** Lookup keyed by 3-tuple `(shotType, outputIntent, videoProvider)`. | User direction (per-shot-type split → became per-provider-row when both providers cover all shots). Matches SP16's row shape, extended with the videoProvider partition. Future provider-specific narrowing edits a single row, doesn't add routing concepts. |
| Q8 | **Decision union widens from 3 branches (SP16) to 5 (SP17).** Two new branches: synthetic-allowed-seedance (provider-specific success), synthetic-denied-NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER. | User direction. Per-provider success branches give strong typing per provider (each branch carries only the relevant direction artifact). The denial branch keeps Seedance-absent semantically distinct from access-policy denial. |
| Q9 | **`videoProviderChoice` is echoed on both success branches AND the missing-direction denial branch, via `z.literal()` per branch (not `z.union().refine()`).** Schema-level equality lock: `videoProviderChoice === videoProvider` is structurally guaranteed. | User direction. Branch-level `z.literal()` makes impossible states unrepresentable; `.refine()` is weaker because the broad shape can still exist before refinement and TypeScript narrowing is messier. If a future slice ever introduces explicit fallback, the schema has to widen to relax the literal equality — forcing design review. |
| Q10 | **`videoProviderChoice` is NOT echoed on the delegation branch or the ACCESS_POLICY denial branch.** | Delegation means the synthetic router didn't produce a synthetic provider decision — it handed off to SP4. Surfacing the choice on delegation would imply Seedance/Kling was evaluated as an output provider; it wasn't. SP21 retains the original choice in its own logs. ACCESS_POLICY fires before the chosen-provider check, so the choice didn't materially affect the denial. |
| Q11 | **Edit the SP16 canonical router body — don't wrap.** `routeSyntheticPcdShot` is widened in place; function name, file path, and export site are unchanged. | User direction. SP17 is not replacing SP16 behavior; it's evolving the same router from a single-provider matrix to a multi-provider matrix. A V2 wrapper would add ceremony without giving much safety and would force future slices to remember which router is canonical. The SP10A→SP16 wrap precedent applied to layered cost/budget/provenance concerns, not to evolutions of a router's own concept. |
| Q12 | **Edit `sp16-anti-patterns.test.ts` in place** to relax matrix-integrity literal expectations (length 1 → 2, single `videoProvider === "kling"` → membership-style check, version literals `1.0.0` → `1.1.0`). Purity, token-blacklist, and cross-slice assertions are unchanged. | User direction. SP17 intentionally widens the canonical SP16 router; updating SP16's anti-pattern expectations is consistent. CLAUDE.md's "no edits to SP1–SP16 source bodies" applies to runtime source; test-file literal updates that reflect a deliberate matrix evolution are the established precedent (SP10A→SP16 anti-pattern allowlist extensions all edit prior anti-pattern tests, not just append). |
| Q13 | **Bump existing version literals 1.0.0 → 1.1.0 in place, not introduce `_V2_VERSION` constants.** Pinned-constant count stays at 21. | User direction. Single-source rule says one site per literal; the literal value can change at that site without violating it. SP18 will persist the current router/pairing version used for the decision; no historical replay against `1.0.0` is in scope, so no second live constant is needed. |
| Q14 | **Routing step order is strict.** Step 1: matrix lookup (3-tuple). Step 2: delegate if no row. Step 3: tier policy gate (ACCESS_POLICY if denied). Step 4: direction-authored check (NO_DIRECTION_AUTHORED if chosen provider's direction is null). Step 5: per-provider success branch. | User direction. Denial taxonomy stays clean: ACCESS_POLICY = user/account/tier not allowed; NO_DIRECTION = provider is allowed but authored direction is missing; delegation = shot/intent/provider tuple is outside synthetic pairing. NO_DIRECTION_AUTHORED only fires after matrix-legality and access-policy both pass. |
| Q15 | **`SeedanceDirectionSchema` is a NET-NEW exported schema in `creator-identity-synthetic.ts`** with identical structure to `KlingDirectionSchema` but distinct named export. No reuse of `KlingDirectionSchema` for Seedance. | User direction. Even though the shape is the same today, the artifacts are semantically distinct (Seedance API ≠ Kling API). The router rule is provider-specific. Type-system separation prevents accidental cross-binding now and the divergence is easy to absorb later. |

### 2.3 Judgment calls baked into this spec (open to push-back at the user review gate)

| # | Decision | Rationale |
|---|---|---|
| J1 | **`CreatorIdentitySyntheticPayloadSchema.seedanceDirection: SeedanceDirectionSchema.nullish()`** (NOT `.nullable()`), with downstream normalization `parsed.seedanceDirection ?? null` at store-write/router-entry boundaries. | Existing SP11 roster fixtures may omit the field (parses as `undefined`); Prisma's `Json?` column returns `null`. `.nullish()` accepts both at parse time. Normalization to `null` immediately after parse means the router treats one missing-state (`null`) and never branches on both `undefined` and `null`. Rule of three: schema accepts nullish; store/domain normalizes to null; router treats null as missing. |
| J2 | **`SeedanceDirectionSchema` is exported from `creator-identity-synthetic.ts` (same file as `KlingDirectionSchema`)** alongside the type. The barrel `packages/schemas/src/index.ts` re-exports both. | Co-located with the SP11 payload schema (which is the only consumer). Mirrors how `KlingDirectionSchema` ships from the same file. Avoids a new file for a 7-line schema. |
| J3 | **Pairing matrix v1 (SP17) — 2 rows, both rows cover all 7 video shot types × 4 output intents.** | Maximum end-user agency in v1 per Q6 user direction. Both rows structurally identical except for `videoProvider` + (implicit) per-row direction-artifact requirement. Provider-specific narrowing is a future-PR design call when there's a real capability gap to encode. |
| J4 | **Function signature widening is additive — `videoProviderChoice` is a required field on `RouteSyntheticPcdShotInput`.** Not optional with a default. | Optional-with-default ("default kling for back-compat") would hide the new contract and let composer callers forget to plumb the choice. Required input forces the call site to make the decision explicit. SP21 has no SP17 callsites yet — there's no real back-compat constraint. |
| J5 | **Delegation branch's `reason` literal stays unchanged: `"shot_type_not_in_synthetic_pairing"`.** Comment annotates it as a legacy SP16 literal that in SP17 now covers any out-of-pairing tuple (shot type, output intent, or provider choice). | User direction (§4.1 amendment). Avoid schema churn; document the semantic widening; rename later only if provider-specific matrix narrowing introduces a real INVALID_VIDEO_PROVIDER_CHOICE branch that needs taxonomic separation. In v1, all three tuple-axes are universally covered, so the literal still semantically maps to "tuple not in pairing" — the only out-of-tuple case reachable is out-of-row shot type. |
| J6 | **Anti-pattern tests split source-level vs. behavioral.** Source-level: no V2 router symbol, no V2 file, single-source version pins. Behavioral: seedance choice + null direction denies (never silent kling success); verbatim seedanceDirection on seedance-success; schema-level lock that `videoProviderChoice === videoProvider` on success branches. | User direction (§3 review). Source-string parsing is brittle for behavioral invariants; calling the real router is deterministic and survives source refactors. Source-level checks stay for what they're cheap and reliable for. |
| J7 | **No `seedanceDirection` index on the Prisma column.** Nullable `Json?`, no query against it by SP17 callers. | The router reads `seedanceDirection` via the SP11 payload reader, which is keyed by `creatorIdentityId` (already indexed). No SP17 query slices on direction-existence. Future analytics needs (e.g., "which creators have Seedance authored") can add an index in the backfill slice. |
| J8 | **`pairingRefIndex` semantics widen — now equals the row's index in the 2-row matrix.** Kling success → 0; Seedance success → 1. Anti-pattern test (formerly asserting `=== 0` in SP16) becomes `=== matrix.findIndex(r => r.videoProvider === decision.videoProvider)`. | Matches SP4's `capabilityRefIndex` forensic semantics. Preserves the field's meaning across matrix evolution. |
| J9 | **No new pinned PCD constants.** `PCD_SYNTHETIC_ROUTER_VERSION` bumps to `1.1.0`; `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION` bumps to `1.1.0`. Pinned count stays at 21. | Q13 user direction. The two existing literals capture v2 router-logic and v2 matrix-data versions; no third constant is needed. |
| J10 | **Allowlist maintenance touches 8 prior anti-pattern test files** (SP9, SP10A–C, SP13, SP14, SP15, SP16). | Continuation of the SP10A→SP16 precedent. SP16 itself is now a prior slice that needs allowlist widening for SP17's net-new files. |
| J11 | **Branch name: `pcd/sp17-synthetic-provider-routing-seedance`.** Worktree: `.worktrees/sp17`. | Matches SP14/SP15/SP16 naming convention. User-approved. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  creator-identity-synthetic.ts                    [edit — add SeedanceDirectionSchema + widen CreatorIdentitySyntheticPayloadSchema with .nullish() field]
  __tests__/creator-identity-synthetic.test.ts     [edit — add cases for seedanceDirection null/undefined/populated round-trip]
  pcd-synthetic-router.ts                          [edit — 5-branch SyntheticPcdRoutingDecisionSchema; widen RouteSyntheticPcdShotInput type]
  __tests__/pcd-synthetic-router.test.ts           [edit — full branch coverage + schema-level literal-equality lock]
  index.ts                                         [edit — re-export SeedanceDirectionSchema, SeedanceDirection]

packages/db/prisma/
  schema.prisma                                    [edit — add seedanceDirection Json? to CreatorIdentitySynthetic]
  migrations/20260515HHmmSS_pcd_creator_identity_synthetic_sp17_seedance_direction/migration.sql   [new — additive, nullable, no FK, no index]

packages/db/src/stores/
  prisma-creator-identity-synthetic-store.ts       [edit — round-trip seedanceDirection; normalize undefined → null on read/write]
  prisma-creator-identity-synthetic-store.test.ts  [edit — round-trip null + populated]

packages/creative-pipeline/src/pcd/synthetic-router/
  synthetic-router-version.ts                      [edit — bump literal 1.0.0 → 1.1.0]
  synthetic-provider-pairing.ts                    [edit — matrix grows to 2 rows; bump pairing version literal 1.0.0 → 1.1.0; widen SyntheticProviderPairing.videoProvider union]
  synthetic-provider-pairing.test.ts               [edit — assert 2 rows, both providers, both row coverages]
  route-synthetic-pcd-shot.ts                      [edit — videoProviderChoice required input; 5-branch return; new failure kinds; per-provider success branches; normalize seedanceDirection null at entry]
  route-synthetic-pcd-shot.test.ts                 [edit — full branch coverage; NO_DIRECTION_AUTHORED tests; choice-equality invariant; determinism with approvedCampaignContext-no-perturb]
  sp16-anti-patterns.test.ts                       [edit — relax literals to v2 (length=2, two videoProviders, pairing-version 1.1.0, router-version 1.1.0); purity/token-blacklist/cross-slice assertions UNCHANGED]
  sp17-anti-patterns.test.ts                       [new — 5 assertions (source-level + behavioral) per §5.4]

— allowlist maintenance —
packages/creative-pipeline/src/pcd/{provenance,cost,...}/sp{9,10a,10b,10c,13,14,15,16}-anti-patterns.test.ts
                                                   [edit — extend allowlists with SP17 net-new files]
```

No new pinned PCD constants. Pinned-constant count stays at 21 (Q13/J9).

### 3.2 SP11 widen — `creator-identity-synthetic.ts`

```ts
// SP17 — Seedance direction artifact. Field set mirrors KlingDirectionSchema
// exactly (verified: same {setting, motion, energy, lighting, avoid[]} shape).
// Distinct named type so call sites cannot accidentally cross-bind to a Kling
// direction. Nullable on the payload — existing SP11 roster (30 creators) is
// kling-only at SP17 land; a future content slice backfills.
//
// MERGE-BACK: net-new SP17 schema. No reconciliation needed (net-new on both
// sides). If Switchboard adds Seedance-specific fields later, this schema
// widens here first and merges back additively.
export const SeedanceDirectionSchema = z
  .object({
    setting: z.string().min(1),
    motion: z.string().min(1),
    energy: z.string().min(1),
    lighting: z.string().min(1),
    avoid: z.array(z.string().min(1)).readonly(),
  })
  .readonly();
export type SeedanceDirection = z.infer<typeof SeedanceDirectionSchema>;

export const CreatorIdentitySyntheticPayloadSchema = z
  .object({
    // ...existing fields unchanged...
    klingDirection: KlingDirectionSchema,
    // SP17: nullish() at ingestion for back-compat with omitted-key roster
    // fixtures; downstream consumers (DB store, router) normalize undefined
    // → null so only one missing-state exists in domain logic. MERGE-BACK:
    // nullable for v1; existing 30 SP11 roster creators are kling-only until
    // a future content-authoring slice backfills.
    seedanceDirection: SeedanceDirectionSchema.nullish(),
    voiceCaptionStyle: VoiceCaptionStyleSchema,
    // ...
  })
  .readonly();
```

**Normalization rule (J1):**
- Schema accepts `nullish()` (null | undefined | value).
- DB store and router entry-point normalize `undefined → null` immediately after parse.
- Router treats `null` as the single missing-state.

### 3.3 Prisma migration

```sql
-- SP17: add nullable seedanceDirection JSON column to CreatorIdentitySynthetic.
-- Additive, nullable, no FK, no index. Pre-SP17 rows read fine (returns NULL).
ALTER TABLE "CreatorIdentitySynthetic" ADD COLUMN "seedanceDirection" JSONB;
```

```prisma
model CreatorIdentitySynthetic {
  // ...existing fields unchanged...
  klingDirection            Json
  seedanceDirection         Json?     // SP17 — nullable; null = no Seedance authored
  voiceCaptionStyle         Json
  // ...
}
```

### 3.4 Pairing matrix v2 — `synthetic-provider-pairing.ts`

```ts
// PCD slice SP16/SP17 — 21st pinned PCD constant, bumped to v1.1.0 in SP17.
// Pairing-data version. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (which
// versions the routing logic). Bumped because v1 had one row (kling); v1.1.0
// adds a second row (seedance), partitioning lookups by 3-tuple.
//
// MERGE-BACK: Same provenance-replay assessment as router version.
export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.1.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling" | "seedance";  // SP17 widening
};

// SP17 — v2 matrix. Two rows partitioned by videoProvider; both rows cover
// the full 7 video-modality shot types × 4 output intents in v1.1.0. End user
// (via composer) picks videoProviderChoice; the router validates the
// (shotType, outputIntent, videoProvider) 3-tuple against this matrix.
//
// MERGE-BACK: Future provider-specific narrowing (e.g., Seedance loses
// label_closeup) edits a row's shotTypes array. Adding INVALID_VIDEO_PROVIDER_
// CHOICE as a reachable denial requires the slice that introduces the
// narrowing to add the denial branch, the routing step, and the tests.
export const PCD_SYNTHETIC_PROVIDER_PAIRING: ReadonlyArray<SyntheticProviderPairing> = [
  {
    shotTypes: ["simple_ugc", "talking_head", "product_demo", "product_in_hand", "face_closeup", "label_closeup", "object_insert"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    imageProvider: "dalle",
    videoProvider: "kling",
  },
  {
    shotTypes: ["simple_ugc", "talking_head", "product_demo", "product_in_hand", "face_closeup", "label_closeup", "object_insert"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    imageProvider: "dalle",
    videoProvider: "seedance",
  },
] as const;
```

### 3.5 Router-logic version — `synthetic-router-version.ts`

```ts
// PCD slice SP16/SP17 — 20th pinned PCD constant, bumped to v1.1.0 in SP17.
// Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION
// (which versions the pairing data). Bumped because v1.1.0 branches on
// videoProviderChoice and adds the direction-authored check (Step 4).
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment (SP18 will persist
// it onto PcdIdentitySnapshot).
export const PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.1.0";
```

### 3.6 Decision union v2 — `pcd-synthetic-router.ts`

```ts
// NB: `z.union` not `z.discriminatedUnion`. Same NB carve-out as SP13/SP14/
// SP15/SP16 — Zod 3.x's discriminatedUnion factory does not see literal
// discriminators on branches wrapped in `.readonly()`. `z.union` parses by
// trying members in order; semantically equivalent for our five-branch
// decision shape.
export const SyntheticPcdRoutingDecisionSchema = z.union([
  // Branch 1 — Synthetic path, tier policy denied (UNCHANGED from SP16).
  z
    .object({
      allowed: z.literal(false),
      kind: z.literal("synthetic_pairing"),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema.readonly(),
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),

  // Branch 2 — Synthetic path, no direction authored for chosen provider (NEW, SP17).
  // Distinct denial kind — NEVER conflated with ACCESS_POLICY, NEVER silently
  // degraded to the other provider.
  z
    .object({
      allowed: z.literal(false),
      kind: z.literal("synthetic_pairing"),
      denialKind: z.literal("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER"),
      videoProviderChoice: z.union([z.literal("kling"), z.literal("seedance")]),
      accessDecision: PcdTierDecisionSchema.readonly(),
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),

  // Branch 3 — Synthetic path, allowed, KLING. Mirrors SP16 success branch
  // verbatim, plus videoProviderChoice echo (per-branch z.literal equality
  // lock: videoProvider === videoProviderChoice is structurally guaranteed).
  z
    .object({
      allowed: z.literal(true),
      kind: z.literal("synthetic_pairing"),
      accessDecision: PcdTierDecisionSchema.readonly(),
      imageProvider: z.literal("dalle"),
      videoProvider: z.literal("kling"),
      videoProviderChoice: z.literal("kling"),
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

  // Branch 4 — Synthetic path, allowed, SEEDANCE (NEW, SP17).
  z
    .object({
      allowed: z.literal(true),
      kind: z.literal("synthetic_pairing"),
      accessDecision: PcdTierDecisionSchema.readonly(),
      imageProvider: z.literal("dalle"),
      videoProvider: z.literal("seedance"),
      videoProviderChoice: z.literal("seedance"),
      dallePromptLocked: z.string().min(1).max(4000),
      seedanceDirection: SeedanceDirectionSchema,
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

  // Branch 5 — Delegation (UNCHANGED from SP16).
  // reason: "shot_type_not_in_synthetic_pairing" is the SP16 legacy literal.
  // In SP17 it now covers any out-of-pairing tuple — shot type, output intent,
  // OR videoProviderChoice — collapsed into one literal for back-compat. A
  // future provider-narrowing slice that introduces a separate denial path
  // (e.g., INVALID_VIDEO_PROVIDER_CHOICE) should rename the literal then.
  // videoProviderChoice is NOT echoed on this branch: delegation means the
  // synthetic surface was bypassed and SP4's decision is authoritative.
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

**Reserved-by-name (NOT implemented in v1):** `INVALID_VIDEO_PROVIDER_CHOICE` — reserved design note only. Not implemented in SP17 because the input type already restricts provider choice to `"kling" | "seedance"` (TypeScript-narrowed at compile time), and both matrix rows cover the full current synthetic shot set. If a future matrix removes coverage for a provider-shot pair, that slice must add the denial branch, the routing step, and tests. SP17 ships zero scaffolding for the reserved name; it lives only in this design doc, not in source.

### 3.7 Router function signature

```ts
export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  videoProviderChoice: "kling" | "seedance";   // NEW (SP17) — required, not optional
  approvedCampaignContext: ApprovedCampaignContext;
};

export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision>;
```

Function name, file path, and export site are **identical** to SP16 — this is canonical-router extension, not V2 wrapping (per §2.1 guardrail).

### 3.8 Barrel re-exports

- `packages/schemas/src/index.ts` — add re-exports for `SeedanceDirectionSchema` and `SeedanceDirection`. The `pcd-synthetic-router.ts` re-export from SP16 already covers the widened union.
- `packages/creative-pipeline/src/index.ts` — barrel widening from SP16 already covers `routeSyntheticPcdShot` and `RouteSyntheticPcdShotInput`. No edit needed for SP17 (export site unchanged; type widens through the existing export).

---

## 4. Algorithm Details

### 4.1 Pseudocode for widened `routeSyntheticPcdShot`

```
routeSyntheticPcdShot(input, stores):
  // Step 0 — Entry-point normalization (per J1).
  seedanceDirection = input.syntheticIdentity.seedanceDirection ?? null

  // Step 1 — Matrix lookup keyed by 3-tuple (shotType, outputIntent, videoProviderChoice).
  pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(p =>
       p.shotTypes.includes(input.shotType)
    && p.outputIntents.includes(input.outputIntent)
    && p.videoProvider === input.videoProviderChoice
  )
  pairing = pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined

  // Step 2 — Out-of-pairing → delegate to SP4. In v1.1.0 only out-of-row shot
  // type is reachable (both providers cover all 7 shot types and all 4 output
  // intents). The reason literal stays "shot_type_not_in_synthetic_pairing"
  // for back-compat (J5).
  if pairing === undefined:
    sp4Decision = await routePcdShot(
      { resolvedContext, shotType, outputIntent, approvedCampaignContext },
      stores,
    )
    return {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: input.shotType,
      sp4Decision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    }

  // Step 3 — Tier policy gate (UNCHANGED from SP16).
  accessDecision = decidePcdGenerationAccess({
    avatarTier: input.resolvedContext.creatorTierAtResolution,
    productTier: input.resolvedContext.productTierAtResolution,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
  })
  if not accessDecision.allowed:
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    }

  // Step 4 — Direction-authored check (NEW, SP17).
  // The chosen provider must have an authored direction on the synthetic
  // identity. Distinct denial kind — NEVER conflated with ACCESS_POLICY,
  // NEVER silently degraded to the other provider.
  direction = input.videoProviderChoice === "kling"
    ? input.syntheticIdentity.klingDirection      // always present on payload (non-nullable)
    : seedanceDirection                            // normalized null (Step 0)
  if direction === null:
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: input.videoProviderChoice,
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    }

  // Step 5 — Build synthetic pairing decision, per-provider branch.
  // videoProviderChoice and videoProvider are zod-literal-equal by branch
  // (Q9 schema-level lock).
  base = {
    allowed: true,
    kind: "synthetic_pairing",
    accessDecision,
    imageProvider: "dalle",
    videoProvider: input.videoProviderChoice,
    videoProviderChoice: input.videoProviderChoice,
    dallePromptLocked: input.syntheticIdentity.dallePromptLocked,
    pairingRefIndex,
    pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
    syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    decisionReason: {
      matchedShotType: input.shotType,
      matchedOutputIntent: input.outputIntent,
      selectionRationale: buildSyntheticSelectionRationale(
        input.resolvedContext.effectiveTier,
        input.shotType,
        input.outputIntent,
        input.videoProviderChoice,
      ),
    },
  }
  return input.videoProviderChoice === "kling"
    ? { ...base, klingDirection: input.syntheticIdentity.klingDirection }
    : { ...base, seedanceDirection: direction }   // direction is SeedanceDirection (narrowed by Step 4)
```

### 4.2 Schema-level no-silent-fallback lock

The Q9 design pattern (`videoProvider: z.literal("kling")` + `videoProviderChoice: z.literal("kling")` on Branch 3; same with `"seedance"` on Branch 4) means the zod union literally cannot represent "user picked seedance but router returned kling success." This is a stronger guarantee than a runtime invariant:

- Source-level: TypeScript narrowing makes the cross-bound case a compile error inside the router body.
- Schema-level: any external caller round-tripping a malformed decision through `SyntheticPcdRoutingDecisionSchema.parse()` would get a Zod error.
- Behavioral: §5 includes a behavioral test that calls the router with seedance choice + null seedanceDirection and asserts it never returns a kling success.

If a future slice ever explicitly introduces fallback behavior, the schema has to widen to relax the literal equality — forcing design review at the schema PR.

### 4.3 `buildSyntheticSelectionRationale` extension

```
buildSyntheticSelectionRationale(effectiveTier, shotType, outputIntent, videoProvider):
  out = `synthetic-pairing tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → dalle+${videoProvider}`
  return out.length > 200 ? out.slice(0, 200) : out
```

Output examples:
- `"synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling"`
- `"synthetic-pairing tier=3 shot=product_demo intent=final_export → dalle+seedance"`

200-char cap matches SP4 + SP16 precedent.

### 4.4 Determinism guarantees

Replay invariant: `(resolvedContext, syntheticIdentity, shotType, outputIntent, videoProviderChoice, approvedCampaignContext, syntheticRouterVersion, pairingVersion, sp4StoresState)` → byte-equal `SyntheticPcdRoutingDecision`. The new `videoProviderChoice` joins the replay tuple.

**Edge case (U3 in §6):** `approvedCampaignContext` does NOT perturb the synthetic-path output. Steps 1–5 read only `resolvedContext`, `syntheticIdentity`, `shotType`, `outputIntent`, `videoProviderChoice`. `approvedCampaignContext` is passed straight through to `routePcdShot` on the delegation path only. Anti-pattern test covers both:
- Synthetic path: vary `approvedCampaignContext` → synthetic-success output unchanged.
- Delegation path: vary `approvedCampaignContext` → SP4's decision participates.

Same purity envelope as SP16 (J4 inherited): no `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto`, no `@creativeagent/db`, no `@prisma/client`, no `inngest`, no `node:fs|http|https`.

---

## 5. Test Strategy

### 5.1 Router unit tests — `route-synthetic-pcd-shot.test.ts` (~38 tests, +14 from SP16)

Test fixtures: a synthetic creator identity payload built from SP11's seed (first row of `SP11_SYNTHETIC_CREATOR_ROSTER`, which is kling-only), plus an enriched fixture with `seedanceDirection` populated (hand-authored or copy-of-kling for shape-validity only). `ResolvedPcdContext` with all three tiers = 3. The 7 video shot types × 4 output intents × 2 providers = 56 parametric happy-path combos (covered with compressed iteration), plus the two out-of-pairing shot types (`script_only`, `storyboard`) × 4 output intents × 2 providers.

| Group | Cases |
|---|---|
| Kling success — all 28 (shot × intent) combos | every combo with `videoProviderChoice: "kling"` returns Branch 3; `videoProvider === "kling"`, `videoProviderChoice === "kling"` (schema-level lock); `klingDirection` deep-equal input; `pairingRefIndex === 0`; both version strings stamped. |
| Seedance success — all 28 (shot × intent) combos (populated fixture) | every combo with `videoProviderChoice: "seedance"` returns Branch 4; `videoProvider === "seedance"`, `videoProviderChoice === "seedance"`; `seedanceDirection` deep-equal input; `pairingRefIndex === 1`. |
| NO_DIRECTION_AUTHORED — seedance choice + null direction | kling-only fixture + `videoProviderChoice: "seedance"` → Branch 2, `denialKind === "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER"`, `videoProviderChoice === "seedance"`. No success branch returned. |
| NO_DIRECTION_AUTHORED — kling choice + null direction | impossible at v1 (klingDirection non-nullable on the payload), asserted as a compile-time type test. |
| NO_DIRECTION_AUTHORED — undefined direction normalizes to null | fixture with `seedanceDirection: undefined` (omitted in source object) + seedance choice → same Branch 2 result as null. |
| Tier policy denial — fires before direction check | tier-1 + final_export + seedance choice + null seedanceDirection → Branch 1 (ACCESS_POLICY), NOT Branch 2. Asserts step ordering. |
| Out-of-pairing delegation — script_only/storyboard, either provider | `shotType: "script_only"` + `videoProviderChoice: "kling"` → Branch 5 (delegation); same with seedance choice → Branch 5 (delegation, `videoProviderChoice` NOT echoed). |
| Delegation embeds SP4 success | tier-3 storyboard + either provider choice → `sp4Decision.allowed === true`, `selectedProvider === "openai_text"`. |
| Delegation embeds SP4 denial | tier-1 script_only + either provider choice → `sp4Decision.allowed === false`. |
| Locked artifacts byte-equality | (kling) modify `klingDirection.setting` → output shifts; (seedance) modify `seedanceDirection.motion` → output shifts; (both) modify `dallePromptLocked` → output shifts on both providers. Asserts verbatim, no mutation. |
| videoProviderChoice == videoProvider on success | parametric assertion across all success cases (both providers). |
| Version pin invariant | every variant carries `syntheticRouterVersion === "pcd-synthetic-router@1.1.0"`; success branches additionally carry `pairingVersion === "pcd-synthetic-provider-pairing@1.1.0"`. |
| Determinism — synthetic path | identical input twice → deep-equal decisions, both providers. |
| Determinism — approvedCampaignContext-no-perturb | (U3) two synthetic-success decisions with the only difference being `approvedCampaignContext.campaignId` → deep-equal decisions. |
| Determinism — delegation path | (U3) two delegation decisions with varied `approvedCampaignContext` → SP4's `sp4Decision` reflects the variation. |
| `decisionReason.selectionRationale` content | both providers: substring `"synthetic-pairing"`, `"dalle+kling"` or `"dalle+seedance"`, tier number, shot type, output intent. Max 200 chars. |
| `pairingRefIndex` invariant | kling success → 0; seedance success → 1 (J8). |
| Stores ignored on synthetic path | replace `stores.campaignTakeStore` with throw-on-any-call mock; both providers' in-pairing combos still succeed. |
| Stores used on delegation path | spy on `stores.campaignTakeStore`; delegated tier-3 campaign shot calls the store. |
| **`PcdRoutingDecisionSchema` drift verification — real SP4 outputs (U1 from SP16 inherited)** | unchanged from SP16: real-call sub-tests for SP4's two reachable branches, round-trip through `PcdRoutingDecisionSchema.parse()`. |

### 5.2 Pairing matrix tests — `synthetic-provider-pairing.test.ts` (~12 tests, +4 from SP16)

- Length exactly **2** in v1.1.0.
- Row 0: `imageProvider === "dalle"`, `videoProvider === "kling"`.
- Row 1: `imageProvider === "dalle"`, `videoProvider === "seedance"`.
- Both rows' `shotTypes` exactly equals the 7-video-shot set (set equality + length match).
- Both rows' `outputIntents` exactly equals the 4-intent set.
- `script_only` and `storyboard` NOT in either row's `shotTypes` (delegation reachability).
- `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION === "pcd-synthetic-provider-pairing@1.1.0"`.
- Type-only check: matrix `as const`, fields read-only.
- 2 rows are distinct objects (no shared reference; `Object.is(row0, row1) === false`).
- Set of all `videoProvider` values across the matrix equals `{"kling", "seedance"}`.
- No third row exists (asserts SP17 doesn't accidentally scaffold for future modalities).

### 5.3 Zod surface tests — `__tests__/pcd-synthetic-router.test.ts` (~20 tests, +6 from SP16)

- Round-trip parse on all 5 branches (kling success, seedance success, ACCESS_POLICY denial, NO_DIRECTION denial, delegation).
- `SyntheticPcdRoutingDecisionSchema.parse()` rejects:
  - kling-success branch with `videoProviderChoice: "seedance"` (schema-level lock — Branch 3 requires both literals to be `"kling"`).
  - seedance-success branch with `videoProviderChoice: "kling"` (schema-level lock).
  - kling-success branch with `seedanceDirection` field present (Branch 3 doesn't have it).
  - seedance-success branch with `klingDirection` field present (Branch 4 doesn't have it).
  - NO_DIRECTION denial branch with `videoProviderChoice` outside the `kling|seedance` union.
  - NO_DIRECTION denial branch with `denialKind !== "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER"`.
  - ACCESS_POLICY denial branch with `videoProviderChoice` field present (Branch 1 doesn't have it).
  - delegation branch with `videoProviderChoice` field present (Branch 5 doesn't have it — Q10 lock).
  - all SP16-era rejections still pass (empty `dallePromptLocked`, length > 4000, malformed direction, missing `syntheticRouterVersion`).
- `PcdRoutingDecisionSchema` (inherited from SP16) round-trips all three SP4 branches unchanged.
- `.readonly()` enforcement on all 5 branches.

### 5.4 Anti-pattern tests — `sp17-anti-patterns.test.ts` (5 assertions, behavioral + source-level split per J6)

**Source-level (cheap, deterministic):**
1. **No V2 router symbol.** Across the entire pipeline package: no symbol named `routeSyntheticPcdShotV2`, no file `route-synthetic-pcd-shot-v2.ts`. Enforces the §2.1 guardrail.
2. **Single-source pairing-version pin (v1.1.0).** `"pcd-synthetic-provider-pairing@1.1.0"` appears in exactly ONE non-test source file: `synthetic-provider-pairing.ts`.
3. **Single-source router-version pin (v1.1.0).** `"pcd-synthetic-router@1.1.0"` appears in exactly ONE non-test source file: `synthetic-router-version.ts`.

**Behavioral (calls the real router, per user direction):**
4. **No silent fallback.** Call `routeSyntheticPcdShot` with `videoProviderChoice: "seedance"` + `syntheticIdentity` where `seedanceDirection: null`. Assert: decision is `{allowed: false, kind: "synthetic_pairing", denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER", videoProviderChoice: "seedance"}`. Never a kling-success. Also assert: under no parametric input does the router return `{videoProvider: "kling", videoProviderChoice: "seedance"}` or vice versa.
5. **Verbatim seedanceDirection on seedance-success.** Round-trip byte-equality: mutate one field of input `seedanceDirection.setting` → output `seedanceDirection.setting` shifts by the same edit. Distinct mutation on `klingDirection.setting` → kling-success output shifts on that field only.

### 5.5 `sp16-anti-patterns.test.ts` edits (in-place literal updates per Q12)

Edited literals (purity / token-blacklist / cross-slice assertions UNCHANGED):
- Matrix length assertion: `expect(matrix.length).toBe(1)` → `expect(matrix.length).toBe(2)`.
- Single-provider assertion: replaced with "matrix's `videoProvider` set equals `{"kling", "seedance"}`".
- Single shot-types-on-row-0 assertion: replaced with "every row covers exactly the 7 video shot types".
- Pairing-version literal: `"1.0.0"` → `"1.1.0"`.
- Router-version literal: `"1.0.0"` → `"1.1.0"`.

### 5.6 SP11 schema + DB store tests

- `creator-identity-synthetic.test.ts`: +3 cases — payload parses with `seedanceDirection: null`, with `seedanceDirection` omitted (normalized to null at consumer), and with populated `seedanceDirection`. Type-only assertion that `klingDirection` is still required.
- `prisma-creator-identity-synthetic-store.test.ts`: +2 cases — round-trip with `seedanceDirection: null` (DB stores NULL) and with populated `seedanceDirection` (DB stores JSON).

### 5.7 Allowlist maintenance

Extend the following anti-pattern test allowlists with SP17 net-new files:
- `sp9-anti-patterns.test.ts`
- `sp10a-anti-patterns.test.ts`
- `sp10b-anti-patterns.test.ts`
- `sp10c-anti-patterns.test.ts`
- `sp13-anti-patterns.test.ts`
- `sp14-anti-patterns.test.ts`
- `sp15-anti-patterns.test.ts`
- `sp16-anti-patterns.test.ts` (in addition to the §5.5 in-place literal edits)

Net-new files added to those allowlists:
- `packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts`
- `packages/db/prisma/migrations/20260515HHmmSS_pcd_creator_identity_synthetic_sp17_seedance_direction/migration.sql`

### 5.8 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: SP16 baseline (~1941 + 2 skipped) + ~34 SP17 net-new ≈ **~1975 passing, 2 skipped unchanged**.
- Prettier check via `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"`. The 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over.
- Migration drift verification: `pnpm prisma migrate diff --from-empty --to-schema-datamodel packages/db/prisma/schema.prisma --script` ≈ matches the new `seedanceDirection` column. No drift.

---

## 6. Open questions / known unknowns

- **U1: Schema accepts `nullish()`, domain normalizes to `null`.** Existing SP11 roster fixtures may omit the field; Prisma's `Json?` column returns `null` on absent. `.nullish()` accepts both at parse time. The DB store and router entry-point normalize `undefined → null` immediately after parse so router logic treats one missing-state. Rule of three: schema accepts nullish; store/domain normalizes to null; router treats null as missing. Decision baked into J1 and Step 0 of §4.1.

- **U2: `videoProviderChoice` is NOT echoed on the delegation branch or the ACCESS_POLICY denial branch.** Delegation means the synthetic router didn't produce a synthetic provider decision — surfacing the choice there would imply Seedance/Kling was evaluated as an output provider; it wasn't. SP21 retains the original choice in its own logs. ACCESS_POLICY fires before the chosen-provider check materially mattered. Decision baked into Q10.

- **U3: Determinism — does `approvedCampaignContext` perturb synthetic-path output?** No. Steps 1–5 read only `resolvedContext`, `syntheticIdentity`, `shotType`, `outputIntent`, `videoProviderChoice`. `approvedCampaignContext` is passed straight through to `routePcdShot` on the delegation path only. Tests in §5.1 cover both: synthetic path → `approvedCampaignContext` no-perturb; delegation path → `approvedCampaignContext` participates through SP4.

- **U4: Where does SP21 composer resolve `videoProviderChoice`?** Out of SP17 scope. SP21 design will choose: per-job UI selection persisted on the job/campaign, per-creator default + per-shot override, or org-level default. SP17 ships `videoProviderChoice` as a typed required input, agnostic to origin.

- **U5: Backfill slice planning.** A future content/data slice will populate `seedanceDirection` for the 30 SP11 roster creators. The author of that slice should evaluate: (a) copy-from-`klingDirection` verbatim (cheap, but breaks the "semantically distinct artifact" framing), (b) hand-author per creator (expensive, faithful), (c) author for a curated subset first. SP17 has no opinion; the backfill is content work, not routing work.

- **U6: Should `PcdRoutingDecisionSchema` move out of `pcd-synthetic-router.ts`?** SP16's MERGE-BACK marker (6) flagged this for SP17 — but SP17 is the matrix extension, not the persistence widen. The schema-location move belongs with SP18 (the first persistence consumer). Leave the SP16 marker in place; SP18 owns the move.

- **U7: SP18 scope preview.** SP18 will add the snapshot/provenance fields to `PcdIdentitySnapshot` (one Prisma migration adding 5 nullable flat columns + 1 nullable Json column per the user's earlier preview-choice). The decision-Json column will persist `klingDirection` OR `seedanceDirection` verbatim depending on the success branch. `videoProviderChoice` joins the persisted fields. `promptHash` is computed at persistence time via `crypto.createHash("sha256")` over `dallePromptLocked` UTF-8 bytes. SP17 stays pure of `crypto` per inherited J4; SP18 introduces the hash call inside the SP9 stamper.

---

## 7. Merge-back to Switchboard

Strictly additive (mostly):

- **One new Prisma column** (`CreatorIdentitySynthetic.seedanceDirection Json?`), one migration. Already on Switchboard's `main` after merge-back (per CLAUDE.md rule 3 — never re-apply migrations).
- **Two schemas-file edits** (`creator-identity-synthetic.ts` adds `SeedanceDirectionSchema` + `.nullish()` field; `pcd-synthetic-router.ts` widens the union to 5 branches). Both additive at the type level.
- **Two creative-pipeline synthetic-router source-body edits** (`synthetic-provider-pairing.ts` matrix grows; `route-synthetic-pcd-shot.ts` body widens). The only non-test SP16 sources SP17 touches, permitted by §2.1 guardrail. Router function name, file path, and export site are unchanged — SP21 composer's eventual import surface is stable.
- **Two version literals bumped** in place: `pcd-synthetic-router@1.0.0` → `1.1.0`, `pcd-synthetic-provider-pairing@1.0.0` → `1.1.0`. Pinned-constant count stays at 21.
- **One DB store edit** (`prisma-creator-identity-synthetic-store.ts` round-trips the new column).
- **Allowlist maintenance** across 8 prior anti-pattern test files.
- **Sed-pass `@creativeagent/*` → `@switchboard/*`** continues mechanically.
- **No imports outside the PCD scope.**

**`// MERGE-BACK:` markers** (six, on the listed declarations):

1. `SeedanceDirectionSchema` (in `creator-identity-synthetic.ts`) — "Net-new SP17 schema. Mirrors `KlingDirectionSchema` shape; semantically distinct artifact (Seedance API, not Kling). Switchboard merge: no reconciliation needed (net-new on both sides). If Switchboard adds Seedance-specific fields later, this schema widens here first and merges back additively."
2. `CreatorIdentitySyntheticPayloadSchema.seedanceDirection` (same file) — "Nullable/nullish for v1.1.0. Existing 30 SP11 roster creators are kling-only until a future content-authoring slice backfills."
3. `PCD_SYNTHETIC_PROVIDER_PAIRING` v2 matrix — "Two-row v1.1.0 (kling + seedance). Both rows cover the full 7 shot types × 4 output intents in v1.1.0; provider-specific narrowing is a future-PR design call. End user picks via `videoProviderChoice` input; matrix gates legality."
4. `routeSyntheticPcdShot` (extended body) — "Widened from SP16 single-provider to SP17 two-provider canonical router. SP21 composer supplies `videoProviderChoice` per shot. SP21 still owns SP12 license + SP13 selector gates upstream."
5. `SyntheticPcdRoutingDecisionSchema` (5-branch union) — "Adds Seedance success branch + `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` denial. SP18 persists fields onto `PcdIdentitySnapshot`."
6. Delegation `reason` literal — "Legacy SP16 literal; now covers any out-of-pairing tuple in SP17 (shot type, output intent, OR videoProviderChoice). Rename in a future provider-narrowing slice that introduces a separate denial path."

---

## 8. Out-of-scope (explicit)

Carried forward from §1 and consolidated:

- **No snapshot/provenance persistence widen.** SP18 owns the `PcdIdentitySnapshot` widen.
- **No `INVALID_VIDEO_PROVIDER_CHOICE` scaffolding.** Reserved-by-name in §3.6; zero source presence.
- **No roster backfill.** 30 SP11 roster creators stay `seedanceDirection: null`.
- **No real Seedance API call.** Provider-call layer is out of PCD scope.
- **No composer wiring** (SP21).
- **No SP4 edits.** Delegation calls SP4 unchanged.
- **No SP12/SP13 edits.** Upstream of SP17.
- **No silent fallback** Kling↔Seedance (schema-locked per §4.2).
- **No `klingDirection` ↔ `seedanceDirection` auto-derivation.**
- **No `voiceCaptionStyle` widen.**
- **No `PcdRoutingDecisionSchema` relocation** (SP18 owns the move per U6).
- **No Inngest function, no admin UI, no async job integration.**
- **No QC face-match wiring.** SP20's job.
- **No performance overlay.** SP18/SP19 concerns.
- **No SP21 composer wiring tests.**
- **No second/third-row pairing matrix extensions** beyond the kling + seedance pair.
- **No structural assertion that `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`.** SP21's invariant.
- **No assertion that creator is licensed (SP12) or selected (SP13).** SP21 ran those gates upstream.

---

## 9. Implementation slicing (preview, not the plan)

The SP17 plan will be written next via `writing-plans`. Anticipated task list, TDD-paced (one test commit per task):

| # | Task | Approx tests |
|---|---|---|
| 1 | Pre-flight: `git diff 04f14b1..HEAD -- packages/db/prisma/schema.prisma` empty; `pnpm test` at SP16 baseline (~1941 + 2 skipped); prettier clean modulo SP5 baseline warnings. Confirm `z.union` carve-out convention still applies. | — |
| 2 | `SeedanceDirectionSchema` + widen `CreatorIdentitySyntheticPayloadSchema` (add `seedanceDirection: SeedanceDirectionSchema.nullish()` per J1). Co-located schema tests (null/undefined/populated round-trip) + barrel re-export. | ~3 |
| 3 | Prisma migration: `ALTER TABLE "CreatorIdentitySynthetic" ADD COLUMN "seedanceDirection" JSONB;`. Add `seedanceDirection Json?` to `schema.prisma`. | — |
| 4 | DB store round-trip (`prisma-creator-identity-synthetic-store.ts`) — read/write `seedanceDirection` null + populated. Normalize undefined → null on write per J1. | ~2 |
| 5 | Bump `PCD_SYNTHETIC_ROUTER_VERSION` to `1.1.0`. Bump `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION` to `1.1.0` and grow the matrix to 2 rows. Update `synthetic-provider-pairing.test.ts` assertions. Update `sp16-anti-patterns.test.ts` literal expectations (§5.5). | ~4 |
| 6 | Widen `RouteSyntheticPcdShotInput` with `videoProviderChoice` + widen `SyntheticPcdRoutingDecisionSchema` to 5 branches (§3.6). Co-located zod tests for all 5 branches + schema-level literal-equality lock test. | ~6 |
| 7 | Router Step 1 widening — matrix lookup keyed by (shot, intent, videoProviderChoice). Delegation branch tests covering both provider choices. | ~2 |
| 8 | Router Step 4 (new): direction-authored check + `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` denial. Behavioral tests cover both providers; step-ordering test (ACCESS_POLICY fires before NO_DIRECTION). | ~5 |
| 9 | Router Step 5 widening — per-provider success branches with verbatim direction read + `videoProviderChoice` echo. Happy-path tests covering both providers × all 7 shot types × all 4 output intents. | ~12 |
| 10 | `buildSyntheticSelectionRationale` extension (videoProvider in rationale string) + 200-char cap test for both providers. | ~3 |
| 11 | Determinism + approvedCampaignContext-no-perturb (U3) + verbatim-byte-equality for both directions. | ~3 |
| 12 | `sp17-anti-patterns.test.ts` — 5 assertions (§5.4). | ~5 |
| 13 | Allowlist maintenance — extend 8 prior `sp{9,10a,10b,10c,13,14,15,16}-anti-patterns.test.ts` allowlists with SP17 net-new files. | — |
| 14 | Schema barrel + creative-pipeline barrel re-exports verified. (May be folded into earlier tasks if no drift surfaces.) | — |
| 15 | Final full-repo `pnpm typecheck && pnpm test && pnpm exec prettier --check ...` sweep. Target: ~1975 passing + 2 skipped. | — |

**Estimated: ~13–15 commits squashed to 1 PR. Worktree: `.worktrees/sp17`. Branch: `pcd/sp17-synthetic-provider-routing-seedance`. Every implementer subagent prompt opens with `pwd` + `git branch --show-current` and refuses to proceed if the path/branch doesn't match — per the SP13/SP14/SP15/SP16 subagent-wrong-worktree lesson.**

---
