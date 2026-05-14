# PCD SP16 — Synthetic Provider Routing Extension — Design Spec

**Date:** 2026-05-15
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (solo brainstorming, dialogue compressed at user's instruction)
**Predecessor slices:** SP4 (provider router, `13ee16d` baseline matrix + tier3 rules), SP11 (synthetic-creator foundation `3b3d291` — owns `dallePromptLocked` + `klingDirection`), SP12 (license gate, `13ee16d`), SP13 (synthetic-creator selector, `dc7b498`), SP14 (disclosure registry, `43cfdcd`), SP15 (script templates, `9dca008`)
**Successor slices reserved by name:** SP17 (SP9 provenance widen, will add `imageProvider`/`videoProvider`/`syntheticRouterVersion`/`pairingVersion` + `dallePromptLockedHash` to `PcdIdentitySnapshot`), SP18 (`PcdPerformanceSnapshot`), SP19 (performance overlay re-rank), SP20 (synthetic QC face-match against locked physical descriptors), SP21 (end-to-end integration / composer)

---

## 1. Scope & Strategy

SP16 introduces the **synthetic provider-routing layer** — the pure routing decision that maps a synthetic-creator job to its locked DALL-E + Kling pairing, using `CreatorIdentitySynthetic.dallePromptLocked` verbatim as the image-keyframe prompt and `CreatorIdentitySynthetic.klingDirection` verbatim as the video-direction parameters.

Per the umbrella roster design doc (`2026-04-30-pcd-synthetic-creator-roster-design.md`) §4 step 8: "SP4 routes to character's locked DALL-E + Kling pairing using `CreatorIdentitySynthetic.dallePromptLocked` verbatim." Per §4 line 92: "Provider Routing (SP4 — locked DALL-E + Kling per character)." Per §9 lines 346-347: two-layer drift control — `dallePromptLocked` verbatim per character, plus per-character ID-anchor reference image set; SP4 (extended via SP16) injects the anchor into every generation call.

**The pairing is DALL-E AND Kling together, not OR.** DALL-E generates the identity anchor keyframe with the locked prompt; Kling animates from it using the structured direction. Every in-pairing synthetic shot routes to both providers as a single coupled decision.

SP16 lights up that layer:

- **Pure wrapping function** — `routeSyntheticPcdShot(input, stores)` in `packages/creative-pipeline/src/pcd/synthetic-router/`. SP4's `routePcdShot` source body is **frozen**; SP16 either returns a synthetic decision directly OR transparently delegates to `routePcdShot` for non-pairing shot types.
- **Narrow declarative pairing matrix** — `PCD_SYNTHETIC_PROVIDER_PAIRING` is a `ReadonlyArray<SyntheticProviderPairing>` describing which `(shotType, outputIntent)` combinations get the locked pairing. v1 is a single row covering all video-modality shot types and the four standard output intents. Parallels SP4's `PCD_PROVIDER_CAPABILITY_MATRIX` shape so future maintainers can extend it identically.
- **No SP11 schema widen.** `CreatorIdentitySyntheticPayloadSchema` already carries both `dallePromptLocked: z.string()` (verbatim text prompt) AND `klingDirection: { setting, motion, energy, lighting, avoid }` (structured Kling parameters). SP16 reads both verbatim into the decision struct. **Q4 of the brainstorm framing is resolved by inspection — no `klingPromptLocked` widen is needed.**
- **Synthetic identity passed in as data.** Caller (SP21 composer eventually) uses the existing `PrismaCreatorIdentitySyntheticReader` (SP11) to resolve the payload, then hands it to `routeSyntheticPcdShot`. Matches SP15's bare-`creatorIdentityId` pattern: loose coupling, pure function over caller-supplied data.
- **SP4 delegation is part of the decision union, not an external concern.** For shot types not in the synthetic pairing (`script_only`, `storyboard`), the wrapper internally calls `routePcdShot` and returns its decision wrapped in a `delegated_to_generic_router` variant. Caller treats the result uniformly; only one entry point needs to exist for synthetic-creator routing.
- **Tier policy gate (SP2) is enforced.** For in-pairing shot types, SP16 calls `decidePcdGenerationAccess` directly (same dependency SP4 uses) and returns `ACCESS_POLICY` denial if the tier policy rejects. For delegated shot types, SP4's own tier policy gate fires inside the delegated call.
- **SP4's Tier 3 generic routing rules (`first_last_frame_anchor`, `performance_transfer`, `edit_over_regenerate`) do NOT apply** to in-pairing shot types. The locked pairing supersedes generic-capability filtering by design — that's the entire point of locking the pairing per character. For delegated shot types, SP4's Tier 3 rules fire inside the delegated call as normal.

**Key SP15 → SP16 inflection:** SP15 was a single-cell selector decision (one script chosen). SP16 is a *coupled* provider decision — two providers (DALL-E + Kling) named together, with two locked artifacts (`dallePromptLocked` text + `klingDirection` structured object) carried verbatim on the success branch. The pure function takes a **bare `syntheticIdentity: CreatorIdentitySyntheticPayload`** as a parameter alongside the existing `ResolvedPcdContext` — not a `SyntheticCreatorSelectionDecision` (SP13's success type). SP21 composer is responsible for asserting that the chosen creator ID matches the synthetic identity payload's `creatorIdentityId` and that the SP13 license/selector chain has already cleared.

What SP16 deliberately does NOT do:

- **No edits to SP4** (`routePcdShot`, `PCD_PROVIDER_CAPABILITY_MATRIX`, `tier3-routing-rules.ts`, `provider-router.ts`). The only exception is the standard allowlist maintenance in prior anti-pattern tests (precedent: every slice since SP10A).
- **No SP11 schema widen.** `klingPromptLocked` is NOT a field that needs adding. `klingDirection` (already on SP11) IS the structured Kling pairing artifact.
- **No new Prisma model, no migration, no DB-package consumer.** SP16 is pure routing logic over data that already exists in SP11. The DB-side reader for the synthetic identity is `PrismaCreatorIdentitySyntheticReader`, which SP11 already shipped.
- **No persistence of the synthetic routing decision.** Like SP15, the decision struct is zod-only. SP17 owns the SP9 widen that persists `imageProvider`, `videoProvider`, `syntheticRouterVersion`, `pairingVersion`, and `sha256(dallePromptLocked)` into `PcdIdentitySnapshot` (per umbrella §5 line 263).
- **No composer integration.** SP21 composer eventually picks `routeSyntheticPcdShot` vs `routePcdShot` based on whether the creator has a `CreatorIdentitySynthetic` row. SP16 publishes both behaviors via its own entry point (in-pairing → synthetic decision; out-of-pairing → delegated `routePcdShot` decision).
- **No reference-image / ID-anchor injection.** Umbrella §9.2 mentions a per-character ID-anchor reference image set used at generation and QC time. That's a separate concern — provider call layer (not routing) consumes the anchor. SP16's decision struct carries `dallePromptLocked` and `klingDirection` verbatim; downstream provider-call code knows how to combine those with the anchor. The umbrella's claim "Provider routing layer (SP4) injects the anchor into every generation call" is interpreted here as a contract for the provider-CALL layer, not the routing-DECISION layer. The split keeps SP16 a pure data function.
- **No QC face-match wiring** (SP20). The locked `physicalDescriptors` on SP11 is the QC reference; SP16 does not read it.
- **No performance overlay** (SP18/SP19). v1 is a uniform pairing per umbrella §6.3 wording; weighted re-rank applies to *script* selection, not provider routing.
- **No real Kling/DALL-E API calls.** SP16 is the routing decision; provider-call layer (out of scope for the PCD vertical) does the actual generation.
- **No model-version pinning** (umbrella §5 line 262 `modelVersions: { dalle: "...", kling: "..." }`). Per-model version pinning is a provenance concern; SP17 owns it.
- **No SP21 composer wiring tests.** SP16 ships SP16-bounded tests only.

---

## 2. Locked decisions

### 2.1 Decisions settled in this brainstorm

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Wrap, don't extend.** SP16 ships a new function `routeSyntheticPcdShot` in `packages/creative-pipeline/src/pcd/synthetic-router/`. SP4's `routePcdShot` source body is frozen. Caller (eventually SP21 composer) picks the wrapper as the entry point for synthetic creators and falls back to `routePcdShot` directly for real creators. | Mirrors SP10C → SP10B (`run-identity-aware-preproduction-chain-with-cost-budget.ts` wraps `runIdentityAwarePreproductionChainWithBudget`). Preserves the no-edit-to-prior-slice-source-bodies discipline that every slice since SP10A has followed. Avoids an SP4 version bump. SP4's matrix already has no DALL-E row; widening it would require introducing a `dalle` provider entry with capabilities that no caller would use outside the synthetic path — pure clutter. |
| Q2 | **Narrow declarative pairing matrix** — `PCD_SYNTHETIC_PROVIDER_PAIRING` as a `ReadonlyArray<SyntheticProviderPairing>`. v1 row count: **1**. The single row maps the seven video-modality shot types (`simple_ugc, talking_head, product_demo, product_in_hand, face_closeup, label_closeup, object_insert`) and the four standard output intents (`draft, preview, final_export, meta_draft`) to the pairing `(imageProvider: "dalle", videoProvider: "kling")`. | Declarative-data convention is uniform across the PCD vertical (SP4 matrix, SP10C cost gate, SP13 compatibility set, SP14 disclosure rows, SP15 templates). A pure switch statement would be simpler but breaks the convention and is harder to widen when a 3rd modality (e.g., voice for `talking_head`) eventually lands. One row is genuinely enough in v1 — the pairing is locked per character, not per shot type; the matrix is "which shot types are pairing-eligible at all" not "which provider serves which shot type". |
| Q3 | **Decision struct carries `dallePromptLocked` and `klingDirection` VERBATIM on the success branch.** | Self-contained decision is the established precedent: SP14 success carries `disclosureText` verbatim; SP15 success carries `scriptText` verbatim. Downstream callers should not need a second registry read just to render. The decision struct is the unit of provenance — replay must be byte-equal from the decision alone (modulo SP17's eventual hash-only persistence choice). |
| Q4 | **No SP11 schema widen.** `CreatorIdentitySyntheticPayloadSchema` already carries both `dallePromptLocked: z.string().min(1).max(4000)` and `klingDirection: KlingDirectionSchema` (structured `{ setting, motion, energy, lighting, avoid }`). The "locked Kling pairing" is the structured direction object, NOT a separate text prompt. SP16 reads both fields verbatim. | Verified by inspection at `packages/schemas/src/creator-identity-synthetic.ts:65,96-97`. The brainstorm framing flagged this as the riskiest cross-slice question; resolving it by inspection eliminates the temptation to widen SP11. |
| Q5 | **Two-variant denial path on the synthetic branch + transparent delegation variant for non-pairing shot types.** Decision union has FOUR branches: `{ allowed: false, denialKind: "ACCESS_POLICY", ... }` (synthetic path, tier policy denied), `{ allowed: true, kind: "synthetic_pairing", ... }` (synthetic path, allowed), `{ kind: "delegated_to_generic_router", reason: "shot_type_not_in_synthetic_pairing", sp4Decision: PcdRoutingDecision, ... }` (out-of-pairing shot type → SP4 ran), and `{ allowed: false, denialKind: "NO_SYNTHETIC_PROVIDER_PAIRING", ... }` — **WITHHELD in v1.** With the single-row matrix covering all currently-defined video shot types, this branch is structurally unreachable; failure modes for out-of-pairing shots route through delegation. Reserved as a named denial kind for future widening (e.g., if a new shot type is added that the pairing doesn't yet cover). | Four working variants keep the decision struct fully self-describing. The delegation variant carries the embedded SP4 decision wholesale — caller treats SP4 success/denial uniformly via `sp4Decision`. The future-reserved `NO_SYNTHETIC_PROVIDER_PAIRING` keeps the failure taxonomy open without speculative code. |
| Q6 | **20th pinned PCD constant `PCD_SYNTHETIC_ROUTER_VERSION = "synthetic-router@1.0.0"` and 21st pinned constant `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "synthetic-provider-pairing@1.0.0"`.** Each literal appears in exactly ONE non-test source file. All consumers import the symbol. | Matches the tightened single-source rule established in SP14 and reinforced in SP15. Two distinct versions because the router logic and the pairing matrix can evolve independently (matrix can add rows without bumping router logic; router logic can change branching without bumping the matrix). |
| Q7 | **`allowed` discriminant** on synthetic-path branches; **`kind` discriminant** on the delegation variant + synthetic-success variant. Two discriminators on the same union are intentional — `allowed` distinguishes denied-vs-allowed for the *synthetic* path, and `kind` distinguishes synthetic-vs-delegated paths. | Cross-slice consistency on `allowed` (SP12 / SP13 / SP14 / SP15). The `kind` overlay disambiguates the synthetic-vs-delegation axis and is parallel to SP4's existing `denialKind` / SP14's `kind` field on `DisclosureResolutionDecision`. Tests cover that callers narrowing on `kind === "delegated_to_generic_router"` get the embedded SP4 decision and callers narrowing on `allowed === true && kind === "synthetic_pairing"` get the locked prompts. |
| Q8 | **Tier policy gate (SP2) is applied directly inside `routeSyntheticPcdShot` for in-pairing shot types** via `decidePcdGenerationAccess({ avatarTier, productTier, shotType, outputIntent })`. For delegated shot types, the embedded `routePcdShot` call applies its own tier policy gate (same function, same input shape) — no double-gate concern. | SP4's body runs the tier policy gate as Step 1 of `routePcdShot`. SP16's wrapper needs the same gate for in-pairing shots because we short-circuit before calling `routePcdShot`. The tier policy gate is a pure function imported from `./tier-policy.js`; no circular dependency. |
| Q9 | **Tier 3 generic routing rules (`first_last_frame_anchor`, `performance_transfer`, `edit_over_regenerate`) are NOT applied** to in-pairing shot types. The locked pairing supersedes generic capability filtering by design. For delegated shot types, SP4 applies Tier 3 rules as normal. | This is a real semantic statement: synthetic creators have a locked pairing because their visual identity is locked. Filtering them through capability rules that might reject Kling (e.g., `performance_transfer` for talking_head) would defeat the lock. The umbrella spec line 92 says "locked DALL-E + Kling per character" — that *is* the routing, not subject to further filtering. If Kling's capability profile genuinely cannot serve a particular Tier 3 shot type for a synthetic creator, that's an authoring-time concern (don't offer that shot type for synthetic creators, or change the locked Kling direction); it is not SP4's runtime filter to make. |
| Q10 | **Synthetic identity input is `syntheticIdentity: CreatorIdentitySyntheticPayload`** passed as data, NOT a `SyntheticCreatorSelectionDecision` (SP13's output) and NOT a `syntheticIdentityReader` store. The caller (SP21 composer) resolves it via the existing `PrismaCreatorIdentitySyntheticReader` (SP11) and hands it in. | Loose coupling: SP16 source contains zero references to SP13 decision tokens. SP21 composer is responsible for: (a) running SP13 to pick a creator, (b) running SP12 license gate, (c) looking up the synthetic identity payload, (d) calling `routeSyntheticPcdShot`. SP16 stays unaware of SP13's decision shape. Matches SP15's `creatorIdentityId` bare-parameter philosophy. |
| Q11 | **Pairing matrix carries `imageProvider: "dalle"` and `videoProvider: "kling"` as a coupled pair, NOT as separate selectable providers.** The success decision names BOTH providers because every synthetic in-pairing shot uses both — DALL-E for the keyframe, Kling for animation. Decision struct fields: `imageProvider: "dalle"`, `videoProvider: "kling"`, `dallePromptLocked: string`, `klingDirection: KlingDirection`. | Direct reading of umbrella §4 line 92 ("locked DALL-E + Kling per character"), §4 line 238 ("locked DALL-E + Kling pairing"), §5 line 262 (`modelVersions: { dalle: "...", kling: "..." }` — both in the same provenance object), §9 line 347 ("ID anchor — Provider routing layer injects the anchor into every generation call"). The pairing is *coupled*, never one provider at a time for in-pairing shots. |
| Q12 | **Failure-mode coverage: `ACCESS_POLICY` from tier policy gate (synthetic path); embedded `sp4Decision: PcdRoutingDecision` (which can itself be `ACCESS_POLICY` or `NO_PROVIDER_CAPABILITY`) on the delegation path.** No synthetic-specific `NO_PROVIDER_CAPABILITY` failure — pairing matrix is single-row covering all v1 video shot types; future widening (new shot type not yet in the row's `shotTypes` array) routes through delegation, where SP4 handles capability failure as it always has. | Avoids speculative failure modes. Two real failure paths (tier policy denial on synthetic path; any SP4 failure on delegation path) plus the placeholder `NO_SYNTHETIC_PROVIDER_PAIRING` reserved name. |

### 2.2 Judgment calls baked into this spec (open to push-back at the user review gate)

| # | Decision | Rationale |
|---|---|---|
| J1 | **Decision struct field set.** Success branch: `allowed: true, kind: "synthetic_pairing", accessDecision: PcdTierDecision, imageProvider: "dalle", videoProvider: "kling", dallePromptLocked: string, klingDirection: KlingDirection, pairingRefIndex: number, pairingVersion: typeof PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION, syntheticRouterVersion: typeof PCD_SYNTHETIC_ROUTER_VERSION, decisionReason: { matchedShotType: PcdShotType, matchedOutputIntent: OutputIntent, selectionRationale: string }`. Denial branch: `allowed: false, denialKind: "ACCESS_POLICY", accessDecision: PcdTierDecision, syntheticRouterVersion: typeof PCD_SYNTHETIC_ROUTER_VERSION`. Delegation branch: `kind: "delegated_to_generic_router", reason: "shot_type_not_in_synthetic_pairing", shotType: PcdShotType, sp4Decision: PcdRoutingDecision, syntheticRouterVersion: typeof PCD_SYNTHETIC_ROUTER_VERSION`. All `.readonly()`. | Mirrors SP4's success-shape (`accessDecision`, `selectionRationale`-style decision-reason). Carries both locked artifacts verbatim. `pairingRefIndex` mirrors SP4's `capabilityRefIndex` for forensic traceability into the matrix. `syntheticRouterVersion` is on all three branches because SP9/SP17 provenance writes need to know which router version made the decision regardless of outcome. Delegation branch carries `shotType` for forensics — useful when grepping decision logs for "which shot types are taking the delegated path". |
| J2 | **Subdir = `packages/creative-pipeline/src/pcd/synthetic-router/`.** Sibling to existing `pcd/synthetic-creator/`, `pcd/script/`, `pcd/disclosure/`, etc. | Short, slice-named subdir per SP9-onward convention. Distinct from `pcd/synthetic-creator/` (SP11's data foundation) to keep the routing concern separated from the identity concern. |
| J3 | **Module file layout.** Three source files (`synthetic-provider-pairing.ts` = matrix + pairing version constant; `synthetic-router-version.ts` = router logic version constant; `route-synthetic-pcd-shot.ts` = the function) plus tests, plus `sp16-anti-patterns.test.ts`, plus `index.ts` barrel. | Splitting the two version constants into two files matches the single-source-literal anti-pattern test from SP15 / SP14: each literal appears in exactly ONE non-test source file. Keeping the pairing constant in the same file as the matrix data is the natural locus; keeping the router-logic version separate avoids the matrix file owning a literal it doesn't logically own. |
| J4 | **Pure-function purity envelope** for sources under `pcd/synthetic-router/` (excluding tests): no `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto`, no `@creativeagent/db`, no `@prisma/client`, no `inngest`, no `node:fs|http|https`. Async signature is preserved because the wrapper internally `await`s `routePcdShot` (which is `async` because of SP4's `requiresEditOverRegenerate` campaign-take-store read). | Tighter than SP10C (which has the legitimate clock pull for `estimatedAt`). SP16 has no clock pull because there's no time-stamped meta in the decision struct; provenance write timestamp is SP17's concern. |
| J5 | **No new `stores` field beyond what `routePcdShot` requires.** `routeSyntheticPcdShot`'s `stores` parameter type IS `ProviderRouterStores` (re-exported from SP4 by type-only import) — i.e., just `{ campaignTakeStore }`. Used only on the delegation path. The synthetic path needs no stores at all (pure data over the synthetic identity + pairing matrix + tier policy). | Re-using SP4's stores type avoids a parallel-stores explosion. The synthetic path's purity is structurally enforced by not threading stores into the synthetic branch's code paths. |
| J6 | **Input contract = `{ resolvedContext, syntheticIdentity, shotType, outputIntent, approvedCampaignContext }`.** Same shape as SP4's `RoutePcdShotInput` plus `syntheticIdentity`. Reuses SP4's type names via type-only import: `ResolvedPcdContext`, `PcdShotType`, `OutputIntent`, `ApprovedCampaignContext`. | Minimum-surprise input shape. SP21 composer's call site reads identical to the SP4 call site modulo the extra `syntheticIdentity` field. |
| J7 | **Pairing matrix `shotTypes` array enumerates SP4-known video shot types verbatim.** v1 row covers `simple_ugc, talking_head, product_demo, product_in_hand, face_closeup, label_closeup, object_insert`. `script_only` and `storyboard` are deliberately excluded — they're text-modality, not video-modality; the locked Kling direction doesn't apply to a text storyboard. | Exclusion is the source-of-truth for the delegation branch's reachability. The same anti-pattern test that asserts the single-row coverage also asserts that `script_only` and `storyboard` are NOT in the row's `shotTypes` array — the delegation path's reachability is a tested invariant, not an accidental gap. |
| J8 | **Anti-pattern: no token leakage of SP4 internals.** SP16 sources don't reference `PCD_PROVIDER_CAPABILITY_MATRIX`, `Tier3Rule`, `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`, `requiresEditOverRegenerate`, or `tier3-routing-rules` outside the single `routePcdShot` call site (which uses none of those tokens — it just `await routePcdShot(input, stores)`). The synthetic decision is independent of SP4's tier3 rules. | Concretizes Q9: tests assert that SP16 source files do not import or reference SP4's tier3 surface. Catches accidental "let's also apply first_last_frame to synthetic" drift in future PRs. |
| J9 | **No allowlist for the synthetic-router subdir's seed-style data.** The pairing matrix is small enough that it's authored directly in the source file; there's no separate seed file. The single-row matrix is a *behavioral lock*, not seed data — comparable to SP4's matrix, which is also authored in source. Anti-pattern tests assert matrix shape (length = 1, providers = `{"dalle", "kling"}`, exact shot types, exact output intents). | Avoids over-engineering: SP15 had a 24-row seed because the script registry is genuinely a registry (rows = data). The SP16 pairing matrix is a 1-row behavioral constant (row = policy). Authoring it in-source mirrors SP4's matrix exactly. |
| J10 | **`decisionReason.selectionRationale` is a short forensics string** (max 200 chars matching SP4). Example: `"synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling"`. The delegation branch's decision-reason is implicit via the embedded `sp4Decision.decisionReason`. | Parity with SP4's `buildSelectionRationale` shape. Forensics consumers (log search, eventual SP17 provenance) get the same shape regardless of which path was taken. |
| J11 | **`sha256(dallePromptLocked)` is NOT computed in SP16.** Umbrella §5 line 263 calls out `promptHash: sha256(dallePromptLocked)` as a provenance field. That's SP17's job — provenance write computes the hash at persistence time. SP16 carries the verbatim string in the decision struct; downstream provenance hashes it. | Avoids importing `crypto` (which the purity envelope J4 bans). Keeps SP16 pure. Hash-vs-verbatim is a persistence-layer decision SP17 owns. |
| J12 | **No pre-validation that the supplied `syntheticIdentity.creatorIdentityId` matches `resolvedContext.creatorIdentityId`.** SP16 trusts the caller to wire these consistently — SP21 composer's job. SP16 invariant tests pass valid pairs; testing the inconsistent-pair edge is SP21's problem at composer integration time. | Avoids speculative input validation that the caller is already responsible for. The alternative — runtime assert + new failure variant — would couple SP16 to a concern that belongs upstream. |
| J13 | **Re-export `PcdRoutingDecision` from `@creativeagent/schemas` indirectly via `@creativeagent/creative-pipeline`'s `pcd/index.ts`** (where SP4 already lives), or fully via a thin re-export in `pcd-synthetic-router.ts`. Choice: **thin re-export from `pcd-synthetic-router.ts`** so the schema barrel surfaces `SyntheticPcdRoutingDecisionSchema` as a complete, self-describing union. | The delegation variant's `sp4Decision: PcdRoutingDecision` field needs the `PcdRoutingDecision` zod type to exist somewhere reachable. SP4 currently doesn't expose `PcdRoutingDecision` as a zod schema — it's a TypeScript type only (defined inline in `provider-router.ts`). SP16 will need a zod analogue for round-trip parsing of the decision union. **This is a real net-new schema obligation** — see U1 below. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  pcd-synthetic-router.ts                              [new]
  __tests__/pcd-synthetic-router.test.ts               [new]
  index.ts                                             [touch — barrel widen, Task 2]

packages/creative-pipeline/src/pcd/synthetic-router/
  synthetic-router-version.ts                          [new — 20th pinned constant]
  synthetic-provider-pairing.ts                        [new — matrix + 21st pinned constant]
  synthetic-provider-pairing.test.ts                   [new — matrix shape + invariants]
  route-synthetic-pcd-shot.ts                          [new — routeSyntheticPcdShot]
  route-synthetic-pcd-shot.test.ts                     [new]
  sp16-anti-patterns.test.ts                           [new — structural assertions + SP4-token-blacklist]
  index.ts                                             [new — barrel]
packages/creative-pipeline/src/index.ts                [touch — re-export]
```

No new Prisma migration. No new DB-package store. No new Inngest function.

### 3.2 Zod surface — `packages/schemas/src/pcd-synthetic-router.ts`

```ts
import { z } from "zod";
import {
  KlingDirectionSchema,
} from "./creator-identity-synthetic.js";
import {
  OutputIntentSchema,
  PcdShotTypeSchema,
} from "./pcd-identity.js";
import { PcdTierDecisionSchema } from "./pcd-tier-policy.js";

// Locally re-defined zod analogue of the TypeScript-only PcdRoutingDecision
// from packages/creative-pipeline/src/pcd/provider-router.ts. SP4 ships the
// TS type but no zod schema; SP16's delegation branch needs a zod-parseable
// union for round-tripping decisions. The structure here is the
// authoritative parse contract; the SP4 TS type is a structural subset.
// MERGE-BACK: At Switchboard integration time, SP4's TS type and this zod
// schema must be kept in sync. SP17 will be the first slice to persist
// `PcdRoutingDecision`, at which point SP17 owns the source-of-truth move
// (zod into pcd-provenance or similar). For now SP16 owns this schema.
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
          tiers: z.array(z.number().int()).readonly(),
          shotTypes: z.array(z.string().min(1)).readonly(),
          outputIntents: z.array(z.string().min(1)).readonly(),
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
          matchedEffectiveTier: z.number().int(),
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

// NB: `z.union` not `z.discriminatedUnion`. Same NB carve-out as SP13 / SP14
// / SP15 — Zod 3.x's discriminatedUnion factory does not see literal
// discriminators on branches wrapped in `.readonly()`.
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

Notes:
- `.readonly()` on every object + array — matches SP10B/SP12/SP13/SP14/SP15 precedent.
- `z.union` not `z.discriminatedUnion` (carve-out matches SP13/SP14/SP15 source).
- Three branches on the synthetic union; one of them carries the SP4 decision wholesale via `sp4Decision: PcdRoutingDecisionSchema`.
- `PcdRoutingDecisionSchema` lives in this file (Q1 schema-ownership decision; see U1 below).
- `KlingDirectionSchema` is imported from SP11 — not redefined.
- `PcdTierDecisionSchema`, `OutputIntentSchema`, `PcdShotTypeSchema` are imported from `pcd-tier-policy.ts` (SP2).

### 3.3 Version constants

`synthetic-router-version.ts`:

```ts
// PCD slice SP16 — 20th pinned PCD constant.
// Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION
// (which versions the pairing data, not the routing logic).
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SYNTHETIC_ROUTER_VERSION = "synthetic-router@1.0.0";
```

`synthetic-provider-pairing.ts` (top of file, alongside the matrix):

```ts
// PCD slice SP16 — 21st pinned PCD constant.
// Pairing-data version. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (which
// versions the routing logic, not the data). Bumped when matrix rows are
// added / shot types are reshuffled — does NOT bump for additive shot-type
// extensions if behavior is identical for callers.
//
// MERGE-BACK: Same provenance-replay assessment as router version.
export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "synthetic-provider-pairing@1.0.0";
```

Each literal appears in **exactly one non-test source file**. All consumers import the symbol.

### 3.4 Pairing matrix — `synthetic-provider-pairing.ts`

```ts
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "synthetic-provider-pairing@1.0.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling";
};

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

### 3.5 Pure router function — `route-synthetic-pcd-shot.ts`

```ts
// PCD slice SP16 — synthetic-creator provider router.
// Wraps SP4's routePcdShot for non-pairing shot types; emits its own
// synthetic-pairing decision for in-pairing shot types (locked DALL-E +
// Kling).
//
// Composition (one inline `Step N` comment per body step):
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
// payload via PrismaCreatorIdentitySyntheticReader (SP11 reader). SP16
// itself never reads. Mirrors SP12/SP13/SP14/SP15 snapshot pattern.

import type {
  CreatorIdentitySyntheticPayload,
  OutputIntent,
  PcdShotType,
  PcdTierDecision,
  SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { decidePcdGenerationAccess } from "../tier-policy.js";
import { routePcdShot } from "../provider-router.js";
import type {
  ApprovedCampaignContext,
  ProviderRouterStores,
} from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
  type SyntheticProviderPairing,
} from "./synthetic-provider-pairing.js";
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
): Promise<SyntheticPcdRoutingDecision>;
```

Implementation pseudocode in §4.

### 3.6 Barrel — `synthetic-router/index.ts`

```ts
export { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";
export {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
  type SyntheticProviderPairing,
} from "./synthetic-provider-pairing.js";
export {
  routeSyntheticPcdShot,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";
```

### 3.7 Barrel re-exports

- `packages/schemas/src/index.ts` — `export * from "./pcd-synthetic-router.js"`. **Lands in Task 2** alongside the zod surface (SP14/SP15 pattern: barrel widening with first consumer).
- `packages/creative-pipeline/src/index.ts` — `export * from "./pcd/synthetic-router/index.js"`. Final task.
- No `packages/db/src/index.ts` widen — SP16 has no DB-package consumer.

---

## 4. Algorithm Details

### 4.1 Pseudocode for `routeSyntheticPcdShot`

```
routeSyntheticPcdShot(input, stores):
  // Step 1 — Pairing matrix lookup. Find a row whose shotTypes contains
  // input.shotType AND outputIntents contains input.outputIntent. First-match
  // wins (v1 has only one row anyway).
  pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(p =>
       p.shotTypes.includes(input.shotType)
    && p.outputIntents.includes(input.outputIntent)
  )
  pairing = pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined

  // Step 2 — Out-of-pairing shot type → delegate to SP4.
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

  // Step 3 — Tier policy gate. SP4 also runs this for its own path; we run
  // it here independently because Step 4 short-circuits before any
  // routePcdShot call.
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

  // Step 4 — Build synthetic pairing decision.
  return {
    allowed: true,
    kind: "synthetic_pairing",
    accessDecision,
    imageProvider: "dalle",
    videoProvider: "kling",
    dallePromptLocked: input.syntheticIdentity.dallePromptLocked,
    klingDirection: input.syntheticIdentity.klingDirection,
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
      ),
    },
  }
```

### 4.2 `buildSyntheticSelectionRationale`

```
buildSyntheticSelectionRationale(effectiveTier, shotType, outputIntent):
  out = `synthetic-pairing tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → dalle+kling`
  return out.length > 200 ? out.slice(0, 200) : out
```

Short forensics string parallel to SP4's `buildSelectionRationale` shape (line 200-char cap, same template form).

### 4.3 Determinism guarantees

- Pairing matrix lookup uses `Array.findIndex` on a `readonly` array — order-stable.
- Tier policy gate is pure (SP2 invariant).
- Synthetic decision body reads `dallePromptLocked` and `klingDirection` verbatim from input — no transformation, no hashing.
- Delegation path's determinism is SP4's determinism, which is already covered by SP4's tests.
- No `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto` imports — anti-pattern test asserts.

Replay invariant: `(resolvedContext, syntheticIdentity, shotType, outputIntent, approvedCampaignContext, syntheticRouterVersion, pairingVersion, sp4StoresState)` → byte-equal `SyntheticPcdRoutingDecision`. Anti-pattern test asserts via a fuzz-shape property test (5 inputs, deep-equal across two calls).

---

## 5. Test Strategy

### 5.1 Router unit tests — `route-synthetic-pcd-shot.test.ts` (~24 tests)

Test fixtures: a synthetic creator identity payload built from SP11's seed (first row of `SP11_SYNTHETIC_CREATOR_ROSTER`), a `ResolvedPcdContext` with all three tiers = 3, the seven video shot types × four output intents matrix (28 combos), plus the two out-of-pairing shot types (`script_only`, `storyboard`) × four output intents.

| Group | Cases |
|---|---|
| In-pairing happy path | every (video shot type, output intent) combo returns `allowed: true, kind: "synthetic_pairing"`; `imageProvider === "dalle"`, `videoProvider === "kling"`; `dallePromptLocked` byte-equals input; `klingDirection` deep-equals input; `pairingRefIndex === 0`; both version strings stamped correctly. |
| Tier policy denial | tier 1 + shot type that tier policy denies → returns `allowed: false, kind: "synthetic_pairing", denialKind: "ACCESS_POLICY"`. `accessDecision.allowed === false`. No `imageProvider` / `videoProvider` / locked artifacts on this branch. |
| Out-of-pairing delegation | `shotType: "script_only"` → returns `kind: "delegated_to_generic_router"`. `sp4Decision` is the verbatim output of `routePcdShot`. `shotType` echoed in the delegation envelope. |
| Out-of-pairing delegation — `storyboard` | symmetric to script_only |
| Delegation embeds SP4 success | tier-3 storyboard shot → `sp4Decision.allowed === true`, `selectedProvider === "openai_text"` (SP4 matrix row 2 wins) |
| Delegation embeds SP4 denial | tier-1 some-shot that SP4 denies on capability grounds → `sp4Decision.allowed === false`, `denialKind: "ACCESS_POLICY"` or `"NO_PROVIDER_CAPABILITY"` (whichever SP4 returns). |
| Locked artifacts byte-equality | (separate) — modify `dallePromptLocked` in the input by one char → output's `dallePromptLocked` shifts by one char. Modify `klingDirection.setting` → output's `klingDirection.setting` shifts. (Asserts: verbatim, no mutation.) |
| Version pin invariant | every variant carries `syntheticRouterVersion === PCD_SYNTHETIC_ROUTER_VERSION`; allowed in-pairing branch additionally carries `pairingVersion === PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION`. |
| Determinism | identical input twice → deep-equal decisions (both paths). |
| `decisionReason.selectionRationale` content | success path: substring `"synthetic-pairing"`, `"dalle+kling"`, tier number, shot type, output intent. Max 200 chars. |
| `pairingRefIndex` invariant | success → `pairingRefIndex === 0` (v1 has one row); equal to index in the matrix. |
| Stores ignored on synthetic path | replace `stores.campaignTakeStore` with a throw-on-any-call mock; in-pairing combos still succeed. (Asserts: synthetic path is pure.) |
| Stores used on delegation path | spy on `stores.campaignTakeStore`; delegated tier-3 campaign shot calls the store (asserts SP4 ran its tier3 rules). |

### 5.2 Pairing matrix tests — `synthetic-provider-pairing.test.ts` (~8 tests)

- Length exactly **1** in v1.
- Row 0's `imageProvider === "dalle"`, `videoProvider === "kling"`.
- Row 0's `shotTypes` exactly equals `["simple_ugc", "talking_head", "product_demo", "product_in_hand", "face_closeup", "label_closeup", "object_insert"]` (set equality + length match).
- Row 0's `outputIntents` exactly equals `["draft", "preview", "final_export", "meta_draft"]`.
- `script_only` NOT in row 0's `shotTypes`.
- `storyboard` NOT in row 0's `shotTypes`.
- `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION === "synthetic-provider-pairing@1.0.0"`.
- Type-only check: matrix `as const`, fields read-only — `Object.isFrozen(matrix)` or equivalent depth check.

### 5.3 Zod surface tests — `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts` (~14 tests)

- Round-trip parse on all three branches (success, denial, delegation).
- `SyntheticPcdRoutingDecisionSchema.parse()` rejects:
  - delegation branch with non-`shot_type_not_in_synthetic_pairing` reason
  - allowed-true branch with `imageProvider !== "dalle"`
  - allowed-true branch with `videoProvider !== "kling"`
  - allowed-true branch with empty `dallePromptLocked`
  - allowed-true branch with `dallePromptLocked.length > 4000`
  - allowed-true branch with malformed `klingDirection` (missing field)
  - denial branch with `kind !== "synthetic_pairing"`
  - any branch missing `syntheticRouterVersion`
- `PcdRoutingDecisionSchema` round-trips all three SP4 branches (`ACCESS_POLICY`, `NO_PROVIDER_CAPABILITY`, allowed).
- `.readonly()` enforcement on all three branches.

### 5.4 Anti-pattern tests — `sp16-anti-patterns.test.ts` (6 assertions)

1. **Single-source router-version pin.** `"synthetic-router@"` appears in exactly ONE non-test source file across `packages/`: `synthetic-router-version.ts`. Matches SP14/SP15's tightened rule.
2. **Single-source pairing-version pin.** `"synthetic-provider-pairing@"` appears in exactly ONE non-test source file: `synthetic-provider-pairing.ts`.
3. **Router purity.** Sources under `pcd/synthetic-router/` (excluding tests) contain no `Date.now()`, no `new Date(`, no `Math.random()`, no `import.*crypto|@creativeagent/db|@prisma/client|inngest|node:fs|http|https`. (J4 envelope.)
4. **No SP4-internals leakage.** Sources under `pcd/synthetic-router/` contain no source-string occurrences of: `PCD_PROVIDER_CAPABILITY_MATRIX`, `Tier3Rule`, `requiresFirstLastFrameAnchor`, `requiresPerformanceTransfer`, `requiresEditOverRegenerate`, `tier3-routing-rules`, `tier3RulesApplied`, `supportsFirstLastFrame`, `supportsEditExtend`, `supportsPerformanceTransfer`, `capabilityRefIndex`. The only allowed SP4 references are `routePcdShot`, `ApprovedCampaignContext`, `ProviderRouterStores`, `PcdRoutingDecision`, `PCD_PROVIDER_CAPABILITY_VERSION` (if at all — actually NOT needed; SP16's decision struct does not re-export it). The router source uses `routePcdShot`, `ApprovedCampaignContext`, and `ProviderRouterStores`; nothing else. (J8.)
5. **No cross-slice token leakage.** Sources under `pcd/synthetic-router/` contain no occurrence of: (SP13) `SyntheticCreatorSelectionDecision`, `selectedCreatorIdentityId`, `fallbackCreatorIdentityIds`, `selectorRank`, `metricsSnapshotVersion`, `performanceOverlayApplied`; (SP14) `DisclosureResolutionDecision`, `disclosureTemplateId`, `resolverVersion`; (SP15) `ScriptSelectionDecision`, `scriptTemplateId`, `scriptText`; (SP17+) `PcdIdentitySnapshot`, `provenance_widen`, `promptHash`, `sha256(`; (SP18+) `PcdPerformanceSnapshot`, `performance_snapshot`; (SP19+) `overlayWeight`; (SP20+) `face_descriptor`, `qc_face`. The plain tokens `creatorIdentityId` and `syntheticIdentity` ARE allowed (SP11 concepts; SP16 takes them as input parameters).
6. **Pairing matrix integrity.** Programmatic assertion: matrix length is exactly 1; row 0's `imageProvider === "dalle"`; row 0's `videoProvider === "kling"`; row 0's `shotTypes` and `outputIntents` are exactly the expected sets (duplicated from the synthetic-provider-pairing.test.ts source for defense-in-depth).

### 5.5 Allowlist maintenance

Per SP10A / SP10B / SP10C / SP13 / SP14 / SP15 precedent, the following frozen-source-body allowlists are extended with SP16's net-new files. Per the SP15 lesson, this is baked into a dedicated task (Task 13) in the implementation plan AND the implementer agents are warned that broader test runs will surface failures pre-emptively, prompting the same allowlist adds. Both approaches converge on the same fix-up commits:

- `sp9-anti-patterns.test.ts` (provenance freeze)
- `sp10a-anti-patterns.test.ts` (cost-forecast freeze)
- `sp10b-anti-patterns.test.ts` (tree-budget freeze)
- `sp10c-anti-patterns.test.ts` (cost-budget freeze)
- `sp13-anti-patterns.test.ts` (selector freeze)
- `sp14-anti-patterns.test.ts` (disclosure freeze)
- `sp15-anti-patterns.test.ts` (script freeze)

Net-new files to allowlist:

- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/index.ts`
- `packages/schemas/src/pcd-synthetic-router.ts`
- `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts`
- `packages/schemas/src/index.ts` (already widened multiple times — single-line union-add)
- `packages/creative-pipeline/src/index.ts` (already widened multiple times — single-line union-add)

SP11 (`sp11-anti-patterns.test.ts`) and SP12 (`sp12-anti-patterns.test.ts`) **do not exist** as standalone freeze files per the user's notes; no allowlist work is needed for those slices.

### 5.6 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: SP15 baseline (1889 + 2 skipped) + ~52 SP16 net new tests ≈ **~1941 passing**, 2 skipped unchanged.
- Prettier check via `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"`. The 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over; SP16 introduces no new prettier warnings.
- **No migration drift verification needed.** SP16 has no Prisma migration. If the implementer adds one by mistake, the plan's Task 1 pre-flight step (`git diff packages/db/prisma/schema.prisma 9dca008..HEAD` empty) catches it.

---

## 6. Merge-back to Switchboard

Strictly additive:

- **Zero new Prisma models.** Zero migrations.
- **One new schemas file**: `pcd-synthetic-router.ts`. One-line union-add to `packages/schemas/src/index.ts`.
- **One new creative-pipeline subdir**: `pcd/synthetic-router/` (7 files). One-line union-add to `packages/creative-pipeline/src/index.ts`.
- **Zero edits** to existing SP1–SP15 source bodies. The only cross-slice touches are 7 prior anti-pattern tests' allowlist widening.
- **Zero edits to SP4** (`provider-router.ts`, `provider-capability-matrix.ts`, `tier3-routing-rules.ts`).
- **Sed-pass `@creativeagent/*` → `@switchboard/*`** continues to work mechanically.
- **No imports outside the PCD scope.**

**`// MERGE-BACK:` markers** (six, on the listed declarations):

1. **`PCD_SYNTHETIC_ROUTER_VERSION`** (in `synthetic-router-version.ts`) — "Pinned 20th PCD constant. Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION. Switchboard merge does not change this literal; bumping it requires a coordinated provenance-replay assessment."
2. **`PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION`** (in `synthetic-provider-pairing.ts`) — "Pinned 21st PCD constant. Pairing-data version. Bumped when matrix rows are added or shot-types reshuffled. Same provenance-replay assessment as router version."
3. **`PCD_SYNTHETIC_PROVIDER_PAIRING`** (in `synthetic-provider-pairing.ts`) — "Future modalities (e.g., voice for talking_head — different model pairing) add NEW rows. Adding a row that overlaps shot-types with the existing row requires a row-precedence rule (first-match? explicit priority?) — that's a future-PR design call. v1's single row makes the question moot."
4. **`routeSyntheticPcdShot`** declaration (in `route-synthetic-pcd-shot.ts`) — "Caller (SP21 composer or equivalent) supplies the synthetic identity payload via `PrismaCreatorIdentitySyntheticReader.findByCreatorIdentityId(...)`. SP16 itself never reads. SP21 is responsible for asserting `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`. Mirrors SP12 / SP13 / SP14 / SP15 snapshot pattern."
5. **`SyntheticPcdRoutingDecisionSchema`** zod schema (in `pcd-synthetic-router.ts`) — "Decision struct is zod-only in SP16. Persistence is SP17's responsibility (SP9 provenance widen). SP17 will add `imageProvider`, `videoProvider`, `syntheticRouterVersion`, `pairingVersion`, and `sha256(dallePromptLocked)` to `PcdIdentitySnapshot` per umbrella §5 line 263. Whether SP17 also persists `klingDirection` verbatim, or hashes it, is SP17's decision."
6. **`PcdRoutingDecisionSchema`** zod schema (in `pcd-synthetic-router.ts`) — "Net-new zod analogue of SP4's TypeScript-only PcdRoutingDecision. The structural source-of-truth is SP4's `provider-router.ts`; this schema is a parse contract for SP16's delegation branch and any future cross-slice consumer that needs to round-trip PcdRoutingDecision. SP17 may move this schema into a more central location (likely `pcd-provenance.ts`) at the point it becomes a persistence concern. SP16 owns it for now."

---

## 7. Out-of-scope (explicit)

Carried forward from the umbrella roster design §11 and narrowed for SP16:

- **No edits to SP4** (`routePcdShot`, capability matrix, tier3 rules). Wrap-only.
- **No SP11 schema widen.** `klingDirection` (structured) is the locked Kling pairing artifact; no `klingPromptLocked` text-prompt field is needed.
- **No new Prisma model, no migration, no DB-package store, no DB-side widening.** Pure routing logic over data SP11 already persists.
- **No persistence of `SyntheticPcdRoutingDecision` or its embedded `dallePromptLocked` hash.** SP17 owns the SP9 widen.
- **No reference-image / ID-anchor injection.** Provider-CALL layer (out of PCD scope) consumes the anchor. The umbrella's "Provider routing layer (SP4) injects the anchor into every generation call" is interpreted here as a provider-call concern, not a routing-decision concern.
- **No model-version pinning** (`modelVersions: { dalle: "...", kling: "..." }` per umbrella §5 line 262). Provenance concern; SP17 owns.
- **No Inngest function, no admin UI, no async job integration.**
- **No real Kling/DALL-E API calls.** Pure routing decision.
- **No QC face-match wiring.** SP20's job.
- **No performance overlay.** SP18/SP19 concerns; performance overlay re-rank is on *script selection*, not provider routing.
- **No SP21 composer wiring tests.** SP16 ships SP16-bounded tests only.
- **No second/third-row pairing matrix extensions** (e.g., voice modality for talking_head). Future PR after v1 ships.
- **No structural assertion that `syntheticIdentity.creatorIdentityId === resolvedContext.creatorIdentityId`.** SP21's invariant to enforce at composer time.
- **No assertion that creator is licensed (SP12) or selected (SP13).** SP21 composer ran those gates upstream; SP16 trusts the caller.

---

## 8. Open questions / known unknowns

- **U1: Schema ownership of `PcdRoutingDecisionSchema`.** SP4 ships `PcdRoutingDecision` as a TypeScript type only — no zod schema. SP16's delegation branch needs to embed a parseable SP4 decision. **Decision (J13)**: SP16 owns `PcdRoutingDecisionSchema` for now, with a `// MERGE-BACK:` marker noting that SP17 may move it to `pcd-provenance.ts` when persistence becomes a concern. **Risk**: schema drift between SP4's TS type and SP16's zod schema. Mitigation: a co-located test in `pcd-synthetic-router.test.ts` constructs a `PcdRoutingDecision` (via `routePcdShot` call against an in-memory store) and round-trips it through `PcdRoutingDecisionSchema.parse()` — any drift surfaces as a test failure. Alternative considered: put the schema in `packages/schemas/src/pcd-provider-router.ts` (a net-new schema file colocated with SP4 by convention rather than slice ownership). Rejected because that file would have no other content and would be net-new infrastructure for SP4 that SP4's own slice didn't ship — a small but real cross-slice edit. SP16's file owning it is a smaller footprint.

- **U2: Does the `klingDirection.avoid: ReadonlyArray<string>` field need any post-processing into a "negative prompt" string at decision time?** SP11 stores `avoid` as a structured array. Kling's actual API takes a `negative_prompt` string (typically comma-joined avoid terms). **Decision**: NO transformation at SP16. The decision struct carries `klingDirection` verbatim — provider-call layer joins / formats. Keeps SP16 pure; mirrors the "verbatim from SP11" principle.

- **U3: Should the success branch additionally surface a `kling_compatibility_warning` enum when SP4's matrix would otherwise reject the shot type for Kling under tier3 rules?** Specifically: tier-3 talking_head requires `performance_transfer` per SP4's tier3 rules; the SP4 matrix's Kling row has `supportsPerformanceTransfer: false`, so generic Kling cannot serve tier-3 talking_head; HeyGen would be SP4's choice. SP16's locked pairing overrides this — synthetic creators route to Kling for tier-3 talking_head regardless. **Decision**: NO warning surfaced at SP16. This is by design (Q9); the synthetic-creator authoring layer is responsible for ensuring the locked Kling direction is good enough for talking_head. Surfacing a "you've overridden SP4's tier3 capability rule" warning at decision time creates a noisy signal for an intentional override. If a future ops concern wants visibility into "which decisions overrode SP4's would-be choice", that's a separate forensics layer (likely SP17 provenance with a `tier3OverrideFlag` field).

- **U4: How is the `accessDecision: PcdTierDecision` on the synthetic success branch validated against SP4's own access decision when delegation eventually happens for a sibling shot in the same job?** SP21 composer's job. SP16 returns its own decision per call; cross-call consistency is upstream.

- **U5: Does the v1 single-row matrix mean `pairingRefIndex` is always 0 on success?** Yes. The field exists for future-proofing (multi-row matrix) and for forensic parallel with SP4's `capabilityRefIndex`. Anti-pattern test asserts `pairingRefIndex === 0` in v1. The test will need widening when row 2 is added.

- **U6: SP4's `decisionReason.tier3RulesApplied: Tier3Rule[]` is empty on the synthetic path's success branch (no field exists at all)**. Is this a regression in forensic info compared to SP4? Per Q9, yes intentionally — synthetic path doesn't apply tier3 rules. **Open question**: should the decision struct still carry an explicit `tier3RulesApplied: []` empty array as a positive signal that no rules fired (rather than the absence of the field)? **Decision**: NO. The synthetic decision struct's shape is structurally distinct from SP4's (different `kind` discriminator). Consumers narrowing on `kind === "synthetic_pairing"` cannot accidentally read a missing `tier3RulesApplied` from the wrong shape. Cleaner to omit than to carry an always-empty array.

- **U7: How does SP21 composer handle the case where a single job spans multiple shot types — some in-pairing (synthetic decision), some out-of-pairing (delegated)?** SP16 doesn't care — each shot is its own routing decision. SP21's concern. Out of SP16 scope.

- **U8: Does the pairing matrix need an explicit `tiers: ReadonlyArray<IdentityTier>` field paralleling SP4's matrix?** SP4 filters candidates by `effectiveTier`. SP16 v1 doesn't — the pairing applies regardless of tier (tier gate is upstream). **Decision**: NO `tiers` field on `SyntheticProviderPairing`. The tier-policy check (Step 3) is the gate; the matrix is pairing-data, not tier-data. Future widening with multiple rows might need it (e.g., "tier 2 synthetic uses pairing X, tier 3 uses pairing Y") — at that point, the field is added. v1 is single-pairing-for-all-allowed-tiers.

---

## 9. Implementation slicing (preview, not the plan)

The SP16 plan will be written next via `writing-plans`. Anticipated task list, TDD-paced (one test commit per task):

| # | Task | Approx tests |
|---|---|---|
| 1 | Pre-flight: assert `git diff 9dca008..HEAD -- packages/db/prisma/schema.prisma` is empty (SP16 has no migration); `pnpm test` is green at SP15 baseline (1889 + 2 skipped); `pnpm exec prettier --check ...` clean modulo the 2 SP5-baseline warnings. **Plan-time pre-flight:** `grep -n "z\.discriminatedUnion\|z\.union" packages/schemas/src/pcd-{disclosure-template,script-template,synthetic-selector}.ts` — verify the established `z.union` carve-out (with NB comment) is still the source convention. | — |
| 2 | New `pcd-synthetic-router.ts` zod schema (both `PcdRoutingDecisionSchema` and `SyntheticPcdRoutingDecisionSchema`) + co-located tests. Widen `packages/schemas/src/index.ts` barrel in the **same task** (SP14/SP15 lesson — barrel widens with first consumer). | ~14 |
| 3 | New `synthetic-router-version.ts` constant (20th pinned). Single-source literal. | — |
| 4 | New `synthetic-provider-pairing.ts` (matrix + 21st pinned constant) + pairing-matrix tests (~8). | ~8 |
| 5 | New `route-synthetic-pcd-shot.ts` skeleton — function signature, return-stub-delegation for everything, lands the file + import surface. | — |
| 6 | Step 1 (matrix lookup) + Step 2 (delegation branch) + delegation-path tests. | ~6 |
| 7 | Step 3 (tier policy gate) + denial-path tests. | ~5 |
| 8 | Step 4 (synthetic-pairing success branch with locked artifacts verbatim) + happy-path tests covering all 28 (video shot × output intent) combos parametrically + locked-artifact byte-equality tests + version pin invariants. | ~10 |
| 9 | `buildSyntheticSelectionRationale` + rationale-content tests + 200-char cap test. | ~3 |
| 10 | Determinism property test (one-line per-invocation deep-equal). | ~1 |
| 11 | Stores-ignored-on-synthetic-path mock test + stores-used-on-delegation-path spy test. | ~2 |
| 12 | `sp16-anti-patterns.test.ts` — 6 assertions (single-source pins ×2, purity, no-SP4-internals-leakage, cross-slice-token-blacklist, matrix-integrity). | ~6 |
| 13 | Allowlist-maintenance fix-up — widen 7 prior anti-pattern test allowlists. | — |
| 14 | Final barrel re-export (`packages/creative-pipeline/src/index.ts`). | — |
| 15 | Final full-repo `pnpm typecheck && pnpm test && pnpm exec prettier --check ...` sweep. Target: ~1941 passing + 2 skipped. | — |

Estimated: **~13–15 commits** on the branch, squashed to **1 PR** against `main`.

**Worktree:** `.worktrees/sp16`. Every implementer subagent prompt opens with `pwd` + `git branch --show-current` and refuses to proceed if the path/branch doesn't match — per the SP13/SP14/SP15 subagent-wrong-worktree lesson.

---

*End of design spec. Awaiting user review per brainstorming skill review gate before transitioning to writing-plans.*
