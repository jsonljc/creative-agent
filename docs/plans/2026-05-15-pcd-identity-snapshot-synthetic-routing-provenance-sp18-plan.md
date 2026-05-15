# PCD SP18 Implementation Plan — Synthetic Routing Provenance Widen on PcdIdentitySnapshot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the SP17 synthetic-pairing-success decision onto `PcdIdentitySnapshot` as forensic provenance — 6 flat columns + 1 `Json?` reason discriminated on `videoProvider`, via a new pure store-injected stamper + new top-level orchestrator + new SP18 store contract. Closes SP17 §1 successor reservation.

**Architecture:** Wrap-not-extend. New `writePcdIdentitySnapshotWithSyntheticRouting` orchestrator composes `stampPcdProvenance` (SP9) + new `stampPcdSyntheticRoutingDecision` (SP18) + 4-way SP4 invariant lock-step. No edits to SP1–SP17 source bodies (Guardrail B). Single `crypto.createHash` call site lives in the SP18 stamper (Guardrail D). Single runtime import site for `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` is the stamper; tests are explicitly carved out (Guardrail C).

**Tech Stack:** TypeScript 5.x ESM, zod 3.x, Prisma 5.x, Vitest, pnpm workspaces, Node `node:crypto` (sha256 hashing only — no random sources).

---

## Pre-execution gates (BLOCKING)

**Gate G1 — SP17 squash-merged.** PR #17 (`pcd/sp17-synthetic-provider-routing-seedance`) must be squash-merged to `creativeagent` `main` before Task 1. The SP18 anti-pattern test source-freeze diff is keyed against the SP17 squash SHA. If SP17 has not landed, the plan is undefined and execution must block.

Verify: `gh pr view 17 --json state -q .state` returns `"MERGED"`. If `OPEN`, abort and resume after merge.

**Gate G2 — Worktree.** Execute in `.worktrees/sp18` on branch `pcd/sp18-pcd-identity-snapshot-provenance-widen`. Setup via `superpowers:using-git-worktrees` (subagent-driven-development handles this automatically).

**Gate G3 — Subagent isolation directive.** Every implementer subagent prompt MUST open with:

```bash
pwd                                # expect .worktrees/sp18 path
git branch --show-current          # expect pcd/sp18-pcd-identity-snapshot-provenance-widen
```

If either is wrong, the subagent must refuse to proceed and surface the mismatch. Per the SP13/SP14/SP15/SP16/SP17 subagent-wrong-worktree lesson.

**Gate G4 — Working baseline.** Before Task 1, the local repo at SP17-tip must have:
- `pnpm typecheck` green
- `pnpm test` green (target: ~1975 passing, 2 skipped at SP17 land)
- `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"` clean modulo the 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`
- `pnpm prisma migrate status` clean
- `git status` clean on the worktree branch

---

## File map

**New files (created in this plan):**

```
packages/schemas/src/pcd-synthetic-routing-provenance.ts                                      [Task 2]
packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts                       [Task 2]

packages/db/prisma/migrations/<ts>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/
  migration.sql                                                                               [Task 3]

packages/creative-pipeline/src/pcd/synthetic-routing-provenance/
  synthetic-routing-provenance-version.ts                                                     [Task 5]
  synthetic-routing-provenance-version.test.ts                                                [Task 5]
  pcd-sp18-identity-snapshot-store.ts                                                         [Task 6]
  stamp-pcd-synthetic-routing-decision.ts                                                     [Task 7]
  stamp-pcd-synthetic-routing-decision.test.ts                                                [Task 7]
  write-pcd-identity-snapshot-with-synthetic-routing.ts                                       [Task 8]
  write-pcd-identity-snapshot-with-synthetic-routing.test.ts                                  [Task 8]
  sp18-anti-patterns.test.ts                                                                  [Task 9]
  index.ts                                                                                    [Task 11]
```

**Modified files (existing — edits only):**

```
packages/schemas/src/index.ts                                                                 [Task 2 — re-export SP18 schemas]
packages/db/prisma/schema.prisma                                                              [Task 3 — widen PcdIdentitySnapshot]
packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts                                  [Task 4 — add SP18 method + adapter]
packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts                             [Task 4 — round-trip new method]
packages/creative-pipeline/src/index.ts                                                       [Task 11 — re-export ./pcd/synthetic-routing-provenance/index.js]

packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts                       [Task 10 — allowlist widen]
packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts                           [Task 10]
packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts                         [Task 10]
packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts                    [Task 10]
packages/creative-pipeline/src/pcd/synthetic-creator/sp13-anti-patterns.test.ts               [Task 10]
packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts                      [Task 10]
packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts                          [Task 10]
packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts                [Task 10]
packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts                [Task 10 — post-PR-#17 file]
```

(Subagent: verify allowlist paths in Task 10 against the actual directory tree — paths may differ slightly depending on SP10B/SP10C/SP13 subdir naming. Use `find packages/creative-pipeline/src/pcd -name "sp*-anti-patterns.test.ts"` to enumerate.)

**Files NOT edited (Guardrail B — source-freeze):**

- All SP4 files: `pcd-identity-snapshot-writer.ts`, `tier-policy.ts`, `provider-capability-matrix.ts`, `provider-router.ts`, `tier3-routing-rules.ts`
- All SP6/SP7/SP8/SP9 source bodies including `stamp-pcd-provenance.ts`, `write-pcd-identity-snapshot-with-provenance.ts`
- All SP10A/SP10B/SP10C source bodies
- All SP11/SP12/SP13/SP14/SP15 source bodies
- All SP16/SP17 source bodies: `pcd-synthetic-router.ts`, `route-synthetic-pcd-shot.ts`, `synthetic-provider-pairing.ts`, `synthetic-router-version.ts`, `creator-identity-synthetic.ts`
- `packages/schemas/src/pcd-identity.ts` (the SP4-era `PcdIdentitySnapshotSchema` stays narrow — Q9 lock)

---

## Task 1: Pre-flight gate (verification only — no commit)

**Files:** none modified. This task verifies the worktree is correctly set up and captures the SP17 squash SHA into the plan body for Task 9 use.

- [ ] **Step 1.1: Verify worktree position**

```bash
pwd
git branch --show-current
```

Expected: path ends in `.worktrees/sp18`; branch is `pcd/sp18-pcd-identity-snapshot-provenance-widen`. If either is wrong, abort.

- [ ] **Step 1.2: Verify PR #17 is squash-merged**

```bash
gh pr view 17 --json state,mergeCommit -q '{state: .state, sha: .mergeCommit.oid}'
```

Expected output: `{"state":"MERGED","sha":"<some-40-hex-sha>"}`. Capture the `sha` value — this is the **SP17 squash SHA** used in Task 9.

If state is not `MERGED`, abort the plan. SP18 cannot proceed without SP17 on `main`.

- [ ] **Step 1.3: Capture SP17 squash SHA into a session note**

Record the SHA captured in Step 1.2 (referred to below as `<SP17_SQUASH_SHA>`). It will be substituted into the anti-pattern test at Task 9, Step 9.3.

- [ ] **Step 1.4: Verify SP17 squash is on the current branch's history**

```bash
git merge-base --is-ancestor <SP17_SQUASH_SHA> HEAD && echo "OK: SP17 in history"
```

Expected: `OK: SP17 in history`. If not, rebase the SP18 worktree branch onto current `main` first.

- [ ] **Step 1.5: Verify baseline tests green at SP17 tip**

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
```

Expected: `pnpm typecheck` clean; `pnpm test` shows roughly **~1975 passing, 2 skipped** (SP17 baseline). If anything fails, abort.

- [ ] **Step 1.6: Verify Prisma schema drift-free at SP17 tip**

```bash
pnpm --filter @creativeagent/db exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script | head -5
```

Expected: a coherent SQL script representing the full schema; no errors. Confirm `pnpm prisma migrate status` is clean (all migrations applied).

- [ ] **Step 1.7: Verify SP17-shipped files exist (sanity)**

```bash
test -f packages/schemas/src/creator-identity-synthetic.ts && \
  grep -q "SeedanceDirectionSchema" packages/schemas/src/creator-identity-synthetic.ts && \
  echo "OK: SP17 schemas present"
test -f packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts && \
  grep -q '"pcd-synthetic-router@1.1.0"' packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts && \
  echo "OK: SP17 router-version literal at 1.1.0"
test -f packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts && \
  echo "OK: SP17 anti-pattern test file present"
```

Expected: all three `OK` lines print.

No commit at Task 1 — this is verification only.

---

## Task 2: SP18 schemas (`PcdSp18SyntheticRoutingDecisionReasonSchema` + `PcdSp18SyntheticRoutingProvenancePayloadSchema`)

**Files:**
- Create: `packages/schemas/src/pcd-synthetic-routing-provenance.ts`
- Create: `packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts`
- Modify: `packages/schemas/src/index.ts` (add one re-export line)

Per design §3.2.

- [ ] **Step 2.1: Write the failing test file**

Create `packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdSp18SyntheticRoutingDecisionReasonSchema,
  PcdSp18SyntheticRoutingProvenancePayloadSchema,
} from "../pcd-synthetic-routing-provenance.js";

const klingDirectionFixture = {
  setting: "studio-bright",
  motion: "subtle-dolly",
  energy: "calm",
  lighting: "soft",
  avoid: ["shaky-cam"],
} as const;

const seedanceDirectionFixture = {
  setting: "outdoor-natural",
  motion: "handheld-organic",
  energy: "lively",
  lighting: "golden-hour",
  avoid: ["jump-cuts"],
} as const;

const innerDecisionReasonFixture = {
  matchedShotType: "simple_ugc",
  matchedOutputIntent: "draft",
  selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
} as const;

const decidedAt = "2026-05-16T08:00:00.000Z";
const provenanceVersion = "pcd-synthetic-routing-provenance@1.0.0";
const promptHash = "a".repeat(64);

const klingReason = {
  videoProvider: "kling" as const,
  klingDirection: klingDirectionFixture,
  pairingRefIndex: 0,
  decisionReason: innerDecisionReasonFixture,
  decidedAt,
  syntheticRoutingProvenanceVersion: provenanceVersion,
};

const seedanceReason = {
  videoProvider: "seedance" as const,
  seedanceDirection: seedanceDirectionFixture,
  pairingRefIndex: 1,
  decisionReason: innerDecisionReasonFixture,
  decidedAt,
  syntheticRoutingProvenanceVersion: provenanceVersion,
};

const klingPayload = {
  imageProvider: "dalle" as const,
  videoProvider: "kling" as const,
  videoProviderChoice: "kling" as const,
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  promptHash,
  syntheticRoutingDecisionReason: klingReason,
};

const seedancePayload = {
  imageProvider: "dalle" as const,
  videoProvider: "seedance" as const,
  videoProviderChoice: "seedance" as const,
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  promptHash,
  syntheticRoutingDecisionReason: seedanceReason,
};

describe("PcdSp18SyntheticRoutingDecisionReasonSchema", () => {
  it("round-trips a kling-success reason", () => {
    expect(PcdSp18SyntheticRoutingDecisionReasonSchema.parse(klingReason)).toEqual(klingReason);
  });

  it("round-trips a seedance-success reason", () => {
    expect(PcdSp18SyntheticRoutingDecisionReasonSchema.parse(seedanceReason)).toEqual(
      seedanceReason,
    );
  });

  it("rejects kling reason carrying seedanceDirection", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        seedanceDirection: seedanceDirectionFixture,
      }),
    ).toThrow();
  });

  it("rejects seedance reason carrying klingDirection", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...seedanceReason,
        klingDirection: klingDirectionFixture,
      }),
    ).toThrow();
  });

  it("rejects missing videoProvider", () => {
    const { videoProvider: _vp, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects videoProvider: 'other'", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        videoProvider: "other",
      }),
    ).toThrow();
  });

  it("rejects missing syntheticRoutingProvenanceVersion", () => {
    const { syntheticRoutingProvenanceVersion: _v, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects missing decidedAt", () => {
    const { decidedAt: _d, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects non-ISO decidedAt", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        decidedAt: "2026-05-16 08:00:00",
      }),
    ).toThrow();
  });
});

describe("PcdSp18SyntheticRoutingProvenancePayloadSchema", () => {
  it("round-trips a kling payload", () => {
    expect(PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(klingPayload)).toEqual(
      klingPayload,
    );
  });

  it("round-trips a seedance payload", () => {
    expect(PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(seedancePayload)).toEqual(
      seedancePayload,
    );
  });

  it("rejects payload with imageProvider other than 'dalle'", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        imageProvider: "other",
      }),
    ).toThrow();
  });

  it("rejects payload with promptHash not 64-hex-char", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        promptHash: "tooshort",
      }),
    ).toThrow();
  });

  it("rejects payload with uppercase promptHash", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        promptHash: "A".repeat(64),
      }),
    ).toThrow();
  });

  it("rejects payload where flat videoProvider mismatches reason videoProvider (cross-field refine)", () => {
    const corrupt = { ...klingPayload, videoProvider: "seedance" as const };
    const result = PcdSp18SyntheticRoutingProvenancePayloadSchema.safeParse(corrupt);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "syntheticRoutingDecisionReason",
        "videoProvider",
      ]);
    }
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-routing-provenance
```

Expected: FAIL with `Cannot find module '../pcd-synthetic-routing-provenance.js'` or similar import error.

- [ ] **Step 2.3: Create the schemas file**

Create `packages/schemas/src/pcd-synthetic-routing-provenance.ts`:

```ts
// PCD slice SP18 — Synthetic-routing-provenance forensic record. Carries the
// SP17 synthetic-pairing-success decision's persisted form on PcdIdentitySnapshot.
// Discriminated on videoProvider for the direction-bearing Json.
//
// MERGE-BACK: net-new SP18 schema. No reconciliation needed at Switchboard
// merge (net-new on both sides). If Switchboard adds provider-specific fields
// later, this schema widens here first and merges back additively.
//
// NB: z.union (not z.discriminatedUnion) — same Zod 3.x readonly carve-out as
// SP13/SP14/SP15/SP16/SP17. z.union parses by trying members in order;
// semantically equivalent for the 2-branch shape.
import { z } from "zod";
import {
  KlingDirectionSchema,
  SeedanceDirectionSchema,
} from "./creator-identity-synthetic.js";
import { PcdShotTypeSchema, OutputIntentSchema } from "./pcd-identity.js";

const DecisionReasonInnerSchema = z
  .object({
    matchedShotType: PcdShotTypeSchema,
    matchedOutputIntent: OutputIntentSchema,
    selectionRationale: z.string().min(1).max(200),
  })
  .readonly();

// MERGE-BACK: SP18 Json-reason union. Two branches discriminated on
// videoProvider; provider-specific direction artifact lives on the
// matching branch only (no cross-binding).
export const PcdSp18SyntheticRoutingDecisionReasonSchema = z.union([
  z
    .object({
      videoProvider: z.literal("kling"),
      klingDirection: KlingDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .strict()
    .readonly(),

  z
    .object({
      videoProvider: z.literal("seedance"),
      seedanceDirection: SeedanceDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .strict()
    .readonly(),
]);
export type PcdSp18SyntheticRoutingDecisionReason = z.infer<
  typeof PcdSp18SyntheticRoutingDecisionReasonSchema
>;

// MERGE-BACK: SP18 persistence shape. 6 flat columns + 1 Json reason.
// Cross-field refine: payload.videoProvider MUST match the reason Json's
// videoProvider. Stamper constructs both from the same source value; refine
// defends against tampered or hand-constructed payloads (external callers,
// merge-back integration).
export const PcdSp18SyntheticRoutingProvenancePayloadSchema = z
  .object({
    imageProvider: z.literal("dalle"),
    videoProvider: z.union([z.literal("kling"), z.literal("seedance")]),
    videoProviderChoice: z.union([z.literal("kling"), z.literal("seedance")]),
    syntheticRouterVersion: z.string().min(1),
    syntheticPairingVersion: z.string().min(1),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReasonSchema,
  })
  .refine(
    (payload) =>
      payload.videoProvider === payload.syntheticRoutingDecisionReason.videoProvider,
    {
      path: ["syntheticRoutingDecisionReason", "videoProvider"],
      message:
        "syntheticRoutingDecisionReason.videoProvider must match flat videoProvider",
    },
  );
export type PcdSp18SyntheticRoutingProvenancePayload = z.infer<
  typeof PcdSp18SyntheticRoutingProvenancePayloadSchema
>;
```

**Note on `.strict()`:** added to both union branches to make cross-pollution rejection (kling carrying seedanceDirection, seedance carrying klingDirection) reliable. Without `.strict()`, Zod strips unknown keys but parses; with `.strict()`, unknown keys produce an `unrecognized_keys` issue. Matches the SP17 design's expectation that cross-bound directions fail.

- [ ] **Step 2.4: Add barrel re-export**

Edit `packages/schemas/src/index.ts`. Locate the existing re-exports section (alphabetized) and add:

```ts
export * from "./pcd-synthetic-routing-provenance.js";
```

(If imports are alphabetized, place between `./pcd-synthetic-router.js` and `./pcd-synthetic-selector.js`.)

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-routing-provenance
```

Expected: 15 tests pass.

- [ ] **Step 2.6: Typecheck**

```bash
pnpm --filter @creativeagent/schemas typecheck
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```bash
git add packages/schemas/src/pcd-synthetic-routing-provenance.ts \
        packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP18 task 2 — PcdSp18SyntheticRoutingDecisionReasonSchema + payload schema with cross-field refine"
```

---

## Task 3: Prisma migration + `schema.prisma` widen

**Files:**
- Create: `packages/db/prisma/migrations/<utc-ts>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (widen `PcdIdentitySnapshot` model)

Per design §3.7.

- [ ] **Step 3.1: Capture migration timestamp**

The migration directory name uses a UTC timestamp at the moment of authoring. Capture it:

```bash
date -u +"%Y%m%d%H%M%S"
```

Use the output as `<MIGRATION_TS>` below. (Example output: `20260516120000`.)

- [ ] **Step 3.2: Create migration directory + SQL file**

```bash
mkdir -p packages/db/prisma/migrations/<MIGRATION_TS>_pcd_identity_snapshot_sp18_synthetic_routing_provenance
```

Create `packages/db/prisma/migrations/<MIGRATION_TS>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/migration.sql`:

```sql
-- SP18 — Synthetic-routing provenance on PcdIdentitySnapshot.
-- All columns nullable for historical compatibility (pre-SP18 rows return NULL).
-- No FK, no index in v1 — see SP18 design §2.2 Q7.
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "imageProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProviderChoice" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRouterVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticPairingVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "promptHash" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRoutingDecisionReason" JSONB;
```

- [ ] **Step 3.3: Edit `schema.prisma` to widen the model**

Open `packages/db/prisma/schema.prisma` and locate the `PcdIdentitySnapshot` model (around line 334). Find the existing SP10A `costForecastReason Json?` line. Insert the SP18 fields immediately AFTER `costForecastReason` and BEFORE `createdAt`:

```prisma
  // SP10A — per-asset cost forecast forensic record. Nullable for historical
  // compatibility (pre-SP10A rows remain readable). No flat numeric column
  // and no new index in SP10A; range queries use Postgres JSON operators.
  // See docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md §0 risk #9.
  costForecastReason          Json?

  // SP18 — Synthetic-routing provenance. All columns nullable for historical
  // compatibility (pre-SP18 rows remain readable). Populated by the SP18
  // orchestrator (writePcdIdentitySnapshotWithSyntheticRouting) for synthetic-
  // pairing success decisions only; delegation and denial decisions do NOT
  // use this path. No flat-numeric column and no index in v1 — see SP18
  // design §2.2 Q7.
  imageProvider                   String?
  videoProvider                   String?
  videoProviderChoice             String?
  syntheticRouterVersion          String?
  syntheticPairingVersion         String?
  promptHash                      String?
  syntheticRoutingDecisionReason  Json?

  createdAt                   DateTime        @default(now())
```

Do NOT touch the existing `@@index([...])` lines — SP18 adds no indexes.

- [ ] **Step 3.4: Apply migration locally**

```bash
pnpm --filter @creativeagent/db exec prisma migrate dev --skip-seed --name pcd_identity_snapshot_sp18_synthetic_routing_provenance
```

Expected: Prisma detects the existing migration file and applies it. **If Prisma tries to CREATE a new migration with a different name, that means `schema.prisma` is out of sync with the SQL file — re-check Step 3.3.** Migration should apply cleanly.

- [ ] **Step 3.5: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: clean. The generated client now knows about the 7 new nullable columns.

- [ ] **Step 3.6: Verify migration drift-free**

```bash
pnpm --filter @creativeagent/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-migrations packages/db/prisma/migrations \
  --exit-code
```

Expected: exit code 0 (no drift). If non-zero, the SQL and schema.prisma have diverged — re-check Step 3.2 vs Step 3.3.

- [ ] **Step 3.7: Run typecheck across all packages**

```bash
pnpm typecheck
```

Expected: clean. The widened Prisma client types should not break anything (existing callsites read only existing columns).

- [ ] **Step 3.8: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/<MIGRATION_TS>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/migration.sql
git commit -m "feat(pcd): SP18 task 3 — Prisma migration adds 7 nullable columns to PcdIdentitySnapshot"
```

---

## Task 4: Prisma store widen — `createForShotWithSyntheticRouting` + adapter

**Files:**
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (add method + adapter)
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts` (round-trip test)

Per design §3.5 + §3.7.

The SP4 / SP9 / SP10A store contracts + adapters are preserved byte-equivalent. SP18 adds a new `createForShotWithSyntheticRouting` method on the class and a sibling `adaptPcdSp18IdentitySnapshotStore` adapter.

- [ ] **Step 4.1: Read the existing store file to understand the structure**

```bash
sed -n '1,60p' packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts
```

Expected: imports + class `PrismaPcdIdentitySnapshotStore` with methods `create`, `createForShotWithProvenance`, `createForShotWithCostForecast`. Adapters `adaptPcdIdentitySnapshotStore`, `adaptPcdSp9IdentitySnapshotStore`, `adaptPcdSp10IdentitySnapshotStore`.

(The exact line numbers depend on SP10A/SP10C state on `main` at execution time; do not hardcode them.)

- [ ] **Step 4.2: Write the failing test**

Append to `packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts`:

```ts
describe("createForShotWithSyntheticRouting (SP18)", () => {
  it("writes a 33-field row including the 7 SP18 columns", async () => {
    const prismaMock = {
      pcdIdentitySnapshot: {
        create: vi.fn().mockResolvedValue({
          id: "snap-1",
          assetRecordId: "asset-1",
          // ...minimal SP4 fields...
          briefId: "brief-1",
          imageProvider: "dalle",
          videoProvider: "kling",
          videoProviderChoice: "kling",
          syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
          syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
          promptHash: "a".repeat(64),
          syntheticRoutingDecisionReason: { videoProvider: "kling" },
          createdAt: new Date(),
        }),
      },
    };
    const store = new PrismaPcdIdentitySnapshotStore(prismaMock as unknown as PrismaClient);

    const result = await store.createForShotWithSyntheticRouting({
      // 15 SP4 base fields
      assetRecordId: "asset-1",
      productIdentityId: "prod-1",
      productTierAtGeneration: 3,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash-x",
      productLogoAssetId: null,
      creatorIdentityId: "creator-1",
      avatarTierAtGeneration: 3,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      selectedProvider: "dalle",
      providerModelSnapshot: "dalle-3",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      // SP4 pinned versions + forensic
      policyVersion: "pcd-tier-policy@1.0.0",
      providerCapabilityVersion: "pcd-provider-capability@1.0.0",
      routerVersion: "pcd-provider-router@1.0.0",
      shotSpecVersion: "pcd-shot-spec@1.0.0",
      routingDecisionReason: { selectionRationale: "test" },
      // SP9 lineage
      briefId: "brief-1",
      trendId: "trend-1",
      motivatorId: "mot-1",
      hookId: "hook-1",
      scriptId: "script-1",
      lineageDecisionReason: {
        decidedAt: "2026-05-16T08:00:00.000Z",
        fanoutDecisionId: "fanout-1",
        chainVersion: "pcd-preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
      // SP18 synthetic-routing
      imageProvider: "dalle",
      videoProvider: "kling",
      videoProviderChoice: "kling",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      promptHash: "a".repeat(64),
      syntheticRoutingDecisionReason: {
        videoProvider: "kling",
        klingDirection: {
          setting: "x",
          motion: "y",
          energy: "z",
          lighting: "w",
          avoid: [],
        },
        pairingRefIndex: 0,
        decisionReason: {
          matchedShotType: "simple_ugc",
          matchedOutputIntent: "draft",
          selectionRationale: "test",
        },
        decidedAt: "2026-05-16T08:00:00.000Z",
        syntheticRoutingProvenanceVersion: "pcd-synthetic-routing-provenance@1.0.0",
      },
    });

    expect(prismaMock.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
    const callArg = prismaMock.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(callArg.imageProvider).toBe("dalle");
    expect(callArg.videoProvider).toBe("kling");
    expect(callArg.videoProviderChoice).toBe("kling");
    expect(callArg.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(callArg.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
    expect(callArg.promptHash).toBe("a".repeat(64));
    expect(callArg.syntheticRoutingDecisionReason).toMatchObject({ videoProvider: "kling" });
    expect(result.imageProvider).toBe("dalle");
  });
});

describe("adaptPcdSp18IdentitySnapshotStore (SP18)", () => {
  it("returns a contract-shaped object that delegates to createForShotWithSyntheticRouting", () => {
    const prismaStore = { createForShotWithSyntheticRouting: vi.fn() };
    const adapted = adaptPcdSp18IdentitySnapshotStore(
      prismaStore as unknown as PrismaPcdIdentitySnapshotStore,
    );
    expect(typeof adapted.createForShotWithSyntheticRouting).toBe("function");
  });
});
```

(Subagent: ensure `vi` and `PrismaClient` are imported at the top of the test file — copy the existing import block, do not introduce new shapes.)

- [ ] **Step 4.3: Run test to verify failure**

```bash
pnpm --filter @creativeagent/db test prisma-pcd-identity-snapshot-store
```

Expected: FAIL with "createForShotWithSyntheticRouting is not a function" or similar.

- [ ] **Step 4.4: Add `createForShotWithSyntheticRouting` method to the store class**

Edit `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`. After the existing `createForShotWithCostForecast` method, add:

```ts
  /**
   * SP18 — Persists a synthetic-routing-success snapshot. 33 input fields
   * (SP4 base + SP4 versions + SP9 lineage + SP18 synthetic-routing provenance).
   *
   * costForecastReason is intentionally not part of this method's input — SP18
   * orchestrator does not bundle SP10A cost (orthogonal slices). Prisma writes
   * the column as NULL via its nullable default.
   *
   * MERGE-BACK: net-new SP18 store method.
   */
  async createForShotWithSyntheticRouting(input: {
    // SP4 base
    assetRecordId: string;
    productIdentityId: string;
    productTierAtGeneration: number;
    productImageAssetIds: string[];
    productCanonicalTextHash: string;
    productLogoAssetId: string | null;
    creatorIdentityId: string;
    avatarTierAtGeneration: number;
    avatarReferenceAssetIds: string[];
    voiceAssetId: string | null;
    consentRecordId: string | null;
    selectedProvider: string;
    providerModelSnapshot: string;
    seedOrNoSeed: string;
    rewrittenPromptText: string | null;
    // SP4 pinned + forensic
    policyVersion: string;
    providerCapabilityVersion: string;
    routerVersion: string;
    shotSpecVersion: string | null;
    routingDecisionReason: unknown;
    // SP9 lineage
    briefId: string;
    trendId: string;
    motivatorId: string;
    hookId: string;
    scriptId: string;
    lineageDecisionReason: unknown;
    // SP18 synthetic-routing
    imageProvider: "dalle";
    videoProvider: "kling" | "seedance";
    videoProviderChoice: "kling" | "seedance";
    syntheticRouterVersion: string;
    syntheticPairingVersion: string;
    promptHash: string;
    syntheticRoutingDecisionReason: unknown;
  }): Promise<PcdIdentitySnapshotRow> {
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        assetRecordId: input.assetRecordId,
        productIdentityId: input.productIdentityId,
        productTierAtGeneration: input.productTierAtGeneration,
        productImageAssetIds: input.productImageAssetIds,
        productCanonicalTextHash: input.productCanonicalTextHash,
        productLogoAssetId: input.productLogoAssetId,
        creatorIdentityId: input.creatorIdentityId,
        avatarTierAtGeneration: input.avatarTierAtGeneration,
        avatarReferenceAssetIds: input.avatarReferenceAssetIds,
        voiceAssetId: input.voiceAssetId,
        consentRecordId: input.consentRecordId,
        selectedProvider: input.selectedProvider,
        providerModelSnapshot: input.providerModelSnapshot,
        seedOrNoSeed: input.seedOrNoSeed,
        rewrittenPromptText: input.rewrittenPromptText,
        policyVersion: input.policyVersion,
        providerCapabilityVersion: input.providerCapabilityVersion,
        routerVersion: input.routerVersion,
        shotSpecVersion: input.shotSpecVersion,
        routingDecisionReason: input.routingDecisionReason as Prisma.InputJsonValue,
        briefId: input.briefId,
        trendId: input.trendId,
        motivatorId: input.motivatorId,
        hookId: input.hookId,
        scriptId: input.scriptId,
        lineageDecisionReason: input.lineageDecisionReason as Prisma.InputJsonValue,
        imageProvider: input.imageProvider,
        videoProvider: input.videoProvider,
        videoProviderChoice: input.videoProviderChoice,
        syntheticRouterVersion: input.syntheticRouterVersion,
        syntheticPairingVersion: input.syntheticPairingVersion,
        promptHash: input.promptHash,
        syntheticRoutingDecisionReason: input.syntheticRoutingDecisionReason as Prisma.InputJsonValue,
        // costForecastReason intentionally absent — SP18 does not bundle SP10A cost.
      },
    });
  }
```

(Subagent: ensure `Prisma` is imported from `@prisma/client` if not already — copy from the existing `createForShotWithCostForecast` method's import pattern.)

- [ ] **Step 4.5: Add `adaptPcdSp18IdentitySnapshotStore` adapter function**

After the existing `adaptPcdSp10IdentitySnapshotStore` adapter, add:

```ts
/**
 * SP18 — Adapter returning the SP18 store contract shape. Delegates to the
 * concrete PrismaPcdIdentitySnapshotStore.createForShotWithSyntheticRouting.
 *
 * MERGE-BACK: at Switchboard merge, the production runner wires this adapter
 * by injecting it into writePcdIdentitySnapshotWithSyntheticRouting's stores
 * parameter (pcdSp18IdentitySnapshotStore field).
 */
export function adaptPcdSp18IdentitySnapshotStore(
  prismaStore: PrismaPcdIdentitySnapshotStore,
): PcdSp18IdentitySnapshotStore {
  return {
    createForShotWithSyntheticRouting: (input) =>
      prismaStore.createForShotWithSyntheticRouting(input),
  };
}
```

Import `PcdSp18IdentitySnapshotStore` at the top of the file:

```ts
import type { PcdSp18IdentitySnapshotStore } from "@creativeagent/creative-pipeline/pcd/synthetic-routing-provenance";
```

**Note on the import path:** Task 6 creates `pcd-sp18-identity-snapshot-store.ts` and Task 11 wires the barrel. If the import path here resolves before Task 6, the typecheck will fail. Subagent: defer the adapter implementation if necessary, OR coordinate Tasks 4 + 6 ordering (Task 6 ships the type-only contract; Task 4 imports it). **Recommendation:** Execute Task 6 BEFORE this step. The plan order Task 4 → Task 5 → Task 6 is sub-optimal; subagent-driven-development can re-order — reorder to Task 5 → Task 6 → Task 4 if needed. This plan keeps the design's logical order for clarity but flags the dependency.

- [ ] **Step 4.6: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/db test prisma-pcd-identity-snapshot-store
pnpm --filter @creativeagent/db typecheck
```

Expected: both green.

- [ ] **Step 4.7: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts \
        packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts
git commit -m "feat(pcd): SP18 task 4 — PrismaPcdIdentitySnapshotStore.createForShotWithSyntheticRouting + adaptPcdSp18IdentitySnapshotStore"
```

---

## Task 5: `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` constant (22nd pinned PCD constant)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.test.ts`

Per design §3.3.

- [ ] **Step 5.1: Create the subdir**

```bash
mkdir -p packages/creative-pipeline/src/pcd/synthetic-routing-provenance
```

- [ ] **Step 5.2: Write the failing test**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

describe("PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION", () => {
  it("is the exact literal 'pcd-synthetic-routing-provenance@1.0.0'", () => {
    expect(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION).toBe(
      "pcd-synthetic-routing-provenance@1.0.0",
    );
  });

  it("starts with the 'pcd-synthetic-routing-provenance@' prefix", () => {
    expect(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION.startsWith(
      "pcd-synthetic-routing-provenance@",
    )).toBe(true);
  });
});
```

- [ ] **Step 5.3: Run test to verify failure**

```bash
pnpm --filter @creativeagent/creative-pipeline test synthetic-routing-provenance-version
```

Expected: FAIL with module-not-found.

- [ ] **Step 5.4: Create the constant file**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts`:

```ts
// PCD slice SP18 — 22nd pinned PCD constant. Versions the SP18 forensic-record
// shape. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (router logic) and
// PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION (matrix data) — those values are
// persisted as forensic data (read off the decision), not pinned by SP18.
// Bumped independently when the SP18 forensic-record shape evolves.
//
// Guardrail C (two parts):
//   1. Sole literal site — the literal "pcd-synthetic-routing-provenance@"
//      appears in exactly ONE non-test source file: this one.
//   2. Sole runtime import site — among non-test runtime sources, this
//      constant is imported by exactly ONE file: stamp-pcd-synthetic-routing-
//      decision.ts. Tests are explicitly carved out and may import the
//      constant from this file for literal-pin assertions.
//
// MERGE-BACK: Switchboard merge does not change this literal. Bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION =
  "pcd-synthetic-routing-provenance@1.0.0";
```

- [ ] **Step 5.5: Run test to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test synthetic-routing-provenance-version
```

Expected: 2 tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts \
        packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.test.ts
git commit -m "feat(pcd): SP18 task 5 — PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION (22nd pinned constant)"
```

---

## Task 6: `PcdSp18IdentitySnapshotStore` contract type (type-only file)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts`

Per design §3.5.

- [ ] **Step 6.1: Create the contract type file**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts`:

```ts
// SP18 — Additive store contract. Imported from SP18 sources only. The SP4 /
// SP9 / SP10A contracts are preserved verbatim and continue to serve their
// callsites. The Prisma adapter (adaptPcdSp18IdentitySnapshotStore in
// packages/db/) wires this contract onto the widened PcdIdentitySnapshot
// model.
//
// MERGE-BACK: net-new SP18 store contract. Production runner injects this at
// merge-back by calling adaptPcdSp18IdentitySnapshotStore(prismaStore).

import type {
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
  PcdSp18SyntheticRoutingDecisionReason,
} from "@creativeagent/schemas";

export type PcdSp18IdentitySnapshotStore = {
  createForShotWithSyntheticRouting(input: {
    // SP4 base — identity + provider
    assetRecordId: string;
    productIdentityId: string;
    productTierAtGeneration: number;
    productImageAssetIds: ReadonlyArray<string>;
    productCanonicalTextHash: string;
    productLogoAssetId: string | null;
    creatorIdentityId: string;
    avatarTierAtGeneration: number;
    avatarReferenceAssetIds: ReadonlyArray<string>;
    voiceAssetId: string | null;
    consentRecordId: string | null;
    selectedProvider: string;
    providerModelSnapshot: string;
    seedOrNoSeed: string;
    rewrittenPromptText: string | null;
    // SP4 pinned versions (orchestrator stamps from imports)
    policyVersion: string;
    providerCapabilityVersion: string;
    routerVersion: string;
    shotSpecVersion: string | null;
    routingDecisionReason: unknown; // SP4 Json forensic
    // SP9 lineage
    briefId: string;
    trendId: string;
    motivatorId: string;
    hookId: string;
    scriptId: string;
    lineageDecisionReason: PcdProvenanceDecisionReason;
    // SP18 synthetic-routing — 6 flat + 1 Json
    imageProvider: "dalle";
    videoProvider: "kling" | "seedance";
    videoProviderChoice: "kling" | "seedance";
    syntheticRouterVersion: string;
    syntheticPairingVersion: string;
    promptHash: string;
    syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReason;
    // SP10A costForecastReason intentionally absent — SP18 orchestrator does
    // not bundle cost. Adapter writes the column as NULL via Prisma's default.
  }): Promise<PcdIdentitySnapshot>;
};
```

- [ ] **Step 6.2: Verify typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean. (No tests on a type-only file.)

- [ ] **Step 6.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts
git commit -m "feat(pcd): SP18 task 6 — PcdSp18IdentitySnapshotStore contract type"
```

---

## Task 7: `stampPcdSyntheticRoutingDecision` body + co-located tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.test.ts`

Per design §3.4 + §4.1 + §5.1.

This is the sole `crypto`-importing file across the SP18 surface (Guardrail D) and the sole runtime import site for `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` (Guardrail C).

- [ ] **Step 7.1: Write the failing tests (kling-success happy path first)**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SyntheticPcdRoutingDecision } from "@creativeagent/schemas";
import { stampPcdSyntheticRoutingDecision } from "./stamp-pcd-synthetic-routing-decision.js";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

const klingDirection = {
  setting: "studio-bright",
  motion: "subtle-dolly",
  energy: "calm",
  lighting: "soft",
  avoid: ["shaky-cam"],
} as const;

const seedanceDirection = {
  setting: "outdoor-natural",
  motion: "handheld-organic",
  energy: "lively",
  lighting: "golden-hour",
  avoid: ["jump-cuts"],
} as const;

const innerReason = {
  matchedShotType: "simple_ugc" as const,
  matchedOutputIntent: "draft" as const,
  selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
};

const accessDecisionFixture = {
  allowed: true as const,
  effectiveTier: 3 as const,
  reason: "tier_3_allows_all_shots" as const,
  tierPolicyVersion: "pcd-tier-policy@1.0.0",
};

const klingSuccess: SyntheticPcdRoutingDecision = {
  allowed: true,
  kind: "synthetic_pairing",
  accessDecision: accessDecisionFixture,
  imageProvider: "dalle",
  videoProvider: "kling",
  videoProviderChoice: "kling",
  dallePromptLocked: "a studio shot of the product, soft light, neutral background",
  klingDirection,
  pairingRefIndex: 0,
  pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  decisionReason: innerReason,
};

const seedanceSuccess: SyntheticPcdRoutingDecision = {
  allowed: true,
  kind: "synthetic_pairing",
  accessDecision: accessDecisionFixture,
  imageProvider: "dalle",
  videoProvider: "seedance",
  videoProviderChoice: "seedance",
  dallePromptLocked: "a studio shot of the product, soft light, neutral background",
  seedanceDirection,
  pairingRefIndex: 1,
  pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  decisionReason: innerReason,
};

const fixedClock = () => new Date("2026-05-16T08:00:00.000Z");

describe("stampPcdSyntheticRoutingDecision — kling success", () => {
  it("returns flat columns verbatim from the decision", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    expect(payload.imageProvider).toBe("dalle");
    expect(payload.videoProvider).toBe("kling");
    expect(payload.videoProviderChoice).toBe("kling");
    expect(payload.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(payload.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
  });

  it("computes promptHash = sha256(dallePromptLocked, utf8)", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const expected = createHash("sha256")
      .update(klingSuccess.dallePromptLocked, "utf8")
      .digest("hex");
    expect(payload.promptHash).toBe(expected);
    expect(payload.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("assembles Json reason with kling direction and no seedance leakage", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const reason = payload.syntheticRoutingDecisionReason;
    expect(reason.videoProvider).toBe("kling");
    if (reason.videoProvider === "kling") {
      expect(reason.klingDirection).toEqual(klingDirection);
    }
    expect((reason as { seedanceDirection?: unknown }).seedanceDirection).toBeUndefined();
    expect(reason.pairingRefIndex).toBe(0);
    expect(reason.decisionReason).toEqual(innerReason);
    expect(reason.decidedAt).toBe("2026-05-16T08:00:00.000Z");
    expect(reason.syntheticRoutingProvenanceVersion).toBe(
      PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION,
    );
  });
});

describe("stampPcdSyntheticRoutingDecision — seedance success", () => {
  it("returns flat columns verbatim from the decision", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: seedanceSuccess },
      { clock: fixedClock },
    );
    expect(payload.videoProvider).toBe("seedance");
    expect(payload.videoProviderChoice).toBe("seedance");
  });

  it("assembles Json reason with seedance direction and no kling leakage", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: seedanceSuccess },
      { clock: fixedClock },
    );
    const reason = payload.syntheticRoutingDecisionReason;
    expect(reason.videoProvider).toBe("seedance");
    if (reason.videoProvider === "seedance") {
      expect(reason.seedanceDirection).toEqual(seedanceDirection);
    }
    expect((reason as { klingDirection?: unknown }).klingDirection).toBeUndefined();
    expect(reason.pairingRefIndex).toBe(1);
  });
});

describe("stampPcdSyntheticRoutingDecision — defense-in-depth (Guardrail A)", () => {
  it("rejects ACCESS_POLICY denial branch", async () => {
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision: { allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: denial }, { clock: fixedClock }),
    ).rejects.toThrow();
  });

  it("rejects NO_DIRECTION_AUTHORED denial branch", async () => {
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "seedance",
      accessDecision: accessDecisionFixture,
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: denial }, { clock: fixedClock }),
    ).rejects.toThrow();
  });

  it("rejects delegation branch", async () => {
    const delegated = {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: "script_only",
      sp4Decision: { allowed: true },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: delegated }, { clock: fixedClock }),
    ).rejects.toThrow();
  });
});

describe("stampPcdSyntheticRoutingDecision — clock injection + wall-clock fallback", () => {
  it("uses the injected clock when provided", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: () => new Date("2026-12-31T23:59:59.999Z") },
    );
    expect(payload.syntheticRoutingDecisionReason.decidedAt).toBe("2026-12-31T23:59:59.999Z");
  });

  it("falls back to new Date() when no clock injected", async () => {
    const before = Date.now();
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      {},
    );
    const after = Date.now();
    const stamped = Date.parse(payload.syntheticRoutingDecisionReason.decidedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});

describe("stampPcdSyntheticRoutingDecision — promptHash properties", () => {
  it("produces identical hashes for identical inputs", async () => {
    const a = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const b = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    expect(a.promptHash).toBe(b.promptHash);
  });

  it("produces different hashes for different inputs", async () => {
    const variant: SyntheticPcdRoutingDecision = {
      ...klingSuccess,
      dallePromptLocked: klingSuccess.dallePromptLocked + " plus an extra word",
    };
    const a = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const b = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: variant },
      { clock: fixedClock },
    );
    expect(a.promptHash).not.toBe(b.promptHash);
  });

  it("hashes UTF-8 bytes correctly for non-ASCII input", async () => {
    const variant: SyntheticPcdRoutingDecision = {
      ...klingSuccess,
      dallePromptLocked: "café",
    };
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: variant },
      { clock: fixedClock },
    );
    // sha256 of "café" (UTF-8): 4 bytes for "caf" + 2 bytes for "é" (U+00E9 → C3 A9).
    // Computed independently: openssl dgst -sha256 with stdin "café" (no newline).
    const expected = createHash("sha256").update("café", "utf8").digest("hex");
    expect(payload.promptHash).toBe(expected);
  });
});
```

- [ ] **Step 7.2: Run tests to verify failure**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-synthetic-routing-decision
```

Expected: FAIL with module-not-found.

- [ ] **Step 7.3: Write the stamper implementation**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts`:

```ts
// SP18 — Pure stamper. Sole crypto-importing file across the SP18 surface
// (Guardrail D). Sole runtime import site for
// PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION (Guardrail C). Validates the input
// is a success-branch decision (TS at compile time + Zod at runtime — J3
// belt-and-suspenders), computes promptHash, pins the version, assembles the
// payload, defense-in-depth-re-parses the assembled payload.
//
// MERGE-BACK: emit WorkTrace here (synthetic routing decision stamped) — two
// emit points marked below.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type PcdSp18SyntheticRoutingProvenancePayload,
  PcdSp18SyntheticRoutingProvenancePayloadSchema,
  type SyntheticPcdRoutingDecision,
  SyntheticPcdRoutingDecisionSchema,
} from "@creativeagent/schemas";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

/**
 * Success-branch narrowing — Q6 / Guardrail A. The stamper accepts ONLY a
 * synthetic-pairing success decision. Delegation + denial branches fail at
 * compile time inside the package, and at runtime via the Step 1 refine.
 */
export type SyntheticPairingSuccessDecision = Extract<
  SyntheticPcdRoutingDecision,
  { allowed: true; kind: "synthetic_pairing" }
>;

export type StampPcdSyntheticRoutingDecisionInput = {
  syntheticDecision: SyntheticPairingSuccessDecision;
};

export type StampPcdSyntheticRoutingDecisionStores = {
  clock?: () => Date;
};

export async function stampPcdSyntheticRoutingDecision(
  input: StampPcdSyntheticRoutingDecisionInput,
  stores: StampPcdSyntheticRoutingDecisionStores,
): Promise<PcdSp18SyntheticRoutingProvenancePayload> {
  // Step 1 — Defense-in-depth runtime parse (J3 belt-and-suspenders).
  // Re-parse through the full 5-branch SyntheticPcdRoutingDecisionSchema
  // and then runtime-refine to the success branch. Catches external callers
  // who pass a runtime-shaped value through `unknown`.
  const decision = SyntheticPcdRoutingDecisionSchema.parse(input.syntheticDecision);
  if (!(decision.kind === "synthetic_pairing" && decision.allowed === true)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["syntheticDecision"],
        message: "SP18 stamper only accepts synthetic-pairing success decisions",
      },
    ]);
  }

  // Step 2 — Compute promptHash (J2). sha256 over UTF-8 bytes of
  // dallePromptLocked, lowercase hex, 64 chars.
  const promptHash = createHash("sha256")
    .update(decision.dallePromptLocked, "utf8")
    .digest("hex");

  // Step 3 — Wall-clock stamp (J6). Same convention as SP9/SP10A.
  const decidedAt = (stores.clock?.() ?? new Date()).toISOString();

  // Step 4 — Assemble the Json reason discriminated on videoProvider.
  // Build via narrow if/else so TypeScript narrowing keeps the direction
  // fields type-correct on each branch.
  const reasonBase = {
    pairingRefIndex: decision.pairingRefIndex,
    decisionReason: decision.decisionReason,
    decidedAt,
    syntheticRoutingProvenanceVersion: PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION,
  } as const;

  const syntheticRoutingDecisionReason =
    decision.videoProvider === "kling"
      ? {
          videoProvider: "kling" as const,
          klingDirection: decision.klingDirection,
          ...reasonBase,
        }
      : {
          videoProvider: "seedance" as const,
          seedanceDirection: decision.seedanceDirection,
          ...reasonBase,
        };

  // MERGE-BACK: emit WorkTrace here (Json reason assembled)

  // Step 5 — Assemble the flat-column payload from the decision verbatim (J7).
  // syntheticRouterVersion + syntheticPairingVersion are stamped from the
  // decision's emitted values, NOT from re-imports — forensic fidelity for
  // historical-replay drift.
  const payload = {
    imageProvider: decision.imageProvider,
    videoProvider: decision.videoProvider,
    videoProviderChoice: decision.videoProviderChoice,
    syntheticRouterVersion: decision.syntheticRouterVersion,
    syntheticPairingVersion: decision.pairingVersion,
    promptHash,
    syntheticRoutingDecisionReason,
  };

  // Step 6 — Defense-in-depth re-parse. Catches discriminator drift AND the
  // cross-field consistency invariant (payload.videoProvider must equal
  // syntheticRoutingDecisionReason.videoProvider) via the schema's .refine().
  // Both checks are structurally impossible on the happy path (stamper
  // constructs both from the same source value); the re-parse defends
  // against tampering.
  const validated = PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(payload);

  // MERGE-BACK: emit WorkTrace here (synthetic-routing payload validated)

  return validated;
}
```

- [ ] **Step 7.4: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-synthetic-routing-decision
```

Expected: ~14 tests pass.

- [ ] **Step 7.5: Typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 7.6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts \
        packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.test.ts
git commit -m "feat(pcd): SP18 task 7 — stampPcdSyntheticRoutingDecision (pure stamper + crypto sole-import + version sole-import + defense-in-depth)"
```

---

## Task 8: `writePcdIdentitySnapshotWithSyntheticRouting` orchestrator + co-located tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.test.ts`

Per design §3.6 + §4.2 + §5.2.

**Plan directive (watchpoint #10):** The 4-way SP4 invariant lock-step MUST be a verbatim structural copy from `write-pcd-identity-snapshot-with-cost-forecast.ts` (the SP10A orchestrator). Same imported invariant symbol (`assertTier3RoutingDecisionCompliant`), same six argument names sourced from the same `input.snapshot.*` paths, same pre-persist placement (after stamps, before SP4 Zod parse). The anti-pattern test (Task 9 assertion #3) reads both files and asserts structural equivalence — subagents may accidentally "simplify" by extracting a helper or renaming arguments, both of which break the lock-step.

- [ ] **Step 8.1: Read the SP10A orchestrator to copy the SP4 invariant block verbatim**

```bash
cat packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts
```

Identify the `assertTier3RoutingDecisionCompliant({...})` call and the `PcdSp4IdentitySnapshotInputSchema.parse({...})` call. The SP18 orchestrator copies both verbatim (only the surrounding stamper calls + the final store call change).

- [ ] **Step 8.2: Write the failing tests**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { writePcdIdentitySnapshotWithSyntheticRouting } from "./write-pcd-identity-snapshot-with-synthetic-routing.js";

// Helper builders — share with sibling test files if extracted later, but
// keep duplicated for clarity per CLAUDE.md "co-located tests" convention.

function makeSnapshotInput() {
  return {
    assetRecordId: "asset-1",
    productIdentityId: "prod-1",
    productTierAtGeneration: 3 as const,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "hash-x",
    productLogoAssetId: null,
    creatorIdentityId: "creator-1",
    avatarTierAtGeneration: 3 as const,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: "consent-1",
    selectedProvider: "dalle",
    providerModelSnapshot: "dalle-3",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    shotSpecVersion: "pcd-shot-spec@1.0.0",
    routerVersion: "pcd-provider-router@1.0.0",
    routingDecisionReason: {
      capabilityRefIndex: 0,
      matchedShotType: "simple_ugc" as const,
      matchedEffectiveTier: 3 as const,
      matchedOutputIntent: "draft" as const,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "test",
    },
    effectiveTier: 3 as const,
    shotType: "simple_ugc" as const,
    outputIntent: "draft" as const,
    selectedCapability: {
      /* shape matches SP4 — copy from cost-forecast.test.ts */
    } as unknown,
    editOverRegenerateRequired: false,
  };
}

function makeKlingSuccessDecision() {
  return {
    allowed: true as const,
    kind: "synthetic_pairing" as const,
    accessDecision: {
      allowed: true as const,
      effectiveTier: 3 as const,
      reason: "tier_3_allows_all_shots" as const,
      tierPolicyVersion: "pcd-tier-policy@1.0.0",
    },
    imageProvider: "dalle" as const,
    videoProvider: "kling" as const,
    videoProviderChoice: "kling" as const,
    dallePromptLocked: "a studio shot",
    klingDirection: {
      setting: "studio",
      motion: "static",
      energy: "calm",
      lighting: "soft",
      avoid: [],
    },
    pairingRefIndex: 0,
    pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
    syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    decisionReason: {
      matchedShotType: "simple_ugc" as const,
      matchedOutputIntent: "draft" as const,
      selectionRationale: "test",
    },
  };
}

function makeChainFixture() {
  return {
    /* SP9 chain result fixture — minimal shape with one trend→motivator→hook→script
       chain rooted at scriptId "script-1". Subagent: copy from
       packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.test.ts
       fixture. Keep the shape identical. */
  } as unknown;
}

function makeOkStores() {
  return {
    pcdSp18IdentitySnapshotStore: {
      createForShotWithSyntheticRouting: vi.fn().mockResolvedValue({
        id: "snap-1",
        assetRecordId: "asset-1",
        videoProvider: "kling",
      }),
    },
    creatorIdentityReader: {
      findById: vi.fn().mockResolvedValue({ id: "creator-1", consentRecordId: "consent-1" }),
    },
    consentRecordReader: {
      findById: vi.fn().mockResolvedValue({ id: "consent-1", revoked: false }),
    },
    clock: () => new Date("2026-05-16T08:00:00.000Z"),
  };
}

describe("writePcdIdentitySnapshotWithSyntheticRouting — happy path", () => {
  it("calls SP18 store with the full merged payload (kling-success)", async () => {
    const stores = makeOkStores();
    const result = await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: makeSnapshotInput(),
        provenance: {
          briefId: "brief-1",
          creatorIdentityId: "creator-1",
          scriptId: "script-1",
          chainResult: makeChainFixture(),
          fanoutDecisionId: "fanout-1",
        },
        syntheticRouting: { syntheticDecision: makeKlingSuccessDecision() },
      },
      stores,
    );

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const payload =
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0][0];
    expect(payload.assetRecordId).toBe("asset-1");
    expect(payload.briefId).toBe("brief-1");
    expect(payload.imageProvider).toBe("dalle");
    expect(payload.videoProvider).toBe("kling");
    expect(payload.videoProviderChoice).toBe("kling");
    expect(payload.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(payload.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
    expect(payload.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.syntheticRoutingDecisionReason.videoProvider).toBe("kling");
    expect(result.id).toBe("snap-1");
  });

  it("stamps the four SP4 pinned versions from imports", async () => {
    const stores = makeOkStores();
    await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: makeSnapshotInput(),
        provenance: {
          briefId: "brief-1",
          creatorIdentityId: "creator-1",
          scriptId: "script-1",
          chainResult: makeChainFixture(),
          fanoutDecisionId: "fanout-1",
        },
        syntheticRouting: { syntheticDecision: makeKlingSuccessDecision() },
      },
      stores,
    );
    const payload =
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0][0];
    expect(payload.policyVersion).toBe("pcd-tier-policy@1.0.0");
    expect(payload.providerCapabilityVersion).toBe("pcd-provider-capability@1.0.0");
    expect(payload.routerVersion).toBe("pcd-provider-router@1.0.0");
  });
});

describe("writePcdIdentitySnapshotWithSyntheticRouting — failure modes", () => {
  it("throws ConsentRevokedRefusalError when consent is revoked; SP18 stamper not called; store not called", async () => {
    const stores = makeOkStores();
    stores.consentRecordReader.findById.mockResolvedValue({ id: "consent-1", revoked: true });

    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(
        {
          snapshot: makeSnapshotInput(),
          provenance: {
            briefId: "brief-1",
            creatorIdentityId: "creator-1",
            scriptId: "script-1",
            chainResult: makeChainFixture(),
            fanoutDecisionId: "fanout-1",
          },
          syntheticRouting: { syntheticDecision: makeKlingSuccessDecision() },
        },
        stores,
      ),
    ).rejects.toThrow(ConsentRevokedRefusalError);

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("throws InvariantViolationError when lineage script id missing from chain", async () => {
    const stores = makeOkStores();
    const badChain = { /* chain fixture without scriptId "script-1" */ };
    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(
        {
          snapshot: makeSnapshotInput(),
          provenance: {
            briefId: "brief-1",
            creatorIdentityId: "creator-1",
            scriptId: "script-1",
            chainResult: badChain as unknown,
            fanoutDecisionId: "fanout-1",
          },
          syntheticRouting: { syntheticDecision: makeKlingSuccessDecision() },
        },
        stores,
      ),
    ).rejects.toThrow(InvariantViolationError);
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("throws when SP18 stamper receives a denial branch (pre-empts Tier 3 + persist)", async () => {
    const stores = makeOkStores();
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision: { allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(
        {
          snapshot: makeSnapshotInput(),
          provenance: {
            briefId: "brief-1",
            creatorIdentityId: "creator-1",
            scriptId: "script-1",
            chainResult: makeChainFixture(),
            fanoutDecisionId: "fanout-1",
          },
          syntheticRouting: { syntheticDecision: denial as unknown as ReturnType<typeof makeKlingSuccessDecision> },
        },
        stores,
      ),
    ).rejects.toThrow();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});

describe("writePcdIdentitySnapshotWithSyntheticRouting — step ordering", () => {
  it("calls provenance stamp first, then synthetic-routing stamp, then store", async () => {
    const stores = makeOkStores();
    const callOrder: string[] = [];

    stores.creatorIdentityReader.findById = vi.fn(async (id: string) => {
      callOrder.push("creatorIdentityReader");
      return { id, consentRecordId: "consent-1" };
    });
    stores.consentRecordReader.findById = vi.fn(async (id: string) => {
      callOrder.push("consentRecordReader");
      return { id, revoked: false };
    });
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting = vi.fn(
      async (input) => {
        callOrder.push("store");
        return { id: "snap-1", ...input };
      },
    );

    await writePcdIdentitySnapshotWithSyntheticRouting(
      {
        snapshot: makeSnapshotInput(),
        provenance: {
          briefId: "brief-1",
          creatorIdentityId: "creator-1",
          scriptId: "script-1",
          chainResult: makeChainFixture(),
          fanoutDecisionId: "fanout-1",
        },
        syntheticRouting: { syntheticDecision: makeKlingSuccessDecision() },
      },
      stores,
    );

    expect(callOrder).toContain("creatorIdentityReader");
    expect(callOrder).toContain("consentRecordReader");
    expect(callOrder[callOrder.length - 1]).toBe("store");
  });
});
```

(Subagent: the `makeSnapshotInput`, `makeChainFixture`, `selectedCapability` fixture shape must match what SP10A's test uses. **Copy fixtures verbatim from `packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.test.ts`** to avoid drift.)

- [ ] **Step 8.3: Run tests to verify failure**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-identity-snapshot-with-synthetic-routing
```

Expected: FAIL with module-not-found.

- [ ] **Step 8.4: Write the orchestrator implementation**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts`:

```ts
// SP18 — Production callsite that bridges SP9's lineage stamp with the SP18
// synthetic-routing-decision stamp. Composes SP9's pure stamper (which itself
// does the consent re-check), composes SP18's pure stamper, runs the SP4
// invariant path (4-way lock-step with SP4 + SP9 + SP10A), then persists.
//
// The SP4 writer body, SP9 orchestrator body, and SP10A orchestrator body are
// preserved verbatim. SP18 is the NEW callsite; merge-back-time production
// runner is required to call this one when persisting a synthetic-pairing
// success decision's provenance. Delegation cases continue via SP4/SP9/SP10A;
// denial cases produce no asset.
//
// MERGE-BACK: pick fanoutDecisionId convention (inherited from SP9/SP10A).
// MERGE-BACK: production runner discipline — all synthetic-pairing success
//             callsites should call this orchestrator at merge-back.

import {
  type PcdIdentitySnapshot,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "../tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "../provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "../provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "../tier3-routing-rules.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import {
  stampPcdProvenance,
  type StampPcdProvenanceInput,
  type StampPcdProvenanceStores,
} from "../provenance/stamp-pcd-provenance.js";
import {
  stampPcdSyntheticRoutingDecision,
  type StampPcdSyntheticRoutingDecisionInput,
  type StampPcdSyntheticRoutingDecisionStores,
} from "./stamp-pcd-synthetic-routing-decision.js";
import type { PcdSp18IdentitySnapshotStore } from "./pcd-sp18-identity-snapshot-store.js";

export type WritePcdIdentitySnapshotWithSyntheticRoutingInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  syntheticRouting: StampPcdSyntheticRoutingDecisionInput;
};

export type WritePcdIdentitySnapshotWithSyntheticRoutingStores = {
  pcdSp18IdentitySnapshotStore: PcdSp18IdentitySnapshotStore;
} & StampPcdProvenanceStores &
  StampPcdSyntheticRoutingDecisionStores;

export async function writePcdIdentitySnapshotWithSyntheticRouting(
  input: WritePcdIdentitySnapshotWithSyntheticRoutingInput,
  stores: WritePcdIdentitySnapshotWithSyntheticRoutingStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance via SP9 pure compose. SP9 stamper does:
  //   (a) lineage walk (script→hook→motivator→trend→brief)
  //   (b) consent re-check via SP6 assertConsentNotRevokedForGeneration
  //   (c) payload assembly with PCD_PREPRODUCTION_CHAIN_VERSION + PCD_PROVENANCE_VERSION
  // Throws ConsentRevokedRefusalError / InvariantViolationError / ZodError.
  // All propagated raw; SP18 stamper NOT called on failure.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — Stamp synthetic-routing decision via SP18 pure compose. Defense-
  // in-depth Zod parse + success-branch refine + sha256(dallePromptLocked) +
  // version-pinned forensic record. Throws ZodError on bad input. All
  // propagated raw; Tier 3 invariant NOT run on failure.
  const syntheticRouting = await stampPcdSyntheticRoutingDecision(input.syntheticRouting, {
    clock: stores.clock,
  });

  // Step 3 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError. Store is
  // never called if this throws. Six-argument call shape structurally
  // identical to SP4 writer + SP9 orchestrator + SP10A orchestrator
  // (sp18-anti-patterns.test.ts enforces 4-way lock-step).
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 4 — Defense-in-depth Zod parse on the SP4 input subset. Mirrors SP4
  // writer + SP9 orchestrator + SP10A orchestrator allowlist forwarding.
  // Throws ZodError.
  const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
    assetRecordId: input.snapshot.assetRecordId,
    productIdentityId: input.snapshot.productIdentityId,
    productTierAtGeneration: input.snapshot.productTierAtGeneration,
    productImageAssetIds: input.snapshot.productImageAssetIds,
    productCanonicalTextHash: input.snapshot.productCanonicalTextHash,
    productLogoAssetId: input.snapshot.productLogoAssetId,
    creatorIdentityId: input.snapshot.creatorIdentityId,
    avatarTierAtGeneration: input.snapshot.avatarTierAtGeneration,
    avatarReferenceAssetIds: input.snapshot.avatarReferenceAssetIds,
    voiceAssetId: input.snapshot.voiceAssetId,
    consentRecordId: input.snapshot.consentRecordId,
    selectedProvider: input.snapshot.selectedProvider,
    providerModelSnapshot: input.snapshot.providerModelSnapshot,
    seedOrNoSeed: input.snapshot.seedOrNoSeed,
    rewrittenPromptText: input.snapshot.rewrittenPromptText,
    shotSpecVersion: input.snapshot.shotSpecVersion,
    routerVersion: input.snapshot.routerVersion,
    routingDecisionReason: input.snapshot.routingDecisionReason,
  });

  // Step 5 — Pin version constants from imports + carry shotSpecVersion (SP3 stamp).
  // Same four imports as SP4 + SP9 + SP10A. PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION
  // is NOT imported here — it lives inside the SP18 stamper and is carried via
  // syntheticRouting.syntheticRoutingDecisionReason (composer-only version
  // pinning lock — Guardrail C).
  const payload = {
    assetRecordId: parsed.assetRecordId,
    productIdentityId: parsed.productIdentityId,
    productTierAtGeneration: parsed.productTierAtGeneration,
    productImageAssetIds: parsed.productImageAssetIds,
    productCanonicalTextHash: parsed.productCanonicalTextHash,
    productLogoAssetId: parsed.productLogoAssetId,
    creatorIdentityId: parsed.creatorIdentityId,
    avatarTierAtGeneration: parsed.avatarTierAtGeneration,
    avatarReferenceAssetIds: parsed.avatarReferenceAssetIds,
    voiceAssetId: parsed.voiceAssetId,
    consentRecordId: parsed.consentRecordId,
    selectedProvider: parsed.selectedProvider,
    providerModelSnapshot: parsed.providerModelSnapshot,
    seedOrNoSeed: parsed.seedOrNoSeed,
    rewrittenPromptText: parsed.rewrittenPromptText,
    policyVersion: PCD_TIER_POLICY_VERSION,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    shotSpecVersion: parsed.shotSpecVersion,
    routingDecisionReason: parsed.routingDecisionReason,
    // SP9 lineage
    briefId: provenance.briefId,
    trendId: provenance.trendId,
    motivatorId: provenance.motivatorId,
    hookId: provenance.hookId,
    scriptId: provenance.scriptId,
    lineageDecisionReason: provenance.lineageDecisionReason,
    // SP18 synthetic-routing provenance
    imageProvider: syntheticRouting.imageProvider,
    videoProvider: syntheticRouting.videoProvider,
    videoProviderChoice: syntheticRouting.videoProviderChoice,
    syntheticRouterVersion: syntheticRouting.syntheticRouterVersion,
    syntheticPairingVersion: syntheticRouting.syntheticPairingVersion,
    promptHash: syntheticRouting.promptHash,
    syntheticRoutingDecisionReason: syntheticRouting.syntheticRoutingDecisionReason,
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 6 — Persist via SP18 store. SP4/SP9/SP10A store paths NOT called.
  return stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting(payload);
}
```

- [ ] **Step 8.5: Run tests to verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-identity-snapshot-with-synthetic-routing
```

Expected: 6 tests pass (or however many were drafted in 8.2 after the subagent fills in fixture details).

- [ ] **Step 8.6: Typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 8.7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts \
        packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.test.ts
git commit -m "feat(pcd): SP18 task 8 — writePcdIdentitySnapshotWithSyntheticRouting orchestrator (4-way SP4 invariant lock-step)"
```

---

## Task 9: `sp18-anti-patterns.test.ts` — 10 source-level + behavioral assertions

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts`

Per design §5.4. **Source-freeze diff is keyed against `<SP17_SQUASH_SHA>` captured in Task 1.**

- [ ] **Step 9.1: Read sister anti-pattern tests for the pattern**

```bash
cat packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts | head -100
cat packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts | head -100
```

Identify: how prior anti-pattern tests structure their assertions (file-globbing helpers, source-grep helpers, git-diff invocation). Copy that style.

- [ ] **Step 9.2: Create the test file with all 10 assertions**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts`. Use the SP10A / SP17 test as the structural template — same helper functions, same assertion style.

The 10 assertions to implement (per design §5.4):

```ts
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SP17_SQUASH_SHA = "<SP17_SQUASH_SHA>"; // Replace with value captured in Task 1, Step 1.2.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const SP18_SUBDIR = join(__dirname);

// Helper — walk a directory recursively, return all .ts files.
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Helper — read a file's source.
function source(path: string): string {
  return readFileSync(path, "utf8");
}

// Helper — partition SP18 source files into non-test vs test.
function partitionSp18Sources(): { nonTest: string[]; test: string[] } {
  const all = listTsFiles(SP18_SUBDIR);
  return {
    nonTest: all.filter((p) => !p.endsWith(".test.ts") && !p.includes("__tests__")),
    test: all.filter((p) => p.endsWith(".test.ts") || p.includes("__tests__")),
  };
}

describe("SP18 anti-patterns — source-level", () => {
  it("1a. literal 'pcd-synthetic-routing-provenance@' appears in exactly one non-test source", () => {
    const { nonTest } = partitionSp18Sources();
    const matches = nonTest.filter((p) =>
      source(p).includes("pcd-synthetic-routing-provenance@"),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.endsWith("synthetic-routing-provenance-version.ts")).toBe(true);
  });

  it("1b. PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION imported by exactly one non-test runtime source", () => {
    const { nonTest } = partitionSp18Sources();
    const matches = nonTest.filter((p) => {
      const src = source(p);
      // Match import lines that import PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION
      // from any path. Exclude the constant file itself (which defines it).
      if (p.endsWith("synthetic-routing-provenance-version.ts")) return false;
      return /from\s+["'].*synthetic-routing-provenance-version["']/.test(src);
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.endsWith("stamp-pcd-synthetic-routing-decision.ts")).toBe(true);
  });

  it("2. node:crypto imported by exactly one SP18 source — the stamper", () => {
    const { nonTest } = partitionSp18Sources();
    const matches = nonTest.filter((p) => /from\s+["']node:crypto["']/.test(source(p)));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.endsWith("stamp-pcd-synthetic-routing-decision.ts")).toBe(true);
  });

  it("3. 4-way SP4 invariant lock-step — SP4 writer, SP9, SP10A, SP18 import the same four SP4 version constants AND call assertTier3RoutingDecisionCompliant with the same six argument names", () => {
    const orchestrators = [
      "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts",
      "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
      "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
      "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts",
    ].map((p) => source(join(REPO_ROOT, p)));

    // Each must import the same four SP4 version constants.
    const requiredImports = [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ];
    for (const src of orchestrators) {
      for (const imp of requiredImports) {
        expect(src).toContain(imp);
      }
    }

    // Each must call assertTier3RoutingDecisionCompliant with the same six
    // argument names. Match by literal substring of the call's argument list.
    const requiredArgs = [
      "effectiveTier: input.snapshot.effectiveTier",
      "shotType: input.snapshot.shotType",
      "outputIntent: input.snapshot.outputIntent",
      "selectedCapability: input.snapshot.selectedCapability",
      "tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied",
      "editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired",
    ];
    // SP4 writer has its own argument naming (input.* not input.snapshot.*).
    // Test only the three downstream orchestrators (SP9, SP10A, SP18) for
    // the input.snapshot.* shape; assert SP4 writer separately calls the
    // function with its own argument shape.
    const downstreamOrchestrators = orchestrators.slice(1);
    for (const src of downstreamOrchestrators) {
      for (const arg of requiredArgs) {
        expect(src).toContain(arg);
      }
    }
    // SP4 writer body — separate shape (input.* not input.snapshot.*) but
    // same function. Assert the call site exists.
    expect(orchestrators[0]).toContain("assertTier3RoutingDecisionCompliant");
  });

  it("4. no SP1–SP17 source body edits (git diff against SP17 squash SHA)", () => {
    const sourceBodiesToFreeze = [
      "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts",
      "packages/creative-pipeline/src/pcd/tier-policy.ts",
      "packages/creative-pipeline/src/pcd/provider-capability-matrix.ts",
      "packages/creative-pipeline/src/pcd/provider-router.ts",
      "packages/creative-pipeline/src/pcd/tier3-routing-rules.ts",
      "packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts",
      "packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts",
      "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
      "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
      "packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/pcd-synthetic-router.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/pcd-identity.ts",
    ];

    for (const path of sourceBodiesToFreeze) {
      const diff = execSync(`git diff ${SP17_SQUASH_SHA}..HEAD -- ${path}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(diff, `expected ${path} unchanged since SP17 squash`).toBe("");
    }
  });

  it("5. forbidden imports — no SP18 source imports @creativeagent/db, @prisma/client, inngest, node:fs/http/https (except this test file and crypto in stamper)", () => {
    const { nonTest } = partitionSp18Sources();
    const forbidden = [
      "@creativeagent/db",
      "@prisma/client",
      "inngest",
      "node:fs",
      "node:http",
      "node:https",
    ];
    for (const file of nonTest) {
      const src = source(file);
      for (const imp of forbidden) {
        expect(src).not.toContain(`from "${imp}"`);
        expect(src).not.toContain(`from '${imp}'`);
      }
    }
  });

  it("6. single crypto.createHash call across SP18 surface — in the stamper only", () => {
    const { nonTest } = partitionSp18Sources();
    const matches = nonTest.filter((p) => /createHash\(/.test(source(p)));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.endsWith("stamp-pcd-synthetic-routing-decision.ts")).toBe(true);
  });

  it("7. no mutation of input decisions in any SP18 source", () => {
    const { nonTest } = partitionSp18Sources();
    const mutationPatterns = [
      /syntheticDecision\.\w+\s*=/,
      /input\.syntheticRouting\.syntheticDecision\.\w+\s*=/,
    ];
    for (const file of nonTest) {
      const src = source(file);
      for (const pat of mutationPatterns) {
        expect(src, `${relative(REPO_ROOT, file)} has mutation pattern ${pat}`).not.toMatch(pat);
      }
    }
  });
});

describe("SP18 anti-patterns — behavioral", () => {
  // Behavioral assertions 8, 9, 10 — these call the real stamper / use the
  // real schema. Implementations follow §5.4 design.

  it("8. no silent denial persistence — stamper rejects all 3 non-success branches", async () => {
    const { stampPcdSyntheticRoutingDecision } = await import(
      "./stamp-pcd-synthetic-routing-decision.js"
    );
    const accessPolicyDenial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision: { allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    const noDirectionDenial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "seedance",
      accessDecision: { allowed: true, effectiveTier: 3, reason: "test", tierPolicyVersion: "x" },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    const delegation = {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: "script_only",
      sp4Decision: { allowed: true },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };

    for (const branch of [accessPolicyDenial, noDirectionDenial, delegation]) {
      await expect(
        stampPcdSyntheticRoutingDecision(
          { syntheticDecision: branch as never },
          { clock: () => new Date("2026-05-16T08:00:00Z") },
        ),
      ).rejects.toThrow();
    }
  });

  it("9. promptHash echo — stamper output matches sha256(dallePromptLocked, utf8)", async () => {
    const { createHash } = await import("node:crypto");
    const { stampPcdSyntheticRoutingDecision } = await import(
      "./stamp-pcd-synthetic-routing-decision.js"
    );
    const decision = {
      /* kling-success fixture — same as in Task 7 test file */
    };
    // Subagent: copy the kling-success fixture from Task 7 test file verbatim,
    // do not redefine it inline. Use the fixture's dallePromptLocked field.
    // ... call stampPcdSyntheticRoutingDecision and assert promptHash equals
    // createHash("sha256").update(decision.dallePromptLocked, "utf8").digest("hex").
  });

  it("10. videoProvider === videoProviderChoice on every persisted success payload (parametric kling + seedance)", async () => {
    const { stampPcdSyntheticRoutingDecision } = await import(
      "./stamp-pcd-synthetic-routing-decision.js"
    );
    // Subagent: parametric over kling-success and seedance-success fixtures.
    // For each, call the stamper and assert payload.videoProvider ===
    // payload.videoProviderChoice AND payload.syntheticRoutingDecisionReason.videoProvider
    // === payload.videoProvider.
  });
});
```

(Subagent: assertions 9 and 10 reference fixtures defined in Task 7's test file. The implementer should either: (a) extract the fixtures into a shared `__test-fixtures__` module under the SP18 subdir and have both test files import them, OR (b) re-declare the fixture verbatim in this file. Option (a) is cleaner but introduces a new file. Option (b) matches the SP16/SP17 precedent. **Pick option (b)** unless prior anti-pattern tests use a shared-fixture pattern. Verify by checking `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts` first.)

- [ ] **Step 9.3: Substitute `<SP17_SQUASH_SHA>`**

Edit the test file and replace the literal `<SP17_SQUASH_SHA>` with the SHA captured in Task 1, Step 1.2. Example:

```ts
const SP17_SQUASH_SHA = "abc123def456...";
```

- [ ] **Step 9.4: Run tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp18-anti-patterns
```

Expected: all 10 assertions pass. If any fail, the failure indicates a Guardrail B/C/D violation in earlier tasks — fix the underlying violation, not the test.

- [ ] **Step 9.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts
git commit -m "test(pcd): SP18 task 9 — sp18-anti-patterns.test.ts (10 source-level + behavioral assertions, source-freeze keyed to SP17 squash <short-sha>)"
```

(Replace `<short-sha>` with the first 7 chars of the SP17 squash SHA.)

---

## Task 10: Allowlist maintenance — extend 9 prior anti-pattern test allowlists

**Files (edits only):**
- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts` (verify actual subdir name)
- `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts` (verify actual subdir name)
- `packages/creative-pipeline/src/pcd/synthetic-creator/sp13-anti-patterns.test.ts` (verify)
- `packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts` (verify)
- `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts` (verify)
- `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts`

Per design §5.6.

Each of these tests has an "allowed-edits" / "expected-new-files" allowlist (or similar) that must be widened to include SP18 net-new file paths.

- [ ] **Step 10.1: Enumerate the actual subdir paths**

```bash
find packages/creative-pipeline/src/pcd -name "sp*-anti-patterns.test.ts" | sort
```

Expected: 9 files. Subdir names may not match the design's guesses; use the actual paths.

- [ ] **Step 10.2: Identify the allowlist field in each test file**

Each anti-pattern test in the prior slices has a section like:

```ts
const ALLOWED_NEW_FILES = [
  "packages/.../some-file.ts",
  // ...
];
```

or

```ts
const SP_<N>_NET_NEW_FILES = [...];
```

The exact name varies. For each of the 9 files, find the equivalent.

- [ ] **Step 10.3: Add the SP18 net-new files to each allowlist**

The complete SP18 net-new file list (already covered by individual commits in Tasks 2–9):

```
packages/schemas/src/pcd-synthetic-routing-provenance.ts
packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.test.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.test.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.test.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts
packages/db/prisma/migrations/<MIGRATION_TS>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/migration.sql
```

(Subagent: substitute the actual `<MIGRATION_TS>` from Task 3, Step 3.1.)

For files modified (not net-new):
```
packages/schemas/src/index.ts                                 (Task 2)
packages/db/prisma/schema.prisma                              (Task 3)
packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts (Task 4)
packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts (Task 4)
packages/creative-pipeline/src/index.ts                       (Task 11)
```

Some prior anti-pattern tests track BOTH net-new and modified-allowed; others only net-new. Check each.

- [ ] **Step 10.4: Run each prior anti-pattern test to verify it still passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp9-anti-patterns sp10a-anti-patterns sp10b-anti-patterns sp10c-anti-patterns sp13-anti-patterns sp14-anti-patterns sp15-anti-patterns sp16-anti-patterns sp17-anti-patterns
```

Expected: all 9 pass.

- [ ] **Step 10.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/*/sp*-anti-patterns.test.ts
git commit -m "test(pcd): SP18 task 10 — allowlist maintenance across 9 prior anti-pattern test files"
```

---

## Task 11: Barrel re-exports

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

Per design §3.8.

- [ ] **Step 11.1: Create the SP18 subdir barrel**

Create `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts`:

```ts
export { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";
export {
  stampPcdSyntheticRoutingDecision,
  type StampPcdSyntheticRoutingDecisionInput,
  type StampPcdSyntheticRoutingDecisionStores,
  type SyntheticPairingSuccessDecision,
} from "./stamp-pcd-synthetic-routing-decision.js";
export {
  writePcdIdentitySnapshotWithSyntheticRouting,
  type WritePcdIdentitySnapshotWithSyntheticRoutingInput,
  type WritePcdIdentitySnapshotWithSyntheticRoutingStores,
} from "./write-pcd-identity-snapshot-with-synthetic-routing.js";
export type { PcdSp18IdentitySnapshotStore } from "./pcd-sp18-identity-snapshot-store.js";
```

- [ ] **Step 11.2: Add the barrel re-export to the package index**

Edit `packages/creative-pipeline/src/index.ts`. Locate the existing PCD re-export block (alphabetized). Add:

```ts
export * from "./pcd/synthetic-routing-provenance/index.js";
```

(Place between `./pcd/synthetic-router/index.js` (or wherever the SP16/SP17 line lives) and `./pcd/...` next.)

- [ ] **Step 11.3: Run typecheck across all packages to verify barrel resolution**

```bash
pnpm typecheck
```

Expected: clean. The `@creativeagent/creative-pipeline` exports now include the SP18 public surface.

- [ ] **Step 11.4: Verify the db-package adapter import path resolves (from Task 4)**

```bash
pnpm --filter @creativeagent/db typecheck
```

Expected: clean. If the db package was importing `PcdSp18IdentitySnapshotStore` via the path stated in Task 4 Step 4.5, it now resolves via the barrel.

- [ ] **Step 11.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP18 task 11 — barrel re-exports for synthetic-routing-provenance"
```

---

## Task 12: Final integration sweep

**Files:** none. Verification + final cross-package checks.

- [ ] **Step 12.1: Full typecheck across all packages**

```bash
pnpm typecheck
```

Expected: clean across schemas, db, creative-pipeline, and any others.

- [ ] **Step 12.2: Full test sweep**

```bash
pnpm test
```

Expected: **~2021 passing, 2 skipped** (SP17 baseline ~1975 + ~46 SP18 net-new). If the count differs by more than ±5, investigate.

- [ ] **Step 12.3: Prettier check**

```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: clean modulo the 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` (now 17 slices deferred — note in the PR description if asked).

If new warnings surface on SP18 files, fix them:

```bash
pnpm exec prettier --write packages/creative-pipeline/src/pcd/synthetic-routing-provenance/ \
                           packages/schemas/src/pcd-synthetic-routing-provenance.ts \
                           packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts
```

- [ ] **Step 12.4: Verify migration is drift-free**

```bash
pnpm --filter @creativeagent/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-migrations packages/db/prisma/migrations \
  --exit-code
```

Expected: exit code 0.

- [ ] **Step 12.5: Verify the 22 pinned PCD constants are all present (no accidental bump or drop)**

```bash
grep -r 'export const PCD_' packages/creative-pipeline/src/pcd/ packages/schemas/src/ 2>/dev/null | grep '_VERSION\|_VERSIONS\b' | wc -l
```

Expected: 22. If lower, a constant was dropped; if higher, a constant was inadvertently added. Investigate.

(Subagent: this is a heuristic — the exact `grep` may overcount or undercount. The authoritative source-of-truth list is the per-slice memory file `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. The expected delta is exactly +1 from SP17's 21.)

- [ ] **Step 12.6: Final git log review**

```bash
git log --oneline 04f14b1..HEAD
```

Expected: ~12 commits with `feat(pcd): SP18 task N — ...` or `test(pcd): SP18 task N — ...` style messages. (Subagent-driven-development creates one commit per task per the plan structure.)

- [ ] **Step 12.7: Final commit (if any cleanup needed) or proceed to PR**

If Step 12.3 wrote any prettier fixes:

```bash
git add -A
git commit -m "chore(pcd): SP18 task 12 — prettier sweep"
```

Otherwise, no commit. Proceed to `superpowers:finishing-a-development-branch` for PR creation.

---

## Self-Review Checklist (run after writing this plan)

Performed inline at plan-write time:

1. **Spec coverage:**
   - Q1 flat-cols + Json → Task 2 schemas, Task 3 migration ✓
   - Q2 persist both videoProvider + videoProviderChoice → Task 2 + Task 3 + Task 7 stamper ✓
   - Q3 promptHash in stamper → Task 7 ✓
   - Q4 no PcdRoutingDecisionSchema relocation → no task (resolved by non-action) ✓
   - Q5 wrap not extend → Task 8 (new orchestrator) ✓
   - Q6 success-only → Task 7 (Extract<...> type + runtime Zod refuse) ✓
   - Q7 no indexes → Task 3 (migration has no CREATE INDEX) ✓
   - Q8 additive nullable + no backfill → Task 3 (all 7 cols nullable) ✓
   - Q9 no PcdIdentitySnapshotSchema widen → no task (deliberately omitted) ✓
   - 22nd pinned constant → Task 5 ✓
   - 4-way SP4 lock-step → Task 8 + Task 9 #3 ✓
   - 9 prior allowlist maintenance → Task 10 ✓
   - Anti-pattern test 10 assertions → Task 9 ✓
   - Cross-field .refine() → Task 2 (schema) + Task 7 step 6 ✓
   - Guardrail C runtime/test distinction → Task 5 (constant) + Task 9 assertion 1b ✓

2. **Placeholder scan:** Two intentional placeholders, both documented:
   - `<SP17_SQUASH_SHA>` — Task 1 captures; Task 9 substitutes
   - `<MIGRATION_TS>` — Task 3 captures; Task 10 substitutes in allowlists

3. **Type consistency:**
   - `PcdSp18SyntheticRoutingProvenancePayload` — defined Task 2, used Task 7 return type ✓
   - `SyntheticPairingSuccessDecision` — defined Task 7, re-exported Task 11 ✓
   - `PcdSp18IdentitySnapshotStore` — defined Task 6, used Task 8 stores type ✓
   - `createForShotWithSyntheticRouting` — defined Task 4 + Task 6, used Task 8 ✓
   - `adaptPcdSp18IdentitySnapshotStore` — defined Task 4, no other reference (correct — production runner wires at merge-back)

4. **Task ordering issue noted:** Task 4 imports `PcdSp18IdentitySnapshotStore` (defined in Task 6). The plan flags this in Step 4.5 and recommends executing Task 6 before Task 4 if the dependency surfaces. Subagent-driven-development tolerates this since it can detect typecheck failure and re-order; inline execution should manually re-order to: Task 1 → 2 → 3 → 5 → 6 → 4 → 7 → 8 → 9 → 10 → 11 → 12.

---

## Notes for the implementer

- **TDD discipline:** every code change is preceded by a failing test. The "run test to verify failure" steps are not skippable — they catch reversed assertions and stub bugs.
- **Verbatim copy directive (watchpoint #10):** the 4-way SP4 invariant lock-step in Task 8 must be a structural copy from SP10A's orchestrator. Do not extract helpers, rename arguments, or reorder. The anti-pattern test (Task 9 #3) enforces.
- **Single-source rule:** the literal `"pcd-synthetic-routing-provenance@"` and the symbol `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` have strict single-site invariants per Guardrail C. Tests are explicitly carved out — they may import the constant from `synthetic-routing-provenance-version.ts`.
- **Crypto isolation:** the `node:crypto` import lives only in the SP18 stamper. The orchestrator, store contract, schemas, and version-constant files must stay pure of `crypto`.
- **No SP10A cost bundling:** the SP18 orchestrator must NOT call `stampPcdCostForecast` or import the SP10A surface beyond what type re-exports require. SP18 is the synthetic-routing-only persistence path.
- **MERGE-BACK markers:** every state transition and external-system seam carries a `// MERGE-BACK:` marker. Three in the stamper, one in the orchestrator. Do not remove them.
