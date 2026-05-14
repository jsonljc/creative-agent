# SP13 — Synthetic Creator Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `selectSyntheticCreator({ brief, now, roster, leases }) → SyntheticCreatorSelectionDecision` — the first allocator over the SP11 synthetic-creator pool. Compatible-set hard-filter (exact match on six brief target fields + `status === "active"`) → per-candidate `licenseGate()` (SP12 black-box) pre-filter → rank survivors by gate-returned license strength → emit a discriminated-union decision struct with `selectedCreatorIdentityId` + `fallbackCreatorIdentityIds` or a structured failure (`no_compatible_candidates` | `all_blocked_by_license`). Net new: 17th pinned constant `PCD_SELECTOR_VERSION = "pcd-selector@1.0.0"`, 1 zod schema file (`pcd-synthetic-selector.ts`), 1 selector subdir (`pcd/selector/`). **No Prisma migration, no DB-package edit, no SP1–SP12 source body change.**

**Architecture:** Pure, deterministic, snapshot-only. Same shape as SP12's `licenseGate` — typed input record, no I/O, no clock reads, no DB. Caller supplies `now`, `roster: readonly RosterEntry[]` (SP11 surface), and `leases: readonly CreatorIdentityLicensePayload[]` (SP12 surface). Selector composes `licenseGate` per candidate and emits a forensic-rich decision. SP19 will widen the success-branch literal slots (`selectorRank`, `metricsSnapshotVersion`, `performanceOverlayApplied`) for performance-overlay re-rank; SP13 pins them as `0`, `null`, `false` literals.

**Tech Stack:** TypeScript ESM (`.js` relative imports), zod schemas with `.readonly()`, vitest, pnpm + Turborepo. No Prisma. No Inngest. No db-package change.

**Source-of-truth design:** `docs/plans/2026-05-14-pcd-synthetic-creator-selector-sp13-design.md` — specifically §2 (locked decisions Q1–Q5 + J1–J8), §3 (module surface), §4 (algorithm details), §5 (test strategy), §6 (merge-back contract).

**Predecessor slices:** SP11 (synthetic-creator foundation, `3b3d291`), SP12 (license gate, `13ee16d`), SP10C (cost-budget, `2f085ba`). All three on `main` as of `2f085ba` (2026-05-14).

## User-locked priority invariants (do not violate)

These are non-negotiable. Anti-pattern grep tests in Task 10 enforce items 1–7 structurally.

1. **Selector is pure-deterministic and snapshot-only.** `selectSyntheticCreator()` does not import `@creativeagent/db`, does not import `@prisma/client`, does not import `inngest` or any `node:fs|http|https|crypto`, does not read `Date.now()` or call `new Date(`, does not call `Math.random()`. All inputs flow in via the typed input record. Anti-pattern test asserts at source level.
2. **License gate is composed as a black box.** The selector invokes `licenseGate({ creatorIdentityId, clinicId, market, treatmentClass, now, leases })` per compatible candidate. It does NOT re-implement lock-type semantics; it does NOT inspect lease fields directly to decide allowed/blocked. Anti-pattern test asserts the literal `licenseGate(` call site exists in the selector source.
3. **Compatible-set hard filters are exact-equality on six brief fields plus `status === "active"`.** Fields: `treatmentClass`, `market`, `vibe`, `ethnicityFamily`, `ageBand`, `pricePositioning`. No fuzzy match, no scoring. `hardConstraints` is echoed into `decisionReason` but NOT filtered on. `mutuallyExclusiveWithIds` is ignored in v1 (multi-cast is out of scope). Anti-pattern test grep-asserts presence of all six equality checks plus `status === "active"`.
4. **Discriminated-union failure, never throw.** Zero-survivor outcomes return `{ allowed: false, reason: "no_compatible_candidates" | "all_blocked_by_license", ... }`. The selector is a pure decision, not an abort-authority orchestrator. SP10B/SP10C have throw discipline; SP13 does not. Reviewer must reject any task adding `throw` to the selector body.
5. **SP13 success branch literal pins.** `selectorRank: z.literal(0)`, `performanceOverlayApplied: z.literal(false)`, `metricsSnapshotVersion: z.null()` (strict — SP13 schema rejects any string; SP19 will widen to `z.string().min(1).nullable()` when the performance overlay lights up). Schema-level literal narrowing rejects `1` / `true` / any non-null string at parse time.
6. **17th pinned constant: source-of-truth in exactly one file.** `PCD_SELECTOR_VERSION = "pcd-selector@1.0.0"`. The literal `"pcd-selector@1.0.0"` appears in EXACTLY one non-test source file: `pcd/selector/selector-version.ts`. Every consumer (currently only `pcd/selector/selector.ts`) imports the constant — no consumer ever repeats the literal. Anti-pattern grep asserts: `selector-version.ts` is the only non-test source containing the literal, AND `selector.ts` contains `import { PCD_SELECTOR_VERSION }` from the version file.
7. **No edits to SP1–SP12 source bodies.** Acceptable edits: `packages/schemas/src/index.ts` (one re-export line), `packages/creative-pipeline/src/index.ts` (one re-export line), and additive allowlist extensions in `sp9-anti-patterns.test.ts` / `sp10a-anti-patterns.test.ts` / `sp10b-anti-patterns.test.ts` / `sp10c-anti-patterns.test.ts` / `sp11-anti-patterns.test.ts` / `sp12-anti-patterns.test.ts`. All other SP1–SP12 files stay byte-identical. SP12's `license-gate.ts`, `seed.ts`, and `creator-identity-license.ts` are imported only as type/value sources.
8. **No Prisma migration.** SP13 is pure logic. `SyntheticCreatorSelectionDecision` is zod-only. Persistence is reserved for SP17 (provenance widen with `selectionDecisionId`).
9. **No SP14+ scope leak.** SP13 does NOT introduce: `DisclosureTemplate`, `DisclosureResolver`, `ScriptTemplate`, `PcdPerformanceSnapshot`, performance overlay, provider-routing extension for synthetic kind, QC face-match for synthetic. Anti-pattern test forbids these tokens in SP13 source.
10. **Tie-break ordering = SP12 `pickStrongest` semantics across candidates' gate-returned licenses, with FINAL tie on `creatorIdentityId` ASC.** Order: `lockType` rank → `priorityRank` ASC (priority_access only) → `effectiveFrom` ASC → `creatorIdentityId` ASC. The final tie-break differs from SP12 (`license.id` ASC); the divergence is intentional and documented with a `// SP13-vs-SP12:` comment in the comparator source.
11. **SP13 optimizes for deterministic allocator correctness, not fill rate.** The compatible-set filter is exact-match across six brief fields plus `status === "active"`; sparse `no_compatible_candidates` outcomes against a small SP11 roster are expected and acceptable. Do NOT add fuzzy matching, scoring, partial fan-out, or fallback expansion inside this PR — those concerns belong to SP19 (performance overlay re-rank) or a future fan-out widening slice, not the v1 allocator. The reviewer must reject any task that softens the equality checks.

## Pre-flight verification (before starting Task 1)

**Branch setup:** Create an isolated worktree from `main` (current tip is `2f085ba`):

```bash
git worktree add .worktrees/sp13 -b feat/pcd-synthetic-creator-selector main
cd .worktrees/sp13
```

Then run from the worktree root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected:
- Typecheck clean across all 5 packages.
- Test suite green at the SP10C-post-merge baseline. Capture the vitest summary line (`Test Files: X passed, Y total` / `Tests: 1711 passed | 2 skipped`) and record as `<SP10C_BASELINE_TESTS>` for the post-flight comparison in Task 13.
- Prettier clean modulo the 2 pre-existing SP5-baseline warnings on `tier-policy.ts` and `tier-policy.test.ts`. Leave as-is.

Confirm branch and recent log:

```bash
git rev-parse --abbrev-ref HEAD
# expect: feat/pcd-synthetic-creator-selector

git log --oneline -3
# expect (top of log is current main):
#   2f085ba feat(pcd): SP10C — cost-budget enforcement (#11)
#   13ee16d feat(pcd): SP12 — synthetic creator license gate + leasing ... (#12)
#   3b3d291 feat(pcd): SP11 — synthetic creator foundation ... (#9)
```

Capture the SP12-merged baseline for Task 10's frozen-source-body assertion:

```bash
git rev-parse HEAD
# Note this commit hash; use it as <SP12_BASELINE> in Task 10 (sp13-anti-patterns.test.ts).
# Expected: 2f085ba<...>
```

---

## Task 1: SP13 zod schemas — `SyntheticCreatorSelectionDecision` + `SyntheticCreatorSelectorRejectionReason`

**Files:**
- Create: `packages/schemas/src/pcd-synthetic-selector.ts`
- Create: `packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SyntheticCreatorSelectionDecisionSchema,
  SyntheticCreatorSelectorRejectionReasonSchema,
  type SyntheticCreatorSelectionDecision,
} from "../pcd-synthetic-selector.js";

const validSuccess: SyntheticCreatorSelectionDecision = {
  allowed: true,
  briefId: "brief_test_01",
  selectedCreatorIdentityId: "cid_synth_cheryl_sg_01",
  fallbackCreatorIdentityIds: ["cid_synth_felicia_my_03"] as const,
  selectedLicenseId: "lic_test_01",
  selectedLockType: "priority_access",
  isSoftExclusivityOverride: false,
  selectorVersion: "pcd-selector@1.0.0",
  selectorRank: 0,
  metricsSnapshotVersion: null,
  performanceOverlayApplied: false,
  decisionReason: "primary_compatible (1 survivor, 1 fallback)",
};

const validRejection = {
  allowed: false as const,
  briefId: "brief_test_02",
  reason: "no_compatible_candidates" as const,
  compatibleCandidateIds: [] as const,
  blockedCandidateIds: [] as const,
  selectorVersion: "pcd-selector@1.0.0",
};

describe("SyntheticCreatorSelectorRejectionReasonSchema", () => {
  it("accepts the two SP13 reasons", () => {
    expect(SyntheticCreatorSelectorRejectionReasonSchema.parse("no_compatible_candidates"))
      .toBe("no_compatible_candidates");
    expect(SyntheticCreatorSelectorRejectionReasonSchema.parse("all_blocked_by_license"))
      .toBe("all_blocked_by_license");
  });

  it("rejects unknown reasons", () => {
    expect(() => SyntheticCreatorSelectorRejectionReasonSchema.parse("other")).toThrow();
  });
});

describe("SyntheticCreatorSelectionDecisionSchema", () => {
  it("round-trips a success decision", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse(validSuccess);
    expect(parsed).toEqual(validSuccess);
  });

  it("round-trips a rejection decision", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse(validRejection);
    expect(parsed).toEqual(validRejection);
  });

  it("discriminator routes by `allowed`: success requires selectedCreatorIdentityId", () => {
    const broken = { ...validSuccess, selectedCreatorIdentityId: undefined };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(broken)).toThrow();
  });

  it("discriminator routes by `allowed`: rejection requires reason", () => {
    const broken = { ...validRejection, reason: undefined };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(broken)).toThrow();
  });

  it("selectorRank: 0 literal rejects 1", () => {
    const bad = { ...validSuccess, selectorRank: 1 };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("performanceOverlayApplied: false literal rejects true", () => {
    const bad = { ...validSuccess, performanceOverlayApplied: true };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("metricsSnapshotVersion is strict z.null() in SP13 — rejects any string", () => {
    const withNull = { ...validSuccess, metricsSnapshotVersion: null };
    expect(SyntheticCreatorSelectionDecisionSchema.parse(withNull).metricsSnapshotVersion).toBeNull();

    const withStr = { ...validSuccess, metricsSnapshotVersion: "snap@2026-05-14" };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(withStr)).toThrow();
  });

  it("decisionReason max length is 2000", () => {
    const bad = { ...validSuccess, decisionReason: "x".repeat(2001) };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("fallbackCreatorIdentityIds may be empty", () => {
    const empty = { ...validSuccess, fallbackCreatorIdentityIds: [] as const };
    expect(SyntheticCreatorSelectionDecisionSchema.parse(empty).fallbackCreatorIdentityIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-selector
```

Expected: FAIL with "Cannot find module '../pcd-synthetic-selector.js'".

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/pcd-synthetic-selector.ts`:

```ts
// PCD slice SP13 — Synthetic creator selection decision schema.
// Pure zod surface; consumed by the pure selector at
// `packages/creative-pipeline/src/pcd/selector/selector.ts`.
//
// SP13 invariants encoded at schema level:
//   - selectorRank: z.literal(0)        — SP19 will widen
//   - performanceOverlayApplied: false  — SP19 will widen
//   - metricsSnapshotVersion: nullable  — SP13 always populates null
//
// No persistence in SP13; SP17 will widen PcdIdentitySnapshot with a
// selectionDecisionId column when provenance lights up.
import { z } from "zod";
import { LockTypeSchema } from "./creator-identity-license.js";

export const SyntheticCreatorSelectorRejectionReasonSchema = z.enum([
  "no_compatible_candidates",
  "all_blocked_by_license",
]);
export type SyntheticCreatorSelectorRejectionReason = z.infer<
  typeof SyntheticCreatorSelectorRejectionReasonSchema
>;

export const SyntheticCreatorSelectionDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      briefId: z.string().min(1),
      selectedCreatorIdentityId: z.string().min(1),
      fallbackCreatorIdentityIds: z.array(z.string().min(1)).readonly(),
      selectedLicenseId: z.string().min(1),
      selectedLockType: LockTypeSchema,
      isSoftExclusivityOverride: z.boolean(),
      selectorVersion: z.string().min(1),
      selectorRank: z.literal(0),
      // SP13: strict z.null(). SP19 will widen to z.string().min(1).nullable()
      // when the performance overlay populates this slot.
      metricsSnapshotVersion: z.null(),
      performanceOverlayApplied: z.literal(false),
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
]);
export type SyntheticCreatorSelectionDecision = z.infer<
  typeof SyntheticCreatorSelectionDecisionSchema
>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas test pcd-synthetic-selector
```

Expected: PASS (10 tests).

- [ ] **Step 5: Add schemas barrel re-export**

Modify `packages/schemas/src/index.ts`. After the existing `// SP12 — synthetic creator license gate` block, append:

```ts

// SP13 — synthetic creator selector
export * from "./pcd-synthetic-selector.js";
```

- [ ] **Step 6: Run schemas-package tests**

```bash
pnpm --filter @creativeagent/schemas test
pnpm --filter @creativeagent/schemas typecheck
```

Expected: all green; ~10 new tests + prior baseline.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/pcd-synthetic-selector.ts \
        packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP13 — SyntheticCreatorSelectionDecision schema"
```

---

## Task 2: SP13 version constant + selector subdir scaffold

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/selector-version.ts`
- Create: `packages/creative-pipeline/src/pcd/selector/selector-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/creative-pipeline/src/pcd/selector/selector-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

describe("PCD_SELECTOR_VERSION", () => {
  it("is the SP13 v1.0.0 literal", () => {
    expect(PCD_SELECTOR_VERSION).toBe("pcd-selector@1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test selector-version
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the constant**

Create `packages/creative-pipeline/src/pcd/selector/selector-version.ts`:

```ts
// PCD slice SP13 — selector version constant (17th PCD pinned constant).
// Single-source pin: this literal must appear in exactly ONE non-test
// source file (this one). Every consumer imports PCD_SELECTOR_VERSION;
// none repeats the literal. The SP13 anti-pattern test enforces both.
export const PCD_SELECTOR_VERSION = "pcd-selector@1.0.0";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test selector-version
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector-version.ts \
        packages/creative-pipeline/src/pcd/selector/selector-version.test.ts
git commit -m "feat(pcd): SP13 — PCD_SELECTOR_VERSION constant (17th pinned constant)"
```

---

## Task 3: Selector skeleton — empty `selectSyntheticCreator` returning a stub failure

**Goal:** Land the file + import surface so subsequent tasks fill in behavior under TDD without import errors.

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Create: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Write the failing skeleton test**

Create `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts
// SP13 selector — table-driven tests. The selector is pure; tests inject
// roster + leases snapshots directly. No DB / Prisma anywhere in this
// file (SP13 anti-pattern test asserts this structurally).
import { describe, expect, it } from "vitest";
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import type { RosterEntry } from "../synthetic-creator/seed.js";
import { selectSyntheticCreator } from "./selector.js";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

const NOW = new Date("2026-05-15T00:00:00.000Z");

// Cheryl (cid_synth_cheryl_sg_01) shape: SG / med_spa / omg_look / sg_chinese / mid_20s / entry.
const cherylRoster: readonly RosterEntry[] = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
  (r) => r.creatorIdentity.id === "cid_synth_cheryl_sg_01",
);

const briefForCheryl: CreativeBrief = {
  briefId: "brief_test_cheryl",
  clinicId: "clinic_a",
  treatmentClass: "med_spa",
  market: "SG",
  jurisdictionCode: "SG",
  platform: "tiktok",
  targetVibe: "omg_look",
  targetEthnicityFamily: "sg_chinese",
  targetAgeBand: "mid_20s",
  pricePositioning: "entry",
  hardConstraints: [] as const,
};

describe("selectSyntheticCreator — skeleton (will be fleshed out in subsequent tasks)", () => {
  it("returns a rejection decision when no roster + no leases supplied", () => {
    const decision: SyntheticCreatorSelectionDecision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW,
      roster: [],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
      expect(decision.selectorVersion).toBe(PCD_SELECTOR_VERSION);
      expect(decision.briefId).toBe("brief_test_cheryl");
      expect(decision.compatibleCandidateIds).toEqual([]);
      expect(decision.blockedCandidateIds).toEqual([]);
    }
  });
});

// Shared test helpers exported for later tasks.
export const NOW_FIXTURE = NOW;
export { cherylRoster, briefForCheryl };

export const makeLease = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
  id: "lic_test_default",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: FAIL with `Cannot find module './selector.js'`.

- [ ] **Step 3: Write the skeleton selector**

Create `packages/creative-pipeline/src/pcd/selector/selector.ts`:

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
// ASC as the final tie-break (SP13-vs-SP12: SP12 ties on license.id;
// SP13 picks among creators, so it ties on creatorIdentityId).
//
// No performance overlay in SP13 — `metricsSnapshotVersion` is `z.null()`
// at the schema level (SP19 will widen to `z.string().min(1).nullable()`)
// and `performanceOverlayApplied: z.literal(false)`. Reserved slots only.
// MERGE-BACK: Switchboard's composer should pull the roster + leases
// via Prisma readers before calling this pure function.
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import type { RosterEntry } from "../synthetic-creator/seed.js";
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
  // Skeleton — Tasks 4–8 fill in compatible-set, gate, ranking, decision.
  // Until those land, every call returns no_compatible_candidates so the
  // skeleton test in selector.test.ts passes.
  return {
    allowed: false,
    briefId: input.brief.briefId,
    reason: "no_compatible_candidates",
    compatibleCandidateIds: [],
    blockedCandidateIds: [],
    selectorVersion: PCD_SELECTOR_VERSION,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS (1 test); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP13 — selector skeleton (stub returns no_compatible_candidates)"
```

---

## Task 4: Compatible-set predicate (6-field exact-match + `status === "active"`)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Append failing compatible-set tests**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — compatible-set filter", () => {
  it("matches Cheryl from full roster when brief targets her exactly", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: SP11_SYNTHETIC_CREATOR_ROSTER,
      leases: [], // no leases yet — Task 5 will exercise the gate
    });
    // Compatible-set will match Cheryl alone (omg_look + sg_chinese + entry).
    // No lease → all_blocked_by_license, with Cheryl in compatibleCandidateIds.
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("returns no_compatible_candidates when vibe does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetVibe: "quiet_confidence" }, // Vivienne's vibe
      now: NOW_FIXTURE,
      roster: cherylRoster, // Cheryl only — vibe mismatch
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
    }
  });

  it("returns no_compatible_candidates when market does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, market: "MY" },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when treatmentClass does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, treatmentClass: "dental" },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when pricePositioning does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, pricePositioning: "premium" },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when ethnicityFamily does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetEthnicityFamily: "my_malay" },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when ageBand does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetAgeBand: "gen_z" },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("filters retired candidates even when target fields match", () => {
    const retiredCheryl: RosterEntry = {
      ...cherylRoster[0]!,
      synthetic: { ...cherylRoster[0]!.synthetic, status: "retired" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [retiredCheryl],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: 8 of the new tests fail (the skeleton returns no_compatible_candidates universally, so some tests pass by accident — specifically the ones that *expect* no_compatible_candidates; the "matches Cheryl" test will fail because it expects `all_blocked_by_license`).

- [ ] **Step 3: Implement the compatible-set predicate**

Modify `packages/creative-pipeline/src/pcd/selector/selector.ts`. Replace the body of `selectSyntheticCreator` and add the helper:

```ts
export function selectSyntheticCreator(
  input: SelectSyntheticCreatorInput,
): SyntheticCreatorSelectionDecision {
  // Step 1 — compatible-set filter (hard exact-match on brief targets).
  const compatible = input.roster.filter((entry) => isCompatible(entry, input.brief));

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

  // Step 2–4 land in Tasks 5–8. Until then, treat every compatible
  // candidate as license-blocked so the rejection branch is well-typed.
  return {
    allowed: false,
    briefId: input.brief.briefId,
    reason: "all_blocked_by_license",
    compatibleCandidateIds: compatible.map((e) => e.creatorIdentity.id),
    blockedCandidateIds: compatible.map((e) => e.creatorIdentity.id),
    selectorVersion: PCD_SELECTOR_VERSION,
  };
}

function isCompatible(entry: RosterEntry, brief: CreativeBrief): boolean {
  const s = entry.synthetic;
  return (
    s.status === "active" &&
    s.treatmentClass === brief.treatmentClass &&
    s.market === brief.market &&
    s.vibe === brief.targetVibe &&
    s.ethnicityFamily === brief.targetEthnicityFamily &&
    s.ageBand === brief.targetAgeBand &&
    s.pricePositioning === brief.pricePositioning
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: PASS (skeleton + 8 compatible-set tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP13 — compatible-set predicate (6-field exact match + status active)"
```

---

## Task 5: License-gate composition (per-candidate `licenseGate()` pre-filter)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Append failing gate-composition tests**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — license-gate composition", () => {
  it("succeeds when the lone compatible candidate has an active priority_access lease for the requesting clinic", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_cheryl_a", lockType: "priority_access", priorityRank: 0 })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(decision.selectedLicenseId).toBe("lic_cheryl_a");
      expect(decision.selectedLockType).toBe("priority_access");
      expect(decision.fallbackCreatorIdentityIds).toEqual([]);
      expect(decision.selectorRank).toBe(0);
      expect(decision.metricsSnapshotVersion).toBeNull();
      expect(decision.performanceOverlayApplied).toBe(false);
      expect(decision.selectorVersion).toBe(PCD_SELECTOR_VERSION);
    }
  });

  it("blocks the lone candidate when no lease exists (all_blocked_by_license)", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("blocks when a competing clinic holds an active hard_exclusive on the same scope", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({ id: "lic_competing_hard", clinicId: "clinic_competitor", lockType: "hard_exclusive" }),
      ],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("blocks when the candidate's lease has expired", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-04-30T00:00:00.000Z"),
          status: "expired",
        }),
      ],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("returns all_blocked_by_license when every compatible candidate is gate-rejected", () => {
    // Synthesize a 2-creator roster, both compatible, neither leased.
    const cherylA: RosterEntry = cherylRoster[0]!;
    const cherylB: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_dup", name: "Cheryl-Dup", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_dup" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds.length).toBe(2);
      expect(decision.blockedCandidateIds.length).toBe(2);
    }
  });

  it("selects the one allowed candidate; blocked siblings do NOT appear in success-branch fallbacks", () => {
    const cherylA: RosterEntry = cherylRoster[0]!;
    const cherylB: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_dup", name: "Cheryl-Dup", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_dup" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      // Only the first is leased.
      leases: [makeLease({ id: "lic_cheryl_a_only", creatorIdentityId: "cid_synth_cheryl_sg_01" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      // The blocked sibling is NOT a fallback. Success branch has no blocked-candidate field.
      expect(decision.fallbackCreatorIdentityIds).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: 5 of the 6 new tests FAIL (the "blocks when no lease exists" passes by accident from Task 4's stub).

- [ ] **Step 3: Add the gate-composition step + emit success/rejection decisions**

Modify `packages/creative-pipeline/src/pcd/selector/selector.ts`. Add the imports at the top:

```ts
import { licenseGate, type LicenseGateDecision } from "../synthetic-creator/license-gate.js";
```

Append at the bottom of the file (below `isCompatible`):

```ts
type AllowedCandidate = {
  entry: RosterEntry;
  gate: Extract<LicenseGateDecision, { allowed: true }>;
};

type BlockedCandidate = {
  entry: RosterEntry;
  gate: Extract<LicenseGateDecision, { allowed: false }>;
};

// Type predicate — narrows c.gate to the success branch, so consumers
// access primary.gate.license / primary.gate.isSoftExclusivityOverride
// without any runtime `if (... !== true) throw` narrowing aid.
function isAllowed(c: { entry: RosterEntry; gate: LicenseGateDecision }): c is AllowedCandidate {
  return c.gate.allowed === true;
}

function isBlocked(c: { entry: RosterEntry; gate: LicenseGateDecision }): c is BlockedCandidate {
  return c.gate.allowed === false;
}
```

Replace the post-compatible-set body in `selectSyntheticCreator` with:

```ts
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

  const allowedCandidates: AllowedCandidate[] = candidateDecisions.filter(isAllowed);
  const blockedCandidates: BlockedCandidate[] = candidateDecisions.filter(isBlocked);

  if (allowedCandidates.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_blocked_by_license",
      compatibleCandidateIds: compatible.map((e) => e.creatorIdentity.id),
      blockedCandidateIds: blockedCandidates.map((c) => c.entry.creatorIdentity.id),
      selectorVersion: PCD_SELECTOR_VERSION,
    };
  }

  // Step 3 — pick the first allowed candidate (Task 6 will rank).
  const primary = allowedCandidates[0]!;
  const fallbacks = allowedCandidates.slice(1);

  // Step 4 — emit success decision. The type predicate above narrows
  // primary.gate to the allowed:true variant, so primary.gate.license and
  // primary.gate.isSoftExclusivityOverride are statically non-null. No
  // runtime narrowing aid needed (invariant #4: selector never throws).
  return {
    allowed: true,
    briefId: input.brief.briefId,
    selectedCreatorIdentityId: primary.entry.creatorIdentity.id,
    fallbackCreatorIdentityIds: fallbacks.map((c) => c.entry.creatorIdentity.id),
    selectedLicenseId: primary.gate.license.id,
    selectedLockType: primary.gate.license.lockType,
    isSoftExclusivityOverride: primary.gate.isSoftExclusivityOverride,
    selectorVersion: PCD_SELECTOR_VERSION,
    selectorRank: 0,
    metricsSnapshotVersion: null,
    performanceOverlayApplied: false,
    decisionReason: `primary_compatible (${allowedCandidates.length} survivor${
      allowedCandidates.length === 1 ? "" : "s"
    }, ${blockedCandidates.length} license-blocked)`,
  };
```

The selector body is now strictly no-throw: the only control-flow exits are the three `return` statements (no-compatible / all-blocked / success). Invariant #4 holds structurally.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS (skeleton + 8 compatible-set + 6 gate-composition).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP13 — per-candidate licenseGate composition"
```

---

## Task 6: Candidate comparator + ranking (SP12 `pickStrongest` semantics with `creatorIdentityId` final tie-break)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Append failing ranking tests**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — ranking + tie-break", () => {
  // Build a 2-candidate compatible roster where both pass the gate but
  // hold different leases. Test orders verify SP12 pickStrongest semantics
  // applied across candidates.
  const cherylA: RosterEntry = cherylRoster[0]!;
  const cherylB: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_zzz", name: "Cheryl-Z", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_zzz" },
  };

  it("hard_exclusive beats priority_access", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({ id: "lic_priority", creatorIdentityId: cherylA.creatorIdentity.id, lockType: "priority_access" }),
        makeLease({ id: "lic_hard", creatorIdentityId: cherylB.creatorIdentity.id, lockType: "hard_exclusive" }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLockType).toBe("hard_exclusive");
      expect(decision.fallbackCreatorIdentityIds).toEqual([cherylA.creatorIdentity.id]);
    }
  });

  it("priority_access with lower priorityRank wins among priority_access leases", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({ id: "lic_rank10", creatorIdentityId: cherylA.creatorIdentity.id, lockType: "priority_access", priorityRank: 10 }),
        makeLease({ id: "lic_rank5",  creatorIdentityId: cherylB.creatorIdentity.id, lockType: "priority_access", priorityRank: 5 }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLicenseId).toBe("lic_rank5");
    }
  });

  it("priority_access tie on rank → older effectiveFrom wins", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({
          id: "lic_newer",
          creatorIdentityId: cherylA.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
          effectiveFrom: new Date("2026-05-10T00:00:00.000Z"),
        }),
        makeLease({
          id: "lic_older",
          creatorIdentityId: cherylB.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
          effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLicenseId).toBe("lic_older");
    }
  });

  it("full tie on lockType, rank, effectiveFrom → creatorIdentityId ASC wins (SP13-vs-SP12 final tie-break)", () => {
    // cherylA.id = "cid_synth_cheryl_sg_01"
    // cherylB.id = "cid_synth_cheryl_sg_zzz"
    // Identical lease shape; selector ties on creator id ASC → cherylA wins.
    const sameLease = (creatorIdentityId: string, id: string) =>
      makeLease({
        id,
        creatorIdentityId,
        lockType: "priority_access",
        priorityRank: 5,
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
      });
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        sameLease(cherylA.creatorIdentity.id, "lic_a"),
        sameLease(cherylB.creatorIdentity.id, "lic_b"),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylA.creatorIdentity.id);
    }
  });

  it("ranked fallback chain reflects full ordering across allowed candidates", () => {
    // Three compatible candidates, all leased, three different strengths:
    //   cherylA: priority_access rank 10
    //   cherylB: priority_access rank 5
    //   cherylC: hard_exclusive
    const cherylC: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_mid", name: "Cheryl-M", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_mid" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: [
        makeLease({ id: "lic_a", creatorIdentityId: cherylA.creatorIdentity.id, lockType: "priority_access", priorityRank: 10 }),
        makeLease({ id: "lic_b", creatorIdentityId: cherylB.creatorIdentity.id, lockType: "priority_access", priorityRank: 5 }),
        makeLease({ id: "lic_c", creatorIdentityId: cherylC.creatorIdentity.id, lockType: "hard_exclusive" }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylC.creatorIdentity.id); // hard wins
      expect(decision.fallbackCreatorIdentityIds).toEqual([
        cherylB.creatorIdentity.id, // priority_access rank 5
        cherylA.creatorIdentity.id, // priority_access rank 10
      ]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: most ranking tests FAIL (the Task 5 body picks `allowedCandidates[0]` — order-dependent on roster input).

- [ ] **Step 3: Add the comparator + ranking step**

Modify `packages/creative-pipeline/src/pcd/selector/selector.ts`. Inside `selectSyntheticCreator`, replace the two lines

```ts
  const primary = allowedCandidates[0]!;
  const fallbacks = allowedCandidates.slice(1);
```

with:

```ts
  // Step 3 — rank survivors. SP12 pickStrongest semantics applied across
  // candidates' gate-returned licenses; final tie on creatorIdentityId ASC.
  const ranked = [...allowedCandidates].sort(compareCandidates);
  const primary = ranked[0]!;
  const fallbacks = ranked.slice(1);
```

Then append at the bottom of the file (below the `isAllowed` / `isBlocked` type predicates from Task 5):

```ts
const LOCK_TYPE_RANK: Record<"hard_exclusive" | "priority_access" | "soft_exclusive", number> = {
  hard_exclusive: 0,
  priority_access: 1,
  soft_exclusive: 2,
};

// SP13-vs-SP12: identical to SP12 pickStrongest EXCEPT the final tie-break
// uses creatorIdentityId (selector picks creators) rather than license.id
// (SP12 picks leases). Documented divergence; intentional.
function compareCandidates(a: AllowedCandidate, b: AllowedCandidate): number {
  const la = a.gate.license;
  const lb = b.gate.license;
  const ra = LOCK_TYPE_RANK[la.lockType];
  const rb = LOCK_TYPE_RANK[lb.lockType];
  if (ra !== rb) return ra - rb;
  if (la.lockType === "priority_access" && lb.lockType === "priority_access") {
    const pa = la.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const pb = lb.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
  }
  if (la.effectiveFrom.getTime() !== lb.effectiveFrom.getTime()) {
    return la.effectiveFrom.getTime() - lb.effectiveFrom.getTime();
  }
  const cidA = a.entry.creatorIdentity.id;
  const cidB = b.entry.creatorIdentity.id;
  return cidA < cidB ? -1 : cidA > cidB ? 1 : 0;
}
```

The `AllowedCandidate` type was already introduced in Task 5 via the type-predicate filter; Task 6 only adds the comparator + sort. The success-branch `return` body needs one tweak so the survivor count tracks `ranked.length`:

Replace:

```ts
    decisionReason: `primary_compatible (${allowedCandidates.length} survivor${
      allowedCandidates.length === 1 ? "" : "s"
    }, ${blockedCandidates.length} license-blocked)`,
```

with:

```ts
    decisionReason: `primary_compatible (${ranked.length} survivor${
      ranked.length === 1 ? "" : "s"
    }, ${blockedCandidates.length} license-blocked)`,
```

(`ranked.length === allowedCandidates.length` structurally, so the change is cosmetic; using `ranked.length` keeps the success-branch reads against a single ranked array.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: PASS (~19 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP13 — candidate comparator (pickStrongest across creators, creatorIdentityId final tie-break)"
```

---

## Task 7: Decision-reason builder (echoes `hardConstraints` for forensics)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.ts`
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Append failing decision-reason tests**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — decisionReason builder", () => {
  it("includes survivor and blocked counts", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).toMatch(/1 survivor/);
      expect(decision.decisionReason).toMatch(/0 license-blocked/);
    }
  });

  it("echoes brief.hardConstraints into decisionReason when non-empty", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, hardConstraints: ["no_pregnancy", "halal_only"] as const },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).toContain("hardConstraints=");
      expect(decision.decisionReason).toContain("no_pregnancy");
      expect(decision.decisionReason).toContain("halal_only");
    }
  });

  it("omits the hardConstraints= prefix when the brief has none", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, hardConstraints: [] as const },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).not.toContain("hardConstraints=");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: the "echoes brief.hardConstraints" test FAILS; the others may pass by accident.

- [ ] **Step 3: Extract a `buildDecisionReason` helper**

Modify `packages/creative-pipeline/src/pcd/selector/selector.ts`. Append at the bottom:

```ts
// Schema caps decisionReason at 2000 chars. Bound the hardConstraints echo
// defensively so a pathological brief (many or long constraint strings)
// can never produce a runtime value that fails schema parse downstream.
const DECISION_REASON_MAX = 2000;

function buildDecisionReason(
  brief: CreativeBrief,
  survivorCount: number,
  blockedCount: number,
): string {
  const survivorWord = survivorCount === 1 ? "survivor" : "survivors";
  const base = `primary_compatible (${survivorCount} ${survivorWord}, ${blockedCount} license-blocked)`;
  if (brief.hardConstraints.length === 0) return base;
  // hardConstraints are opaque strings; echo for forensics but never filter.
  const echoed = `${base} hardConstraints=${JSON.stringify(brief.hardConstraints)}`;
  if (echoed.length <= DECISION_REASON_MAX) return echoed;
  // Truncate the echo (not the base) and append an explicit marker so the
  // forensic reader sees that data was elided rather than missing.
  const room = DECISION_REASON_MAX - base.length - " hardConstraints=…(truncated)".length;
  if (room <= 0) return base;
  return `${base} hardConstraints=${JSON.stringify(brief.hardConstraints).slice(0, room)}…(truncated)`;
}
```

Replace the inline `decisionReason: \`primary_compatible ...\`` line in the success-branch return with:

```ts
    decisionReason: buildDecisionReason(input.brief, ranked.length, blockedCandidates.length),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: PASS (~22 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.ts \
        packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "feat(pcd): SP13 — buildDecisionReason with hardConstraints echo"
```

---

## Task 8: Soft-exclusive override propagation

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

(No source change expected — Task 5/6 already propagate `primary.gate.isSoftExclusivityOverride`. This task is a regression-lock test.)

- [ ] **Step 1: Append the failing test**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — soft_exclusive override propagation", () => {
  it("emits isSoftExclusivityOverride=true when the chosen lease is soft_exclusive and a competing soft_exclusive is active", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({
          id: "lic_mine_soft",
          clinicId: "clinic_a",
          lockType: "soft_exclusive",
        }),
        makeLease({
          id: "lic_competing_soft",
          clinicId: "clinic_competitor",
          lockType: "soft_exclusive",
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedLockType).toBe("soft_exclusive");
      expect(decision.isSoftExclusivityOverride).toBe(true);
    }
  });

  it("emits isSoftExclusivityOverride=false when the chosen lease is soft_exclusive and no competitor exists", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({ id: "lic_mine_soft", clinicId: "clinic_a", lockType: "soft_exclusive" }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedLockType).toBe("soft_exclusive");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (no code change needed)**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: PASS — the propagation was wired in Task 6's return body.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "test(pcd): SP13 — soft_exclusive override propagation regression lock"
```

---

## Task 9: Determinism tests (input-shuffle invariance + byte-equal replay)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/selector/selector.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `packages/creative-pipeline/src/pcd/selector/selector.test.ts`:

```ts

describe("selectSyntheticCreator — determinism", () => {
  // Three compatible candidates, all leased identically except for the
  // license id. Selector must produce byte-equal output regardless of
  // input-array ordering — true determinism, not iteration-order luck.
  const cherylA: RosterEntry = cherylRoster[0]!;
  const cherylB: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_bbb", name: "Cheryl-B", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_bbb" },
  };
  const cherylC: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_ccc", name: "Cheryl-C", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_ccc" },
  };

  const leasesForAll = [
    makeLease({ id: "lic_a", creatorIdentityId: cherylA.creatorIdentity.id, lockType: "priority_access", priorityRank: 5 }),
    makeLease({ id: "lic_b", creatorIdentityId: cherylB.creatorIdentity.id, lockType: "priority_access", priorityRank: 5 }),
    makeLease({ id: "lic_c", creatorIdentityId: cherylC.creatorIdentity.id, lockType: "priority_access", priorityRank: 5 }),
  ];

  it("two identical calls produce byte-equal decisions", () => {
    const inputArgs = {
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    };
    const a = selectSyntheticCreator(inputArgs);
    const b = selectSyntheticCreator(inputArgs);
    expect(a).toEqual(b);
  });

  it("shuffling roster order does not change the selected creator", () => {
    const baseline = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    });
    const reversed = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylC, cherylB, cherylA],
      leases: leasesForAll,
    });
    expect(baseline.allowed).toBe(true);
    expect(reversed.allowed).toBe(true);
    if (baseline.allowed === true && reversed.allowed === true) {
      expect(reversed.selectedCreatorIdentityId).toBe(baseline.selectedCreatorIdentityId);
      expect(reversed.fallbackCreatorIdentityIds).toEqual(baseline.fallbackCreatorIdentityIds);
    }
  });

  it("shuffling leases order does not change the selected license", () => {
    const baseline = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    });
    const reversed = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: [...leasesForAll].reverse(),
    });
    expect(baseline.allowed).toBe(true);
    expect(reversed.allowed).toBe(true);
    if (baseline.allowed === true && reversed.allowed === true) {
      expect(reversed.selectedLicenseId).toBe(baseline.selectedLicenseId);
      expect(reversed.selectedCreatorIdentityId).toBe(baseline.selectedCreatorIdentityId);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test pcd/selector/selector
```

Expected: PASS — Tasks 4–6 already establish determinism via the sort comparator. If any test fails, there is a hidden non-determinism bug in Task 6's comparator that must be diagnosed before Task 10.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/selector.test.ts
git commit -m "test(pcd): SP13 — determinism guarantees (input-shuffle invariance + byte-equal replay)"
```

---

## Task 10: SP13 anti-pattern grep tests (5 structural assertions + frozen-source-body)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`

Replace `<SP12_BASELINE>` below with the SHA captured in pre-flight (the current `main` tip — `2f085ba`).

- [ ] **Step 1: Write the anti-pattern test file**

Create `packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts`:

```ts
// SP13 anti-pattern grep tests. These guard against:
//   1. Single-source version pinning (the literal "pcd-selector@1.0.0"
//      appears in exactly one non-test source file: selector-version.ts;
//      selector.ts must import PCD_SELECTOR_VERSION, not repeat the literal)
//   2. Purity (no Date.now, no new Date, no Math.random, no @creativeagent/db,
//      no @prisma/client, no inngest, no node:fs|http|https, no crypto)
//   3. Compatible-set filter coverage (all six brief fields are compared
//      with === plus status === "active")
//   4. Gate-call discipline (selector source contains the licenseGate( call)
//   5. No SP14+ scope leak (no DisclosureTemplate / ScriptTemplate /
//      PcdPerformanceSnapshot tokens in SP13 source)
//   6. Frozen SP1-SP12 source bodies (allowlist edits only)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SELECTOR_DIR = path.join(
  REPO_ROOT,
  "packages/creative-pipeline/src/pcd/selector",
);
const VERSION_PATH = path.join(SELECTOR_DIR, "selector-version.ts");
const SELECTOR_PATH = path.join(SELECTOR_DIR, "selector.ts");

function grepFiles(pattern: string, scope: string): string[] {
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

describe("SP13 anti-patterns", () => {
  it("PCD_SELECTOR_VERSION literal `pcd-selector@1.0.0` lives in exactly one non-test source file", () => {
    const hits = grepFiles('"pcd-selector@1\\.0\\.0"', "packages/");
    // Tolerate test-file references; restrict to non-test sources.
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    // Each hit is "path:line"; collapse to unique paths.
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(uniquePaths.has("packages/creative-pipeline/src/pcd/selector/selector-version.ts")).toBe(true);
  });

  it("selector.ts imports PCD_SELECTOR_VERSION from selector-version.ts and uses the constant (never repeats the literal)", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    // Positive: must import the constant.
    expect(src).toMatch(/import\s*\{\s*PCD_SELECTOR_VERSION\s*\}\s*from\s+["']\.\/selector-version\.js["']/);
    // Positive: must reference the constant by name in returned decisions.
    expect(src).toMatch(/selectorVersion:\s*PCD_SELECTOR_VERSION/);
    // Negative: must NOT contain the literal version string. The single
    // source of truth is selector-version.ts.
    expect(src).not.toMatch(/"pcd-selector@/);
  });

  it("selector module is pure — no clock reads, no randomness, no I/O imports", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new\s+Date\(/);
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/from\s+["']@creativeagent\/db["']/);
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']node:http["']/);
    expect(src).not.toMatch(/from\s+["']node:https["']/);
    expect(src).not.toMatch(/from\s+["']crypto["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it("compatible-set filter exercises all six brief target fields plus status === \"active\"", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src, "must compare brief.treatmentClass").toMatch(/s\.treatmentClass\s*===\s*brief\.treatmentClass/);
    expect(src, "must compare brief.market").toMatch(/s\.market\s*===\s*brief\.market/);
    expect(src, "must compare brief.targetVibe").toMatch(/s\.vibe\s*===\s*brief\.targetVibe/);
    expect(src, "must compare brief.targetEthnicityFamily").toMatch(
      /s\.ethnicityFamily\s*===\s*brief\.targetEthnicityFamily/,
    );
    expect(src, "must compare brief.targetAgeBand").toMatch(/s\.ageBand\s*===\s*brief\.targetAgeBand/);
    expect(src, "must compare brief.pricePositioning").toMatch(/s\.pricePositioning\s*===\s*brief\.pricePositioning/);
    expect(src, "must check status === \"active\"").toMatch(/s\.status\s*===\s*["']active["']/);
  });

  it("selector body invokes SP12 licenseGate (composes the black box, does not re-implement)", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src).toMatch(/licenseGate\s*\(/);
    // Also assert the import line, so accidental renames are caught.
    expect(src).toMatch(/from\s+["']\.\.\/synthetic-creator\/license-gate\.js["']/);
  });

  it("no SP14+ scope leak — selector source does not reference disclosure / script-template / performance-snapshot tokens", () => {
    for (const filePath of [SELECTOR_PATH, VERSION_PATH]) {
      const src = readFileSync(filePath, "utf8");
      expect(src, `${filePath} must not reference disclosure`).not.toMatch(/DisclosureTemplate|disclosure-template|DisclosureResolver/);
      expect(src, `${filePath} must not reference script-template`).not.toMatch(/ScriptTemplate|script-template/);
      expect(src, `${filePath} must not reference performance snapshots`).not.toMatch(
        /PcdPerformanceSnapshot|performance-snapshot/,
      );
    }
    // Selector schema is allowed to declare `metricsSnapshotVersion` as a reserved field name,
    // but must not import any SP18 token.
    const schemaPath = path.join(
      REPO_ROOT,
      "packages/schemas/src/pcd-synthetic-selector.ts",
    );
    const schemaSrc = readFileSync(schemaPath, "utf8");
    expect(schemaSrc).not.toMatch(/PcdPerformanceSnapshot/);
    expect(schemaSrc).not.toMatch(/ScriptTemplate/);
    expect(schemaSrc).not.toMatch(/DisclosureTemplate/);
  });

  it("SP1–SP12 source bodies are unchanged since the SP12 baseline (allowlist edits only)", () => {
    const SP12_BASELINE = "<SP12_BASELINE>"; // pre-flight commit SHA — currently 2f085ba
    const allowedEdits = new Set([
      // SP13 net-new schema files (Task 1)
      "packages/schemas/src/pcd-synthetic-selector.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts",
      "packages/schemas/src/index.ts",
      // SP13 net-new selector subdir (Tasks 2–9)
      "packages/creative-pipeline/src/pcd/selector/selector-version.ts",
      "packages/creative-pipeline/src/pcd/selector/selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/selector/selector.ts",
      "packages/creative-pipeline/src/pcd/selector/selector.test.ts",
      "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/selector/index.ts",
      // SP13 barrel re-export (Task 12)
      "packages/creative-pipeline/src/index.ts",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP12_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // same accommodation as SP9–SP12 anti-pattern tests.
      return;
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
      // SP13 net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 11) are
      // necessary maintenance — exact-match allowlisted via the Set above
      // is not enough since those edits are append-only allowlist lines.
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts") continue;

      expect(allowedEdits.has(file), `SP13 modified disallowed file: ${file}`).toBe(true);
    }
  });
});
```

**Important:** before committing, replace the literal `<SP12_BASELINE>` string in the test with the SHA captured during pre-flight (use `git rev-parse main` from before Task 1 started). If you cannot recover the SHA, use `2f085ba` (the SP10C-on-main tip merged 2026-05-14).

- [ ] **Step 2: Replace `<SP12_BASELINE>` with the actual SHA**

```bash
# Use the SHA captured during pre-flight; if unrecoverable, use 2f085ba.
sed -i.bak 's/<SP12_BASELINE>/2f085ba/' packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts
rm packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts.bak
```

- [ ] **Step 3: Run the anti-pattern tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp13-anti-patterns
```

Expected: PASS (6 assertions). The frozen-source-body assertion may pass trivially on a shallow clone; that is acceptable and matches the SP9–SP12 precedent.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts
git commit -m "test(pcd): SP13 — 6 anti-pattern grep assertions (purity + composer pin + scope freeze)"
```

---

## Task 11: Allowlist maintenance — extend 6 prior anti-pattern tests

Each prior anti-pattern test (SP9, SP10A, SP10B, SP10C, SP11, SP12) declares an allowlist (an exact-match `Set` and/or a `startsWith` prefix list) covering edits in subsequent slices. SP13 introduces a new subdir (`pcd/selector/`) and a new schemas file (`pcd-synthetic-selector.ts`). Extend each prior test so SP13's net-new files don't trip its frozen-source-body assertion.

**Files (all 6 are modify-only — append-style additions):**
- Modify: `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts`
- Modify: `packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts`

- [ ] **Step 1: Run the prior anti-pattern tests against the SP13 worktree to capture the failures**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp9-anti-patterns sp10a-anti-patterns sp10b-anti-patterns sp10c-anti-patterns sp11-anti-patterns sp12-anti-patterns
```

Expected: at least the "SP1–SPN source bodies are unchanged" assertions in each of these six tests will FAIL, listing the SP13 net-new files as "modified disallowed files."

- [ ] **Step 2: Extend each test's allowlist**

For each of the six test files, locate the existing frozen-source-body assertion (`it("SP1–SPN source bodies are unchanged ...")`) and the surrounding allowlist (`allowedEdits` Set + `if (file.startsWith(...))` skip blocks).

Add the following:

**For SP9 (`provenance/sp9-anti-patterns.test.ts`):**

In the existing `startsWith` skip ladder (around line 183 — currently has `pcd/cost/`, `pcd/budget/`, `pcd/cost-budget/`), append:

```ts
      // SP13 net-new selector subdir is out of scope (necessary maintenance —
      // SP9 test was written before SP13 territory existed; same precedent
      // as pcd/cost/, pcd/budget/, pcd/cost-budget/ allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
```

In the exact-match list (around line 199), append:

```ts
      // SP13 widened schemas with pcd-synthetic-selector.ts. Allow as
      // out-of-scope; SP13's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-synthetic-selector.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts") continue;
```

**For SP10A (`cost/sp10a-anti-patterns.test.ts`):** Mirror the SP9 changes — add the `pcd/selector/` prefix skip and the two exact-match schema-file lines. Place them in the analogous spots in the file's frozen-source assertion (look for the existing `pcd/budget/` and `pcd/cost-budget/` skips).

**For SP10B (`budget/sp10b-anti-patterns.test.ts`):** Same — add `pcd/selector/` prefix skip + the two exact-match lines for `pcd-synthetic-selector.ts` and its test.

**For SP10C (`cost-budget/sp10c-anti-patterns.test.ts`):** Same — add `pcd/selector/` prefix skip + the two exact-match schema-file lines.

**For SP11 (`sp11-anti-patterns.test.ts`):** Same — add `pcd/selector/` prefix skip + the two exact-match schema-file lines. SP11's structure may differ (check whether it uses `allowedEdits` Set or prefix-skip; mirror whichever the file already uses).

**For SP12 (`sp12-anti-patterns.test.ts`):** SP12's tests are listed in `pcd/sp12-anti-patterns.test.ts` and may or may not have a frozen-body assertion. If it does, add the same skip + exact-match lines. If it does not, add nothing for SP12 and document in the commit message that no edit was needed.

(If a file has a `startsWith("docs/")` or similar bulk-skip, leave those untouched.)

- [ ] **Step 3: Re-run all six prior anti-pattern tests**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp9-anti-patterns sp10a-anti-patterns sp10b-anti-patterns sp10c-anti-patterns sp11-anti-patterns sp12-anti-patterns
```

Expected: all six tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts \
        packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts
git commit -m "chore(pcd): allowlist pcd/selector + pcd-synthetic-selector in SP9–SP12 freeze tests"
```

---

## Task 12: Barrel re-exports (selector subdir + package barrel)

**Files:**
- Create: `packages/creative-pipeline/src/pcd/selector/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 1: Create the selector subdir barrel**

Create `packages/creative-pipeline/src/pcd/selector/index.ts`:

```ts
// PCD slice SP13 — synthetic creator selector subdir barrel.
export { selectSyntheticCreator } from "./selector.js";
export type { SelectSyntheticCreatorInput } from "./selector.js";
export { PCD_SELECTOR_VERSION } from "./selector-version.js";
```

- [ ] **Step 2: Extend the package barrel**

Modify `packages/creative-pipeline/src/index.ts`. After the existing `// SP10C — cost-budget enforcement` block (currently the last `export * from`), append:

```ts

// SP13 — synthetic creator selector
export * from "./pcd/selector/index.js";
```

- [ ] **Step 3: Verify package boundary**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: typecheck clean; all SP13 tests + all prior tests green.

Quick smoke-check the barrel surface:

```bash
node --eval 'import("@creativeagent/creative-pipeline").then(m => console.log(typeof m.selectSyntheticCreator, m.PCD_SELECTOR_VERSION))' || true
```

(May fail with ESM-resolution noise — that's fine; the typecheck above is the authoritative gate.)

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/selector/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP13 — barrel exports for selector subdir + package surface"
```

---

## Task 13: Final full-repo sweep — typecheck, test, prettier

- [ ] **Step 1: Full typecheck across all 5 packages**

```bash
pnpm typecheck
```

Expected: clean. If turbo caches mask an error, force-clear:

```bash
pnpm --filter @creativeagent/schemas build
pnpm typecheck
```

- [ ] **Step 2: Full test sweep across all 5 packages**

```bash
pnpm test
```

Expected: `Tests:` line shows roughly **`<SP10C_BASELINE_TESTS> + ~38–45 net SP13`** passing. Concretely: ~1711 prior → ~1749–1756 final, with 2 skipped (the SP10C-baseline skips). Capture the new total; record any unexpected delta in the PR description.

- [ ] **Step 3: Prettier check**

```bash
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: clean modulo the 2 pre-existing SP5-baseline warnings on `tier-policy.ts` and `tier-policy.test.ts`. Do NOT fix those — they are documented baseline noise carried since SP5 (now 14 slices deferred).

If SP13 sources have prettier complaints, run `pnpm exec prettier --write` on SP13 paths only:

```bash
pnpm exec prettier --write \
  "packages/schemas/src/pcd-synthetic-selector.ts" \
  "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts" \
  "packages/creative-pipeline/src/pcd/selector/**/*.ts"
```

Then commit the cleanup:

```bash
git add -u
git diff --cached
git commit -m "chore(pcd): SP13 — prettier sweep on selector + schemas net-new files"
```

- [ ] **Step 4: Branch summary**

```bash
git log --oneline main..HEAD
```

Expected: ~13–15 commits on the SP13 branch (1 per task plus optional fix-ups).

- [ ] **Step 5: Open the PR**

When ready, push the branch and open a PR against `main`. The PR description should:

1. Link the design doc (`docs/plans/2026-05-14-pcd-synthetic-creator-selector-sp13-design.md`) and this plan (`docs/plans/2026-05-14-pcd-synthetic-creator-selector-sp13-plan.md`).
2. State the new pinned-constant count: **17 PCD pinned constants** (`PCD_TIER_POLICY_VERSION`, `PCD_SHOT_SPEC_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`, `PCD_QC_EVALUATION_VERSION`, `PCD_QC_GATE_MATRIX_VERSION`, `PCD_APPROVAL_LIFECYCLE_VERSION`, `PCD_CONSENT_REVOCATION_VERSION`, `PCD_PREPRODUCTION_CHAIN_VERSION`, `PCD_IDENTITY_CONTEXT_VERSION`, `PCD_PREPRODUCTION_FANOUT_VERSION`, `PCD_PROVENANCE_VERSION`, `PCD_COST_FORECAST_VERSION`, `PCD_TREE_BUDGET_VERSION`, `PCD_COST_BUDGET_VERSION`, `PCD_LICENSE_GATE_VERSION`, **`PCD_SELECTOR_VERSION`**).
3. List net-new files: 1 selector subdir (6 source/test files) + 1 schemas file pair + 1 cross-package barrel append.
4. Note allowlist maintenance touched 5–6 prior anti-pattern tests with no semantic changes (skip-prefix + exact-match additions only).
5. Record the test-count delta (`Tests: <baseline> → <final>`).
6. Out-of-scope reminders: SP14 (disclosure), SP15 (script templates), SP16 (provider routing for synthetic), SP17 (provenance widen for `selectionDecisionId`), SP18 (`PcdPerformanceSnapshot`), SP19 (performance overlay re-rank), SP20 (synthetic QC face-match), SP21 (end-to-end integration). Multi-character casts (`mutuallyExclusiveWithIds` reading) is also future work.

---

## Self-review (for the implementer, not the reviewer)

Before opening the PR, verify against the design spec one more time:

1. **Schema literal pins:** `selectorRank: z.literal(0)`, `performanceOverlayApplied: z.literal(false)`, `metricsSnapshotVersion: z.null()` (strict — rejects strings). (Task 1 + invariant #5)
2. **Single-source version pinning:** `grep -rE '"pcd-selector@1\.0\.0"' packages/ --include='*.ts' --exclude='*.test.ts'` returns exactly one hit, in `selector-version.ts`. `selector.ts` contains the import line `import { PCD_SELECTOR_VERSION } from "./selector-version.js"` and the reference `selectorVersion: PCD_SELECTOR_VERSION`. (Anti-pattern tests 1 + 2 in Task 10)
3. **Six-field compatible-set:** all of `treatmentClass`, `market`, `vibe`, `ethnicityFamily`, `ageBand`, `pricePositioning` are compared, plus `status === "active"`. (Task 4 + anti-pattern test in Task 10)
4. **`mutuallyExclusiveWithIds` ignored:** zero references in `selector.ts`. (J3 from design)
5. **Final tie-break:** comparator's terminal branch ties on `creatorIdentityId`, NOT `license.id`. Comment with `SP13-vs-SP12:` present. (Task 6)
6. **No throw anywhere in the selector module:** `grep -n 'throw' packages/creative-pipeline/src/pcd/selector/selector.ts` returns zero hits. The Task-5 type-predicate filter (`isAllowed` / `isBlocked`) narrows `gate.allowed === true` structurally — no runtime narrowing aid needed. (Invariant #4)
7. **No Prisma migration in this PR:** `git diff main..HEAD --name-only -- packages/db/prisma/migrations/` returns empty. (Invariant #8)
8. **No edits to SP12 source bodies:** `git diff <SP12_BASELINE> HEAD -- packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts packages/schemas/src/creator-identity-license.ts` returns empty. (Invariant #7)
9. **Sparse-matching discipline preserved:** the only compatible-set filter is exact-equality on the six brief fields plus `status === "active"`; no fuzzy/scored fallback added inside this PR. (Invariant #11)

If any of the above fails, fix before opening the PR.
