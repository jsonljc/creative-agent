# PCD SP15 — Script Templates — Design Spec

**Date:** 2026-05-14
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (brainstorming session)
**Predecessor slices:** SP11 (synthetic-creator foundation, `3b3d291`), SP12 (license gate, `13ee16d`), SP13 (synthetic-creator selector, `dc7b498`), SP14 (disclosure registry, `43cfdcd`)
**Successor slices reserved by name:** SP16 (provider-routing extension for synthetic), SP17 (SP9 provenance widen), SP18 (`PcdPerformanceSnapshot`), SP19 (performance overlay re-rank — script ≈ 0.6 / creator ≈ 0.4 weighting), SP20 (synthetic QC face-match), SP21 (end-to-end integration / composer)

---

## 1. Scope & Strategy

SP15 introduces the **script-template registry** — the per-vibe × treatment-class catalogue of ad-script copy that every synthetic-creator-rendered ad must source from — together with the **pure selector** that joins a `CreativeBrief` and a chosen `creatorIdentityId` to a current registry row.

Per the umbrella roster design doc (`2026-04-30-pcd-synthetic-creator-roster-design.md`) §3.5 + §4 step 7, script selection runs **after** the license gate (SP12), **after** the disclosure gate (SP14), and **before** provider routing. Its filter is `vibe = brief.targetVibe AND treatmentClass = brief.treatmentClass AND status = "active" AND compatibleCreatorIdentityIds CONTAINS creatorIdentityId`; tie-break is `(version DESC, id ASC)`. The selected script's `id` and `version` are recorded in provenance — SP17's job, not SP15's.

SP15 lights up that layer in its minimum-viable form:

- **Full SP14 shape** — Prisma `ScriptTemplate` table + `ScriptTemplatePayloadSchema` zod + pure `selectScript({brief, creatorIdentityId, now, templates})` over a caller-supplied `templates` snapshot.
- **Reader-only** on the DB side. `listByVibeAndTreatment(...)` is the SP21 composer's known call path. Pure selector owns `status` + creator-compat filtering. No `listAll`, no `findById`.
- **No writer / store.** Generic upsert is the wrong semantics for vetted creative copy. Future authoring CLI/admin tool should ship explicit `createScriptVersion` / `retireScript` operations — not in SP15.
- **24-row placeholder seed.** Every cell of the `6 vibes × 4 treatment classes` cube is seeded with a machine-detectable stub (`[SCRIPT_PENDING_CREATIVE_REVIEW:` prefix). Real ad-script copy lands in a separate authoring pass before any synthetic-creator-rendered ad ships.
- **Predicate publication, not enforcement.** SP15 exports `isPlaceholderScriptText(text): boolean`; production render paths (SP21+) MUST guard with it. Render-time throw is downstream's job.

**Key SP14 → SP15 inflection:** SP14 was creator-agnostic (the disclosure key tuple has zero creator coupling); SP15 is creator-keyed (`compatibleCreatorIdentityIds[]` is half the filter). The pure selector takes a **bare `creatorIdentityId`** as a parameter — not the SP13 `SyntheticCreatorSelectionDecision`. Composing provenance from SP13 + SP14 + SP15 decisions is SP21's job. SP15 stays unaware of SP13's decision shape; SP15 source contains zero references to `SyntheticCreatorSelectionDecision`, `selectedCreatorIdentityId`, `fallbackCreatorIdentityIds`, `selectorRank`, `metricsSnapshotVersion`, or `performanceOverlayApplied`.

What SP15 deliberately does NOT do:

- **No store / writer**, no upsert, no admin authoring path, no `listAll`.
- **No render-time enforcement.** Detection contract only.
- **No provenance persistence.** Decision struct is zod-only; SP17 owns the SP9 widen.
- **No composer integration.** SP21 joins SP13 + SP14 + SP15 decisions; SP15 stays unaware of selector or disclosure outcome.
- **No effective-window columns.** Lifecycle is via `status: 'active' | 'retired'` only. (Different from SP14, which had `effectiveFrom`/`effectiveTo` for regulated-copy windows.) `now` is accepted in the input record for shape parity and forward compatibility, but is **unused** by the v1 selector — see Q5 below.
- **No SP19 performance overlay.** SP19 re-ranks script picks (≈0.6 script-weight / 0.4 creator-weight per umbrella §6.3); SP15 is uniform-pick under the tie-break rule.
- **No provider routing** (SP16), **no QC face-match** (SP20).
- **No wildcards.** `compatibleCreatorIdentityIds` membership is explicit; the literal `"*"` sentinel is unrepresentable both at the zod refine level and via the seed anti-pattern scan.
- **No real authored scripts.** Placeholder only; creative-content team authors real rows pre-launch.
- **No edits to SP1–SP14 source bodies.** Only allowlist maintenance in prior anti-pattern tests (precedent: every slice since SP10A).

---

## 2. Locked decisions

### 2.1 User-locked invariants (settled in brainstorming)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Full SP14 shape** — Prisma `ScriptTemplate` table + migration + `ScriptTemplatePayloadSchema` zod + pure `selectScript({brief, creatorIdentityId, now, templates})` selector + 24-row placeholder seed + reader on the DB side. No writer / store / `listAll` in SP15. | Persisted append-only registry with an authorship workflow (per umbrella §3.5). Pure-decider-over-caller-snapshot matches SP12/SP13/SP14. Writer deferred per YAGNI and per regulated-creative-copy concern (generic upsert normalises overwriting reviewed rows). |
| Q2 | **Input contract = `{ brief, creatorIdentityId, now, templates }`** — bare `creatorIdentityId`, NOT `SyntheticCreatorSelectionDecision`. | Loose coupling: SP15 source contains zero references to SP13 decision tokens. Composer (SP21) joins SP13 + SP14 + SP15 decisions for provenance. Avoids the ill-defined branch "what does SP15 return when `decision.allowed === false`?". Mirrors SP14's input-shape philosophy. |
| Q3 | **Four-way filter:** `vibe === brief.targetVibe` AND `treatmentClass === brief.treatmentClass` AND `status === "active"` AND `compatibleCreatorIdentityIds` contains `creatorIdentityId`. **Final tie-break:** `(version DESC, id ASC)`. | Verbatim umbrella §4 step 7. `(version DESC, id ASC)` mirrors SP14's tie-break and is robust to caller-supplied snapshots with duplicate `(vibe, treatment, version)` rows. |
| Q4 | **Discriminated-union failure, 2 reasons** — `"no_compatible_script"` (no row passes the 3-way `vibe + treatmentClass + status='active'` filter — catalogue gap; remediation = content team authors / activates a row) vs `"all_filtered_by_creator"` (3-way matches exist but none list this `creatorIdentityId` — selector/catalogue mismatch; remediation = fix the creator's compatibility list or pick a different creator upstream). `inspectedTemplateIds: readonly string[]` forensic field on the failure branch — populated on `all_filtered_by_creator` (the rows that almost matched, `id` ASC), empty on `no_compatible_script`. | Two reasons drive two distinct remediations. `status='retired'` rolls into `no_compatible_script` because the status filter is part of the 3-way prefilter; the diagnostic value of splitting status='retired' as a third reason is marginal (it is binary, no time dimension). |
| Q5 | **No `effectiveFrom` / `effectiveTo` window.** Lifecycle via `status` only. `now: Date` is accepted in `selectScript`'s input record for shape parity with SP14's `resolveDisclosure` and for forward compatibility with a future scheduled-activation extension, but is **unused** by the v1 selector body. | Umbrella §3.5 ScriptTemplate columns are `vibe / treatmentClass / text / compatibleCreatorIdentityIds[] / version / status` — no time window. Ad scripts are activated/retired, not scheduled. Shape parity reduces SP21 composer's call-site churn when scheduled-activation lands. |
| Q6 | **24-row placeholder seed.** Cartesian product 6 vibes × 4 treatments. Every row: `version=1`, `status="active"`, `compatibleCreatorIdentityIds = SP11_SYNTHETIC_CREATOR_ROSTER.map(r => r.id)` (10 IDs, imported from SP11 seed — not duplicated). `text = "[SCRIPT_PENDING_CREATIVE_REVIEW: <vibe>/<treatment>]"`. Prefix `[SCRIPT_PENDING_CREATIVE_REVIEW:` lives in exactly one non-test source file. | Same machine-detectable pattern as SP14. Uniform 10-creator compat list across all 24 rows means the happy path is fully covered; tests injecting restricted-creator fixtures inline exercise the `all_filtered_by_creator` branch. Importing the SP11 roster avoids drift if seed IDs change before SP21. |
| Q7 | **Exported predicate `isPlaceholderScriptText(text): boolean`** + `// MERGE-BACK:` contract marker. Render-time throw is SP21+'s responsibility. | SP15 doesn't own a production render path. The detection invariant must be machine-checkable so SP21+ binds against a stable signature rather than a substring-search convention. Matches SP14's `isPlaceholderDisclosureText` precedent verbatim. |
| Q8 | **19th pinned PCD constant `PCD_SCRIPT_SELECTOR_VERSION = "pcd-script-selector@1.0.0"`. Literal appears in exactly ONE non-test source file** (`script-selector-version.ts`). All consumers import the symbol. | Matches SP14's tightened single-source rule. Selector-logic version is distinct from registry row's per-row `version: int` — conflating would be a category error. |
| Q9 | **`allowed` discriminant** (not `selected`). | PCD-wide standard per SP12 `LicenseGateDecision`, SP13 `SyntheticCreatorSelectionDecision`, SP14 `DisclosureResolutionDecision`. Cross-slice consistency. |
| Q10 | **No wildcard `"*"` sentinel** in `compatibleCreatorIdentityIds`. Membership is explicit. Enforced at TWO layers: (a) `ScriptTemplatePayloadSchema` zod refine rejects any array containing `"*"`; (b) anti-pattern #4 scans seed values for `default/catch_all/wildcard/global/fallback` tokens. | Wildcards in compatibility lists silently allow all creators — invisible compliance gap if a creator is added later. Defense in depth: zod refine is the runtime guard; seed scan is the source-time guard. |
| Q11 | **Loose uniqueness on `(vibe, treatmentClass, version)`** is intentional. Multiple active scripts per that triple are permitted; `id` ASC is the deterministic final tie-break. Authorship semantics are intentionally loose in v1. No compound unique constraint on the Prisma model. | Authorship intent in v1 is "several scripts can compete inside the same vibe/treatment cell — SP19's overlay will eventually re-rank them". Forcing `(vibe, treatmentClass, version)` unique would pretend `version` is per-cell, but `version` is per-row (each script's own revision counter). The clean version of that contract requires a `scriptFamilyId` widen — flagged as U4 below, explicitly deferred. |

### 2.2 Judgment calls baked into this spec (open to push-back)

| # | Decision | Rationale |
|---|---|---|
| J1 | **Decision struct shape** — success carries `briefId, scriptTemplateId, vibe, treatmentClass, scriptTemplateVersion, creatorIdentityId, scriptText, selectorVersion, decisionReason`; failure carries `briefId, reason, vibe, treatmentClass, creatorIdentityId, inspectedTemplateIds, selectorVersion`. Both `.readonly()`. | Mirrors SP14 J1 reasoning: including `scriptText` on success means downstream consumers do not need a second registry read just to render. `creatorIdentityId` is on both branches because it's an input echo, not a computed result. `briefId` is echoed for SP9 provenance correlation. |
| J2 | **Selector subdir = `packages/creative-pipeline/src/pcd/script/`.** | Per-slice subdir convention from SP9 onward; sibling to `pcd/disclosure/`, `pcd/selector/`, `pcd/cost-budget/`, etc. Short name (`script`) to match SP14's `disclosure`. |
| J3 | **Seed lives in `packages/creative-pipeline/`, not `packages/db/`.** | SP14 / SP11 precedent — seeds live beside the pure pipeline logic that consumes them. The seed is used by selector tests, integration fixtures, and future composer wiring. |
| J4 | **Reader returns `readonly ScriptTemplatePayload[]`** (zod-parsed at the edge). | Repo-wide pattern: parse-at-the-edges. Caller gets immutable, schema-validated rows. Throws if a DB row violates the schema (defensive — should be impossible given migration column constraints, but cheap to enforce). |
| J5 | **Anti-pattern #4 (no-wildcard) is scoped to seed data values**, not selector source code. | Avoids false positives like comments saying `// no wildcard fallback in v1`. Programmatic iteration over `SCRIPT_TEMPLATE_SEED` checks every row's `id`, `vibe`, `treatmentClass`, `text`, AND `compatibleCreatorIdentityIds` for word-boundary matches against `default|catch_all|wildcard|global|fallback`. |
| J6 | **Anti-pattern #3 (purity) bans the usual purity-breakers in selector source** — `Date.now()`, `new Date(`, `Math.random()`, `crypto`, `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs|http|https`. **No allowlist for the seed** — unlike SP14, SP15's seed file does not need `new Date(...)` literals (no effective-window column). | Tighter than SP14 because SP15 has no time field. If a future widen adds scheduled-activation, that PR adds the appropriate allowlist alongside the new column. |
| J7 | **Reader method name `listByVibeAndTreatment({ vibe, treatmentClass })`** — returns ALL rows for that pair (any status, any compat list). The pure selector owns status + creator-compat filtering. | Cleaner separation: reader is the "narrow read window" (key tuple = `(vibe, treatmentClass)`); pure selector is the "decide" step. Mirrors SP14's `listByTuple` (reader doesn't filter on `effectiveFrom`/`effectiveTo`; resolver does). |
| J8 | **No `now`-unused source-grep anti-pattern.** Instead, a **behavioural determinism test** asserts: `selectScript` invoked twice with identical `(brief, creatorIdentityId, templates)` but different `now: Date` values returns byte-equal decisions. | Source-grep on `now` would be brittle (blocks comments, future refactors). The behavioural test captures the v1-no-windows invariant directly and lets a future scheduled-activation widen replace the test cleanly. Anti-pattern #3's general purity ban still covers the cases that matter (`Date.now()`, `new Date(`). |
| J9 | **`text` zod ceiling = 8000 chars** (vs SP14's 2000). | Ad scripts are typically longer than legal disclosure snippets — hook + body + CTA bundled into one record per umbrella §3.5 v1 atomicity rule. 8000 char headroom covers realistic multi-paragraph platform ads (~1500 chars typical, with bilingual variants and platform-specific subtext approaching the ceiling). Not a blocker — widens via one-line zod edit + `ALTER COLUMN` if real authored copy exceeds. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  pcd-script-template.ts                              [new]
  __tests__/pcd-script-template.test.ts               [new]
  index.ts                                            [touch — barrel]

packages/db/prisma/
  schema.prisma                                       [touch — add ScriptTemplate model]
  migrations/20260514160000_pcd_script_template_sp15/
    migration.sql                                     [new]

packages/db/src/stores/
  prisma-script-template-reader.ts                    [new]
  prisma-script-template-reader.test.ts               [new — mocked Prisma]
packages/db/src/index.ts                              [touch — re-export]

packages/creative-pipeline/src/pcd/script/
  script-selector-version.ts                          [new — 19th pinned constant]
  script-placeholder.ts                               [new — prefix literal + predicate]
  script-placeholder.test.ts                          [new — predicate tests]
  script-selector.ts                                  [new — selectScript]
  script-selector.test.ts                             [new]
  script-seed.ts                                      [new — 24 placeholder rows]
  script-seed.test.ts                                 [new — id regex + prefix + 24-cell coverage]
  sp15-anti-patterns.test.ts                          [new — 5 structural assertions]
  index.ts                                            [new — barrel]
packages/creative-pipeline/src/index.ts               [touch — re-export]
```

No store, no `listAll`, no admin path, no Inngest, no async.

**Migration timestamp is intentional.** The `20260514160000_pcd_script_template_sp15` folder name is the spec's prescribed timestamp matching the spec date (2026-05-14). Implementer agents must NOT "correct" it to the actual wall-clock time at implementation; the timestamp's role is to lock the migration's lexicographic order against SP14 (`20260514150000_pcd_disclosure_template_sp14`) and any future SP-numbered migration. Treat the literal as part of the spec.

### 3.2 Zod surface — `packages/schemas/src/pcd-script-template.ts`

```ts
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
// decision shape. Same NB carve-out as SP13's SyntheticCreatorSelectionDecision
// and SP14's DisclosureResolutionDecision.
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

Notes:
- `.readonly()` on every object + array — matches SP10B/SP12/SP13/SP14 precedent.
- `compatibleCreatorIdentityIds.min(1)` rejects empty compat lists (a row that compiles to "no creator can voice this" is nonsensical).
- `.refine` on `compatibleCreatorIdentityIds` rejects the `"*"` wildcard sentinel (Q10).
- `z.union` not `z.discriminatedUnion` (carve-out matches SP13/SP14 source).
- Discriminator on `allowed` (Q9). Two reasons (Q4). `inspectedTemplateIds` only on failure branch.

### 3.3 Version constant — `script-selector-version.ts`

```ts
// PCD slice SP15 — 19th pinned PCD constant.
// Selector-logic version. Distinct from per-row registry `version: int`.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SCRIPT_SELECTOR_VERSION = "pcd-script-selector@1.0.0";
```

The literal `"pcd-script-selector@"` appears in **exactly this one non-test source file** (Q8). All consumers import the symbol.

### 3.4 Placeholder constant + predicate — `script-placeholder.ts`

```ts
// PCD slice SP15 — placeholder script-text detection contract.
//
// MERGE-BACK: Production render paths MUST guard with this predicate.
// Any rendered ad emitting text where this returns true is a content
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

### 3.5 Pure selector — `script-selector.ts`

```ts
// PCD slice SP15 — pure deterministic script-template selector.
// Mirrors SP12 / SP13 / SP14 shape: typed input record, no I/O,
// no clock reads — caller supplies `now` (currently unused; reserved
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
// MERGE-BACK: Caller (SP21 composer or equivalent) supplies the templates
// snapshot via PrismaScriptTemplateReader.listByVibeAndTreatment(...).
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
  now: Date;                // accepted, unused in v1 — see top comment
  templates: readonly ScriptTemplatePayload[];
};

export function selectScript(input: SelectScriptInput): ScriptSelectionDecision;
```

Implementation pseudocode in §4. Anti-pattern test enforces purity (no `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto`, no `@creativeagent/db`, no `@prisma/client`, no `inngest`, no `node:fs|http|https`).

### 3.6 Prisma model — `schema.prisma` addition

```prisma
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

Notes:
- Enum-typed fields stored as `String` mirrors `CreatorIdentityLicense` / `DisclosureTemplate` (SP12 / SP14). Zod parse-at-the-edges enforces enum validity in the reader.
- **No compound unique on `(vibe, treatmentClass, version)`** — Q11 / J7. Multiple active scripts per cell are by design; `id` ASC is the final tie-break in the selector.
- `compatibleCreatorIdentityIds: String[]` is a Postgres `text[]` array column. v1 array sizes are small (≤10); array-contains scans are cheap. No relational join table — matches umbrella §3.5 verbatim.
- `@@index([vibe, treatmentClass, status])` supports the reader's `listByVibeAndTreatment` read path. The status column is included because future tweaks may pre-filter at the DB layer, but v1 reader does not.

### 3.7 Db reader surface — `prisma-script-template-reader.ts`

```ts
// PCD slice SP15 — reader-only by design. Writer interface deliberately
// deferred. Future authoring CLI/admin tool should ship explicit
// createScriptVersion(payload) and retireScript(id) operations —
// NOT a generic upsert. Generic upsert is the wrong semantics for
// vetted creative copy: it normalises overwriting reviewed rows.

export interface ScriptTemplateReader {
  listByVibeAndTreatment(input: {
    vibe: Vibe;
    treatmentClass: TreatmentClass;
  }): Promise<readonly ScriptTemplatePayload[]>;
}

export class PrismaScriptTemplateReader implements ScriptTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}
  async listByVibeAndTreatment(input): Promise<readonly ScriptTemplatePayload[]> {
    const rows = await this.prisma.scriptTemplate.findMany({
      where: {
        vibe: input.vibe,
        treatmentClass: input.treatmentClass,
      },
    });
    return rows.map((r) => ScriptTemplatePayloadSchema.parse({ ...r }));
  }
}
```

No `listAll`, no `findById`, no writer methods. Reader does NOT pre-filter on `status`; the pure selector owns the full filter chain. Parse-at-the-edges defends against DB-side enum-value drift (J4).

### 3.8 Seed — `script-seed.ts`

Exports a single `SCRIPT_TEMPLATE_SEED: readonly ScriptTemplatePayload[]` of length **24** (6 vibes × 4 treatment classes). Every row:

- `id`: `script-template-${vibe}-${treatment}-v1`
- `vibe`, `treatmentClass`: cell coordinates
- `version`: `1`
- `status`: `"active"`
- `compatibleCreatorIdentityIds`: `SP11_SYNTHETIC_CREATOR_ROSTER.map((r) => r.id)` — imported from `packages/creative-pipeline/src/pcd/synthetic-creator/seed.js`. Drift-proof; if SP11 seed IDs change, SP15 seed updates automatically.
- `text`: `` `${PLACEHOLDER_SCRIPT_PREFIX} ${vibe}/${treatment}]` ``

Top-of-file comment:

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
```

### 3.9 Barrel re-exports

- `packages/schemas/src/index.ts` — `export * from "./pcd-script-template.js"`. **Lands with the first DB-package consumer in this slice's task ordering, not at the end** — SP14 surfaced this as a real blocker; bake it into the plan upfront.
- `packages/db/src/index.ts` — re-export `ScriptTemplateReader` interface + `PrismaScriptTemplateReader`
- `packages/creative-pipeline/src/pcd/script/index.ts` — re-exports `selectScript`, `SelectScriptInput`, `PCD_SCRIPT_SELECTOR_VERSION`, `PLACEHOLDER_SCRIPT_PREFIX`, `isPlaceholderScriptText`, `SCRIPT_TEMPLATE_SEED`
- `packages/creative-pipeline/src/index.ts` — `export * from "./pcd/script/index.js"`

---

## 4. Algorithm Details

### 4.1 Pseudocode

```
selectScript(input):
  // Step 1 — 3-way prefilter on vibe + treatmentClass + status === "active"
  threeWayMatched = input.templates.filter(t =>
       t.vibe           === input.brief.targetVibe
    && t.treatmentClass === input.brief.treatmentClass
    && t.status         === "active"
  )
  if threeWayMatched.length === 0:
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_script",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds: [],
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    }

  // Step 2 — creator-compat filter
  creatorMatched = threeWayMatched.filter(t =>
    t.compatibleCreatorIdentityIds.includes(input.creatorIdentityId)
  )
  if creatorMatched.length === 0:
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_filtered_by_creator",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds: threeWayMatched.map(t => t.id).sort(idAsc),
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    }

  // Step 3 — pick highest version; final tie-break id ASC
  ranked = [...creatorMatched].sort((a, b) =>
    b.version !== a.version
      ? b.version - a.version
      : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  winner = ranked[0]

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
    decisionReason: buildDecisionReason(creatorMatched.length, threeWayMatched.length, winner.version),
  }
```

### 4.2 `buildDecisionReason`

Short human-readable string for forensics. Examples:

- `"script_selected (creator_matched=1, three_way=1, picked_version=1)"` — single-row cell, clean.
- `"script_selected (creator_matched=2, three_way=4, picked_version=3)"` — multi-row cell; picked highest version among the 2 creator-compatible.

Max 2000 chars per schema; in practice always under ~80.

### 4.3 Determinism guarantees

Given identical `(brief, creatorIdentityId, templates)`:
- Step 1 / Step 2 use `.filter()` over `readonly` arrays — order-stable.
- Step 3 uses total-order comparator (`version` DESC, `id` ASC) — order-stable even when caller supplies duplicate `(vibe, treatment, version)` rows.
- `now` is read into the input record but never referenced in selector body. **Behavioural determinism test asserts varying `now` does not change the decision** (J8) — captures the v1-no-windows invariant without source-grep brittleness.
- No `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto` imports — anti-pattern test asserts.

Replay: `(briefId, creatorIdentityId, selectorVersion, templates-snapshot)` → byte-equal `ScriptSelectionDecision`. Anti-pattern test asserts.

---

## 5. Test Strategy

### 5.1 Selector unit tests — `script-selector.test.ts` (~22 tests)

| Group | Cases |
|---|---|
| 3-way matching | brief matches exactly one row → success; zero matches → `no_compatible_script`, `inspectedTemplateIds: []`; wrong vibe / wrong treatment → fail; `status === "retired"` filtered → fail with `no_compatible_script` (NOT a separate reason) |
| Creator-compat | row exists but `creatorIdentityId` not in `compatibleCreatorIdentityIds` → `all_filtered_by_creator` + `inspectedTemplateIds` = 3-way matches, `id` ASC; `creatorIdentityId` in compat → success |
| Mixed retired+active | 1 active + 1 retired, both creator-compat → success picks the active one (retired filtered by status before creator-compat check) |
| Version tiebreak | 2 active creator-compat rows versions 1 vs 2 → picks v2; 3 rows versions 1/2/3 → picks v3; active v1 creator-compat + retired v2 creator-compat → picks active v1; 2 rows same `version`, different `id` → picks lexicographically smaller `id` |
| `inspectedTemplateIds` ordering | 3 rows with ids `c, a, b` matching 3-way but failing creator-compat → output is `[a, b, c]` |
| Pin invariant | `selectorVersion === PCD_SCRIPT_SELECTOR_VERSION` on every success and failure branch |
| Determinism — order | identical input twice → byte-equal decisions; shuffle `templates` order → same `scriptTemplateId` |
| **Determinism — `now` unused (J8)** | identical `(brief, creatorIdentityId, templates)`, varying `now` over `[epoch, year_2000, year_2100]` → byte-equal decisions. Captures v1-no-windows invariant. |
| Field echo | success carries `brief.targetVibe`, `brief.treatmentClass`, `input.creatorIdentityId` verbatim; failure carries same |
| `decisionReason` content | success reason substring contains `picked_version=N`; substring includes counts of creator_matched and three_way |

### 5.2 Schema tests — `packages/schemas/src/__tests__/pcd-script-template.test.ts` (~10 tests)

- Round-trip parse on both decision branches (success + failure)
- `.readonly()` enforcement on `compatibleCreatorIdentityIds` and `inspectedTemplateIds`
- Discriminator: `allowed: true` requires `scriptTemplateId`; `allowed: false` requires `reason`
- `compatibleCreatorIdentityIds.length === 0` rejected (min 1)
- `compatibleCreatorIdentityIds: ["valid-id", "*"]` rejected (wildcard refine — Q10)
- `compatibleCreatorIdentityIds: ["*"]` rejected (lone wildcard)
- `version: 0` rejected (min 1); empty `text` rejected; `text > 8000 chars` rejected
- `ScriptTemplateStatusSchema` accepts `"active"` / `"retired"`, rejects `"draft"`
- `ScriptSelectionRejectionReasonSchema` accepts both enum values, rejects `"other"`

### 5.3 Seed-shape tests — `script-seed.test.ts` (~9 tests)

- Exactly 24 rows
- Cartesian-product coverage: every `(vibe, treatmentClass)` appears exactly once
- Every row's `id` matches `^script-template-(omg_look|quiet_confidence|telling_her_friend|seven_days_later|just_left_clinic|softly_glowing)-(med_spa|dental|anti_ageing|halal_wellness)-v\d+$`
- Every row's `text` starts with `PLACEHOLDER_SCRIPT_PREFIX`
- Every row's `text` echoes its own tuple as substring (e.g. `omg_look/med_spa`)
- Every row: `version === 1`, `status === "active"`
- **Every row's `compatibleCreatorIdentityIds.length === SP11_ROSTER_SIZE`** (drift-proof check that the imported roster is the full size)
- `ScriptTemplatePayloadSchema.parse()` accepts every row
- `isPlaceholderScriptText(row.text)` returns `true` for every row

### 5.4 Anti-pattern tests — `sp15-anti-patterns.test.ts` (5 assertions)

1. **Single-source version pin.** The literal `"pcd-script-selector@"` appears in exactly ONE non-test source file across `packages/`: `script-selector-version.ts`. Matches SP14's tightened rule.
2. **Single-source placeholder prefix.** The literal `"[SCRIPT_PENDING_CREATIVE_REVIEW:"` appears in exactly ONE non-test source file: `script-placeholder.ts`. Seed and consumers import the symbol.
3. **Selector purity.** Sources under `pcd/script/` (excluding tests AND `script-seed.ts`) contain no `Date.now()`, no `new Date(`, no `Math.random()`, no `import.*crypto|@creativeagent/db|@prisma/client|inngest|node:fs|http|https`. (No allowlist for seed; SP15 has no time-window column — J6.)
4. **No-wildcard guarantee — seed values only.** Programmatic iteration over `SCRIPT_TEMPLATE_SEED`: every row's `id`, `vibe`, `treatmentClass`, `text`, AND every entry of `compatibleCreatorIdentityIds` is asserted free of word-boundary matches against `\b(default|catch_all|wildcard|global|fallback)\b`. Selector source code is NOT scanned for these tokens (J5). Zod refine handles the `"*"` case at runtime.
5. **No cross-slice tokens in source.** Sources under `pcd/script/` contain no occurrence of: (SP13 decision shape) `SyntheticCreatorSelectionDecision`, `selectedCreatorIdentityId`, `fallbackCreatorIdentityIds`, `selectorRank`, `metricsSnapshotVersion`, `performanceOverlayApplied`; (SP14 decision shape) `DisclosureResolutionDecision`, `disclosureTemplateId`, `resolverVersion`; (SP16+) `provider_routing`, `RoutingDecision`; (SP18+) `PcdPerformanceSnapshot`, `performance_snapshot`; (SP19+) `overlayWeight`; (SP20+) `face_descriptor`, `qc_face`. SP15 source cannot even look like it knows about creator selection, disclosure, provider routing, performance snapshot/overlay, or QC. **The plain token `creatorIdentityId` IS allowed** (SP15 takes it as an input parameter — that's an SP11 concept, not exclusively SP13's). The plain token `selectorVersion` IS allowed (SP15 has its own decision-struct field by that name).

### 5.5 Reader integration tests — `prisma-script-template-reader.test.ts` (~5 tests, mocked Prisma)

Per `feedback_api_test_mocked_prisma` precedent — CI has no Postgres; mock the Prisma client.

- `listByVibeAndTreatment` returns rows matching `(vibe, treatmentClass)` (Prisma `findMany` mock seeded with mixed rows)
- `listByVibeAndTreatment` returns empty array for non-matching pair
- Field mapping: Prisma row strings → zod-parsed `ScriptTemplatePayload` (parse-at-the-edges)
- Returned rows pass `ScriptTemplatePayloadSchema.parse()` (round-trip integrity)
- Reader does not call `prisma.scriptTemplate.create` / `update` / `upsert` / `delete` (read-only enforcement; assert mock was not called for those methods)

### 5.6 Allowlist maintenance

Per SP10A / SP10B / SP10C / SP11 / SP12 / SP13 / SP14 precedent, the following frozen-source-body allowlists are extended with SP15's net-new files:

- `sp9-anti-patterns.test.ts` (provenance freeze)
- `sp10a-anti-patterns.test.ts` (cost-forecast freeze)
- `sp10b-anti-patterns.test.ts` (tree-budget freeze)
- `sp10c-anti-patterns.test.ts` (cost-budget freeze)
- `sp11-anti-patterns.test.ts` (synthetic-creator freeze)
- `sp12-anti-patterns.test.ts` (license-gate freeze)
- `sp13-anti-patterns.test.ts` (selector freeze)
- `sp14-anti-patterns.test.ts` (disclosure freeze)

Net-new files to allowlist:

- `packages/creative-pipeline/src/pcd/script/script-selector.ts`
- `packages/creative-pipeline/src/pcd/script/script-selector-version.ts`
- `packages/creative-pipeline/src/pcd/script/script-placeholder.ts`
- `packages/creative-pipeline/src/pcd/script/script-seed.ts`
- `packages/creative-pipeline/src/pcd/script/script-selector.test.ts`
- `packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts`
- `packages/creative-pipeline/src/pcd/script/script-seed.test.ts`
- `packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/script/index.ts`
- `packages/schemas/src/pcd-script-template.ts`
- `packages/schemas/src/__tests__/pcd-script-template.test.ts`
- `packages/schemas/src/index.ts` (already widened multiple times — single-line union-add)
- `packages/creative-pipeline/src/index.ts` (already widened multiple times)
- `packages/db/src/stores/prisma-script-template-reader.ts`
- `packages/db/src/stores/prisma-script-template-reader.test.ts`
- `packages/db/src/index.ts`

Each prior anti-pattern test gets a one-line addition. Same fix-up commit pattern as every prior slice.

### 5.7 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: SP14 baseline (1826 + 2 skipped) + ~50 SP15 net new tests ≈ **~1876 passing**, 2 skipped unchanged.
- Prettier check via `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"`. The 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over; SP15 introduces no new prettier warnings.
- **Migration drift verification.** No `db:check-drift` script exists in this repo (Switchboard convention; SP14 plan had this wrong). Verify the SP14→SP15 delta via:
  ```
  git show 43cfdcd:packages/db/prisma/schema.prisma > /tmp/sp14-baseline.prisma
  pnpm exec prisma migrate diff \
    --from-schema-datamodel /tmp/sp14-baseline.prisma \
    --to-schema-datamodel packages/db/prisma/schema.prisma \
    --script
  ```
  Diff against `migrations/20260514160000_pcd_script_template_sp15/migration.sql`. Implementer must verify byte-equal (or whitespace-equivalent) match.
- **Index name truncation:** the index `ScriptTemplate_vibe_treatmentClass_status_idx` is 47 chars — well under Postgres's 63-char identifier limit. No truncation needed; verify the literal in the generated migration matches Prisma's exact output.

---

## 6. Merge-back to Switchboard

Strictly additive:

- **One new Prisma model**: `ScriptTemplate`. Zero changes to any existing model.
- **One new schemas file**: `pcd-script-template.ts`. One-line union-add to `packages/schemas/src/index.ts`.
- **One new db reader**: `prisma-script-template-reader.ts`. One-line re-export in `packages/db/src/index.ts`. No new store.
- **One new creative-pipeline subdir**: `pcd/script/` (9 files). One-line union-add to `packages/creative-pipeline/src/index.ts`.
- **Zero edits** to existing SP1–SP14 source bodies. The only cross-slice touches are 8 prior anti-pattern tests' allowlist widening.
- **Sed-pass `@creativeagent/*` → `@switchboard/*`** continues to work mechanically.
- **No imports outside the PCD scope.**

**`// MERGE-BACK:` markers** (six, on the listed declarations):

1. **`isPlaceholderScriptText`** (in `script-placeholder.ts`) — "Production render paths MUST guard with this predicate. Any rendered ad emitting text where this returns true is a content-review bug. SP15 publishes the predicate; render-time throw is SP21+'s responsibility."
2. **`SCRIPT_TEMPLATE_SEED`** (in `script-seed.ts`) — "Replace with real authored copy before Switchboard production launch. Seed is dev/test only. Production launch requires a separate creative-authoring pass; do NOT promote placeholder rows."
3. **`selectScript` declaration** (in `script-selector.ts`) — "Caller (SP21 composer or equivalent) supplies the templates snapshot via `PrismaScriptTemplateReader.listByVibeAndTreatment(...)`. SP15 itself never reads. Mirrors SP12 / SP13 / SP14 snapshot pattern. `now` is accepted but unused in v1; future scheduled-activation widen activates this slot."
4. **Top of `prisma-script-template-reader.ts`** — "Reader-only by design. Writer interface deliberately deferred. Future authoring CLI/admin tool should ship explicit `createScriptVersion(payload)` and `retireScript(id)` operations — NOT a generic `upsert`. Generic upsert is the wrong semantics for vetted creative copy: it normalises overwriting reviewed rows."
5. **`PCD_SCRIPT_SELECTOR_VERSION`** (in `script-selector-version.ts`) — "Pinned 19th PCD constant. Selector-logic version, distinct from registry row's per-row `version: int`. Switchboard merge does not change this literal; bumping it requires a coordinated provenance-replay assessment."
6. **`ScriptSelectionDecision` zod schema** (in `pcd-script-template.ts`) — "Decision struct is zod-only in SP15. Persistence is SP17's responsibility (SP9 provenance widen). SP17 will add `scriptTemplateId` and `scriptTemplateVersion` to `PcdIdentitySnapshot`. Whether SP17 also persists `scriptText` is a separate decision for SP17 to make — persisting templateId + version may be enough, and avoids duplicating ad copy into provenance rows."

---

## 7. Out-of-scope (explicit)

Carried forward from the umbrella roster design §11 and narrowed for SP15:

- **Real script authorship** — creative team workflow. SP15 seeds placeholders only.
- **Writer/store**: `ScriptTemplateStore`, `upsertVersion`, `createScriptVersion`, `retireScript`. Deferred per YAGNI and vetted-creative-copy semantics.
- **Reader `listAll` / `findById`** — deferred per the same discipline. SP21 composer uses `listByVibeAndTreatment` only.
- **Render-time placeholder enforcement** — SP21+ composer or render path owns the throw. SP15 publishes the predicate.
- **Provenance persistence of `ScriptSelectionDecision`** — SP17 owns the SP9 widen.
- **SP13 selection-decision composition** — SP21 composer joins SP13 + SP14 + SP15 decisions.
- **SP14 disclosure-decision composition** — same; SP21's job.
- **Provider routing (SP16), performance snapshot (SP18), performance overlay re-rank (SP19), QC face-match (SP20).**
- **Time-window columns** (`effectiveFrom`, `effectiveTo`) — SP15 lifecycle is status-only. (Q5)
- **Scheduled activation** — `now` is accepted but unused. Future widen adds time-window columns + activates the slot.
- **Wildcard / catch-all `"*"` sentinel** in `compatibleCreatorIdentityIds` — Q10. Zod refine + seed anti-pattern scan both reject.
- **Sub-element script atomicity** — hook/body/CTA decomposition. Umbrella §3.5 v1 atomicity rule: one ScriptTemplate = one full script. Deferred to a future slice.
- **Multi-language / localised script text** within a vibe/treatment cell — single-language-per-cell in v1.
- **Performance-attribution rollup** — SP18's job.
- **Real Postgres in unit tests** — mocked Prisma per repo convention (`feedback_api_test_mocked_prisma`).
- **Pagination / chunked listing** — registry is small in v1.
- **Inngest or async job integration.**
- **Admin UI / authoring dashboard.**
- **SP21 composer wiring tests** — SP15 ships SP15-bounded tests only.

---

## 8. Open questions / known unknowns

- **U1: Should `scriptText` live on the decision struct, or only `scriptTemplateId + scriptTemplateVersion`?** SP15 includes the text on the success branch (J1). Argument for: downstream consumer (SP21 render path) doesn't need a second registry read to obtain the text. Argument against: duplicates content into the decision struct that already exists in the templates snapshot. Decision: **include**. Mirrors SP14 U1. SP17 will independently decide whether to persist the text into provenance (per marker #6).
- **U2: Should the selector echo `scriptTemplateVersion` and `creatorIdentityId` into the success decision struct?** Both yes (J1). Version is needed for SP17 provenance write. `creatorIdentityId` is needed because SP21 composer correlates the script choice back to the SP13 creator choice via this field.
- **U3: When SP19's performance overlay ships, does it bump `PCD_SCRIPT_SELECTOR_VERSION`?** Probably yes — overlay introduces a non-uniform pick, which is a semantically different selector. Decision: defer to SP19 design.
- **U4: Loose uniqueness on `(vibe, treatmentClass, version)` — is `scriptFamilyId` the future widen?** Q11 documents that multiple active scripts per that triple are intentional in v1. If authorship intent later moves toward "version is per-script-family" (i.e. v2 of `script-template-omg_look-med_spa-a` is a strictly newer revision of the same script, vs. parallel-author `script-template-omg_look-med_spa-b` v1 which is a different script), the future widen adds a `scriptFamilyId` (or `slotKey`) column and `version` becomes per-family-unique. Out of SP15 scope; flagged for SP19 or follow-up authoring slice.
- **U5: Is `inspectedTemplateIds` useful enough to keep when SP17 ships?** SP15 includes it for ops forensics. If SP17 persistence layer finds it noisy, it can drop it from the persisted shape while the zod decision struct keeps it for in-process use. No change needed in SP15.
- **U6: Is `text.max(8000)` enough headroom for real authored scripts?** v1 placeholder seed strings are well under 100 chars; the 8000-char ceiling is generous for typical platform ad scripts (~1500 chars typical) but **may pinch for multi-language bilingual single-row authoring** or extreme long-form (YouTube Shorts max-length scripts). Not a blocker for SP15; widens via one-line zod edit + an `ALTER COLUMN` migration; the selector itself is text-length-agnostic.
- **U7: Should `compatibleCreatorIdentityIds` array indexing get a GIN index on Postgres for large-N production catalogues?** SP15 v1 array sizes are tiny (≤10 entries per row, ≤24 rows total in seed). Sequential array-contains scan is essentially free. If the catalogue grows past ~1000 rows, a GIN index on `compatibleCreatorIdentityIds` becomes worthwhile. Deferred — one-line `@@index([compatibleCreatorIdentityIds], type: Gin)` add when needed.

---

## 9. Implementation slicing (preview, not the plan)

The SP15 plan will be written next via `writing-plans`. Anticipated task list, TDD-paced (one test commit per task):

| # | Task | Approx tests |
|---|---|---|
| 1 | New `pcd-script-template.ts` zod schema + co-located test (incl. wildcard refine) | ~10 |
| 2 | Widen `packages/schemas/src/index.ts` barrel (lands now, not at end — SP14 lesson) | — |
| 3 | New `script-selector-version.ts` constant (19th pinned) | — |
| 4 | New `script-placeholder.ts` constant + predicate + tests | ~3 |
| 5 | Prisma `ScriptTemplate` model + migration SQL via `prisma migrate diff --from-schema-datamodel <SP14-baseline> --to-schema-datamodel <current> --script` | — (drift verification gates) |
| 6 | New `PrismaScriptTemplateReader.listByVibeAndTreatment` + reader tests | ~5 |
| 7 | New `script-seed.ts` (24 rows) + seed-shape tests (incl. drift-proof `SP11_ROSTER_SIZE` check) | ~9 |
| 8 | New `script-selector.ts` skeleton — empty `selectScript` returning stub failure (lands file + import surface) | — |
| 9 | 3-way prefilter (vibe + treatment + status='active') + tests | ~5 |
| 10 | Creator-compat filter + `all_filtered_by_creator` branch + `inspectedTemplateIds` ordering + tests | ~5 |
| 11 | Version-tiebreak comparator (`version` DESC, `id` ASC) + tests | ~4 |
| 12 | Behavioural `now`-unused determinism test (J8) + pin invariant + general determinism | ~4 |
| 13 | `sp15-anti-patterns.test.ts` — 5 assertions (incl. cross-slice token blacklist with `creatorIdentityId` carve-out) | ~5 |
| 14 | Allowlist-maintenance fix-up — widen 8 prior anti-pattern test allowlists | — |
| 15 | Final barrel re-exports (db, creative-pipeline) | — |
| 16 | Final full-repo typecheck + test + prettier sweep | — |

Estimated: **~15–17 commits** on the branch, squashed to **1 PR** against `main`.

**Worktree:** `.worktrees/sp15`. Every implementer subagent prompt opens with `pwd` + `git branch --show-current` and refuses to proceed if the path/branch doesn't match — per the SP13/SP14 subagent-wrong-worktree lesson.

---

*End of design spec. Awaiting user review per brainstorming skill review gate before transitioning to writing-plans.*
