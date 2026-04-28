# PCD SP4 — Provider Router + Capability Matrix + Identity Snapshot Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one coherent SP4 vertical: declarative `PcdProviderCapabilityMatrix`, tier-aware `routePcdShot` enforcing the three Tier 3 mandatory rules and calling `decidePcdGenerationAccess` per shot, and a pure store-injected `writePcdIdentitySnapshot` that pins four version constants and validates Tier 3 invariants as a second line of defense.

**Architecture:** Two separately-callable pure async functions in `packages/creative-pipeline/src/pcd/` (router pre-provider, writer post-provider). Tier 3 rules live in a shared module both call. Schema/migration adds three nullable forensic columns to `PcdIdentitySnapshot`. SP3's `ResolvedPcdContext` gains `productTier` + `creatorTier` (additive contract revision; no `CreativeJob` schema change).

**Tech Stack:** TypeScript ESM (`.js` relative imports), Zod schemas, Prisma + PostgreSQL, Vitest co-located tests, in-memory fakes (no DB / no network in tests). pnpm + Turborepo monorepo.

**Spec:** `docs/plans/2026-04-28-pcd-provider-router-sp4-design.md` (commit `06ac5c8`). Read it before any task — every locked decision in this plan is justified there.

**Repo conventions (binding for every task):**
- ESM only; relative imports MUST end in `.js`.
- Unused vars prefixed with `_`.
- No `console.log`. No `any` (use `unknown` and narrow).
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width.
- Conventional Commits.
- Co-located `*.test.ts` for every new module.
- File size soft limit 400 lines, hard 600.
- Forbidden-imports test file pattern: read source as text via `readFileSync`, regex assert.

**Test runner commands (from repo root unless noted):**
- Schemas tests: `pnpm --filter @creativeagent/schemas test`
- Creative-pipeline tests: `pnpm --filter @creativeagent/creative-pipeline test`
- Targeted file: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/<file>.test.ts`
- Targeted name: `pnpm --filter @creativeagent/creative-pipeline test -- -t "<test name fragment>"`
- Whole-repo gates (run after each major task or before commit): `pnpm db:generate && pnpm typecheck && pnpm test && pnpm lint`

---

## File Structure

**New files (creative-pipeline):**
- `packages/creative-pipeline/src/pcd/provider-capability-matrix.ts`
- `packages/creative-pipeline/src/pcd/provider-capability-matrix.test.ts`
- `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts`
- `packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts`
- `packages/creative-pipeline/src/pcd/provider-router.ts`
- `packages/creative-pipeline/src/pcd/provider-router.test.ts`
- `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts`
- `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts`

**New files (db):**
- `packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql`

**Modified files:**
- `packages/schemas/src/pcd-identity.ts` — add `PcdRoutingDecisionReasonSchema`, `PcdSp4IdentitySnapshotInputSchema`, three nullable fields on `PcdIdentitySnapshotSchema`.
- `packages/db/prisma/schema.prisma` — add three nullable fields to `PcdIdentitySnapshot` model.
- `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` — widen `CreatePcdIdentitySnapshotInput` with three new fields.
- `packages/creative-pipeline/src/pcd/registry-resolver.ts` — add `productTier` and `creatorTier` to `ResolvedPcdContext`; revise no-op path to read from stores.
- `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` — Part A delta + 3 SP4-additive tests.
- `packages/creative-pipeline/src/index.ts` — add SP4 re-exports.
- `docs/SWITCHBOARD-CONTEXT.md` — add one-line `CampaignTakeStore` merge-back ownership note under SP4's section.

**Implementation order (lock dependencies):**
1. **Task 1:** Schemas (`PcdRoutingDecisionReason`, `PcdSp4IdentitySnapshotInput`, three new fields on `PcdIdentitySnapshot`).
2. **Task 2:** Prisma schema + migration + store widening.
3. **Task 3:** SP3 contract revision (`ResolvedPcdContext` extension + no-op-path read).
4. **Task 4:** `provider-capability-matrix.ts` (data + version const + type).
5. **Task 5:** `tier3-routing-rules.ts` (predicates + assertion + errors + `CampaignTakeStore`).
6. **Task 6:** `provider-router.ts` (`routePcdShot`, `PCD_PROVIDER_ROUTER_VERSION`, `ApprovedCampaignContext`).
7. **Task 7:** `pcd-identity-snapshot-writer.ts` (`writePcdIdentitySnapshot`).
8. **Task 8:** Re-exports in `creative-pipeline/src/index.ts` + `SWITCHBOARD-CONTEXT.md` note.
9. **Task 9:** Whole-repo gate + commit cleanup.

Each task is its own commit (or two — one for the failing-test commit, one for the implementation; bundled here for review concision but split when committing).

---

## Task 1: Schemas — `PcdRoutingDecisionReason` + `PcdSp4IdentitySnapshotInput` + three new fields on `PcdIdentitySnapshot`

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts`
- Test: `packages/schemas/src/__tests__/pcd-identity-sp4.test.ts` (new file in existing __tests__ dir)

### Step 1.1: Read context

- [ ] Read `packages/schemas/src/pcd-identity.ts` (full file). Note line 112's `PcdIdentitySnapshotSchema` and the existing field order. Confirm `IdentityTierSchema` is imported.
- [ ] Read `packages/schemas/src/pcd-tier-policy.ts` (full file). Note `PcdShotTypeSchema` and `OutputIntentSchema` exports.
- [ ] Read `packages/schemas/src/__tests__/` directory listing to see existing test file naming convention. (Path: `ls packages/schemas/src/__tests__/`)

### Step 1.2: Write the failing tests (schemas)

- [ ] Create `packages/schemas/src/__tests__/pcd-identity-sp4.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdRoutingDecisionReasonSchema,
  type PcdRoutingDecisionReason,
  PcdSp4IdentitySnapshotInputSchema,
  PcdIdentitySnapshotSchema,
} from "../pcd-identity.js";

describe("PcdRoutingDecisionReasonSchema", () => {
  const valid: PcdRoutingDecisionReason = {
    capabilityRefIndex: 0,
    matchedShotType: "simple_ugc",
    matchedEffectiveTier: 2,
    matchedOutputIntent: "final_export",
    tier3RulesApplied: [],
    candidatesEvaluated: 3,
    candidatesAfterTier3Filter: 3,
    selectionRationale: "Tier 2 simple_ugc final_export — first matrix match",
  };

  it("accepts a well-formed reason", () => {
    expect(() => PcdRoutingDecisionReasonSchema.parse(valid)).not.toThrow();
  });

  it("rejects matchedEffectiveTier outside 1|2|3", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, matchedEffectiveTier: 4 }),
    ).toThrow();
  });

  it("rejects negative capabilityRefIndex", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, capabilityRefIndex: -1 }),
    ).toThrow();
  });

  it("rejects selectionRationale longer than 200 chars", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, selectionRationale: "x".repeat(201) }),
    ).toThrow();
  });

  it("accepts the three legal tier3RulesApplied values and rejects others", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({
        ...valid,
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer", "edit_over_regenerate"],
      }),
    ).not.toThrow();
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({
        ...valid,
        tier3RulesApplied: ["bogus_rule"],
      }),
    ).toThrow();
  });
});

describe("PcdSp4IdentitySnapshotInputSchema", () => {
  const validInput = {
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "abc123",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    selectedProvider: "kling",
    providerModelSnapshot: "kling-v2.0",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
    routerVersion: "provider-router@1.0.0",
    routingDecisionReason: {
      capabilityRefIndex: 0,
      matchedShotType: "simple_ugc" as const,
      matchedEffectiveTier: 2 as const,
      matchedOutputIntent: "final_export" as const,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "test",
    },
  };

  it("accepts a complete writer input", () => {
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(validInput)).not.toThrow();
  });

  it("rejects missing shotSpecVersion (required for SP4 writes)", () => {
    const { shotSpecVersion: _shotSpecVersion, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing routerVersion", () => {
    const { routerVersion: _routerVersion, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing routingDecisionReason", () => {
    const { routingDecisionReason: _routingDecisionReason, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("does not accept policyVersion or providerCapabilityVersion as input keys", () => {
    // Strict-mode-ish check: writer pins these from imports. The schema must
    // not declare them; we assert by parsing with extras and confirming the
    // result type does not surface them. Zod by default strips unknown keys;
    // this test documents intent and locks the key set.
    const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
      ...validInput,
      policyVersion: "should-be-stripped",
      providerCapabilityVersion: "should-be-stripped",
    } as unknown);
    expect("policyVersion" in parsed).toBe(false);
    expect("providerCapabilityVersion" in parsed).toBe(false);
  });
});

describe("PcdIdentitySnapshotSchema (SP4 widening)", () => {
  const baseRow = {
    id: "snap-1",
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "abc123",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    policyVersion: "tier-policy@1.0.0",
    providerCapabilityVersion: "provider-capability@1.0.0",
    selectedProvider: "kling",
    providerModelSnapshot: "kling-v2.0",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    createdAt: new Date(),
  };

  it("accepts a row with all SP4 fields NULL (pre-SP4 historical)", () => {
    expect(() =>
      PcdIdentitySnapshotSchema.parse({
        ...baseRow,
        shotSpecVersion: null,
        routerVersion: null,
        routingDecisionReason: null,
      }),
    ).not.toThrow();
  });

  it("accepts a row with SP4 fields populated", () => {
    expect(() =>
      PcdIdentitySnapshotSchema.parse({
        ...baseRow,
        shotSpecVersion: "shot-spec@1.0.0",
        routerVersion: "provider-router@1.0.0",
        routingDecisionReason: {
          capabilityRefIndex: 0,
          matchedShotType: "simple_ugc",
          matchedEffectiveTier: 2,
          matchedOutputIntent: "final_export",
          tier3RulesApplied: [],
          candidatesEvaluated: 1,
          candidatesAfterTier3Filter: 1,
          selectionRationale: "test",
        },
      }),
    ).not.toThrow();
  });
});
```

### Step 1.3: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/schemas test -- src/__tests__/pcd-identity-sp4.test.ts`
- [ ] Expected: FAIL — `PcdRoutingDecisionReasonSchema` and `PcdSp4IdentitySnapshotInputSchema` not exported.

### Step 1.4: Implement the schemas

- [ ] Open `packages/schemas/src/pcd-identity.ts`. After the existing `PcdQcResultSchema` block and before `PcdIdentitySnapshotSchema`, add:

```ts
import { PcdShotTypeSchema, OutputIntentSchema } from "./pcd-tier-policy.js";

export const PcdRoutingDecisionReasonSchema = z.object({
  capabilityRefIndex: z.number().int().nonnegative(),
  matchedShotType: PcdShotTypeSchema,
  matchedEffectiveTier: IdentityTierSchema,
  matchedOutputIntent: OutputIntentSchema,
  tier3RulesApplied: z.array(
    z.enum(["first_last_frame_anchor", "performance_transfer", "edit_over_regenerate"]),
  ),
  candidatesEvaluated: z.number().int().nonnegative(),
  candidatesAfterTier3Filter: z.number().int().nonnegative(),
  selectionRationale: z.string().max(200),
});
export type PcdRoutingDecisionReason = z.infer<typeof PcdRoutingDecisionReasonSchema>;
```

- [ ] In the same file, modify the existing `PcdIdentitySnapshotSchema` definition. Append three new nullable fields **before** the trailing `createdAt`:

```ts
export const PcdIdentitySnapshotSchema = z.object({
  id: z.string(),
  assetRecordId: z.string(),

  productIdentityId: z.string(),
  productTierAtGeneration: IdentityTierSchema,
  productImageAssetIds: z.array(z.string()),
  productCanonicalTextHash: z.string(),
  productLogoAssetId: z.string().nullable(),

  creatorIdentityId: z.string(),
  avatarTierAtGeneration: IdentityTierSchema,
  avatarReferenceAssetIds: z.array(z.string()),
  voiceAssetId: z.string().nullable(),
  consentRecordId: z.string().nullable(),

  policyVersion: z.string(),
  providerCapabilityVersion: z.string(),
  selectedProvider: z.string(),
  providerModelSnapshot: z.string(),
  seedOrNoSeed: z.string(),
  rewrittenPromptText: z.string().nullable(),

  // SP4 additions — nullable for historical compatibility (pre-SP4 / merge-back
  // rows that predate this slice). SP4 writer treats them as required for new writes.
  shotSpecVersion: z.string().nullable(),
  routerVersion: z.string().nullable(),
  routingDecisionReason: PcdRoutingDecisionReasonSchema.nullable(),

  createdAt: z.coerce.date(),
});
export type PcdIdentitySnapshot = z.infer<typeof PcdIdentitySnapshotSchema>;
```

- [ ] After the `PcdIdentitySnapshotSchema` block, add the writer input schema:

```ts
export const PcdSp4IdentitySnapshotInputSchema = z.object({
  // Identity-side
  assetRecordId: z.string(),
  productIdentityId: z.string(),
  productTierAtGeneration: IdentityTierSchema,
  productImageAssetIds: z.array(z.string()),
  productCanonicalTextHash: z.string(),
  productLogoAssetId: z.string().nullable(),
  creatorIdentityId: z.string(),
  avatarTierAtGeneration: IdentityTierSchema,
  avatarReferenceAssetIds: z.array(z.string()),
  voiceAssetId: z.string().nullable(),
  consentRecordId: z.string().nullable(),

  // Provider-side (filled from provider response)
  selectedProvider: z.string(),
  providerModelSnapshot: z.string(),
  seedOrNoSeed: z.string(),
  rewrittenPromptText: z.string().nullable(),

  // SP4 forensic fields (REQUIRED for new writes; nullable on the stored row)
  shotSpecVersion: z.string(),
  routerVersion: z.string(),
  routingDecisionReason: PcdRoutingDecisionReasonSchema,

  // policyVersion + providerCapabilityVersion intentionally absent: writer
  // pins them from imports; caller cannot override.
});
export type PcdSp4IdentitySnapshotInput = z.infer<typeof PcdSp4IdentitySnapshotInputSchema>;
```

### Step 1.5: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/schemas test -- src/__tests__/pcd-identity-sp4.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/schemas typecheck`
- [ ] Expected: zero errors.

### Step 1.6: Commit

- [ ] ```
git add packages/schemas/src/pcd-identity.ts packages/schemas/src/__tests__/pcd-identity-sp4.test.ts
git commit -m "$(cat <<'EOF'
feat(schemas): SP4 PcdRoutingDecisionReason + PcdSp4IdentitySnapshotInput; widen PcdIdentitySnapshot

Adds the structured routing-decision JSON schema and the writer-input
schema (where SP4 forensic fields are required). Widens
PcdIdentitySnapshotSchema with three nullable fields (shotSpecVersion,
routerVersion, routingDecisionReason) so the schema parses both pre-SP4
historical rows (NULL) and SP4-and-later rows (populated).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Prisma schema + migration + snapshot store widening

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql`
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`
- Test: `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store-sp4.test.ts` (new)

### Step 2.1: Read context

- [ ] Read `packages/db/prisma/schema.prisma` lines 230-270 (the `PcdIdentitySnapshot` model).
- [ ] Read `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (full file, ~38 lines).
- [ ] List existing migrations: `ls packages/db/prisma/migrations/`. Note the naming format (timestamp prefix, snake_case suffix).
- [ ] Determine the migration timestamp. Use `date -u +"%Y%m%d%H%M%S"` from the shell, then craft the directory name `<timestamp>_pcd_snapshot_sp4_versions`.

### Step 2.2: Modify the Prisma schema

- [ ] Open `packages/db/prisma/schema.prisma`. Find the `PcdIdentitySnapshot` model (line ~236). Insert three new fields immediately before the existing `createdAt` line:

```prisma
model PcdIdentitySnapshot {
  // ... existing fields unchanged through rewrittenPromptText ...
  rewrittenPromptText         String?

  // SP4 additions — nullable for historical compatibility.
  shotSpecVersion             String?
  routerVersion               String?
  routingDecisionReason       Json?

  createdAt                   DateTime        @default(now())

  // ... existing indexes unchanged; do NOT add indexes on the new fields ...
}
```

### Step 2.3: Create the migration

- [ ] Create directory: `mkdir packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions`
- [ ] Create `packages/db/prisma/migrations/<timestamp>_pcd_snapshot_sp4_versions/migration.sql` with this content:

```sql
-- SP4: add forensic version-pinning columns to PcdIdentitySnapshot.
-- Columns are nullable for historical compatibility (pre-SP4 / merge-back-time
-- Switchboard rows that predate this slice). SP4 writer treats them as
-- mandatory for any newly written snapshot. A future cleanup migration may
-- flip to NOT NULL once legacy rows are backfilled or archived.

ALTER TABLE "PcdIdentitySnapshot"
  ADD COLUMN "shotSpecVersion"        TEXT,
  ADD COLUMN "routerVersion"          TEXT,
  ADD COLUMN "routingDecisionReason"  JSONB;
```

### Step 2.4: Regenerate Prisma client and apply migration

- [ ] Run: `pnpm db:generate`
- [ ] Expected: Prisma client regenerates without error.
- [ ] Run: `pnpm db:migrate`
- [ ] Expected: migration applies cleanly. (If a local DB isn't configured, the typecheck below catches the schema-vs-client mismatch instead.)

### Step 2.5: Write the failing store test

- [ ] Create `packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store-sp4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CreatePcdIdentitySnapshotInput } from "../prisma-pcd-identity-snapshot-store.js";
import type { PcdRoutingDecisionReason } from "@creativeagent/schemas";

describe("CreatePcdIdentitySnapshotInput (SP4 widening)", () => {
  it("accepts the three new nullable SP4 fields", () => {
    const reason: PcdRoutingDecisionReason = {
      capabilityRefIndex: 0,
      matchedShotType: "simple_ugc",
      matchedEffectiveTier: 2,
      matchedOutputIntent: "final_export",
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "test",
    };

    // Type-only assertion: this object must be assignable to the input type.
    const input: CreatePcdIdentitySnapshotInput = {
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: reason,
    };

    expect(input.shotSpecVersion).toBe("shot-spec@1.0.0");
    expect(input.routerVersion).toBe("provider-router@1.0.0");
    expect(input.routingDecisionReason).toEqual(reason);
  });

  it("accepts NULL for all three new fields", () => {
    const input: CreatePcdIdentitySnapshotInput = {
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: null,
      routerVersion: null,
      routingDecisionReason: null,
    };

    expect(input.shotSpecVersion).toBeNull();
  });
});
```

### Step 2.6: Run test to verify failure

- [ ] Run: `pnpm --filter @creativeagent/db test -- src/stores/__tests__/prisma-pcd-identity-snapshot-store-sp4.test.ts`
- [ ] Expected: FAIL — `shotSpecVersion`, `routerVersion`, `routingDecisionReason` not on the type.

### Step 2.7: Widen the store input type

- [ ] Open `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`. Replace the file with:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdRoutingDecisionReason,
} from "@creativeagent/schemas";

export interface CreatePcdIdentitySnapshotInput {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: IdentityTier;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: IdentityTier;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  policyVersion: string;
  providerCapabilityVersion: string;
  selectedProvider: string;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  // SP4 additions
  shotSpecVersion: string | null;
  routerVersion: string | null;
  routingDecisionReason: PcdRoutingDecisionReason | null;
}

export class PrismaPcdIdentitySnapshotStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot> {
    return this.prisma.pcdIdentitySnapshot.create({
      data: input,
    }) as unknown as PcdIdentitySnapshot;
  }

  async getByAssetRecordId(assetRecordId: string): Promise<PcdIdentitySnapshot | null> {
    return this.prisma.pcdIdentitySnapshot.findUnique({
      where: { assetRecordId },
    }) as unknown as PcdIdentitySnapshot | null;
  }
}
```

The `data: input` spread already passes the new fields through to Prisma; no method-body change.

### Step 2.8: Run tests and typecheck

- [ ] Run: `pnpm --filter @creativeagent/db test -- src/stores/__tests__/prisma-pcd-identity-snapshot-store-sp4.test.ts`
- [ ] Expected: PASS.
- [ ] Run: `pnpm --filter @creativeagent/db typecheck`
- [ ] Expected: zero errors.

### Step 2.9: Commit

- [ ] ```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts packages/db/src/stores/__tests__/
git commit -m "$(cat <<'EOF'
feat(db): SP4 PcdIdentitySnapshot — three nullable forensic columns + store widening

Adds shotSpecVersion, routerVersion, routingDecisionReason to the
PcdIdentitySnapshot Prisma model and migration. Nullable for historical
compatibility; SP4 writer treats them as required for new writes.
Widens CreatePcdIdentitySnapshotInput correspondingly. Existing
data: input spread already passes the new fields through to Prisma.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: SP3 contract revision — `ResolvedPcdContext` gains `productTier` + `creatorTier`

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.ts`
- Modify: `packages/creative-pipeline/src/pcd/registry-resolver.test.ts`

### Step 3.1: Read context

- [ ] Read `packages/creative-pipeline/src/pcd/registry-resolver.ts` (full file, ~122 lines).
- [ ] Read `packages/creative-pipeline/src/pcd/registry-resolver.test.ts` (full file). Locate the existing "idempotency guard" test (~line 47-58) and the `neverCalledStores()` helper (~line 14-32). The Part A delta will revise this existing test.

### Step 3.2: Write the failing tests (additive deltas)

- [ ] In `packages/creative-pipeline/src/pcd/registry-resolver.test.ts`, **modify the existing idempotency-guard `describe` block** to assert the revised behavior. Replace the existing block with:

```ts
describe("resolvePcdRegistryContext — idempotency guard (already resolved at current version)", () => {
  it("returns context with two finder calls and zero attachIdentityRefs writes", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, stores);
    expect(result).toEqual({
      productIdentityId: "p1",
      creatorIdentityId: "c1",
      productTier: 2,
      creatorTier: 2,
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    });
    expect(log.findOrCreateForJobCalls).toBe(1);
    expect(log.findOrCreateStockForDeploymentCalls).toBe(1);
    expect(log.attachIdentityRefsCalls).toBe(0);
  });
});
```

- [ ] **Add a new `describe` block at the end of the file** for the SP4-additive deltas:

```ts
describe("SP4 additive contract deltas", () => {
  it("returns productTier and creatorTier in the full-attach path (verified + anchored → tier 2 + tier 2)", async () => {
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
    expect(result.productTier).toBe(2);
    expect(result.creatorTier).toBe(2);
    expect(result.effectiveTier).toBe(2);
    expect(log.attachIdentityRefsCalls).toBe(1);
  });

  it("no-op path returns current registry component tiers with originally-stamped effectiveTier (divergence case)", async () => {
    // Job was stamped at effectiveTier=2 originally. Registry now reports
    // productQualityTier=canonical (would map to tier 3) and creatorQualityTier=stock
    // (tier 1). The no-op path must return the current component tiers,
    // even though the stamped effectiveTier=2 no longer equals min(3, 1)=1.
    const { stores } = makeFakes({
      productQualityTier: "canonical",
      creatorQualityTier: "stock",
    });
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, stores);
    expect(result.productTier).toBe(3);    // current registry state
    expect(result.creatorTier).toBe(1);    // current registry state
    expect(result.effectiveTier).toBe(2);  // originally-stamped
    expect(result.allowedOutputTier).toBe(2);
  });

  it("full-attach path: each (productQualityTier, creatorQualityTier) maps correctly", async () => {
    const cases: Array<{
      product: "url_imported" | "verified" | "canonical";
      creator: "stock" | "anchored" | "soul_id";
      productTier: 1 | 2 | 3;
      creatorTier: 1 | 2 | 3;
    }> = [
      { product: "url_imported", creator: "stock", productTier: 1, creatorTier: 1 },
      { product: "verified", creator: "stock", productTier: 2, creatorTier: 1 },
      { product: "canonical", creator: "soul_id", productTier: 3, creatorTier: 3 },
    ];
    for (const c of cases) {
      const { stores } = makeFakes({
        productQualityTier: c.product,
        creatorQualityTier: c.creator,
      });
      const job: PcdResolvableJob = {
        id: `job-${c.product}-${c.creator}`,
        organizationId: "org",
        deploymentId: "dep",
        productDescription: "x",
        productImages: [],
      };
      const result = await resolvePcdRegistryContext(job, stores);
      expect(result.productTier).toBe(c.productTier);
      expect(result.creatorTier).toBe(c.creatorTier);
    }
  });
});
```

### Step 3.3: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/registry-resolver.test.ts`
- [ ] Expected: FAIL — `productTier`/`creatorTier` not on the returned context; the revised idempotency test expects 1+1 finder calls but current code does 0+0.

### Step 3.4: Modify the resolver

- [ ] Open `packages/creative-pipeline/src/pcd/registry-resolver.ts`. Replace the `ResolvedPcdContext` type definition with:

```ts
export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  productTier: IdentityTier;          // SP4 addition
  creatorTier: IdentityTier;          // SP4 addition
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: string;
};
```

- [ ] In the same file, replace the `resolvePcdRegistryContext` function body. Both the no-op path and the full-attach path must return component tiers:

```ts
export async function resolvePcdRegistryContext(
  job: PcdResolvableJob,
  stores: RegistryResolverStores,
): Promise<ResolvedPcdContext> {
  // Always read current registry component tiers. On the no-op path we still
  // skip attachIdentityRefs (no write), but we need productTier and creatorTier
  // to satisfy the SP4-revised ResolvedPcdContext contract. Registry is the
  // source of truth for component tiers; CreativeJob does not shadow them.
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(job.deploymentId);
  const productTier = mapProductQualityTierToIdentityTier(product.qualityTier);
  const creatorTier = mapCreatorQualityTierToIdentityTier(creator.qualityTier);

  if (isResolvedPcdJob(job)) {
    // No-op path: effectiveTier and allowedOutputTier reflect ORIGINAL
    // resolution time (preserved from job stamp). productTier and creatorTier
    // reflect CURRENT registry state. They may diverge if registry rows were
    // re-tiered after job stamping. Downstream consumers must treat
    // effectiveTier as authoritative for gating.
    return {
      productIdentityId: job.productIdentityId,
      creatorIdentityId: job.creatorIdentityId,
      productTier,
      creatorTier,
      effectiveTier: job.effectiveTier,
      allowedOutputTier: job.allowedOutputTier,
      shotSpecVersion: job.shotSpecVersion,
    };
  }

  const effectiveTier = computeEffectiveTier(productTier, creatorTier);

  const resolved: ResolvedPcdContext = {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
    productTier,
    creatorTier,
    effectiveTier,
    allowedOutputTier: effectiveTier,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };

  await stores.jobStore.attachIdentityRefs(job.id, resolved);

  return resolved;
}
```

Note: `attachIdentityRefs` payload now contains `productTier` and `creatorTier` keys. The Prisma `PrismaCreativeJobStore.attachIdentityRefs` method's `AttachIdentityRefsInput` does not declare these fields — but that store is implemented in `apps/api` at merge-back time, not in this repo. The current repo's `prisma-creative-job-store.ts` declares an `AttachIdentityRefsInput` shape that does NOT include `productTier`/`creatorTier`; we keep the resolver passing them, but they will be ignored at the Prisma layer in this repo's store. **This is intentional** — the registry/snapshot pinning is the canonical record, and the SP3 design's "no `CreativeJob` schema change" guardrail forbids extending `CreativeJob`. Confirm by reading `packages/db/src/stores/prisma-creative-job-store.ts` lines 5-12 and noting that adding `productTier`/`creatorTier` keys to the data spread there is forbidden by Task 0 scope.

The `ResolvedPcdContext` type is now structurally a superset of the current `AttachIdentityRefsInput`; assignment will require a TypeScript adjustment. Look at what the `jobStore.attachIdentityRefs` parameter type is in `RegistryResolverStores`. It's typed as `(jobId, refs: ResolvedPcdContext) => Promise<void>` — meaning the in-tree mock will accept the wider shape, but real Prisma at merge-back must accept it too (which is fine because the merge-back implementer can choose to either persist or discard). For SP4 purposes here, we keep the resolver type untouched.

### Step 3.5: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/registry-resolver.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step 3.6: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/registry-resolver.ts packages/creative-pipeline/src/pcd/registry-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 ResolvedPcdContext gains productTier + creatorTier

Additive SP3 contract revision: ResolvedPcdContext now carries component
tiers so SP4's router can call decidePcdGenerationAccess with avatarTier
and productTier separately. No CreativeJob schema change; the no-op path
re-reads from registry stores (registry owns identity-tier truth).
Documented divergence semantic: no-op path returns current component
tiers with originally-stamped effectiveTier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `provider-capability-matrix.ts` — declarative table + version constant

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provider-capability-matrix.ts`
- Create: `packages/creative-pipeline/src/pcd/provider-capability-matrix.test.ts`

### Step 4.1: Write the failing tests

- [ ] Create `packages/creative-pipeline/src/pcd/provider-capability-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

const ALL_SHOT_TYPES: PcdShotType[] = [
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];

const ALL_OUTPUT_INTENTS: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
const ALL_TIERS: IdentityTier[] = [1, 2, 3];

describe("PCD_PROVIDER_CAPABILITY_VERSION", () => {
  it("is locked at provider-capability@1.0.0", () => {
    expect(PCD_PROVIDER_CAPABILITY_VERSION).toBe("provider-capability@1.0.0");
  });
});

describe("PCD_PROVIDER_CAPABILITY_MATRIX shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(PCD_PROVIDER_CAPABILITY_MATRIX)).toBe(true);
    expect(PCD_PROVIDER_CAPABILITY_MATRIX.length).toBeGreaterThan(0);
  });

  it.each(PCD_PROVIDER_CAPABILITY_MATRIX.map((row, idx) => [idx, row]))(
    "row %i has all required fields with correct types",
    (_idx, row) => {
      const r = row as PcdProviderCapability;
      expect(typeof r.provider).toBe("string");
      expect(r.provider.length).toBeGreaterThan(0);
      expect(Array.isArray(r.tiers)).toBe(true);
      expect(r.tiers.length).toBeGreaterThan(0);
      expect(Array.isArray(r.shotTypes)).toBe(true);
      expect(r.shotTypes.length).toBeGreaterThan(0);
      expect(Array.isArray(r.outputIntents)).toBe(true);
      expect(r.outputIntents.length).toBeGreaterThan(0);
      expect(typeof r.supportsFirstLastFrame).toBe("boolean");
      expect(typeof r.supportsEditExtend).toBe("boolean");
      expect(typeof r.supportsPerformanceTransfer).toBe("boolean");
    },
  );
});

describe("Matrix coverage against SP2 allowed-set", () => {
  it("for every (tier, shotType, outputIntent) allowed by SP2, at least one matrix row matches", () => {
    const gaps: string[] = [];
    for (const tier of ALL_TIERS) {
      for (const shot of ALL_SHOT_TYPES) {
        for (const intent of ALL_OUTPUT_INTENTS) {
          const decision = decidePcdGenerationAccess({
            avatarTier: tier,
            productTier: tier,
            shotType: shot,
            outputIntent: intent,
          });
          if (!decision.allowed) continue;
          const matches = PCD_PROVIDER_CAPABILITY_MATRIX.filter(
            (c) =>
              c.tiers.includes(tier) &&
              c.shotTypes.includes(shot) &&
              c.outputIntents.includes(intent),
          );
          if (matches.length === 0) {
            gaps.push(`(tier=${tier}, shot=${shot}, intent=${intent})`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("Tier 3 capability sufficiency (rule combinations on a single row)", () => {
  // Helpers replicate the Tier 3 rule predicates to avoid coupling this test
  // to the rules module under test. Hand-listed; matches SP4 design.
  const VIDEO_SHOTS: ReadonlyArray<PcdShotType> = [
    "simple_ugc",
    "talking_head",
    "product_demo",
    "product_in_hand",
    "face_closeup",
    "label_closeup",
    "object_insert",
  ];
  const PUBLISHABLE_INTENTS: ReadonlyArray<OutputIntent> = [
    "preview",
    "final_export",
    "meta_draft",
  ];
  const requiresFLF = (shot: PcdShotType, intent: OutputIntent): boolean =>
    VIDEO_SHOTS.includes(shot) && PUBLISHABLE_INTENTS.includes(intent);
  const requiresPT = (shot: PcdShotType): boolean => shot === "talking_head";

  it("for every Tier-3-allowed (shot, intent), the matrix has a row satisfying all simultaneously-required Tier 3 rules", () => {
    const gaps: string[] = [];
    for (const shot of ALL_SHOT_TYPES) {
      for (const intent of ALL_OUTPUT_INTENTS) {
        const decision = decidePcdGenerationAccess({
          avatarTier: 3,
          productTier: 3,
          shotType: shot,
          outputIntent: intent,
        });
        if (!decision.allowed) continue;

        const needsFLF = requiresFLF(shot, intent);
        const needsPT = requiresPT(shot);

        // Without rule 3 (campaignTakeStore=false): rules 1 + 2 must coexist.
        const baselineMatch = PCD_PROVIDER_CAPABILITY_MATRIX.find(
          (c) =>
            c.tiers.includes(3) &&
            c.shotTypes.includes(shot) &&
            c.outputIntents.includes(intent) &&
            (!needsFLF || c.supportsFirstLastFrame) &&
            (!needsPT || c.supportsPerformanceTransfer),
        );
        if (!baselineMatch) {
          gaps.push(`baseline (shot=${shot}, intent=${intent})`);
        }

        // With rule 3 active (campaignTakeStore=true): rules 1 + 2 + 3 must
        // all coexist on a single row.
        const rule3Match = PCD_PROVIDER_CAPABILITY_MATRIX.find(
          (c) =>
            c.tiers.includes(3) &&
            c.shotTypes.includes(shot) &&
            c.outputIntents.includes(intent) &&
            (!needsFLF || c.supportsFirstLastFrame) &&
            (!needsPT || c.supportsPerformanceTransfer) &&
            c.supportsEditExtend,
        );
        if (!rule3Match) {
          gaps.push(`rule3 (shot=${shot}, intent=${intent})`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("Forbidden imports in provider-capability-matrix.ts", () => {
  it("contains none of the forbidden import paths", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-capability-matrix.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
  });
});
```

### Step 4.2: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-capability-matrix.test.ts`
- [ ] Expected: FAIL — module does not exist.

### Step 4.3: Implement the matrix

- [ ] Create `packages/creative-pipeline/src/pcd/provider-capability-matrix.ts`:

```ts
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_PROVIDER_CAPABILITY_VERSION = "provider-capability@1.0.0";

export type PcdProviderCapability = {
  provider: string;
  tiers: ReadonlyArray<IdentityTier>;
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  supportsFirstLastFrame: boolean;
  supportsEditExtend: boolean;
  supportsPerformanceTransfer: boolean;
};

// Declarative provider capability matrix. Order is policy:
// `routePcdShot` selects first-match. Rows are authored to satisfy the
// matrix coverage and Tier 3 capability sufficiency tests, including the
// rule-1+2+3 combined-flag-on-single-row requirement.
export const PCD_PROVIDER_CAPABILITY_MATRIX: ReadonlyArray<PcdProviderCapability> = [
  // Tier 1 draft / storyboard / script — text/image-only providers.
  {
    provider: "openai_text",
    tiers: [1, 2, 3],
    shotTypes: ["script_only", "storyboard"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: false,
    supportsEditExtend: false,
    supportsPerformanceTransfer: false,
  },

  // Runway — Tier 2/3 video, supports first/last-frame, edit/extend, and Act-Two
  // performance transfer. Single row that satisfies Tier 3 rule 1 + 2 + 3 for
  // all video shot types including talking_head.
  {
    provider: "runway",
    tiers: [2, 3],
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
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: true,
  },

  // Kling — Tier 2/3, first/last-frame + edit/extend; no performance transfer.
  {
    provider: "kling",
    tiers: [2, 3],
    shotTypes: [
      "simple_ugc",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: false,
  },

  // HeyGen — Tier 2/3 talking-head digital twin (performance transfer);
  // no first/last-frame or edit/extend at this tier.
  {
    provider: "heygen",
    tiers: [2, 3],
    shotTypes: ["talking_head"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: false,
    supportsEditExtend: false,
    supportsPerformanceTransfer: true,
  },
] as const;
```

### Step 4.4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-capability-matrix.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step 4.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/provider-capability-matrix.ts packages/creative-pipeline/src/pcd/provider-capability-matrix.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 declarative PcdProviderCapabilityMatrix + version constant

Pure data table keyed by (tiers, shotTypes, outputIntents) with three
Tier 3 rule support flags (supportsFirstLastFrame, supportsEditExtend,
supportsPerformanceTransfer). Order is policy. Rows satisfy SP2's
allowed-set coverage and Tier 3 rule-1+2+3 single-row sufficiency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `tier3-routing-rules.ts` — predicates + assertion + error classes + `CampaignTakeStore`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts`
- Create: `packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts`

### Step 5.1: Write the failing tests

- [ ] Create `packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  requiresEditOverRegenerate,
  assertTier3RoutingDecisionCompliant,
  Tier3RoutingViolationError,
  Tier3RoutingMetadataMismatchError,
  type CampaignTakeStore,
  type Tier3RoutingRuleStores,
} from "./tier3-routing-rules.js";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

const ALL_SHOT_TYPES: PcdShotType[] = [
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];
const ALL_OUTPUT_INTENTS: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
const ALL_TIERS: IdentityTier[] = [1, 2, 3];

const VIDEO_SHOTS: ReadonlyArray<PcdShotType> = [
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];
const PUBLISHABLE: ReadonlyArray<OutputIntent> = ["preview", "final_export", "meta_draft"];

describe("requiresFirstLastFrameAnchor", () => {
  it.each(
    ALL_TIERS.flatMap((t) =>
      ALL_SHOT_TYPES.flatMap((s) =>
        ALL_OUTPUT_INTENTS.map((o) => [t, s, o] as const),
      ),
    ),
  )("tier=%s shot=%s intent=%s", (effectiveTier, shotType, outputIntent) => {
    const expected =
      effectiveTier === 3 && VIDEO_SHOTS.includes(shotType) && PUBLISHABLE.includes(outputIntent);
    expect(requiresFirstLastFrameAnchor({ effectiveTier, shotType, outputIntent })).toBe(expected);
  });
});

describe("requiresPerformanceTransfer", () => {
  it.each(
    ALL_TIERS.flatMap((t) => ALL_SHOT_TYPES.map((s) => [t, s] as const)),
  )("tier=%s shot=%s", (effectiveTier, shotType) => {
    const expected = effectiveTier === 3 && shotType === "talking_head";
    expect(requiresPerformanceTransfer({ effectiveTier, shotType })).toBe(expected);
  });
});

function makeCampaignTakeStore(returns: boolean, calls: { count: number }): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      calls.count += 1;
      return returns;
    },
  };
}

describe("requiresEditOverRegenerate", () => {
  it("at Tier 1, never consults the store and returns false", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    const result = await requiresEditOverRegenerate(
      { effectiveTier: 1, organizationId: "o", campaignId: "c" },
      stores,
    );
    expect(result).toBe(false);
    expect(calls.count).toBe(0);
  });

  it("at Tier 2, never consults the store and returns false", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    const result = await requiresEditOverRegenerate(
      { effectiveTier: 2, organizationId: "o", campaignId: "c" },
      stores,
    );
    expect(result).toBe(false);
    expect(calls.count).toBe(0);
  });

  it("at Tier 3, returns the store's verdict (true)", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    expect(
      await requiresEditOverRegenerate(
        { effectiveTier: 3, organizationId: "o", campaignId: "c" },
        stores,
      ),
    ).toBe(true);
    expect(calls.count).toBe(1);
  });

  it("at Tier 3, returns the store's verdict (false)", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(false, calls),
    };
    expect(
      await requiresEditOverRegenerate(
        { effectiveTier: 3, organizationId: "o", campaignId: "c" },
        stores,
      ),
    ).toBe(false);
    expect(calls.count).toBe(1);
  });
});

const SUPPORTS_ALL: PcdProviderCapability = {
  provider: "test-all",
  tiers: [1, 2, 3],
  shotTypes: [...ALL_SHOT_TYPES],
  outputIntents: [...ALL_OUTPUT_INTENTS],
  supportsFirstLastFrame: true,
  supportsEditExtend: true,
  supportsPerformanceTransfer: true,
};

const SUPPORTS_NONE: PcdProviderCapability = {
  ...SUPPORTS_ALL,
  provider: "test-none",
  supportsFirstLastFrame: false,
  supportsEditExtend: false,
  supportsPerformanceTransfer: false,
};

describe("assertTier3RoutingDecisionCompliant — capability checks", () => {
  it("returns void at Tier 1/2 regardless of capability flags", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 1,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_NONE,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 2,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_NONE,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });

  it("Tier 3 + simple_ugc + final_export: rule 1 required, capability supports it → returns void", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });

  it("Tier 3 + rule 1 required, capability missing supportsFirstLastFrame → throws Tier3RoutingViolationError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsFirstLastFrame: false },
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("Tier 3 + talking_head: rule 1 + rule 2 required → both flags must be present on capability", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsPerformanceTransfer: false },
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("Tier 3 + rule 3 required (editOverRegenerateRequired=true), capability missing supportsEditExtend → throws", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsEditExtend: false },
        tier3RulesApplied: ["first_last_frame_anchor", "edit_over_regenerate"],
        editOverRegenerateRequired: true,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });
});

describe("assertTier3RoutingDecisionCompliant — forensic-vs-enforcement separation (bypass closure)", () => {
  it("BYPASS CLOSURE: editOverRegenerateRequired=true + tier3RulesApplied=[] + supportsEditExtend=false throws Tier3RoutingViolationError", () => {
    // Caller suppresses tier3RulesApplied to hide the rule. Recompute path
    // identifies rule 3 as required (from explicit boolean), finds capability
    // missing the flag, throws — regardless of forensic claim.
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: {
          ...SUPPORTS_ALL,
          supportsEditExtend: false,
        },
        tier3RulesApplied: [], // caller lies
        editOverRegenerateRequired: true,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("FORENSIC MISMATCH: rule 1 recomputed-required but tier3RulesApplied=[] (capability OK) → Tier3RoutingMetadataMismatchError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: [], // omits required rule 1
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingMetadataMismatchError);
  });

  it("FORENSIC MISMATCH: rule 1 NOT recomputed-required but tier3RulesApplied=['first_last_frame_anchor'] → Tier3RoutingMetadataMismatchError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "script_only",  // not a video shot; rule 1 not recomputed-required
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor"], // forensic claims a rule that did not fire
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingMetadataMismatchError);
  });

  it("tier3RulesApplied set equality is order-independent", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["performance_transfer", "first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });
});

describe("Error class shapes", () => {
  it("Tier3RoutingViolationError populates name + rule + provider", () => {
    try {
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsFirstLastFrame: false },
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Tier3RoutingViolationError);
      const e = err as Tier3RoutingViolationError;
      expect(e.name).toBe("Tier3RoutingViolationError");
      expect(e.rule).toBe("first_last_frame_anchor");
      expect(e.provider).toBe("test-all");
      expect(e.message).toContain("first_last_frame_anchor");
      expect(e.message).toContain("test-all");
    }
  });

  it("Tier3RoutingMetadataMismatchError populates name + expected + actual", () => {
    try {
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Tier3RoutingMetadataMismatchError);
      const e = err as Tier3RoutingMetadataMismatchError;
      expect(e.name).toBe("Tier3RoutingMetadataMismatchError");
      expect(e.expected).toEqual(["first_last_frame_anchor"]);
      expect(e.actual).toEqual([]);
    }
  });
});

describe("Forbidden imports in tier3-routing-rules.ts", () => {
  it("contains none of the forbidden import paths", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "tier3-routing-rules.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
  });
});
```

### Step 5.2: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/tier3-routing-rules.test.ts`
- [ ] Expected: FAIL — module does not exist.

### Step 5.3: Implement the rules module

- [ ] Create `packages/creative-pipeline/src/pcd/tier3-routing-rules.ts`:

```ts
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";

export type Tier3Rule =
  | "first_last_frame_anchor"
  | "performance_transfer"
  | "edit_over_regenerate";

export type CampaignTakeStore = {
  hasApprovedTier3TakeForCampaign(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<boolean>;
};

export type Tier3RoutingRuleStores = {
  campaignTakeStore: CampaignTakeStore;
};

export class Tier3RoutingViolationError extends Error {
  constructor(
    public readonly rule: Tier3Rule,
    public readonly provider: string,
  ) {
    super(
      `Tier 3 routing rule violated: ${rule} required but provider "${provider}" does not support it`,
    );
    this.name = "Tier3RoutingViolationError";
  }
}

export class Tier3RoutingMetadataMismatchError extends Error {
  constructor(
    public readonly expected: ReadonlyArray<Tier3Rule>,
    public readonly actual: ReadonlyArray<Tier3Rule>,
  ) {
    super(
      `Tier 3 routing metadata mismatch: expected rules [${expected.join(",")}] but routingDecisionReason.tier3RulesApplied was [${actual.join(",")}]`,
    );
    this.name = "Tier3RoutingMetadataMismatchError";
  }
}

const VIDEO_SHOTS: ReadonlySet<PcdShotType> = new Set<PcdShotType>([
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
]);

const PUBLISHABLE_INTENTS: ReadonlySet<OutputIntent> = new Set<OutputIntent>([
  "preview",
  "final_export",
  "meta_draft",
]);

export function requiresFirstLastFrameAnchor(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
}): boolean {
  return (
    input.effectiveTier === 3 &&
    VIDEO_SHOTS.has(input.shotType) &&
    PUBLISHABLE_INTENTS.has(input.outputIntent)
  );
}

export function requiresPerformanceTransfer(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
}): boolean {
  return input.effectiveTier === 3 && input.shotType === "talking_head";
}

export async function requiresEditOverRegenerate(
  input: {
    effectiveTier: IdentityTier;
    organizationId: string;
    campaignId: string;
  },
  stores: Tier3RoutingRuleStores,
): Promise<boolean> {
  if (input.effectiveTier !== 3) return false;
  return stores.campaignTakeStore.hasApprovedTier3TakeForCampaign({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
  });
}

export function assertTier3RoutingDecisionCompliant(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  tier3RulesApplied: ReadonlyArray<Tier3Rule>;
  editOverRegenerateRequired: boolean;
}): void {
  if (input.effectiveTier !== 3) return;

  // Step A — recompute the required-rule set from authoritative sources
  // (pure predicates for rules 1/2; explicit boolean for rule 3). Never
  // read tier3RulesApplied as enforcement input.
  const required: Tier3Rule[] = [];
  if (
    requiresFirstLastFrameAnchor({
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
    })
  ) {
    required.push("first_last_frame_anchor");
  }
  if (
    requiresPerformanceTransfer({
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
    })
  ) {
    required.push("performance_transfer");
  }
  if (input.editOverRegenerateRequired) {
    required.push("edit_over_regenerate");
  }

  // Step B — capability check. For each required rule, the selected
  // capability must have the matching support flag.
  for (const rule of required) {
    if (rule === "first_last_frame_anchor" && !input.selectedCapability.supportsFirstLastFrame) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (
      rule === "performance_transfer" &&
      !input.selectedCapability.supportsPerformanceTransfer
    ) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (rule === "edit_over_regenerate" && !input.selectedCapability.supportsEditExtend) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
  }

  // Step C — forensic consistency. tier3RulesApplied (caller-supplied) must
  // exactly equal the recomputed required set as a set (order-independent).
  // Capability check passes, but a forensic-record mismatch is its own
  // distinct error so investigations can tell the two failure modes apart.
  const reqSet = new Set<Tier3Rule>(required);
  const actSet = new Set<Tier3Rule>(input.tier3RulesApplied);
  if (reqSet.size !== actSet.size || ![...reqSet].every((r) => actSet.has(r))) {
    throw new Tier3RoutingMetadataMismatchError(required, input.tier3RulesApplied);
  }
}
```

### Step 5.4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/tier3-routing-rules.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step 5.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/tier3-routing-rules.ts packages/creative-pipeline/src/pcd/tier3-routing-rules.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 tier3-routing-rules — predicates + assertion + error classes

Pure predicates for rules 1 (first/last-frame anchor) and 2 (performance
transfer); async predicate for rule 3 (edit-over-regenerate, gated on
campaignTakeStore). assertTier3RoutingDecisionCompliant derives required
rules from pure recomputes plus explicit editOverRegenerateRequired
boolean — tier3RulesApplied is forensic metadata, validated for set
equality only. Two error classes: Tier3RoutingViolationError (capability
missing flag) and Tier3RoutingMetadataMismatchError (forensic record
diverges from recompute). Closes the bypass where caller suppresses
tier3RulesApplied to hide a violation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `provider-router.ts` — `routePcdShot` + `PCD_PROVIDER_ROUTER_VERSION` + `ApprovedCampaignContext`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provider-router.ts`
- Create: `packages/creative-pipeline/src/pcd/provider-router.test.ts`

### Step 6.1: Write the failing tests

- [ ] Create `packages/creative-pipeline/src/pcd/provider-router.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  routePcdShot,
  PCD_PROVIDER_ROUTER_VERSION,
  type ApprovedCampaignContext,
  type PcdRoutingDecision,
  type ProviderRouterStores,
  type RoutePcdShotInput,
} from "./provider-router.js";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import type { CampaignTakeStore } from "./tier3-routing-rules.js";
import type { ResolvedPcdContext } from "./registry-resolver.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

function makeContext(overrides: Partial<ResolvedPcdContext> = {}): ResolvedPcdContext {
  return {
    productIdentityId: "p-1",
    creatorIdentityId: "c-1",
    productTier: 2,
    creatorTier: 2,
    effectiveTier: 2,
    allowedOutputTier: 2,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    ...overrides,
  };
}

function makeCampaignTakeStore(returns: boolean, log: { calls: number }): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      log.calls += 1;
      return returns;
    },
  };
}

function neverConsultedStore(): { store: CampaignTakeStore; log: { calls: number } } {
  const log = { calls: 0 };
  return {
    store: {
      hasApprovedTier3TakeForCampaign: async () => {
        log.calls += 1;
        return true;
      },
    },
    log,
  };
}

const NO_CAMPAIGN: ApprovedCampaignContext = { kind: "none" };
const WITH_CAMPAIGN: ApprovedCampaignContext = {
  kind: "campaign",
  organizationId: "org-1",
  campaignId: "camp-1",
};

describe("PCD_PROVIDER_ROUTER_VERSION", () => {
  it("is locked at provider-router@1.0.0", () => {
    expect(PCD_PROVIDER_ROUTER_VERSION).toBe("provider-router@1.0.0");
  });
});

describe("routePcdShot — Part A: access-policy gate", () => {
  it("Tier-1 + final_export → ACCESS_POLICY denial; matrix not consulted", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 1,
          creatorTier: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.denialKind).toBe("ACCESS_POLICY");
    expect(log.calls).toBe(0);
  });

  it("Tier-1 + draft + simple_ugc → allowed (matrix has Tier-1 draft route)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 1,
          creatorTier: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "script_only",
        outputIntent: "draft",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
  });

  it("component-tier passthrough: (productTier=3, creatorTier=1) maps to (productTier=3, avatarTier=1) for SP2 policy", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 1,
          effectiveTier: 1, // min
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    // SP2 should deny because effectiveTier=1 < 2 required for final_export.
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.denialKind).toBe("ACCESS_POLICY");
      // Verify the SP2 decision was computed with the component tiers passed
      // through correctly: requiredAvatarTier=2 (not 3, since the floor is 2 for
      // final_export, not the shot-level 3).
      expect(result.accessDecision.allowed).toBe(false);
    }
  });
});

describe("routePcdShot — Part B: matrix filter + Tier 3 rules", () => {
  it("Tier-2 + simple_ugc + final_export + {kind:none} → first matching row selected", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 2,
          creatorTier: 2,
          effectiveTier: 2,
          allowedOutputTier: 2,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
      expect(result.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
      expect(result.decisionReason.tier3RulesApplied).toEqual([]);
    }
    expect(log.calls).toBe(0);
  });

  it("Tier-3 + face_closeup + final_export + {kind:none} → only supportsFirstLastFrame=true rows survive", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "face_closeup",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsFirstLastFrame).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toContain("first_last_frame_anchor");
    }
    expect(log.calls).toBe(0); // {kind:none}
  });

  it("Tier-3 + talking_head + preview + {kind:none} → rule 1 + rule 2 both required, only matching rows survive", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "talking_head",
        outputIntent: "preview",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsFirstLastFrame).toBe(true);
      expect(result.selectedCapability.supportsPerformanceTransfer).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toEqual(
        expect.arrayContaining(["first_last_frame_anchor", "performance_transfer"]),
      );
    }
  });

  it("Tier-3 + simple_ugc + final_export + {kind:campaign} + store=true → rule 3 active, supportsEditExtend=true required", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(true, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsEditExtend).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toContain("edit_over_regenerate");
    }
    expect(log.calls).toBe(1);
  });

  it("Tier-3 + {kind:campaign} + store=false → rule 3 NOT applied", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.tier3RulesApplied).not.toContain("edit_over_regenerate");
    }
    expect(log.calls).toBe(1); // store consulted under {kind:campaign}
  });

  it("Tier-3 + {kind:none} → rule 3 short-circuits; campaignTakeStore never called", async () => {
    const { store, log } = neverConsultedStore();
    const stores: ProviderRouterStores = { campaignTakeStore: store };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    expect(log.calls).toBe(0);
  });
});

describe("routePcdShot — Part C: empty candidates (NO_PROVIDER_CAPABILITY)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("Tier-3 + face_closeup + final_export with synthetic matrix lacking supportsFirstLastFrame → NO_PROVIDER_CAPABILITY denial", async () => {
    const syntheticMatrix: ReadonlyArray<PcdProviderCapability> = [
      {
        provider: "synth-only",
        tiers: [3],
        shotTypes: ["face_closeup"],
        outputIntents: ["final_export"],
        supportsFirstLastFrame: false, // rule 1 cannot be satisfied
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
    ];

    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: syntheticMatrix,
    }));

    // Re-import after mocking.
    const { routePcdShot: routePcdShotFresh } = await import("./provider-router.js");

    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShotFresh(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "face_closeup",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.denialKind).toBe("NO_PROVIDER_CAPABILITY");
      if (result.denialKind === "NO_PROVIDER_CAPABILITY") {
        // accessDecision is unmutated; SP2 *did* allow this shot.
        expect(result.accessDecision.allowed).toBe(true);
        expect(result.candidatesAfterTier3Filter).toBe(0);
      }
    }
  });
});

describe("routePcdShot — Part D: decision reason shape", () => {
  it("Tier-2 allowed: tier3RulesApplied is empty; matchedEffectiveTier=2; capabilityRefIndex points back to live matrix", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 2,
          creatorTier: 2,
          effectiveTier: 2,
          allowedOutputTier: 2,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.tier3RulesApplied).toEqual([]);
      expect(result.decisionReason.matchedEffectiveTier).toBe(2);
      expect(result.decisionReason.candidatesEvaluated).toBeGreaterThanOrEqual(1);
      expect(PCD_PROVIDER_CAPABILITY_MATRIX[result.decisionReason.capabilityRefIndex]).toBe(
        result.selectedCapability,
      );
    }
  });

  it("selectionRationale is a non-empty string ≤200 chars", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext(),
        shotType: "simple_ugc",
        outputIntent: "preview",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.selectionRationale.length).toBeGreaterThan(0);
      expect(result.decisionReason.selectionRationale.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("routePcdShot — Part E: determinism", () => {
  it("two consecutive calls with identical inputs → deep-equal decisions", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const input: RoutePcdShotInput = {
      resolvedContext: makeContext({
        productTier: 3,
        creatorTier: 3,
        effectiveTier: 3,
        allowedOutputTier: 3,
      }),
      shotType: "talking_head",
      outputIntent: "final_export",
      approvedCampaignContext: NO_CAMPAIGN,
    };
    const r1 = await routePcdShot(input, stores);
    const r2 = await routePcdShot(input, stores);
    expect(r1).toEqual(r2);
  });
});

describe("routePcdShot — Part F: first-match is policy", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("reordering matrix rows changes which provider is selected", async () => {
    const rowA: PcdProviderCapability = {
      provider: "provider-a",
      tiers: [2],
      shotTypes: ["simple_ugc"],
      outputIntents: ["final_export"],
      supportsFirstLastFrame: false,
      supportsEditExtend: false,
      supportsPerformanceTransfer: false,
    };
    const rowB: PcdProviderCapability = { ...rowA, provider: "provider-b" };

    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: [rowA, rowB],
    }));
    const { routePcdShot: route1 } = await import("./provider-router.js");
    const log = { calls: 0 };
    const r1 = await route1(
      {
        resolvedContext: makeContext({ effectiveTier: 2, productTier: 2, creatorTier: 2, allowedOutputTier: 2 }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      { campaignTakeStore: makeCampaignTakeStore(false, log) },
    );

    vi.resetModules();
    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: [rowB, rowA],
    }));
    const { routePcdShot: route2 } = await import("./provider-router.js");
    const r2 = await route2(
      {
        resolvedContext: makeContext({ effectiveTier: 2, productTier: 2, creatorTier: 2, allowedOutputTier: 2 }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      { campaignTakeStore: makeCampaignTakeStore(false, log) },
    );

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    if (r1.allowed && r2.allowed) {
      expect(r1.selectedProvider).toBe("provider-a");
      expect(r2.selectedProvider).toBe("provider-b");
    }
  });
});

describe("routePcdShot — Part G: end-to-end matrix-router agreement (Tier 3)", () => {
  const ALL_SHOT_TYPES: PcdShotType[] = [
    "script_only",
    "storyboard",
    "simple_ugc",
    "talking_head",
    "product_demo",
    "product_in_hand",
    "face_closeup",
    "label_closeup",
    "object_insert",
  ];
  const ALL_OUTPUT_INTENTS: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];

  function tier3AllowedTriples(): Array<[PcdShotType, OutputIntent]> {
    const out: Array<[PcdShotType, OutputIntent]> = [];
    for (const s of ALL_SHOT_TYPES) {
      for (const i of ALL_OUTPUT_INTENTS) {
        const d = decidePcdGenerationAccess({
          avatarTier: 3,
          productTier: 3,
          shotType: s,
          outputIntent: i,
        });
        if (d.allowed) out.push([s, i]);
      }
    }
    return out;
  }

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:none} → routePcdShot allows (live matrix sufficient for rules 1/2)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(false, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: NO_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:campaign}+store=true → routePcdShot allows (rule 1+2+3 sufficient on a single matrix row)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(true, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: WITH_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:campaign}+store=false → routePcdShot allows (rule 3 not active)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(false, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: WITH_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );
});

describe("Forbidden imports in provider-router.ts", () => {
  it("contains none of the forbidden import paths (and never re-imports PCD_SHOT_SPEC_VERSION)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-router.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
    expect(src).not.toMatch(/from ["']\.\/shot-spec-version\.js["']/);
  });

  it("contains no hardcoded provider name string literal in conditional position", () => {
    // We assert the source has no `=== "kling"` / `=== "runway"` / etc. style
    // conditionals. The router must reference selected.provider, not literals.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-router.ts"), "utf8");
    expect(src).not.toMatch(/===\s*["'](kling|runway|heygen|sora|veo|openai_text)["']/);
    expect(src).not.toMatch(/!==\s*["'](kling|runway|heygen|sora|veo|openai_text)["']/);
  });
});
```

### Step 6.2: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-router.test.ts`
- [ ] Expected: FAIL — module does not exist.

### Step 6.3: Implement the router

- [ ] Create `packages/creative-pipeline/src/pcd/provider-router.ts`:

```ts
import type {
  IdentityTier,
  OutputIntent,
  PcdRoutingDecisionReason,
  PcdShotType,
  PcdTierDecision,
} from "@creativeagent/schemas";
import type { ResolvedPcdContext } from "./registry-resolver.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import {
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type CampaignTakeStore,
  type Tier3Rule,
} from "./tier3-routing-rules.js";

export const PCD_PROVIDER_ROUTER_VERSION = "provider-router@1.0.0";

export type ApprovedCampaignContext =
  | { kind: "campaign"; organizationId: string; campaignId: string }
  | { kind: "none" };

export type ProviderRouterStores = {
  campaignTakeStore: CampaignTakeStore;
};

export type RoutePcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export type PcdRoutingDecision =
  | {
      allowed: false;
      denialKind: "ACCESS_POLICY";
      accessDecision: PcdTierDecision;
    }
  | {
      allowed: false;
      denialKind: "NO_PROVIDER_CAPABILITY";
      accessDecision: PcdTierDecision;
      reason: "no provider satisfies tier3 routing rules for this shot";
      requiredActions: ReadonlyArray<"choose_safer_shot_type">;
      candidatesEvaluated: number;
      candidatesAfterTier3Filter: number;
    }
  | {
      allowed: true;
      accessDecision: PcdTierDecision;
      selectedCapability: PcdProviderCapability;
      selectedProvider: string;
      providerCapabilityVersion: typeof PCD_PROVIDER_CAPABILITY_VERSION;
      routerVersion: typeof PCD_PROVIDER_ROUTER_VERSION;
      decisionReason: PcdRoutingDecisionReason;
    };

function buildSelectionRationale(
  effectiveTier: IdentityTier,
  shotType: PcdShotType,
  outputIntent: OutputIntent,
  selectedProvider: string,
  rulesApplied: ReadonlyArray<Tier3Rule>,
): string {
  const rulesPart = rulesApplied.length === 0 ? "no tier3 rules" : `tier3 rules [${rulesApplied.join(",")}]`;
  const out = `tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → ${selectedProvider} (${rulesPart})`;
  return out.length > 200 ? out.slice(0, 200) : out;
}

export async function routePcdShot(
  input: RoutePcdShotInput,
  stores: ProviderRouterStores,
): Promise<PcdRoutingDecision> {
  const { resolvedContext, shotType, outputIntent, approvedCampaignContext } = input;

  // Step 1 — Tier policy gate.
  const accessDecision = decidePcdGenerationAccess({
    avatarTier: resolvedContext.creatorTier,
    productTier: resolvedContext.productTier,
    shotType,
    outputIntent,
  });
  if (!accessDecision.allowed) {
    return { allowed: false, denialKind: "ACCESS_POLICY", accessDecision };
  }

  // Step 2 — Matrix candidate set.
  let candidates = PCD_PROVIDER_CAPABILITY_MATRIX.filter(
    (c) =>
      c.tiers.includes(resolvedContext.effectiveTier) &&
      c.shotTypes.includes(shotType) &&
      c.outputIntents.includes(outputIntent),
  );
  const candidatesEvaluated = candidates.length;

  // Step 3 — Tier 3 rule application.
  const tier3RulesApplied: Tier3Rule[] = [];
  if (resolvedContext.effectiveTier === 3) {
    if (
      requiresFirstLastFrameAnchor({
        effectiveTier: resolvedContext.effectiveTier,
        shotType,
        outputIntent,
      })
    ) {
      candidates = candidates.filter((c) => c.supportsFirstLastFrame);
      tier3RulesApplied.push("first_last_frame_anchor");
    }
    if (
      requiresPerformanceTransfer({
        effectiveTier: resolvedContext.effectiveTier,
        shotType,
      })
    ) {
      candidates = candidates.filter((c) => c.supportsPerformanceTransfer);
      tier3RulesApplied.push("performance_transfer");
    }
    if (approvedCampaignContext.kind === "campaign") {
      const editOverRegenerateRequired = await requiresEditOverRegenerate(
        {
          effectiveTier: resolvedContext.effectiveTier,
          organizationId: approvedCampaignContext.organizationId,
          campaignId: approvedCampaignContext.campaignId,
        },
        stores,
      );
      if (editOverRegenerateRequired) {
        candidates = candidates.filter((c) => c.supportsEditExtend);
        tier3RulesApplied.push("edit_over_regenerate");
      }
    }
  }
  const candidatesAfterTier3Filter = candidates.length;

  // Step 4 — Selection or empty-candidates denial.
  if (candidates.length === 0) {
    return {
      allowed: false,
      denialKind: "NO_PROVIDER_CAPABILITY",
      accessDecision,
      reason: "no provider satisfies tier3 routing rules for this shot",
      requiredActions: ["choose_safer_shot_type"],
      candidatesEvaluated,
      candidatesAfterTier3Filter,
    };
  }
  const selected = candidates[0];

  // Step 5 — Build allowed decision.
  return {
    allowed: true,
    accessDecision,
    selectedCapability: selected,
    selectedProvider: selected.provider,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    decisionReason: {
      capabilityRefIndex: PCD_PROVIDER_CAPABILITY_MATRIX.indexOf(selected),
      matchedShotType: shotType,
      matchedEffectiveTier: resolvedContext.effectiveTier,
      matchedOutputIntent: outputIntent,
      tier3RulesApplied,
      candidatesEvaluated,
      candidatesAfterTier3Filter,
      selectionRationale: buildSelectionRationale(
        resolvedContext.effectiveTier,
        shotType,
        outputIntent,
        selected.provider,
        tier3RulesApplied,
      ),
    },
  };
}
```

### Step 6.4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/provider-router.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step 6.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/provider-router.ts packages/creative-pipeline/src/pcd/provider-router.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 routePcdShot — tier policy gate + matrix lookup + Tier 3 rules

Pure async function with injected campaignTakeStore. Step 1 calls
decidePcdGenerationAccess unconditionally; Step 2 filters
PCD_PROVIDER_CAPABILITY_MATRIX by (effectiveTier, shotType, outputIntent);
Step 3 applies Tier 3 rules under effectiveTier=3 (rules 1/2 pure,
rule 3 only under approvedCampaignContext.kind === "campaign"); Step 4
returns NO_PROVIDER_CAPABILITY denial if filter empties; Step 5 emits
allowed decision with router/capability versions + structured
PcdRoutingDecisionReason. ApprovedCampaignContext discriminated union
avoids fake campaignIds for non-campaign generation paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `pcd-identity-snapshot-writer.ts` — `writePcdIdentitySnapshot`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts`
- Create: `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts`

### Step 7.1: Write the failing tests

- [ ] Create `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  writePcdIdentitySnapshot,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotWriterStores,
  type WritePcdIdentitySnapshotInput,
} from "./pcd-identity-snapshot-writer.js";
import { PCD_TIER_POLICY_VERSION } from "./tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "./provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "./provider-router.js";
import {
  Tier3RoutingMetadataMismatchError,
  Tier3RoutingViolationError,
} from "./tier3-routing-rules.js";
import type { PcdIdentitySnapshot, PcdRoutingDecisionReason } from "@creativeagent/schemas";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";

type RecordedCall = Parameters<PcdIdentitySnapshotStore["createForShot"]>[0];

function makeFakeStore(): {
  store: PcdIdentitySnapshotStore;
  calls: RecordedCall[];
  returnValue: () => PcdIdentitySnapshot;
} {
  const calls: RecordedCall[] = [];
  const store: PcdIdentitySnapshotStore = {
    createForShot: async (input) => {
      calls.push(input);
      return {
        id: "snap-1",
        createdAt: new Date("2026-04-28T00:00:00Z"),
        ...input,
      } as unknown as PcdIdentitySnapshot;
    },
  };
  return {
    store,
    calls,
    returnValue: () => ({ id: "snap-1", createdAt: new Date(), ...calls[0] }) as unknown as PcdIdentitySnapshot,
  };
}

function makeStores(s: PcdIdentitySnapshotStore): PcdIdentitySnapshotWriterStores {
  return { pcdIdentitySnapshotStore: s };
}

const CAP_ALL: PcdProviderCapability = {
  provider: "test-all",
  tiers: [1, 2, 3],
  shotTypes: ["simple_ugc", "talking_head", "face_closeup"],
  outputIntents: ["draft", "preview", "final_export", "meta_draft"],
  supportsFirstLastFrame: true,
  supportsEditExtend: true,
  supportsPerformanceTransfer: true,
};

function makeReason(overrides: Partial<PcdRoutingDecisionReason> = {}): PcdRoutingDecisionReason {
  return {
    capabilityRefIndex: 0,
    matchedShotType: "simple_ugc",
    matchedEffectiveTier: 2,
    matchedOutputIntent: "final_export",
    tier3RulesApplied: [],
    candidatesEvaluated: 1,
    candidatesAfterTier3Filter: 1,
    selectionRationale: "test",
    ...overrides,
  };
}

function makeInput(overrides: Partial<WritePcdIdentitySnapshotInput> = {}): WritePcdIdentitySnapshotInput {
  return {
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    selectedProvider: "test-all",
    providerModelSnapshot: "test-all-v1",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@0.5.0", // intentionally not the current value
    routerVersion: "ignored",            // caller cannot force; writer pins from import
    routingDecisionReason: makeReason(),
    effectiveTier: 2,
    shotType: "simple_ugc",
    outputIntent: "final_export",
    selectedCapability: CAP_ALL,
    editOverRegenerateRequired: false,
    ...overrides,
  };
}

describe("writePcdIdentitySnapshot — Part A: version pinning", () => {
  it("policyVersion comes from PCD_TIER_POLICY_VERSION import (caller cannot override)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        // Caller tries to spread a bogus policyVersion onto the input.
        ...({ policyVersion: "tier-policy@bogus" } as unknown as Partial<WritePcdIdentitySnapshotInput>),
      }),
      makeStores(store),
    );
    expect(calls[0].policyVersion).toBe(PCD_TIER_POLICY_VERSION);
  });

  it("providerCapabilityVersion comes from import", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(calls[0].providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
  });

  it("routerVersion comes from import (caller-supplied input.routerVersion is ignored)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({ routerVersion: "provider-router@bogus" }),
      makeStores(store),
    );
    expect(calls[0].routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
  });

  it("shotSpecVersion mirrors input.shotSpecVersion exactly (carries SP3 stamp forward)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({ shotSpecVersion: "shot-spec@0.5.0" }),
      makeStores(store),
    );
    expect(calls[0].shotSpecVersion).toBe("shot-spec@0.5.0");
  });
});

describe("writePcdIdentitySnapshot — Part B: Tier 3 second-line-of-defense", () => {
  it("Tier 1 input → no Tier 3 assertion; persists", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        effectiveTier: 1,
        productTierAtGeneration: 1,
        avatarTierAtGeneration: 1,
        routingDecisionReason: makeReason({ matchedEffectiveTier: 1 }),
      }),
      makeStores(store),
    );
    expect(calls.length).toBe(1);
  });

  it("Tier 3 + compliant capability and matching tier3RulesApplied → persists", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        productTierAtGeneration: 3,
        avatarTierAtGeneration: 3,
        selectedCapability: CAP_ALL,
        editOverRegenerateRequired: false,
        routingDecisionReason: makeReason({
          matchedEffectiveTier: 3,
          tier3RulesApplied: ["first_last_frame_anchor"],
        }),
      }),
      makeStores(store),
    );
    expect(calls.length).toBe(1);
  });

  it("Tier 3 + rule 1 required + capability missing supportsFirstLastFrame → throws Tier3RoutingViolationError; createForShot never called", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsFirstLastFrame: false },
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("Tier 3 + rule 2 required (talking_head) + capability missing supportsPerformanceTransfer → throws", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "talking_head",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsPerformanceTransfer: false },
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedShotType: "talking_head",
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("Tier 3 + rule 3 required + capability missing supportsEditExtend → throws", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsEditExtend: false },
          editOverRegenerateRequired: true,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor", "edit_over_regenerate"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("BYPASS CLOSURE: editOverRegenerateRequired=true + tier3RulesApplied=[] + supportsEditExtend=false → throws Tier3RoutingViolationError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsEditExtend: false },
          editOverRegenerateRequired: true,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: [], // caller suppresses forensic record
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("FORENSIC MISMATCH: capability OK but tier3RulesApplied diverges from recompute → throws Tier3RoutingMetadataMismatchError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: CAP_ALL,
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: [], // recompute requires rule 1
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingMetadataMismatchError);
    expect(calls.length).toBe(0);
  });
});

describe("writePcdIdentitySnapshot — Part C: input validation", () => {
  it("missing routingDecisionReason → ZodError; createForShot not called", async () => {
    const { store, calls } = makeFakeStore();
    const bad = makeInput();
    delete (bad as Partial<WritePcdIdentitySnapshotInput>).routingDecisionReason;
    await expect(writePcdIdentitySnapshot(bad, makeStores(store))).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it("selectionRationale > 200 chars → ZodError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          routingDecisionReason: makeReason({ selectionRationale: "x".repeat(201) }),
        }),
        makeStores(store),
      ),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});

describe("writePcdIdentitySnapshot — Part D: persistence shape", () => {
  it("happy path: createForShot called once with all SP4 forensic fields populated non-null", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(calls.length).toBe(1);
    const c = calls[0];
    expect(c.shotSpecVersion).not.toBeNull();
    expect(c.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
    expect(c.routingDecisionReason).not.toBeNull();
    expect(c.policyVersion).toBe(PCD_TIER_POLICY_VERSION);
    expect(c.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
    expect(c.selectedProvider).toBe("test-all");
  });

  it("returns the fake store's response without transformation", async () => {
    const { store, calls } = makeFakeStore();
    const out = await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(out.assetRecordId).toBe(calls[0].assetRecordId);
    expect(out.id).toBe("snap-1");
  });
});

describe("Forbidden imports in pcd-identity-snapshot-writer.ts", () => {
  it("contains none of the forbidden import paths and never imports PCD_SHOT_SPEC_VERSION", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "pcd-identity-snapshot-writer.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
    expect(src).not.toMatch(/from ["']\.\/shot-spec-version\.js["']/);
    expect(src).not.toMatch(/PCD_SHOT_SPEC_VERSION/);
  });
});
```

### Step 7.2: Run tests to verify failure

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/pcd-identity-snapshot-writer.test.ts`
- [ ] Expected: FAIL — module does not exist.

### Step 7.3: Implement the writer

- [ ] Create `packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts`:

```ts
import {
  type IdentityTier,
  type OutputIntent,
  type PcdIdentitySnapshot,
  type PcdRoutingDecisionReason,
  type PcdShotType,
  type PcdSp4IdentitySnapshotInput,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "./tier-policy.js";
import {
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "./provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "./tier3-routing-rules.js";

// Note: this module deliberately does NOT import PCD_SHOT_SPEC_VERSION.
// shotSpecVersion is carried through from input (SP3-stamped on the job);
// re-importing the current value would forensically misrepresent the spec
// version the job was actually planned under.

export type PcdIdentitySnapshotStoreInput = {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: IdentityTier;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: IdentityTier;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  policyVersion: string;
  providerCapabilityVersion: string;
  selectedProvider: string;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  shotSpecVersion: string | null;
  routerVersion: string | null;
  routingDecisionReason: PcdRoutingDecisionReason | null;
};

export type PcdIdentitySnapshotStore = {
  createForShot(input: PcdIdentitySnapshotStoreInput): Promise<PcdIdentitySnapshot>;
};

export type PcdIdentitySnapshotWriterStores = {
  pcdIdentitySnapshotStore: PcdIdentitySnapshotStore;
};

export type WritePcdIdentitySnapshotInput = PcdSp4IdentitySnapshotInput & {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  editOverRegenerateRequired: boolean;
};

export async function writePcdIdentitySnapshot(
  input: WritePcdIdentitySnapshotInput,
  stores: PcdIdentitySnapshotWriterStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Validate input shape against PcdSp4IdentitySnapshotInputSchema.
  // Throws ZodError on bad input. Strips unknown keys (e.g. caller-supplied
  // policyVersion / providerCapabilityVersion).
  const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
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
    shotSpecVersion: input.shotSpecVersion,
    routerVersion: input.routerVersion,
    routingDecisionReason: input.routingDecisionReason,
  });

  // Step 2 — Tier 3 second line of defense.
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.effectiveTier,
    shotType: input.shotType,
    outputIntent: input.outputIntent,
    selectedCapability: input.selectedCapability,
    tier3RulesApplied: input.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.editOverRegenerateRequired,
  });

  // Step 3 — Pin version constants from imports (NOT from input).
  const payload: PcdIdentitySnapshotStoreInput = {
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
  };

  // Step 4 — Persist.
  return stores.pcdIdentitySnapshotStore.createForShot(payload);
}
```

### Step 7.4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test -- src/pcd/pcd-identity-snapshot-writer.test.ts`
- [ ] Expected: all PASS.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.

### Step 7.5: Commit

- [ ] ```
git add packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.test.ts
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 writePcdIdentitySnapshot — pure store-injected writer with version pinning

Validates input via PcdSp4IdentitySnapshotInputSchema; runs the Tier 3
second-line-of-defense assertion (recompute-based, not metadata-based);
pins policyVersion / providerCapabilityVersion / routerVersion from
imports (caller cannot override); carries shotSpecVersion forward from
input (writer must NOT re-pin current PCD_SHOT_SPEC_VERSION — forbidden-
imports test enforces). Persists via injected PcdIdentitySnapshotStore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Re-exports + `SWITCHBOARD-CONTEXT.md` merge-back note

**Files:**
- Modify: `packages/creative-pipeline/src/index.ts`
- Modify: `docs/SWITCHBOARD-CONTEXT.md`

### Step 8.1: Update `creative-pipeline/src/index.ts`

- [ ] Open `packages/creative-pipeline/src/index.ts`. Append SP4 re-exports after the existing SP3 block:

```ts
// SP4: provider routing + identity snapshot writer
export {
  PCD_PROVIDER_CAPABILITY_VERSION,
  PCD_PROVIDER_CAPABILITY_MATRIX,
  type PcdProviderCapability,
} from "./pcd/provider-capability-matrix.js";

export {
  PCD_PROVIDER_ROUTER_VERSION,
  routePcdShot,
  type ApprovedCampaignContext,
  type PcdRoutingDecision,
  type ProviderRouterStores,
  type RoutePcdShotInput,
} from "./pcd/provider-router.js";

export {
  writePcdIdentitySnapshot,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotStoreInput,
  type PcdIdentitySnapshotWriterStores,
  type WritePcdIdentitySnapshotInput,
} from "./pcd/pcd-identity-snapshot-writer.js";

export {
  Tier3RoutingMetadataMismatchError,
  Tier3RoutingViolationError,
  assertTier3RoutingDecisionCompliant,
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type CampaignTakeStore,
  type Tier3Rule,
  type Tier3RoutingRuleStores,
} from "./pcd/tier3-routing-rules.js";
```

### Step 8.2: Update `docs/SWITCHBOARD-CONTEXT.md`

- [ ] Open `docs/SWITCHBOARD-CONTEXT.md`. Find the "### SP4 (tier-based routing)" section. Append a final bullet line after the existing "Stub strategy" paragraph:

```markdown
- **CampaignTakeStore is an SP4-declared orchestration dependency; production implementation is reserved for SP6 ApprovalLifecycle/campaign-take ownership at merge-back.**
```

### Step 8.3: Verify barrel exports compile

- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline typecheck`
- [ ] Expected: zero errors.
- [ ] Run: `pnpm --filter @creativeagent/creative-pipeline test`
- [ ] Expected: all SP4 + SP1 + SP2 + SP3 tests still pass.

### Step 8.4: Commit

- [ ] ```
git add packages/creative-pipeline/src/index.ts docs/SWITCHBOARD-CONTEXT.md
git commit -m "$(cat <<'EOF'
feat(pcd): SP4 barrel re-exports + SWITCHBOARD-CONTEXT merge-back note

Adds SP4 public surface to creative-pipeline barrel. Adds one-line
merge-back-ownership note under SP4 in SWITCHBOARD-CONTEXT.md reserving
production CampaignTakeStore implementation for SP6 ApprovalLifecycle/
campaign-take ownership at merge-back.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Whole-repo gate + final verification

### Step 9.1: Run full repo gates

- [ ] Run: `pnpm install`
- [ ] Expected: workspaces resolved.
- [ ] Run: `pnpm db:generate`
- [ ] Expected: Prisma client regenerates without error.
- [ ] Run: `pnpm typecheck`
- [ ] Expected: zero errors across all 3 packages.
- [ ] Run: `pnpm test`
- [ ] Expected: all tests pass — SP1 backfill, SP2 tier policy (576 + 6 named + contract tests), SP3 resolver (existing + Part A delta + 3 SP4-additive deltas), SP4 matrix coverage + tier3 rules + router + writer + schemas SP4. Total ≈ 700+ tests.
- [ ] Run: `pnpm lint`
- [ ] Expected: zero errors. Warnings count unchanged from `main`.

### Step 9.2: Verify migration directory presence and shape

- [ ] Run: `ls packages/db/prisma/migrations/`
- [ ] Expected: three directories — the two SP1 migrations plus exactly one new SP4 directory `<timestamp>_pcd_snapshot_sp4_versions/` containing `migration.sql`.

### Step 9.3: Verify acceptance criteria spot-checks

- [ ] **Acceptance #2 (no hardcoded provider names in conditionals):** `grep -E '===\s*"(kling|runway|heygen|sora|veo|openai_text)"' packages/creative-pipeline/src/pcd/provider-router.ts`
- [ ] Expected: no matches.
- [ ] **Acceptance #4 (writer pins all four versions):** `grep -E 'PCD_TIER_POLICY_VERSION|PCD_PROVIDER_CAPABILITY_VERSION|PCD_PROVIDER_ROUTER_VERSION|shotSpecVersion' packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts`
- [ ] Expected: each constant appears at least once; `shotSpecVersion` appears as `parsed.shotSpecVersion` (carried from input).
- [ ] **Acceptance #8 (no CreativeJob schema change):** `git diff main -- packages/db/prisma/schema.prisma | grep -A 2 'model CreativeJob'`
- [ ] Expected: no diff inside the `CreativeJob` model.

### Step 9.4: Update slice-progress memory file

- [ ] Open `/Users/jasonli/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. Update the SP4 status line and the "obligations parked" section to reflect that SP4 has shipped. Set the new SP5 line to "Next."

```markdown
- **SP4 — Tier-based provider routing + `PcdIdentitySnapshot` writer:** ✅ Merged YYYY-MM-DD to `creativeagent` `main`. Three pure store-injected modules (provider-router, pcd-identity-snapshot-writer, tier3-routing-rules) plus the declarative PcdProviderCapabilityMatrix. ApprovedCampaignContext discriminated union. Tier 3 rules enforced at both router and writer via shared predicate module with recompute-vs-forensic separation; bypass via metadata-suppression closed by Tier3RoutingViolationError. SP3 ResolvedPcdContext extended with productTier + creatorTier; no CreativeJob schema change. Three nullable forensic columns added to PcdIdentitySnapshot via one Prisma migration. CampaignTakeStore production implementation reserved for SP6 merge-back.
- **SP5 — QC gates:** ⏳ Next.
```

### Step 9.5: Final commit (if memory/doc-only changes pending)

- [ ] If any of the above verifications surfaced fixable nits, commit them now. Otherwise no final commit needed; the previous task commits comprise the slice.

### Step 9.6: Offer to open a PR

- [ ] Only if the user requests it: run `git push -u origin <branch>` then `gh pr create` per CLAUDE.md PR conventions. Do NOT push without explicit approval.

---

## Self-Review (writing-plans skill)

**1. Spec coverage:**
- Section 1 (Scope) — Tasks 1, 2, 3, 4, 5, 6, 7, 8 collectively cover all in-scope items; Task 9 verifies out-of-scope items remain untouched.
- Section 2 (File layout & exports) — Tasks 1 (schemas), 2 (Prisma + store), 3 (resolver), 4–7 (four creative-pipeline modules), 8 (barrel + SWITCHBOARD-CONTEXT) — full coverage.
- Section 3 (Decision logic & invariants) — Router algorithm covered in Task 6 implementation + Parts A/B/C/D/E/F/G of router test; writer algorithm covered in Task 7 implementation + Parts A/B/C/D of writer test; both error semantics covered in Task 5 (rules) + Task 7 (writer).
- Section 4 (Test plan) — Tasks 4-7 each include the exact tests called out in the design's Section 4. Resolver deltas covered in Task 3.
- Section 5 (Hard guardrails) — Forbidden-imports tests in every new test file; no-hardcoded-provider grep test in router; "no PCD_SHOT_SPEC_VERSION import" assertion in writer test; Acceptance #8 grep in Task 9.
- Section 6 (Acceptance criteria) — Six locked conditions each map to specific test names; spot-checked in Task 9.
- Section 7 (Module file inventory) — Matches Task ordering.
- Resolved-questions table — Decisions implemented as code (component-tier passthrough, ApprovedCampaignContext, matchedEffectiveTier, recompute-vs-forensic separation, no-CreativeJob-change, etc.).

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "fill in details" patterns. Every step has actual content. The matrix authoring in Task 4 is justified by the test contract — the test asserts what the matrix must contain; the implementation supplies a concrete matrix that passes those tests.

**3. Type consistency:**
- `ResolvedPcdContext` (Task 3) — used in Tasks 6 and 7 with consistent fields (`productTier`, `creatorTier`, `effectiveTier`).
- `PcdProviderCapability` (Task 4) — referenced consistently in Tasks 5, 6, 7 with the same six fields.
- `Tier3Rule` type (Task 5) — used in Task 6's `tier3RulesApplied: Tier3Rule[]` and in Task 5 error class generic params.
- `CampaignTakeStore.hasApprovedTier3TakeForCampaign` signature — same in Tasks 5 (definition) and 6 (router).
- `routePcdShot` input/output types (Task 6) — consumed by Task 7 writer through `WritePcdIdentitySnapshotInput` shape.
- `PcdSp4IdentitySnapshotInput` (Task 1) — used in Task 7's `WritePcdIdentitySnapshotInput`.
- `PCD_TIER_POLICY_VERSION` / `PCD_PROVIDER_CAPABILITY_VERSION` / `PCD_PROVIDER_ROUTER_VERSION` — consistently named across tasks.

No identifier drift detected.
