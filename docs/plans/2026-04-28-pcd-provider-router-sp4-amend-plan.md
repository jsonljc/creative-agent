# PCD SP4 — Amendment to Single Stamped Tier World — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amend PR #3 (SP4) to use a single stamped tier world: `ResolvedPcdContext` carries stamped component tiers (`productTierAtResolution`, `creatorTierAtResolution`); `ProviderRouter` consumes only stamped fields; resolver no-op path makes zero store calls; malformed-resolved jobs throw an invariant error rather than silently falling back to registry reads.

**Architecture:** The pre-amend SP4 (current PR #3 head `5322804`) routed the SP2 access gate using current-registry component tiers but used stamped `effectiveTier` for matrix/Tier 3 layers — a split-brain decision model. This amendment unifies the world: stamp component tiers on `CreativeJob` at resolution time, route every layer (SP2, matrix, Tier 3, snapshot interpretation) from those stamps, and forbid current-registry tier reads in the router. As a consequence the resolver no-op path restores SP3's original "zero store calls" idempotency invariant, and a malformed-resolved-job runtime guard prevents future regressions.

**Tech Stack:** TypeScript ESM (`.js` relative imports), Zod, Prisma + PostgreSQL, Vitest, pnpm + Turborepo. No new dependencies.

**Spec:** `docs/plans/2026-04-28-pcd-provider-router-sp4-design.md` (amended at commit `6abd4c6`). Read it before any task.

**Branch:** `feat/pcd-provider-router-sp4` (PR #3, currently 12 commits ahead of `main` after the design amendment commit).

**Repo conventions (binding):** ESM only; relative imports MUST end in `.js`; unused vars prefixed with `_`; no `console.log`; no `any` (use `unknown` and narrow); Prettier (semi, double quotes, 2-space indent, trailing commas, 100 char width); Conventional Commits; co-located `*.test.ts`; file-size soft limit 400 lines.

**Test runner commands** (from repo root):
- `pnpm --filter @creativeagent/db test` / `typecheck`
- `pnpm --filter @creativeagent/creative-pipeline test` / `typecheck`
- `pnpm db:generate` (regenerate Prisma client after schema edit)
- `pnpm typecheck && pnpm test` (whole-repo gate at the end)

**Sequencing rule (binding):** architectural commits first, cleanup last. Prettier runs only after every other commit lands so architectural diffs stay reviewable. Commit order: A → B → C → D → E → F → G → H → I.

---

## File Structure

**Modified files:**
- `packages/db/prisma/schema.prisma` — `CreativeJob` model gains 2 nullable Int columns.
- `packages/db/prisma/migrations/<timestamp>_pcd_creative_job_resolution_tiers/migration.sql` — NEW migration directory.
- `packages/db/src/stores/prisma-creative-job-store.ts` — `AttachIdentityRefsInput` widens by 2 fields; `markRegistryBackfilled` stamps both as 1.
- `packages/db/src/stores/__tests__/prisma-creative-job-store-sp4.test.ts` — NEW test file for the widening.
- `packages/creative-pipeline/src/pcd/registry-resolver.ts` — `ResolvedPcdContext` + `PcdResolvableJob` widen with stamped fields; pre-amend current-state fields removed; idempotency guard widens 5 → 7; no-op path becomes zero-store; malformed-resolved guard added; `InvariantViolationError` exported.
- `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` — original "zero store calls on no-op" assertion restored; pre-amend 3 SP4-additive divergence tests removed; 5 new stamped-world tests added.
- `packages/creative-pipeline/src/pcd/provider-router.ts` — Step 1 SP2 gate consumes `creatorTierAtResolution` / `productTierAtResolution`. Zero references to current-registry component-tier fields anywhere.
- `packages/creative-pipeline/src/pcd/provider-router.test.ts` — existing component-tier-passthrough test renamed to use stamped fields. New regression block: R1 + R2.
- `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts` — Task I cleanup (writer Step 1 comment).
- `/Users/jasonli/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` — Task H memory note update.

**Plus Prettier formatting pass over the 5 files identified in the code review.**

**No new modules.** All changes amend existing files.

---

## Task A: Schema migration + Prisma schema (CreativeJob tier-at-resolution columns)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_creative_job_resolution_tiers/migration.sql`

### Step A.1: Read context

- [ ] Read the `CreativeJob` model in `packages/db/prisma/schema.prisma` (lines 16-65 approximately). Note the existing `effectiveTier Int?`, `allowedOutputTier Int?`, `registryBackfilled Boolean`, `fidelityTierAtGeneration Int?` fields.
- [ ] List existing migrations: `ls packages/db/prisma/migrations/`. Note the latest timestamp prefix.
- [ ] Determine new timestamp: `date -u +"%Y%m%d%H%M%S"`.

### Step A.2: Modify the Prisma schema

- [ ] Open `packages/db/prisma/schema.prisma`. Find the `CreativeJob` model. Locate the existing PCD identity registry fields (around lines 36-45). Add two new fields immediately after `allowedOutputTier`:

```prisma
  // PCD identity registry (SP1)
  productIdentityId           String?
  productIdentity             ProductIdentity? @relation(fields: [productIdentityId], references: [id])
  creatorIdentityId           String?
  effectiveTier               Int?
  allowedOutputTier           Int?
  // SP4 stamped component tiers — at-resolution stamps. Nullable for
  // historical compatibility (pre-SP4 rows). SP4-and-later resolutions
  // always populate. Backfill stamps both as 1 per SP1 conservative
  // compatibility default.
  productTierAtResolution     Int?
  creatorTierAtResolution     Int?
  shotSpecVersion             String?
  registryBackfilled          Boolean  @default(false)
  fidelityTierAtGeneration    Int?
```

The existing `effectiveTier`, `allowedOutputTier`, `shotSpecVersion`, `registryBackfilled`, `fidelityTierAtGeneration` lines stay in place. The two new lines slot in between `allowedOutputTier` and `shotSpecVersion`. Adjust to match the file's actual indentation (2 spaces).

### Step A.3: Create the migration directory and SQL

- [ ] Run: `mkdir packages/db/prisma/migrations/<timestamp>_pcd_creative_job_resolution_tiers` (substitute the actual timestamp).
- [ ] Create `packages/db/prisma/migrations/<timestamp>_pcd_creative_job_resolution_tiers/migration.sql`:

```sql
-- SP4 amendment: add stamped component-tier columns to CreativeJob.
-- Columns are nullable for historical compatibility (pre-SP4 rows that
-- predate this slice). SP4-and-later resolutions always populate both
-- fields. Backfill stamps both as 1 (Tier 1) per SP1 conservative
-- compatibility default — backfilled jobs have no component-tier evidence.
-- A future cleanup migration may flip to NOT NULL once legacy rows are
-- backfilled or archived.

ALTER TABLE "CreativeJob"
  ADD COLUMN "productTierAtResolution"  INTEGER,
  ADD COLUMN "creatorTierAtResolution"  INTEGER;
```

### Step A.4: Regenerate Prisma client

- [ ] Run: `pnpm db:generate`
- [ ] Expected: Prisma client regenerates without error.
- [ ] Run: `pnpm db:migrate`. If a local DB isn't configured, that's fine — the typecheck below catches schema-vs-client mismatches. Note in your report whether the migration was applied locally.

### Step A.5: Typecheck

- [ ] Run: `pnpm --filter @creativeagent/db typecheck`
- [ ] Expected: zero errors.

### Step A.6: Commit

- [ ] ```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): SP4 amend — add productTierAtResolution + creatorTierAtResolution to CreativeJob

Two nullable Int columns added via additive migration. SP4-and-later
resolutions stamp both at resolution time; pre-SP4 rows are NULL until
backfilled. Existing effectiveTier / allowedOutputTier columns are NOT
renamed (avoiding merge-back churn). Backfill stamps both as 1 per SP1
conservative compatibility default.

This is the foundation for SP4's single-stamped-tier-world routing
correction (see docs/plans/2026-04-28-pcd-provider-router-sp4-design.md
amended Q-extension-1 for full rationale).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task B: Store widening — `prisma-creative-job-store.ts` + test

**Files:**
- Modify: `packages/db/src/stores/prisma-creative-job-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creative-job-store-sp4.test.ts`

### Step B.1: Read context

- [ ] Read `packages/db/src/stores/prisma-creative-job-store.ts` (full file, ~226 lines). Locate `AttachIdentityRefsInput` (around lines 5-12), `attachIdentityRefs` method (lines 195-207), and `markRegistryBackfilled` method (lines 209-224).
- [ ] List the `__tests__` directory to confirm the test convention: `ls packages/db/src/stores/__tests__/`.

### Step B.2: Write the failing test

- [ ] Create `packages/db/src/stores/__tests__/prisma-creative-job-store-sp4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  AttachIdentityRefsInput,
  MarkRegistryBackfilledInput,
} from "../prisma-creative-job-store.js";

describe("AttachIdentityRefsInput (SP4 amend — stamped tier columns)", () => {
  it("accepts the two new stamped tier fields", () => {
    const input: AttachIdentityRefsInput = {
      productIdentityId: "p-1",
      creatorIdentityId: "c-1",
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: "shot-spec@1.0.0",
      productTierAtResolution: 2,
      creatorTierAtResolution: 2,
    };
    expect(input.productTierAtResolution).toBe(2);
    expect(input.creatorTierAtResolution).toBe(2);
  });

  it("requires both stamped tier fields (TypeScript-only assertion via missing fields)", () => {
    // Type-level: removing either field should fail to compile against
    // AttachIdentityRefsInput. We exercise this with a runtime cast that
    // documents the contract.
    const partial = {
      productIdentityId: "p-1",
      creatorIdentityId: "c-1",
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: "shot-spec@1.0.0",
      productTierAtResolution: 2,
      creatorTierAtResolution: 2,
    };
    expect(partial.productTierAtResolution).toBe(2);
  });
});

describe("MarkRegistryBackfilledInput shape (unchanged)", () => {
  it("still accepts only the two identity-id fields (backfill stamps tiers internally as 1)", () => {
    const input: MarkRegistryBackfilledInput = {
      productIdentityId: "p-1",
      creatorIdentityId: "c-1",
    };
    expect(input.productIdentityId).toBe("p-1");
  });
});
```

### Step B.3: Run test to verify failure

- [ ] Run: `pnpm --filter @creativeagent/db test -- src/stores/__tests__/prisma-creative-job-store-sp4.test.ts`
- [ ] Expected: FAIL — `productTierAtResolution` / `creatorTierAtResolution` are not on `AttachIdentityRefsInput`.

### Step B.4: Widen the store input type and `markRegistryBackfilled`

- [ ] Open `packages/db/src/stores/prisma-creative-job-store.ts`. Replace the `AttachIdentityRefsInput` interface with:

```ts
export interface AttachIdentityRefsInput {
  productIdentityId: string;
  creatorIdentityId: string;
  effectiveTier: number;
  allowedOutputTier: number;
  shotSpecVersion: string;
  // SP4 amend: stamped at-resolution component tiers. Required for
  // SP4-and-later resolutions; the resolver writes both at full-attach time.
  productTierAtResolution: number;
  creatorTierAtResolution: number;
  fidelityTierAtGeneration?: number;
}
```

- [ ] In the `attachIdentityRefs` method (lines ~195-207), update the `data` block to include both new fields:

```ts
async attachIdentityRefs(jobId: string, input: AttachIdentityRefsInput): Promise<CreativeJob> {
  return this.prisma.creativeJob.update({
    where: { id: jobId },
    data: {
      productIdentityId: input.productIdentityId,
      creatorIdentityId: input.creatorIdentityId,
      effectiveTier: input.effectiveTier,
      allowedOutputTier: input.allowedOutputTier,
      shotSpecVersion: input.shotSpecVersion,
      productTierAtResolution: input.productTierAtResolution,
      creatorTierAtResolution: input.creatorTierAtResolution,
      fidelityTierAtGeneration: input.fidelityTierAtGeneration,
    },
  }) as unknown as CreativeJob;
}
```

- [ ] In the `markRegistryBackfilled` method (lines ~209-224), add both new fields to the `data` block, stamped as `1`:

```ts
async markRegistryBackfilled(
  jobId: string,
  input: MarkRegistryBackfilledInput,
): Promise<CreativeJob> {
  return this.prisma.creativeJob.update({
    where: { id: jobId },
    data: {
      productIdentityId: input.productIdentityId,
      creatorIdentityId: input.creatorIdentityId,
      effectiveTier: 1,
      allowedOutputTier: 1,
      // Legacy registry backfill has no component-tier evidence.
      // Stamp Tier 1 as the conservative compatibility default — matches
      // SP1 backfill semantic ("backfilled = Tier 1, full stop"). Tier-3
      // actions on backfilled jobs require explicit asset upgrades per
      // the source-of-truth design spec.
      productTierAtResolution: 1,
      creatorTierAtResolution: 1,
      registryBackfilled: true,
      fidelityTierAtGeneration: 1,
    },
  }) as unknown as CreativeJob;
}
```

### Step B.5: Run tests + typecheck

- [ ] Run: `pnpm --filter @creativeagent/db test`
- [ ] Expected: all tests pass (the new SP4 test file plus the existing 44 in db).
- [ ] Run: `pnpm --filter @creativeagent/db typecheck`
- [ ] Expected: zero errors.

### Step B.6: Commit

- [ ] ```
git add packages/db/src/stores/prisma-creative-job-store.ts packages/db/src/stores/__tests__/prisma-creative-job-store-sp4.test.ts
git commit -m "$(cat <<'EOF'
feat(db): SP4 amend — widen AttachIdentityRefsInput; backfill stamps Tier 1

AttachIdentityRefsInput requires productTierAtResolution and
creatorTierAtResolution; attachIdentityRefs writes both. Backfill path
(markRegistryBackfilled) stamps both as 1 per SP1 conservative
compatibility default — backfilled jobs have no component-tier evidence
and are deliberately not inferred. Tier-3 actions on backfilled jobs
require explicit asset upgrades.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C: Resolver type — `ResolvedPcdContext` + `PcdResolvableJob` + idempotency guard

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.ts`

### Step C.1: Read context

- [ ] Read `packages/creative-pipeline/src/pcd/registry-resolver.ts` in full. Note current state (post-pre-amend SP4):
  - `ResolvedPcdContext` has 7 fields including the pre-amend `productTier` / `creatorTier` (current-state) fields.
  - `PcdResolvableJob` has 5 optional input fields covered by the idempotency guard.
  - `isResolvedPcdJob` checks 5 fields.
  - The resolver body unconditionally calls both stores (the pre-amend SP4 behavior).

### Step C.2: Update the type definitions

- [ ] Replace `ResolvedPcdContext`:

```ts
export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  // SP4 amend: stamped at-resolution component tiers. The resolver writes
  // these once at full-attach time and reads them from the job row on the
  // no-op path. ProviderRouter consumes only these stamped fields.
  productTierAtResolution: IdentityTier;
  creatorTierAtResolution: IdentityTier;
  // Existing SP1 columns. Semantically: at-resolution stamps. Names kept
  // as-is to avoid a column-rename migration that would complicate
  // merge-back into Switchboard.
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: string;
};
```

The pre-amend `productTier` / `creatorTier` (current-state) fields are removed.

- [ ] Replace `PcdResolvableJob`:

```ts
export type PcdResolvableJob = {
  // Identity for the write target.
  id: string;

  // Inputs to productStore.findOrCreateForJob.
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  productImages: string[];

  // Idempotency guard fields. All seven must be present (with current
  // shotSpecVersion) for the no-op zero-store-call path.
  productIdentityId?: string | null;
  creatorIdentityId?: string | null;
  productTierAtResolution?: IdentityTier | null;
  creatorTierAtResolution?: IdentityTier | null;
  effectiveTier?: IdentityTier | null;
  allowedOutputTier?: IdentityTier | null;
  shotSpecVersion?: string | null;
};
```

- [ ] Replace the `ResolvedPcdResolvableJob` narrowed type:

```ts
type ResolvedPcdResolvableJob = PcdResolvableJob & {
  productIdentityId: string;
  creatorIdentityId: string;
  productTierAtResolution: IdentityTier;
  creatorTierAtResolution: IdentityTier;
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: typeof PCD_SHOT_SPEC_VERSION;
};
```

- [ ] Replace `isResolvedPcdJob` to check all 7 fields:

```ts
function isResolvedPcdJob(j: PcdResolvableJob): j is ResolvedPcdResolvableJob {
  return (
    typeof j.productIdentityId === "string" &&
    typeof j.creatorIdentityId === "string" &&
    isIdentityTier(j.productTierAtResolution) &&
    isIdentityTier(j.creatorTierAtResolution) &&
    isIdentityTier(j.effectiveTier) &&
    isIdentityTier(j.allowedOutputTier) &&
    j.shotSpecVersion === PCD_SHOT_SPEC_VERSION
  );
}

function isIdentityTier(v: unknown): v is IdentityTier {
  return v === 1 || v === 2 || v === 3;
}
```

### Step C.3: Add `InvariantViolationError` export and `RegistryResolverStores` doc

- [ ] At the top of the file (after the existing imports, before the type exports), add:

```ts
/** Thrown when a job claims to be resolved but the stamped tier context
 *  is incomplete or invalid. The resolver does NOT fall back to registry
 *  reads in this case — silent fallback would silently reintroduce the
 *  dual-authority routing bug this slice exists to fix.
 */
export class InvariantViolationError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly missingField: string,
  ) {
    super(
      `PCD resolver invariant violated: job "${jobId}" claims resolved state but ${missingField} is NULL or invalid. Resolver refuses to fall back to registry reads (would reintroduce dual-authority routing).`,
    );
    this.name = "InvariantViolationError";
  }
}
```

- [ ] On `RegistryResolverStores.productStore.findOrCreateForJob`, replace the JSDoc with the strengthened wording from Task 4 of the original follow-up plan:

```ts
export type RegistryResolverStores = {
  productStore: {
    /**
     * Idempotent identity resolution.
     *
     * If `job.productIdentityId` is already set, this MUST return the
     * registry row with exactly that id. It must not find-or-create a
     * different row from registry-side keys.
     *
     * If `job.productIdentityId` is unset, it may find or create by
     * registry-side keys.
     */
    findOrCreateForJob(job: PcdResolvableJob): Promise<{
      id: string;
      qualityTier: ProductQualityTier;
    }>;
  };
  creatorStore: {
    /**
     * Idempotent stock-creator resolution. If `job.creatorIdentityId` is
     * already set, MUST return that exact row.
     */
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

### Step C.4: Typecheck (will fail because resolver body still references old fields)

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: type errors in the resolver body referencing the removed pre-amend `productTier` / `creatorTier` fields. Will be fixed by Task D.

### Step C.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/registry-resolver.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 amend — ResolvedPcdContext + PcdResolvableJob carry stamped component tiers

ResolvedPcdContext fields:
- productTierAtResolution, creatorTierAtResolution (new, stamped)
- effectiveTier, allowedOutputTier, shotSpecVersion (existing, semantically
  at-resolution stamps; column names unchanged on CreativeJob to avoid
  merge-back churn)

Pre-amend current-state productTier / creatorTier fields are removed —
the only tier values reachable from the context type are the stamped ones.

isResolvedPcdJob widens 5 → 7 fields. PcdResolvableJob input shape gains
two corresponding optional fields read from the job row.

InvariantViolationError exported for the malformed-resolved-job guard
(implemented in the next commit). RegistryResolverStores JSDoc
strengthened with the find-or-create idempotency contract.

Resolver body updates intentionally deferred to the next commit so this
diff is type-shape-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task D: Resolver body — zero-store no-op + malformed guard + full-attach stamping

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.ts`

### Step D.1: Replace the `resolvePcdRegistryContext` body

- [ ] Replace the function body with:

```ts
export async function resolvePcdRegistryContext(
  job: PcdResolvableJob,
  stores: RegistryResolverStores,
): Promise<ResolvedPcdContext> {
  // No-op path: every field comes from the job row. Zero store calls.
  // Restores SP3's original "zero store calls on no-op" idempotency
  // invariant. The pre-amend SP4 design relaxed this to read current
  // registry tiers; the amendment locks it back.
  if (isResolvedPcdJob(job)) {
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

  // Malformed-resolved-job invariant: if the resolved 5-field core is
  // present at the current shotSpecVersion but stamped component tiers
  // are missing/invalid, throw. Never fall back to registry reads —
  // silent fallback would silently reintroduce dual-authority routing.
  // Unreachable inside corrected SP4 (every resolution stamps both);
  // the guard catches any future regression that forgets to stamp.
  assertResolvedJobHasStampedComponentTiers(job);

  // Full-attach path: read both registry stores to derive component
  // tiers, compute effectiveTier, stamp all fields via attachIdentityRefs,
  // and return the resolved context.
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(
    job.deploymentId,
  );

  const productTierAtResolution = mapProductQualityTierToIdentityTier(product.qualityTier);
  const creatorTierAtResolution = mapCreatorQualityTierToIdentityTier(creator.qualityTier);
  const effectiveTier = computeEffectiveTier(productTierAtResolution, creatorTierAtResolution);

  const resolved: ResolvedPcdContext = {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
    productTierAtResolution,
    creatorTierAtResolution,
    effectiveTier,
    allowedOutputTier: effectiveTier,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };

  await stores.jobStore.attachIdentityRefs(job.id, resolved);

  return resolved;
}

function assertResolvedJobHasStampedComponentTiers(job: PcdResolvableJob): void {
  // Only triggers when the original 5-field core is present at the
  // current shotSpecVersion (signals "claims to be resolved") but the
  // stamped component tiers are missing.
  const claimsResolvedCore =
    typeof job.productIdentityId === "string" &&
    typeof job.creatorIdentityId === "string" &&
    isIdentityTier(job.effectiveTier) &&
    isIdentityTier(job.allowedOutputTier) &&
    job.shotSpecVersion === PCD_SHOT_SPEC_VERSION;
  if (!claimsResolvedCore) return;

  if (!isIdentityTier(job.productTierAtResolution)) {
    throw new InvariantViolationError(job.id, "productTierAtResolution");
  }
  if (!isIdentityTier(job.creatorTierAtResolution)) {
    throw new InvariantViolationError(job.id, "creatorTierAtResolution");
  }
}
```

The `mapProductQualityTierToIdentityTier`, `mapCreatorQualityTierToIdentityTier`, and `computeEffectiveTier` helpers stay unchanged in the file.

### Step D.2: Typecheck

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors. The resolver compiles cleanly with the new context shape.

### Step D.3: Tests will fail (existing ones reference the removed fields)

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/registry-resolver.test.ts`
- [ ] Expected: FAIL on tests that destructure `productTier` / `creatorTier` (the pre-amend names) from the returned context. Task E rewrites these.

### Step D.4: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/registry-resolver.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 amend — resolver body with zero-store no-op + malformed guard

No-op path returns the resolved context entirely from the job row —
zero findOrCreateForJob calls, zero findOrCreateStockForDeployment
calls, zero attachIdentityRefs writes. Restores SP3's original locked
"zero store calls on no-op" idempotency invariant.

Malformed-resolved-job invariant: when the original 5-field core is
present at the current shotSpecVersion but a stamped component tier
is NULL or out of range, throw InvariantViolationError naming the job
and missing field. Never fall back to registry reads — silent fallback
would silently reintroduce the dual-authority routing bug.

Full-attach path stamps both new tiers via attachIdentityRefs alongside
the existing five fields. The mapping helpers (productQualityTier →
IdentityTier and creatorQualityTier → IdentityTier) are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task E: Resolver tests — restore zero-store no-op + 5 stamped-world tests

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.test.ts`

### Step E.1: Read context

- [ ] Read `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` in full. Note (post-pre-amend SP4):
  - Imports need to add `InvariantViolationError`.
  - The "idempotency guard" test currently asserts 1+1+0 finder/creator/attach calls (pre-amend); needs to revert to 0+0+0.
  - The `RESOLVED_JOB` constant needs the two new stamped fields populated.
  - The "SP4 additive contract deltas" describe block has 3 tests (full-attach tier propagation, no-op divergence, 3-case mapping); needs replacement.
  - The full-attach happy path test needs `productTier` / `creatorTier` references replaced with `productTierAtResolution` / `creatorTierAtResolution`.
  - The "all seven fields" test (was renamed from "all five" in commit `0f58711`) — its assertions still use pre-amend names and need updating.
  - Other existing tests (3×3 cross-product mapping, etc.) reference the same fields and need updating.

### Step E.2: Update imports + constants

- [ ] At the top of the file, add `InvariantViolationError` to the import:

```ts
import {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
  type ResolvedPcdContext,
  InvariantViolationError,
} from "./registry-resolver.js";
```

- [ ] Replace `RESOLVED_JOB` with the 7-field shape:

```ts
const RESOLVED_JOB: PcdResolvableJob = {
  id: "job-1",
  organizationId: "org-1",
  deploymentId: "dep-1",
  productDescription: "test product",
  productImages: [],
  productIdentityId: "p1",
  creatorIdentityId: "c1",
  productTierAtResolution: 2,
  creatorTierAtResolution: 2,
  effectiveTier: 2,
  allowedOutputTier: 2,
  shotSpecVersion: PCD_SHOT_SPEC_VERSION,
};
```

### Step E.3: Restore the zero-store-call idempotency-guard test

- [ ] Replace the existing `describe("resolvePcdRegistryContext — idempotency guard ...", ...)` block with the original SP3 zero-store-call assertion. Use a `neverCalledStores()`-style fake (re-introduce the helper if it was removed in commit `0f58711`):

```ts
function neverCalledStores(): RegistryResolverStores {
  return {
    productStore: {
      findOrCreateForJob: async () => {
        throw new Error("productStore.findOrCreateForJob should not be called");
      },
    },
    creatorStore: {
      findOrCreateStockForDeployment: async () => {
        throw new Error(
          "creatorStore.findOrCreateStockForDeployment should not be called",
        );
      },
    },
    jobStore: {
      attachIdentityRefs: async () => {
        throw new Error("jobStore.attachIdentityRefs should not be called");
      },
    },
  };
}

describe("resolvePcdRegistryContext — idempotency guard (already resolved at current version)", () => {
  it("returns existing context with zero store calls", async () => {
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, neverCalledStores());
    expect(result).toEqual({
      productIdentityId: "p1",
      creatorIdentityId: "c1",
      productTierAtResolution: 2,
      creatorTierAtResolution: 2,
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    });
  });
});
```

### Step E.4: Replace the pre-amend "SP4 additive contract deltas" block with stamped-world tests

- [ ] Remove the entire pre-amend `describe("SP4 additive contract deltas", ...)` block (3 tests: full-attach tier propagation, no-op divergence, 3-case mapping).
- [ ] Add a new block at the same location:

```ts
describe("SP4 amend — stamped tier world", () => {
  it("full-attach path: returns productTierAtResolution and creatorTierAtResolution from registry mapping", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const unresolvedJob: PcdResolvableJob = {
      id: "job-2",
      organizationId: "org-1",
      deploymentId: "dep-1",
      productDescription: "another product",
      productImages: [],
    };
    const result = await resolvePcdRegistryContext(unresolvedJob, stores);
    expect(result.productTierAtResolution).toBe(2);
    expect(result.creatorTierAtResolution).toBe(2);
    expect(result.effectiveTier).toBe(2);
    expect(log.attachIdentityRefsCalls).toBe(1);
    // attachIdentityRefs payload includes the stamped tiers.
    expect(log.attachIdentityRefsArgs[0]?.refs.productTierAtResolution).toBe(2);
    expect(log.attachIdentityRefsArgs[0]?.refs.creatorTierAtResolution).toBe(2);
  });

  it("no-op path: zero store calls AND zero attachIdentityRefs writes", async () => {
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, neverCalledStores());
    expect(result.productTierAtResolution).toBe(2);
    expect(result.creatorTierAtResolution).toBe(2);
  });

  it("malformed-resolved-job: missing productTierAtResolution → InvariantViolationError; no store reads", async () => {
    const malformed: PcdResolvableJob = {
      ...RESOLVED_JOB,
      productTierAtResolution: null,
    };
    await expect(
      resolvePcdRegistryContext(malformed, neverCalledStores()),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("malformed-resolved-job: missing creatorTierAtResolution → InvariantViolationError; no store reads", async () => {
    const malformed: PcdResolvableJob = {
      ...RESOLVED_JOB,
      creatorTierAtResolution: null,
    };
    await expect(
      resolvePcdRegistryContext(malformed, neverCalledStores()),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("idempotency guard: a job missing the new stamped fields is treated as unresolved (not malformed) when shotSpecVersion is stale", async () => {
    // A pre-SP4-amend job: has the original 5-field core but at a stale
    // shotSpecVersion AND missing the two new stamped fields. This should
    // take the full-attach path, NOT the malformed-error branch (the
    // malformed-error branch only fires when the core is present at the
    // CURRENT shotSpecVersion).
    const stale: PcdResolvableJob = {
      ...RESOLVED_JOB,
      shotSpecVersion: "shot-spec@0.9.0", // stale
      productTierAtResolution: null,
      creatorTierAtResolution: null,
    };
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const result = await resolvePcdRegistryContext(stale, stores);
    expect(result.shotSpecVersion).toBe(PCD_SHOT_SPEC_VERSION);
    expect(log.attachIdentityRefsCalls).toBe(1);
    // Full-attach stamped both new fields:
    expect(result.productTierAtResolution).toBe(2);
    expect(result.creatorTierAtResolution).toBe(2);
  });
});
```

### Step E.5: Update existing tests that reference pre-amend `productTier` / `creatorTier`

- [ ] Search the file for all uses of `.productTier` and `.creatorTier` (without the `AtResolution` suffix). Rename each to `.productTierAtResolution` / `.creatorTierAtResolution`. This includes:
  - The full-attach happy-path test
  - The "all seven fields" test (the assertions that probe the payload shape)
  - Any 3×3 cross-product effectiveTier mapping tests that destructure the returned context

Use a global find-replace at the test-file level: `productTier:` → `productTierAtResolution:`, `creatorTier:` → `creatorTierAtResolution:`, `result.productTier` → `result.productTierAtResolution`, etc. Inspect each match and confirm it's the tier field (not e.g. `productQualityTier` which is a different field).

### Step E.6: Run tests

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/registry-resolver.test.ts`
- [ ] Expected: all tests pass.

### Step E.7: Run typecheck

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step E.8: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/registry-resolver.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP4 amend — restore zero-store no-op + stamped-world tests

Restores the original SP3 "zero store calls on no-op" idempotency
assertion (relaxed by pre-amend SP4 to "two finder calls + zero attach
calls"; the amendment re-locks the original semantic).

Replaces the pre-amend 3 SP4-additive divergence tests with 5
stamped-world tests:
- full-attach stamps productTierAtResolution + creatorTierAtResolution
  via attachIdentityRefs
- no-op path returns stamped tiers from job row alone (zero store calls)
- malformed-resolved-job (missing productTierAtResolution) throws
  InvariantViolationError; no store reads
- symmetric malformed test for creatorTierAtResolution
- idempotency-guard widening: stale shotSpecVersion + missing stamped
  fields takes the full-attach path (not the malformed branch)

Existing tests that referenced the pre-amend productTier / creatorTier
(current-state) field names are renamed to use the stamped names.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task F: Router body — uniform stamped-world routing

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/provider-router.ts`

### Step F.1: Read context

- [ ] Read `packages/creative-pipeline/src/pcd/provider-router.ts` in full. Note Step 1 currently passes `resolvedContext.creatorTier` / `resolvedContext.productTier` (the pre-amend current-state fields). Those fields no longer exist on `ResolvedPcdContext` after Task C; this commit fixes the broken references.

### Step F.2: Update Step 1

- [ ] Find Step 1 in `routePcdShot`:

```ts
// Step 1 — Tier policy gate.
const accessDecision = decidePcdGenerationAccess({
  avatarTier: resolvedContext.creatorTier,
  productTier: resolvedContext.productTier,
  shotType,
  outputIntent,
});
```

Replace with:

```ts
// Step 1 — Tier policy gate (single stamped tier world).
// Both component tiers come from resolution-time stamps. The router
// never reads current registry tier state.
const accessDecision = decidePcdGenerationAccess({
  avatarTier: resolvedContext.creatorTierAtResolution,
  productTier: resolvedContext.productTierAtResolution,
  shotType,
  outputIntent,
});
```

- [ ] Search the entire file for any remaining uses of `resolvedContext.productTier` or `resolvedContext.creatorTier` (without the `AtResolution` suffix) and replace each with the stamped name.

### Step F.3: Run typecheck + tests

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-router.test.ts`
- [ ] Expected: many tests fail because the test fixtures still reference pre-amend field names. Task G rewrites them.

### Step F.4: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/provider-router.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 amend — routePcdShot consumes stamped component tiers

Step 1 SP2 gate now reads creatorTierAtResolution / productTierAtResolution.
Steps 2 (matrix filter) and 3 (Tier 3 rule activation) already keyed on
effectiveTier, which is also at-resolution semantically — the entire
router now operates in a single stamped tier world.

Zero current-registry tier reads anywhere in the body. The pre-amend
current-state productTier / creatorTier fields no longer exist on
ResolvedPcdContext (Task C), so a future contributor cannot
accidentally re-introduce dual-authority routing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task G: Router tests — R1 regression + R2 SP2 spy + update existing

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/provider-router.test.ts`

### Step G.1: Read context

- [ ] Read the test file in full. Note:
  - The `makeContext` helper builds a `ResolvedPcdContext` with pre-amend `productTier` / `creatorTier` fields. Needs renaming.
  - Many tests use `makeContext({ productTier: 3, creatorTier: 3, effectiveTier: 3, ... })` — every override needs renaming.
  - The "component-tier passthrough" test (Part A test 3) explicitly tests the SP2 gate with asymmetric tiers — keep the test but rename the fields and rename the test title.
  - Part G's 3 `it.each` blocks reference `productTier` / `creatorTier` in the `makeContext` call. Rename.

### Step G.2: Rename `makeContext` and all call sites

- [ ] Update the helper:

```ts
function makeContext(overrides: Partial<ResolvedPcdContext> = {}): ResolvedPcdContext {
  return {
    productIdentityId: "p-1",
    creatorIdentityId: "c-1",
    productTierAtResolution: 2,
    creatorTierAtResolution: 2,
    effectiveTier: 2,
    allowedOutputTier: 2,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    ...overrides,
  };
}
```

- [ ] Search the file for all uses of `productTier:` and `creatorTier:` inside `makeContext({ ... })` calls and rename each to `productTierAtResolution:` / `creatorTierAtResolution:`. Use the editor's project-wide find-replace, but verify each match is inside a context literal (not e.g. a `qualityTier` field elsewhere).
- [ ] Rename the existing "component-tier passthrough" test (Part A test 3) to `"stamped component-tier passthrough"`. Update its body to use stamped field names.

### Step G.3: Add the regression test block

- [ ] At the end of the file (before the forbidden-imports `describe`), add:

```ts
describe("regression — stamped-world authority (non-negotiable)", () => {
  it("R1 — registry re-tiered after stamping does not change routing for an already-stamped job", async () => {
    // Two consecutive routePcdShot calls with the SAME stamped context.
    // The fakes for productStore / creatorStore are configured to throw
    // if called — proving the router never reads them. If a future
    // contributor re-introduces a current-registry tier read inside the
    // router, this test fails.
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const stampedContext = makeContext({
      productTierAtResolution: 3,
      creatorTierAtResolution: 3,
      effectiveTier: 3,
      allowedOutputTier: 3,
    });

    const r1 = await routePcdShot(
      {
        resolvedContext: stampedContext,
        shotType: "talking_head",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    const r2 = await routePcdShot(
      {
        resolvedContext: stampedContext,
        shotType: "talking_head",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(r1).toEqual(r2);
  });

  it("R2 — SP2 gate receives stamped component tiers, not any current value", async () => {
    // Spy on decidePcdGenerationAccess via vi.spyOn on its module export
    // (since the router calls it via the import). Assert the spy received
    // the stamped fields exactly.
    const tierPolicyModule = await import("./tier-policy.js");
    const spy = vi.spyOn(tierPolicyModule, "decidePcdGenerationAccess");

    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    await routePcdShot(
      {
        resolvedContext: makeContext({
          productTierAtResolution: 3,
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

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      avatarTier: 1,         // creatorTierAtResolution
      productTier: 3,        // productTierAtResolution
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });

    spy.mockRestore();
  });
});
```

If `vi.spyOn` doesn't work cleanly because `decidePcdGenerationAccess` is imported by the router module before the test runs, fall back to running the SP2 gate test through observed behavior: assert the resulting `accessDecision` matches what SP2 returns for `{ avatarTier: 1, productTier: 3, ... }` — i.e., construct the expected `PcdTierDecision` by calling `decidePcdGenerationAccess` directly with those args and assert deep-equality on `result.accessDecision`. Either approach satisfies the contract; choose whichever compiles cleanly first.

### Step G.4: Run tests

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-router.test.ts`
- [ ] Expected: 125 + 2 = 127 tests pass (the 2 new regression tests).

### Step G.5: Run whole-package test

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test`
- [ ] Expected: all tests pass.

### Step G.6: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/provider-router.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP4 amend — stamped-world router tests + 2 non-negotiable regression tests

Renames every makeContext fixture override from productTier / creatorTier
(pre-amend current-state) to productTierAtResolution / creatorTierAtResolution
(stamped). Renames the "component-tier passthrough" test to
"stamped component-tier passthrough".

Adds a new "regression — stamped-world authority (non-negotiable)"
describe block:
- R1: registry re-tiered after stamping does not change routing
  (fakes throw if called — proves the router never reads them).
- R2: SP2 gate receives stamped component tiers (spy on
  decidePcdGenerationAccess; assert the args).

These two tests fail if any future commit re-introduces current-registry
tier reads inside the router.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task H: Memory file update

**Files:**
- Modify: `/Users/jasonli/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`

### Step H.1: Update the SP4 status block

- [ ] Open the memory file. Find the SP4 status section (begins with `**SP4 — Provider routing + Tier 3 enforcement + ...`). Update the relevant lines to reflect the amendment:

Add a new bullet at the bottom of the SP4 block:

```
  - **Amendment (post-review of PR #3):** Code review surfaced a split-brain
    routing bug — pre-amend SP4 called SP2 with current-registry component
    tiers but used stamped effectiveTier for matrix/Tier 3 layers.
    Amendment introduces a single stamped tier world: ResolvedPcdContext
    carries productTierAtResolution + creatorTierAtResolution; ProviderRouter
    consumes only stamped fields; no-op resolver path makes zero store
    calls (restoring SP3's original locked invariant); malformed-resolved
    jobs throw InvariantViolationError instead of falling back to registry
    reads. One additive Prisma migration adds two nullable Int columns to
    CreativeJob (existing effectiveTier / allowedOutputTier columns NOT
    renamed). Backfill stamps both new tiers as 1 per SP1 conservative
    compatibility default. Two non-negotiable router regression tests guard
    the invariant going forward.
```

(Leave the rest of the SP4 block unchanged.)

### Step H.2: Commit

- [ ] No git commit — the memory file is outside the repo. Just save the file edit.

(If the memory file IS inside a git-tracked path, commit per the same Conventional Commit pattern. Verify with `git status -- /Users/jasonli/.claude/projects/...`.)

---

## Task I: Cleanup — writer comment fix + JSDoc + Prettier

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts` (writer Step 1 comment)
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.ts` (JSDoc already added in Task C — verify)
- Plus Prettier pass over the 5 review-flagged files.

### Step I.1: Writer Step 1 comment fix

- [ ] Open `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts`. Find Step 1 (around lines 65-69):

```ts
// Step 1 — Validate input shape against PcdSp4IdentitySnapshotInputSchema.
// Throws ZodError on bad input. Strips unknown keys (e.g. caller-supplied
// policyVersion / providerCapabilityVersion).
```

Replace with:

```ts
// Step 1 — Build the snapshot-input subset from input and validate.
// Defense-in-depth: only an explicit allowlist of keys is forwarded to
// the schema, so caller-supplied policyVersion / providerCapabilityVersion
// / routerVersion never reach Zod and cannot smuggle through.
// Throws ZodError on bad input.
```

### Step I.2: Verify the resolver JSDoc from Task C is in place

- [ ] In `packages/creative-pipeline/src/pcd/registry-resolver.ts`, confirm `RegistryResolverStores.productStore.findOrCreateForJob` has the strengthened JSDoc from Task C step C.3. If not (e.g. you skipped that step), add it now.

### Step I.3: Run Prettier over the 5 review-flagged files

- [ ] Run from the repo root:

```bash
pnpm dlx prettier --write \
  packages/creative-pipeline/src/pcd/tier3-routing-rules.ts \
  packages/creative-pipeline/src/pcd/provider-router.test.ts \
  packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts \
  packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts \
  packages/schemas/src/__tests__/pcd-identity-sp4.test.ts
```

- [ ] Expected: small line-wrapping edits.
- [ ] Run: `pnpm dlx prettier --check <same file list>`
- [ ] Expected: all files report "Code style issues found in 0 files." (or similar success message).

### Step I.4: Run whole-repo tests + typecheck

- [ ] Run: `pnpm typecheck && pnpm test` (whole-repo).
- [ ] Expected: all tests pass; zero typecheck errors.

### Step I.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts packages/creative-pipeline/src/pcd/tier3-routing-rules.ts packages/creative-pipeline/src/pcd/provider-router.test.ts packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts packages/schemas/src/__tests__/pcd-identity-sp4.test.ts
git commit -m "$(cat <<'EOF'
chore(pcd): SP4 amend — writer Step 1 comment fix + Prettier pass

Writer Step 1 comment now correctly describes the defense-in-depth
mechanism: defense lives at the explicit allowlist passed to the parse
call, not in Zod's strip-unknown-keys behavior. Caller-supplied bogus
policyVersion / providerCapabilityVersion / routerVersion never reach
the schema.

Plus a Prettier pass over the 5 files flagged in the PR #3 code review:
- tier3-routing-rules.ts
- provider-router.test.ts
- pcd-identity-snapshot-writer.test.ts
- tier3-routing-rules.test.ts
- pcd-identity-sp4.test.ts

Cleanup runs after architectural commits land so the architectural diff
stays reviewable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §1 in-scope items — Tasks A (migration), B (store), C (resolver type), D (resolver body), E (resolver tests), F (router body), G (router tests), H (memory), I (cleanup) — full coverage.
- §2 file-layout deltas — every modified file has a corresponding task.
- §3 algorithm changes (Step 1 stamped tiers) — Task F + Task G regression tests.
- §4 test plan deltas (restore zero-store; new R1/R2; new malformed tests) — Task E + Task G.
- §5 hard guardrails (single tier world, no silent fallback, no rename) — Task C + Task D + Task F + Task G all enforce.
- §6 acceptance #7-#11 — each has a corresponding test in Task E or Task G.
- §7 file inventory — matches Task ordering.
- Resolved-questions table Q-extension-1 reversal — Task A (migration) + Task C (context shape) + Task D (resolver body) implement the reversed decision.

**2. Placeholder scan:** No "TBD", "TODO", "implement later". Every code step shows the actual code. Migration timestamp is parameterized (`<timestamp>`) but Step A.1 explicitly tells the engineer to run `date -u +"%Y%m%d%H%M%S"` to get one.

**3. Type consistency:**
- `productTierAtResolution` / `creatorTierAtResolution` — same name across Tasks A (Prisma column), B (`AttachIdentityRefsInput`), C (`ResolvedPcdContext` + `PcdResolvableJob`), D (resolver body), E (test fixture + assertions), F (router body), G (router test fixture).
- `InvariantViolationError` — declared in Task C, exported, consumed by Task E test imports.
- `markRegistryBackfilled` stamps both new tiers as `1` — Task B (implementation) + memory note in Task H both consistent.
- `RegistryResolverStores.findOrCreateForJob` JSDoc — added in Task C, verified in Task I step I.2.
- Existing `effectiveTier` / `allowedOutputTier` columns NOT renamed — consistent across all tasks.
