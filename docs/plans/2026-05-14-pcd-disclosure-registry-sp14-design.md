# PCD SP14 — Disclosure Registry — Design Spec

**Date:** 2026-05-14
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (brainstorming session)
**Predecessor slices:** SP11 (synthetic-creator foundation, `3b3d291`), SP12 (license gate, `13ee16d`), SP13 (synthetic-creator selector, `dc7b498`)
**Successor slices reserved by name:** SP15 (script templates), SP16 (provider-routing extension for synthetic), SP17 (SP9 provenance extension), SP18 (`PcdPerformanceSnapshot`), SP19 (performance overlay re-rank), SP20 (synthetic QC face-match), SP21 (end-to-end integration / composer)

---

## 1. Scope & Strategy

The synthetic-creator track has shipped its data layer (SP11), per-clinic licensing gate (SP12), and the first allocator (SP13). SP14 introduces the **disclosure registry** — the per-jurisdiction × platform × treatment-class catalogue of regulated disclosure copy that any synthetic-creator-rendered ad must carry — together with the **pure resolver** that joins a `CreativeBrief` to a current registry row.

Per the umbrella roster design doc (`2026-04-30-pcd-synthetic-creator-roster-design.md`) §3.4 + §4 step 6, disclosure resolution is the gate that runs **after** the license gate and **before** script selection. Its key tuple is `(jurisdictionCode, platform, treatmentClass)` — pure brief-derived, with zero creator-identity coupling. On miss the umbrella pipeline hard-fails with `DISCLOSURE_UNRESOLVABLE`.

SP14 lights up that layer in its minimum-viable form:

- **Full SP12 shape** — Prisma `DisclosureTemplate` table + `DisclosureTemplatePayload` zod schema + pure resolver over a caller-supplied `templates` snapshot.
- **Reader-only** on the DB side. `listByTuple(...)` is the SP21 composer's known call path; `listAll` is deferred.
- **No writer / store.** Generic upsert is the wrong semantics for regulated copy. Future legal-authoring caller (CLI, admin tool) should ship explicit `createTemplateVersion` / `supersedeTemplateVersion` operations — not in SP14.
- **48-row placeholder seed.** Every cell of the `3 jurisdictions × 4 platforms × 4 treatment classes` cube is seeded with a machine-detectable stub (`[DISCLOSURE_PENDING_LEGAL_REVIEW:` prefix). Legal-authored copy lands in a separate seeding pass before any synthetic-creator-rendered ad ships.
- **Predicate publication, not enforcement.** SP14 exports `isPlaceholderDisclosureText(text): boolean`; production render paths (SP21+) MUST guard with it. Render-time throw is downstream's job.

What SP14 deliberately does NOT do:

- **No store / writer**, no upsert, no admin authoring path, no `listAll`.
- **No render-time enforcement.** Detection contract only.
- **No provenance persistence.** Decision struct is zod-only; SP17 owns the SP9 widen.
- **No composer integration.** SP21 joins SP13 + SP14 (+ SP15) decisions; SP14 stays unaware of selector outcome.
- **No script selection** (SP15), **no provider routing** (SP16), **no performance overlay** (SP19), **no QC** (SP20).
- **No wildcards** — no `(SG, *, treatment)`, no `(*, *, *)`, no cascade fallback. Exact tuple match or fail.
- **No real disclosure copy.** Placeholder only; legal authors prod rows pre-launch.
- **No edits to SP1–SP13 source bodies.** Only allowlist maintenance in prior anti-pattern tests (precedent: every slice since SP10A).

---

## 2. Locked decisions

### 2.1 User-locked invariants (settled in brainstorming)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Full SP12 shape** — Prisma `DisclosureTemplate` table + migration + `DisclosureTemplatePayload` zod + pure `resolveDisclosure({brief, now, templates})` resolver + 48-row placeholder seed. Reader on the DB side; no writer/store in SP14. | Disclosure is a persisted append-only registry with an authorship workflow; pure-decider-over-snapshot composes with Prisma persistence the same way SP12 did. Writer deferred per YAGNI and per regulated-copy concern (generic upsert normalises overwriting legal-approved rows). |
| Q2 | **Key tuple = `(jurisdictionCode, platform, treatmentClass)`.** No `market` axis (1:1 with jurisdiction in v1). | Matches umbrella spec §3.4 verbatim and `CreativeBrief` field shape. Platform varies disclosure copy within a jurisdiction (Meta/TikTok/RED/YouTube conventions differ); market is redundant with jurisdiction. |
| Q3 | **Parallel to SP13** — resolver input is `{brief, now, templates}`. Does NOT consume `SyntheticCreatorSelectionDecision`. | Disclosure cells are not creator-keyed. Coupling SP14 to SP13 creates fake dependency and an incoherent failure-mode (what does SP14 return when SP13 already failed?). SP21 composer joins SP13 + SP14 decisions for provenance; SP14 stays agnostic. |
| Q4 | **Discriminated-union failure, 2 reasons** — `"no_template_for_tuple"` (catalogue gap) vs `"no_active_template_at_now"` (stale window). `inspectedTemplateIds: readonly string[]` forensic field on failure branch only. | Two failures with distinct remediations (legal authors a row vs. ops activates a window). Matches SP12/SP13 pure-decider precedent. Composer-level throw (per umbrella §4 step 6) is reserved for SP21. |
| Q5 | **Half-open windows `[effectiveFrom, effectiveTo)`** with `effectiveTo: null` meaning indefinite. | SP12 lease-window precedent; avoids overlap ambiguity at instant boundaries. |
| Q6 | **Highest `version: int` wins** when multiple rows are simultaneously active for the same tuple. Final tie-break: `id` ASC. | Umbrella spec §3.4: `version` is monotonic per tuple. `id` ASC final tie-break protects against caller-supplied snapshots with duplicate `(tuple, version)` rows; DB unique constraint normally prevents this but the resolver is robust to it. |
| Q7 | **No wildcard / catch-all rows.** Strict exact-tuple lookup. `(SG, *, treatment)`, `(*, *, treatment)`, `(*, *, *)` are unrepresentable. | Wildcards in regulated-copy registries hide compliance gaps as silent defaults. v1 cost of strict matching is zero (48 cells × placeholder rows). Easier to add later than to remove. |
| Q8 | **Placeholder seed, all 48 cells, single-source prefix.** Every row's `text` begins with the literal `[DISCLOSURE_PENDING_LEGAL_REVIEW:` followed by the tuple. Prefix lives in exactly one non-test source file (`disclosure-placeholder.ts`). | Makes the registry real for integration tests; impossible to confuse with shipping copy. Single-source discipline matches the version-pin rule (Q10). |
| Q9 | **Exported predicate `isPlaceholderDisclosureText(text): boolean`** + `// MERGE-BACK:` contract marker. Render-time throw is downstream's responsibility; SP14 publishes the detection contract. | SP14 doesn't own a production render path. The detection invariant must be machine-checkable so SP21+ binds against a stable signature rather than a substring-search convention. |
| Q10 | **18th pinned PCD constant `PCD_DISCLOSURE_RESOLVER_VERSION = "pcd-disclosure-resolver@1.0.0"`. Literal appears in exactly ONE non-test source file** (`disclosure-resolver-version.ts`). All consumers import the symbol. | Stricter than SP13's "literal in two files" allowance. Cleaner anti-pattern grep; no drift. Resolver-logic version is distinct from registry row's per-tuple `version: int` — conflating would be a category error. |
| Q11 | **No Prisma `status` column** on `DisclosureTemplate`. Supersession is implicit via `effectiveTo`. | Matches umbrella §3.4 verbatim. A `status: superseded` column would duplicate window logic and create two ways to disable a row. |
| Q12 | **Deterministic seed IDs** — `disclosure-template-<jurisdiction>-<platform>-<treatment>-v1`. Positive regex enforced. | Test stability and review readability. Matches SP11's deterministic-id seed convention. |
| Q13 | **`allowed` discriminant** (not `resolved`). | Two prior precedents establish PCD-wide standard: SP12 `LicenseGateDecision` and SP13 `SyntheticCreatorSelectionDecision` both use `allowed: true | false`. Cross-slice consistency outweighs the (defensible) `resolved` semantic preference. |
| Q14 | **`inspectedTemplateIds` order = `id` ASC** (lexicographic) on the failure branch. | Simple, stable across snapshot comparisons, no recency surprise. Required for deterministic byte-equal failure decisions. |
| Q15 | **Anti-pattern #5 blacklists SP13 decision-shape tokens** alongside SP15–SP20 tokens. | SP14 source should not even look like it knows about creator selection. The composer (SP21) joins SP13 + SP14 decisions; SP14 source contains zero references to creator identity. |

### 2.2 Judgment calls baked into this spec (open to push-back)

| # | Decision | Rationale |
|---|---|---|
| J1 | **Decision struct shape** — success carries `briefId, disclosureTemplateId, jurisdictionCode, platform, treatmentClass, templateVersion, disclosureText, resolverVersion, decisionReason`; failure carries `briefId, reason, jurisdictionCode, platform, treatmentClass, inspectedTemplateIds, resolverVersion`. Both `.readonly()`. | `effectiveFrom`/`effectiveTo` are forensic-redundant with `disclosureTemplateId` (downstream re-reads if needed). Including the resolved text on success means downstream consumers do not need a second registry read just to render. |
| J2 | **Resolver subdir = `packages/creative-pipeline/src/pcd/disclosure/`.** | Per-slice subdir convention from SP9 onward; sibling to `pcd/selector/`, `pcd/cost-budget/`, etc. |
| J3 | **Seed lives in `packages/creative-pipeline/`, not `packages/db/`.** | SP11 keeps the synthetic-creator seed beside creative-pipeline domain logic. The seed is used by resolver tests, integration fixtures, and future composer wiring; putting it in `packages/db/` would make pure pipeline tests pull in DB-package concepts unnecessarily. |
| J4 | **Reader returns `readonly DisclosureTemplatePayload[]`** (zod-parsed at the edge). | Repo-wide pattern: parse-at-the-edges. Caller gets immutable, schema-validated rows. Throws if the DB row violates the schema (defensive — should be impossible given the migration's column constraints, but cheap to enforce). |
| J5 | **Anti-pattern #4 (no-wildcard) is scoped to seed data values**, not resolver source code. | Avoids false positives like comments saying `// no fallback in v1`. Programmatic iteration over `DISCLOSURE_TEMPLATE_SEED` checks every row's `id`, `jurisdictionCode`, `platform`, `treatmentClass`, and `text` for word-boundary matches against `default|catch_all|wildcard|global|fallback`. |
| J6 | **Anti-pattern #3 (purity) allowlists exactly one `new Date(...)` literal in `disclosure-seed.ts`** — the fixed string `"2026-01-01T00:00:00Z"`. All other `pcd/disclosure/` sources are `new Date(`-free. | Seed needs a deterministic constant `effectiveFrom`; allowlisting the exact substring keeps the purity gate tight. |
| J7 | **No Prisma `status` enum, no `supersededAt` column, no `supersededById` FK.** Supersession remains implicit via `effectiveTo`. | Matches umbrella spec §3.4. Adding any of these now embeds a future authoring workflow that SP14 explicitly defers. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  pcd-disclosure-template.ts                              [new]
  __tests__/pcd-disclosure-template.test.ts               [new]
  index.ts                                                [touch — barrel]

packages/db/prisma/
  schema.prisma                                           [touch — add DisclosureTemplate model]
  migrations/20260514150000_pcd_disclosure_template_sp14/
    migration.sql                                         [new]

packages/db/src/stores/
  prisma-disclosure-template-reader.ts                    [new]
  prisma-disclosure-template-reader.test.ts               [new — mocked Prisma]
packages/db/src/index.ts                                  [touch — re-export]

packages/creative-pipeline/src/pcd/disclosure/
  disclosure-resolver-version.ts                          [new — 18th pinned constant]
  disclosure-placeholder.ts                               [new — prefix literal + predicate]
  disclosure-placeholder.test.ts                          [new — predicate tests]
  disclosure-resolver.ts                                  [new — resolveDisclosure]
  disclosure-resolver.test.ts                             [new]
  disclosure-seed.ts                                      [new — 48 placeholder rows]
  disclosure-seed.test.ts                                 [new — ID regex + prefix + 48-cell coverage]
  sp14-anti-patterns.test.ts                              [new — 5 structural assertions]
  index.ts                                                [new — barrel]
packages/creative-pipeline/src/index.ts                   [touch — re-export]
```

No store, no `listAll`, no admin path, no Inngest, no async.

### 3.2 Zod surface — `packages/schemas/src/pcd-disclosure-template.ts`

```ts
import { z } from "zod";
import { JurisdictionCodeSchema, PlatformSchema } from "./creative-brief.js";
import { TreatmentClassSchema } from "./creator-identity-synthetic.js";

export const DisclosureTemplatePayloadSchema = z
  .object({
    id: z.string().min(1),
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    treatmentClass: TreatmentClassSchema,
    version: z.number().int().min(1),
    text: z.string().min(1).max(2000),
    effectiveFrom: z.date(),
    effectiveTo: z.date().nullable(),
  })
  .readonly()
  .refine(
    (t) => t.effectiveTo === null || t.effectiveTo.getTime() > t.effectiveFrom.getTime(),
    { message: "effectiveTo must be strictly after effectiveFrom (or null for indefinite)" },
  );
export type DisclosureTemplatePayload = z.infer<typeof DisclosureTemplatePayloadSchema>;

export const DisclosureResolutionRejectionReasonSchema = z.enum([
  "no_template_for_tuple",
  "no_active_template_at_now",
]);
export type DisclosureResolutionRejectionReason = z.infer<
  typeof DisclosureResolutionRejectionReasonSchema
>;

export const DisclosureResolutionDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      briefId: z.string().min(1),
      disclosureTemplateId: z.string().min(1),
      jurisdictionCode: JurisdictionCodeSchema,
      platform: PlatformSchema,
      treatmentClass: TreatmentClassSchema,
      templateVersion: z.number().int().min(1),
      disclosureText: z.string().min(1),
      resolverVersion: z.string().min(1),
      decisionReason: z.string().min(1).max(2000),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      briefId: z.string().min(1),
      reason: DisclosureResolutionRejectionReasonSchema,
      jurisdictionCode: JurisdictionCodeSchema,
      platform: PlatformSchema,
      treatmentClass: TreatmentClassSchema,
      inspectedTemplateIds: z.array(z.string().min(1)).readonly(),
      resolverVersion: z.string().min(1),
    })
    .readonly(),
]);
export type DisclosureResolutionDecision = z.infer<typeof DisclosureResolutionDecisionSchema>;
```

Notes:
- `.readonly()` on every object + array — matches SP10B/SP12/SP13 precedent.
- Refine on `DisclosureTemplatePayloadSchema` prevents zero-length or inverted windows.
- Discriminator on `allowed` (Q13). Two reasons (Q4). `inspectedTemplateIds` only on the failure branch.

### 3.3 Version constant — `disclosure-resolver-version.ts`

```ts
// PCD slice SP14 — 18th pinned PCD constant.
// Resolver-logic version. Distinct from per-tuple registry row `version: int`.
//
// MERGE-BACK: Switchboard merge does not change this literal; bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_DISCLOSURE_RESOLVER_VERSION = "pcd-disclosure-resolver@1.0.0";
```

The literal `"pcd-disclosure-resolver@"` appears in **exactly this one non-test source file** (Q10). All consumers import the symbol.

### 3.4 Placeholder constant + predicate — `disclosure-placeholder.ts`

```ts
// PCD slice SP14 — placeholder disclosure-text detection contract.
//
// MERGE-BACK: Production render paths MUST guard with this predicate.
// Any rendered ad emitting text where this returns true is a compliance bug.
// SP14 publishes the predicate; render-time throw is SP21+'s responsibility.
//
// Single-source literal: PLACEHOLDER_DISCLOSURE_PREFIX appears in exactly
// this one non-test source file. Seed and consumers import the symbol.
export const PLACEHOLDER_DISCLOSURE_PREFIX = "[DISCLOSURE_PENDING_LEGAL_REVIEW:";

export function isPlaceholderDisclosureText(text: string): boolean {
  return text.startsWith(PLACEHOLDER_DISCLOSURE_PREFIX);
}
```

### 3.5 Pure resolver — `disclosure-resolver.ts`

```ts
// PCD slice SP14 — pure deterministic disclosure resolver.
// Mirrors SP12 license-gate / SP13 selector shape: typed input record,
// no I/O, no clock reads — caller supplies `now` and the templates
// snapshot. Invoked at job-creation time per umbrella spec §4 step 6.
//
// Algorithm:
//   1. Exact-tuple filter on (jurisdictionCode, platform, treatmentClass).
//   2. Half-open window filter at `now`: [effectiveFrom, effectiveTo),
//      with effectiveTo: null meaning indefinite.
//   3. Pick highest `version`; final tie-break `id` ASC.
//
// No wildcard fallback (Q7). Two failure reasons (Q4). Decision is
// zod-only; persistence is SP17's responsibility.
//
// MERGE-BACK: Caller (SP21 composer or equivalent) supplies the templates
// snapshot via PrismaDisclosureTemplateReader.listByTuple(...). SP14 itself
// never reads. Mirrors SP12 licenseGate(leases) / SP13 selectSyntheticCreator
// (roster, leases) snapshot pattern.

import type {
  CreativeBrief,
  DisclosureResolutionDecision,
  DisclosureTemplatePayload,
} from "@creativeagent/schemas";
import { PCD_DISCLOSURE_RESOLVER_VERSION } from "./disclosure-resolver-version.js";

export type ResolveDisclosureInput = {
  brief: CreativeBrief;
  now: Date;
  templates: readonly DisclosureTemplatePayload[];
};

export function resolveDisclosure(
  input: ResolveDisclosureInput,
): DisclosureResolutionDecision;
```

Implementation pseudocode in §4. Anti-pattern test enforces purity (no `Date.now()`, no `new Date(`, no `Math.random()`, no `crypto`, no `@creativeagent/db`, no `@prisma/client`, no `inngest`, no `node:fs|http|https`).

### 3.6 Prisma model — `schema.prisma` addition

```prisma
model DisclosureTemplate {
  id                String    @id @default(cuid())
  jurisdictionCode  String
  platform          String
  treatmentClass    String
  version           Int
  text              String    @db.Text
  effectiveFrom     DateTime
  effectiveTo       DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([jurisdictionCode, platform, treatmentClass, version])
  @@index([jurisdictionCode, platform, treatmentClass, effectiveFrom])
}
```

Notes:
- Enum-typed fields stored as `String` mirrors how `CreatorIdentityLicense` stores `market`/`treatmentClass`/`lockType`. Zod parse-at-the-edges enforces enum validity in the reader.
- `@@unique([jurisdictionCode, platform, treatmentClass, version])` enforces monotonic `version` per tuple at the DB level.
- `@@index` supports the resolver's `listByTuple` read path.
- No `status` column, no `supersededAt`, no `supersededById` (J7).

### 3.7 Db reader surface — `prisma-disclosure-template-reader.ts`

```ts
// PCD slice SP14 — reader-only by design. Writer interface deliberately
// deferred. Future legal-authoring CLI/admin tool should ship explicit
// createTemplateVersion(payload) and supersedeTemplateVersion(id, supersededAt)
// operations — NOT a generic upsert. Generic upsert is the wrong semantics
// for regulated copy: it normalises overwriting legal-approved rows.

export interface DisclosureTemplateReader {
  listByTuple(input: {
    jurisdictionCode: JurisdictionCode;
    platform: Platform;
    treatmentClass: TreatmentClass;
  }): Promise<readonly DisclosureTemplatePayload[]>;
}

export class PrismaDisclosureTemplateReader implements DisclosureTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}
  async listByTuple(input): Promise<readonly DisclosureTemplatePayload[]> {
    const rows = await this.prisma.disclosureTemplate.findMany({
      where: {
        jurisdictionCode: input.jurisdictionCode,
        platform: input.platform,
        treatmentClass: input.treatmentClass,
      },
    });
    return rows.map((r) => DisclosureTemplatePayloadSchema.parse({ ...r }));
  }
}
```

No `listAll`, no `findById`, no writer methods. Parse-at-the-edges defends against DB-side enum-value drift (J4).

### 3.8 Seed — `disclosure-seed.ts`

Exports a single `DISCLOSURE_TEMPLATE_SEED: readonly DisclosureTemplatePayload[]` of length **48** (3 jurisdictions × 4 platforms × 4 treatment classes). Every row:

- `id`: `disclosure-template-${jurisdiction}-${platform}-${treatment}-v1`
- `jurisdictionCode`, `platform`, `treatmentClass`: cell coordinates
- `version`: `1`
- `text`: `` `${PLACEHOLDER_DISCLOSURE_PREFIX} ${jurisdiction}/${platform}/${treatment}]` ``
- `effectiveFrom`: `new Date("2026-01-01T00:00:00Z")` (the only `new Date(...)` literal allowlisted by anti-pattern #3)
- `effectiveTo`: `null`

Top-of-file comment:

```ts
// ⚠️ PLACEHOLDER DISCLOSURE TEMPLATES — NOT FOR PRODUCTION USE.
// Every row's `text` is a stub; legal must replace before any
// synthetic-creator-rendered ad ships. Render paths MUST guard against
// isPlaceholderDisclosureText() returning true.
//
// MERGE-BACK: Replace with real legal-authored copy before Switchboard
// production launch. Seed is dev/test only. Production launch requires
// a separate legal-authoring pass; do NOT promote placeholder rows.
//
// SP14 seed shape: 48 cells covering SG/MY/HK × meta/tiktok/red/youtube_shorts
// × med_spa/dental/anti_ageing/halal_wellness. Every cell version=1,
// effectiveFrom=2026-01-01T00:00:00Z, effectiveTo=null.
```

### 3.9 Barrel re-exports

- `packages/schemas/src/index.ts` — `export * from "./pcd-disclosure-template.js"`
- `packages/db/src/index.ts` — re-export `DisclosureTemplateReader` interface + `PrismaDisclosureTemplateReader`
- `packages/creative-pipeline/src/pcd/disclosure/index.ts` — re-exports `resolveDisclosure`, `ResolveDisclosureInput`, `PCD_DISCLOSURE_RESOLVER_VERSION`, `PLACEHOLDER_DISCLOSURE_PREFIX`, `isPlaceholderDisclosureText`, `DISCLOSURE_TEMPLATE_SEED`
- `packages/creative-pipeline/src/index.ts` — `export * from "./pcd/disclosure/index.js"`

---

## 4. Algorithm Details

### 4.1 Pseudocode

```
resolveDisclosure(input):
  // Step 1 — exact-tuple filter
  tupleMatched = input.templates.filter(t =>
    t.jurisdictionCode === input.brief.jurisdictionCode
    && t.platform        === input.brief.platform
    && t.treatmentClass  === input.brief.treatmentClass
  )
  if tupleMatched.length === 0:
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_template_for_tuple",
      jurisdictionCode: input.brief.jurisdictionCode,
      platform: input.brief.platform,
      treatmentClass: input.brief.treatmentClass,
      inspectedTemplateIds: [],
      resolverVersion: PCD_DISCLOSURE_RESOLVER_VERSION,
    }

  // Step 2 — half-open window filter at `now`: [effectiveFrom, effectiveTo)
  active = tupleMatched.filter(t =>
    t.effectiveFrom.getTime() <= input.now.getTime()
    && (t.effectiveTo === null || input.now.getTime() < t.effectiveTo.getTime())
  )
  if active.length === 0:
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_active_template_at_now",
      jurisdictionCode: input.brief.jurisdictionCode,
      platform: input.brief.platform,
      treatmentClass: input.brief.treatmentClass,
      inspectedTemplateIds: tupleMatched.map(t => t.id).sort(idAsc),
      resolverVersion: PCD_DISCLOSURE_RESOLVER_VERSION,
    }

  // Step 3 — pick highest version; final tie-break id ASC
  ranked = [...active].sort((a, b) =>
    b.version !== a.version
      ? b.version - a.version
      : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  winner = ranked[0]

  return {
    allowed: true,
    briefId: input.brief.briefId,
    disclosureTemplateId: winner.id,
    jurisdictionCode: input.brief.jurisdictionCode,
    platform: input.brief.platform,
    treatmentClass: input.brief.treatmentClass,
    templateVersion: winner.version,
    disclosureText: winner.text,
    resolverVersion: PCD_DISCLOSURE_RESOLVER_VERSION,
    decisionReason: buildDecisionReason(active.length, tupleMatched.length, winner.version),
  }
```

### 4.2 `buildDecisionReason`

Short human-readable string for forensics. Examples:

- `"tuple_resolved (active=1, total_for_tuple=1, picked_version=1)"` — single-row cell, clean.
- `"tuple_resolved (active=2, total_for_tuple=3, picked_version=4)"` — overlap-and-supersession case; picked highest version among the 2 active.

Max 2000 chars per schema; in practice always under ~80.

### 4.3 Determinism guarantees

Given identical `(brief, now, templates)`:
- Step 1 / Step 2 use `.filter()` over `readonly` arrays — order-stable.
- Step 3 uses total-order comparator (`version` DESC, `id` ASC) — order-stable even when caller supplies duplicate `(tuple, version)` rows (which the DB unique constraint normally prevents, but the resolver is robust to).
- No `Date.now()`, no `new Date(...)` outside the seed file's allowlisted fixed literal.
- No `Math.random()`, no `crypto` imports.

Replay: `(briefId, resolverVersion, templates-snapshot, now)` → byte-equal `DisclosureResolutionDecision`. Anti-pattern test asserts.

---

## 5. Test Strategy

### 5.1 Resolver unit tests — `disclosure-resolver.test.ts` (~25 tests)

| Group | Cases |
|---|---|
| Tuple matching | brief matches exactly one row → success; zero matches → `no_template_for_tuple`, `inspectedTemplateIds: []`; wrong jurisdiction / wrong platform / wrong treatment → fail |
| Window boundaries | `now === effectiveFrom` → active (inclusive lower bound); `now === effectiveTo` → inactive (exclusive upper bound); `now = effectiveFrom - 1ms` → inactive; `now = effectiveTo - 1ms` → active; `effectiveTo === null` + `now > effectiveFrom` → active indefinitely |
| Stale catalogue | all tuple-matched rows expired → `no_active_template_at_now` + `inspectedTemplateIds = [tuple's row ids, id ASC]`; mix of 2 active + 1 expired → picks among actives; expired's id NOT in success branch |
| Version tiebreak (overlap) | 2 active rows same tuple, versions 1 vs 2 → picks v2; 3 active rows versions 1/2/3 → picks v3; active v1 + inactive (out-of-window) v2 → picks active v1; 2 active rows same `version`, different `id` → picks lexicographically smaller `id` |
| `inspectedTemplateIds` ordering | 3 expired rows with ids `c, a, b` → output is `[a, b, c]` |
| Pin invariant | `resolverVersion === PCD_DISCLOSURE_RESOLVER_VERSION` on every success and failure branch |
| Determinism | identical input twice → byte-equal decisions; shuffle `templates` order → same `disclosureTemplateId`; shuffle plus duplicate-version snapshot → same `id`-ASC tie-break winner |
| Field echo | success carries `brief.{jurisdictionCode,platform,treatmentClass}` verbatim; failure carries same |
| `decisionReason` content | success reason substring contains `picked_version=N`; substring includes counts of active and total-for-tuple |

### 5.2 Schema tests — `packages/schemas/src/__tests__/pcd-disclosure-template.test.ts` (~10 tests)

- Round-trip parse on both branches (success + failure)
- `.readonly()` enforcement on `inspectedTemplateIds`
- Discriminator: `allowed: true` requires `disclosureTemplateId`; `allowed: false` requires `reason`
- `effectiveTo: null` accepted; `effectiveTo === effectiveFrom` rejected (zero-length); `effectiveTo < effectiveFrom` rejected (inverted)
- `version: 0` rejected (min 1); empty `text` rejected; `text > 2000 chars` rejected
- `DisclosureResolutionRejectionReasonSchema` accepts both enum values, rejects `"other"`

### 5.3 Seed-shape tests — `disclosure-seed.test.ts` (~8 tests)

- Exactly 48 rows
- Cartesian-product coverage: every `(jurisdictionCode, platform, treatmentClass)` appears exactly once
- Every row's `id` matches `^disclosure-template-(SG|MY|HK)-(meta|tiktok|red|youtube_shorts)-(med_spa|dental|anti_ageing|halal_wellness)-v\d+$`
- Every row's `text` starts with `PLACEHOLDER_DISCLOSURE_PREFIX`
- Every row's `text` echoes its own tuple as substring (e.g. `SG/meta/med_spa`)
- Every row: `version === 1`, `effectiveFrom.toISOString() === "2026-01-01T00:00:00.000Z"`, `effectiveTo === null`
- `DisclosureTemplatePayloadSchema.parse()` accepts every row
- `isPlaceholderDisclosureText(row.text)` returns `true` for every row

### 5.4 Anti-pattern tests — `sp14-anti-patterns.test.ts` (5 assertions)

1. **Single-source version pin.** The literal `"pcd-disclosure-resolver@"` appears in exactly ONE non-test source file across `packages/`: `disclosure-resolver-version.ts`. Stricter than SP13's two-file allowance.
2. **Single-source placeholder prefix.** The literal `"[DISCLOSURE_PENDING_LEGAL_REVIEW:"` appears in exactly ONE non-test source file: `disclosure-placeholder.ts`. Seed and consumers import the symbol.
3. **Resolver purity.** Sources under `pcd/disclosure/` (excluding tests AND `disclosure-seed.ts`) contain no `Date.now()`, no `new Date(`, no `Math.random()`, no `import.*crypto|@creativeagent/db|@prisma/client|inngest|node:fs|http|https`. `disclosure-seed.ts` is allowed exactly one `new Date("2026-01-01T00:00:00Z")` literal (allowlisted as exact substring).
4. **No-wildcard guarantee — seed values only.** Programmatic iteration over `DISCLOSURE_TEMPLATE_SEED`: every row's `id`, `jurisdictionCode`, `platform`, `treatmentClass`, and `text` is asserted free of word-boundary matches against `\b(default|catch_all|wildcard|global|fallback)\b`. Resolver source code is NOT scanned for these tokens (J5).
5. **No cross-slice tokens in source.** Sources under `pcd/disclosure/` contain no occurrence of: (SP13) `SyntheticCreatorSelectionDecision`, `selectedCreatorIdentityId`, `fallbackCreatorIdentityIds`, `creatorIdentityId`, `selectedLicenseId`, `selectorRank`, `selectorVersion`; (SP15+) `ScriptTemplate`, `script_template`, `PcdPerformanceSnapshot`, `performance_snapshot`, `metricsSnapshotVersion`, `qc_face`, `face_descriptor`. SP14 source cannot even look like it knows about creator selection (Q15).

### 5.5 Reader integration tests — `prisma-disclosure-template-reader.test.ts` (~5 tests, mocked Prisma)

Per `feedback_api_test_mocked_prisma` precedent — CI has no Postgres; mock the Prisma client.

- `listByTuple` returns rows matching tuple (Prisma `findMany` mock seeded with mixed rows)
- `listByTuple` returns empty array for non-matching tuple
- Field mapping: Prisma row strings → zod-parsed `DisclosureTemplatePayload` (parse-at-the-edges)
- Returned rows pass `DisclosureTemplatePayloadSchema.parse()` (round-trip integrity)
- Reader does not call `prisma.disclosureTemplate.create` / `update` / `upsert` / `delete` (read-only enforcement; assert mock was not called for those methods)

### 5.6 Allowlist maintenance

Per SP10A / SP10B / SP10C / SP11 / SP12 / SP13 precedent, the following frozen-source-body allowlists are extended with SP14's net-new files:

- `sp9-anti-patterns.test.ts` (provenance freeze)
- `sp10a-anti-patterns.test.ts` (cost-forecast freeze)
- `sp10b-anti-patterns.test.ts` (tree-budget freeze)
- `sp10c-anti-patterns.test.ts` (cost-budget freeze)
- `sp11-anti-patterns.test.ts` (synthetic-creator freeze)
- `sp12-anti-patterns.test.ts` (license-gate freeze)
- `sp13-anti-patterns.test.ts` (selector freeze)

Net-new files to allowlist:

- `packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-seed.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/disclosure-seed.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/disclosure/index.ts`
- `packages/schemas/src/pcd-disclosure-template.ts`
- `packages/schemas/src/__tests__/pcd-disclosure-template.test.ts`
- `packages/schemas/src/index.ts` (already widened multiple times — single-line union-add)
- `packages/creative-pipeline/src/index.ts` (already widened multiple times)
- `packages/db/src/stores/prisma-disclosure-template-reader.ts`
- `packages/db/src/stores/prisma-disclosure-template-reader.test.ts`
- `packages/db/src/index.ts`

Each prior anti-pattern test gets a one-line addition. Same fix-up commit pattern as every prior slice.

### 5.7 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: prior pass count (1758 + 2 skipped from SP13 merge) + ~50 SP14 net new tests = **~1808 passing**, 2 skipped unchanged.
- Prettier check (the project lint gate per SP5 baseline). The 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over; SP14 introduces no new prettier warnings.
- `pnpm db:check-drift` against the new migration. Per `feedback_prisma_migrate_dev_tty`, generate the migration SQL non-interactively via `prisma migrate diff --from-empty --to-schema-datamodel --script` rather than `migrate dev`.

---

## 6. Merge-back to Switchboard

Strictly additive:

- **One new Prisma model**: `DisclosureTemplate`. Zero changes to any existing model.
- **One new schemas file**: `pcd-disclosure-template.ts`. One-line union-add to `packages/schemas/src/index.ts`.
- **One new db reader**: `prisma-disclosure-template-reader.ts`. One-line re-export in `packages/db/src/index.ts`. No new store.
- **One new creative-pipeline subdir**: `pcd/disclosure/` (8 files). One-line union-add to `packages/creative-pipeline/src/index.ts`.
- **Zero edits** to existing SP1–SP13 source bodies. The only cross-slice touches are 7 prior anti-pattern tests' allowlist widening.
- **Sed-pass `@creativeagent/*` → `@switchboard/*`** continues to work mechanically.
- **No imports outside the PCD scope**.

**`// MERGE-BACK:` markers** (six, on the listed declarations):

1. **`isPlaceholderDisclosureText`** (in `disclosure-placeholder.ts`) — "Production render paths MUST guard with this predicate. Any rendered ad emitting text where this returns true is a compliance bug. SP14 publishes the predicate; render-time throw is SP21+'s responsibility."
2. **`DISCLOSURE_TEMPLATE_SEED`** (in `disclosure-seed.ts`) — "Replace with real legal-authored copy before Switchboard production launch. Seed is dev/test only. Production launch requires a separate legal-authoring pass; do NOT promote placeholder rows."
3. **`resolveDisclosure` declaration** (in `disclosure-resolver.ts`) — "Caller (SP21 composer or equivalent) supplies the templates snapshot via `PrismaDisclosureTemplateReader.listByTuple(...)`. SP14 itself never reads. Mirrors SP12 `licenseGate(leases)` / SP13 `selectSyntheticCreator(roster, leases)` snapshot pattern."
4. **Top of `prisma-disclosure-template-reader.ts`** — "Reader-only by design. Writer interface deliberately deferred. Future legal-authoring CLI/admin tool should ship explicit `createTemplateVersion(payload)` and `supersedeTemplateVersion(id, supersededAt)` operations — NOT a generic `upsert`. Generic upsert is the wrong semantics for regulated copy: it normalises overwriting legal-approved rows."
5. **`PCD_DISCLOSURE_RESOLVER_VERSION`** (in `disclosure-resolver-version.ts`) — "Pinned 18th PCD constant. Resolver-logic version, distinct from registry row's per-tuple `version: int`. Switchboard merge does not change this literal; bumping it requires a coordinated provenance-replay assessment."
6. **`DisclosureResolutionDecision` zod schema** (in `pcd-disclosure-template.ts`) — "Decision struct is zod-only in SP14. Persistence is SP17's responsibility (SP9 provenance widen). SP17 will add `disclosureResolutionId` and/or `(disclosureTemplateId + disclosureTemplateVersion)` to `PcdIdentitySnapshot`. Whether SP17 also persists `resolvedDisclosureText` (the full rendered text) is a separate decision for SP17 to make — persisting templateId + version may be enough, and avoids duplicating legal text into provenance rows."

---

## 7. Out-of-scope (explicit)

Carried forward from the umbrella roster design §11 and narrowed for SP14:

- **Real disclosure copy authorship** — legal/ops workflow. SP14 seeds placeholders only.
- **Writer/store**: `DisclosureTemplateStore`, `upsertVersion`, `createTemplateVersion`, `supersedeTemplateVersion`. Deferred per YAGNI and regulated-copy semantics.
- **Reader `listAll`** — deferred per the same discipline. SP21 composer uses `listByTuple` only.
- **Render-time placeholder enforcement** — SP21+ composer or render path owns the throw. SP14 publishes the predicate.
- **Provenance persistence of `DisclosureResolutionDecision`** — SP17 owns the SP9 widen.
- **SP13 selection-decision composition** — SP21 composer joins SP13 + SP14 (+ SP15) decisions.
- **Script selection (SP15), provider routing (SP16), QC face-match (SP20).**
- **Performance overlay re-rank (SP19)** and `PcdPerformanceSnapshot` (SP18).
- **Wildcard / catch-all / cascade fallback rows** (per Q7).
- **Per-clinic or per-creator disclosure overrides** — umbrella §11 (clinic-supplied overrides reserved for v1.5).
- **Multi-language / localised text within a jurisdiction** — single-language-per-cell in v1.
- **Real Postgres in unit tests** — mocked Prisma per repo convention (`feedback_api_test_mocked_prisma`).
- **Pagination / chunked listing** — registry is small in v1.
- **Inngest or async job integration**.
- **Admin UI / audit dashboard**.
- **SP21 composer wiring tests** — SP14 ships SP14-bounded tests only.

---

## 8. Open questions / known unknowns

- **U1: Should `disclosureText` live on the decision struct, or only `disclosureTemplateId + templateVersion`?** SP14 includes the text on the success branch (J1). Argument for: downstream consumer (SP21 render path) doesn't need a second registry read to obtain the text. Argument against: duplicates content into the decision struct that already exists in the templates snapshot. Decision: **include**. The decision struct is short-lived (zod-only, not persisted in SP14); duplication is contained. SP17 will independently decide whether to persist the text into provenance (per marker #6).
- **U2: Should the resolver echo `effectiveFrom` / `effectiveTo` of the winning row into the decision struct?** Reserved for future forensic richness. Decision: **No** in SP14. The `disclosureTemplateId` is sufficient; downstream re-reads if it needs the window. Avoids decision-struct bloat.
- **U3: Should there be a `resolverDecisionId` (uuid) on the decision struct?** SP13 explicitly chose no for pure-decider purity (would break determinism). Same answer here: **No**. SP17 will mint a persistence-time id if needed.
- **U4: When SP15 ships, does its `ScriptTemplate` resolver compose with SP14's `resolveDisclosure`?** Open. SP21 composer is the join point per current design; SP15 may want to read disclosure for script-text concatenation reasons. Defer to SP15 design.
- **U5: Is `inspectedTemplateIds` useful enough to keep when SP17 ships?** SP14 includes it for ops forensics. If SP17 persistence layer finds it noisy, it can drop it from the persisted shape while the zod decision struct keeps it for in-process use. No change needed in SP14.

---

## 9. Implementation slicing (preview, not the plan)

The SP14 plan will be written next via `writing-plans`. Anticipated task list, TDD-paced (one test commit per task):

| # | Task | Approx tests |
|---|---|---|
| 1 | New `pcd-disclosure-template.ts` zod schema + co-located test | ~10 |
| 2 | New `disclosure-resolver-version.ts` constant (18th pinned) | — |
| 3 | New `disclosure-placeholder.ts` constant + predicate + tests | ~3 |
| 4 | Prisma `DisclosureTemplate` model + migration SQL via `prisma migrate diff --from-empty --to-schema-datamodel --script` | — (db:check-drift gates) |
| 5 | New `PrismaDisclosureTemplateReader.listByTuple` + reader tests | ~5 |
| 6 | New `disclosure-seed.ts` (48 rows) + seed-shape tests | ~8 |
| 7 | New `disclosure-resolver.ts` skeleton — empty `resolveDisclosure` returning stub failure (lands file + import surface) | — |
| 8 | Tuple-matching filter + tests | ~5 |
| 9 | Window-boundary filter + boundary tests | ~5 |
| 10 | Version-tiebreak comparator (`version` DESC, `id` ASC) + tests | ~5 |
| 11 | `inspectedTemplateIds` ordering (`id` ASC) + test | ~2 |
| 12 | Pin invariant + determinism tests | ~5 |
| 13 | `sp14-anti-patterns.test.ts` — 5 assertions (incl. SP13 token blacklist) | ~5 |
| 14 | Allowlist-maintenance fix-up — widen 7 prior anti-pattern test allowlists | — |
| 15 | Barrel re-exports + cross-package barrels | — |
| 16 | Final full-repo typecheck + test + prettier sweep | — |

Estimated: **~15–17 commits** on the branch, squashed to **1 PR** against `main`.

**Worktree:** `.worktrees/sp14`. Every implementer subagent prompt opens with `pwd` + `git branch --show-current` and refuses to proceed if the path/branch doesn't match — per the SP13-subagent-wrong-worktree lesson.

---

*End of design spec. Awaiting user review per brainstorming skill review gate before transitioning to writing-plans.*
