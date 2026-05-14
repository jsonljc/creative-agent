# SP11 — Synthetic Creator Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the data foundation for the synthetic-creator track. Add `CreatorIdentity.kind: "real" | "synthetic"` discriminator, a new `CreatorIdentitySynthetic` extension table with locked persona descriptors / DALL-E prompt / Kling direction / vibe routing keys, a typed `CreativeBrief` zod schema, and a 10-character seed roster (Cheryl, Vivienne, Felicia, Amanda, Nana, Bianca, Hana, Chloe, Elaine, Bua). Ship as one Prisma migration plus the schemas, stores, seed module, and anti-pattern tests. **No selector, no license gate, no disclosure registry, no provider routing, no provenance extension** — all of those are SP12+.

**Architecture:** Strictly additive on the existing `CreatorIdentity` model. SP11 introduces no new behaviour at job time — `kind` defaults to `"real"`, all existing rows remain `"real"`, all existing code paths are untouched. The `CreatorIdentitySynthetic` extension table sits next to `CreatorIdentity` (one row per synthetic creator, zero rows for real creators). Seed data is loaded by a deterministic runner script and is structurally validated against the zod schemas at module-load time.

**Tech Stack:** TypeScript ESM (`.js` relative imports), zod schemas with `.readonly()`, vitest, Prisma + Postgres, pnpm + Turborepo. One Prisma migration. No `apps/api` wiring. No real DALL-E or Kling calls — descriptors and prompts are stored verbatim only.

**Source-of-truth design:** `docs/plans/2026-04-30-pcd-synthetic-creator-roster-design.md` (committed in `b71d32f`, anchored to `CreatorIdentity` in `1a5390b`, slices renumbered in `3b5ab22`).

## User-locked priority invariants (do not violate)

These are non-negotiable. The anti-pattern grep tests in Task 8 enforce items 1–6 structurally.

1. **No edits to SP1–SP10A source bodies.** Acceptable edits: schema barrel re-exports (`schemas/index.ts`, `db/index.ts`, `creative-pipeline/index.ts`), Prisma `schema.prisma` (additive only — new enum, new column on `CreatorIdentity`, new `CreatorIdentitySynthetic` model, new relation back-reference). The `CreatorIdentity` body in `prisma-creator-identity-store.ts`, `prisma-creator-identity-reader.ts`, and the SP1–SP10A pcd source files all stay byte-identical.
2. **`kind` defaults to `"real"`.** Every existing `CreatorIdentity` row remains real after migration. No backfill, no data mutation.
3. **`CreatorIdentitySynthetic` is an extension table, not a replacement.** Real-kind rows have NO row in `CreatorIdentitySynthetic`. Synthetic-kind rows have exactly one. The Prisma relation is one-to-one optional from `CreatorIdentity` side.
4. **Seed data is verbatim.** All 10 characters' `dallePromptLocked`, physical descriptors, Kling direction, voice/caption style strings are copied byte-for-byte from the source persona doc. No paraphrasing, no "improvements". The seed module's tests assert the prompt strings hash to known values.
5. **No SP12+ scope leak.** SP11 does NOT introduce: license gate, disclosure registry, selector module, script template, performance snapshot, decision record, provider routing, provenance extension. Any task ballooning into these areas STOPS and is split.
6. **No real model runners.** Seed data only stores text. Generation, QC, and routing all stay out of SP11.
7. **Existing `CreatorIdentity.consentRecordId` stays nullable.** Synthetic rows leave it null (license gate is SP12); real rows continue to populate via SP6.
8. **One migration, not two.** The `kind` column AND `CreatorIdentitySynthetic` table land in the same migration to keep the database in a single consistent state across the change.

## Pre-flight verification (before starting Task 1)

Run from repo root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: typecheck clean across all 5 packages; test suite green at the SP9 baseline. Capture the test count for the post-flight comparison in Task 9. Anything else red is a baseline issue to investigate before SP11 starts.

Confirm the synthetic-creator branch is checked out and based on `main`:

```bash
git rev-parse --abbrev-ref HEAD
# expect: feat/pcd-synthetic-creator-roster

git log --oneline -3
# expect:
#   3b5ab22 docs(pcd): synthetic creator roster — renumber slices to SP11-SP21
#   1a5390b docs(pcd): synthetic creator roster — anchor data model on CreatorIdentity
#   b71d32f docs(pcd): synthetic creator roster — design spec
```

Capture the SP10A-frozen-source-body baseline for Task 8's structural assertion (used to verify no SP1–SP10A source body changes throughout SP11):

```bash
git rev-parse main
# Note this commit hash; use it as <SP10A_BASELINE> in Task 8 (sp11-anti-patterns.test.ts).
```

---

## Task 1: SP11 zod schemas — synthetic-creator enums + `CreatorIdentitySynthetic`

**Files:**
- Create: `packages/schemas/src/creator-identity-synthetic.ts`
- Create: `packages/schemas/src/__tests__/creator-identity-synthetic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/creator-identity-synthetic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CreatorIdentityKindSchema,
  TreatmentClassSchema,
  VibeSchema,
  MarketSchema,
  EthnicityFamilySchema,
  AgeBandSchema,
  PricePositioningSchema,
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "../creator-identity-synthetic.js";

describe("CreatorIdentityKindSchema", () => {
  it("accepts real and synthetic", () => {
    expect(CreatorIdentityKindSchema.parse("real")).toBe("real");
    expect(CreatorIdentityKindSchema.parse("synthetic")).toBe("synthetic");
  });

  it("rejects unknown kinds", () => {
    expect(() => CreatorIdentityKindSchema.parse("hybrid")).toThrow();
    expect(() => CreatorIdentityKindSchema.parse("")).toThrow();
  });
});

describe("TreatmentClassSchema", () => {
  it("accepts the four v1 treatment classes", () => {
    for (const t of ["med_spa", "dental", "anti_ageing", "halal_wellness"]) {
      expect(TreatmentClassSchema.parse(t)).toBe(t);
    }
  });

  it("rejects slimming (deferred per spec §11)", () => {
    expect(() => TreatmentClassSchema.parse("slimming")).toThrow();
  });
});

describe("VibeSchema", () => {
  it("accepts the six v1 vibes", () => {
    for (const v of [
      "omg_look",
      "quiet_confidence",
      "telling_her_friend",
      "seven_days_later",
      "just_left_clinic",
      "softly_glowing",
    ]) {
      expect(VibeSchema.parse(v)).toBe(v);
    }
  });

  it("rejects skeptic_converted (deferred per spec §11)", () => {
    expect(() => VibeSchema.parse("skeptic_converted")).toThrow();
  });
});

describe("MarketSchema", () => {
  it("accepts SG, MY, HK", () => {
    for (const m of ["SG", "MY", "HK"]) expect(MarketSchema.parse(m)).toBe(m);
  });
});

describe("CreatorIdentitySyntheticPayloadSchema", () => {
  const valid: CreatorIdentitySyntheticPayload = {
    creatorIdentityId: "cid_test_01",
    treatmentClass: "med_spa",
    vibe: "omg_look",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Heart-shaped, pointed chin",
      skinTone: "Light-medium NC20",
      eyeShape: "Double eyelid",
      hair: "Black messy half-bun",
      ageRead: "21-23",
      buildNote: "Petite slim shoulders",
    },
    dallePromptLocked: "Vertical lo-fi selfie photo. ...",
    klingDirection: {
      setting: "Clinic bathroom mirror",
      motion: "Sudden lean into camera",
      energy: "Mouth opening mid-sentence",
      lighting: "Unflattering fluorescent",
      avoid: ["Slow pans", "Beauty lighting"],
    },
    voiceCaptionStyle: {
      voice: "Fast, rising intonation",
      captionStyle: "ALL CAPS moments, lots of ellipses",
      sampleHook: "okay but why did nobody tell me",
      sampleCta: "just go. seriously. just book it.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  };

  it("accepts a fully populated synthetic payload", () => {
    expect(CreatorIdentitySyntheticPayloadSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty dallePromptLocked", () => {
    expect(() =>
      CreatorIdentitySyntheticPayloadSchema.parse({ ...valid, dallePromptLocked: "" }),
    ).toThrow();
  });

  it("rejects a payload missing physicalDescriptors", () => {
    const bad = { ...valid } as Partial<typeof valid>;
    delete (bad as { physicalDescriptors?: unknown }).physicalDescriptors;
    expect(() => CreatorIdentitySyntheticPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects status outside the enum", () => {
    expect(() =>
      CreatorIdentitySyntheticPayloadSchema.parse({ ...valid, status: "deleted" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-synthetic`
Expected: FAIL with "Cannot find module '../creator-identity-synthetic.js'".

- [ ] **Step 3: Write the schema module**

Create `packages/schemas/src/creator-identity-synthetic.ts`:

```ts
// PCD slice SP11 — Synthetic creator identity foundation. Adds the
// `kind` discriminator, the synthetic-only enums (treatment-class /
// vibe / market / ethnicity-family / age-band / price-positioning),
// and the CreatorIdentitySynthetic extension payload. Real-kind
// CreatorIdentity rows are unaffected; synthetic rows pair one-to-one
// with a CreatorIdentitySynthetic row. License gate (SP12), disclosure
// registry (SP13), and selector (SP14) consume these enums but do not
// modify them.
import { z } from "zod";

export const CreatorIdentityKindSchema = z.enum(["real", "synthetic"]);
export type CreatorIdentityKind = z.infer<typeof CreatorIdentityKindSchema>;

// v1 treatment classes — slimming is deferred per spec §11 (regulatory
// exposure). Adding a new class requires a new DisclosureTemplate row
// per (jurisdiction × platform × treatment-class) — see SP13.
export const TreatmentClassSchema = z.enum([
  "med_spa",
  "dental",
  "anti_ageing",
  "halal_wellness",
]);
export type TreatmentClass = z.infer<typeof TreatmentClassSchema>;

// v1 vibes — skeptic_converted is deferred per spec §11 (Phase 3).
export const VibeSchema = z.enum([
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
]);
export type Vibe = z.infer<typeof VibeSchema>;

export const MarketSchema = z.enum(["SG", "MY", "HK"]);
export type Market = z.infer<typeof MarketSchema>;

export const EthnicityFamilySchema = z.enum([
  "sg_chinese",
  "my_chinese",
  "thai_chinese",
  "filipino_sg",
  "my_malay",
  "hk_chinese",
]);
export type EthnicityFamily = z.infer<typeof EthnicityFamilySchema>;

export const AgeBandSchema = z.enum([
  "gen_z",
  "mid_20s",
  "early_30s",
  "mid_30s_plus",
]);
export type AgeBand = z.infer<typeof AgeBandSchema>;

export const PricePositioningSchema = z.enum(["entry", "standard", "premium"]);
export type PricePositioning = z.infer<typeof PricePositioningSchema>;

export const SyntheticStatusSchema = z.enum(["active", "retired"]);
export type SyntheticStatus = z.infer<typeof SyntheticStatusSchema>;

export const PhysicalDescriptorsSchema = z
  .object({
    faceShape: z.string().min(1),
    skinTone: z.string().min(1),
    eyeShape: z.string().min(1),
    hair: z.string().min(1),
    ageRead: z.string().min(1),
    buildNote: z.string().min(1),
  })
  .readonly();
export type PhysicalDescriptors = z.infer<typeof PhysicalDescriptorsSchema>;

export const KlingDirectionSchema = z
  .object({
    setting: z.string().min(1),
    motion: z.string().min(1),
    energy: z.string().min(1),
    lighting: z.string().min(1),
    avoid: z.array(z.string().min(1)).readonly(),
  })
  .readonly();
export type KlingDirection = z.infer<typeof KlingDirectionSchema>;

export const VoiceCaptionStyleSchema = z
  .object({
    voice: z.string().min(1),
    captionStyle: z.string().min(1),
    sampleHook: z.string().min(1),
    sampleCta: z.string().min(1),
  })
  .readonly();
export type VoiceCaptionStyle = z.infer<typeof VoiceCaptionStyleSchema>;

export const CreatorIdentitySyntheticPayloadSchema = z
  .object({
    creatorIdentityId: z.string().min(1),
    treatmentClass: TreatmentClassSchema,
    vibe: VibeSchema,
    market: MarketSchema,
    ethnicityFamily: EthnicityFamilySchema,
    ageBand: AgeBandSchema,
    pricePositioning: PricePositioningSchema,
    physicalDescriptors: PhysicalDescriptorsSchema,
    dallePromptLocked: z.string().min(1).max(4000),
    klingDirection: KlingDirectionSchema,
    voiceCaptionStyle: VoiceCaptionStyleSchema,
    mutuallyExclusiveWithIds: z.array(z.string().min(1)).readonly(),
    status: SyntheticStatusSchema,
  })
  .readonly();
export type CreatorIdentitySyntheticPayload = z.infer<
  typeof CreatorIdentitySyntheticPayloadSchema
>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-synthetic`
Expected: PASS, all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/creator-identity-synthetic.ts packages/schemas/src/__tests__/creator-identity-synthetic.test.ts
git commit -m "feat(pcd): SP11 — synthetic creator identity zod schemas"
```

---

## Task 2: SP11 zod schema — `CreativeBrief`

**Files:**
- Create: `packages/schemas/src/creative-brief.ts`
- Create: `packages/schemas/src/__tests__/creative-brief.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/creative-brief.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CreativeBriefSchema,
  JurisdictionCodeSchema,
  PlatformSchema,
  type CreativeBrief,
} from "../creative-brief.js";

describe("JurisdictionCodeSchema", () => {
  it("accepts SG, MY, HK", () => {
    for (const j of ["SG", "MY", "HK"]) expect(JurisdictionCodeSchema.parse(j)).toBe(j);
  });
});

describe("PlatformSchema", () => {
  it("accepts the four v1 platforms", () => {
    for (const p of ["meta", "tiktok", "red", "youtube_shorts"]) {
      expect(PlatformSchema.parse(p)).toBe(p);
    }
  });

  it("rejects unknown platforms", () => {
    expect(() => PlatformSchema.parse("snapchat")).toThrow();
  });
});

describe("CreativeBriefSchema", () => {
  const valid: CreativeBrief = {
    briefId: "brf_2026_04_30_test",
    clinicId: "clinic_test_01",
    treatmentClass: "med_spa",
    market: "SG",
    jurisdictionCode: "SG",
    platform: "meta",
    targetVibe: "omg_look",
    targetEthnicityFamily: "sg_chinese",
    targetAgeBand: "mid_20s",
    pricePositioning: "entry",
    hardConstraints: [],
  };

  it("accepts a minimal valid brief", () => {
    expect(CreativeBriefSchema.parse(valid)).toEqual(valid);
  });

  it("rejects briefs without a briefId", () => {
    const bad = { ...valid } as Partial<typeof valid>;
    delete (bad as { briefId?: unknown }).briefId;
    expect(() => CreativeBriefSchema.parse(bad)).toThrow();
  });

  it("allows market !== jurisdictionCode in principle (operator override)", () => {
    expect(CreativeBriefSchema.parse({ ...valid, market: "MY", jurisdictionCode: "MY" })).toBeDefined();
  });

  it("rejects empty briefId strings", () => {
    expect(() => CreativeBriefSchema.parse({ ...valid, briefId: "" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test creative-brief`
Expected: FAIL with "Cannot find module '../creative-brief.js'".

- [ ] **Step 3: Write the schema module**

Create `packages/schemas/src/creative-brief.ts`:

```ts
// PCD slice SP11 — CreativeBrief schema. The structured contract that
// pre-production analysis emits and the SP14 SyntheticCreatorSelector
// consumes. Two-stage selection: LLM analysis is reviewable, selector
// is pure and deterministic over this typed brief.
import { z } from "zod";
import {
  AgeBandSchema,
  EthnicityFamilySchema,
  MarketSchema,
  PricePositioningSchema,
  TreatmentClassSchema,
  VibeSchema,
} from "./creator-identity-synthetic.js";

export const JurisdictionCodeSchema = z.enum(["SG", "MY", "HK"]);
export type JurisdictionCode = z.infer<typeof JurisdictionCodeSchema>;

export const PlatformSchema = z.enum(["meta", "tiktok", "red", "youtube_shorts"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const CreativeBriefSchema = z
  .object({
    briefId: z.string().min(1),
    clinicId: z.string().min(1),
    treatmentClass: TreatmentClassSchema,
    market: MarketSchema,
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    targetVibe: VibeSchema,
    targetEthnicityFamily: EthnicityFamilySchema,
    targetAgeBand: AgeBandSchema,
    pricePositioning: PricePositioningSchema,
    hardConstraints: z.array(z.string().min(1)).readonly(),
  })
  .readonly();
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test creative-brief`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/creative-brief.ts packages/schemas/src/__tests__/creative-brief.test.ts
git commit -m "feat(pcd): SP11 — CreativeBrief zod schema"
```

---

## Task 3: Schema barrel re-exports

**Files:**
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schemas/src/__tests__/creator-identity-synthetic.test.ts` at the bottom:

```ts
import * as barrel from "../index.js";

describe("schemas package barrel", () => {
  it("re-exports SP11 synthetic-creator surface", () => {
    expect(barrel.CreatorIdentityKindSchema).toBeDefined();
    expect(barrel.TreatmentClassSchema).toBeDefined();
    expect(barrel.VibeSchema).toBeDefined();
    expect(barrel.MarketSchema).toBeDefined();
    expect(barrel.EthnicityFamilySchema).toBeDefined();
    expect(barrel.AgeBandSchema).toBeDefined();
    expect(barrel.PricePositioningSchema).toBeDefined();
    expect(barrel.CreatorIdentitySyntheticPayloadSchema).toBeDefined();
  });

  it("re-exports SP11 CreativeBrief surface", () => {
    expect(barrel.CreativeBriefSchema).toBeDefined();
    expect(barrel.JurisdictionCodeSchema).toBeDefined();
    expect(barrel.PlatformSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/schemas test creator-identity-synthetic`
Expected: FAIL with "barrel.CreatorIdentityKindSchema is undefined" (or similar).

- [ ] **Step 3: Add re-exports**

Modify `packages/schemas/src/index.ts` — append at end:

```ts
// SP11 — synthetic creator foundation
export * from "./creator-identity-synthetic.js";
export * from "./creative-brief.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/schemas test`
Expected: full schemas test suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/index.ts packages/schemas/src/__tests__/creator-identity-synthetic.test.ts
git commit -m "feat(pcd): SP11 — re-export synthetic creator + CreativeBrief from package barrel"
```

---

## Task 4: Prisma migration — `kind` enum/column + `CreatorIdentitySynthetic` table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_creator_identity_synthetic_sp11/migration.sql`

- [ ] **Step 1: Edit `schema.prisma` — add the enum**

At the top of the file (after the `datasource db {...}` block), add:

```prisma
enum CreatorIdentityKind {
  real
  synthetic
}
```

- [ ] **Step 2: Edit `schema.prisma` — add `kind` column on `CreatorIdentity`**

Find the `CreatorIdentity` model. After the existing `qualityTier String?` field (or anywhere logical inside the model body), add:

```prisma
  // SP11 — synthetic creator support. Default "real" preserves all
  // existing rows; synthetic rows pair one-to-one with CreatorIdentitySynthetic.
  kind                CreatorIdentityKind @default(real)
  syntheticProfile    CreatorIdentitySynthetic?
```

- [ ] **Step 3: Edit `schema.prisma` — add the new model**

After the `CreatorIdentity` model (and its `@@index` block), add:

```prisma
// ── PCD slice SP11 — synthetic creator extension table ──
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
  voiceCaptionStyle         Json

  mutuallyExclusiveWithIds  String[]        @default([])
  status                    String          @default("active")

  createdAt                 DateTime        @default(now())
  updatedAt                 DateTime        @updatedAt

  @@index([treatmentClass, market])
  @@index([vibe])
  @@index([status])
}
```

> Note: the enum-typed columns (`treatmentClass`, `vibe`, etc.) are stored as `String` rather than Postgres enums. Rationale: zod owns the value-set contract; Postgres enums in this codebase are reserved for cases where DB-level invariants matter (e.g. `CreatorIdentityKind` is an enum because it gates routing). Synthetic dimension enums can grow (e.g. new vibes) without DB migrations this way.

- [ ] **Step 4: Generate the Prisma client + migration**

Run from repo root:

```bash
pnpm db:generate
pnpm db:migrate -- --name pcd_creator_identity_synthetic_sp11
```

Expected:
- A new directory `packages/db/prisma/migrations/<timestamp>_pcd_creator_identity_synthetic_sp11/`
- `migration.sql` containing: `CREATE TYPE "CreatorIdentityKind"`, `ALTER TABLE "CreatorIdentity" ADD COLUMN "kind"`, `CREATE TABLE "CreatorIdentitySynthetic"`, plus indexes
- No drops, no renames, no data backfills

- [ ] **Step 5: Verify migration content**

Open the generated `migration.sql`. Assert manually:
- The `ALTER TABLE "CreatorIdentity" ADD COLUMN "kind"` line includes `DEFAULT 'real'` and `NOT NULL`.
- No `DROP` statements.
- The `CreatorIdentitySynthetic` `creatorIdentityId` column is `PRIMARY KEY` and has a foreign-key constraint with `ON DELETE CASCADE`.

If any of these are missing, fix `schema.prisma` and regenerate (delete the partial migration directory first).

- [ ] **Step 6: Run tests to verify nothing else broke**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, all existing tests still green. Some tests may break if they construct `CreatorIdentity` mocks — the executor must add `kind: "real"` to those fixtures (additive only, no semantic change).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git add -p   # stage any test fixture additions of `kind: "real"`
git commit -m "feat(pcd): SP11 — Prisma migration for kind discriminator + CreatorIdentitySynthetic"
```

---

## Task 5: db store + reader — `PrismaCreatorIdentitySyntheticStore`

**Files:**
- Create: `packages/db/src/stores/prisma-creator-identity-synthetic-store.ts`
- Create: `packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts`
- Create: `packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaCreatorIdentitySyntheticStore } from "../prisma-creator-identity-synthetic-store.js";
import { PrismaCreatorIdentitySyntheticReader } from "../prisma-creator-identity-synthetic-reader.js";
import type { CreatorIdentitySyntheticPayload } from "@creativeagent/schemas";

const prisma = new PrismaClient();
const store = new PrismaCreatorIdentitySyntheticStore(prisma);
const reader = new PrismaCreatorIdentitySyntheticReader(prisma);

const payload = (overrides: Partial<CreatorIdentitySyntheticPayload> = {}): CreatorIdentitySyntheticPayload => ({
  creatorIdentityId: "cid_sp11_test_001",
  treatmentClass: "med_spa",
  vibe: "omg_look",
  market: "SG",
  ethnicityFamily: "sg_chinese",
  ageBand: "mid_20s",
  pricePositioning: "entry",
  physicalDescriptors: {
    faceShape: "Heart-shaped",
    skinTone: "NC20",
    eyeShape: "Double eyelid",
    hair: "Black messy",
    ageRead: "21-23",
    buildNote: "Petite",
  },
  dallePromptLocked: "Vertical lo-fi selfie photo. ...",
  klingDirection: {
    setting: "Clinic bathroom",
    motion: "Sudden lean",
    energy: "Mouth opening",
    lighting: "Fluorescent",
    avoid: ["Slow pans"],
  },
  voiceCaptionStyle: {
    voice: "Fast, breathy",
    captionStyle: "lowercase",
    sampleHook: "okay but",
    sampleCta: "just go",
  },
  mutuallyExclusiveWithIds: [],
  status: "active",
  ...overrides,
});

beforeEach(async () => {
  // Create the parent CreatorIdentity row first (kind: synthetic).
  await prisma.creatorIdentity.create({
    data: {
      id: "cid_sp11_test_001",
      deploymentId: "dep_sp11_test",
      name: "SP11 Test Synthetic",
      identityRefIds: [],
      heroImageAssetId: "asset_placeholder",
      identityDescription: "Test fixture",
      voice: { voiceId: "v_test", provider: "elevenlabs", tone: "test", pace: "moderate", sampleUrl: "" },
      personality: { energy: "energetic", deliveryStyle: "test" },
      appearanceRules: {},
      environmentSet: [],
      kind: "synthetic",
    },
  });
});

afterEach(async () => {
  await prisma.creatorIdentitySynthetic.deleteMany({ where: { creatorIdentityId: "cid_sp11_test_001" } });
  await prisma.creatorIdentity.deleteMany({ where: { id: "cid_sp11_test_001" } });
});

describe("PrismaCreatorIdentitySyntheticStore.create", () => {
  it("persists a synthetic payload and reader retrieves it", async () => {
    await store.create(payload());

    const found = await reader.findById("cid_sp11_test_001");
    expect(found).toBeDefined();
    expect(found?.dallePromptLocked).toBe("Vertical lo-fi selfie photo. ...");
    expect(found?.treatmentClass).toBe("med_spa");
  });

  it("rejects a payload that fails zod validation", async () => {
    await expect(
      store.create({ ...payload(), dallePromptLocked: "" }),
    ).rejects.toThrow();
  });

  it("upserts on duplicate creatorIdentityId", async () => {
    await store.create(payload({ vibe: "omg_look" }));
    await store.create(payload({ vibe: "telling_her_friend" }));

    const found = await reader.findById("cid_sp11_test_001");
    expect(found?.vibe).toBe("telling_her_friend");
  });
});

describe("PrismaCreatorIdentitySyntheticReader.findByMarketAndTreatmentClass", () => {
  it("returns rows matching (market, treatmentClass) and active status", async () => {
    await store.create(payload());
    const found = await reader.findByMarketAndTreatmentClass("SG", "med_spa");
    expect(found).toHaveLength(1);
    expect(found[0]?.creatorIdentityId).toBe("cid_sp11_test_001");
  });

  it("excludes retired rows", async () => {
    await store.create(payload({ status: "retired" }));
    const found = await reader.findByMarketAndTreatmentClass("SG", "med_spa");
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/db test prisma-creator-identity-synthetic-store`
Expected: FAIL with "Cannot find module '../prisma-creator-identity-synthetic-store.js'".

- [ ] **Step 3: Write the store**

Create `packages/db/src/stores/prisma-creator-identity-synthetic-store.ts`:

```ts
// PCD slice SP11 — write surface for CreatorIdentitySynthetic.
// Validates input via the SP11 zod schema before any DB write.
// Upsert semantics on (creatorIdentityId) — the parent CreatorIdentity
// row must exist and have kind = "synthetic".
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentitySyntheticStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatorIdentitySyntheticPayload): Promise<void> {
    const payload = CreatorIdentitySyntheticPayloadSchema.parse(input);

    await this.prisma.creatorIdentitySynthetic.upsert({
      where: { creatorIdentityId: payload.creatorIdentityId },
      create: {
        creatorIdentityId: payload.creatorIdentityId,
        treatmentClass: payload.treatmentClass,
        vibe: payload.vibe,
        market: payload.market,
        ethnicityFamily: payload.ethnicityFamily,
        ageBand: payload.ageBand,
        pricePositioning: payload.pricePositioning,
        physicalDescriptors: payload.physicalDescriptors,
        dallePromptLocked: payload.dallePromptLocked,
        klingDirection: payload.klingDirection,
        voiceCaptionStyle: payload.voiceCaptionStyle,
        mutuallyExclusiveWithIds: [...payload.mutuallyExclusiveWithIds],
        status: payload.status,
      },
      update: {
        treatmentClass: payload.treatmentClass,
        vibe: payload.vibe,
        market: payload.market,
        ethnicityFamily: payload.ethnicityFamily,
        ageBand: payload.ageBand,
        pricePositioning: payload.pricePositioning,
        physicalDescriptors: payload.physicalDescriptors,
        dallePromptLocked: payload.dallePromptLocked,
        klingDirection: payload.klingDirection,
        voiceCaptionStyle: payload.voiceCaptionStyle,
        mutuallyExclusiveWithIds: [...payload.mutuallyExclusiveWithIds],
        status: payload.status,
      },
    });
  }
}
```

- [ ] **Step 4: Write the reader**

Create `packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts`:

```ts
// PCD slice SP11 — read surface for CreatorIdentitySynthetic.
// Pure read methods. The compatible-set queries here are consumed by
// the SP14 SyntheticCreatorSelector — keep the result shape stable so
// the selector contract doesn't churn as new fields are added.
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
  type Market,
  type TreatmentClass,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentitySyntheticReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(
    creatorIdentityId: string,
  ): Promise<CreatorIdentitySyntheticPayload | null> {
    const row = await this.prisma.creatorIdentitySynthetic.findUnique({
      where: { creatorIdentityId },
    });
    if (!row) return null;
    return this.parse(row);
  }

  async findByMarketAndTreatmentClass(
    market: Market,
    treatmentClass: TreatmentClass,
  ): Promise<CreatorIdentitySyntheticPayload[]> {
    const rows = await this.prisma.creatorIdentitySynthetic.findMany({
      where: { market, treatmentClass, status: "active" },
      orderBy: [{ pricePositioning: "desc" }, { creatorIdentityId: "asc" }],
    });
    return rows.map((r) => this.parse(r));
  }

  async listAll(): Promise<CreatorIdentitySyntheticPayload[]> {
    const rows = await this.prisma.creatorIdentitySynthetic.findMany({
      orderBy: { creatorIdentityId: "asc" },
    });
    return rows.map((r) => this.parse(r));
  }

  private parse(row: {
    creatorIdentityId: string;
    treatmentClass: string;
    vibe: string;
    market: string;
    ethnicityFamily: string;
    ageBand: string;
    pricePositioning: string;
    physicalDescriptors: unknown;
    dallePromptLocked: string;
    klingDirection: unknown;
    voiceCaptionStyle: unknown;
    mutuallyExclusiveWithIds: string[];
    status: string;
  }): CreatorIdentitySyntheticPayload {
    return CreatorIdentitySyntheticPayloadSchema.parse({
      creatorIdentityId: row.creatorIdentityId,
      treatmentClass: row.treatmentClass,
      vibe: row.vibe,
      market: row.market,
      ethnicityFamily: row.ethnicityFamily,
      ageBand: row.ageBand,
      pricePositioning: row.pricePositioning,
      physicalDescriptors: row.physicalDescriptors,
      dallePromptLocked: row.dallePromptLocked,
      klingDirection: row.klingDirection,
      voiceCaptionStyle: row.voiceCaptionStyle,
      mutuallyExclusiveWithIds: row.mutuallyExclusiveWithIds,
      status: row.status,
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/db test prisma-creator-identity-synthetic-store`
Expected: PASS, all 5 tests green. (Tests assume a running Postgres with a clean dev DB — same convention as SP1–SP10A.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-creator-identity-synthetic-store.ts packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts
git commit -m "feat(pcd): SP11 — Prisma store + reader for CreatorIdentitySynthetic"
```

---

## Task 6: db barrel re-exports

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Find the existing barrel pattern**

Run: `cat packages/db/src/index.ts`
Note the existing re-export style (e.g. `export { PrismaCreatorIdentityStore } from "./stores/prisma-creator-identity-store.js";`). Match it.

- [ ] **Step 2: Add the SP11 re-exports**

Append to `packages/db/src/index.ts`:

```ts
// SP11 — synthetic creator foundation
export { PrismaCreatorIdentitySyntheticStore } from "./stores/prisma-creator-identity-synthetic-store.js";
export { PrismaCreatorIdentitySyntheticReader } from "./stores/prisma-creator-identity-synthetic-reader.js";
```

- [ ] **Step 3: Run typecheck to verify no path issues**

Run: `pnpm --filter @creativeagent/db typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(pcd): SP11 — re-export synthetic store + reader from db barrel"
```

---

## Task 7: 10-character seed module

**Files:**
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/seed.test.ts`
- Create: `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`

- [ ] **Step 1: Create the seed-module directory and write the failing tests**

```bash
mkdir -p packages/creative-pipeline/src/pcd/synthetic-creator
```

Create `packages/creative-pipeline/src/pcd/synthetic-creator/seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER, SP11_ROSTER_SIZE } from "./seed.js";

describe("SP11 synthetic creator seed roster", () => {
  it("contains exactly 10 characters", () => {
    expect(SP11_ROSTER_SIZE).toBe(10);
    expect(SP11_SYNTHETIC_CREATOR_ROSTER).toHaveLength(10);
  });

  it("every entry has a unique creatorIdentityId", () => {
    const ids = SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.creatorIdentityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every synthetic payload validates against the schema", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(() => CreatorIdentitySyntheticPayloadSchema.parse(c.synthetic)).not.toThrow();
    }
  });

  it("every mutuallyExclusiveWithIds reference resolves to another roster member", () => {
    const ids = new Set(
      SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.creatorIdentityId),
    );
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      for (const ref of c.synthetic.mutuallyExclusiveWithIds) {
        expect(ids.has(ref)).toBe(true);
      }
    }
  });

  it("Nana and Bua are mutually exclusive (Thai-Chinese substitution)", () => {
    const nana = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.creatorIdentity.name === "Nana");
    const bua = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.creatorIdentity.name === "Bua");
    expect(nana).toBeDefined();
    expect(bua).toBeDefined();
    expect(nana?.synthetic.mutuallyExclusiveWithIds).toContain(bua?.synthetic.creatorIdentityId);
    expect(bua?.synthetic.mutuallyExclusiveWithIds).toContain(nana?.synthetic.creatorIdentityId);
  });

  it("the roster covers all four v1 treatment classes", () => {
    const classes = new Set(SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.treatmentClass));
    expect(classes.has("med_spa")).toBe(true);
    expect(classes.has("dental")).toBe(true);
    expect(classes.has("anti_ageing")).toBe(true);
    expect(classes.has("halal_wellness")).toBe(true);
  });

  it("the roster covers all three v1 markets", () => {
    const markets = new Set(SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.market));
    expect(markets).toEqual(new Set(["SG", "MY", "HK"]));
  });

  it("every dallePromptLocked starts with the locked phrase 'Vertical lo-fi selfie photo'", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(c.synthetic.dallePromptLocked).toMatch(/^Vertical lo-fi selfie photo\./);
    }
  });

  it("every entry has a CreatorIdentity stub with kind: 'synthetic'", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(c.creatorIdentity.kind).toBe("synthetic");
      expect(c.creatorIdentity.id).toBe(c.synthetic.creatorIdentityId);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/seed`
Expected: FAIL with "Cannot find module './seed.js'".

- [ ] **Step 3: Write the seed module**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts`. **Verbatim transcription** of the source persona doc (CREATOR 01 — Cheryl through CREATOR 10 — Bua). Each entry pairs a `CreatorIdentity` stub (`kind: "synthetic"`) with a `CreatorIdentitySyntheticPayload`. **Do not paraphrase the DALL-E prompts, descriptors, or sample hooks.** The hash-based test in Task 8 will catch drift.

```ts
// PCD slice SP11 — synthetic creator seed roster (Phase 1 + 2, 10 creators).
// Source-of-truth: persona doc shared on 2026-04-30 (Switchboard Internal,
// Phase 1+2 Persona Library). Every dallePromptLocked, descriptor, and
// sample hook is copied verbatim. The SP11 anti-pattern test asserts the
// full prompt strings hash to known values to prevent silent drift.
import type { CreatorIdentitySyntheticPayload } from "@creativeagent/schemas";

interface CreatorIdentityStub {
  id: string;
  name: string;
  kind: "synthetic";
}

interface RosterEntry {
  creatorIdentity: CreatorIdentityStub;
  synthetic: CreatorIdentitySyntheticPayload;
}

const cheryl: RosterEntry = {
  creatorIdentity: { id: "cid_synth_cheryl_sg_01", name: "Cheryl", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_cheryl_sg_01",
    treatmentClass: "med_spa",
    vibe: "omg_look",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Heart-shaped, pointed chin, slightly wide forehead",
      skinTone: "Light-medium, cool-neutral undertone, NC20-NC25",
      eyeShape: "Double eyelid, slightly upturned outer corners, bright and wide",
      hair: "Black, messy half-bun with flyaways, like she just threw it up",
      ageRead: "Looks 21-23, baby-faced",
      buildNote: "Petite, slim shoulders, slight collarbone visible",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Young Chinese Singaporean woman, 23 years old, heart-shaped face with pointed chin and slightly wide forehead, light-medium cool-neutral skin tone NC20-NC25, bright wide double-eyelid eyes slightly upturned at outer corners, black hair in a messy half-bun with flyaways, petite slim shoulders. She is in a clinic bathroom, filming herself in the mirror, phone visible in frame, chaotic excited expression — mouth slightly open like she just gasped. She has a slight flush on her cheeks and a subtle sheen on her skin indicating she just had a treatment. Wearing a clinic wristband on one wrist. Casual clothes, nothing styled. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, natural fluorescent bathroom lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic bathroom mirror, phone visibly in hand",
      motion: "Sudden lean into camera, then pull back excitedly",
      energy: "Mouth opening mid-sentence, gesturing with free hand",
      lighting: "Unflattering fluorescent — keep it real",
      avoid: ["Slow pans", "Beauty lighting", "Transitions", "Music sync"],
    },
    voiceCaptionStyle: {
      voice: "Fast, rising intonation, slight breathiness",
      captionStyle: "ALL CAPS moments, lots of ellipses, \"okay but\"",
      sampleHook: "okay but why did nobody tell me how good this would feel",
      sampleCta: "just go. seriously. just book it.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

// Continue for the remaining 9 characters: Vivienne, Felicia, Amanda, Nana,
// Bianca, Hana, Chloe, Elaine, Bua. Each entry follows Cheryl's shape exactly.
// Source data:
//   CREATOR 02 — VIVIENNE  · cid_synth_vivienne_sg_02  · SG / SG-Chinese / 29 / med_spa+dental / quiet_confidence
//   CREATOR 03 — FELICIA   · cid_synth_felicia_my_03   · MY / MY-Chinese / 25 / med_spa / telling_her_friend
//   CREATOR 04 — AMANDA    · cid_synth_amanda_my_04    · MY / MY-Chinese / 31 / dental / seven_days_later
//   CREATOR 05 — NANA      · cid_synth_nana_th_05      · SG-MY / Thai-Chinese / 25 / med_spa / softly_glowing
//                              mutuallyExclusiveWithIds: ["cid_synth_bua_th_10"]
//   CREATOR 06 — BIANCA    · cid_synth_bianca_sg_06    · SG / Filipino-SG / 26 / dental+med_spa / telling_her_friend
//   CREATOR 07 — HANA      · cid_synth_hana_my_07      · MY / MY-Malay / 26 / halal_wellness / just_left_clinic
//   CREATOR 08 — CHLOE     · cid_synth_chloe_hk_08     · HK / HK-Chinese / 28 / anti_ageing / quiet_confidence
//                              pricePositioning: "premium"
//   CREATOR 09 — ELAINE    · cid_synth_elaine_sg_09    · SG / SG-Chinese / 34 / anti_ageing / seven_days_later
//                              ageBand: "mid_30s_plus"
//   CREATOR 10 — BUA       · cid_synth_bua_th_10       · SG-MY / Thai-Chinese / 22 / med_spa / omg_look
//                              ageBand: "gen_z"
//                              mutuallyExclusiveWithIds: ["cid_synth_nana_th_05"]
//
// For Bianca (multi-treatment) and Vivienne (multi-treatment): pick the
// PRIMARY treatmentClass per the source doc — Vivienne = med_spa,
// Bianca = dental. Multi-treatment routing is SP14 selector logic, not
// SP11 schema concerns; the seed picks one for v1.
//
// The full text bodies (DALL-E prompts, descriptors, sample hooks, etc.)
// are copied verbatim from the persona doc. Treatment-class fallback
// for niche cases:
//   - "fillers" / "skin boosters" / "laser" / "Profhilo"  → med_spa
//   - "veneers" / "Invisalign" / "whitening"              → dental
//   - "HIFU" / "thread lift" / "collagen"                 → anti_ageing
//   - "halal-certified med spa" / "wellness"              → halal_wellness

const vivienne: RosterEntry = { /* ... full verbatim entry ... */ } as RosterEntry;
const felicia:  RosterEntry = { /* ... */ } as RosterEntry;
const amanda:   RosterEntry = { /* ... */ } as RosterEntry;
const nana:     RosterEntry = { /* ... */ } as RosterEntry;
const bianca:   RosterEntry = { /* ... */ } as RosterEntry;
const hana:     RosterEntry = { /* ... */ } as RosterEntry;
const chloe:    RosterEntry = { /* ... */ } as RosterEntry;
const elaine:   RosterEntry = { /* ... */ } as RosterEntry;
const bua:      RosterEntry = { /* ... */ } as RosterEntry;

export const SP11_SYNTHETIC_CREATOR_ROSTER: readonly RosterEntry[] = [
  cheryl,
  vivienne,
  felicia,
  amanda,
  nana,
  bianca,
  hana,
  chloe,
  elaine,
  bua,
] as const;

export const SP11_ROSTER_SIZE = SP11_SYNTHETIC_CREATOR_ROSTER.length;
```

> **Important for executor:** The `/* ... full verbatim entry ... */` placeholders are NOT acceptable in the final code — the executor must transcribe each character's full block from the persona doc following Cheryl's pattern. The plan keeps Cheryl's full entry in the example as the canonical template; the others must match its structure exactly. Run the tests after each character's block is added; all 9 schema-validation tests must remain green throughout.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test pcd/synthetic-creator/seed`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Add the package barrel for the synthetic-creator subdir**

Create `packages/creative-pipeline/src/pcd/synthetic-creator/index.ts`:

```ts
// PCD slice SP11 — synthetic creator package barrel.
export {
  SP11_SYNTHETIC_CREATOR_ROSTER,
  SP11_ROSTER_SIZE,
} from "./seed.js";
```

Update `packages/creative-pipeline/src/pcd/index.ts` (or whichever existing barrel re-exports the pcd subdirs — the executor verifies via `cat`) to include:

```ts
export * from "./synthetic-creator/index.js";
```

- [ ] **Step 6: Run typecheck across the monorepo**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/creative-pipeline/src/pcd/synthetic-creator/
git add packages/creative-pipeline/src/pcd/index.ts
git commit -m "feat(pcd): SP11 — 10-character synthetic creator seed roster"
```

---

## Task 8: SP11 anti-pattern grep tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts`

- [ ] **Step 1: Write the anti-pattern test**

Create `packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts`:

```ts
// SP11 anti-pattern grep tests. These guard against:
//   1. SP12+ scope leak (no license / disclosure / selector imports in SP11 files)
//   2. SP1-SP10A source body changes (only the additive Prisma `kind` column allowed)
//   3. Synthetic seed prompt drift (locked text bodies hash to known values)
//   4. Real model runners showing up in SP11 (DALL-E / Kling calls forbidden)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./synthetic-creator/seed.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

const grepFiles = (pattern: string, scope: string): string[] => {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return []; // grep exits 1 on no match
  }
}

describe("SP11 anti-patterns", () => {
  it("seed file does not import SP12+ modules (license/disclosure/selector/snapshot)", () => {
    const seedPath = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts");
    const seedSrc = readFileSync(seedPath, "utf8");
    expect(seedSrc).not.toMatch(/license|disclosure|selector|performance-snapshot|script-template/i);
  });

  it("CreatorIdentity migration adds kind column without dropping anything", () => {
    const migrations = execSync(
      "ls packages/db/prisma/migrations | grep -i synthetic_sp11",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(migrations.length).toBeGreaterThan(0);
    const migrationPath = path.join(
      REPO_ROOT,
      "packages/db/prisma/migrations",
      migrations,
      "migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE TYPE "CreatorIdentityKind"/);
    expect(sql).toMatch(/ADD COLUMN "kind"/);
    expect(sql).toMatch(/CREATE TABLE "CreatorIdentitySynthetic"/);
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
  });

  it("no SP11 source file calls DALL-E or Kling APIs", () => {
    const hits = grepFiles(
      "(openai\\.images|dalle|kling|fetch.*kling|fetch.*openai)",
      "packages/creative-pipeline/src/pcd/synthetic-creator",
    );
    expect(hits).toEqual([]);
  });

  it("seed dallePromptLocked strings hash to expected values (drift sentinel)", () => {
    // Update these hashes ONLY when intentionally revising a character's
    // locked prompt. A green diff in this test means a prompt mutated
    // without an update to the sentinel — likely silent drift.
    const expected: Record<string, string> = {
      cid_synth_cheryl_sg_01: hashOf(
        SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.synthetic.creatorIdentityId === "cid_synth_cheryl_sg_01")!
          .synthetic.dallePromptLocked,
      ),
      // The executor records each of the other 9 hashes here after
      // transcribing the seed — running this test once with empty values
      // produces the actual hashes in the failure message; copy them in.
    };

    for (const [id, expectedHash] of Object.entries(expected)) {
      const entry = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.synthetic.creatorIdentityId === id);
      expect(entry).toBeDefined();
      expect(hashOf(entry!.synthetic.dallePromptLocked)).toBe(expectedHash);
    }
  });

  it("CreatorIdentity Prisma model body contains the additive kind column and no other SP11-introduced fields", () => {
    const schemaPath = path.join(REPO_ROOT, "packages/db/prisma/schema.prisma");
    const src = readFileSync(schemaPath, "utf8");
    expect(src).toMatch(/model CreatorIdentity \{[\s\S]+kind\s+CreatorIdentityKind\s+@default\(real\)/);
    // Reject any non-kind synthetic-only field accidentally added inline:
    const creatorIdentityBlock = src.split("model CreatorIdentity")[1]?.split(/^model /m)[0] ?? "";
    expect(creatorIdentityBlock).not.toMatch(/dallePromptLocked|treatmentClass|vibe\s+String/);
  });
});

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
```

- [ ] **Step 2: Run tests; on the hash-drift test, copy the actual hashes into `expected`**

Run: `pnpm --filter @creativeagent/creative-pipeline test sp11-anti-patterns`

The hash-drift test will fail initially with output like:
```
Expected:
Received: "a1b2c3d4..."
```
For each of the 10 characters, copy the received hash into `expected[<id>]`. Re-run until green.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: all green. The drift sentinel is now armed.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts
git commit -m "test(pcd): SP11 — anti-pattern grep tests (scope leak, SP1-10A freeze, prompt drift sentinel)"
```

---

## Task 9: Verification + branch summary

- [ ] **Step 1: Full repo verification**

Run from repo root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: typecheck clean, full test suite green (SP9 baseline + SP11 additions, ~30+ new tests across schemas / db / creative-pipeline). Prettier clean (or only the pre-existing SP5-baseline noise on `tier-policy.ts` — leave as-is).

- [ ] **Step 2: Migration smoke test against a fresh DB**

```bash
pnpm db:reset --skip-seed
pnpm db:migrate deploy
psql $DATABASE_URL -c "\d \"CreatorIdentitySynthetic\""
psql $DATABASE_URL -c "SELECT enum_range(NULL::\"CreatorIdentityKind\")"
```

Expected:
- `CreatorIdentitySynthetic` table exists with all expected columns
- `CreatorIdentityKind` enum returns `{real, synthetic}`
- No errors

- [ ] **Step 3: Run the seed against the dev DB and verify roundtrip**

```ts
// Run via: pnpm --filter @creativeagent/creative-pipeline ts-node-esm scripts/sp11-load-seed.ts
import { PrismaClient } from "@prisma/client";
import { PrismaCreatorIdentitySyntheticStore, PrismaCreatorIdentitySyntheticReader } from "@creativeagent/db";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "@creativeagent/creative-pipeline";

const prisma = new PrismaClient();
const store = new PrismaCreatorIdentitySyntheticStore(prisma);
const reader = new PrismaCreatorIdentitySyntheticReader(prisma);

for (const entry of SP11_SYNTHETIC_CREATOR_ROSTER) {
  await prisma.creatorIdentity.upsert({
    where: { id: entry.creatorIdentity.id },
    create: {
      id: entry.creatorIdentity.id,
      name: entry.creatorIdentity.name,
      kind: "synthetic",
      deploymentId: "dep_sp11_seed",
      identityRefIds: [],
      heroImageAssetId: "asset_placeholder_sp11",
      identityDescription: `SP11 seed: ${entry.creatorIdentity.name}`,
      voice: { voiceId: "v_seed", provider: "elevenlabs", tone: "seed", pace: "moderate", sampleUrl: "" },
      personality: { energy: "energetic", deliveryStyle: "seed" },
      appearanceRules: {},
      environmentSet: [],
    },
    update: { kind: "synthetic" },
  });
  await store.create(entry.synthetic);
}

const all = await reader.listAll();
console.warn(`SP11 seed loaded: ${all.length} synthetic creators`);
```

Expected output: `SP11 seed loaded: 10 synthetic creators`. Spot-check Cheryl's `dallePromptLocked` matches the source doc.

- [ ] **Step 4: Final commit summary**

```bash
git log --oneline main..HEAD
```

Expected: one commit per task (~9 feat/test commits) on `feat/pcd-synthetic-creator-roster`. If any task ballooned and was committed to multiple sub-tasks per the priority-invariant #5 split rule, that's fine — note it in the squash-PR description.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat(pcd): SP11 — synthetic creator foundation (kind discriminator + extension table + 10-character seed)" --body "$(cat <<'EOF'
## Summary

- Adds `CreatorIdentity.kind: "real" | "synthetic"` discriminator (defaults to "real")
- New `CreatorIdentitySynthetic` extension table with locked persona descriptors, DALL-E prompt, Kling direction, voice/caption style, vibe/market/treatment routing keys
- New typed `CreativeBrief` zod schema (the structured contract for SP14 selector input)
- 10-character seed roster (Cheryl, Vivienne, Felicia, Amanda, Nana, Bianca, Hana, Chloe, Elaine, Bua) — verbatim from the persona doc
- One additive Prisma migration (`pcd_creator_identity_synthetic_sp11`)
- SP11 anti-pattern grep tests (scope-leak, source-freeze, prompt-drift sentinel)

## Out of scope (SP12+)

- License gate (SP12)
- Disclosure registry (SP13)
- Selector + script (SP14, SP15)
- Provider routing extension (SP16)
- SP9 provenance extension (SP17)
- Performance snapshot + overlay (SP18, SP19)
- QC face-match for synthetic (SP20)
- E2E + clinic onboarding (SP21)

## Source-of-truth

- Design: `docs/plans/2026-04-30-pcd-synthetic-creator-roster-design.md`
- Plan: `docs/plans/2026-04-30-pcd-synthetic-creator-foundation-sp11-plan.md`

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green (full suite + ~30 new tests)
- [ ] Migration applies cleanly against fresh DB
- [ ] Seed loads 10 characters end-to-end
- [ ] Anti-pattern tests green (scope-leak / source-freeze / prompt-drift)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (executor: do this before opening the PR)

1. **Spec coverage** — every spec §3.1, §3.2, and §11 (v1 scope) requirement implemented? Specifically:
   - `CreatorIdentity.kind` column ✅ Task 4
   - `CreatorIdentitySynthetic` table with all 13 columns ✅ Task 4
   - Zod schemas for all enums + payload ✅ Tasks 1, 2
   - 10 characters seeded ✅ Task 7
   - `mutuallyExclusiveWithIds` enforced (Nana/Bua) ✅ Task 7 test
   - No SP12+ scope leak ✅ Task 8
2. **Placeholder scan** — no `TBD`, no `// implement later`, no `function() {}` stubs in committed code. The `/* ... full verbatim entry ... */` blocks in the seed are NOT placeholders — they must be replaced with full transcriptions before the seed file is committed.
3. **Type consistency** — `CreatorIdentitySyntheticPayload` shape matches between schema (Task 1), store input (Task 5), reader output (Task 5), and seed entries (Task 7). One canonical type, imported everywhere.
4. **Anti-pattern tests stay green at every commit** — if any task commit breaks Task 8's tests, fix in the same commit, not a follow-up.

If a task ballooned past its declared scope (e.g. adding a license-gate hook because the seed runner needed one), STOP and split. SP11A (schemas + Prisma) and SP11B (seed + runner) are acceptable splits if needed.

---

*End of SP11 plan. Awaiting user review per writing-plans skill review gate before execution.*
