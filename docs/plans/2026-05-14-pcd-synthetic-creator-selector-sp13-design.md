# PCD SP13 — Synthetic Creator Selector — Design Spec

**Date:** 2026-05-14
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (brainstorming session)
**Predecessor slices:** SP11 (synthetic-creator foundation, `3b3d291`), SP12 (license gate, `13ee16d`)
**Successor slices reserved by name:** SP14 (disclosure registry), SP15 (script templates), SP16 (provider-routing extension for synthetic), SP17 (SP9 provenance extension), SP18 (`PcdPerformanceSnapshot`), SP19 (performance overlay re-rank), SP20 (synthetic QC face-match), SP21 (end-to-end integration)

---

## 1. Scope & Strategy

The synthetic-creator track up to this point has built the data (SP11) and the per-clinic licensing layer (SP12). SP13 introduces the **first allocator** for that pool: a pure deterministic function that, given a `CreativeBrief` and a snapshot of the roster + leases, picks ONE synthetic creator for the job.

Per the umbrella roster design doc (`2026-04-30-pcd-synthetic-creator-roster-design.md`) §1–§4, the selector is the **Allocation engine** in the five-layer model (Creator → Script → **Selector** → License → Performance). SP13 lights up that layer in its minimum-viable form:

- Compatible-set filter only (no performance overlay — that is SP19's job).
- License gate baked in as a hard pre-filter (the SP12 contract).
- Returns the surviving ranked list as `selected + fallbacks` so future overlay re-rank can re-order the same pool without changing the call site.

What SP13 deliberately does NOT do:

- No disclosure resolution (SP14).
- No script selection (SP15).
- No provider routing (SP16).
- No SP9 provenance extension to persist the decision id (SP17).
- No `PcdPerformanceSnapshot` reads, no `metricsSnapshotVersion` consumption beyond passthrough (SP18+SP19).
- No QC face-match (SP20).
- No real model runners.
- **No Prisma migration.** The selector is pure logic; the decision struct is zod-only. Persistence of `SyntheticCreatorSelectionDecision` is reserved for the SP17 provenance widen.
- **No multi-character casts.** `mutuallyExclusiveWithIds` is preserved in the input snapshot but is informational in SP13 — single-pick semantics mean it cannot trigger.
- **No new readers, no DB-package edits.** Caller supplies the roster + leases snapshot, mirroring SP12's `licenseGate(leases)` precedent.

---

## 2. Locked decisions (from brainstorming + user-spec)

### 2.1 User-locked invariants (settled in brief)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Selector returns primary + fallback chain.** Discriminated-union decision shape with `selectedCreatorIdentityId` and `fallbackCreatorIdentityIds: string[]`. | Mirrors design doc §3.7 `SyntheticCreatorSelectionDecision` verbatim. Shape-additive for SP19 overlay re-rank. |
| Q2 | **Zero-result is a discriminated-union failure, not a throw.** `{ allowed: false, reason: "no_compatible_candidates" \| "all_blocked_by_license", ... }`. | Mirrors SP2 / SP12 / SP10A pure-gate precedent. Throw is reserved for abort-authority orchestrators (SP10B, SP10C); a pure selector returns a decision. Reason channel preserves operational forensic value. |
| Q3 | **Per-candidate `licenseGate()` call.** For each compatible candidate, invoke SP12's `licenseGate({creatorIdentityId, clinicId, market, treatmentClass, now, leases})`. Filter to `allowed: true`. | Re-uses SP12 as a black box; single source of truth for lock-type semantics. N ≤ roster size (10 in SP11 v1) × pure function = no perf concern. |
| Q4 | **Caller-supplied roster + leases snapshot.** Input shape: `{ brief, now, roster: readonly RosterEntry[], leases: readonly CreatorIdentityLicensePayload[] }`. | Matches SP12 `leases` snapshot precedent. Pure deterministic. No reader, no async, no `@creativeagent/db` / `@prisma/client` imports. Anti-pattern test enforces. |
| Q5 | **Tie-break = SP12 `pickStrongest` semantics across candidates' gate-returned licenses, with final tie on `creatorIdentityId` ASC.** Order: `lockType` strength → `priorityRank` ASC → `effectiveFrom` ASC → `creatorIdentityId` ASC. | Reuses SP12 ordering rule. Final tie shifts from `license.id` (SP12 picks among leases) to `creatorIdentityId` (SP13 picks among creators) — semantically correct, still deterministic, still replayable. |

### 2.2 Judgment calls baked into this spec (open to push-back)

| # | Decision | Rationale |
|---|---|---|
| J1 | **Compatible-set hard filters = exact match on `{ treatmentClass, market, targetVibe, targetEthnicityFamily, targetAgeBand, pricePositioning }` plus `status === "active"`.** | The brief carries explicit `target*` fields; treating them as soft would silently surprise the caller. If callers want fuzzy matching, they pre-process. Hard-match is safest v1 default; broader fan-out is an additive future change. |
| J2 | **`hardConstraints: string[]` recorded but NOT filtered in v1.** The selector echoes them into the decision struct's `decisionReason` payload for forensics, but does not interpret them. | SP13 does not own the constraint vocabulary; SP14+ (disclosure, script-template, QC) own their respective constraint surfaces. Filtering on opaque strings now would lock semantics prematurely. |
| J3 | **`mutuallyExclusiveWithIds` is ignored in v1.** It is a same-campaign multi-cast concern (Nana ↔ Bua); SP13 is single-pick. | Multi-character casts are out-of-scope per design doc §11. The field is preserved in the snapshot (caller supplies the full SP11 `RosterEntry`); SP13 just doesn't read it. Documented in source. |
| J4 | **`selectorRank: 0` always in SP13.** The fallback chain is the ranked tail; downstream may walk it but SP13 has already license-pre-filtered. | Without an overlay, every survivor is already a valid choice — the gate is the only filter. SP19 will populate `metricsSnapshotVersion` and re-rank; until then, `selectorRank` is structurally always 0. |
| J5 | **`metricsSnapshotVersion: null` and `performanceOverlayApplied: false` in SP13.** Field is reserved in the schema for SP19. | Composer-only pin precedent applies (`PCD_SELECTOR_VERSION` is pinned by the selector module; metrics-snapshot version is caller-supplied passthrough when SP19 wires it). |
| J6 | **17th PCD pinned constant: `PCD_SELECTOR_VERSION = "pcd-selector@1.0.0"`.** Lives in `pcd/selector/selector-version.ts`; the literal is imported only by `pcd/selector/selector.ts`. Anti-pattern test enforces composer-only pin. | Same precedent as SP2 (tier-policy), SP3 (shot-spec), SP9 (provenance), SP10A (cost-forecast), SP10B (tree-budget), SP10C (cost-budget), SP12 (license-gate). |
| J7 | **No Prisma migration.** Decision struct is zod-only; persistence is SP17's responsibility. | The SP12 license-gate slice also added no migration outside SP12's own `CreatorIdentityLicense` table. SP13 is pure logic — no new table, no new column. |
| J8 | **Subdir = `packages/creative-pipeline/src/pcd/selector/`.** Sibling to `pcd/synthetic-creator/`, `pcd/cost-budget/`, etc. | Matches the per-slice subdir convention established from SP9 onward. SP12 used the slightly older `pcd/synthetic-creator/license-gate.{ts,test.ts}` flat-file layout because it shared a subdir with the SP11 roster; SP13's selector is a distinct concern and lives in its own dir. |

---

## 3. Module Surface

### 3.1 New zod schema file: `packages/schemas/src/pcd-synthetic-selector.ts`

```ts
import { z } from "zod";
import {
  CreatorIdentityLicensePayloadSchema,
  LockTypeSchema,
} from "./creator-identity-license.js";
// (reuses existing CreativeBriefSchema from creative-brief.ts; no widen.)

export const SyntheticCreatorSelectorRejectionReasonSchema = z.enum([
  "no_compatible_candidates",
  "all_blocked_by_license",
]);
export type SyntheticCreatorSelectorRejectionReason = z.infer<
  typeof SyntheticCreatorSelectorRejectionReasonSchema
>;

export const SyntheticCreatorSelectionDecisionSchema = z
  .discriminatedUnion("allowed", [
    z
      .object({
        allowed: z.literal(true),
        briefId: z.string().min(1),
        selectedCreatorIdentityId: z.string().min(1),
        fallbackCreatorIdentityIds: z.array(z.string().min(1)).readonly(),
        selectedLicenseId: z.string().min(1),
        selectedLockType: LockTypeSchema,
        isSoftExclusivityOverride: z.boolean(),
        selectorVersion: z.string().min(1),     // pinned to PCD_SELECTOR_VERSION by the selector
        selectorRank: z.literal(0),             // SP13: always 0 (no overlay)
        metricsSnapshotVersion: z.string().min(1).nullable(),  // SP13: null
        performanceOverlayApplied: z.literal(false),           // SP13: false
        decisionReason: z.string().min(1).max(2000),
      })
      .readonly(),
    z
      .object({
        allowed: z.literal(false),
        briefId: z.string().min(1),
        reason: SyntheticCreatorSelectorRejectionReasonSchema,
        compatibleCandidateIds: z.array(z.string().min(1)).readonly(),
        blockedCandidateIds: z.array(z.string().min(1)).readonly(),
        selectorVersion: z.string().min(1),
      })
      .readonly(),
  ])
  .readonly();
export type SyntheticCreatorSelectionDecision = z.infer<
  typeof SyntheticCreatorSelectionDecisionSchema
>;
```

Notes:
- `.readonly()` on every object + array — matches SP10B's `PreproductionTreeBudget` precedent and SP12's `CreatorIdentityLicensePayload` precedent.
- `selectorRank: z.literal(0)` and `performanceOverlayApplied: z.literal(false)` use literal-narrowing to enforce SP13 invariants at the schema level. SP19 will widen these.
- `blockedCandidateIds` (rejection branch) is the SP13-specific forensic channel: when every compatible candidate is gate-rejected, the caller sees which creators were blocked and can investigate.
- `compatibleCandidateIds` on the rejection branch equals `blockedCandidateIds` when reason is `all_blocked_by_license`, and is empty when reason is `no_compatible_candidates`. Asymmetry is intentional — keeps the two failure cases distinguishable without a second discriminator.

### 3.2 New version constant: `packages/creative-pipeline/src/pcd/selector/selector-version.ts`

```ts
export const PCD_SELECTOR_VERSION = "pcd-selector@1.0.0";
```

**Composer-only pinning lock** (per SP9 / SP10A / SP10B / SP10C / SP12 precedent):
- The literal `"pcd-selector@"` appears in **only two source files**: this constant file, and `selector.ts` (which imports the constant and writes it into the decision struct).
- Anti-pattern test enforces a grep across all non-test sources for any other occurrence of the literal.

### 3.3 New pure selector module: `packages/creative-pipeline/src/pcd/selector/selector.ts`

```ts
// PCD slice SP13 — pure deterministic synthetic-creator selector.
// Mirrors SP12 license-gate shape: typed input record, no I/O, no clock
// reads — caller supplies `now`, the roster snapshot, and the leases
// snapshot. Invoked at job-creation time per design spec §4 step 2-4.
//
// The selector composes SP12's licenseGate as a hard pre-filter: every
// compatible candidate is run through the gate; only allowed:true
// candidates survive. Survivors are ranked using SP12 pickStrongest
// semantics across their gate-returned licenses, with creatorIdentityId
// ASC as the final tie-break.
//
// No performance overlay in SP13 — `metricsSnapshotVersion` and
// `performanceOverlayApplied` are reserved fields for SP19.

import {
  type CreativeBrief,
  type CreatorIdentityLicensePayload,
  type SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import type { RosterEntry } from "../synthetic-creator/seed.js";
import { licenseGate } from "../synthetic-creator/license-gate.js";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

export type SelectSyntheticCreatorInput = {
  brief: CreativeBrief;
  now: Date;
  roster: readonly RosterEntry[];
  leases: readonly CreatorIdentityLicensePayload[];
};

export function selectSyntheticCreator(
  input: SelectSyntheticCreatorInput,
): SyntheticCreatorSelectionDecision {
  // Step 1 — compatible-set filter (hard exact-match on brief targets).
  const compatible = input.roster.filter((entry) =>
    isCompatible(entry, input.brief),
  );

  if (compatible.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_candidates",
      compatibleCandidateIds: [],
      blockedCandidateIds: [],
      selectorVersion: PCD_SELECTOR_VERSION,
    };
  }

  // Step 2 — per-candidate license gate. Keep only allowed:true.
  const candidateDecisions = compatible.map((entry) => ({
    entry,
    gate: licenseGate({
      creatorIdentityId: entry.creatorIdentity.id,
      clinicId: input.brief.clinicId,
      market: input.brief.market,
      treatmentClass: input.brief.treatmentClass,
      now: input.now,
      leases: input.leases,
    }),
  }));

  const allowed = candidateDecisions.filter((c) => c.gate.allowed === true);
  const blocked = candidateDecisions.filter((c) => c.gate.allowed === false);

  if (allowed.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_blocked_by_license",
      compatibleCandidateIds: compatible.map((e) => e.creatorIdentity.id),
      blockedCandidateIds: blocked.map((c) => c.entry.creatorIdentity.id),
      selectorVersion: PCD_SELECTOR_VERSION,
    };
  }

  // Step 3 — rank survivors by gate-returned license strength.
  const ranked = [...allowed].sort(compareCandidates);
  const primary = ranked[0]!;     // non-empty by check above
  const fallbacks = ranked.slice(1);

  // Step 4 — emit decision. `selectedLicenseId` is the license the gate
  // returned for `primary` (guaranteed non-null since gate.allowed === true).
  return {
    allowed: true,
    briefId: input.brief.briefId,
    selectedCreatorIdentityId: primary.entry.creatorIdentity.id,
    fallbackCreatorIdentityIds: fallbacks.map((c) => c.entry.creatorIdentity.id),
    selectedLicenseId: primary.gate.license!.id,
    selectedLockType: primary.gate.license!.lockType,
    isSoftExclusivityOverride: primary.gate.isSoftExclusivityOverride!,
    selectorVersion: PCD_SELECTOR_VERSION,
    selectorRank: 0,
    metricsSnapshotVersion: null,
    performanceOverlayApplied: false,
    decisionReason: buildDecisionReason(input.brief, primary, fallbacks.length),
  };
}
```

Supporting predicate + comparator (in same file, omitted from this surface for brevity — covered by Section 4 implementation detail).

### 3.4 Barrel exports

- `packages/creative-pipeline/src/pcd/selector/index.ts` — re-exports `selectSyntheticCreator`, `PCD_SELECTOR_VERSION`, `SelectSyntheticCreatorInput`.
- `packages/creative-pipeline/src/index.ts` — adds `export * from "./pcd/selector/index.js"`.
- `packages/schemas/src/index.ts` — adds re-export of `pcd-synthetic-selector.ts`.

---

## 4. Algorithm Details

### 4.1 Compatible-set predicate

```
isCompatible(entry, brief):
  s = entry.synthetic
  return s.status === "active"
     AND s.treatmentClass === brief.treatmentClass
     AND s.market === brief.market
     AND s.vibe === brief.targetVibe
     AND s.ethnicityFamily === brief.targetEthnicityFamily
     AND s.ageBand === brief.targetAgeBand
     AND s.pricePositioning === brief.pricePositioning
```

Six hard equality checks plus `status === "active"`. No fuzzy match, no scoring. `hardConstraints` and `mutuallyExclusiveWithIds` are intentionally absent — see §2.2 J2 / J3.

### 4.2 Candidate comparator

```
compareCandidates(a, b):
  la = a.gate.license   // non-null since gate.allowed === true
  lb = b.gate.license
  ra = LOCK_TYPE_RANK[la.lockType]   // 0/1/2 same as SP12
  rb = LOCK_TYPE_RANK[lb.lockType]
  if ra ≠ rb: return ra - rb

  if la.lockType === "priority_access" AND lb.lockType === "priority_access":
    pa = la.priorityRank ?? MAX_SAFE_INTEGER
    pb = lb.priorityRank ?? MAX_SAFE_INTEGER
    if pa ≠ pb: return pa - pb

  if la.effectiveFrom.getTime() ≠ lb.effectiveFrom.getTime():
    return la.effectiveFrom.getTime() - lb.effectiveFrom.getTime()

  // FINAL tie-break: creator id ASC (NOT license id — SP13 picks creators).
  cidA = a.entry.creatorIdentity.id
  cidB = b.entry.creatorIdentity.id
  return cidA < cidB ? -1 : cidA > cidB ? 1 : 0
```

Note: identical to SP12's `pickStrongest` **except** the final tie-break uses `creatorIdentityId` instead of `license.id`. This is the only semantic deviation from SP12 and is documented in code with a `// SP13-vs-SP12: …` comment.

### 4.3 `buildDecisionReason`

Returns a short human-readable string for forensics. Examples:
- `"primary_compatible (4 survivors, 2 license-blocked)"`
- `"primary_compatible (1 survivor, no fallbacks)"`
- `"primary_compatible (hardConstraints=[\"no_pregnancy\", \"halal_only\"])"` — when `hardConstraints` is non-empty, echo it into the reason for forensic trail. Max 2000 chars per schema.

`hardConstraints` echoing is the only place SP13 touches `brief.hardConstraints`; it does NOT filter on it.

### 4.4 Determinism guarantees

Given identical `(brief, now, roster, leases)`:
- Step 1 is pure JS `.filter()` over a `readonly` array — order-stable.
- Step 2 calls `licenseGate` which is itself pure (SP12 invariant).
- Step 3 `.sort()` with a total-order comparator — order-stable.
- Step 4 reads only ranked array indices.

Replay: `(briefId, selectorVersion, leases-snapshot, roster-snapshot)` → identical `SyntheticCreatorSelectionDecision`. Anti-pattern test asserts no `Date.now()`, no `new Date()`, no `Math.random()`, no `crypto`.

---

## 5. Test Strategy

### 5.1 Unit tests — `selector.test.ts` (~25–30 tests)

Table-driven coverage:

**Compatible-set filter:**
- Roster of 10 (SP11 seed) + brief matching exactly Cheryl → `{ Cheryl }`.
- Brief with no-match vibe → `no_compatible_candidates`.
- Brief with no-match market → `no_compatible_candidates`.
- Brief with no-match treatmentClass → `no_compatible_candidates`.
- Brief with no-match pricePositioning → `no_compatible_candidates`.
- Brief with no-match ethnicityFamily → `no_compatible_candidates`.
- Brief with no-match ageBand → `no_compatible_candidates`.
- Status `retired` on otherwise-compatible candidate → filtered.

**License gate composition:**
- Compatible candidate with active `priority_access` lease for requesting clinic → allowed, selected, rank 0.
- Compatible candidate with no lease → blocked, in `blockedCandidateIds`.
- Compatible candidate with competing `hard_exclusive` from another clinic → blocked.
- Compatible candidate with expired lease → blocked, reason recorded via gate.
- All compatible candidates blocked → `all_blocked_by_license`, `compatibleCandidateIds` non-empty.
- Mixed: 3 compatible, 1 allowed + 2 blocked → allowed wins, fallback chain empty, `blockedCandidateIds.length === 2` only present on the failure branch (not on success — success branch omits this field).

**Ranking / tie-break:**
- Two allowed candidates with `hard_exclusive` vs `priority_access` → hard wins.
- Two allowed candidates both `priority_access`, ranks 5 vs 10 → rank 5 wins.
- Two allowed candidates both `priority_access`, same rank, different `effectiveFrom` → older wins.
- Two allowed candidates both `priority_access`, same rank, same `effectiveFrom` → `creatorIdentityId` ASC wins.
- Two allowed candidates both `soft_exclusive`, both with override flag bubbled — verify `isSoftExclusivityOverride` propagates from `primary.gate`.

**Soft-exclusive override propagation:**
- Selected candidate's gate decision has `isSoftExclusivityOverride: true` → decision struct carries `true`.

**hardConstraints echo:**
- Brief with `hardConstraints: ["a", "b"]` and one compatible candidate → decision struct's `decisionReason` contains the constraints string (substring assertion).
- Brief with `hardConstraints: []` → `decisionReason` does not contain a `hardConstraints=` substring.

**Pinning lock:**
- `selectorVersion` always equals `PCD_SELECTOR_VERSION` literal in every success and failure branch.

**Determinism:**
- Call `selectSyntheticCreator` twice with identical input → byte-equal decisions.
- Shuffle input `roster` order → same selected creator.
- Shuffle input `leases` order → same selected creator + same `selectedLicenseId`.

### 5.2 Schema tests — `pcd-synthetic-selector.test.ts` (~6–10 tests)

- Round-trip parse on both branches.
- `.readonly()` array assertions.
- Discriminator: `allowed: true` requires `selectedCreatorIdentityId`; `allowed: false` requires `reason`.
- `selectorRank: 0` literal-narrowing rejects `1`.
- `performanceOverlayApplied: false` literal-narrowing rejects `true`.
- `metricsSnapshotVersion` accepts string OR null.

### 5.3 Anti-pattern test — `sp13-anti-patterns.test.ts`

Five structural grep assertions, mirroring SP10C / SP12 precedent. Source set: every `.ts` file under `pcd/selector/` excluding tests.

1. **Composer-only version pinning.** The literal `"pcd-selector@"` appears in exactly two files: `selector-version.ts` and `selector.ts`. Zero other occurrences anywhere in `packages/`.
2. **Purity.** No `Date.now()`, no `new Date(`, no `Math.random()`, no `import.*crypto`, no `import.*@creativeagent/db`, no `import.*@prisma/client`, no `import.*inngest`, no `import.*node:fs|http|https`.
3. **Compatible-set filter coverage.** The selector source contains exact-equality comparisons on all six brief fields (`treatmentClass`, `market`, `vibe`, `ethnicityFamily`, `ageBand`, `pricePositioning`) plus `status === "active"`. Grep asserts presence; protects against silently dropping a filter dimension.
4. **Gate-call discipline.** `selector.ts` contains the literal `licenseGate(` call. Asserts the selector actually invokes SP12 rather than re-implementing the lock-type logic.
5. **No downstream-slice tokens.** No occurrence of `DisclosureTemplate`, `disclosure_template`, `ScriptTemplate`, `script_template`, `PcdPerformanceSnapshot`, `performance_snapshot`, `metricsSnapshotVersion`-as-string-literal-not-field-name (the field-name `metricsSnapshotVersion` is allowed because the SP13 schema includes it as a reserved slot; the test uses a narrower regex that excludes that one occurrence). Forbids SP14–SP18 leakage into SP13 source.

### 5.4 Allowlist maintenance

Per SP10A / SP10B / SP10C / SP11 / SP12 precedent, the following anti-pattern tests' frozen-source-body allowlists are extended with SP13's net-new files:

- `sp9-anti-patterns.test.ts` (provenance freeze)
- `sp10a-anti-patterns.test.ts` (cost-forecast freeze)
- `sp10b-anti-patterns.test.ts` (tree-budget freeze)
- `sp10c-anti-patterns.test.ts` (cost-budget freeze)
- `sp11-anti-patterns.test.ts` (synthetic-creator freeze)
- `sp12-anti-patterns.test.ts` (license-gate freeze)

Net-new files to allowlist:
- `packages/creative-pipeline/src/pcd/selector/selector.ts`
- `packages/creative-pipeline/src/pcd/selector/selector-version.ts`
- `packages/creative-pipeline/src/pcd/selector/selector.test.ts`
- `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`
- `packages/creative-pipeline/src/pcd/selector/index.ts`
- `packages/schemas/src/pcd-synthetic-selector.ts`
- `packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts`
- `packages/schemas/src/index.ts` (already widened multiple times — single-line union-add)
- `packages/creative-pipeline/src/index.ts` (already widened multiple times)

Each prior anti-pattern test gets a one-line addition to its allowlist/skip-prefix list. Same fix-up commit pattern as SP10B → SP10A widening and SP11 → SP9/SP10A widening.

### 5.5 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: prior pass count (1711 + 2 skipped from SP10C merge) + ~35–45 SP13 net new tests = ~1746–1756 passing.
- Prettier check (the project lint gate per SP5 baseline). The 2 SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over; SP13 introduces no new prettier warnings.

---

## 6. Merge-back to Switchboard

Strictly additive:

- **No schema migration.** Selector is pure logic. The `SyntheticCreatorSelectionDecision` is zod-only — when SP17 lights up provenance, it will widen `PcdIdentitySnapshot` with `selectionDecisionId` or equivalent and choose a persistence shape then.
- **Packages affected:**
  - `packages/schemas/`: one new file (`pcd-synthetic-selector.ts`), one barrel re-export line in `index.ts`.
  - `packages/creative-pipeline/`: one new subdir (`pcd/selector/`), one barrel re-export line in `index.ts`.
  - `packages/db/`: **zero changes.**
- **Sed-pass for `@creativeagent/*` → `@switchboard/*`** still works mechanically. No new package boundaries.
- **No imports from outside the PCD scope** introduced. Selector imports `RosterEntry` from `pcd/synthetic-creator/seed.ts` (SP11 surface) and `licenseGate` from `pcd/synthetic-creator/license-gate.ts` (SP12 surface) — both already inside PCD.
- **`// MERGE-BACK:` markers:**
  - 1 marker on `selectSyntheticCreator` declaration noting the caller-supplied snapshot pattern and that Switchboard's eventual composer should pull the roster + leases via Prisma readers before calling.
  - 1 marker on the `selectorRank: 0` literal noting SP19 will widen this slot when the overlay re-rank lights up.
  - 1 marker on `metricsSnapshotVersion: null` noting SP19 will pin a real value when overlay reads `PcdPerformanceSnapshot` (SP18).

---

## 7. Out-of-scope (explicit)

Carried forward from the umbrella roster design §11 and narrowed for SP13:

- Performance overlay re-rank (SP19).
- `PcdPerformanceSnapshot` table and `MetricsAggregator` job (SP18).
- Disclosure resolution (SP14).
- Script selection (SP15).
- Provider-routing extension for `kind: synthetic` (SP16).
- SP9 provenance extension to record `selectionDecisionId` and `selectorVersion` in `PcdIdentitySnapshot` (SP17).
- QC face-match for synthetic (SP20).
- Multi-character casts using `mutuallyExclusiveWithIds`.
- Fuzzy / scored compatible-set matching. SP13 is exact-match only.
- Persistence of `SyntheticCreatorSelectionDecision`. Pure decision struct only.
- Real model runners. Selector outputs an ID; downstream slices invoke generators.
- `D-tier free pool` per design doc §3.3. The selector handles `exclusivityScope === "free"` if it arrives in a lease snapshot via SP12's gate, but SP13 does not create or test that scope explicitly.

---

## 8. Carry-over notes from SP12 senior review (optional follow-ups for SP13)

The SP12 reviewer flagged three non-blocking notes the implementer may opportunistically address in the SP13 PR or skip. Default for SP13 plan: skip; preserve focus.

- **N1: `PrismaCreatorIdentityLicenseStore.create` rename.** Method is upsert-semantics; `.upsert(...)` would read more honestly. Skip in SP13 — adds an unrelated DB-package edit and breaks SP12's frozen-body invariant unless that allowlist is widened. Defer to SP17 (which will already touch the snapshot-store) or a dedicated rename PR.
- **N2: `withDefaultLeaseWindow` shape-fill without zod-parse.** Helper relies on downstream `store.create` to validate. Skip in SP13 — same rationale as N1; SP13 does not touch the lease store.
- **N3: Missing `soft_exclusive × soft_exclusive` same-clinic tie-break test on `id ASC` in `license-gate.test.ts`.** Adding this is in SP12 source tree but is purely additive (one test). SP13 plan does **not** include this; it can be folded into the SP13 PR as a one-line note in the description if the implementer chooses, or left for an SP12-followup commit. Recommendation: skip and surface as a separate `chore(pcd): sp12 followup` PR if anyone gets curious.

---

## 9. Open questions / known unknowns

- **U1: Should `selectedLicenseId` and `selectedLockType` live on the decision struct?** SP13 includes them (§3.1). Argument for: forensic trail without needing to re-query the gate; downstream provenance (SP17) gets them for free. Argument against: bloats the decision struct; the same info is implicit in `(selectedCreatorIdentityId, clinicId, market, treatmentClass, now)` re-applied to the lease snapshot. Decision: **include**. SP17 will thank us.
- **U2: When the surviving compatible set is exactly 1 and the gate allows it, should `fallbackCreatorIdentityIds` be `[]` or omitted from the union?** Spec says `[]` — keeps the success branch shape stable regardless of survivor count. Caller can `.length === 0`-check. Don't optionalize.
- **U3: Should the selector emit a stable decision id (uuid / hash) like SP10A's cost-forecast does?** SP10A pins `stamp.decisionId = randomUUID()`-equivalent at write-time, but it's a *stamping* operation with persistence intent. SP13 is a *pure decision* with no persistence — adding a randomly-generated id would break determinism. **No.** SP17 will assign an id at persistence time.
- **U4: Does the selector accept an optional `metricsSnapshotVersion: string` input that it merely passes through?** Considered for SP19-readiness. Decision: **No** for SP13. Adding it now is YAGNI; SP19 will widen the input shape when it actually consumes the snapshot. The `metricsSnapshotVersion: null` slot on the decision struct is sufficient forward-compat.

---

## 10. Implementation slicing (preview, not the plan)

The SP13 plan will be written next (per the user-spec workflow: brainstorming → spec → writing-plans → executing-plans). Anticipated task list, TDD-paced (one test commit per task):

1. New `pcd-synthetic-selector.ts` zod schema + co-located test (~8 tests).
2. New `selector-version.ts` constant + its barrel.
3. New `selector.ts` skeleton — empty `selectSyntheticCreator` returning a stub failure decision, just to land the file + import surface.
4. Compatible-set predicate + tests (~7 tests).
5. License-gate composition + tests (~6 tests).
6. Comparator + ranking + tests (~5 tests).
7. Decision-reason builder + tests (~3 tests).
8. Soft-exclusive override propagation + test.
9. Determinism table-driven tests (~3 tests).
10. `sp13-anti-patterns.test.ts` — 5 grep assertions.
11. Allowlist-maintenance fix-up commit — widen 6 prior anti-pattern test allowlists.
12. Barrel re-exports + cross-package barrels.
13. Final full-repo typecheck + test + prettier sweep.

Estimated: ~12–14 commits on the branch, squashed to 1 PR against `main`.

---

*End of design spec. Awaiting user review per brainstorming skill review gate before transitioning to writing-plans.*
