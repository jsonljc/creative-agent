---
date: 2026-04-28
tags: [pcd, sp3, registry-resolver, design]
status: approved
---

# PCD SP3 — `PcdRegistryResolver` Design

**Slice:** SP3 of the PCD vertical. SP1 (`05bc4655` in Switchboard, extracted as `creativeagent` `10a5ce0`) and SP2 (`creativeagent` `cb7a378`) have shipped.
**Goal:** Build a per-job, store-injected, pure-orchestration function that resolves or creates `ProductIdentity` and `CreatorIdentity` for a PCD job, computes `effectiveTier`, and attaches the five required scalar fields to the job before shot planning.
**Source-of-truth spec:** `docs/plans/2026-04-27-pcd-identity-registry-design.md` — section "Architecture / Components / PcdRegistryResolver" and the SP3 acceptance criteria in the Sprint plan.
**Upstream slice:** SP2 design `docs/plans/2026-04-28-pcd-tier-policy-sp2-design.md` (the deterministic gate SP3 deliberately does **not** call).

This design document captures the five design decisions made during brainstorming and the implementation contract for SP3. It is binding: SP3 ships exactly what is described here. Anything not described here is out of scope for SP3.

## Section 1 — Scope & non-goals

### In scope (SP3)

- One exported function:
  `resolvePcdRegistryContext(job, stores) → Promise<ResolvedPcdContext>`
  in `packages/creative-pipeline/src/pcd/registry-resolver.ts`.
- One exported constant:
  `PCD_SHOT_SPEC_VERSION = "shot-spec@1.0.0"`
  in `packages/creative-pipeline/src/pcd/shot-spec-version.ts`.
- One exported type: `ResolvedPcdContext`, the five attached fields:
  `productIdentityId`, `creatorIdentityId`, `effectiveTier`, `allowedOutputTier`, `shotSpecVersion`.
- One exported store-contract type: `RegistryResolverStores`.
- One exported job-input type: `PcdResolvableJob` — the minimum subset of `CreativeJob` the resolver reads.
- Local pure mapping helpers inside `registry-resolver.ts`:
  - `mapProductQualityTierToIdentityTier`
  - `mapCreatorQualityTierToIdentityTier`
- Locked quality-tier mappings:
  - Product: `url_imported → 1`, `verified → 2`, `canonical → 3`.
  - Creator: `stock → 1`, `anchored → 2`, `soul_id → 3`.
- Co-located unit tests with in-memory fake stores covering:
  - strict five-field current-version idempotency guard
  - both find-or-create paths
  - product and creator tier mapping (exhaustive)
  - `effectiveTier = min(productTier, creatorTier)` (3×3 cross-product)
  - `allowedOutputTier = effectiveTier`
  - `shotSpecVersion` stamping
  - full attach flow (post-finder ordering only — no product-vs-creator order)
  - forbidden-imports guard
  - store-contract idempotency expectations (documentation tests)
- Re-export from `packages/creative-pipeline/src/index.ts`.

### Out of scope (do not touch in SP3)

- DB schema / Prisma schema / migrations.
- DB-package edits of any kind. The `findOrCreateForJob` / `findOrCreateStockForDeployment` methods are contract-only in this repo (declared in SP1's `BackfillStores`); concrete Prisma implementations live in `apps/api` (out-of-tree) and will land at merge-back. SP3 declares its own `RegistryResolverStores` contract with the augmented `{ id, qualityTier }` return shape. SP1's `BackfillStores` interface is unchanged. `registry-backfill.ts` is unchanged.
- `apps/api` wiring (we don't have `apps/api` in this repo).
- `decidePcdGenerationAccess` invocation. The resolver is a context resolver, not a policy gate. Per-shot generation access is evaluated downstream once concrete `(shotType, outputIntent)` exists.
- `evaluatePcdGenerationAccessForJob` helper. Explicitly rejected — it would be a fused resolver+policy entry point that violates the resolver boundary.
- `PcdProviderCapabilityMatrix`, `ProviderRouter`, Tier 3 routing rules — SP4.
- `PcdIdentitySnapshot` writer — SP4. (SP4's snapshot writer must persist both `PCD_TIER_POLICY_VERSION` and `PCD_SHOT_SPEC_VERSION`.)
- `ShotSpecPlanner` body — SP4. SP3 only declares the version constant the planner will use.
- QC gates — SP5.
- Approval / Meta draft / consent revocation — SP6.
- Any change to SP2 `tier-policy.ts` or its schemas.
- Any change to SP1 backfill behavior beyond the resolver mirroring its finder method names.

### Layer rules

- Resolver lives in `packages/creative-pipeline`. Pure orchestration; all I/O via injected stores.
- No imports of `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `http`, `https`, or any provider/router module.
- Allowed imports: `@creativeagent/schemas` for the tier types/schemas needed by the type contract, and `./shot-spec-version.js` for `PCD_SHOT_SPEC_VERSION`.
- SP1 backfill and SP3 resolver share identity-resolution semantics by mirroring the same finder method names. They differ in:
  - Job-write step: SP1 uses `markRegistryBackfilled`; SP3 uses `attachIdentityRefs`.
  - Store contract: SP1 owns `BackfillStores` (returns `{ id }`); SP3 owns `RegistryResolverStores` (returns `{ id, qualityTier }`).
- Do not refactor `BackfillStores`. Do not import `BackfillStores` into SP3. Do not modify `registry-backfill.ts`.

## Section 2 — File layout & exports

### New file: `packages/creative-pipeline/src/pcd/shot-spec-version.ts`

```ts
export const PCD_SHOT_SPEC_VERSION = "shot-spec@1.0.0";
```

Single-line module. Owns nothing else. SP4's snapshot writer will import this constant directly.

### New file: `packages/creative-pipeline/src/pcd/registry-resolver.ts`

**Public exports:**

- `resolvePcdRegistryContext(job, stores) → Promise<ResolvedPcdContext>` — the resolver.
- `type ResolvedPcdContext` — the five attached fields.
- `type RegistryResolverStores` — the store contract.
- `type PcdResolvableJob` — the minimum job-input shape the resolver reads.

**Private helpers (not exported):**

- `isResolvedPcdJob(job): boolean` — strict five-field current-version guard.
- `mapProductQualityTierToIdentityTier(t: ProductQualityTier): IdentityTier`
- `mapCreatorQualityTierToIdentityTier(t: AvatarQualityTier): IdentityTier`
- `computeEffectiveTier(productTier: IdentityTier, creatorTier: IdentityTier): IdentityTier`

**Allowed imports:** `@creativeagent/schemas` for the tier types/schemas needed by the type contract, and `./shot-spec-version.js` for `PCD_SHOT_SPEC_VERSION`.

**Forbidden imports (asserted by Part F test):**

- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`
- `from "http"` / `from "https"`
- `./tier-policy.js` (Q1 lock — no policy call)
- `./registry-backfill.js` (no SP1 backfill dependency)

### New file: `packages/creative-pipeline/src/pcd/registry-resolver.test.ts`

Vitest. See Section 5.

### Update: `packages/creative-pipeline/src/index.ts`

Add re-exports:

```ts
export {
  resolvePcdRegistryContext,
  type ResolvedPcdContext,
  type RegistryResolverStores,
  type PcdResolvableJob,
} from "./pcd/registry-resolver.js";
export { PCD_SHOT_SPEC_VERSION } from "./pcd/shot-spec-version.js";
```

### No DB-package edits in SP3

SP3 ships zero changes inside `packages/db`. The `findOrCreateForJob` / `findOrCreateStockForDeployment` methods are contract-only in this repo (declared in SP1's `BackfillStores`); concrete Prisma implementations live in `apps/api` (out-of-tree) and will land at merge-back. SP3 declares its own `RegistryResolverStores` contract with the augmented `{ id, qualityTier }` return shape. SP1's `BackfillStores` interface is unchanged.

### What does NOT change

- `packages/db/prisma/schema.prisma` — untouched.
- Any file in `packages/db/src/` — untouched.
- `packages/creative-pipeline/src/pcd/tier-policy.ts` — untouched.
- `packages/creative-pipeline/src/pcd/registry-backfill.ts` — untouched.
- All SP1 / SP2 schemas in `@creativeagent/schemas` — untouched.

## Section 3 — Types & contracts

### `PcdResolvableJob`

The minimum subset of `CreativeJob` the resolver reads. Verified against SP1's `BackfillJobInput` (`registry-backfill.ts`) — `PcdResolvableJob` is a structural superset.

```ts
export type PcdResolvableJob = {
  // Identity for the write target.
  id: string;

  // Inputs to productStore.findOrCreateForJob.
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  productImages: string[];

  // Idempotency guard fields. All five must be present (with current
  // shotSpecVersion) for the no-op path.
  productIdentityId?: string | null;
  creatorIdentityId?: string | null;
  effectiveTier?: IdentityTier | null;
  allowedOutputTier?: IdentityTier | null;
  shotSpecVersion?: string | null;
};
```

### `ResolvedPcdContext`

```ts
export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: string;
};
```

Returned both in the no-op (already-resolved) path and the full-attach path. All five fields required and non-nullable on output.

### `RegistryResolverStores`

```ts
export type RegistryResolverStores = {
  productStore: {
    findOrCreateForJob(job: PcdResolvableJob): Promise<{
      id: string;
      qualityTier: ProductQualityTier;
    }>;
  };
  creatorStore: {
    findOrCreateStockForDeployment(deploymentId: string): Promise<{
      id: string;
      qualityTier: AvatarQualityTier;
    }>;
  };
  jobStore: {
    attachIdentityRefs(jobId: string, refs: ResolvedPcdContext): Promise<void>;
  };
};
```

Notes:

- `attachIdentityRefs` parameter shape is `ResolvedPcdContext` directly. The existing `PrismaCreativeJobStore.attachIdentityRefs` accepts `AttachIdentityRefsInput` with the same five fields plus an optional `fidelityTierAtGeneration`. `ResolvedPcdContext` is structurally assignable. SP3's contract does not require `fidelityTierAtGeneration` (owned by SP4's snapshot path).
- `attachIdentityRefs` returns `Promise<void>` from the resolver's perspective. The existing Prisma method returns `CreativeJob`; the resolver discards.

### Quality-tier mapping (locked, private to resolver)

```ts
function mapProductQualityTierToIdentityTier(t: ProductQualityTier): IdentityTier {
  switch (t) {
    case "url_imported": return 1;
    case "verified":     return 2;
    case "canonical":    return 3;
  }
}

function mapCreatorQualityTierToIdentityTier(t: AvatarQualityTier): IdentityTier {
  switch (t) {
    case "stock":    return 1;
    case "anchored": return 2;
    case "soul_id":  return 3;
  }
}
```

Exhaustive `switch` with no `default` arm so future enum extensions fail typecheck rather than silently mapping to a wrong tier.

### `computeEffectiveTier`

```ts
function computeEffectiveTier(p: IdentityTier, c: IdentityTier): IdentityTier {
  return (p <= c ? p : c) as IdentityTier;
}
```

### `isResolvedPcdJob` (strict five-field current-version guard)

```ts
type ResolvedPcdResolvableJob = PcdResolvableJob & {
  productIdentityId: string;
  creatorIdentityId: string;
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: typeof PCD_SHOT_SPEC_VERSION;
};

function isResolvedPcdJob(j: PcdResolvableJob): j is ResolvedPcdResolvableJob {
  return (
    typeof j.productIdentityId === "string" &&
    typeof j.creatorIdentityId === "string" &&
    (j.effectiveTier === 1 || j.effectiveTier === 2 || j.effectiveTier === 3) &&
    (j.allowedOutputTier === 1 || j.allowedOutputTier === 2 || j.allowedOutputTier === 3) &&
    j.shotSpecVersion === PCD_SHOT_SPEC_VERSION
  );
}
```

A job carrying a stale `shotSpecVersion` is treated as unresolved and re-stamped under the current spec.

## Section 4 — Resolver algorithm

```ts
export async function resolvePcdRegistryContext(
  job: PcdResolvableJob,
  stores: RegistryResolverStores,
): Promise<ResolvedPcdContext> {
  // Step 1 — Idempotency guard.
  if (isResolvedPcdJob(job)) {
    return {
      productIdentityId: job.productIdentityId,
      creatorIdentityId: job.creatorIdentityId,
      effectiveTier: job.effectiveTier,
      allowedOutputTier: job.allowedOutputTier,
      shotSpecVersion: job.shotSpecVersion,
    };
  }

  // Step 2 — Resolve identities through injected store contracts.
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(
    job.deploymentId,
  );

  // Step 3 — Map registry-side qualityTier strings to IdentityTier.
  const productTier = mapProductQualityTierToIdentityTier(product.qualityTier);
  const creatorTier = mapCreatorQualityTierToIdentityTier(creator.qualityTier);

  // Step 4 — Compute effectiveTier and stamp allowedOutputTier + shotSpecVersion.
  const effectiveTier = computeEffectiveTier(productTier, creatorTier);
  const resolved: ResolvedPcdContext = {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
    effectiveTier,
    allowedOutputTier: effectiveTier,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };

  // Step 5 — Persist via injected jobStore.
  await stores.jobStore.attachIdentityRefs(job.id, resolved);

  // Step 6 — Return.
  return resolved;
}
```

### Algorithm guarantees

| Property | Guarantee |
|---|---|
| **Purity / I/O surface** | All I/O through injected `stores`. No direct DB, network, fs, time, randomness. |
| **Idempotency** | Repeated calls on a fully-resolved job (under current `PCD_SHOT_SPEC_VERSION`) perform zero store calls and return identical context. |
| **Stale-version re-stamping** | A job with `shotSpecVersion !== PCD_SHOT_SPEC_VERSION` re-runs the full path. Identity IDs may already exist; find-or-create returns the existing rows; `attachIdentityRefs` overwrites the scalar fields with the new version. **Store-contract note:** implementations of `findOrCreateForJob` / `findOrCreateStockForDeployment` must be idempotent when a job already carries identity refs or registry uniqueness keys. Re-stamping a stale `shotSpecVersion` must not create duplicate product/creator identity rows. |
| **Tier monotonicity** | `effectiveTier = min(productTier, creatorTier)` always. |
| **Output completeness** | All five fields present and non-nullable on every successful return. |
| **No partial writes** | If `attachIdentityRefs` throws, the resolver propagates. Registry-side finders may have created identity rows already; that is fine — they are owned by the registry, not the job, and are reused on retry. |
| **No policy leakage** | `tier-policy.ts` is not imported. `decidePcdGenerationAccess` is not called. |
| **No router leakage** | No provider, capability matrix, or router import. |

### What the algorithm deliberately does NOT do

- Does not validate that `productDescription` / `productImages` are non-empty. The finder owns input-validity decisions for the registry side; controlled errors propagate.
- Does not branch on `outputIntent`, `shotType`, `mode`, or any per-shot field.
- Does not write a `WorkTrace` or `PcdIdentitySnapshot`. Snapshot writing is SP4. (At Switchboard merge-back, SP4 is where the `// MERGE-BACK: emit WorkTrace here` comment will land.)
- Does not call SP2's policy. Policy evaluation happens downstream once concrete `(shotType, outputIntent)` exists.
- Does not emit telemetry, logs, or metrics.
- Does not handle partial-resolution states beyond the strict five-field current-version guard. The full path is safe under partial state because find-or-create reuses existing rows.

## Section 5 — Test plan

**File:** `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` (Vitest, co-located).

In-memory fake stores back every test. No Prisma, no DB, no network.

### Part A — Idempotency guard (strict five-field current-version)

For each case, build a `PcdResolvableJob`, run the resolver against fakes that record every call, assert (a) the returned context, (b) zero finder calls, (c) zero `attachIdentityRefs` calls.

1. Fully resolved at current version → no-op.
2. Stale `shotSpecVersion` (e.g. `"shot-spec@0.9.0"`) → full path; `attachIdentityRefs` called with current-version stamp.
3. Missing `productIdentityId` → full path.
4. Missing `creatorIdentityId` → full path.
5. Missing `effectiveTier` → full path.
6. Missing `allowedOutputTier` → full path.
7. Missing `shotSpecVersion` → full path.
8. `effectiveTier` outside `1|2|3` (e.g. `0`) → full path.
9. `allowedOutputTier` outside `1|2|3` → full path.

### Part B — Tier mapping (exhaustive)

Driven through the public resolver with controlled fake-store returns.

1. Product mapping: `url_imported → 1`, `verified → 2`, `canonical → 3`.
2. Creator mapping: `stock → 1`, `anchored → 2`, `soul_id → 3`.

### Part C — `effectiveTier` and `allowedOutputTier` math (3×3 cross-product)

Drive resolver across all nine `(productQualityTier, creatorQualityTier)` combos. Assert `effectiveTier === min(mappedProductTier, mappedCreatorTier)` and `allowedOutputTier === effectiveTier`.

Selected named acceptance cases inside this block:

- `(canonical, stock)` → `effectiveTier = 1`, `allowedOutputTier = 1`. (Asymmetry is the failure mode the spec exists to prevent.)
- `(url_imported, soul_id)` → `effectiveTier = 1`.
- `(verified, anchored)` → `effectiveTier = 2`.
- `(canonical, soul_id)` → `effectiveTier = 3`.

### Part D — Full attach flow

Single happy-path test. Unresolved job, fakes return `{ id: "p1", qualityTier: "verified" }` and `{ id: "c1", qualityTier: "anchored" }`. Asserts:

- Returned context: `{ productIdentityId: "p1", creatorIdentityId: "c1", effectiveTier: 2, allowedOutputTier: 2, shotSpecVersion: "shot-spec@1.0.0" }`.
- `findOrCreateForJob` called exactly once with the job.
- `findOrCreateStockForDeployment` called exactly once with `job.deploymentId`.
- `attachIdentityRefs` called exactly once with `(job.id, returnedContext)`.
- `attachIdentityRefs` occurs only **after** both identity finders have resolved.
- Relative order between the two identity finders is **not** asserted.

### Part E — Constants & shape

1. `expect(PCD_SHOT_SPEC_VERSION).toBe("shot-spec@1.0.0")`. Locks the value SP4's snapshot writer will pin.
2. `ResolvedPcdContext` shape minimality: returned object has exactly the five keys, no extras.
3. Determinism: running the resolver twice with the same job and identical fake responses yields deep-equal contexts.

### Part F — Forbidden imports check

Read the source of `registry-resolver.ts` as text; assert via regex that it contains none of:

- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`
- `from "http"` / `from "https"`
- `./tier-policy.js` (Q1 lock — no policy call)
- `./registry-backfill.js` (no SP1 backfill dependency)

### Part G — Store-contract idempotency expectations (documentation tests)

1. Stale-version re-stamp does not duplicate identity rows. Fake `findOrCreateForJob` records a `createCount`; calling the resolver twice (second call with stale-version state) keeps `createCount === 1`.
2. `attachIdentityRefs` payload completeness. On the full path, the payload contains all five fields and `shotSpecVersion === PCD_SHOT_SPEC_VERSION`.

### What's NOT tested in SP3

- Concrete Prisma store behavior — out-of-tree (`apps/api`).
- Provider routing, snapshot writing — SP4.
- QC, approval, consent — SP5/SP6.
- SP2 policy logic — already tested in `tier-policy.test.ts`.
- Performance benchmarks — small async function over six fake calls; not warranted.

## Design questions resolved during brainstorming

| Q | Answer | Rationale |
|---|---|---|
| Q1: Does the resolver call `decidePcdGenerationAccess`? | No. Resolver is per-job context only. | `(shotType, outputIntent)` are per-shot/per-output and may not exist at job creation. Policy lives downstream in SP4/router. Honors the resolver-essay principle that resolvers route context, not absorb downstream decisions. No `evaluatePcdGenerationAccessForJob` helper either — it would create a second policy-shaped entry point and blur SP3/SP2 ownership. |
| Q2: `allowedOutputTier` semantics? | `allowedOutputTier = effectiveTier`. Mental model: identity-readiness tier, not policy-derived ceiling. | Avoids leaking SP2's current output-intent ladder into SP3. Future policy/output semantics may use Tier 3 directly; resolver should not bake today's policy shape into a stored field. |
| Q3: Where does `shotSpecVersion` come from? | Exported `const PCD_SHOT_SPEC_VERSION = "shot-spec@1.0.0"` from sibling `shot-spec-version.ts`. Resolver stamps it. | Mirrors SP2's `PCD_TIER_POLICY_VERSION` const-import contract. Single source of truth; SP4's snapshot writer will import directly. |
| Q4: Reuse SP1's finders? | Yes, by mirroring method names. SP3 declares its own `RegistryResolverStores` with augmented `{ id, qualityTier }` return shapes. SP1's `BackfillStores` is unchanged (still returns `{ id }`). Concrete implementations don't exist on the Prisma stores in this repo — they will land in `apps/api` at merge-back. | Same identity semantics as backfill, no second resolution path. SP1's "always Tier 1" assumption is correct for backfill; SP3 needs to read actual `qualityTier`. |
| Q5: Idempotency? | Strict five-field current-version guard. Already-resolved at current `PCD_SHOT_SPEC_VERSION` → no-op return. Otherwise full path. Stale `shotSpecVersion` is treated as unresolved. | Switchboard invariant #4: tools are idempotent. Strict version equality ensures stale jobs are re-stamped under the current spec rather than silently passing the guard. |

## Hard guardrails for implementation

- No DB.
- No I/O outside the injected stores.
- No policy call.
- No router behavior.
- No snapshot writer.
- No QC, approval, consent logic.
- No telemetry, logs, metrics.
- No `BackfillStores` import or refactor.
- No edits to `registry-backfill.ts`.
- No edits to `tier-policy.ts`.
- No edits to any file in `packages/db/`.
- No edits to `packages/db/prisma/schema.prisma`.
- No new Prisma migrations.
- No `evaluatePcdGenerationAccessForJob` helper.
- No expansion into shot planning, provider selection, identity adapters, or any SP4+ concern.
- Output: a small deterministic resolver module + a one-line version constant module + tests.

## Architectural context

This SP3 module sits at the **identity context resolver** position in the broader PCD orchestration:

```
PCD job submitted
  → PcdRegistryResolver        ◀── SP3 (this slice)
  → ShotSpecPlanner            (SP4; creates concrete shot/output)
  → PcdTierPolicy              (SP2; called downstream per shot/output)
  → ProviderRouter             (SP4)
  → execution → snapshot       (SP4)
  → QC                         (SP5)
  → Approval / export          (SP6)
```

The deliberate design choice: **the resolver has no opinion about how a generation runs.** It only answers "which `ProductIdentity` and `CreatorIdentity` are attached to this job, what is their identity-readiness floor, and what version of the shot-spec contract is this stamp under?" Every other concern — policy gating, provider selection, snapshot writing, QC, consent, approval — lives downstream and consumes the resolver's output.
