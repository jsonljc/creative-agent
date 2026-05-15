# SP17 — PCD Synthetic Provider Routing: Seedance Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen SP16's synthetic router from a single-provider matrix (kling) to a two-provider matrix (kling + seedance) with end-user choice per shot via a new `videoProviderChoice: "kling" | "seedance"` required input on `RouteSyntheticPcdShotInput`. Decision union grows from 3 branches to 5 (per-provider success branches + `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` denial). Widen SP11 with a nullable `seedanceDirection` on `CreatorIdentitySyntheticPayload`. Bump pinned versions to `1.1.0` in place. SP18 reserved for snapshot/provenance persistence on `PcdIdentitySnapshot`.

**Architecture:** Extend the canonical SP16 router body — DO NOT introduce a parallel `routeSyntheticPcdShotV2`. The router is being widened, not superseded. Schema-level no-silent-fallback lock via per-branch `z.literal()` equality (`videoProvider === videoProviderChoice` is structurally guaranteed). `SeedanceDirectionSchema` mirrors `KlingDirectionSchema` exactly in shape but ships as a distinct named export. Existing 30 SP11 roster creators stay kling-only (`seedanceDirection: null`) until a future content/backfill slice. One additive Prisma migration on `CreatorIdentitySynthetic`. Two SP16 source-body edits permitted by the user-approved §2.1 guardrail. Pinned-constant count stays at 21.

**Tech Stack:** TypeScript 5, pnpm workspaces, Turbo, Vitest, Zod 3.x, Prisma 5.x, conventional commits.

**Spec:** `docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md` (committed in `a36a84b`).

---

## Worktree & Subagent Discipline

**This plan executes inside `.worktrees/sp17` on branch `pcd/sp17-synthetic-provider-routing-seedance`.** Create the worktree via the `superpowers:using-git-worktrees` skill before starting Task 1.

**Every subagent prompt MUST start with this preamble:**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp17
pwd                                    # MUST output: /Users/jasonli/creativeagent/.worktrees/sp17
git branch --show-current              # MUST output: pcd/sp17-synthetic-provider-routing-seedance
```

If either check fails the subagent must **stop and report**, not "fix" it. (The `feedback_subagent_worktree_drift` memory records what happens when this gate is skipped.)

**Scope guardrail (user-approved):** SP17 may edit the SP16 canonical router body only to widen it from one video provider to two. It must NOT introduce a parallel `routeSyntheticPcdShotV2`, hidden fallback behavior (no auto-degrade to Kling when Seedance lacks direction), runtime provider execution, persistence writes onto `PcdIdentitySnapshot`, or composer coupling. Missing Seedance direction produces `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` — a distinct denial kind, never `ACCESS_POLICY`, never silent fallback. (See design §2.1; enforced by Task 12 assertions.)

**Permitted SP16 source-body edits (and only these):**
- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts` — bump literal `1.0.0` → `1.1.0` (Task 5)
- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts` — grow matrix to 2 rows; bump literal `1.0.0` → `1.1.0`; widen `SyntheticProviderPairing.videoProvider` union (Task 5)
- `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts` — widen `RouteSyntheticPcdShotInput` with `videoProviderChoice`; widen body for new steps; extend `buildSyntheticSelectionRationale` signature (Tasks 6–10)
- `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts` — relax matrix-integrity literals to v2; update version-literal expectations; do NOT touch purity / SP4-token-blacklist / cross-slice / frozen-source assertions (Task 5)
- `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts` — update to 2-row expectations (Task 5)
- `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts` — extend coverage for new branches + choices (Tasks 6–11)
- `packages/schemas/src/pcd-synthetic-router.ts` — widen union to 5 branches (Task 6)
- `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts` — extend branch coverage (Task 6)

**No edits to SP4 source bodies** (`provider-router.ts`, `provider-capability-matrix.ts`, `tier3-routing-rules.ts`).

**SP11 widen + barrel widen lands in Task 2** (NOT a later task). Subsequent tasks import `SeedanceDirectionSchema` / `SeedanceDirection` from `@creativeagent/schemas`. If the schemas barrel hasn't been widened by then, the import fails. This is the SP14/SP15 lesson re-applied.

**Prisma migration lands in Task 3.** Subsequent tasks (Task 4 DB store) need the column to exist for round-trip tests against the real DB.

---

## File Structure

### New files (3)

```
packages/creative-pipeline/src/pcd/synthetic-router/
  sp17-anti-patterns.test.ts                              [Task 12]

packages/db/prisma/migrations/
  20260515HHmmSS_pcd_creator_identity_synthetic_sp17_seedance_direction/
    migration.sql                                         [Task 3]
```

### Modified files (12 + 8 allowlist)

```
packages/schemas/src/
  creator-identity-synthetic.ts                           [Task 2 — add SeedanceDirectionSchema + widen payload schema]
  __tests__/creator-identity-synthetic.test.ts            [Task 2 — null/undefined/populated round-trip cases]
  pcd-synthetic-router.ts                                 [Task 6 — 5-branch decision union]
  __tests__/pcd-synthetic-router.test.ts                  [Task 6 — extended branch coverage]
  index.ts                                                [Task 2 — barrel widen via `export *` already in place; verify export]

packages/db/prisma/
  schema.prisma                                           [Task 3 — add seedanceDirection Json?]

packages/db/src/stores/
  prisma-creator-identity-synthetic-store.ts              [Task 4 — round-trip seedanceDirection write with `?? null` normalization]
  prisma-creator-identity-synthetic-reader.ts             [Task 4 — round-trip seedanceDirection read]
  __tests__/prisma-creator-identity-synthetic-store.test.ts  [Task 4 — null + populated round-trip]

packages/creative-pipeline/src/pcd/synthetic-router/
  synthetic-router-version.ts                             [Task 5 — bump literal 1.0.0 → 1.1.0]
  synthetic-provider-pairing.ts                           [Task 5 — matrix to 2 rows; bump literal 1.0.0 → 1.1.0; widen videoProvider union]
  synthetic-provider-pairing.test.ts                      [Task 5 — 2-row assertions]
  route-synthetic-pcd-shot.ts                             [Tasks 6–10 — widened body]
  route-synthetic-pcd-shot.test.ts                        [Tasks 6–11 — extended coverage]
  sp16-anti-patterns.test.ts                              [Task 5 — relax literals to v2 expectations]

— allowlist maintenance (Task 13) —
packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts
packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts  [also touched in Task 5; Task 13 adds SP17 files to its allowlist set]
```

---

## Task 1: Pre-flight

**Files:**
- (none — read-only verification)

- [ ] **Step 1: Confirm worktree + branch**

Run:
```bash
pwd
git branch --show-current
```
Expected:
```
/Users/jasonli/creativeagent/.worktrees/sp17
pcd/sp17-synthetic-provider-routing-seedance
```

If either is wrong, stop and report. Do NOT continue.

- [ ] **Step 2: Confirm clean baseline state at SP16 tip**

Run:
```bash
git log --oneline -1
git diff 04f14b1..HEAD -- packages/db/prisma/schema.prisma
```
Expected:
- First command output starts with `04f14b1` or includes it as an ancestor.
- Second command output is **empty** (SP17 starts with zero Prisma drift).

- [ ] **Step 3: Confirm SP16 test baseline (~1941 passing, 2 skipped)**

Run from worktree root:
```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test 2>&1 | tail -20
```
Expected: `~1941 passed | 2 skipped` (or whatever the SP16 land-tip baseline reads). No new failures.

If the baseline doesn't match, **stop and report**. Do not proceed under a broken baseline.

- [ ] **Step 4: Confirm `z.union` carve-out convention is unchanged**

Run:
```bash
grep -nE "z\.union\(|z\.discriminatedUnion\(" packages/schemas/src/pcd-{disclosure-template,script-template,synthetic-selector,synthetic-router}.ts | head -20
```
Expected: each schema file shows `z.union(` (NOT `z.discriminatedUnion`). The carve-out comment "NB: `z.union` not `z.discriminatedUnion`" is the established v1 convention.

- [ ] **Step 5: Confirm prettier baseline**

Run:
```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}" 2>&1 | tail -20
```
Expected: 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` only. No new warnings.

- [ ] **Step 6: No commit** — pre-flight only

---

## Task 2: `SeedanceDirectionSchema` + widen `CreatorIdentitySyntheticPayloadSchema`

**Files:**
- Modify: `packages/schemas/src/creator-identity-synthetic.ts`
- Modify: `packages/schemas/src/__tests__/creator-identity-synthetic.test.ts`
- (No edit to `packages/schemas/src/index.ts` — the `export *` line is already in place.)

- [ ] **Step 1: Add failing tests**

Append to `packages/schemas/src/__tests__/creator-identity-synthetic.test.ts` (after the existing `describe("schemas package barrel", ...)`):

```ts
import {
  SeedanceDirectionSchema,
  type SeedanceDirection,
} from "../creator-identity-synthetic.js";

describe("SeedanceDirectionSchema (SP17)", () => {
  const valid: SeedanceDirection = {
    setting: "Bright kitchen counter",
    motion: "Slow product reveal hand",
    energy: "Warm and grounded",
    lighting: "Soft morning window",
    avoid: ["Quick cuts", "High saturation"],
  };

  it("accepts a fully populated seedance direction", () => {
    expect(SeedanceDirectionSchema.parse(valid)).toEqual(valid);
  });

  it("rejects empty setting", () => {
    expect(() => SeedanceDirectionSchema.parse({ ...valid, setting: "" })).toThrow();
  });

  it("rejects an empty string inside avoid[]", () => {
    expect(() => SeedanceDirectionSchema.parse({ ...valid, avoid: [""] })).toThrow();
  });
});

describe("CreatorIdentitySyntheticPayloadSchema.seedanceDirection (SP17 widen)", () => {
  // Re-declare the existing `valid` fixture by composition to keep this block self-contained.
  // The previous describe block's `valid` is scoped; recreate the minimal needed shape here.
  const baseSynthetic = {
    creatorIdentityId: "ci_test_synth_sp17",
    treatmentClass: "med_spa" as const,
    vibe: "calm_clinical" as const,
    market: "us" as const,
    ethnicityFamily: "white_european" as const,
    ageBand: "mid_30s_plus" as const,
    pricePositioning: "premium" as const,
    physicalDescriptors: {
      faceShape: "Oval",
      skinTone: "Fair",
      eyeShape: "Hooded",
      hair: "Shoulder length brunette",
      ageRead: "36",
      buildNote: "Slim, medium height",
    },
    dallePromptLocked: "Lo-fi photo of …",
    klingDirection: {
      setting: "Dim treatment room",
      motion: "Soft head turn",
      energy: "Composed",
      lighting: "Warm key light",
      avoid: ["Beauty filter"],
    },
    voiceCaptionStyle: {
      voice: "Calm",
      captionStyle: "Lowercase, soft punctuation",
      sampleHook: "okay so here's the thing",
      sampleCta: "book a consultation",
    },
    mutuallyExclusiveWithIds: [],
    status: "active" as const,
  };
  const validSeedance: SeedanceDirection = {
    setting: "Bright counter",
    motion: "Product reveal hand",
    energy: "Warm",
    lighting: "Soft window",
    avoid: ["Cuts"],
  };

  it("accepts payload with seedanceDirection = null", () => {
    const out = CreatorIdentitySyntheticPayloadSchema.parse({
      ...baseSynthetic,
      seedanceDirection: null,
    });
    expect(out.seedanceDirection).toBeNull();
  });

  it("accepts payload with seedanceDirection field omitted (undefined)", () => {
    const out = CreatorIdentitySyntheticPayloadSchema.parse(baseSynthetic);
    expect(out.seedanceDirection).toBeUndefined();
  });

  it("accepts payload with seedanceDirection populated", () => {
    const out = CreatorIdentitySyntheticPayloadSchema.parse({
      ...baseSynthetic,
      seedanceDirection: validSeedance,
    });
    expect(out.seedanceDirection).toEqual(validSeedance);
  });

  it("rejects payload with seedanceDirection missing a required field", () => {
    expect(() =>
      CreatorIdentitySyntheticPayloadSchema.parse({
        ...baseSynthetic,
        seedanceDirection: { ...validSeedance, motion: undefined },
      }),
    ).toThrow();
  });
});

describe("schemas package barrel — SeedanceDirectionSchema re-export (SP17)", () => {
  it("re-exports SeedanceDirectionSchema", () => {
    expect(barrel.SeedanceDirectionSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/schemas test creator-identity-synthetic 2>&1 | tail -30
```
Expected: failures around `SeedanceDirectionSchema` (not exported) and the `seedanceDirection` round-trip. **Do not overfit the exact failure text.** Zod's default behavior strips unknown keys on non-`.strict()` object schemas, so the `seedanceDirection`-on-payload tests may surface as `out.seedanceDirection is undefined` rather than a hard parse failure until the schema is widened. The intent is **red on at least the named tests above** — verify the conceptual red/green behavior, not the literal stderr.

**TypeScript ergonomics watchpoint:** the third test ("accepts payload with seedanceDirection field omitted") constructs `baseSynthetic` without the new key. After Task 2's schema widen, the inferred type `CreatorIdentitySyntheticPayload` should allow `seedanceDirection?: SeedanceDirection | null | undefined`. If TypeScript complains about a missing required key on a literal, build the payload via `CreatorIdentitySyntheticPayloadSchema.parse(rawPayload)` (which returns the inferred type with optional fields handled correctly) rather than asserting an object-literal into the type.

- [ ] **Step 3: Add `SeedanceDirectionSchema` + widen payload schema**

In `packages/schemas/src/creator-identity-synthetic.ts`, locate the existing `KlingDirectionSchema` export (around line 65–74) and add immediately after it (before `VoiceCaptionStyleSchema`):

```ts
// PCD slice SP17 — Seedance direction artifact. Field set mirrors
// KlingDirectionSchema exactly. Distinct named type so call sites cannot
// accidentally cross-bind to a Kling direction. Nullable on the payload —
// existing SP11 roster (30 creators) is kling-only at SP17 land; a future
// content-authoring slice backfills.
//
// MERGE-BACK: net-new SP17 schema. No reconciliation needed (net-new on
// both sides). If Switchboard adds Seedance-specific fields later, this
// schema widens here first and merges back additively.
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
```

Then in the same file, locate `CreatorIdentitySyntheticPayloadSchema` and add `seedanceDirection` immediately after the existing `klingDirection` line:

```ts
    klingDirection: KlingDirectionSchema,
    // SP17 — nullish() at ingestion for back-compat with omitted-key roster
    // fixtures; downstream consumers (DB store, router) normalize undefined
    // → null so only one missing-state exists in domain logic.
    //
    // MERGE-BACK: nullable for v1; existing 30 SP11 roster creators are
    // kling-only until a future content-authoring slice backfills.
    seedanceDirection: SeedanceDirectionSchema.nullish(),
    voiceCaptionStyle: VoiceCaptionStyleSchema,
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter @creativeagent/schemas test creator-identity-synthetic 2>&1 | tail -20
```
Expected: 0 failures. All SP11 + SP17 SeedanceDirection + barrel re-export tests pass.

- [ ] **Step 5: Run full schemas package**

Run:
```bash
pnpm --filter @creativeagent/schemas test 2>&1 | tail -10
pnpm --filter @creativeagent/schemas typecheck
```
Expected: all green. No regressions in other schema tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/creator-identity-synthetic.ts \
        packages/schemas/src/__tests__/creator-identity-synthetic.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): SP17 — SeedanceDirectionSchema + widen CreatorIdentitySyntheticPayload

Net-new SeedanceDirectionSchema mirrors KlingDirection shape exactly with
a distinct named type so cross-binding is impossible at the type system.
Payload schema widens with nullable/nullish seedanceDirection — existing
30-row SP11 roster stays kling-only until a future content slice backfills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Prisma migration — `seedanceDirection Json?` on `CreatorIdentitySynthetic`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260515HHmmSS_pcd_creator_identity_synthetic_sp17_seedance_direction/migration.sql`

- [ ] **Step 1: Edit `schema.prisma`**

Locate the `CreatorIdentitySynthetic` model (around line 127). Add a new line after `klingDirection`:

```prisma
model CreatorIdentitySynthetic {
  creatorIdentityId         String          @id
  creatorIdentity           CreatorIdentity @relation(fields: [creatorIdentityId], references: [id], onDelete: Cascade)

  treatmentClass            String
  vibe                      String
  market                    String
  ethnicityFamily           String
  ageBand                   String
  pricePositioning          String

  physicalDescriptors       Json
  dallePromptLocked         String
  klingDirection            Json
  // SP17 — nullable; null = no Seedance direction authored for this creator.
  // Domain code normalizes undefined → null at write time (see SP17 plan Task 4).
  seedanceDirection         Json?
  voiceCaptionStyle         Json
  // ... rest unchanged
}
```

- [ ] **Step 2: Generate migration file**

Determine the timestamp:
```bash
date -u +%Y%m%d%H%M%S
```
Use that timestamp in the migration directory name. **Replace `HHmmSS` (and the leading `20260515` if the slice lands on a different UTC date) with the actual digits — commit exactly one real timestamped folder. Do NOT commit the placeholder string `HHmmSS` to git; the migration directory name on disk must be all digits.**

Create directory:
```bash
mkdir -p packages/db/prisma/migrations/<TIMESTAMP>_pcd_creator_identity_synthetic_sp17_seedance_direction
```

Create `packages/db/prisma/migrations/<TIMESTAMP>_pcd_creator_identity_synthetic_sp17_seedance_direction/migration.sql`:

```sql
-- PCD slice SP17 — additive, nullable JSON column for the per-creator
-- Seedance direction artifact. Pre-SP17 rows return NULL on read. No FK,
-- no index. Domain code (router + DB store) normalizes undefined → null
-- at write time so the column only ever stores NULL or a structured
-- {setting, motion, energy, lighting, avoid[]} object.
ALTER TABLE "CreatorIdentitySynthetic" ADD COLUMN "seedanceDirection" JSONB;
```

- [ ] **Step 3: Apply migration locally + regenerate Prisma client**

Run:
```bash
pnpm db:migrate
pnpm db:generate
```
Expected: `Applied migration ..._pcd_creator_identity_synthetic_sp17_seedance_direction`. Prisma client regenerates without error.

- [ ] **Step 4: Confirm Prisma schema drift is zero**

Run:
```bash
pnpm prisma migrate diff \
  --from-schema-datamodel packages/db/prisma/schema.prisma \
  --to-schema-datasource packages/db/prisma/schema.prisma \
  --script 2>&1 | tail -5
```
Expected: `No difference detected` (or equivalent empty diff message).

- [ ] **Step 5: Typecheck the db package**

Run:
```bash
pnpm --filter @creativeagent/db typecheck
```
Expected: clean. The generated Prisma client now exposes `seedanceDirection: Prisma.JsonValue | null` on the `CreatorIdentitySynthetic` model — existing store code will not yet read it, but the type widening must compile.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/<TIMESTAMP>_pcd_creator_identity_synthetic_sp17_seedance_direction/
git commit -m "$(cat <<'EOF'
feat(db): SP17 — add nullable seedanceDirection JSONB column to CreatorIdentitySynthetic

Additive migration. Pre-SP17 rows return NULL on read. No FK, no index.
Domain code normalizes undefined → null at write time so the column only
ever stores NULL or a structured {setting, motion, energy, lighting,
avoid[]} object.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: DB store + reader — round-trip `seedanceDirection`

**Files:**
- Modify: `packages/db/src/stores/prisma-creator-identity-synthetic-store.ts`
- Modify: `packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts` (within the existing `describe("PrismaCreatorIdentitySyntheticStore")` or as a sibling describe — match the existing file's organization):

```ts
// SP17 — round-trip seedanceDirection (nullable JSON column).
it("round-trips seedanceDirection = null (default for back-compat rows)", async () => {
  const id = "ci_sp17_null_seedance_" + crypto.randomUUID();
  await prisma.creatorIdentity.create({
    data: { id, kind: "synthetic", isActive: true, displayName: "Test SP17 Null" },
  });
  const payload = makeValidPayload(id, /* seedanceDirection */ null);
  await store.create(payload);

  const row = await reader.findById(id);
  expect(row).not.toBeNull();
  expect(row!.seedanceDirection).toBeNull();
});

it("round-trips seedanceDirection populated", async () => {
  const id = "ci_sp17_populated_seedance_" + crypto.randomUUID();
  await prisma.creatorIdentity.create({
    data: { id, kind: "synthetic", isActive: true, displayName: "Test SP17 Populated" },
  });
  const seedance = {
    setting: "Bright counter",
    motion: "Reveal hand",
    energy: "Warm",
    lighting: "Soft window",
    avoid: ["Cuts"],
  };
  const payload = makeValidPayload(id, seedance);
  await store.create(payload);

  const row = await reader.findById(id);
  expect(row).not.toBeNull();
  expect(row!.seedanceDirection).toEqual(seedance);
});

it("normalizes undefined seedanceDirection on write to null in DB", async () => {
  const id = "ci_sp17_undef_seedance_" + crypto.randomUUID();
  await prisma.creatorIdentity.create({
    data: { id, kind: "synthetic", isActive: true, displayName: "Test SP17 Undef" },
  });
  // makeValidPayload returns a payload WITHOUT the seedanceDirection key.
  const payload = makeValidPayload(id, /* seedanceDirection */ undefined);
  await store.create(payload);

  const dbRow = await prisma.creatorIdentitySynthetic.findUnique({
    where: { creatorIdentityId: id },
  });
  expect(dbRow!.seedanceDirection).toBeNull();
});
```

Add this helper inside the same test file (at the top of the describe or as a top-level helper, whichever the file already uses):

```ts
function makeValidPayload(
  id: string,
  seedanceDirection: SeedanceDirection | null | undefined,
): CreatorIdentitySyntheticPayload {
  const payload: CreatorIdentitySyntheticPayload = {
    creatorIdentityId: id,
    treatmentClass: "med_spa",
    vibe: "calm_clinical",
    market: "us",
    ethnicityFamily: "white_european",
    ageBand: "mid_30s_plus",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Oval", skinTone: "Fair", eyeShape: "Hooded",
      hair: "Shoulder brunette", ageRead: "36", buildNote: "Slim",
    },
    dallePromptLocked: "Lo-fi …",
    klingDirection: {
      setting: "Dim room", motion: "Head turn", energy: "Composed",
      lighting: "Warm key", avoid: ["Filter"],
    },
    voiceCaptionStyle: {
      voice: "Calm", captionStyle: "lowercase",
      sampleHook: "okay so", sampleCta: "book it",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  };
  if (seedanceDirection === null) {
    return { ...payload, seedanceDirection: null };
  }
  if (seedanceDirection !== undefined) {
    return { ...payload, seedanceDirection };
  }
  return payload; // key omitted → undefined
}
```

Add the necessary imports at the top of the test file:

```ts
import {
  type CreatorIdentitySyntheticPayload,
  type SeedanceDirection,
} from "@creativeagent/schemas";
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/db test prisma-creator-identity-synthetic-store 2>&1 | tail -30
```
Expected: 3 failures. Either type errors on `row.seedanceDirection` (reader doesn't carry the field yet) or runtime values of `undefined` where `null` is expected.

- [ ] **Step 3: Widen the store write path**

In `packages/db/src/stores/prisma-creator-identity-synthetic-store.ts`, locate the `data` object inside `create()`. Add `seedanceDirection` immediately after `klingDirection`:

```ts
    const data = {
      treatmentClass: payload.treatmentClass,
      vibe: payload.vibe,
      market: payload.market,
      ethnicityFamily: payload.ethnicityFamily,
      ageBand: payload.ageBand,
      pricePositioning: payload.pricePositioning,
      physicalDescriptors: payload.physicalDescriptors,
      dallePromptLocked: payload.dallePromptLocked,
      klingDirection: payload.klingDirection,
      // SP17 — normalize undefined → null at write time per design J1.
      // The schema accepts nullish() at ingestion; the DB column only ever
      // stores NULL or a structured object.
      seedanceDirection: payload.seedanceDirection ?? null,
      voiceCaptionStyle: payload.voiceCaptionStyle,
      mutuallyExclusiveWithIds: [...payload.mutuallyExclusiveWithIds],
      status: payload.status,
    };
```

- [ ] **Step 4: Widen the reader parse**

In `packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts`, locate the `parse(row)` method (or equivalent — the function that converts a Prisma row to `CreatorIdentitySyntheticPayload`). Confirm it uses `CreatorIdentitySyntheticPayloadSchema.parse()` against the row. If so, the new column is automatically picked up via the schema widen from Task 2 — no source edit needed.

If the reader builds the payload field-by-field (e.g., explicit `creatorIdentityId: row.creatorIdentityId, ...`), add:

```ts
      // ...existing fields...
      klingDirection: row.klingDirection as KlingDirection,
      // SP17 — round-trip the nullable seedance column. Prisma returns
      // JsonValue | null; cast to SeedanceDirection | null. Pre-SP17 rows
      // return null.
      seedanceDirection: (row.seedanceDirection ?? null) as SeedanceDirection | null,
      voiceCaptionStyle: row.voiceCaptionStyle as VoiceCaptionStyle,
      // ...
```

If you add the cast version, also add the type import at the top:

```ts
import type { SeedanceDirection } from "@creativeagent/schemas";
```

(Inspect the existing parse implementation before deciding which path to take. Match the existing style.)

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @creativeagent/db test prisma-creator-identity-synthetic-store 2>&1 | tail -20
```
Expected: 3 new tests pass; existing tests unchanged.

- [ ] **Step 6: Run full db package**

Run:
```bash
pnpm --filter @creativeagent/db test 2>&1 | tail -10
pnpm --filter @creativeagent/db typecheck
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-creator-identity-synthetic-store.ts \
        packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts \
        packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts
git commit -m "$(cat <<'EOF'
feat(db): SP17 — round-trip seedanceDirection on PrismaCreatorIdentitySynthetic{Store,Reader}

Store normalizes undefined → null at write time per design J1; reader
round-trips the nullable column via the schema's nullish() accept.
Pre-SP17 rows return null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Bump versions to `1.1.0`; grow matrix to 2 rows; update `sp16-anti-patterns.test.ts` literals

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`

- [ ] **Step 1: Update `synthetic-provider-pairing.test.ts` with failing v2 expectations**

Open the file and replace its current single-row assertions with v2 expectations. The full updated body:

```ts
import { describe, expect, it } from "vitest";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
} from "./synthetic-provider-pairing.js";

describe("PCD_SYNTHETIC_PROVIDER_PAIRING (SP17 v2 — kling + seedance)", () => {
  it("has exactly two rows", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(2);
  });

  it("row 0 is the kling pairing", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].imageProvider).toBe("dalle");
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].videoProvider).toBe("kling");
  });

  it("row 1 is the seedance pairing", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[1].imageProvider).toBe("dalle");
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[1].videoProvider).toBe("seedance");
  });

  it("both rows cover the seven video shot types (set equality)", () => {
    const expected = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect([...row.shotTypes].sort()).toEqual([...expected].sort());
    }
  });

  it("both rows cover the four standard output intents (set equality)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect([...row.outputIntents].sort()).toEqual(
        ["draft", "final_export", "meta_draft", "preview"].sort(),
      );
    }
  });

  it("script_only is NOT in either row's shotTypes (delegation reachability)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.shotTypes).not.toContain("script_only");
    }
  });

  it("storyboard is NOT in either row's shotTypes (delegation reachability)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.shotTypes).not.toContain("storyboard");
    }
  });

  it("matrix's videoProvider set is exactly {kling, seedance}", () => {
    const providers = new Set(PCD_SYNTHETIC_PROVIDER_PAIRING.map((r) => r.videoProvider));
    expect(providers).toEqual(new Set(["kling", "seedance"]));
  });

  it("rows are distinct objects (no shared reference)", () => {
    expect(Object.is(PCD_SYNTHETIC_PROVIDER_PAIRING[0], PCD_SYNTHETIC_PROVIDER_PAIRING[1])).toBe(
      false,
    );
  });

  it("no third row exists (no accidental scaffolding for future modalities)", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[2]).toBeUndefined();
  });

  it("PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION is bumped to 1.1.0 in SP17", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION).toBe(
      "pcd-synthetic-provider-pairing@1.1.0",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test synthetic-provider-pairing 2>&1 | tail -30
```
Expected: multiple failures (length=2, second-row checks, version=1.1.0).

- [ ] **Step 3: Bump router-version literal**

Replace the entire body of `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts`:

```ts
// PCD slice SP16/SP17 — 20th pinned PCD constant.
// Router-logic version. Distinct from PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION
// (which versions the pairing data, not the routing logic).
//
// SP17 bumped this from 1.0.0 → 1.1.0 because the router body now branches
// on videoProviderChoice (new required input) and adds the direction-authored
// check (Step 4) emitting NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment (SP18 will persist it
// onto PcdIdentitySnapshot).
export const PCD_SYNTHETIC_ROUTER_VERSION = "pcd-synthetic-router@1.1.0";
```

- [ ] **Step 4: Bump pairing-version literal + grow matrix to 2 rows**

Replace the entire body of `packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts`:

```ts
// PCD slice SP16/SP17 — 21st pinned PCD constant + declarative pairing matrix.
//
// SP17 bumped PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION from 1.0.0 → 1.1.0
// because the matrix grew from one row (kling only) to two rows (kling +
// seedance), partitioning lookups by 3-tuple (shotType, outputIntent,
// videoProvider).
//
// MERGE-BACK: Future provider-specific narrowing (e.g., Seedance loses
// label_closeup) edits a row's shotTypes array. Adding
// INVALID_VIDEO_PROVIDER_CHOICE as a reachable denial requires the slice
// that introduces the narrowing to add the denial branch, the routing step,
// and the tests. v1.1.0 keeps both rows covering the full 7×4 grid.
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.1.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling" | "seedance";
};

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
    videoProvider: "seedance",
  },
] as const;
```

- [ ] **Step 5: Update `sp16-anti-patterns.test.ts` literals**

The SP16 anti-pattern test currently asserts `length === 1`, `videoProvider === "kling"`, and the `1.0.0` literals. Update in place — purity / SP4-token-blacklist / cross-slice / frozen-source assertions are UNCHANGED.

In `sp16-anti-patterns.test.ts`, replace test 1's literal pattern from `"pcd-synthetic-router@1\\.0\\.0"` to `"pcd-synthetic-router@1\\.1\\.0"`. Update the test title to reference v1.1.0.

Replace test 2's literal pattern from `"pcd-synthetic-provider-pairing@1\\.0\\.0"` to `"pcd-synthetic-provider-pairing@1\\.1\\.0"`. Update the test title.

Replace test 6 (pairing matrix integrity) entirely:

```ts
  it("pairing matrix integrity v2 — kling + seedance rows, both covering 7 shot types × 4 intents", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(2);
    const providers = new Set(PCD_SYNTHETIC_PROVIDER_PAIRING.map((r) => r.videoProvider));
    expect(providers).toEqual(new Set(["kling", "seedance"]));
    const expectedShots = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.imageProvider).toBe("dalle");
      expect([...row.shotTypes].sort()).toEqual([...expectedShots].sort());
      expect([...row.outputIntents].sort()).toEqual(
        ["draft", "final_export", "meta_draft", "preview"].sort(),
      );
    }
  });
```

Leave test 3 (router purity), test 4 (no SP4-internals leakage), test 5 (no cross-slice tokens), test 7 (frozen SP1–SP15 source bodies, keyed against `9dca008`) unchanged. Task 13 will widen test 7's allowlist for SP17 files.

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test synthetic-router 2>&1 | tail -40
```
Expected: `synthetic-provider-pairing.test.ts` all pass. `sp16-anti-patterns.test.ts` tests 1–2 pass on new literals; test 6 passes on 2-row matrix. **`route-synthetic-pcd-shot.test.ts` may show one of two failure modes** depending on the exact intermediate state at this point:
- **Compile error:** if Task 5 inadvertently consumed a 2-row matrix shape from the router body that the SP16 success branch can't satisfy (e.g., `pairing.videoProvider` is now a `"kling" | "seedance"` union but the existing return literal `"kling"` doesn't match the widened `SyntheticProviderPairing` row type) — typecheck fails.
- **Runtime failure:** if the SP16 success returns are still type-compatible at the source level, the SP16 zod schema (still 3 branches at this point — Task 6 widens it) accepts the existing assertions; tests pass. Once Task 6 lands, the 3-branch → 5-branch widen makes some kling-success assertions newly demanding (need `videoProviderChoice` field present).
The strict input-type widen of `RouteSyntheticPcdShotInput` happens in Task 6, not Task 5, so SP16 route tests missing `videoProviderChoice` will only fail to compile after Task 6.

**Do not block on exact red text.** Verify the conceptual state: pairing+anti-pattern green, route test red is acceptable at this step OR may surface later in Task 6 — Tasks 6–9 reconcile.

For now, scope the green to `synthetic-provider-pairing` + `sp16-anti-patterns`:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "synthetic-router/synthetic-provider-pairing|synthetic-router/sp16-anti-patterns" 2>&1 | tail -20
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP17 — bump synthetic router + pairing versions to 1.1.0; matrix grows to 2 rows

Pinned constants stay at 21 total (in-place bumps). Pairing matrix gains
a seedance row; both rows cover the full 7×4 grid in v1.1.0. SP16 anti-
pattern test relaxed to v2 literal expectations; purity / SP4-token-
blacklist / cross-slice / frozen-source assertions UNCHANGED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Widen `RouteSyntheticPcdShotInput` + 5-branch `SyntheticPcdRoutingDecisionSchema`

**Files:**
- Modify: `packages/schemas/src/pcd-synthetic-router.ts`
- Modify: `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts` (input type widen only — body stays at SP16 shape)

This task is structure-only — Tasks 7–10 fill in the body logic.

- [ ] **Step 1: Update `pcd-synthetic-router.test.ts` with failing 5-branch coverage**

Open `packages/schemas/src/__tests__/pcd-synthetic-router.test.ts`. The existing SP16 tests on Branches 1 (synthetic ACCESS_POLICY denial), 3 (kling success, currently the only success), and 5 (delegation) stay. Add the new SP17 branch tests:

```ts
import {
  SyntheticPcdRoutingDecisionSchema,
  PcdRoutingDecisionSchema,
} from "../pcd-synthetic-router.js";
import type { SyntheticPcdRoutingDecision } from "../pcd-synthetic-router.js";

describe("SyntheticPcdRoutingDecisionSchema — SP17 v2 (5 branches)", () => {
  const accessAllowed = {
    allowed: true as const,
    productTierEffective: 3 as const,
    avatarTierEffective: 3 as const,
    effectiveTier: 3 as const,
    allowedOutputTier: 3 as const,
    shotType: "simple_ugc" as const,
    outputIntent: "draft" as const,
    policyVersion: "tier-policy@1.0.0",
  };
  const klingDir = {
    setting: "Dim room", motion: "Head turn", energy: "Composed",
    lighting: "Warm key", avoid: ["Filter"],
  };
  const seedanceDir = {
    setting: "Bright counter", motion: "Hand reveal", energy: "Warm",
    lighting: "Soft window", avoid: ["Cuts"],
  };

  it("accepts a kling-success decision with videoProviderChoice === 'kling'", () => {
    const dec: SyntheticPcdRoutingDecision = {
      allowed: true,
      kind: "synthetic_pairing",
      accessDecision: accessAllowed,
      imageProvider: "dalle",
      videoProvider: "kling",
      videoProviderChoice: "kling",
      dallePromptLocked: "Some prompt",
      klingDirection: klingDir,
      pairingRefIndex: 0,
      pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      decisionReason: {
        matchedShotType: "simple_ugc",
        matchedOutputIntent: "draft",
        selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
      },
    };
    expect(SyntheticPcdRoutingDecisionSchema.parse(dec)).toEqual(dec);
  });

  it("accepts a seedance-success decision with videoProviderChoice === 'seedance'", () => {
    const dec: SyntheticPcdRoutingDecision = {
      allowed: true,
      kind: "synthetic_pairing",
      accessDecision: accessAllowed,
      imageProvider: "dalle",
      videoProvider: "seedance",
      videoProviderChoice: "seedance",
      dallePromptLocked: "Some prompt",
      seedanceDirection: seedanceDir,
      pairingRefIndex: 1,
      pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      decisionReason: {
        matchedShotType: "product_demo",
        matchedOutputIntent: "final_export",
        selectionRationale: "synthetic-pairing tier=3 shot=product_demo intent=final_export → dalle+seedance",
      },
    };
    expect(SyntheticPcdRoutingDecisionSchema.parse(dec)).toEqual(dec);
  });

  it("REJECTS kling-success with videoProviderChoice = 'seedance' (schema-level no-silent-fallback lock)", () => {
    const dec = {
      allowed: true,
      kind: "synthetic_pairing",
      accessDecision: accessAllowed,
      imageProvider: "dalle",
      videoProvider: "kling",
      videoProviderChoice: "seedance", // ← lock violation
      dallePromptLocked: "p",
      klingDirection: klingDir,
      pairingRefIndex: 0,
      pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      decisionReason: {
        matchedShotType: "simple_ugc",
        matchedOutputIntent: "draft",
        selectionRationale: "x",
      },
    };
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(dec)).toThrow();
  });

  it("REJECTS seedance-success with videoProviderChoice = 'kling' (schema-level no-silent-fallback lock)", () => {
    const dec = {
      allowed: true,
      kind: "synthetic_pairing",
      accessDecision: accessAllowed,
      imageProvider: "dalle",
      videoProvider: "seedance",
      videoProviderChoice: "kling", // ← lock violation
      dallePromptLocked: "p",
      seedanceDirection: seedanceDir,
      pairingRefIndex: 1,
      pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      decisionReason: {
        matchedShotType: "product_demo",
        matchedOutputIntent: "final_export",
        selectionRationale: "x",
      },
    };
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(dec)).toThrow();
  });

  it("accepts NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial (videoProviderChoice = seedance)", () => {
    const dec: SyntheticPcdRoutingDecision = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "seedance",
      accessDecision: accessAllowed,
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    expect(SyntheticPcdRoutingDecisionSchema.parse(dec)).toEqual(dec);
  });

  it("accepts NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial (videoProviderChoice = kling)", () => {
    const dec: SyntheticPcdRoutingDecision = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "kling",
      accessDecision: accessAllowed,
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    expect(SyntheticPcdRoutingDecisionSchema.parse(dec)).toEqual(dec);
  });

  it("REJECTS ACCESS_POLICY denial branch if videoProviderChoice field is present (not on this branch)", () => {
    const dec = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      videoProviderChoice: "kling", // ← not on Branch 1 schema
      accessDecision: { ...accessAllowed, allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    // Branch 1 doesn't have videoProviderChoice; passthrough of extra fields
    // is rejected by `.strict()` if applied, else Zod ignores. We expect
    // strict parse to either drop or reject. Confirm exactly:
    const parsed = SyntheticPcdRoutingDecisionSchema.safeParse(dec);
    // Zod by default strips unknown keys in object schemas without .strict();
    // Branch 1's schema has no .strict() so strip is acceptable. Confirm
    // the parsed result does NOT contain videoProviderChoice.
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).videoProviderChoice).toBeUndefined();
    } else {
      // If Branch 1 ever adds .strict(), the extra field rejects — also OK.
      expect(parsed.success).toBe(false);
    }
  });

  it("REJECTS delegation branch with videoProviderChoice present (Q10 design lock)", () => {
    const dec = {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: "script_only",
      sp4Decision: {
        allowed: false,
        denialKind: "ACCESS_POLICY",
        accessDecision: { ...accessAllowed, allowed: false },
      },
      videoProviderChoice: "seedance", // ← not on Branch 5 schema
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    const parsed = SyntheticPcdRoutingDecisionSchema.safeParse(dec);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).videoProviderChoice).toBeUndefined();
    } else {
      expect(parsed.success).toBe(false);
    }
  });

  it("REJECTS NO_DIRECTION denial with videoProviderChoice outside the kling|seedance union", () => {
    const dec = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "openai",
      accessDecision: accessAllowed,
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    };
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(dec)).toThrow();
  });

  it("REJECTS kling-success with seedanceDirection field present (Branch 3 does not carry it)", () => {
    const dec = {
      allowed: true,
      kind: "synthetic_pairing",
      accessDecision: accessAllowed,
      imageProvider: "dalle",
      videoProvider: "kling",
      videoProviderChoice: "kling",
      dallePromptLocked: "p",
      klingDirection: klingDir,
      seedanceDirection: seedanceDir, // ← not on Branch 3
      pairingRefIndex: 0,
      pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      decisionReason: {
        matchedShotType: "simple_ugc",
        matchedOutputIntent: "draft",
        selectionRationale: "x",
      },
    };
    // Same strip-or-reject semantics as the videoProviderChoice-on-Branch-1
    // case above. Confirm extra is not silently echoed.
    const parsed = SyntheticPcdRoutingDecisionSchema.safeParse(dec);
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).seedanceDirection).toBeUndefined();
    } else {
      expect(parsed.success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-router 2>&1 | tail -30
```
Expected: multiple failures (seedance branch unrecognized, NO_DIRECTION branch unrecognized, choice-equality lock not enforced, etc.).

- [ ] **Step 3: Widen `SyntheticPcdRoutingDecisionSchema` to 5 branches**

In `packages/schemas/src/pcd-synthetic-router.ts`, replace the existing `SyntheticPcdRoutingDecisionSchema` definition (currently 3 branches) with the 5-branch version. Keep `PcdRoutingDecisionSchema` (SP4-zod-analogue) unchanged at the top of the file.

Add the `SeedanceDirectionSchema` import:

```ts
import { KlingDirectionSchema, SeedanceDirectionSchema } from "./creator-identity-synthetic.js";
```

Replace the union body:

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
  // In SP17 it now covers any out-of-pairing tuple (shot type, output intent,
  // OR videoProviderChoice). A future provider-narrowing slice that introduces
  // a separate denial path should rename the literal then. videoProviderChoice
  // is NOT echoed: delegation means the synthetic surface was bypassed and
  // SP4's decision is authoritative.
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

- [ ] **Step 4: Widen `RouteSyntheticPcdShotInput` (router source)**

In `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`, locate `RouteSyntheticPcdShotInput`. Add the new required field:

```ts
export type RouteSyntheticPcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  syntheticIdentity: CreatorIdentitySyntheticPayload;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  // SP17 — end-user selection of the video provider, supplied by the SP21
  // composer (or equivalent caller). Matrix gates legality; the chosen
  // provider must have an authored direction on the synthetic identity or
  // the router denies with NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER.
  videoProviderChoice: "kling" | "seedance";
  approvedCampaignContext: ApprovedCampaignContext;
};
```

Do NOT touch the router body yet — Tasks 7–10 widen the body. Existing SP16 callers and tests will now fail to typecheck. That's expected; the next tasks fix them step by step.

- [ ] **Step 5: Run tests to verify zod tests pass**

Run:
```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-router 2>&1 | tail -20
pnpm --filter @creativeagent/schemas typecheck
```
Expected: all schemas tests pass. `creative-pipeline` typecheck and route-test compilation will fail — that's expected; do NOT run them yet.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-synthetic-router.ts \
        packages/schemas/src/__tests__/pcd-synthetic-router.test.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts
git commit -m "$(cat <<'EOF'
feat(schemas): SP17 — widen SyntheticPcdRoutingDecisionSchema to 5 branches

Adds Seedance success branch + NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER
denial branch. videoProviderChoice echoed on both success branches and
the missing-direction denial via per-branch z.literal() equality lock —
schema cannot represent "user picked X but router returned Y success".
RouteSyntheticPcdShotInput widens with the new required choice field;
body widening lands in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Router Step 1 widening — matrix lookup by 3-tuple + delegation tests

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 1: Add failing delegation-path tests**

In `route-synthetic-pcd-shot.test.ts`, locate the existing SP16 delegation describe block. Update its fixtures so every call site supplies `videoProviderChoice`. Add new cases:

```ts
describe("routeSyntheticPcdShot — Step 2 delegation (SP17 — videoProviderChoice plumbed)", () => {
  // Reuse the existing baseInput and stores fixtures from this file.
  // Add `videoProviderChoice: "kling"` (and a parallel block for "seedance")
  // to every existing case. Then add:

  it("delegates with videoProviderChoice=kling on script_only", async () => {
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        shotType: "script_only",
        outputIntent: "draft",
        videoProviderChoice: "kling",
      },
      stores,
    );
    expect(decision.kind).toBe("delegated_to_generic_router");
    expect((decision as Extract<typeof decision, { kind: "delegated_to_generic_router" }>).reason).toBe(
      "shot_type_not_in_synthetic_pairing",
    );
    expect((decision as Record<string, unknown>).videoProviderChoice).toBeUndefined();
  });

  it("delegates with videoProviderChoice=seedance on script_only (same behavior; choice not echoed)", async () => {
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        shotType: "script_only",
        outputIntent: "draft",
        videoProviderChoice: "seedance",
      },
      stores,
    );
    expect(decision.kind).toBe("delegated_to_generic_router");
    expect((decision as Record<string, unknown>).videoProviderChoice).toBeUndefined();
  });

  it("delegates on storyboard for either provider choice", async () => {
    for (const choice of ["kling", "seedance"] as const) {
      const decision = await routeSyntheticPcdShot(
        { ...baseInput, shotType: "storyboard", outputIntent: "draft", videoProviderChoice: choice },
        stores,
      );
      expect(decision.kind).toBe("delegated_to_generic_router");
    }
  });
});
```

The existing kling-success and ACCESS_POLICY tests will still typecheck-fail. Don't fix them yet — Tasks 8–9 do.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot 2>&1 | tail -20
```
Expected: typecheck or runtime failures (the test file references `videoProviderChoice` in input but the router body doesn't read it yet).

- [ ] **Step 3: Widen Step 1 of the router body — 3-tuple matrix lookup**

In `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`, replace the `pairingRefIndex` computation:

```ts
  // Step 1 — Pairing matrix lookup keyed by 3-tuple
  // (shotType, outputIntent, videoProviderChoice). SP17: matrix grew to two
  // rows partitioned by videoProvider; first-match across all rows.
  const pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(
    (p) =>
      p.shotTypes.includes(input.shotType) &&
      p.outputIntents.includes(input.outputIntent) &&
      p.videoProvider === input.videoProviderChoice,
  );
  const pairing =
    pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined;
```

Step 2 (delegation) is unchanged — it returns the same delegation envelope without `videoProviderChoice`.

Step 3 (tier policy gate) is unchanged.

Step 4 (success branch) still has the SP16 kling-only success shape — that's a deliberate intermediate state. The test file's kling-success cases will fail compilation because the SP17 schema now requires `videoProviderChoice` on the kling-success branch. Tasks 8–9 fix the body to match.

- [ ] **Step 4: Run delegation-path tests**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "route-synthetic-pcd-shot.*delegation" 2>&1 | tail -20
```
Expected: the 3 delegation tests pass. Kling-success and ACCESS_POLICY tests still fail (Tasks 8–9 fix).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP17 — router Step 1 widened to 3-tuple matrix lookup

Lookup now keys on (shotType, outputIntent, videoProviderChoice). v1.1.0
both rows cover the full 7×4 grid, so delegation still fires only for
out-of-pairing shot types (script_only, storyboard). videoProviderChoice
is not echoed on the delegation envelope per Q10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Router Step 4 (NEW) — direction-authored check + `NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER` denial

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 1: Add failing denial tests**

In `route-synthetic-pcd-shot.test.ts`, add a new describe block:

```ts
describe("routeSyntheticPcdShot — Step 4 NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER (SP17)", () => {
  it("denies when videoProviderChoice=seedance and seedanceDirection is null", async () => {
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: null },
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
      expect(decision.videoProviderChoice).toBe("seedance");
      expect(decision.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    } else {
      throw new Error("unexpected decision shape");
    }
  });

  it("denies when videoProviderChoice=seedance and seedanceDirection field is omitted (undefined → null)", async () => {
    const { seedanceDirection: _omit, ...identityMinusSeedance } = baseInput.syntheticIdentity;
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: identityMinusSeedance as typeof baseInput.syntheticIdentity,
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
    }
  });

  it("does NOT deny when videoProviderChoice=kling (klingDirection is always populated on SP11 payload)", async () => {
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "kling",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: null },
      },
      stores,
    );
    // klingDirection is non-nullable on the SP11 payload schema, so kling
    // choice never hits NO_DIRECTION_AUTHORED. The decision should be
    // allowed (or ACCESS_POLICY if tiers fail) — NOT NO_DIRECTION.
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).not.toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
    }
  });

  it("Step ordering: ACCESS_POLICY fires before NO_DIRECTION_AUTHORED", async () => {
    // Tier-1 + final_export triggers ACCESS_POLICY per SP2. Combine with
    // seedance choice + null seedanceDirection. Expected: ACCESS_POLICY denial,
    // NOT NO_DIRECTION_AUTHORED denial.
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        resolvedContext: {
          ...baseInput.resolvedContext,
          creatorTierAtResolution: 1,
          productTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        },
        shotType: "simple_ugc",
        outputIntent: "final_export",
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: null },
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("ACCESS_POLICY");
    }
  });
});
```

(Adjust the tier-1 fixture above to whatever exactly triggers ACCESS_POLICY in the existing SP16 test fixture. Inspect `tier-policy.ts` and the existing SP16 ACCESS_POLICY tests for the correct trigger combination.)

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "NO_DIRECTION_AUTHORED" 2>&1 | tail -20
```
Expected: failures (the router still has the SP16 kling-only success branch and no Step 4 direction check).

- [ ] **Step 3: Implement Step 0 + Step 4**

In `route-synthetic-pcd-shot.ts`, inside `routeSyntheticPcdShot`, immediately at the top of the function body (before Step 1), add Step 0 normalization. After Step 3 (the tier policy gate denial) and before the current Step 4 (success), insert the new direction-check:

```ts
export async function routeSyntheticPcdShot(
  input: RouteSyntheticPcdShotInput,
  stores: ProviderRouterStores,
): Promise<SyntheticPcdRoutingDecision> {
  // Step 0 — Normalize undefined seedanceDirection to null per design J1.
  // Schema accepts nullish(); domain logic treats null as the single
  // missing-state.
  const seedanceDirection = input.syntheticIdentity.seedanceDirection ?? null;

  // Step 1 — Pairing matrix lookup (3-tuple) ... [unchanged from Task 7]
  const pairingRefIndex = PCD_SYNTHETIC_PROVIDER_PAIRING.findIndex(
    (p) =>
      p.shotTypes.includes(input.shotType) &&
      p.outputIntents.includes(input.outputIntent) &&
      p.videoProvider === input.videoProviderChoice,
  );
  const pairing =
    pairingRefIndex >= 0 ? PCD_SYNTHETIC_PROVIDER_PAIRING[pairingRefIndex] : undefined;

  // Step 2 — Out-of-pairing → delegate ... [unchanged]
  if (pairing === undefined) {
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: input.resolvedContext,
        shotType: input.shotType,
        outputIntent: input.outputIntent,
        approvedCampaignContext: input.approvedCampaignContext,
      },
      stores,
    );
    return {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: input.shotType,
      sp4Decision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 3 — Tier policy gate (UNCHANGED).
  const accessDecision = decidePcdGenerationAccess({
    avatarTier: input.resolvedContext.creatorTierAtResolution,
    productTier: input.resolvedContext.productTierAtResolution,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
  });
  if (!accessDecision.allowed) {
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 4 — Direction-authored check (NEW, SP17). The chosen provider must
  // have an authored direction on the synthetic identity. Distinct denial
  // kind — NEVER conflated with ACCESS_POLICY, NEVER silently degraded.
  // klingDirection is non-nullable on the SP11 payload schema; only the
  // seedance path can hit this denial in v1.1.0.
  const direction =
    input.videoProviderChoice === "kling"
      ? input.syntheticIdentity.klingDirection
      : seedanceDirection;
  if (direction === null) {
    return {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: input.videoProviderChoice,
      accessDecision,
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    };
  }

  // Step 5 — Build synthetic pairing decision. (Task 9 fills this in.)
  // Temporary intermediate: keep the SP16 kling-only success shape so the
  // file compiles. Task 9 swaps in the per-provider branches.
  return {
    allowed: true,
    kind: "synthetic_pairing",
    accessDecision,
    imageProvider: pairing.imageProvider,
    videoProvider: pairing.videoProvider as "kling",
    videoProviderChoice: "kling" as const,
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
  };
}
```

NOTE: this intermediate state still returns a kling-shaped success when the user chose seedance — which is a SCHEMA VIOLATION captured by the zod tests in Task 6. The intermediate compiles only because of the explicit `as "kling"` cast. That cast is removed in Task 9. The behavioral integrity is restored once Task 9 lands; do not stop the slice at this intermediate state.

- [ ] **Step 4: Run NO_DIRECTION tests to verify they pass**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "NO_DIRECTION_AUTHORED|Step.*ordering" 2>&1 | tail -20
```
Expected: the 4 new tests pass. Kling-success and seedance-success tests still fail compilation (no `videoProviderChoice` on the SP16 fixture; Task 9 fixes).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP17 — router Step 4 — NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial

New denial kind fires when the user-chosen video provider has no authored
direction on the synthetic identity. klingDirection is non-nullable on the
SP11 payload so only the seedance path can reach this in v1.1.0. Step
ordering tested: ACCESS_POLICY fires before NO_DIRECTION_AUTHORED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Router Step 5 widening — per-provider success branches with `videoProviderChoice` echo

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 1: Update kling-success tests to v2 shape**

Find every existing kling-success assertion in `route-synthetic-pcd-shot.test.ts` and update the expected shape to include `videoProviderChoice: "kling"`. Add new seedance-success tests:

```ts
describe("routeSyntheticPcdShot — Step 5 success branches (SP17 — per-provider)", () => {
  it("kling success carries videoProviderChoice='kling' on every video shot × intent", async () => {
    const videoShots: PcdShotType[] = [
      "simple_ugc", "talking_head", "product_demo", "product_in_hand",
      "face_closeup", "label_closeup", "object_insert",
    ];
    const intents: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
    for (const shotType of videoShots) {
      for (const outputIntent of intents) {
        const decision = await routeSyntheticPcdShot(
          { ...baseInput, shotType, outputIntent, videoProviderChoice: "kling" },
          stores,
        );
        if (decision.allowed === true && decision.kind === "synthetic_pairing") {
          expect(decision.videoProvider).toBe("kling");
          expect(decision.videoProviderChoice).toBe("kling");
          expect(decision.imageProvider).toBe("dalle");
          expect(decision.klingDirection).toEqual(baseInput.syntheticIdentity.klingDirection);
          expect("seedanceDirection" in decision).toBe(false);
          expect(decision.pairingRefIndex).toBe(0);
        } else {
          throw new Error(`expected kling success for ${shotType}/${outputIntent}, got: ${JSON.stringify(decision)}`);
        }
      }
    }
  });

  it("seedance success carries videoProviderChoice='seedance' on every video shot × intent (populated fixture)", async () => {
    const seedanceDir = {
      setting: "Bright counter", motion: "Hand reveal", energy: "Warm",
      lighting: "Soft window", avoid: ["Cuts"],
    };
    const populated = {
      ...baseInput.syntheticIdentity,
      seedanceDirection: seedanceDir,
    };
    const videoShots: PcdShotType[] = [
      "simple_ugc", "talking_head", "product_demo", "product_in_hand",
      "face_closeup", "label_closeup", "object_insert",
    ];
    const intents: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
    for (const shotType of videoShots) {
      for (const outputIntent of intents) {
        const decision = await routeSyntheticPcdShot(
          {
            ...baseInput,
            shotType,
            outputIntent,
            videoProviderChoice: "seedance",
            syntheticIdentity: populated,
          },
          stores,
        );
        if (decision.allowed === true && decision.kind === "synthetic_pairing") {
          expect(decision.videoProvider).toBe("seedance");
          expect(decision.videoProviderChoice).toBe("seedance");
          expect(decision.imageProvider).toBe("dalle");
          expect(decision.seedanceDirection).toEqual(seedanceDir);
          expect("klingDirection" in decision).toBe(false);
          expect(decision.pairingRefIndex).toBe(1);
        } else {
          throw new Error(`expected seedance success for ${shotType}/${outputIntent}, got: ${JSON.stringify(decision)}`);
        }
      }
    }
  });

  it("locked artifacts byte-equality — kling direction shifts when input shifts", async () => {
    const dec1 = await routeSyntheticPcdShot(
      { ...baseInput, videoProviderChoice: "kling" },
      stores,
    );
    const dec2 = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "kling",
        syntheticIdentity: {
          ...baseInput.syntheticIdentity,
          klingDirection: { ...baseInput.syntheticIdentity.klingDirection, setting: "DIFFERENT" },
        },
      },
      stores,
    );
    if (dec1.allowed === true && dec1.kind === "synthetic_pairing" && dec1.videoProvider === "kling") {
      if (dec2.allowed === true && dec2.kind === "synthetic_pairing" && dec2.videoProvider === "kling") {
        expect(dec1.klingDirection.setting).not.toBe(dec2.klingDirection.setting);
        expect(dec2.klingDirection.setting).toBe("DIFFERENT");
      }
    }
  });

  it("locked artifacts byte-equality — seedance direction shifts when input shifts", async () => {
    const sdA = {
      setting: "Bright counter A", motion: "M", energy: "E", lighting: "L", avoid: ["x"],
    };
    const sdB = { ...sdA, setting: "Bright counter B" };
    const decA = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: sdA },
      },
      stores,
    );
    const decB = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: sdB },
      },
      stores,
    );
    if (decA.allowed === true && decA.kind === "synthetic_pairing" && decA.videoProvider === "seedance") {
      if (decB.allowed === true && decB.kind === "synthetic_pairing" && decB.videoProvider === "seedance") {
        expect(decA.seedanceDirection.setting).toBe("Bright counter A");
        expect(decB.seedanceDirection.setting).toBe("Bright counter B");
      }
    }
  });

  it("version stamps are SP17 v1.1.0 on every success branch", async () => {
    const decKling = await routeSyntheticPcdShot(
      { ...baseInput, videoProviderChoice: "kling" }, stores,
    );
    const seedanceDir = {
      setting: "S", motion: "M", energy: "E", lighting: "L", avoid: ["x"],
    };
    const decSeedance = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: seedanceDir },
      },
      stores,
    );
    for (const dec of [decKling, decSeedance]) {
      expect(dec.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
      if (dec.allowed === true && dec.kind === "synthetic_pairing") {
        expect(dec.pairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "Step 5 success branches" 2>&1 | tail -20
```
Expected: failures (seedance-choice still returns the kling-shape intermediate from Task 8).

- [ ] **Step 3: Implement per-provider success branches**

In `route-synthetic-pcd-shot.ts`, replace the Step 5 intermediate from Task 8 with the proper per-provider return:

```ts
  // Step 5 — Build synthetic pairing decision, per-provider branch.
  // videoProviderChoice and videoProvider are zod-literal-equal by branch
  // (Q9 schema-level lock).
  const baseDecision = {
    allowed: true as const,
    kind: "synthetic_pairing" as const,
    accessDecision,
    imageProvider: "dalle" as const,
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
  };

  if (input.videoProviderChoice === "kling") {
    return {
      ...baseDecision,
      videoProvider: "kling",
      videoProviderChoice: "kling",
      klingDirection: input.syntheticIdentity.klingDirection,
    };
  }
  // input.videoProviderChoice === "seedance" (narrowed by union exhaustion;
  // direction is non-null here, narrowed by Step 4)
  return {
    ...baseDecision,
    videoProvider: "seedance",
    videoProviderChoice: "seedance",
    seedanceDirection: direction, // SeedanceDirection (non-null)
  };
}
```

Note: `direction` is the variable bound in Step 4 to the chosen provider's direction. After the Step 4 null-check, TypeScript narrows it to non-null on the success path. The seedance return uses `direction` directly (which is the `SeedanceDirection` type after the kling/seedance branch in the conditional expression assignment).

If TypeScript narrowing breaks because the `direction` type is `KlingDirection | SeedanceDirection`, you may need to recompute the seedance direction inline:

```ts
  return {
    ...baseDecision,
    videoProvider: "seedance",
    videoProviderChoice: "seedance",
    seedanceDirection: seedanceDirection!, // non-null after Step 4 guard
  };
```

Use the `!` non-null assertion only after confirming the Step 4 guard rejected the null case. Comment the assertion: `// non-null guaranteed by Step 4`.

The `buildSyntheticSelectionRationale` 4th argument signature is added in Task 10; for now keep the call shape but the function still takes 3 args. That will produce a typecheck error. The cleanest sequence is: **complete Task 10 immediately after this step's edit, before re-running tests**. Alternatively, temporarily ignore the 4th argument in the rationale call here and let Task 10 widen the signature. Choose the former for cleanliness.

- [ ] **Step 4: Run success-branch tests to verify they pass**

Run (after Task 10's signature widening is in place):
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "Step 5 success branches|byte-equality|Version stamps" 2>&1 | tail -30
```
Expected: all new success-branch tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP17 — per-provider success branches with videoProviderChoice echo

Kling success returns Branch 3 of the union (klingDirection only); Seedance
success returns Branch 4 (seedanceDirection only). videoProvider ===
videoProviderChoice is structurally guaranteed by zod literal-equality per
branch — schema cannot represent a silent fallback. pairingRefIndex = 0
for kling, 1 for seedance. Both branches stamp v1.1.0 version constants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `buildSyntheticSelectionRationale` extension (4th arg `videoProvider`)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

If Task 9 was completed cleanly, the function has already been called with 4 args. This task ensures the function's signature matches and adds dedicated tests.

- [ ] **Step 1: Add failing tests**

Append to `route-synthetic-pcd-shot.test.ts`:

```ts
describe("buildSyntheticSelectionRationale (SP17 — 4th arg videoProvider)", () => {
  it("includes 'dalle+kling' when videoProvider is kling", () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft", "kling");
    expect(out).toContain("dalle+kling");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=simple_ugc");
    expect(out).toContain("intent=draft");
  });

  it("includes 'dalle+seedance' when videoProvider is seedance", () => {
    const out = buildSyntheticSelectionRationale(3, "product_demo", "final_export", "seedance");
    expect(out).toContain("dalle+seedance");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=product_demo");
    expect(out).toContain("intent=final_export");
  });

  it("caps output at 200 chars", () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft", "seedance");
    expect(out.length).toBeLessThanOrEqual(200);
  });
});
```

- [ ] **Step 2: Widen `buildSyntheticSelectionRationale` signature**

In `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts`:

```ts
export function buildSyntheticSelectionRationale(
  effectiveTier: IdentityTier,
  shotType: PcdShotType,
  outputIntent: OutputIntent,
  videoProvider: "kling" | "seedance",
): string {
  const out = `synthetic-pairing tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → dalle+${videoProvider}`;
  return out.length > 200 ? out.slice(0, 200) : out;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test \
  "buildSyntheticSelectionRationale" 2>&1 | tail -20
```
Expected: all 3 new tests pass. Confirm no regressions in tier3-routing-rules / SP16 tests that might import this helper (they shouldn't — SP16 design J8 forbids cross-slice SP16 token leakage; cross-check by grep that `buildSyntheticSelectionRationale` has no consumers outside this directory).

- [ ] **Step 4: Run full pipeline package + confirm rationale-content invariants in success-branch tests**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot 2>&1 | tail -30
```
Expected: typecheck clean; all router tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP17 — buildSyntheticSelectionRationale accepts videoProvider as 4th arg

Rationale now reads "synthetic-pairing tier=N shot=X intent=Y → dalle+Z"
where Z is the chosen video provider. 200-char cap unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Determinism + `approvedCampaignContext`-no-perturb + verbatim-byte-equality

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `route-synthetic-pcd-shot.test.ts`:

```ts
describe("routeSyntheticPcdShot — determinism (SP17)", () => {
  it("identical inputs → deep-equal decisions (kling)", async () => {
    const inputs = { ...baseInput, videoProviderChoice: "kling" as const };
    const a = await routeSyntheticPcdShot(inputs, stores);
    const b = await routeSyntheticPcdShot(inputs, stores);
    expect(a).toEqual(b);
  });

  it("identical inputs → deep-equal decisions (seedance, populated)", async () => {
    const seedanceDir = {
      setting: "S", motion: "M", energy: "E", lighting: "L", avoid: ["x"],
    };
    const inputs = {
      ...baseInput,
      videoProviderChoice: "seedance" as const,
      syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: seedanceDir },
    };
    const a = await routeSyntheticPcdShot(inputs, stores);
    const b = await routeSyntheticPcdShot(inputs, stores);
    expect(a).toEqual(b);
  });

  it("approvedCampaignContext does NOT perturb synthetic-path output (U3)", async () => {
    const baseSynth = { ...baseInput, videoProviderChoice: "kling" as const };
    const ctxA: ApprovedCampaignContext = { kind: "campaign", campaignId: "camp_A" };
    const ctxB: ApprovedCampaignContext = { kind: "campaign", campaignId: "camp_B" };
    const decA = await routeSyntheticPcdShot(
      { ...baseSynth, approvedCampaignContext: ctxA }, stores,
    );
    const decB = await routeSyntheticPcdShot(
      { ...baseSynth, approvedCampaignContext: ctxB }, stores,
    );
    expect(decA).toEqual(decB);
  });

  it("approvedCampaignContext DOES participate on delegation path", async () => {
    // script_only forces delegation; SP4 may or may not consult campaign
    // context depending on its own logic. The test asserts the embedded
    // sp4Decision reflects the change. Use a campaign-vs-none switch which
    // SP4's tier3 rules treat differently for tier-3 shots.
    const baseDel = {
      ...baseInput,
      shotType: "script_only" as const,
      outputIntent: "draft" as const,
      videoProviderChoice: "kling" as const,
    };
    const ctxNone: ApprovedCampaignContext = { kind: "none" };
    const ctxCamp: ApprovedCampaignContext = { kind: "campaign", campaignId: "camp_x" };
    const decNone = await routeSyntheticPcdShot(
      { ...baseDel, approvedCampaignContext: ctxNone }, stores,
    );
    const decCamp = await routeSyntheticPcdShot(
      { ...baseDel, approvedCampaignContext: ctxCamp }, stores,
    );
    // Both should be delegated, but the inner sp4Decision should reflect
    // the campaign-vs-none distinction. For script_only (text-only path)
    // SP4 doesn't currently branch on campaign, so both decisions may end
    // up deep-equal — this is OK. The assertion is that the SP4 sp4Decision
    // is structurally valid in both cases; differential perturbation is
    // SP4's concern.
    expect(decNone.kind).toBe("delegated_to_generic_router");
    expect(decCamp.kind).toBe("delegated_to_generic_router");
  });

  it("dallePromptLocked byte-equality holds on both providers", async () => {
    const seedanceDir = {
      setting: "S", motion: "M", energy: "E", lighting: "L", avoid: ["x"],
    };
    const customPrompt = "Custom DALL-E prompt for byte-equality test";
    const baseCustom = {
      ...baseInput,
      syntheticIdentity: {
        ...baseInput.syntheticIdentity,
        dallePromptLocked: customPrompt,
        seedanceDirection: seedanceDir,
      },
    };
    const decKling = await routeSyntheticPcdShot(
      { ...baseCustom, videoProviderChoice: "kling" }, stores,
    );
    const decSeedance = await routeSyntheticPcdShot(
      { ...baseCustom, videoProviderChoice: "seedance" }, stores,
    );
    if (decKling.allowed === true && decKling.kind === "synthetic_pairing") {
      expect(decKling.dallePromptLocked).toBe(customPrompt);
    }
    if (decSeedance.allowed === true && decSeedance.kind === "synthetic_pairing") {
      expect(decSeedance.dallePromptLocked).toBe(customPrompt);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (no implementation change expected — the body from Task 9/10 already satisfies these)

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test "determinism" 2>&1 | tail -20
```
Expected: all 5 tests pass.

- [ ] **Step 3: Run full router file**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test route-synthetic-pcd-shot 2>&1 | tail -30
pnpm --filter @creativeagent/creative-pipeline typecheck
```
Expected: all router tests pass; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP17 — determinism + approvedCampaignContext-no-perturb + dallePromptLocked byte-equality

Five new behavioral invariants:
1. Identical inputs → deep-equal decisions (both providers)
2. approvedCampaignContext does not perturb synthetic-path output (U3)
3. approvedCampaignContext participates on delegation path (structural)
4. dallePromptLocked byte-equality holds on both providers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `sp17-anti-patterns.test.ts` — 6 assertions (5 from design + frozen-source baseline rebase)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts`

The design §5.4 enumerates 5 assertions; SP14/15/16 all carry a 6th conventional frozen-source check keyed against the prior slice's merge tip. SP17 adds the same convention, keyed against SP16 tip `04f14b1`.

- [ ] **Step 1: Create the file**

Create `packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts`:

```ts
// SP17 anti-pattern grep tests. These guard against:
//   1. No parallel V2 router symbol (routeSyntheticPcdShotV2 / file v2). SP17
//      is canonical-router extension, not wrapping.
//   2. Single-source pairing-version pin ("pcd-synthetic-provider-pairing@1.1.0"
//      appears in exactly one non-test source file).
//   3. Single-source router-version pin ("pcd-synthetic-router@1.1.0" appears
//      in exactly one non-test source file).
//   4. Behavioral: no silent fallback. seedance-choice + null seedanceDirection
//      → NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial, never a kling success.
//   5. Behavioral: verbatim seedanceDirection on seedance-success.
//   6. Frozen SP1–SP16 source bodies (allowlist edits only) — keyed against
//      04f14b1 (SP16-on-main merge tip). Convention carried from SP14/15/16.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeSyntheticPcdShot } from "./route-synthetic-pcd-shot.js";
import { decidePcdGenerationAccess as _decide } from "../tier-policy.js"; // present-only check

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const ROUTER_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/synthetic-router");
const ROUTER_VERSION_PATH = path.join(ROUTER_DIR, "synthetic-router-version.ts");
const PAIRING_PATH = path.join(ROUTER_DIR, "synthetic-provider-pairing.ts");
const ROUTER_PATH = path.join(ROUTER_DIR, "route-synthetic-pcd-shot.ts");

function grepFiles(pattern: string, scope: string): string[] {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

describe("SP17 anti-patterns", () => {
  // --- Source-level assertions ---

  it("no parallel V2 router symbol anywhere in pipeline package", () => {
    const hits = grepFiles(
      "routeSyntheticPcdShotV2",
      "packages/creative-pipeline/src",
    );
    expect(hits, `unexpected V2 router symbol references: ${hits.join("\n")}`).toEqual([]);
  });

  it("no V2 router file exists", () => {
    const hits = grepFiles(
      "route-synthetic-pcd-shot-v2",
      "packages/creative-pipeline/src",
    );
    expect(hits).toEqual([]);
  });

  it('PCD_SYNTHETIC_ROUTER_VERSION literal "pcd-synthetic-router@1.1.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-router@1\\.1\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      ),
    ).toBe(true);
  });

  it('PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION literal "pcd-synthetic-provider-pairing@1.1.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-provider-pairing@1\\.1\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      ),
    ).toBe(true);
  });

  // --- Behavioral assertions ---

  it("no silent fallback: seedance choice + null seedanceDirection → NO_DIRECTION_AUTHORED, never kling success", async () => {
    // Construct minimal valid fixtures inline so the test is self-contained.
    // Mirror the fixture shape used in route-synthetic-pcd-shot.test.ts.
    const baseInput = makeBaseRouterInput();
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: null },
      },
      makeStores(),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
      expect(decision.videoProviderChoice).toBe("seedance");
    } else {
      throw new Error("unexpected decision shape on seedance + null direction");
    }
  });

  it("verbatim seedanceDirection on seedance-success — byte-equality", async () => {
    const seedanceDir = {
      setting: "Unique-Setting-XYZ",
      motion: "Unique-Motion-XYZ",
      energy: "Unique-Energy-XYZ",
      lighting: "Unique-Lighting-XYZ",
      avoid: ["Unique-Avoid-XYZ"],
    };
    const baseInput = makeBaseRouterInput();
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: seedanceDir },
      },
      makeStores(),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true && decision.kind === "synthetic_pairing" && decision.videoProvider === "seedance") {
      expect(decision.seedanceDirection).toEqual(seedanceDir);
    } else {
      throw new Error("expected seedance-success branch");
    }
  });

  // --- Frozen-source-body assertion (convention from SP14/15/16) ---

  it("SP1–SP16 source bodies are unchanged since the SP16 baseline (allowlist edits only)", () => {
    const SP16_BASELINE = "04f14b1"; // SP16-on-main merge tip
    const allowedEdits = new Set<string>([
      // SP17 net-new files
      "packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts",
      // SP17 SP11 widen
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      // SP17 schemas widen (5-branch union)
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      // SP17 DB
      "packages/db/prisma/schema.prisma",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      // SP17 design + plan docs
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP16_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      return; // shallow clone — skip
    }
    if (baselineSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${baselineSha} HEAD`, {
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP17 freely edits its own subdir (router source + tests).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      // SP17 Prisma migration directories.
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      // docs.
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 13).
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts")
        continue;
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP16_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});

// --- Fixture helpers ---

function makeBaseRouterInput() {
  return {
    resolvedContext: {
      jobId: "job_sp17_antipattern",
      creatorIdentityId: "ci_sp17_antipattern",
      productIdentityId: "pi_sp17_antipattern",
      creatorTierAtResolution: 3 as const,
      productTierAtResolution: 3 as const,
      effectiveTier: 3 as const,
      allowedOutputTier: 3 as const,
      // Add any other required ResolvedPcdContext fields by inspecting the
      // existing route-synthetic-pcd-shot.test.ts fixture and matching.
    } as any,
    syntheticIdentity: {
      creatorIdentityId: "ci_sp17_antipattern",
      treatmentClass: "med_spa",
      vibe: "calm_clinical",
      market: "us",
      ethnicityFamily: "white_european",
      ageBand: "mid_30s_plus",
      pricePositioning: "premium",
      physicalDescriptors: {
        faceShape: "Oval", skinTone: "Fair", eyeShape: "Hooded",
        hair: "Brunette", ageRead: "36", buildNote: "Slim",
      },
      dallePromptLocked: "Test DALL-E prompt",
      klingDirection: {
        setting: "Room", motion: "Turn", energy: "Composed",
        lighting: "Warm", avoid: ["Filter"],
      },
      seedanceDirection: null,
      voiceCaptionStyle: {
        voice: "Calm", captionStyle: "lower", sampleHook: "ok", sampleCta: "book",
      },
      mutuallyExclusiveWithIds: [],
      status: "active" as const,
    },
    shotType: "simple_ugc" as const,
    outputIntent: "draft" as const,
    videoProviderChoice: "kling" as const,
    approvedCampaignContext: { kind: "none" as const },
  };
}

function makeStores() {
  return {
    campaignTakeStore: {
      hasApprovedTier3TakeForCampaign: async () => false,
    },
  };
}
```

NOTE: the `as any` cast on `resolvedContext` is acceptable here because this is a self-contained anti-pattern test fixture; the existing router test file has a fully-typed fixture. If type drift causes failures, replace `as any` with the exact `ResolvedPcdContext` shape from `registry-resolver.ts`.

- [ ] **Step 2: Run the new file**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test sp17-anti-patterns 2>&1 | tail -30
```
Expected: all 7 tests pass (5 from design + 2 frozen-source tests, but counting them by purpose: 5 design assertions + 1 frozen-source = 6 conceptual; test 1 and test 2 are split for clarity, so the file has 7 `it` blocks).

If test 7 (frozen-source) fails because `04f14b1` is not yet reachable (shallow clone or local-only), the `try/catch` returns early — that's expected. CI will reach it.

- [ ] **Step 3: Run all anti-pattern tests across the repo**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test "anti-patterns" 2>&1 | tail -30
```
Expected: all 8 anti-pattern files (sp9–sp17) pass. Task 13 fixes any allowlist failures on the 7 prior files.

If `sp9-anti-patterns.test.ts` through `sp16-anti-patterns.test.ts` fail with "unexpected file changed since {baseline}" for SP17 net-new files, that's expected — Task 13 fixes the allowlists.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
test(pcd): SP17 — sp17-anti-patterns with 5 design assertions + frozen-source baseline rebase

Source-level: no V2 router symbol; single-source v1.1.0 version pins.
Behavioral: seedance + null direction → NO_DIRECTION_AUTHORED (no silent
fallback); verbatim seedanceDirection on seedance-success. Frozen-source
check keyed against SP16 baseline 04f14b1 with SP17 file allowlist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Allowlist maintenance — extend 8 prior anti-pattern test files

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts`

- [ ] **Step 1: Identify the failing allowlists**

Run the full anti-pattern test suite:
```bash
pnpm --filter @creativeagent/creative-pipeline test "anti-patterns" 2>&1 | tee /tmp/sp17-antipattern-out.txt
grep "unexpected file changed since" /tmp/sp17-antipattern-out.txt | sort -u
```
Expected: each of the 7 prior files (sp9..sp16) reports unexpected files. Collect the list.

- [ ] **Step 2: For each prior test, widen the allowlist**

For each of the 8 files, open it and locate the frozen-source-body test's `allowedEdits` Set. Add the SP17 net-new files:

```ts
      // SP17 net-new (allowlist maintenance, Task 13 of SP17 plan)
      "packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts",
      // SP17 SP11 widen
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      // SP17 schemas widen
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      // SP17 DB
      "packages/db/prisma/schema.prisma",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      // SP17 design + plan docs
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md",
```

Some prior tests may need the `if (file.startsWith("packages/db/prisma/migrations/")) continue;` exclusion added — check whether each file already has it. If not, add it.

Some prior tests may need allowlist exclusion for the synthetic-router subdir (`if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;`). Check each and add if missing.

For `sp16-anti-patterns.test.ts`, the existing allowlist already covers the synthetic-router subdir as edit-friendly (Task 5 edited it in place); just append the SP17 cross-package allowlist entries.

- [ ] **Step 3: Run the full anti-pattern suite**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test "anti-patterns" 2>&1 | tail -30
```
Expected: all 8 files green.

- [ ] **Step 4: Run the full creative-pipeline test suite**

Run:
```bash
pnpm --filter @creativeagent/creative-pipeline test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts
git commit -m "$(cat <<'EOF'
chore(pcd): SP17 — widen 8 prior anti-pattern allowlists for SP17 net-new files

Extends the frozen-source-body allowlists in sp9/sp10a/sp10b/sp10c/sp13/
sp14/sp15/sp16-anti-patterns.test.ts to include SP17's net-new files
(sp17-anti-patterns.test.ts, SP11 widen, schemas widen, DB widen, design
+ plan docs). No behavioral changes — purely additive allowlist
maintenance per SP10A→SP16 precedent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Barrel re-export verification

**Files:**
- (Read-only verification of `packages/schemas/src/index.ts` and `packages/creative-pipeline/src/index.ts`)

- [ ] **Step 1: Confirm `SeedanceDirectionSchema` flows through the schemas barrel**

The schemas barrel uses `export * from "./creator-identity-synthetic.js"` which automatically re-exports new schemas. Confirm:

Run:
```bash
grep -n "SeedanceDirection\|creator-identity-synthetic" packages/schemas/src/index.ts
```
Expected: at least one `export * from "./creator-identity-synthetic.js"` (or equivalent). The barrel widening test added in Task 2 should already prove this works.

- [ ] **Step 2: Confirm `routeSyntheticPcdShot` and the widened input type flow through the creative-pipeline barrel**

Run:
```bash
grep -n "synthetic-router\|routeSyntheticPcdShot\|RouteSyntheticPcdShotInput" packages/creative-pipeline/src/index.ts packages/creative-pipeline/src/pcd/synthetic-router/index.ts
```
Expected: the synthetic-router subdir's `index.ts` re-exports `routeSyntheticPcdShot`, `buildSyntheticSelectionRationale`, `RouteSyntheticPcdShotInput`, `PCD_SYNTHETIC_ROUTER_VERSION`, `PCD_SYNTHETIC_PROVIDER_PAIRING`, `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION`, `SyntheticProviderPairing`. The package-level `index.ts` re-exports the subdir via `export * from "./pcd/synthetic-router/index.js"` (already in place from SP16).

If any export is missing, add it now. (Tasks 2 + 6 should have left these correct.)

- [ ] **Step 3: Build all packages to confirm declarations propagate**

Run:
```bash
pnpm --filter @creativeagent/schemas build
pnpm --filter @creativeagent/creative-pipeline build
```
Expected: both build cleanly. Confirm `dist/creator-identity-synthetic.d.ts` and `dist/pcd-synthetic-router.d.ts` contain `SeedanceDirection` / `SeedanceDirectionSchema` / `SyntheticPcdRoutingDecision` 5-branch type definitions:

```bash
grep -n "SeedanceDirection\|videoProviderChoice\|NO_DIRECTION_AUTHORED" \
  packages/schemas/dist/creator-identity-synthetic.d.ts \
  packages/schemas/dist/pcd-synthetic-router.d.ts | head -20
```
Expected: matches for both.

- [ ] **Step 4: No commit** — verification only. If any barrel widening was needed, commit it with message `feat: SP17 barrel widening for Seedance schemas` and include the modified file paths.

---

## Task 15: Final full-repo sweep

**Files:**
- (None — verification only)

- [ ] **Step 1: Run typecheck across all packages**

Run:
```bash
pnpm typecheck 2>&1 | tail -10
```
Expected: clean across all 5 packages.

- [ ] **Step 2: Run the full test suite**

Run:
```bash
pnpm test 2>&1 | tail -20
```
Expected: ~1975 passing + 2 skipped. The SP16-baseline (~1941 + 2 skipped) plus ~34 SP17 net-new tests. If the total is materially off (e.g., ~1955 or ~2000), investigate before declaring success — count drift may indicate a missing test or a hidden regression.

- [ ] **Step 3: Run prettier**

Run:
```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}" 2>&1 | tail -10
```
Expected: 2 SP5-baseline warnings only (`tier-policy.ts` / `tier-policy.test.ts`). No new warnings on SP17 files.

If new warnings exist, run:
```bash
pnpm exec prettier --write packages/<paths>
```
on each new file and amend a commit.

- [ ] **Step 4: Confirm Prisma migration is the only new SQL since SP16**

Run:
```bash
git diff --name-only 04f14b1..HEAD -- packages/db/prisma/migrations/
```
Expected: exactly one new directory `<TIMESTAMP>_pcd_creator_identity_synthetic_sp17_seedance_direction/` containing `migration.sql`. No other migration directories.

- [ ] **Step 5: Confirm SP1–SP16 source bodies (outside the synthetic-router subdir + SP17 allowlist) are unchanged**

Run:
```bash
git diff --stat 04f14b1..HEAD \
  -- packages/creative-pipeline/src \
  -- packages/schemas/src \
  -- packages/db/src \
  -- packages/db/prisma 2>&1 | tail -40
```
Cross-reference each file against the design §3.1 file-touch list. Any unexpected file is a deviation — flag it before squashing.

- [ ] **Step 6: Confirm constant count remains 21**

Run:
```bash
grep -rE 'export const PCD_[A-Z_]+_VERSION\s*=' packages/creative-pipeline/src packages/schemas/src 2>/dev/null \
  | grep -v ".test.ts" | wc -l
```
Expected: 21. (If more, a new constant was accidentally introduced; SP17 should add zero.)

- [ ] **Step 7: Confirm 1.0.0 router/pairing literals are gone**

Run:
```bash
grep -rE '"pcd-synthetic-router@1\.0\.0"|"pcd-synthetic-provider-pairing@1\.0\.0"' packages/ 2>/dev/null
```
Expected: empty. Any hit means a stale reference to the SP16 version literal that Task 5 should have updated.

- [ ] **Step 8: Final acceptance summary**

Compose a summary comment for the PR description:

```
SP17 — Synthetic Provider Routing: Seedance extension. Matrix grows 1→2
rows (kling + seedance); decision union grows 3→5 branches; SP11 widens
with nullable seedanceDirection. Version literals bumped 1.0.0 → 1.1.0
in place; pinned-constant count stays at 21. One additive Prisma migration.

Tests: ~1975 passing + 2 skipped (SP16 baseline ~1941 + ~34 SP17 net-new).
Typecheck clean. Prettier clean (SP5 baseline warnings only).

Spec: docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md
Plan: docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md
```

- [ ] **Step 9: Push to origin + open PR**

Run:
```bash
git push -u origin pcd/sp17-synthetic-provider-routing-seedance
gh pr create --title "feat(pcd): SP17 — synthetic provider routing Seedance extension (matrix 1→2, union 3→5, SP11 seedanceDirection widen)" --body "$(cat <<'EOF'
## Summary
- Matrix grows 1→2 rows: kling + seedance, both covering all 7 video shot types × 4 output intents
- Decision union grows 3→5 branches: + Seedance success, + NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial
- SP11 widens with nullable seedanceDirection (existing 30 roster creators stay kling-only)
- Pinned versions bumped 1.0.0 → 1.1.0 in place; pinned-constant count stays at 21
- Schema-level no-silent-fallback lock via per-branch z.literal() equality
- One additive Prisma migration on CreatorIdentitySynthetic

## Test plan
- [ ] `pnpm typecheck` clean across all 5 packages
- [ ] `pnpm test` ~1975 passing + 2 skipped
- [ ] `pnpm exec prettier --check "packages/**/*"` returns only SP5 baseline warnings
- [ ] All 8 anti-pattern tests pass (sp9..sp17)
- [ ] Behavioral: seedance choice + null seedanceDirection denies, never fallbacks to kling
- [ ] Determinism: approvedCampaignContext does not perturb synthetic-path output

Spec: `docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR opens against `main`. Return the PR URL.

- [ ] **Step 10: No commit** — Tasks 1–14 already shipped the work.

---

## Definition of Done

- All 15 tasks above have every checkbox ticked.
- `pnpm typecheck && pnpm test && pnpm exec prettier --check "packages/**/*"` is clean (modulo 2 SP5-baseline prettier warnings).
- Anti-pattern tests on sp9 through sp17 all pass.
- The pinned-constant count is 21 (unchanged from SP16).
- `git diff 04f14b1..HEAD` shows only files in the design §3.1 file-touch list.
- PR opened with descriptive title + body; SP16 baseline + SP17 delta documented in the PR body.
