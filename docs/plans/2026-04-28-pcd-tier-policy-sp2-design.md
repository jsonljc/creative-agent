---
date: 2026-04-28
tags: [pcd, sp2, tier-policy, design]
status: approved
---

# PCD SP2 — `PcdTierPolicy` Design

**Slice:** SP2 of the PCD vertical (SP1 shipped 2026-04-28 as `05bc4655` in Switchboard, then extracted to this repo).
**Goal:** Build the deterministic backend-enforced tier gate that decides whether a given `(avatarTier, productTier, shotType, outputIntent)` is allowed.
**Source-of-truth spec:** `docs/plans/2026-04-27-pcd-identity-registry-design.md` — sections "Tier gating rules", "Tier policy test matrix", and the reference `decidePcdGenerationAccess` signature.
**Handoff context:** `docs/plans/2026-04-28-pcd-sp2-handoff.md`.

This design document captures the four design decisions made during brainstorming and the implementation contract for SP2. It is binding: SP2 ships exactly what is described here. Anything not described here is out of scope for SP2.

## Section 1 — Scope & non-goals

### In scope (SP2)

- One pure function: `decidePcdGenerationAccess(input) → PcdTierDecision`.
- One exported constant: `PCD_TIER_POLICY_VERSION = "tier-policy@1.0.0"`.
- Four new Zod schemas in `@creativeagent/schemas`:
  `PcdShotTypeSchema`, `OutputIntentSchema`, `PcdRequiredActionSchema`, `PcdTierDecisionSchema` with inferred TypeScript types.
- Reuse existing `IdentityTier` from `pcd-identity.ts` (SP1).
- Exhaustive matrix tests plus 8 named acceptance tests.

### Out of scope (do not touch in SP2)

- DB / Prisma / migrations.
- Inngest / I/O / network.
- `PcdRegistryResolver` (SP3).
- `ProviderRouter`, provider capability matrix, Tier 3 routing rules (SP4).
- `PcdIdentitySnapshot` writer (SP4) — SP2 only exports the version constant it will consume.
- QC gates (SP5).
- Consent enforcement, approval, Meta draft creation, revocation (SP6).
- `identityAdapter` / adapter readiness logic (v2).
- Model selection, prompt construction, camera controls, video generation, or any Higgsfield-style workflow orchestration.

### Layer rules

- Schema definitions live in Layer 1: `@creativeagent/schemas`.
- The policy function lives in `creative-pipeline` but must remain pure and dependency-light.
- `tier-policy.ts` must not import `@creativeagent/db`, `@prisma/client`, provider routers, registry resolvers, network clients, or execution/runtime modules.
- SP2 may only depend on schemas/types and local deterministic rule data.

## Section 2 — File layout & exports

### New file: `packages/schemas/src/pcd-tier-policy.ts`

Defines:

- **`PcdShotTypeSchema`** — z.enum of:
  `script_only`, `storyboard`, `simple_ugc`, `talking_head`, `product_demo`, `product_in_hand`, `face_closeup`, `label_closeup`, `object_insert`.

  > **Documented divergence from the source-of-truth spec:** the original design spec lists `meta_ad_draft` inside `PcdShotType`. SP2 removes it because it duplicates `OutputIntent.meta_draft` semantically — `meta_draft` is an output destination, not a shot composition. SP3+ should not re-introduce `meta_ad_draft` as a shot type.

- **`OutputIntentSchema`** — z.enum of: `draft`, `preview`, `final_export`, `meta_draft`.
- **`PcdRequiredActionSchema`** — z.enum of (in canonical order):
  `upgrade_avatar_identity`, `upgrade_product_identity`, `use_lower_output_intent`, `choose_safer_shot_type`.
  (`choose_safer_shot_type` is reserved for future rules; SP2 does not currently emit it.)
- **`PcdTierDecisionSchema`**:

  ```ts
  {
    allowed: boolean,
    effectiveTier: IdentityTier,
    requiredAvatarTier?: IdentityTier,
    requiredProductTier?: IdentityTier,
    reason?: string,
    requiredActions?: PcdRequiredAction[]
  }
  ```

`effectiveTier` is the lower of `avatarTier` and `productTier`. The weakest identity component controls the generation access level. Missing tiers are treated as Tier 1.

Re-export everything from `packages/schemas/src/index.ts`.

### New file: `packages/creative-pipeline/src/pcd/tier-policy.ts`

Exports:

- `PCD_TIER_POLICY_VERSION = "tier-policy@1.0.0"` (const).
- `decidePcdGenerationAccess(input): PcdTierDecision` (pure function).

**Allowed imports:** `@creativeagent/schemas` only.
**Forbidden imports:** `@creativeagent/db`, `@prisma/client`, provider routers, registry resolvers, network clients, execution/runtime modules.

> **SP4 obligation (recorded here, not implemented):** SP4's `PcdIdentitySnapshot` writer must persist `PCD_TIER_POLICY_VERSION` into each snapshot it writes. SP2 does not stamp the version onto every `PcdTierDecision` — the const-import pattern is the contract.

### New file: `packages/creative-pipeline/src/pcd/tier-policy.test.ts`

Vitest. See Section 4.

### Update: `packages/creative-pipeline/src/index.ts`

Re-export `decidePcdGenerationAccess` and `PCD_TIER_POLICY_VERSION` so SP3/SP4 consumers don't reach into deep paths.

## Section 3 — Decision logic

### Input contract

```ts
type DecidePcdGenerationAccessInput = {
  avatarTier?: IdentityTier;
  productTier?: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
};
```

### Missing-tier handling

- Missing `avatarTier` → treated as Tier 1.
- Missing `productTier` → treated as Tier 1.
- Conservative: unknown identity quality must not unlock stronger outputs.

### Definitions

- `effectiveTier = min(avatarTier ?? 1, productTier ?? 1)`.
- `OutputIntent.draft` = internal-only, non-publishable creative work. Always allowed regardless of tier.
- `OutputIntent.meta_draft` = ad-account draft; **not** covered by the draft shortcut.

### Evaluation model

Compute the total `requiredAvatarTier` and `requiredProductTier` from both `shotType` and `outputIntent`, then compare actual tiers against required tiers. Aggregate all `requiredActions`. **No short-circuit on first failure** — return full deterministic data so UI, debugging, and SP3/SP4/SP5 integrations can act on it.

### Steps

**Step 1 — Draft shortcut.** If `outputIntent === "draft"`, return `{ allowed: true, effectiveTier }` and **omit** `requiredAvatarTier`, `requiredProductTier`, `reason`, `requiredActions`.

**Step 2 — Base requirements.** Start with `requiredAvatarTier = 1`, `requiredProductTier = 1`.

**Step 3 — Apply shot-type requirements.**

| Shot type | Requirement |
|---|---|
| `face_closeup` | raise `requiredAvatarTier` to 3 |
| `label_closeup` | raise `requiredProductTier` to 3 |
| `object_insert` | raise `requiredProductTier` to 3 |
| all others | no additional shot-specific floor |

**Step 4 — Apply output-intent requirements.**

| Output intent | Requirement |
|---|---|
| `preview` | none (effectiveTier ≥ 1 always satisfied) |
| `final_export` | raise both `requiredAvatarTier` and `requiredProductTier` to at least 2 |
| `meta_draft` | raise both `requiredAvatarTier` and `requiredProductTier` to at least 2 |

Requirements compose by `max` — e.g. `face_closeup` + `final_export` yields `requiredAvatarTier=3`, `requiredProductTier=2`.

> SP2 only enforces tier sufficiency for `meta_draft`. Approval, compliance, consent, and Meta draft creation remain SP6/runtime concerns. The decision shape never claims approval/compliance was checked.

**Step 5 — Compare actual tiers and aggregate actions.**

- If `(avatarTier ?? 1) < requiredAvatarTier` → add `upgrade_avatar_identity`.
- If `(productTier ?? 1) < requiredProductTier` → add `upgrade_product_identity`.
- If `outputIntent ∈ { final_export, meta_draft }` and `effectiveTier < 2` → add `use_lower_output_intent`.
- Actions are deduplicated and emitted in fixed canonical order: `upgrade_avatar_identity`, `upgrade_product_identity`, `use_lower_output_intent`, `choose_safer_shot_type`.

**Step 6 — Return decision.**

- No failures → `{ allowed: true, effectiveTier }`.
- Any failure → `{ allowed: false, effectiveTier, requiredAvatarTier, requiredProductTier, reason, requiredActions }`.

### Reason-string rule

Generated from the **aggregate required tiers**, not from individual failed fields:

- Both `requiredAvatarTier > 1` and `requiredProductTier > 1`:
  `"generation requires avatarTier>=X and productTier>=Y"`
- Only `requiredAvatarTier > 1`:
  `"generation requires avatarTier>=X"`
- Only `requiredProductTier > 1`:
  `"generation requires productTier>=Y"`

Tests assert exact strings.

### Implementation clarifications (locked)

1. Draft shortcut returns only `{ allowed: true, effectiveTier }`.
2. Reason strings must be generated from aggregate required tiers, not from failed fields only.
3. Do not throw for valid schema input. Zod-valid input always returns a `PcdTierDecision`.
4. Do not add logging, time checks, DB access, provider routing, snapshot writing, approval checks, or QC logic.
5. Keep `requiredActions` in canonical order: `upgrade_avatar_identity`, `upgrade_product_identity`, `use_lower_output_intent`, `choose_safer_shot_type`.

## Section 4 — Test plan

**File:** `packages/creative-pipeline/src/pcd/tier-policy.test.ts` (Vitest).

### Part A — Exhaustive cross-product matrix (`it.each`)

Cross-product:

- `avatarTier`: `1 | 2 | 3 | undefined`
- `productTier`: `1 | 2 | 3 | undefined`
- `shotType`: 9 values
- `outputIntent`: 4 values

Total: **4 × 4 × 9 × 4 = 576 cases**.

Each row uses an **expected-outcome computer** local to the test file. Its rule tables (`SHOT_TYPE_REQ`, `INTENT_REQ`) are defined **inside the test file** and **must not import from `tier-policy.ts`**. The only imports from `tier-policy.ts` are `decidePcdGenerationAccess` and `PCD_TIER_POLICY_VERSION`. This prevents the "implementation is wrong, test imports same wrong table, test still passes" failure mode.

```ts
const SHOT_TYPE_REQ: Record<PcdShotType, { avatar?: 2 | 3; product?: 2 | 3 }> = {
  face_closeup:  { avatar: 3 },
  label_closeup: { product: 3 },
  object_insert: { product: 3 },
  // others: {}
};
const INTENT_REQ: Record<OutputIntent, { effective?: 2 } | "draft_shortcut"> = {
  draft:        "draft_shortcut",
  preview:      {},
  final_export: { effective: 2 },
  meta_draft:   { effective: 2 },
};
```

Expected-outcome computer:

1. If `outputIntent === "draft"` → `{ allowed: true, effectiveTier: min(a??1, p??1) }`, no other fields.
2. Else compose `requiredAvatarTier` / `requiredProductTier` by `max`, compare against `(a??1, p??1)`, emit the expected `PcdTierDecision`.

**Assertions per row:**

- `allowed` matches.
- `effectiveTier` matches.
- When `allowed: false`: `requiredAvatarTier`, `requiredProductTier`, `reason`, `requiredActions` (exact array, canonical order) all match.
- When `allowed: true`: those four optional fields are **absent** (assert minimal shape).

`it.each` titles include the four input values for pinpointable failures: `"a=3 p=1 shot=label_closeup intent=final_export → block"`.

### Part B — Named acceptance tests (the spec's 8 required assertions)

Each is a single `it(...)` for readability and as living documentation:

1. Tier 3 avatar + Tier 1 product **cannot** `final_export`.
2. Tier 1 avatar + Tier 3 product **cannot** `final_export`.
3. Tier 2 + Tier 2 **can** standard `final_export` (any non-restricted shot type).
4. `label_closeup` requires `productTier = 3`.
5. `face_closeup` requires `avatarTier = 3`.
6. `object_insert` requires `productTier = 3`.
7. `meta_draft` requires `effectiveTier ≥ 2`. The test explicitly asserts the SP2 contract: SP2 does NOT enforce approval or compliance, only tier sufficiency. Comment references SP6 for the runtime checks.
8. `outputIntent = "draft"` is always allowed regardless of tier (loop over the 4×4 tier combos × 9 shot types and assert `allowed: true` + minimal shape).

### Part C — Contract tests for purity & shape

- **Determinism smoke test:** call the function twice with one representative blocked input, deep-equal; once more with one representative allowed input, deep-equal. (Implementation purity is enforced by the forbidden-import guard, not by loop count.)
- **Allowed shape minimality:** an allowed decision contains exactly the keys `["allowed", "effectiveTier"]`.
- **Blocked shape:** `requiredActions` is in canonical order and deduplicated; assert against a few representative cases.
- **Reason-string rule:**
  - both tiers > 1 required → `"generation requires avatarTier>=X and productTier>=Y"`
  - only avatar > 1 → `"generation requires avatarTier>=X"`
  - only product > 1 → `"generation requires productTier>=Y"`
- **Schema round-trip:** every decision returned passes `PcdTierDecisionSchema.parse(...)` without throwing.
- **Version constant:** `expect(PCD_TIER_POLICY_VERSION).toBe("tier-policy@1.0.0")`. Locks the value SP4 will pin into snapshots.

### Part D — Forbidden imports check

Read the source of `tier-policy.ts` as text and assert via regex that it contains none of:

- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`
- `from "http"` / `from "https"`

This is a layer guard, not a runtime check. Provider/router/resolver module paths will be added to this list as SP3/SP4 land; SP2 ships with the list above.

### What's NOT tested in SP2

- Snapshot writing, router behavior, resolver behavior — SP3/SP4.
- Approval/compliance/consent — SP6.
- Performance benchmarks — pure 4-input pure function; not warranted.

## Design questions resolved during brainstorming

| Q | Answer | Rationale |
|---|---|---|
| Q1: Where do `PcdShotType` / `OutputIntent` schemas live? | New `packages/schemas/src/pcd-tier-policy.ts`, re-exported from `index.ts`. | Matches the spec's locked package placement; avoids a later move when SP3/SP4/SP5 consume them. |
| Q2: Should the policy consider `identityAdapter`? | No. | Adapter presence affects *how* SP4's router runs, not *whether* generation is allowed. Keeps SP2 deterministic on 4 inputs. |
| Q3: Where does `policyVersion` live? | Exported `const PCD_TIER_POLICY_VERSION` from `tier-policy.ts`. Not stamped on every `PcdTierDecision`. | Single source of truth; SP4's snapshot writer imports it directly. Decisions stay minimal. |
| Q4: Test structure for the matrix? | Full cross-product `it.each` (576 cases) **plus** 8 named acceptance tests. | Catches accidental over-permissiveness in any cell; named tests double as living documentation. |

## Hard guardrails for implementation

- No DB.
- No I/O.
- No router behavior.
- No adapter readiness logic.
- No generation logic.
- No side effects.
- No "temporary" local schema types if they are meant to be shared later.
- No expansion into snapshot writing, routing, resolver logic, or adapter behavior — those are SP3/SP4.
- Output: a small deterministic policy module plus tests.

## Architectural context

This SP2 module sits at the **deterministic gate** position in the broader PCD orchestration:

```
PCD job submitted
  → PcdRegistryResolver        (SP3)
  → PcdTierPolicy              ◀── SP2 (this slice)
  → ShotSpecPlanner            (later)
  → ProviderRouter (tier-aware) (SP4)
  → execution → snapshot       (SP4)
  → QC                         (SP5)
  → Approval / export          (SP6)
```

The deliberate design choice is that **the gate has no opinion about how a generation is executed**. It only answers "is this `(avatarTier, productTier, shotType, outputIntent)` combination permitted?" Every other concern — provider selection, anchoring rules, similarity scoring, consent, approval — lives downstream.
