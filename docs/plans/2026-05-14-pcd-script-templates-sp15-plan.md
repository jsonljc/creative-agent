# SP15 — PCD Script Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the PCD script-templates slice: a `ScriptTemplate` Prisma table + `ScriptTemplatePayload` zod + read-only Prisma reader + pure `selectScript({brief, creatorIdentityId, now, templates})` selector + 24-row placeholder seed + `isPlaceholderScriptText` detection contract, plus the 19th pinned PCD constant `PCD_SCRIPT_SELECTOR_VERSION`.

**Architecture:** Pure decider over a caller-supplied snapshot (matches SP12 `licenseGate`, SP13 `selectSyntheticCreator`, SP14 `resolveDisclosure` precedent). DB reader feeds the snapshot; selector is I/O-free, deterministic, replayable. Four-way filter: `vibe + treatmentClass + status='active' + compatibleCreatorIdentityIds CONTAINS creatorIdentityId`; tie-break `(version DESC, id ASC)`. Discriminated-union failure with two reasons (`no_compatible_script` / `all_filtered_by_creator`). No store, no `listAll`, no wildcards, no render-time enforcement, no time-window columns (lifecycle via `status` only; `now` accepted but unused in v1).

**Tech Stack:** TypeScript 5, pnpm workspaces, Turbo, Vitest, Zod, Prisma 5 (PostgreSQL), conventional commits.

**Spec:** `docs/plans/2026-05-14-pcd-script-templates-sp15-design.md` (committed in `7cf8c11` + `f770c75` + `47ee8a4`).

---

## Worktree & Subagent Discipline

**This plan executes inside `.worktrees/sp15` on branch `pcd/sp15-script-templates`.** The worktree already exists and the SP15 spec is committed there.

**Every subagent prompt MUST start with this preamble:**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pwd                                    # MUST output: /Users/jasonli/creativeagent/.worktrees/sp15
git branch --show-current              # MUST output: pcd/sp15-script-templates
```

If either check fails the subagent must **stop and report**, not "fix" it. The `feedback_subagent_worktree_drift` memory records what happens when this gate is skipped.

**No edits to SP1–SP14 source bodies.** The only allowed cross-slice changes are allowlist maintenance in Task 14. Task 13's `sp15-anti-patterns.test.ts` includes a frozen-source-body check keyed against `43cfdcd` (SP14 merge tip on main).

**Schemas barrel widening lands in Task 1, NOT Task 15.** SP14 surfaced this as a real blocker: the DB reader (Task 5) imports `ScriptTemplatePayload` and `ScriptTemplatePayloadSchema` from `@creativeagent/schemas`. If the schemas barrel hasn't been widened by then, the import fails. The spec explicitly calls this out; bake it into Task 1.

---

## File Structure

### New files (14)

```
packages/schemas/src/
  pcd-script-template.ts                              [Task 1]
  __tests__/pcd-script-template.test.ts               [Task 1]

packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/
  migration.sql                                       [Task 4]

packages/db/src/stores/
  prisma-script-template-reader.ts                    [Task 5]
  prisma-script-template-reader.test.ts               [Task 5]

packages/creative-pipeline/src/pcd/script/
  script-selector-version.ts                          [Task 2]
  script-selector-version.test.ts                     [Task 2]
  script-placeholder.ts                               [Task 3]
  script-placeholder.test.ts                          [Task 3]
  script-seed.ts                                      [Task 6]
  script-seed.test.ts                                 [Task 6]
  script-selector.ts                                  [Tasks 7–12]
  script-selector.test.ts                             [Tasks 7–12]
  sp15-anti-patterns.test.ts                          [Task 13]
  index.ts                                            [Task 15]
```

### Modified files (4 + 8 allowlist)

```
packages/db/prisma/schema.prisma                      [Task 4]
packages/schemas/src/index.ts                         [Task 1 — schemas barrel widened upfront]
packages/db/src/index.ts                              [Task 15]
packages/creative-pipeline/src/index.ts               [Task 15]

8 prior anti-pattern tests (Task 14 — allowlist widening only):
  packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts
  packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts
```

---

### Task 1: Zod schema — `pcd-script-template.ts` (+ schemas barrel widen upfront)

**Goal:** Land the zod payload + decision schemas (success + failure branches) and immediately widen `packages/schemas/src/index.ts` so subsequent tasks can import from `@creativeagent/schemas` without deep-path workarounds. Plan-time **pre-flight check**: confirm SP13/SP14 source still uses `z.union` (not `z.discriminatedUnion`) and mirror the same factory + NB comment style.

**Files:**
- Create: `packages/schemas/src/pcd-script-template.ts`
- Create: `packages/schemas/src/__tests__/pcd-script-template.test.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1.1: Pre-flight — verify SP13/SP14 union factory**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
grep -n "z\.discriminatedUnion\|z\.union" \
  packages/schemas/src/pcd-disclosure-template.ts \
  packages/schemas/src/pcd-synthetic-selector.ts
```

Expected: both files emit `export const ... = z.union([` (today). If either file has switched to `z.discriminatedUnion`, mirror that factory below instead — and update the SP15 NB comment to reflect the current truth. **Do not rationalise away the divergence**; either match the source or stop and report.

- [ ] **Step 1.2: Write the schema test (failing — file does not exist yet)**

Create `packages/schemas/src/__tests__/pcd-script-template.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ScriptSelectionDecisionSchema,
  ScriptSelectionRejectionReasonSchema,
  ScriptTemplatePayloadSchema,
  ScriptTemplateStatusSchema,
} from "../pcd-script-template.js";

const goodRow = {
  id: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  text: "Hook + body + CTA.",
  compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
  version: 1,
  status: "active",
} as const;

describe("ScriptTemplatePayloadSchema", () => {
  it("round-trips a well-formed row", () => {
    expect(() => ScriptTemplatePayloadSchema.parse(goodRow)).not.toThrow();
  });

  it("rejects empty compatibleCreatorIdentityIds (min 1)", () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, compatibleCreatorIdentityIds: [] }),
    ).toThrow();
  });

  it('rejects wildcard "*" inside compatibleCreatorIdentityIds', () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({
        ...goodRow,
        compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01", "*"],
      }),
    ).toThrow();
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, compatibleCreatorIdentityIds: ["*"] }),
    ).toThrow();
  });

  it("rejects version < 1", () => {
    expect(() => ScriptTemplatePayloadSchema.parse({ ...goodRow, version: 0 })).toThrow();
  });

  it("rejects empty text", () => {
    expect(() => ScriptTemplatePayloadSchema.parse({ ...goodRow, text: "" })).toThrow();
  });

  it("rejects text > 8000 chars", () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, text: "x".repeat(8001) }),
    ).toThrow();
  });
});

describe("ScriptTemplateStatusSchema", () => {
  it("accepts active / retired and rejects other values", () => {
    expect(() => ScriptTemplateStatusSchema.parse("active")).not.toThrow();
    expect(() => ScriptTemplateStatusSchema.parse("retired")).not.toThrow();
    expect(() => ScriptTemplateStatusSchema.parse("draft")).toThrow();
  });
});

describe("ScriptSelectionRejectionReasonSchema", () => {
  it('accepts both reasons; rejects "other"', () => {
    expect(() =>
      ScriptSelectionRejectionReasonSchema.parse("no_compatible_script"),
    ).not.toThrow();
    expect(() =>
      ScriptSelectionRejectionReasonSchema.parse("all_filtered_by_creator"),
    ).not.toThrow();
    expect(() => ScriptSelectionRejectionReasonSchema.parse("other")).toThrow();
  });
});

const goodSuccess = {
  allowed: true,
  briefId: "brief_01",
  scriptTemplateId: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  scriptTemplateVersion: 1,
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  scriptText: "Hook + body + CTA.",
  selectorVersion: "pcd-script-selector@1.0.0",
  decisionReason: "script_selected (creator_matched=1, three_way=1, picked_version=1)",
} as const;

const goodFailure = {
  allowed: false,
  briefId: "brief_01",
  reason: "no_compatible_script",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  inspectedTemplateIds: [],
  selectorVersion: "pcd-script-selector@1.0.0",
} as const;

describe("ScriptSelectionDecisionSchema", () => {
  it("round-trips the success branch", () => {
    expect(() => ScriptSelectionDecisionSchema.parse(goodSuccess)).not.toThrow();
  });

  it("round-trips the failure branch", () => {
    expect(() => ScriptSelectionDecisionSchema.parse(goodFailure)).not.toThrow();
  });

  it("rejects a success-shape missing scriptTemplateId", () => {
    const { scriptTemplateId: _drop, ...partial } = goodSuccess;
    expect(() => ScriptSelectionDecisionSchema.parse(partial)).toThrow();
  });

  it("rejects a failure-shape missing reason", () => {
    const { reason: _drop, ...partial } = goodFailure;
    expect(() => ScriptSelectionDecisionSchema.parse(partial)).toThrow();
  });
});
```

- [ ] **Step 1.3: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/schemas test pcd-script-template
```

Expected: FAIL with module-not-found (`pcd-script-template.ts` does not exist yet).

- [ ] **Step 1.4: Create the zod schema**

Create `packages/schemas/src/pcd-script-template.ts`:

```ts
// PCD slice SP15 — Script-template registry zod surface. Mirrors SP14
// (disclosure-template) and SP13 (synthetic-creator selector) precedent:
// readonly payload + readonly discriminated decision (success + failure
// branches). Consumed by Prisma reader (parse-at-the-edges) and by the
// pure selectScript() resolver in the creative-pipeline package.
//
// Material SP14↔SP15 difference: SP15 is creator-keyed. The selector
// takes a bare creatorIdentityId parameter, NOT the SP13
// SyntheticCreatorSelectionDecision. The composer (SP21) joins SP13 +
// SP14 + SP15 decisions for provenance.
import { z } from "zod";
import { TreatmentClassSchema, VibeSchema } from "./creator-identity-synthetic.js";

export const ScriptTemplateStatusSchema = z.enum(["active", "retired"]);
export type ScriptTemplateStatus = z.infer<typeof ScriptTemplateStatusSchema>;

export const ScriptTemplatePayloadSchema = z
  .object({
    id: z.string().min(1),
    vibe: VibeSchema,
    treatmentClass: TreatmentClassSchema,
    text: z.string().min(1).max(8000),
    compatibleCreatorIdentityIds: z
      .array(z.string().min(1))
      .readonly()
      .min(1)
      .refine((ids) => !ids.includes("*"), {
        message: "wildcard creator compatibility forbidden in v1",
      }),
    version: z.number().int().min(1),
    status: ScriptTemplateStatusSchema,
  })
  .readonly();
export type ScriptTemplatePayload = z.infer<typeof ScriptTemplatePayloadSchema>;

export const ScriptSelectionRejectionReasonSchema = z.enum([
  "no_compatible_script",
  "all_filtered_by_creator",
]);
export type ScriptSelectionRejectionReason = z.infer<
  typeof ScriptSelectionRejectionReasonSchema
>;

// NB: `z.union` not `z.discriminatedUnion`. Zod 3.x's discriminatedUnion
// factory does not see literal discriminators on branches wrapped in
// `.readonly()` — the `allowed: z.literal(true) | z.literal(false)` slot
// is invisible to the discriminatedUnion factory. `z.union` parses by
// trying members in order; semantically equivalent for our two-branch
// decision shape. Same carve-out as SP13's SyntheticCreatorSelectionDecision
// (packages/schemas/src/pcd-synthetic-selector.ts) and SP14's
// DisclosureResolutionDecision (packages/schemas/src/pcd-disclosure-template.ts).
export const ScriptSelectionDecisionSchema = z.union([
  z
    .object({
      allowed: z.literal(true),
      briefId: z.string().min(1),
      scriptTemplateId: z.string().min(1),
      vibe: VibeSchema,
      treatmentClass: TreatmentClassSchema,
      scriptTemplateVersion: z.number().int().min(1),
      creatorIdentityId: z.string().min(1),
      scriptText: z.string().min(1),
      selectorVersion: z.string().min(1),
      decisionReason: z.string().min(1).max(2000),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      briefId: z.string().min(1),
      reason: ScriptSelectionRejectionReasonSchema,
      vibe: VibeSchema,
      treatmentClass: TreatmentClassSchema,
      creatorIdentityId: z.string().min(1),
      inspectedTemplateIds: z.array(z.string().min(1)).readonly(),
      selectorVersion: z.string().min(1),
    })
    .readonly(),
]);
export type ScriptSelectionDecision = z.infer<typeof ScriptSelectionDecisionSchema>;
```

- [ ] **Step 1.5: Widen the schemas barrel (upfront — SP14 lesson)**

Edit `packages/schemas/src/index.ts` — append after the SP14 line:

```ts
// SP15 — script templates
export * from "./pcd-script-template.js";
```

- [ ] **Step 1.6: Run tests + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/schemas test pcd-script-template
pnpm --filter @creativeagent/schemas typecheck
```

Expected: all schema tests PASS. Typecheck clean.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/schemas/src/pcd-script-template.ts \
        packages/schemas/src/__tests__/pcd-script-template.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP15 task 1 — ScriptTemplatePayload + ScriptSelectionDecision zod + barrel widen"
```

---

### Task 2: 19th pinned PCD constant — `script-selector-version.ts`

**Goal:** Land `PCD_SCRIPT_SELECTOR_VERSION = "pcd-script-selector@1.0.0"` in exactly one non-test source file. The anti-pattern test in Task 13 enforces single-source.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/script-selector-version.ts`
- Create: `packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";

describe("PCD_SCRIPT_SELECTOR_VERSION", () => {
  it('is the literal "pcd-script-selector@1.0.0"', () => {
    expect(PCD_SCRIPT_SELECTOR_VERSION).toBe("pcd-script-selector@1.0.0");
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector-version
```

Expected: FAIL with module-not-found.

- [ ] **Step 2.3: Create the constant**

Create `packages/creative-pipeline/src/pcd/script/script-selector-version.ts`:

```ts
// PCD slice SP15 — 19th pinned PCD constant.
// Selector-logic version. Distinct from per-row registry `version: int`.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SCRIPT_SELECTOR_VERSION = "pcd-script-selector@1.0.0";
```

- [ ] **Step 2.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector-version
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector-version.ts \
        packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts
git commit -m "feat(pcd): SP15 task 2 — PCD_SCRIPT_SELECTOR_VERSION (19th pinned constant)"
```

---

### Task 3: Placeholder prefix + predicate — `script-placeholder.ts`

**Goal:** Single-source the prefix literal and export the `isPlaceholderScriptText` predicate.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/script-placeholder.ts`
- Create: `packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isPlaceholderScriptText,
  PLACEHOLDER_SCRIPT_PREFIX,
} from "./script-placeholder.js";

describe("PLACEHOLDER_SCRIPT_PREFIX", () => {
  it('is the literal "[SCRIPT_PENDING_CREATIVE_REVIEW:"', () => {
    expect(PLACEHOLDER_SCRIPT_PREFIX).toBe("[SCRIPT_PENDING_CREATIVE_REVIEW:");
  });
});

describe("isPlaceholderScriptText", () => {
  it("returns true for text starting with the prefix", () => {
    expect(isPlaceholderScriptText("[SCRIPT_PENDING_CREATIVE_REVIEW: omg_look/med_spa]")).toBe(
      true,
    );
  });

  it("returns false for real-looking text", () => {
    expect(isPlaceholderScriptText("Hook line + body + CTA.")).toBe(false);
    expect(isPlaceholderScriptText("")).toBe(false);
    expect(isPlaceholderScriptText("  [SCRIPT_PENDING_CREATIVE_REVIEW: leading space]")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-placeholder
```

Expected: FAIL with module-not-found.

- [ ] **Step 3.3: Create the placeholder module**

Create `packages/creative-pipeline/src/pcd/script/script-placeholder.ts`:

```ts
// PCD slice SP15 — placeholder script-text detection contract.
//
// MERGE-BACK: Production render paths MUST guard with this predicate.
// Any rendered ad emitting text where this returns true is a content-
// review bug. SP15 publishes the predicate; render-time throw is
// SP21+'s responsibility.
//
// Single-source literal: PLACEHOLDER_SCRIPT_PREFIX appears in exactly
// this one non-test source file. Seed and consumers import the symbol.
export const PLACEHOLDER_SCRIPT_PREFIX = "[SCRIPT_PENDING_CREATIVE_REVIEW:";

export function isPlaceholderScriptText(text: string): boolean {
  return text.startsWith(PLACEHOLDER_SCRIPT_PREFIX);
}
```

- [ ] **Step 3.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-placeholder
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-placeholder.ts \
        packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts
git commit -m "feat(pcd): SP15 task 3 — PLACEHOLDER_SCRIPT_PREFIX + isPlaceholderScriptText predicate"
```

---

### Task 4: Prisma `ScriptTemplate` model + migration

**Goal:** Add the `ScriptTemplate` model to `schema.prisma`, generate the migration SQL via `prisma migrate diff` against the SP14 baseline schema, and verify the migration is byte-equivalent to what Prisma would emit.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql`

**Migration timestamp is intentional.** `20260514160000` locks lexicographic ordering after SP14's `20260514150000`. Do NOT correct it to wall-clock time — treat the literal as part of the spec.

- [ ] **Step 4.1: Append the model to `schema.prisma`**

Edit `packages/db/prisma/schema.prisma` — append at the end (after the SP14 `DisclosureTemplate` model):

```prisma
// SP15 — Script-template registry. Per-vibe × treatment catalogue of
// ad-script copy, keyed by compatibleCreatorIdentityIds for synthetic
// creator voicing. Reader-only on the DB side in SP15 (no store, no
// writer — see prisma-script-template-reader.ts). Selector filter:
// vibe + treatmentClass + status='active' + compatibleCreatorIdentityIds
// CONTAINS creatorIdentityId; tie-break (version DESC, id ASC).
model ScriptTemplate {
  id                            String   @id @default(cuid())
  vibe                          String
  treatmentClass                String
  text                          String   @db.Text
  compatibleCreatorIdentityIds  String[]
  version                       Int
  status                        String   // "active" | "retired"
  createdAt                     DateTime @default(now())
  updatedAt                     DateTime @updatedAt

  @@index([vibe, treatmentClass, status])
}
```

No compound unique on `(vibe, treatmentClass, version)` — Q11 / J7 in the spec: multiple active scripts per cell are by design. `compatibleCreatorIdentityIds: String[]` is a Postgres `text[]` array (v1 sizes are tiny, ≤10 entries).

- [ ] **Step 4.2: Generate the migration SQL via `prisma migrate diff`**

Extract the SP14-baseline schema and diff against the current schema (non-interactive, no DB needed):

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
mkdir -p packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15

git show 43cfdcd:packages/db/prisma/schema.prisma > /tmp/sp14-baseline.prisma
pnpm exec prisma migrate diff \
  --from-schema-datamodel /tmp/sp14-baseline.prisma \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script \
  > packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql
```

Expected output (inspect):

```sql
-- CreateTable
CREATE TABLE "ScriptTemplate" (
    "id" TEXT NOT NULL,
    "vibe" TEXT NOT NULL,
    "treatmentClass" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "compatibleCreatorIdentityIds" TEXT[],
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptTemplate_vibe_treatmentClass_status_idx" ON "ScriptTemplate"("vibe", "treatmentClass", "status");
```

If the generated SQL differs from the expected output, **stop and investigate** before proceeding. Common causes:
- Stray schema edits outside SP15's scope → revert them.
- Prisma version drift → check `package.json`.

- [ ] **Step 4.3: Regenerate Prisma client**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm db:generate
```

Expected: client regenerates without errors. The new `prisma.scriptTemplate` accessor is available.

- [ ] **Step 4.4: Verify the index name length is under 63 chars**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
echo -n "ScriptTemplate_vibe_treatmentClass_status_idx" | wc -c
```

Expected: `45`. Comfortably under Postgres's 63-char identifier limit; no truncation needed.

- [ ] **Step 4.5: Run typecheck — verify Prisma client widens**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/db typecheck
```

Expected: PASS. `PrismaClient.scriptTemplate` is now a typed accessor.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql
git commit -m "feat(pcd): SP15 task 4 — ScriptTemplate Prisma model + migration"
```

---

### Task 5: DB reader — `PrismaScriptTemplateReader.listByVibeAndTreatment`

**Goal:** Reader-only access surface. Returns ALL rows for `(vibe, treatmentClass)` — pure selector owns `status` + creator-compat filtering. Parse-at-the-edges via zod.

**Files:**
- Create: `packages/db/src/stores/prisma-script-template-reader.ts`
- Create: `packages/db/src/stores/prisma-script-template-reader.test.ts`

- [ ] **Step 5.1: Write the failing test (mocked Prisma)**

Create `packages/db/src/stores/prisma-script-template-reader.test.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaScriptTemplateReader } from "./prisma-script-template-reader.js";

function makeMockPrisma(rows: unknown[]) {
  return {
    scriptTemplate: {
      findMany: vi.fn().mockResolvedValue(rows),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient & {
    scriptTemplate: { findMany: ReturnType<typeof vi.fn> };
  };
}

const goodDbRow = {
  id: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  text: "Hook + body + CTA.",
  compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
  version: 1,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("PrismaScriptTemplateReader.listByVibeAndTreatment", () => {
  it("returns rows matching the (vibe, treatmentClass) pair", async () => {
    const prisma = makeMockPrisma([goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(goodDbRow.id);
    expect(prisma.scriptTemplate.findMany).toHaveBeenCalledWith({
      where: { vibe: "omg_look", treatmentClass: "med_spa" },
    });
  });

  it("returns empty array when Prisma returns no rows", async () => {
    const prisma = makeMockPrisma([]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "softly_glowing",
      treatmentClass: "halal_wellness",
    });
    expect(result).toEqual([]);
  });

  it("parses every row through ScriptTemplatePayloadSchema (parse-at-the-edges)", async () => {
    const prisma = makeMockPrisma([goodDbRow, goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(row.compatibleCreatorIdentityIds).toEqual(["cid_synth_cheryl_sg_01"]);
      expect(row.version).toBe(1);
      expect(row.status).toBe("active");
    }
  });

  it("throws when Prisma returns a row that violates the schema", async () => {
    const badRow = { ...goodDbRow, version: 0 }; // version < 1
    const prisma = makeMockPrisma([badRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    await expect(
      reader.listByVibeAndTreatment({ vibe: "omg_look", treatmentClass: "med_spa" }),
    ).rejects.toThrow();
  });

  it("does not call create / update / upsert / delete (read-only by design)", async () => {
    const prisma = makeMockPrisma([goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    await reader.listByVibeAndTreatment({ vibe: "omg_look", treatmentClass: "med_spa" });
    const stMock = prisma.scriptTemplate as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(stMock.create).not.toHaveBeenCalled();
    expect(stMock.update).not.toHaveBeenCalled();
    expect(stMock.upsert).not.toHaveBeenCalled();
    expect(stMock.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/db test prisma-script-template-reader
```

Expected: FAIL with module-not-found.

- [ ] **Step 5.3: Create the reader**

Create `packages/db/src/stores/prisma-script-template-reader.ts`:

```ts
// PCD slice SP15 — reader-only by design. Writer interface deliberately
// deferred. Future authoring CLI/admin tool should ship explicit
// createScriptVersion(payload) and retireScript(id) operations — NOT
// a generic upsert. Generic upsert is the wrong semantics for vetted
// creative copy: it normalises overwriting reviewed rows.
//
// Returns ALL rows for (vibe, treatmentClass) — any status, any compat
// list. Pure selector owns the full filter chain (status='active' +
// compatibleCreatorIdentityIds CONTAINS creatorIdentityId).
import type { PrismaClient } from "@prisma/client";
import {
  type ScriptTemplatePayload,
  ScriptTemplatePayloadSchema,
  type TreatmentClass,
  type Vibe,
} from "@creativeagent/schemas";

export interface ScriptTemplateReader {
  listByVibeAndTreatment(input: {
    vibe: Vibe;
    treatmentClass: TreatmentClass;
  }): Promise<readonly ScriptTemplatePayload[]>;
}

export class PrismaScriptTemplateReader implements ScriptTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listByVibeAndTreatment(input: {
    vibe: Vibe;
    treatmentClass: TreatmentClass;
  }): Promise<readonly ScriptTemplatePayload[]> {
    const rows = await this.prisma.scriptTemplate.findMany({
      where: { vibe: input.vibe, treatmentClass: input.treatmentClass },
    });
    return rows.map((r) =>
      ScriptTemplatePayloadSchema.parse({
        id: r.id,
        vibe: r.vibe,
        treatmentClass: r.treatmentClass,
        text: r.text,
        compatibleCreatorIdentityIds: r.compatibleCreatorIdentityIds,
        version: r.version,
        status: r.status,
      }),
    );
  }
}
```

- [ ] **Step 5.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/db test prisma-script-template-reader
pnpm --filter @creativeagent/db typecheck
```

Expected: 5 tests PASS. Typecheck clean.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/db/src/stores/prisma-script-template-reader.ts \
        packages/db/src/stores/prisma-script-template-reader.test.ts
git commit -m "feat(pcd): SP15 task 5 — PrismaScriptTemplateReader.listByVibeAndTreatment"
```

---

### Task 6: Placeholder seed — `script-seed.ts` (24 rows)

**Goal:** Cartesian-product seed of 24 rows (6 vibes × 4 treatments), every row carrying the placeholder prefix and the full SP11 roster as its `compatibleCreatorIdentityIds`.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/script-seed.ts`
- Create: `packages/creative-pipeline/src/pcd/script/script-seed.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/script/script-seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ScriptTemplatePayloadSchema } from "@creativeagent/schemas";
import {
  SP11_ROSTER_SIZE,
  SP11_SYNTHETIC_CREATOR_ROSTER,
} from "../synthetic-creator/seed.js";
import { isPlaceholderScriptText, PLACEHOLDER_SCRIPT_PREFIX } from "./script-placeholder.js";
import { SCRIPT_TEMPLATE_SEED } from "./script-seed.js";

const VIBES = [
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
] as const;
const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;

const SP11_IDS = SP11_SYNTHETIC_CREATOR_ROSTER.map((r) => r.creatorIdentity.id);

describe("SCRIPT_TEMPLATE_SEED", () => {
  it("contains exactly 24 rows (6 vibes × 4 treatments)", () => {
    expect(SCRIPT_TEMPLATE_SEED).toHaveLength(24);
  });

  it("every (vibe, treatmentClass) pair appears exactly once", () => {
    const seen = new Set<string>();
    for (const r of SCRIPT_TEMPLATE_SEED) {
      const key = `${r.vibe}/${r.treatmentClass}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(24);
    for (const v of VIBES) {
      for (const t of TREATMENTS) {
        expect(seen.has(`${v}/${t}`)).toBe(true);
      }
    }
  });

  it("every row's id matches the canonical regex", () => {
    const ID_RE =
      /^script-template-(omg_look|quiet_confidence|telling_her_friend|seven_days_later|just_left_clinic|softly_glowing)-(med_spa|dental|anti_ageing|halal_wellness)-v\d+$/;
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.id).toMatch(ID_RE);
    }
  });

  it("every row's text starts with PLACEHOLDER_SCRIPT_PREFIX", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.text.startsWith(PLACEHOLDER_SCRIPT_PREFIX)).toBe(true);
      expect(isPlaceholderScriptText(r.text)).toBe(true);
    }
  });

  it("every row's text echoes its (vibe, treatmentClass) tuple", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.text).toContain(`${r.vibe}/${r.treatmentClass}`);
    }
  });

  it("every row has version=1 and status=active", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.version).toBe(1);
      expect(r.status).toBe("active");
    }
  });

  it("every row's compatibleCreatorIdentityIds equals the full SP11 roster (drift-proof)", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.compatibleCreatorIdentityIds.length).toBe(SP11_ROSTER_SIZE);
      expect([...r.compatibleCreatorIdentityIds]).toEqual(SP11_IDS);
    }
  });

  it("ScriptTemplatePayloadSchema.parse() accepts every row", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(() => ScriptTemplatePayloadSchema.parse(r)).not.toThrow();
    }
  });

  it("no row's compatibleCreatorIdentityIds contains the wildcard sentinel", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.compatibleCreatorIdentityIds.includes("*")).toBe(false);
    }
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-seed
```

Expected: FAIL with module-not-found.

- [ ] **Step 6.3: Create the seed file**

Create `packages/creative-pipeline/src/pcd/script/script-seed.ts`:

```ts
// ⚠️ PLACEHOLDER SCRIPT TEMPLATES — NOT FOR PRODUCTION USE.
// Every row's `text` is a stub; creative content team must replace
// before any synthetic-creator-rendered ad ships. Render paths MUST
// guard against isPlaceholderScriptText() returning true.
//
// MERGE-BACK: Replace with real authored copy before Switchboard
// production launch. Seed is dev/test only. Production launch requires
// a separate authoring pass; do NOT promote placeholder rows.
//
// SP15 seed shape: 24 cells covering 6 vibes × 4 treatments.
// Every cell version=1, status="active", compatibleCreatorIdentityIds
// = all 10 SP11 roster creator IDs (imported, not duplicated).
import type { ScriptTemplatePayload } from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import { PLACEHOLDER_SCRIPT_PREFIX } from "./script-placeholder.js";

const COMPATIBLE_IDS = SP11_SYNTHETIC_CREATOR_ROSTER.map((r) => r.creatorIdentity.id);

const VIBES = [
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
] as const;

const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;

function makeRow(
  vibe: (typeof VIBES)[number],
  treatmentClass: (typeof TREATMENTS)[number],
): ScriptTemplatePayload {
  return {
    id: `script-template-${vibe}-${treatmentClass}-v1`,
    vibe,
    treatmentClass,
    text: `${PLACEHOLDER_SCRIPT_PREFIX} ${vibe}/${treatmentClass}]`,
    compatibleCreatorIdentityIds: COMPATIBLE_IDS,
    version: 1,
    status: "active",
  };
}

export const SCRIPT_TEMPLATE_SEED: readonly ScriptTemplatePayload[] = VIBES.flatMap((v) =>
  TREATMENTS.map((t) => makeRow(v, t)),
);
```

- [ ] **Step 6.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-seed
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 9 tests PASS. Typecheck clean.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-seed.ts \
        packages/creative-pipeline/src/pcd/script/script-seed.test.ts
git commit -m "feat(pcd): SP15 task 6 — SCRIPT_TEMPLATE_SEED (24 placeholder rows)"
```

---

### Task 7: Selector skeleton — `script-selector.ts`

**Goal:** Land the `selectScript` signature and `SelectScriptInput` type as a stub that always returns `{ allowed: false, reason: "no_compatible_script", ... }`. Tasks 8–12 fill in the algorithm.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/script-selector.ts`
- Create: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 7.1: Write the failing test (signature lock)**

Create `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`:

```ts
import type { CreativeBrief, ScriptTemplatePayload } from "@creativeagent/schemas";
import { describe, expect, it } from "vitest";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";
import { selectScript } from "./script-selector.js";

const NOW = new Date("2026-05-14T12:00:00Z");

const baseBrief: CreativeBrief = {
  briefId: "brief_01",
  clinicId: "clinic_01",
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

describe("selectScript — skeleton", () => {
  it("returns a failure decision when templates is empty", () => {
    const d = selectScript({
      brief: baseBrief,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW,
      templates: [],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.briefId).toBe("brief_01");
      expect(d.reason).toBe("no_compatible_script");
      expect(d.vibe).toBe("omg_look");
      expect(d.treatmentClass).toBe("med_spa");
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(d.inspectedTemplateIds).toEqual([]);
      expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
    }
  });
});

// Templates available to later tasks
export const NOW_FIXTURE = NOW;
export const BRIEF_FIXTURE = baseBrief;
export function mkRow(
  partial: Partial<ScriptTemplatePayload> & {
    id: string;
    vibe: ScriptTemplatePayload["vibe"];
    treatmentClass: ScriptTemplatePayload["treatmentClass"];
  },
): ScriptTemplatePayload {
  return {
    text: "ok",
    compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
    version: 1,
    status: "active",
    ...partial,
  } as ScriptTemplatePayload;
}
```

(NB: the exported fixtures `NOW_FIXTURE`, `BRIEF_FIXTURE`, and `mkRow` will be re-used by later test additions in this same file. Vitest accepts test-file-level exports; they don't pollute the module under test.)

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: FAIL with module-not-found.

- [ ] **Step 7.3: Create the selector skeleton**

Create `packages/creative-pipeline/src/pcd/script/script-selector.ts`:

```ts
// PCD slice SP15 — pure deterministic script-template selector.
// Mirrors SP12 / SP13 / SP14 shape: typed input record, no I/O, no
// clock reads — caller supplies `now` (currently unused; reserved
// for future scheduled-activation widen) and the templates snapshot.
// Invoked at job-creation time per umbrella spec §4 step 7, AFTER
// SP12 license gate, SP13 creator selection, and SP14 disclosure
// resolution have settled.
//
// Algorithm:
//   1. 3-way prefilter: vibe + treatmentClass + status === "active".
//      Empty result → no_compatible_script.
//   2. Creator-compat filter: t.compatibleCreatorIdentityIds.includes(creatorIdentityId).
//      Empty result → all_filtered_by_creator (inspectedTemplateIds populated, id ASC).
//   3. Pick highest `version`; final tie-break `id` ASC.
//
// `now` is accepted for shape parity and forward compatibility; v1
// has no time-window semantics on ScriptTemplate. Behavioural test in
// script-selector.test.ts asserts that varying `now` does not change
// the decision for identical other inputs.
//
// MERGE-BACK: Caller (SP21 composer or equivalent) supplies the
// templates snapshot via PrismaScriptTemplateReader.listByVibeAndTreatment(...).
// SP15 itself never reads. Mirrors SP12 licenseGate(leases) / SP13
// selectSyntheticCreator(roster, leases) / SP14 resolveDisclosure(templates)
// snapshot pattern.
import type {
  CreativeBrief,
  ScriptSelectionDecision,
  ScriptTemplatePayload,
} from "@creativeagent/schemas";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";

export type SelectScriptInput = {
  brief: CreativeBrief;
  creatorIdentityId: string;
  now: Date; // accepted, unused in v1 — see top comment
  templates: readonly ScriptTemplatePayload[];
};

export function selectScript(input: SelectScriptInput): ScriptSelectionDecision {
  return {
    allowed: false,
    briefId: input.brief.briefId,
    reason: "no_compatible_script",
    vibe: input.brief.targetVibe,
    treatmentClass: input.brief.treatmentClass,
    creatorIdentityId: input.creatorIdentityId,
    inspectedTemplateIds: [],
    selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
  };
}
```

- [ ] **Step 7.4: Run test + typecheck**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 1 test PASS. Typecheck clean.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.ts \
        packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "feat(pcd): SP15 task 7 — selectScript skeleton (always no_compatible_script)"
```

---

### Task 8: 3-way prefilter (vibe + treatment + status='active')

**Goal:** Filter templates by `vibe === brief.targetVibe AND treatmentClass === brief.treatmentClass AND status === "active"`. Empty result still emits `no_compatible_script`. Non-empty result returns a success stub using the first row (Task 10 adds proper tie-break).

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 8.1: Append the 3-way filter tests**

Append to `packages/creative-pipeline/src/pcd/script/script-selector.test.ts` (after the existing skeleton test):

```ts
describe("selectScript — 3-way prefilter (vibe + treatment + status='active')", () => {
  it("returns success when exactly one row matches the 3-way filter", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
  });

  it("returns no_compatible_script when vibe does not match", () => {
    const row = mkRow({
      id: "script-template-quiet_confidence-med_spa-v1",
      vibe: "quiet_confidence",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.reason).toBe("no_compatible_script");
  });

  it("returns no_compatible_script when treatmentClass does not match", () => {
    const row = mkRow({
      id: "script-template-omg_look-dental-v1",
      vibe: "omg_look",
      treatmentClass: "dental",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.reason).toBe("no_compatible_script");
  });

  it("returns no_compatible_script when status is retired (NOT a separate reason)", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      status: "retired",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.reason).toBe("no_compatible_script");
      // The retired row was filtered at the 3-way stage; not surfaced in inspectedTemplateIds.
      expect(d.inspectedTemplateIds).toEqual([]);
    }
  });

  it("returns no_compatible_script with empty inspectedTemplateIds when no 3-way matches exist", () => {
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [
        mkRow({ id: "x1", vibe: "softly_glowing", treatmentClass: "dental" }),
        mkRow({ id: "x2", vibe: "quiet_confidence", treatmentClass: "anti_ageing" }),
      ],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.inspectedTemplateIds).toEqual([]);
  });
});
```

- [ ] **Step 8.2: Run tests — verify the first new test FAILS, others PASS**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 4 tests PASS (the `no_compatible_script` paths trivially work because the stub always returns that), 1 test FAILS — the "returns success when exactly one row matches" expectation, because the skeleton always returns failure.

- [ ] **Step 8.3: Implement the 3-way prefilter + stub success branch**

Replace the body of `selectScript` in `packages/creative-pipeline/src/pcd/script/script-selector.ts`:

```ts
export function selectScript(input: SelectScriptInput): ScriptSelectionDecision {
  // Step 1 — 3-way prefilter on vibe + treatmentClass + status === "active"
  const threeWayMatched = input.templates.filter(
    (t) =>
      t.vibe === input.brief.targetVibe &&
      t.treatmentClass === input.brief.treatmentClass &&
      t.status === "active",
  );
  if (threeWayMatched.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_script",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds: [],
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    };
  }

  // STUB — Task 9 adds the creator-compat filter; Task 10 adds the tie-break.
  // For now, return a success decision using the first 3-way-matched row.
  const stub = threeWayMatched[0]!;
  return {
    allowed: true,
    briefId: input.brief.briefId,
    scriptTemplateId: stub.id,
    vibe: input.brief.targetVibe,
    treatmentClass: input.brief.treatmentClass,
    scriptTemplateVersion: stub.version,
    creatorIdentityId: input.creatorIdentityId,
    scriptText: stub.text,
    selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    decisionReason: `script_selected (three_way=${threeWayMatched.length}, picked_version=${stub.version})`,
  };
}
```

- [ ] **Step 8.4: Run tests — verify all PASS**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 6 tests PASS.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.ts \
        packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "feat(pcd): SP15 task 8 — selectScript 3-way prefilter (vibe + treatment + status='active')"
```

---

### Task 9: Creator-compat filter + `all_filtered_by_creator` branch

**Goal:** After the 3-way prefilter, filter by `t.compatibleCreatorIdentityIds.includes(input.creatorIdentityId)`. Empty result emits `all_filtered_by_creator` with `inspectedTemplateIds` = 3-way matches' ids in `id` ASC order.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 9.1: Append the creator-compat tests**

Append to `script-selector.test.ts`:

```ts
describe("selectScript — creator-compat filter + all_filtered_by_creator branch", () => {
  it("returns all_filtered_by_creator when 3-way matches exist but none list this creator", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.reason).toBe("all_filtered_by_creator");
      expect(d.inspectedTemplateIds).toEqual(["script-template-omg_look-med_spa-v1"]);
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
    }
  });

  it("succeeds when the creator IS in compatibleCreatorIdentityIds", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01", "cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
  });

  it("inspectedTemplateIds on all_filtered_by_creator is sorted id ASC", () => {
    const rows = [
      mkRow({
        id: "c-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
      mkRow({
        id: "a-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
      mkRow({
        id: "b-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.inspectedTemplateIds).toEqual(["a-row", "b-row", "c-row"]);
    }
  });

  it("inspectedTemplateIds does NOT include retired rows (retired filtered out before creator check)", () => {
    const retired = mkRow({
      id: "retired-row",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      status: "retired",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const active = mkRow({
      id: "active-row",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [retired, active],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.inspectedTemplateIds).toEqual(["active-row"]);
    }
  });
});
```

- [ ] **Step 9.2: Run tests — verify the failure-branch tests fail (success-branch passes via stub)**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 1 new test PASSES (the "succeeds when creator IS in compat" path, because the stub returns success after the 3-way filter). 3 new tests FAIL — they expect `all_filtered_by_creator` but the stub returns `allowed: true` for any 3-way-matched row regardless of creator.

- [ ] **Step 9.3: Add the creator-compat filter to the selector**

Replace the body of `selectScript`:

```ts
export function selectScript(input: SelectScriptInput): ScriptSelectionDecision {
  // Step 1 — 3-way prefilter on vibe + treatmentClass + status === "active"
  const threeWayMatched = input.templates.filter(
    (t) =>
      t.vibe === input.brief.targetVibe &&
      t.treatmentClass === input.brief.treatmentClass &&
      t.status === "active",
  );
  if (threeWayMatched.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_script",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds: [],
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    };
  }

  // Step 2 — creator-compat filter
  const creatorMatched = threeWayMatched.filter((t) =>
    t.compatibleCreatorIdentityIds.includes(input.creatorIdentityId),
  );
  if (creatorMatched.length === 0) {
    const inspectedTemplateIds = threeWayMatched
      .map((t) => t.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_filtered_by_creator",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds,
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    };
  }

  // STUB — Task 10 adds the version tie-break. For now, return a success
  // decision using the first creator-matched row.
  const stub = creatorMatched[0]!;
  return {
    allowed: true,
    briefId: input.brief.briefId,
    scriptTemplateId: stub.id,
    vibe: input.brief.targetVibe,
    treatmentClass: input.brief.treatmentClass,
    scriptTemplateVersion: stub.version,
    creatorIdentityId: input.creatorIdentityId,
    scriptText: stub.text,
    selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    decisionReason: `script_selected (creator_matched=${creatorMatched.length}, three_way=${threeWayMatched.length}, picked_version=${stub.version})`,
  };
}
```

- [ ] **Step 9.4: Run tests — verify all PASS**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 10 tests PASS.

- [ ] **Step 9.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.ts \
        packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "feat(pcd): SP15 task 9 — selectScript creator-compat filter + all_filtered_by_creator branch"
```

---

### Task 10: Version tie-break — `(version DESC, id ASC)`

**Goal:** Replace the "first creator-matched row" stub with a total-order comparator over `(version DESC, id ASC)`. Locks the deterministic winner.

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 10.1: Append the tie-break tests**

Append to `script-selector.test.ts`:

```ts
describe("selectScript — version tie-break (version DESC, id ASC)", () => {
  it("picks the highest version among 2 active creator-matched rows", () => {
    const rows = [
      mkRow({ id: "v1-row", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v2-row", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) {
      expect(d.scriptTemplateId).toBe("v2-row");
      expect(d.scriptTemplateVersion).toBe(2);
    }
  });

  it("picks the highest version among 3 (1/2/3)", () => {
    const rows = [
      mkRow({ id: "v1-row", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v3-row", vibe: "omg_look", treatmentClass: "med_spa", version: 3 }),
      mkRow({ id: "v2-row", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("v3-row");
  });

  it("picks active v1 over retired v2 (retired filtered earlier)", () => {
    const rows = [
      mkRow({
        id: "active-v1",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        version: 1,
        status: "active",
      }),
      mkRow({
        id: "retired-v2",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        version: 2,
        status: "retired",
      }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("active-v1");
  });

  it("breaks ties on equal version by id ASC (final tie-break)", () => {
    const rows = [
      mkRow({ id: "z-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
      mkRow({ id: "a-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
      mkRow({ id: "m-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("a-row");
  });
});
```

- [ ] **Step 10.2: Run tests — verify the tie-break tests fail**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 1 of 4 new tests PASSES (the "active v1 over retired v2" test, because Task 9's status filter already eliminates the retired row so the version "tie-break" is trivial). 3 tests FAIL — Task 9's selector picks the first row in original order, not the highest version. Task 10 fixes this.

- [ ] **Step 10.3: Implement the tie-break comparator**

Replace the `// STUB — Task 10 adds the version tie-break` block in `script-selector.ts`. The new tail of `selectScript`:

```ts
  // Step 3 — pick highest version; final tie-break id ASC
  const ranked = [...creatorMatched].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const winner = ranked[0]!;
  return {
    allowed: true,
    briefId: input.brief.briefId,
    scriptTemplateId: winner.id,
    vibe: input.brief.targetVibe,
    treatmentClass: input.brief.treatmentClass,
    scriptTemplateVersion: winner.version,
    creatorIdentityId: input.creatorIdentityId,
    scriptText: winner.text,
    selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    decisionReason: `script_selected (creator_matched=${creatorMatched.length}, three_way=${threeWayMatched.length}, picked_version=${winner.version})`,
  };
```

- [ ] **Step 10.4: Run tests — verify all PASS**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 14 tests PASS.

- [ ] **Step 10.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.ts \
        packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "feat(pcd): SP15 task 10 — selectScript version tie-break (version DESC, id ASC)"
```

---

### Task 11: Determinism + pin invariant + `now`-unused locks

**Goal:** Lock as regression tests the invariants the algorithm already satisfies — pin invariant on every branch, byte-equal determinism over input shuffles, and the behavioural assertion that varying `now` does NOT change the decision (replaces the source-grep anti-pattern; J8 in the spec).

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 11.1: Append the determinism + pin tests**

Append to `script-selector.test.ts`:

```ts
describe("selectScript — pin invariant + determinism + now-unused", () => {
  it("emits PCD_SCRIPT_SELECTOR_VERSION on every success branch", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("emits PCD_SCRIPT_SELECTOR_VERSION on no_compatible_script", () => {
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("emits PCD_SCRIPT_SELECTOR_VERSION on all_filtered_by_creator", () => {
    const row = mkRow({
      id: "x",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["someone-else"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("is deterministic: identical input yields byte-equal decisions", () => {
    const rows = [
      mkRow({ id: "v1", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v2", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const inp = {
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    };
    expect(JSON.stringify(selectScript(inp))).toBe(JSON.stringify(selectScript(inp)));
  });

  it("is order-stable: shuffling templates does not change the chosen scriptTemplateId", () => {
    const rows = [
      mkRow({ id: "a", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "b", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
      mkRow({ id: "c", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d1 = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    const d2 = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [...rows].reverse(),
    });
    expect(d1.allowed).toBe(true);
    expect(d2.allowed).toBe(true);
    if (d1.allowed === true && d2.allowed === true) {
      expect(d1.scriptTemplateId).toBe(d2.scriptTemplateId);
      expect(d1.scriptTemplateId).toBe("b"); // v2 wins; id ASC tie-break picks "b" over "c"
    }
  });

  it("varying `now` does NOT change the decision for identical other inputs (J8 — v1 no time windows)", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const base = {
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      templates: [row],
    };
    const dEpoch = selectScript({ ...base, now: new Date(0) });
    const d2000 = selectScript({ ...base, now: new Date("2000-01-01T00:00:00Z") });
    const d2100 = selectScript({ ...base, now: new Date("2100-12-31T23:59:59Z") });
    expect(JSON.stringify(dEpoch)).toBe(JSON.stringify(d2000));
    expect(JSON.stringify(d2000)).toBe(JSON.stringify(d2100));
  });
});
```

- [ ] **Step 11.2: Run tests — verify all PASS (no new implementation needed)**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 20 tests PASS. These tests assert invariants the algorithm already satisfies — they're locked in as regression guards.

- [ ] **Step 11.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "test(pcd): SP15 task 11 — pin invariant + determinism + now-unused regression locks"
```

---

### Task 12: Decision-reason content + field-echo locks

**Goal:** Final regression tests for `decisionReason` content (must contain `picked_version=N`, counts for `creator_matched` and `three_way`) and field-echo invariants (success and failure both echo `brief.targetVibe`, `brief.treatmentClass`, `creatorIdentityId` verbatim).

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`

- [ ] **Step 12.1: Append the decision-reason + field-echo tests**

Append to `script-selector.test.ts`:

```ts
describe("selectScript — decisionReason content + field echoes", () => {
  it("decisionReason contains picked_version=N", () => {
    const row = mkRow({
      id: "v7",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      version: 7,
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.decisionReason).toContain("picked_version=7");
  });

  it("decisionReason contains counts of creator_matched and three_way", () => {
    const rows = [
      mkRow({ id: "a", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "b", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
      // 3-way matched but creator-incompatible — counts toward three_way only
      mkRow({
        id: "c",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        version: 3,
        compatibleCreatorIdentityIds: ["someone-else"],
      }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) {
      expect(d.decisionReason).toContain("creator_matched=2");
      expect(d.decisionReason).toContain("three_way=3");
    }
  });

  it("success echoes brief.targetVibe, brief.treatmentClass, creatorIdentityId verbatim", () => {
    const row = mkRow({
      id: "ok",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) {
      expect(d.briefId).toBe(BRIEF_FIXTURE.briefId);
      expect(d.vibe).toBe(BRIEF_FIXTURE.targetVibe);
      expect(d.treatmentClass).toBe(BRIEF_FIXTURE.treatmentClass);
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
    }
  });

  it("failure echoes brief.targetVibe, brief.treatmentClass, creatorIdentityId verbatim", () => {
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.briefId).toBe(BRIEF_FIXTURE.briefId);
      expect(d.vibe).toBe(BRIEF_FIXTURE.targetVibe);
      expect(d.treatmentClass).toBe(BRIEF_FIXTURE.treatmentClass);
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
    }
  });
});
```

- [ ] **Step 12.2: Run tests — verify all PASS**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test script-selector
```

Expected: 24 tests PASS. The Task 8/9/10 implementation already satisfies these invariants.

- [ ] **Step 12.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/script-selector.test.ts
git commit -m "test(pcd): SP15 task 12 — decisionReason content + field-echo regression locks"
```

---

### Task 13: Anti-pattern tests — `sp15-anti-patterns.test.ts`

**Goal:** Six structural assertions guarding SP15 invariants. Mirrors SP14's `sp14-anti-patterns.test.ts` shape, with the SP13/SP14 cross-slice token blacklist (with `creatorIdentityId` and `selectorVersion` carve-outs) and frozen-source-body check keyed to `43cfdcd`.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts`

- [ ] **Step 13.1: Write the anti-pattern test**

Create `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts`:

```ts
// SP15 anti-pattern grep tests. These guard against:
//   1. Single-source version pinning (literal "pcd-script-selector@1.0.0"
//      appears in exactly one non-test source file: script-selector-version.ts)
//   2. Single-source placeholder prefix ("[SCRIPT_PENDING_CREATIVE_REVIEW:"
//      appears in exactly one non-test source file: script-placeholder.ts)
//   3. Selector purity (no Date.now, no new Date, no Math.random, no
//      @creativeagent/db, no @prisma/client, no inngest, no node:fs|http|https,
//      no crypto). Unlike SP14, SP15's seed has no `new Date(...)` literal
//      because there are no effective-window columns.
//   4. No-wildcard guarantee on seed values — id, vibe, treatmentClass, text,
//      and every entry of compatibleCreatorIdentityIds (programmatic, not source grep)
//   5. No cross-slice tokens — SP13 selection-decision shape, SP14 decision shape,
//      SP16+/SP18+/SP19+/SP20+ tokens all forbidden. `creatorIdentityId` and
//      `selectorVersion` are explicitly allowed (SP15 has its own input field
//      and decision-struct field by those names).
//   6. Frozen SP1-SP14 source bodies (allowlist edits only) — keyed against 43cfdcd
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIPT_TEMPLATE_SEED } from "./script-seed.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/script");
const VERSION_PATH = path.join(SCRIPT_DIR, "script-selector-version.ts");
const PLACEHOLDER_PATH = path.join(SCRIPT_DIR, "script-placeholder.ts");
const SELECTOR_PATH = path.join(SCRIPT_DIR, "script-selector.ts");
const SEED_PATH = path.join(SCRIPT_DIR, "script-seed.ts");

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

describe("SP15 anti-patterns", () => {
  it('PCD_SCRIPT_SELECTOR_VERSION literal "pcd-script-selector@1.0.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-script-selector@1\\.0\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
      ),
    ).toBe(true);
  });

  it('PLACEHOLDER_SCRIPT_PREFIX literal "[SCRIPT_PENDING_CREATIVE_REVIEW:" lives in exactly one non-test source file', () => {
    const hits = grepFiles("\\[SCRIPT_PENDING_CREATIVE_REVIEW:", "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has("packages/creative-pipeline/src/pcd/script/script-placeholder.ts"),
    ).toBe(true);
  });

  it("non-test pcd/script sources are pure — no clock reads, no randomness, no I/O imports", () => {
    const filesToScan = [VERSION_PATH, PLACEHOLDER_PATH, SELECTOR_PATH, SEED_PATH];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      expect(src, filePath).not.toMatch(/Date\.now\(\)/);
      expect(src, filePath).not.toMatch(/new\s+Date\(/);
      expect(src, filePath).not.toMatch(/Math\.random\(/);
      expect(src, filePath).not.toMatch(/from\s+["']@creativeagent\/db["']/);
      expect(src, filePath).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, filePath).not.toMatch(/from\s+["']inngest["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:http["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:https["']/);
      expect(src, filePath).not.toMatch(/from\s+["']crypto["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:crypto["']/);
      expect(src, filePath).not.toMatch(/PrismaClient/);
    }
  });

  it("seed values contain no wildcard tokens (programmatic — id / vibe / treatmentClass / text / compatibleCreatorIdentityIds)", () => {
    const WILDCARDS = /\b(default|catch_all|wildcard|global|fallback)\b/;
    for (const r of SCRIPT_TEMPLATE_SEED) {
      for (const [field, value] of Object.entries({
        id: r.id,
        vibe: r.vibe,
        treatmentClass: r.treatmentClass,
        text: r.text,
      })) {
        expect(value, `wildcard token in seed ${field}: ${value}`).not.toMatch(WILDCARDS);
      }
      for (const cid of r.compatibleCreatorIdentityIds) {
        expect(cid, `wildcard token in seed compatibleCreatorIdentityIds entry: ${cid}`).not.toMatch(
          WILDCARDS,
        );
        // Reinforces the zod refine; defense in depth at the seed value layer.
        expect(cid).not.toBe("*");
      }
    }
  });

  it("no cross-slice tokens in pcd/script source — SP13 / SP14 / SP16+ / SP18+ / SP19+ / SP20+ all forbidden; creatorIdentityId + selectorVersion allowed", () => {
    const filesToScan = [VERSION_PATH, PLACEHOLDER_PATH, SELECTOR_PATH, SEED_PATH];
    const FORBIDDEN_SP13 = [
      "SyntheticCreatorSelectionDecision",
      "selectedCreatorIdentityId",
      "fallbackCreatorIdentityIds",
      "selectorRank",
      "metricsSnapshotVersion",
      "performanceOverlayApplied",
    ];
    const FORBIDDEN_SP14 = [
      "DisclosureResolutionDecision",
      "disclosureTemplateId",
      "resolverVersion",
    ];
    const FORBIDDEN_SP16_PLUS = ["provider_routing", "RoutingDecision"];
    const FORBIDDEN_SP18_PLUS = ["PcdPerformanceSnapshot", "performance_snapshot"];
    const FORBIDDEN_SP19_PLUS = ["overlayWeight"];
    const FORBIDDEN_SP20_PLUS = ["face_descriptor", "qc_face"];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of [
        ...FORBIDDEN_SP13,
        ...FORBIDDEN_SP14,
        ...FORBIDDEN_SP16_PLUS,
        ...FORBIDDEN_SP18_PLUS,
        ...FORBIDDEN_SP19_PLUS,
        ...FORBIDDEN_SP20_PLUS,
      ]) {
        expect(
          src.includes(token),
          `${filePath} must not reference cross-slice token: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("SP1–SP14 source bodies are unchanged since the SP14 baseline (allowlist edits only)", () => {
    const SP14_BASELINE = "43cfdcd"; // SP14-on-main merge tip
    const allowedEdits = new Set([
      // SP15 net-new schema (Task 1)
      "packages/schemas/src/pcd-script-template.ts",
      "packages/schemas/src/__tests__/pcd-script-template.test.ts",
      "packages/schemas/src/index.ts",
      // SP15 net-new pipeline subdir
      "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.test.ts",
      "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/script/index.ts",
      // SP15 db reader (Task 5)
      "packages/db/src/stores/prisma-script-template-reader.ts",
      "packages/db/src/stores/prisma-script-template-reader.test.ts",
      "packages/db/src/index.ts",
      // SP15 Prisma additions (Task 4)
      "packages/db/prisma/schema.prisma",
      "packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql",
      // SP15 barrels (Task 15)
      "packages/creative-pipeline/src/index.ts",
      // SP15 design + plan docs
      "docs/plans/2026-05-14-pcd-script-templates-sp15-design.md",
      "docs/plans/2026-05-14-pcd-script-templates-sp15-plan.md",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP14_BASELINE}`, {
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
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 14)
      if (
        file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts"
      )
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (
        file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts"
      )
        continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts") continue;
      if (
        file === "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts"
      )
        continue;
      if (
        file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts"
      )
        continue;
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP14_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 13.2: Run the anti-pattern test**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test sp15-anti-patterns
```

Expected: 6 assertions PASS. (Note: assertion 6 "frozen source bodies" will pass at the moment Task 13 runs, because no prior anti-pattern tests have been modified yet — the allowlist only enumerates SP15's net-new files plus the 8 prior test paths in the skip-prefix block.) If assertion 6 fails because of an unexpected edit, investigate before proceeding to Task 14.

- [ ] **Step 13.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts
git commit -m "test(pcd): SP15 task 13 — sp15-anti-patterns.test.ts (6 structural assertions)"
```

---

### Task 14: Allowlist Maintenance — Widen Prior Anti-Pattern Tests

**Goal:** Add SP15's net-new files to the frozen-source-body allowlists in the 8 prior anti-pattern tests, so each of them passes after SP15 ships. One-line additions per file.

**Files modified:**
- `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts`

- [ ] **Step 14.1: For each prior test, append SP15 files to `allowedEdits`**

For each of the 8 files above, locate the `allowedEdits` Set inside the "frozen source bodies" `it(...)` block. **Exact lines to append to every prior test's allowlist:**

```ts
      // SP15 net-new files (additive maintenance)
      "packages/schemas/src/pcd-script-template.ts",
      "packages/schemas/src/__tests__/pcd-script-template.test.ts",
      "packages/db/src/stores/prisma-script-template-reader.ts",
      "packages/db/src/stores/prisma-script-template-reader.test.ts",
      "packages/db/prisma/schema.prisma",
      "packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.test.ts",
      "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/script/index.ts",
      "packages/db/src/index.ts",
      "packages/creative-pipeline/src/index.ts",
```

**Plus** append SP15's own anti-pattern test path to each prior test's "skip-prefix" `continue` chain (the section with `if (file === "packages/creative-pipeline/src/pcd/.../sp1X-anti-patterns.test.ts") continue;`). Add for each prior test:

```ts
      if (file === "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts")
        continue;
```

For each of the 8 prior tests, the diff is two append blocks: one to `allowedEdits`, one to the skip-prefix chain. No other edits.

- [ ] **Step 14.2: Run the full creative-pipeline test suite — verify all 9 anti-pattern tests (8 prior + new SP15) pass**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm --filter @creativeagent/creative-pipeline test anti-patterns
```

Expected: every anti-pattern test passes. The frozen-source-body assertions now accept SP15's net-new files.

- [ ] **Step 14.3: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts
git commit -m "test(pcd): SP15 task 14 — widen 8 prior anti-pattern allowlists for SP15 files"
```

---

### Task 15: Barrel Re-exports (db + creative-pipeline)

**Goal:** Surface SP15's new symbols through `packages/db/src/index.ts` and `packages/creative-pipeline/src/index.ts`. The schemas barrel was already widened in Task 1.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/script/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 15.1: Create the slice barrel**

Create `packages/creative-pipeline/src/pcd/script/index.ts`:

```ts
export { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";
export {
  PLACEHOLDER_SCRIPT_PREFIX,
  isPlaceholderScriptText,
} from "./script-placeholder.js";
export { selectScript, type SelectScriptInput } from "./script-selector.js";
export { SCRIPT_TEMPLATE_SEED } from "./script-seed.js";
```

- [ ] **Step 15.2: Widen the db barrel**

Edit `packages/db/src/index.ts` — append after the SP14 `PrismaDisclosureTemplateReader` re-export:

```ts

// SP15 — script templates
export { PrismaScriptTemplateReader } from "./stores/prisma-script-template-reader.js";
export type { ScriptTemplateReader } from "./stores/prisma-script-template-reader.js";
```

- [ ] **Step 15.3: Widen the creative-pipeline barrel**

Edit `packages/creative-pipeline/src/index.ts` — append at the bottom:

```ts

// SP15 — script templates
export * from "./pcd/script/index.js";
```

- [ ] **Step 15.4: Run typecheck across all packages**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm typecheck
```

Expected: typecheck clean across all 5 packages.

- [ ] **Step 15.5: Commit**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git add packages/creative-pipeline/src/pcd/script/index.ts \
        packages/db/src/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP15 task 15 — barrel re-exports (db + creative-pipeline)"
```

---

### Task 16: Final Full-Repo Sweep — typecheck + test + prettier

**Goal:** Verify the slice is end-to-end green. Target counts: SP14 baseline (1826 passed + 2 skipped) + ~50 SP15 net new tests ≈ **~1876 passing**, 2 skipped unchanged.

- [ ] **Step 16.1: Run typecheck across the repo**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm typecheck
```

Expected: clean across all packages.

- [ ] **Step 16.2: Run the full test suite**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm test
```

Expected output (tail):

```
Test Files  XX passed (XX)
     Tests  ~1876 passed | 2 skipped (~1878)
```

The exact passing count may drift by ±5 depending on how many new sub-tests landed in Task 12's regression locks. If the **skipped count changes** from 2, investigate before declaring victory.

- [ ] **Step 16.3: Run prettier check**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: only the 2 pre-existing SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts`. **SP15 introduces no new prettier warnings.** If new warnings appear, run `pnpm exec prettier --write <path>` on the offending file(s) and commit the fix as part of this task.

- [ ] **Step 16.4: Open the PR**

```bash
cd /Users/jasonli/creativeagent/.worktrees/sp15
git push -u origin pcd/sp15-script-templates
gh pr create --title "feat(pcd): SP15 — script templates (ScriptTemplate table + pure selector + 24-row placeholder seed + isPlaceholderScriptText predicate)" --body "$(cat <<'EOF'
## Summary
- Adds the `ScriptTemplate` Prisma model (id, vibe, treatmentClass, text, compatibleCreatorIdentityIds[], version, status), a read-only `PrismaScriptTemplateReader.listByVibeAndTreatment` (no writer, no `listAll`), and the pure `selectScript({brief, creatorIdentityId, now, templates})` selector implementing the umbrella §4 step 7 filter (vibe + treatmentClass + status='active' + creator-compat) with `(version DESC, id ASC)` tie-break.
- Ships a 24-row placeholder seed (6 vibes × 4 treatments) keyed off `SP11_SYNTHETIC_CREATOR_ROSTER` for drift-proof compat lists, plus the `isPlaceholderScriptText` detection contract that downstream render paths (SP21+) must guard with. Adds the 19th pinned PCD constant `PCD_SCRIPT_SELECTOR_VERSION = "pcd-script-selector@1.0.0"` under the single-source rule.
- Two failure reasons (`no_compatible_script` / `all_filtered_by_creator`) with `inspectedTemplateIds: id ASC` on the second branch. Lifecycle is `status='active' | 'retired'` only — no time-window columns; `now` is accepted but unused in v1 (behavioural determinism test asserts).

## Test plan
- [ ] `pnpm typecheck` clean across all 5 packages
- [ ] `pnpm test` — ~1876 passing, 2 skipped (matches SP14 baseline + ~50 SP15)
- [ ] `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"` — only the 2 pre-existing SP5-baseline warnings
- [ ] `pnpm exec prisma migrate diff --from-schema-datamodel <SP14-baseline> --to-schema-datamodel packages/db/prisma/schema.prisma --script` matches the committed `20260514160000_pcd_script_template_sp15/migration.sql` byte-for-byte (modulo whitespace)
- [ ] All 9 anti-pattern tests pass (8 prior allowlists widened in Task 14 + new SP15 in Task 13)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened against `main`. Squash-merge after CI green.

---

## Spec coverage cross-walk

| Spec section | Plan task(s) |
|---|---|
| §1 Scope & strategy | All tasks; explicit OOS notes in PR description |
| §2.1 Q1 (full SP14 shape) | Tasks 1, 4, 5, 6, 7–12, 15 |
| §2.1 Q2 (bare creatorIdentityId input) | Task 7 (signature lock), Task 9 (creator-compat filter) |
| §2.1 Q3 (four-way filter + tie-break) | Tasks 8 (3-way), 9 (creator-compat), 10 (tie-break) |
| §2.1 Q4 (two failure reasons + inspectedTemplateIds) | Tasks 8 (no_compatible_script), 9 (all_filtered_by_creator + ordering) |
| §2.1 Q5 (no time windows; `now` unused) | Task 7 (signature includes `now`), Task 11 (behavioural determinism test), Task 13 anti-pattern #3 (no `new Date(` in selector) |
| §2.1 Q6 (24-row seed; SP11 roster import) | Task 6 |
| §2.1 Q7 (isPlaceholderScriptText predicate) | Task 3 |
| §2.1 Q8 (19th pinned constant; single-source) | Task 2 + anti-pattern #1 in Task 13 |
| §2.1 Q9 (`allowed` discriminant) | Task 1 zod, Tasks 7–12 selector |
| §2.1 Q10 (no `"*"` wildcard — zod refine + seed scan) | Task 1 (refine + tests), Task 6 (seed test), Task 13 anti-pattern #4 |
| §2.1 Q11 (loose uniqueness; id ASC tie-break) | Task 4 (no compound unique on Prisma model), Task 10 (id ASC test on equal versions) |
| §2.2 J1–J9 judgment calls | Various tasks per §2.2 column |
| §3 Module surface | Task 1 (schemas), Task 2–13 (creative-pipeline subdir), Task 4 (Prisma), Task 5 (db reader), Task 15 (barrels) |
| §4 Algorithm details | Tasks 7 (skeleton), 8 (step 1), 9 (step 2), 10 (step 3) |
| §5.1 Selector unit tests | Tasks 7, 8, 9, 10, 11, 12 |
| §5.2 Schema tests | Task 1 |
| §5.3 Seed-shape tests | Task 6 |
| §5.4 Anti-pattern tests (5 assertions, +1 frozen) | Task 13 — six it() blocks |
| §5.5 Reader integration tests | Task 5 |
| §5.6 Allowlist maintenance | Task 14 |
| §5.7 Integration / cross-package | Task 16 |
| §6 Merge-back markers | Comment markers embedded in source per task (Task 2 version, Task 3 placeholder, Task 5 reader, Task 6 seed, Task 7 selector signature, Task 1 zod decision schema) |
| §9 Implementation slicing preview | Aligned 1:1 with this plan's Tasks 1–16 |

---

*End of plan. Use superpowers:subagent-driven-development to execute task-by-task.*
