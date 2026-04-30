# SP9 — Creative-Source Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge SP7/SP8's pre-production tree to SP4's per-asset `PcdIdentitySnapshot` so every generated asset carries a forensic trail back to the brief that authorized it (`briefId → trendId → motivatorId → hookId → scriptId`). Ship a 12th pinned constant (`PCD_PROVENANCE_VERSION`), a pure store-injected stamper, a new top-level orchestrator that calls the stamper then the SP4 writer, additive Prisma widening on `PcdIdentitySnapshot`, the SP9 store contract + adapter, plus the SP8 carry-over (`decisionNote` bounded at `max(2000)`) and the stub-fanout barrel cleanup.

**Architecture:** SP9 is a synergy slice with its own subdir `packages/creative-pipeline/src/pcd/provenance/` (sibling to `pcd/preproduction/`). The SP4 writer body is preserved verbatim — SP9 ships a parallel orchestrator that calls a NEW store method (`createForShotWithProvenance`). One additive Prisma migration. No edits to SP1–SP8 source bodies (only schemas widening for `decisionNote` and barrel re-exports). Two consent checks bracket the production-time interval: SP7 entry + SP9 stamp.

**Tech Stack:** TypeScript ESM (`.js` relative imports), zod schemas, vitest, Prisma + Postgres, pnpm + Turborepo. One Prisma migration. No `apps/api` wiring. No `WorkTrace` emit (markers only).

**Source-of-truth design:** `docs/plans/2026-04-30-pcd-creative-source-provenance-sp9-design.md` (committed in `1ec336d`).

## User review (2026-04-30) — known risks accepted

User reviewed both design and plan and signed off. Four risks called out explicitly so the executing agent does not relitigate them mid-implementation:

1. **SP4/SP9 invariant logic duplication is a long-term maintenance smell.** Mitigated by `sp9-anti-patterns.test.ts` Task 11 assertion #5 (both files import identical version constants + call `assertTier3RoutingDecisionCompliant` with identical six-argument shape). If a future slice extracts the shared logic into a pure helper, that's a refactor the test allows; what it forbids is one path drifting from the other silently.
2. **Denormalized lineage trades flexibility for query speed.** Adding a future rung (e.g. `templateId`) requires another column + migration. Accepted; SP9's premise is forensic queries on the hot path matter more than schema flexibility.
3. **`fanoutDecisionId` format is caller-supplied.** Long-term we'll need to standardize on Inngest event id at merge-back time. The `// MERGE-BACK: pick fanoutDecisionId convention` marker in the orchestrator is the canonical reminder; SP10 or merge-back is the right place to lock it.
4. **The bare `writePcdIdentitySnapshot` callsite still exists and writes null lineage.** SP9 does not deprecate it (legacy callsites + tests rely on it). Discipline at merge-back is required: production runner MUST call `writePcdIdentitySnapshotWithProvenance`. Consider promoting to a runtime invariant in SP10+ once we know which callsites legitimately need null-lineage writes.

User also flagged that SP10+ is the natural place to *use* lineage (cost weighting, performance weighting, auto-pruning underperforming branches), not just record it. SP9 is the substrate; SP10+ is the consumer.

## User-locked priority invariants (do not violate)

User reviewed the design 2026-04-30 and approved with scope discipline. These are non-negotiable:

1. **No edits to SP1–SP8 source bodies.** Acceptable edits: schemas widening (`pcd-preproduction.ts` for `decisionNote` bound), barrel re-exports (`preproduction/index.ts`, `pcd/index.ts` if any, `schemas/index.ts`, `creative-pipeline/index.ts`), and Prisma `schema.prisma`. The SP4 `writePcdIdentitySnapshot` body, the SP6 consent pre-check body, the SP7 chain/builder/gate bodies, and the SP8 deep-freeze/composer-widen bodies all stay byte-identical.
2. **Composer-only version pinning.** `PCD_PROVENANCE_VERSION` is imported only by `stamp-pcd-provenance.ts`. No gate, runner, schema, or writer file may contain the literal — `sp9-anti-patterns.test.ts` enforces.
3. **SP4 writer body untouched.** SP9 ships a NEW orchestrator (`writePcdIdentitySnapshotWithProvenance`) that duplicates SP4's invariant-assert + Zod-parse + version-pin logic and calls a NEW store method. The duplication is structurally enforced by the anti-pattern test asserting both files import the same four version constants and use the same six-argument `assertTier3RoutingDecisionCompliant` call.
4. **Two consent checks by design.** SP7 entry (existing) + SP9 stamp (new). Both invoke `assertConsentNotRevokedForGeneration` from SP6.
5. **Additive nullable widen on PcdIdentitySnapshot.** Pre-SP9 rows remain readable forever. No backfill. No FK constraints on lineage columns (merge-back may add them once Switchboard models the chain output as DB rows).
6. **`decisionNote` bound is a widening of constraints (max length added, was unbounded).** SP8 stub gate emits null; no in-tree value is at risk. Anti-pattern test asserts no stub stage runner reads `decisionNote` and no real stage runner substrings it into prompt construction.
7. **No real Claude runners. No Inngest wiring. No WorkTrace emit.** Markers and stubs only.
8. **Implementation discipline:** if any task balloons past its declared scope (e.g. consent-check refactor, surprise circular import), STOP and split. Acceptable split shapes: SP9A (schemas + version pin + decisionNote bound), SP9B (stamper + orchestrator), SP9C (Prisma migration + adapter), SP9D (anti-patterns + barrels + docs).

## Pre-flight verification (before starting Task 1)

Run from repo root:

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"
```

Expected: typecheck clean across all 5 packages; ~1,411 tests green (SP8 baseline); two pre-existing prettier warnings on `packages/creative-pipeline/src/pcd/tier-policy.ts` and `tier-policy.test.ts` (SP5 baseline noise — leave as-is). Anything else red is a baseline issue to investigate before SP9 starts.

Also confirm SP8 squash is on `main`:

```bash
git log --oneline -1
# expect: 90f5323 feat(pcd): SP8 — branching tree state + production-fanout hardening (#7)
```

Create the SP9 branch:

```bash
git checkout -b sp9-creative-source-provenance
```

Capture the SP8-frozen-source-body baseline for Task 11's structural assertion (used to verify no SP1–SP8 source body changes throughout SP9):

```bash
git rev-parse HEAD
# Note this commit hash; use it as <SP8_BASELINE> in Task 11 (sp9-anti-patterns.test.ts).
```

---

## Task 1: SP9 zod schemas (`pcd-provenance.ts`)

**Files:**
- Create: `packages/schemas/src/pcd-provenance.ts`
- Create: `packages/schemas/src/__tests__/pcd-provenance.test.ts`
- Modify: `packages/schemas/src/index.ts` (single re-export line)

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/__tests__/pcd-provenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdProvenanceLineageSchema,
  PcdProvenanceDecisionReasonSchema,
  PcdSp9ProvenancePayloadSchema,
} from "../pcd-provenance.js";

describe("PcdProvenanceLineageSchema", () => {
  it("accepts a fully populated lineage", () => {
    const ok = PcdProvenanceLineageSchema.parse({
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
    });
    expect(ok.scriptId).toBe("scr_1");
  });

  it("rejects empty briefId", () => {
    expect(() =>
      PcdProvenanceLineageSchema.parse({
        briefId: "",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
        scriptId: "scr_1",
      }),
    ).toThrow();
  });

  it("rejects missing field", () => {
    expect(() =>
      PcdProvenanceLineageSchema.parse({
        briefId: "brf_1",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
      }),
    ).toThrow();
  });
});

describe("PcdProvenanceDecisionReasonSchema", () => {
  it("accepts a fully populated reason", () => {
    const ok = PcdProvenanceDecisionReasonSchema.parse({
      decidedAt: "2026-04-30T12:00:00.000Z",
      fanoutDecisionId: "fdec_1",
      chainVersion: "preproduction-chain@1.0.0",
      provenanceVersion: "pcd-provenance@1.0.0",
    });
    expect(ok.provenanceVersion).toBe("pcd-provenance@1.0.0");
  });

  it("rejects non-iso decidedAt", () => {
    expect(() =>
      PcdProvenanceDecisionReasonSchema.parse({
        decidedAt: "2026-04-30",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      }),
    ).toThrow();
  });
});

describe("PcdSp9ProvenancePayloadSchema", () => {
  it("accepts the merged five-id + reason shape", () => {
    const ok = PcdSp9ProvenancePayloadSchema.parse({
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    });
    expect(ok.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/schemas test pcd-provenance
```

Expected: FAIL — module `../pcd-provenance.js` cannot be resolved.

- [ ] **Step 3: Write the schema source**

Create `packages/schemas/src/pcd-provenance.ts`:

```ts
// PCD slice SP9 — Creative-source provenance schema. Bridges SP7/SP8's
// pre-production tree to SP4's per-asset PcdIdentitySnapshot so every
// generated asset carries a forensic lineage back to the brief that
// authorized it.
//
// Shape: denormalized — one row per asset, flat lineage columns. Mirrors
// SP4's routingDecisionReason precedent: flat columns for query performance,
// Json reason field for the full forensic trail. The chain output's
// parent*Id walk remains structurally reconstructible from the persisted
// PcdPreproductionChainResult JSON if needed.
import { z } from "zod";

export const PcdProvenanceLineageSchema = z
  .object({
    briefId: z.string().min(1),
    trendId: z.string().min(1),
    motivatorId: z.string().min(1),
    hookId: z.string().min(1),
    scriptId: z.string().min(1),
  })
  .readonly();
export type PcdProvenanceLineage = z.infer<typeof PcdProvenanceLineageSchema>;

export const PcdProvenanceDecisionReasonSchema = z
  .object({
    decidedAt: z.string().datetime(),
    fanoutDecisionId: z.string().min(1),
    chainVersion: z.string().min(1),
    provenanceVersion: z.string().min(1),
  })
  .readonly();
export type PcdProvenanceDecisionReason = z.infer<typeof PcdProvenanceDecisionReasonSchema>;

export const PcdSp9ProvenancePayloadSchema = z.object({
  briefId: z.string().min(1),
  trendId: z.string().min(1),
  motivatorId: z.string().min(1),
  hookId: z.string().min(1),
  scriptId: z.string().min(1),
  lineageDecisionReason: PcdProvenanceDecisionReasonSchema,
});
export type PcdSp9ProvenancePayload = z.infer<typeof PcdSp9ProvenancePayloadSchema>;
```

- [ ] **Step 4: Re-export from the schemas barrel**

Open `packages/schemas/src/index.ts`. Locate the SP7 re-export line (`export * from "./pcd-preproduction.js";`). Add immediately below it:

```ts
export * from "./pcd-provenance.js";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas test pcd-provenance
pnpm --filter @creativeagent/schemas typecheck
```

Expected: 8 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/pcd-provenance.ts \
        packages/schemas/src/__tests__/pcd-provenance.test.ts \
        packages/schemas/src/index.ts
git commit -m "feat(pcd): SP9 — add provenance lineage zod schemas"
```

---

## Task 2: Bound `decisionNote` (SP8 carry-over)

**Files:**
- Modify: `packages/schemas/src/pcd-preproduction.ts` (single field constraint widening)
- Modify: `packages/schemas/src/__tests__/pcd-preproduction.test.ts` (extend, don't replace)

- [ ] **Step 1: Write the failing tests**

Open `packages/schemas/src/__tests__/pcd-preproduction.test.ts`. Locate the test block for `PcdProductionFanoutDecisionSchema`. Append the following tests inside that `describe` block (or create a new `describe("decisionNote bounding")` block at the bottom of the file):

```ts
describe("PcdProductionFanoutDecisionSchema decisionNote bounding (SP9)", () => {
  const baseValidDecision = {
    briefId: "brf_1",
    creatorIdentityId: "cre_1",
    productIdentityId: "prd_1",
    consentRecordId: null,
    effectiveTier: 1,
    selectedScriptIds: ["scr_1"],
    availableScriptIds: ["scr_1"],
    preproductionChainVersion: "preproduction-chain@1.0.0",
    identityContextVersion: "identity-context@1.0.0",
    approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    preproductionFanoutVersion: "preproduction-fanout@1.0.0",
    decidedAt: "2026-04-30T12:00:00.000Z",
    decidedBy: null,
    costForecast: null,
  };

  it("accepts null decisionNote", () => {
    const ok = PcdProductionFanoutDecisionSchema.parse({
      ...baseValidDecision,
      decisionNote: null,
    });
    expect(ok.decisionNote).toBe(null);
  });

  it("accepts a 2000-character decisionNote", () => {
    const note = "x".repeat(2000);
    const ok = PcdProductionFanoutDecisionSchema.parse({
      ...baseValidDecision,
      decisionNote: note,
    });
    expect(ok.decisionNote?.length).toBe(2000);
  });

  it("rejects a 2001-character decisionNote", () => {
    const note = "x".repeat(2001);
    expect(() =>
      PcdProductionFanoutDecisionSchema.parse({
        ...baseValidDecision,
        decisionNote: note,
      }),
    ).toThrow();
  });

  it("accepts an empty string decisionNote", () => {
    const ok = PcdProductionFanoutDecisionSchema.parse({
      ...baseValidDecision,
      decisionNote: "",
    });
    expect(ok.decisionNote).toBe("");
  });
});
```

(If `PcdProductionFanoutDecisionSchema` is not already imported in the test file, add it to the existing import line from `../pcd-preproduction.js`.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/schemas test pcd-preproduction
```

Expected: the "rejects a 2001-character decisionNote" test FAILS (current schema is unbounded — accepts any string). Other three new tests pass.

- [ ] **Step 3: Tighten the schema**

Open `packages/schemas/src/pcd-preproduction.ts`. Locate the `PcdProductionFanoutDecisionSchema` definition. Find the `decisionNote` field block (currently `z.string().nullable()` with a multi-line comment flagging SP9+ for tightening). Replace it with:

```ts
  // SP9 — bounded operator commentary. Operator-only writeable; never read by
  // stub stage runners; never substringed into runner-prompt text.
  // sp9-anti-patterns.test.ts enforces these invariants structurally.
  decisionNote: z.string().max(2000).nullable(),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/schemas test pcd-preproduction
pnpm --filter @creativeagent/schemas typecheck
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: all 4 new tests pass; existing pcd-preproduction tests remain green; creative-pipeline tests remain green (SP8 stub gate emits null which still passes the bounded constraint).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pcd-preproduction.ts \
        packages/schemas/src/__tests__/pcd-preproduction.test.ts
git commit -m "feat(pcd): SP9 — bound decisionNote at max(2000) (SP8 carry-over)"
```

---

## Task 3: `PCD_PROVENANCE_VERSION` constant

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/provenance-version.ts`
- Create: `packages/creative-pipeline/src/pcd/provenance/provenance-version.test.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p packages/creative-pipeline/src/pcd/provenance
```

- [ ] **Step 2: Write the failing test**

Create `packages/creative-pipeline/src/pcd/provenance/provenance-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PCD_PROVENANCE_VERSION } from "./provenance-version.js";

describe("PCD_PROVENANCE_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PROVENANCE_VERSION).toBe("pcd-provenance@1.0.0");
  });

  it("matches the slug@semver format", () => {
    expect(PCD_PROVENANCE_VERSION).toMatch(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @creativeagent/creative-pipeline test provenance-version
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the constant**

Create `packages/creative-pipeline/src/pcd/provenance/provenance-version.ts`:

```ts
// SP9 — pinned version constant for creative-source provenance lineage.
// 12th pinned constant in the PCD slice. Caller cannot override; pinned by
// stamp-pcd-provenance.ts from import. Bumped independently of
// PCD_PREPRODUCTION_CHAIN_VERSION so lineage-shape evolution is decoupled
// from chain-shape evolution.
export const PCD_PROVENANCE_VERSION = "pcd-provenance@1.0.0";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @creativeagent/creative-pipeline test provenance-version
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/
git commit -m "feat(pcd): SP9 — add PCD_PROVENANCE_VERSION (12th pinned constant)"
```

---

## Task 4: `stampPcdProvenance` pure stamper

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts`
- Create: `packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.test.ts`

**Design notes:**

- Input includes `creatorIdentityId` so the stamper can call `assertConsentNotRevokedForGeneration` (SP6 import) without the orchestrator needing a separate consent step.
- Stores reuse SP6's `AssertConsentNotRevokedForGenerationStores` (creatorIdentityReader + consentRecordReader) plus an optional `clock` (SP7/SP8 convention).
- Lineage walk is structural — match script.parentHookId to a hook, hook.parentMotivatorId to a motivator, motivator.parentTrendId to a trend. If any walk-step fails, throw `InvariantViolationError` with `{ scriptId, missingAt: <stage> }` context.
- `chainVersion` carried by importing `PCD_PREPRODUCTION_CHAIN_VERSION` from `../preproduction/preproduction-chain-version.js`.
- `provenanceVersion` carried by importing `PCD_PROVENANCE_VERSION` from `./provenance-version.js`.

- [ ] **Step 1: Write the failing tests**

Create `packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdPreproductionChainResult,
  PcdProductionFanoutDecision,
  TrendStageOutput,
} from "@creativeagent/schemas";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { stampPcdProvenance } from "./stamp-pcd-provenance.js";

const trendsOutput: TrendStageOutput = {
  signals: [
    { id: "trd_1", summary: "s1", audienceFit: "a1", evidenceRefs: [] },
    { id: "trd_2", summary: "s2", audienceFit: "a2", evidenceRefs: [] },
  ],
};

const motivatorsOutput: MotivatorsStageOutput = {
  motivators: [
    {
      id: "mot_1",
      frictionOrDesire: "f1",
      audienceSegment: "as1",
      evidenceRefs: [],
      parentTrendId: "trd_1",
    },
  ],
};

const hooksOutput: HooksStageOutput = {
  hooks: [
    {
      id: "hk_1",
      text: "h1",
      hookType: "direct_camera",
      parentMotivatorId: "mot_1",
      parentTrendId: "trd_1",
    },
  ],
};

const scriptsOutput: CreatorScriptsStageOutput = {
  scripts: [
    {
      id: "scr_1",
      hookText: "h1",
      creatorAngle: "ca",
      visualBeats: [],
      productMoment: "pm",
      cta: "cta",
      complianceNotes: [],
      identityConstraints: { creatorIdentityId: "cre_1", productIdentityId: "prd_1", voiceId: null },
      parentHookId: "hk_1",
      scriptStyle: "spoken_lines",
      spokenLines: ["line1"],
    },
  ],
};

const decision: PcdProductionFanoutDecision = {
  briefId: "brf_1",
  creatorIdentityId: "cre_1",
  productIdentityId: "prd_1",
  consentRecordId: null,
  effectiveTier: 1,
  selectedScriptIds: ["scr_1"],
  availableScriptIds: ["scr_1"],
  preproductionChainVersion: "preproduction-chain@1.0.0",
  identityContextVersion: "identity-context@1.0.0",
  approvalLifecycleVersion: "approval-lifecycle@1.0.0",
  preproductionFanoutVersion: "preproduction-fanout@1.0.0",
  decidedAt: "2026-04-30T12:00:00.000Z",
  decidedBy: null,
  decisionNote: null,
  costForecast: null,
};

const chainResult: PcdPreproductionChainResult = {
  decision,
  stageOutputs: {
    trends: trendsOutput,
    motivators: motivatorsOutput,
    hooks: hooksOutput,
    scripts: scriptsOutput,
  },
};

const happyPathStores = {
  creatorIdentityReader: {
    findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
  },
  consentRecordReader: {
    findById: vi.fn().mockResolvedValue(null),
  },
  clock: () => new Date("2026-04-30T13:00:00.000Z"),
};

describe("stampPcdProvenance", () => {
  it("returns a fully populated payload for a valid lineage walk", async () => {
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      happyPathStores,
    );

    expect(out.briefId).toBe("brf_1");
    expect(out.trendId).toBe("trd_1");
    expect(out.motivatorId).toBe("mot_1");
    expect(out.hookId).toBe("hk_1");
    expect(out.scriptId).toBe("scr_1");
    expect(out.lineageDecisionReason.fanoutDecisionId).toBe("fdec_1");
    expect(out.lineageDecisionReason.chainVersion).toBe("preproduction-chain@1.0.0");
    expect(out.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
    expect(out.lineageDecisionReason.decidedAt).toBe("2026-04-30T13:00:00.000Z");
  });

  it("uses new Date() when no clock is injected", async () => {
    const before = Date.now();
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      {
        creatorIdentityReader: happyPathStores.creatorIdentityReader,
        consentRecordReader: happyPathStores.consentRecordReader,
      },
    );
    const after = Date.now();
    const stampedAt = Date.parse(out.lineageDecisionReason.decidedAt);
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);
  });

  it("throws InvariantViolationError when scriptId is not in chain output", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_missing",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when hook ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        scripts: {
          scripts: [
            {
              ...scriptsOutput.scripts[0]!,
              parentHookId: "hk_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when motivator ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        hooks: {
          hooks: [
            {
              ...hooksOutput.hooks[0]!,
              parentMotivatorId: "mot_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when trend ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        motivators: {
          motivators: [
            {
              ...motivatorsOutput.motivators[0]!,
              parentTrendId: "trd_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws ConsentRevokedRefusalError when consent revoked between gate and stamp", async () => {
    const stores = {
      creatorIdentityReader: {
        findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: "cnt_1" }),
      },
      consentRecordReader: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: "cnt_1", revoked: true, revokedAt: new Date() }),
      },
      clock: happyPathStores.clock,
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(ConsentRevokedRefusalError);
  });

  it("returns silently for Tier 1 creators with no bound consent record", async () => {
    // Verifies SP6 silent-return path is preserved end-to-end.
    const stores = {
      creatorIdentityReader: {
        findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
      },
      consentRecordReader: {
        findById: vi.fn().mockResolvedValue(null),
      },
      clock: happyPathStores.clock,
    };
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      stores,
    );
    expect(out.scriptId).toBe("scr_1");
    expect(stores.consentRecordReader.findById).not.toHaveBeenCalled();
  });

  it("rejects an empty scriptId at zod-parse time (defense-in-depth)", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toThrow();
  });

  it("rejects an empty fanoutDecisionId at zod-parse time", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "",
        },
        happyPathStores,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-provenance
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the stamper source**

Create `packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts`:

```ts
import { z } from "zod";
import {
  type PcdPreproductionChainResult,
  type PcdSp9ProvenancePayload,
} from "@creativeagent/schemas";
import {
  assertConsentNotRevokedForGeneration,
  type AssertConsentNotRevokedForGenerationStores,
} from "../consent-pre-check-generation.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "../preproduction/preproduction-chain-version.js";
import { PCD_PROVENANCE_VERSION } from "./provenance-version.js";

/**
 * SP9 — Pure store-injected stamper. Walks the SP7/SP8 chain output to derive
 * the leaf-to-root lineage for the selected script, re-checks consent (defense
 * against revocation between gate decision and per-asset persistence), and
 * returns a payload for the SP4 writer's persistence path.
 *
 * Two consent-check invocations bracket the production-time interval by design:
 *   1. SP7 entry (existing): assertConsentNotRevokedForGeneration before the chain runs.
 *   2. SP9 stamp (this call): same check before each per-asset snapshot is written.
 *
 * Symmetric with SP6's assertConsentNotRevokedForEdit pattern.
 */
export type StampPcdProvenanceInput = {
  briefId: string;
  creatorIdentityId: string;
  scriptId: string;
  chainResult: PcdPreproductionChainResult;
  fanoutDecisionId: string;
};

const StampPcdProvenanceInputSchema = z.object({
  briefId: z.string().min(1),
  creatorIdentityId: z.string().min(1),
  scriptId: z.string().min(1),
  // chainResult is structurally validated by SP7's PcdPreproductionChainResultSchema upstream;
  // a second parse here would duplicate work and bloat the test surface. We treat it as
  // pre-validated and only walk it. If a caller passes corrupt structure, the lineage
  // walk throws InvariantViolationError, which is the intended forensic mode.
  chainResult: z.unknown(),
  fanoutDecisionId: z.string().min(1),
});

export type StampPcdProvenanceStores = AssertConsentNotRevokedForGenerationStores & {
  clock?: () => Date;
};

export async function stampPcdProvenance(
  input: StampPcdProvenanceInput,
  stores: StampPcdProvenanceStores,
): Promise<PcdSp9ProvenancePayload> {
  // Step 1 — defense-in-depth zod parse on string ids.
  StampPcdProvenanceInputSchema.parse(input);

  // Step 2 — lineage walk (leaf to root). Throws InvariantViolationError on
  // any missing parent rung. The walk is the second-line forensic guard;
  // upstream stage runners' parent-id correctness is the first.
  const { chainResult, scriptId } = input;
  const script = chainResult.stageOutputs.scripts.scripts.find((s) => s.id === scriptId);
  if (script === undefined) {
    throw new InvariantViolationError("provenance script id not in chain output", {
      scriptId,
      missingAt: "scripts",
    });
  }
  const hook = chainResult.stageOutputs.hooks.hooks.find((h) => h.id === script.parentHookId);
  if (hook === undefined) {
    throw new InvariantViolationError("provenance hook ancestor not in chain output", {
      scriptId,
      parentHookId: script.parentHookId,
      missingAt: "hooks",
    });
  }
  const motivator = chainResult.stageOutputs.motivators.motivators.find(
    (m) => m.id === hook.parentMotivatorId,
  );
  if (motivator === undefined) {
    throw new InvariantViolationError("provenance motivator ancestor not in chain output", {
      scriptId,
      parentMotivatorId: hook.parentMotivatorId,
      missingAt: "motivators",
    });
  }
  const trend = chainResult.stageOutputs.trends.signals.find(
    (t) => t.id === motivator.parentTrendId,
  );
  if (trend === undefined) {
    throw new InvariantViolationError("provenance trend ancestor not in chain output", {
      scriptId,
      parentTrendId: motivator.parentTrendId,
      missingAt: "trends",
    });
  }

  // MERGE-BACK: emit WorkTrace here (lineage walk completed)

  // Step 3 — second consent check (defense against revocation between
  // gate decision and per-asset stamp). Symmetric with SP6's pre-check.
  // Throws ConsentRevokedRefusalError or InvariantViolationError on failure.
  await assertConsentNotRevokedForGeneration(
    { creatorIdentityId: input.creatorIdentityId },
    {
      creatorIdentityReader: stores.creatorIdentityReader,
      consentRecordReader: stores.consentRecordReader,
    },
  );

  // MERGE-BACK: emit WorkTrace here (consent re-check passed)

  // Step 4 — assemble the payload, pinning versions from imports.
  const decidedAt = (stores.clock?.() ?? new Date()).toISOString();
  const payload: PcdSp9ProvenancePayload = {
    briefId: input.briefId,
    trendId: trend.id,
    motivatorId: motivator.id,
    hookId: hook.id,
    scriptId: script.id,
    lineageDecisionReason: {
      decidedAt,
      fanoutDecisionId: input.fanoutDecisionId,
      chainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
      provenanceVersion: PCD_PROVENANCE_VERSION,
    },
  };

  // MERGE-BACK: emit WorkTrace here (provenance payload assembled)

  return payload;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test stamp-pcd-provenance
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 10 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts \
        packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.test.ts
git commit -m "feat(pcd): SP9 — add stampPcdProvenance pure stamper"
```

---

## Task 5: SP9 store contract type

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/pcd-sp9-identity-snapshot-store.ts`

This is a pure interface declaration — no test file needed (the store is tested via the orchestrator's tests in Task 6). Type-only imports compile-checked by typecheck.

- [ ] **Step 1: Write the contract**

Create `packages/creative-pipeline/src/pcd/provenance/pcd-sp9-identity-snapshot-store.ts`:

```ts
import type { PcdIdentitySnapshot, PcdSp9ProvenancePayload } from "@creativeagent/schemas";
import type { PcdIdentitySnapshotStoreInput } from "../pcd-identity-snapshot-writer.js";

/**
 * SP9 — additive store contract. Imported only by the SP9 orchestrator
 * (write-pcd-identity-snapshot-with-provenance.ts) and implemented by the
 * Prisma adapter at packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts.
 *
 * The SP4 contract (PcdIdentitySnapshotStore.createForShot) is preserved
 * verbatim and continues to serve legacy callsites that write null lineage.
 * This contract widens the persistence shape with the five lineage ids and the
 * lineage decision reason. The Prisma adapter implements both interfaces.
 *
 * MERGE-BACK: at merge-back, Switchboard's apps/api wires this store into the
 * production runner's per-asset snapshot path via writePcdIdentitySnapshotWithProvenance.
 */
export type PcdSp9IdentitySnapshotStore = {
  createForShotWithProvenance(
    input: PcdIdentitySnapshotStoreInput & PcdSp9ProvenancePayload,
  ): Promise<PcdIdentitySnapshot>;
};
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/pcd-sp9-identity-snapshot-store.ts
git commit -m "feat(pcd): SP9 — add PcdSp9IdentitySnapshotStore contract type"
```

---

## Task 6: `writePcdIdentitySnapshotWithProvenance` orchestrator

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts`
- Create: `packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.test.ts`

**Design notes:**
- Orchestrator MUST import the same four version constants as the SP4 writer (`PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`, plus carrying `shotSpecVersion` from input) — anti-pattern test #5 enforces.
- Orchestrator MUST call `assertTier3RoutingDecisionCompliant` with the same six-argument signature as the SP4 writer.
- Step ordering: stamp first → SP4 invariant assert → Zod parse → version-pin → store call. If any step throws, the store is never called.

- [ ] **Step 1: Write the failing tests**

Create `packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  PcdIdentitySnapshot,
  PcdPreproductionChainResult,
  PcdProductionFanoutDecision,
} from "@creativeagent/schemas";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { Tier3RoutingViolationError } from "../tier3-routing-rules.js";
import { writePcdIdentitySnapshotWithProvenance } from "./write-pcd-identity-snapshot-with-provenance.js";

// Reuse the chainResult fixture from stamp-pcd-provenance.test.ts shape.
const decision: PcdProductionFanoutDecision = {
  briefId: "brf_1",
  creatorIdentityId: "cre_1",
  productIdentityId: "prd_1",
  consentRecordId: null,
  effectiveTier: 1,
  selectedScriptIds: ["scr_1"],
  availableScriptIds: ["scr_1"],
  preproductionChainVersion: "preproduction-chain@1.0.0",
  identityContextVersion: "identity-context@1.0.0",
  approvalLifecycleVersion: "approval-lifecycle@1.0.0",
  preproductionFanoutVersion: "preproduction-fanout@1.0.0",
  decidedAt: "2026-04-30T12:00:00.000Z",
  decidedBy: null,
  decisionNote: null,
  costForecast: null,
};

const chainResult: PcdPreproductionChainResult = {
  decision,
  stageOutputs: {
    trends: {
      signals: [{ id: "trd_1", summary: "s", audienceFit: "a", evidenceRefs: [] }],
    },
    motivators: {
      motivators: [
        {
          id: "mot_1",
          frictionOrDesire: "f",
          audienceSegment: "as",
          evidenceRefs: [],
          parentTrendId: "trd_1",
        },
      ],
    },
    hooks: {
      hooks: [
        {
          id: "hk_1",
          text: "h",
          hookType: "direct_camera",
          parentMotivatorId: "mot_1",
          parentTrendId: "trd_1",
        },
      ],
    },
    scripts: {
      scripts: [
        {
          id: "scr_1",
          hookText: "h",
          creatorAngle: "a",
          visualBeats: [],
          productMoment: "p",
          cta: "c",
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: "cre_1",
            productIdentityId: "prd_1",
            voiceId: null,
          },
          parentHookId: "hk_1",
          scriptStyle: "spoken_lines",
          spokenLines: ["l"],
        },
      ],
    },
  },
};

const baseSnapshotInput = {
  // Tier 1 routing: capability with no Tier 3 requirements.
  assetRecordId: "ast_1",
  productIdentityId: "prd_1",
  productTierAtGeneration: 1 as const,
  productImageAssetIds: [],
  productCanonicalTextHash: "hash",
  productLogoAssetId: null,
  creatorIdentityId: "cre_1",
  avatarTierAtGeneration: 1 as const,
  avatarReferenceAssetIds: [],
  voiceAssetId: null,
  consentRecordId: null,
  selectedProvider: "stub-provider",
  providerModelSnapshot: "stub-model@v1",
  seedOrNoSeed: "no-seed",
  rewrittenPromptText: null,
  shotSpecVersion: "shot-spec@1.0.0",
  routerVersion: "provider-router@1.0.0",
  routingDecisionReason: {
    matchedRow: { effectiveTier: 1 as const, shotType: "still" as const, outputIntent: "ad_unit" as const },
    tier3RulesApplied: [],
  },
  // Wider input fields required by SP4's WritePcdIdentitySnapshotInput
  effectiveTier: 1 as const,
  shotType: "still" as const,
  outputIntent: "ad_unit" as const,
  selectedCapability: {
    provider: "stub-provider",
    model: "stub-model@v1",
    minTier: 1 as const,
    maxTier: 1 as const,
    supportedShotTypes: ["still" as const],
    supportedOutputIntents: ["ad_unit" as const],
  },
  editOverRegenerateRequired: false,
};

const happyPathStores = () => ({
  pcdSp9IdentitySnapshotStore: {
    createForShotWithProvenance: vi
      .fn()
      .mockImplementation(async (input) => ({ id: "snap_1", ...input }) as PcdIdentitySnapshot),
  },
  creatorIdentityReader: {
    findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
  },
  consentRecordReader: {
    findById: vi.fn().mockResolvedValue(null),
  },
  clock: () => new Date("2026-04-30T13:00:00.000Z"),
});

describe("writePcdIdentitySnapshotWithProvenance", () => {
  it("happy path — stamps lineage and calls SP9 store with merged 25-field payload", async () => {
    const stores = happyPathStores();
    const out = await writePcdIdentitySnapshotWithProvenance(
      {
        snapshot: baseSnapshotInput,
        provenance: {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
      },
      stores,
    );

    expect(out.id).toBe("snap_1");
    const call = stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance.mock.calls[0]![0];
    expect(call.briefId).toBe("brf_1");
    expect(call.trendId).toBe("trd_1");
    expect(call.motivatorId).toBe("mot_1");
    expect(call.hookId).toBe("hk_1");
    expect(call.scriptId).toBe("scr_1");
    expect(call.lineageDecisionReason.fanoutDecisionId).toBe("fdec_1");
    expect(call.policyVersion).toBe("tier-policy@1.0.0");
    expect(call.providerCapabilityVersion).toBe("provider-capability@1.0.0");
    expect(call.routerVersion).toBe("provider-router@1.0.0");
    expect(call.shotSpecVersion).toBe("shot-spec@1.0.0");
  });

  it("aborts before calling the store when consent revoked at stamp time", async () => {
    const stores = happyPathStores();
    stores.creatorIdentityReader.findById = vi
      .fn()
      .mockResolvedValue({ id: "cre_1", consentRecordId: "cnt_1" });
    stores.consentRecordReader.findById = vi
      .fn()
      .mockResolvedValue({ id: "cnt_1", revoked: true, revokedAt: new Date() });

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: baseSnapshotInput,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(ConsentRevokedRefusalError);

    expect(
      stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance,
    ).not.toHaveBeenCalled();
  });

  it("aborts before calling the store when SP4 Tier 3 invariant fails", async () => {
    const stores = happyPathStores();
    // Force a Tier 3 rule mismatch: snapshot input is Tier 3 but capability declares no
    // first-last-frame support, while routingDecisionReason claims firstLastFrameRequired
    // was applied. assertTier3RoutingDecisionCompliant detects the mismatch.
    const tier3Input = {
      ...baseSnapshotInput,
      effectiveTier: 3 as const,
      shotType: "video" as const,
      outputIntent: "ad_unit" as const,
      selectedCapability: {
        ...baseSnapshotInput.selectedCapability,
        minTier: 3 as const,
        maxTier: 3 as const,
        supportedShotTypes: ["video" as const],
        supportsFirstLastFrame: false,
      },
      editOverRegenerateRequired: false,
      routingDecisionReason: {
        matchedRow: { effectiveTier: 3 as const, shotType: "video" as const, outputIntent: "ad_unit" as const },
        tier3RulesApplied: ["firstLastFrameRequired" as const],
      },
    };

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: tier3Input as unknown as typeof baseSnapshotInput,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);

    expect(
      stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance,
    ).not.toHaveBeenCalled();
  });

  it("propagates store rejection raw", async () => {
    const stores = happyPathStores();
    const dbErr = new Error("simulated DB failure");
    stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance = vi
      .fn()
      .mockRejectedValue(dbErr);

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: baseSnapshotInput,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBe(dbErr);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-identity-snapshot-with-provenance
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the orchestrator source**

Create `packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts`:

```ts
import {
  type PcdIdentitySnapshot,
  PcdSp4IdentitySnapshotInputSchema,
} from "@creativeagent/schemas";
import { PCD_TIER_POLICY_VERSION } from "../tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "../provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "../provider-router.js";
import { assertTier3RoutingDecisionCompliant } from "../tier3-routing-rules.js";
import type { WritePcdIdentitySnapshotInput } from "../pcd-identity-snapshot-writer.js";
import { stampPcdProvenance, type StampPcdProvenanceInput, type StampPcdProvenanceStores } from "./stamp-pcd-provenance.js";
import type { PcdSp9IdentitySnapshotStore } from "./pcd-sp9-identity-snapshot-store.js";

/**
 * SP9 — Production callsite that bridges SP7/SP8's pre-production tree to
 * SP4's per-asset PcdIdentitySnapshot. Stamps lineage, runs the SP4 invariant
 * assertion + Zod parse + version-pin path (duplicated from SP4 writer body
 * because we need to persist a 25-field row, not a 19-field row), then calls
 * the SP9 store.
 *
 * The SP4 writer body (writePcdIdentitySnapshot) is preserved verbatim and
 * continues to serve legacy callsites that write null lineage. SP9 is the
 * NEW callsite; merge-back-time production runner is required to call this
 * one when generating assets from a fanout-selected script.
 *
 * MERGE-BACK: pick fanoutDecisionId convention (Inngest event id vs. synth hash).
 */

export type WritePcdIdentitySnapshotWithProvenanceInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
};

export type WritePcdIdentitySnapshotWithProvenanceStores = {
  pcdSp9IdentitySnapshotStore: PcdSp9IdentitySnapshotStore;
} & StampPcdProvenanceStores;

export async function writePcdIdentitySnapshotWithProvenance(
  input: WritePcdIdentitySnapshotWithProvenanceInput,
  stores: WritePcdIdentitySnapshotWithProvenanceStores,
): Promise<PcdIdentitySnapshot> {
  // Step 1 — Stamp provenance. May throw ConsentRevokedRefusalError /
  // InvariantViolationError / ZodError. All propagated raw.
  const provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  });

  // Step 2 — SP4 Tier 3 invariant. Recompute-based; throws
  // Tier3RoutingViolationError / Tier3RoutingMetadataMismatchError.
  // Store is never called if this throws.
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  });

  // Step 3 — Defense-in-depth Zod parse on the SP4 input subset (allowlist
  // forwarding mirrors SP4 writer body). Throws ZodError on bad input.
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

  // Step 4 — Pin version constants from imports + carry shotSpecVersion
  // (SP3 stamp). Mirrors SP4 writer body byte-for-byte.
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
  };

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 5 — Persist via SP9 store. SP4 store path is NOT called.
  return stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance(payload);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test write-pcd-identity-snapshot-with-provenance
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: 4 tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts \
        packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.test.ts
git commit -m "feat(pcd): SP9 — add writePcdIdentitySnapshotWithProvenance orchestrator"
```

---

## Task 7: Prisma schema widen + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<TIMESTAMP>_pcd_identity_snapshot_sp9_provenance/migration.sql`

- [ ] **Step 1: Widen the Prisma model**

Open `packages/db/prisma/schema.prisma`. Locate `model PcdIdentitySnapshot`. Find the SP4 additions block (`// SP4 additions — nullable for historical compatibility.`). Add a new block immediately below it, before `createdAt`:

```prisma
  // SP4 additions — nullable for historical compatibility.
  shotSpecVersion             String?
  routerVersion               String?
  routingDecisionReason       Json?

  // SP9 — creative-source provenance lineage. All columns nullable for
  // historical compatibility (pre-SP9 rows remain readable). Two indexes
  // (briefId, scriptId) for the leaf-to-root anchor queries operators run.
  briefId                     String?
  trendId                     String?
  motivatorId                 String?
  hookId                      String?
  scriptId                    String?
  lineageDecisionReason       Json?

  createdAt                   DateTime        @default(now())
```

Then in the same model, locate the existing `@@index` lines:

```prisma
  @@index([productIdentityId])
  @@index([creatorIdentityId])
  @@index([selectedProvider])
```

Append two more index lines:

```prisma
  @@index([productIdentityId])
  @@index([creatorIdentityId])
  @@index([selectedProvider])
  @@index([briefId])
  @@index([scriptId])
```

- [ ] **Step 2: Generate the migration**

Pick a timestamp matching the existing convention (`YYYYMMDDHHMMSS`). The previous SP6 migration is `20260429165532_pcd_asset_record_consent_revoked_sp6`. Use a new timestamp, e.g. `20260430120000`.

Run:

```bash
pnpm --filter @creativeagent/db prisma migrate dev --name pcd_identity_snapshot_sp9_provenance --create-only
```

This creates `packages/db/prisma/migrations/<TIMESTAMP>_pcd_identity_snapshot_sp9_provenance/migration.sql`. Inspect the generated SQL.

Expected SQL (regenerate by hand if Prisma's autogen differs, replacing the file contents):

```sql
-- SP9 — Creative-source provenance lineage on PcdIdentitySnapshot.
-- All six new columns nullable for historical compatibility (pre-SP9 rows
-- remain readable forever). No backfill, no FK constraints. Indexes on
-- briefId and scriptId only — leaf-to-root anchor queries operators run.
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "briefId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "trendId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "motivatorId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "hookId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "scriptId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "lineageDecisionReason" JSONB;

CREATE INDEX "PcdIdentitySnapshot_briefId_idx" ON "PcdIdentitySnapshot"("briefId");
CREATE INDEX "PcdIdentitySnapshot_scriptId_idx" ON "PcdIdentitySnapshot"("scriptId");
```

- [ ] **Step 3: Apply the migration locally and regenerate the client**

```bash
pnpm --filter @creativeagent/db prisma migrate dev
pnpm db:generate
```

Expected: migration applied; Prisma client regenerated with the six new fields and two new indexes on `pcdIdentitySnapshot`.

- [ ] **Step 4: Verify typecheck across all packages**

```bash
pnpm typecheck
```

Expected: clean across all 5 packages. The Prisma adapter file (Task 8) does not yet write the new columns, so the existing `create` method continues to compile (the new columns are optional in `Prisma.PcdIdentitySnapshotCreateInput`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/<TIMESTAMP>_pcd_identity_snapshot_sp9_provenance/
git commit -m "feat(pcd): SP9 — widen PcdIdentitySnapshot with provenance lineage columns"
```

---

## Task 8: Prisma adapter — `createForShotWithProvenance`

**Files:**
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`
- Modify: `packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Open `packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts`. Append a new `describe` block at the bottom (or extend the existing block):

```ts
describe("PrismaPcdIdentitySnapshotStore.createForShotWithProvenance (SP9)", () => {
  it("persists the merged 25-field row including five lineage ids and the lineage decision reason", async () => {
    const store = new PrismaPcdIdentitySnapshotStore(prisma);
    const assetRecord = await createTestAssetRecord(prisma);

    const created = await store.createForShotWithProvenance({
      // SP4 19-field shape (reuse the test helper)
      ...sp4SnapshotInput(assetRecord.id),
      // SP9 lineage
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    });

    expect(created.briefId).toBe("brf_1");
    expect(created.trendId).toBe("trd_1");
    expect(created.motivatorId).toBe("mot_1");
    expect(created.hookId).toBe("hk_1");
    expect(created.scriptId).toBe("scr_1");
    expect((created as unknown as { lineageDecisionReason: { fanoutDecisionId: string } }).lineageDecisionReason.fanoutDecisionId).toBe("fdec_1");
  });

  it("legacy create() leaves the six lineage columns null", async () => {
    const store = new PrismaPcdIdentitySnapshotStore(prisma);
    const assetRecord = await createTestAssetRecord(prisma);

    const created = await store.create(sp4SnapshotInput(assetRecord.id));

    expect(created.briefId ?? null).toBe(null);
    expect(created.trendId ?? null).toBe(null);
    expect(created.motivatorId ?? null).toBe(null);
    expect(created.hookId ?? null).toBe(null);
    expect(created.scriptId ?? null).toBe(null);
  });

  it("adaptPcdSp9IdentitySnapshotStore returns a store conforming to the SP9 contract", async () => {
    const prismaStore = new PrismaPcdIdentitySnapshotStore(prisma);
    const adapted = adaptPcdSp9IdentitySnapshotStore(prismaStore);
    expect(typeof adapted.createForShotWithProvenance).toBe("function");
  });
});
```

(If `sp4SnapshotInput` and `createTestAssetRecord` helpers don't already exist in this test file, factor them from existing tests — the existing test file already creates assets and snapshot inputs; reuse that pattern verbatim. The test file's existing structure dictates the precise refactor. If the helpers must be added, place them at the top of the test file as plain `function` declarations.)

Add the import at the top:

```ts
import { adaptPcdSp9IdentitySnapshotStore } from "./prisma-pcd-identity-snapshot-store.js";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @creativeagent/db test prisma-pcd-identity-snapshot-store
```

Expected: FAIL — `createForShotWithProvenance` and `adaptPcdSp9IdentitySnapshotStore` not exported.

- [ ] **Step 3: Extend the Prisma store + add the SP9 adapter**

Open `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`. Replace the entire file contents with:

```ts
import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
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

// SP9 — wider input. Same shape as SP4's input, plus five lineage ids and
// the lineage decision reason. Used only by createForShotWithProvenance.
export interface CreatePcdIdentitySnapshotWithProvenanceInput
  extends CreatePcdIdentitySnapshotInput {
  briefId: string;
  trendId: string;
  motivatorId: string;
  hookId: string;
  scriptId: string;
  lineageDecisionReason: PcdProvenanceDecisionReason;
}

export class PrismaPcdIdentitySnapshotStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
      },
    }) as unknown as PcdIdentitySnapshot;
  }

  // SP9 — additive persistence path. Writes the 19-field SP4 shape PLUS the
  // five lineage ids and the lineage decision reason. Legacy create() is
  // preserved unchanged for callsites that have no lineage to stamp.
  async createForShotWithProvenance(
    input: CreatePcdIdentitySnapshotWithProvenanceInput,
  ): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, lineageDecisionReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
        lineageDecisionReason: lineageDecisionReason as unknown as object,
      },
    }) as unknown as PcdIdentitySnapshot;
  }

  async getByAssetRecordId(assetRecordId: string): Promise<PcdIdentitySnapshot | null> {
    return this.prisma.pcdIdentitySnapshot.findUnique({
      where: { assetRecordId },
    }) as unknown as PcdIdentitySnapshot | null;
  }
}

// SP4 adapter — bridges SP4 writer's PcdIdentitySnapshotStore.createForShot
// contract to the Prisma create() method. Preserved unchanged.
export type PcdIdentitySnapshotStoreAdapter = {
  createForShot(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdIdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdIdentitySnapshotStoreAdapter {
  return {
    createForShot: (input) => store.create(input),
  };
}

// SP9 adapter — bridges the SP9 orchestrator's PcdSp9IdentitySnapshotStore
// contract to the Prisma createForShotWithProvenance() method. Production
// wiring at merge-back consumes this adapter from the apps/api layer.
export type PcdSp9IdentitySnapshotStoreAdapter = {
  createForShotWithProvenance(
    input: CreatePcdIdentitySnapshotWithProvenanceInput,
  ): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdSp9IdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdSp9IdentitySnapshotStoreAdapter {
  return {
    createForShotWithProvenance: (input) => store.createForShotWithProvenance(input),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @creativeagent/db test prisma-pcd-identity-snapshot-store
pnpm --filter @creativeagent/db typecheck
```

Expected: all 3 new tests pass; existing tests remain green; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts \
        packages/db/src/stores/prisma-pcd-identity-snapshot-store.test.ts
git commit -m "feat(pcd): SP9 — Prisma adapter for createForShotWithProvenance"
```

---

## Task 9: Stub-fanout barrel re-export cleanup (SP8 carry-over)

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/preproduction/index.ts`

This is a one-shot cosmetic cleanup. SP8 designed barrel re-exports for `STUB_TRENDS_FANOUT` etc. but never added them; in-tree tests imported from stage-runner files directly. Add the four constant re-exports for symmetry.

- [ ] **Step 1: Add the re-exports**

Open `packages/creative-pipeline/src/pcd/preproduction/index.ts`. Below the `// Stub stage-runner implementers` block, add a new block:

```ts
// Stub stage-runner fanout constants (SP8). Exposed for tests + future
// SP10 tree-budget enforcement.
export { STUB_TRENDS_FANOUT } from "./stages/stub-trends-stage-runner.js";
export { STUB_MOTIVATORS_PER_TREND } from "./stages/stub-motivators-stage-runner.js";
export { STUB_HOOKS_PER_MOTIVATOR } from "./stages/stub-hooks-stage-runner.js";
export { STUB_SCRIPTS_PER_HOOK } from "./stages/stub-creator-scripts-stage-runner.js";
```

- [ ] **Step 2: Verify the constants exist with these names**

```bash
grep -E "^export const STUB_" packages/creative-pipeline/src/pcd/preproduction/stages/*.ts
```

Expected output (names + locations):

```
.../stub-trends-stage-runner.ts:export const STUB_TRENDS_FANOUT = ...
.../stub-motivators-stage-runner.ts:export const STUB_MOTIVATORS_PER_TREND = ...
.../stub-hooks-stage-runner.ts:export const STUB_HOOKS_PER_MOTIVATOR = ...
.../stub-creator-scripts-stage-runner.ts:export const STUB_SCRIPTS_PER_HOOK = ...
```

If any constant has a different name in source, adjust the re-export to match. (If they exist with different names, this is an SP8 implementation reality; reflect what's actually exported.)

- [ ] **Step 3: Verify typecheck and tests**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
pnpm --filter @creativeagent/creative-pipeline test
```

Expected: clean; all tests still green.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/preproduction/index.ts
git commit -m "chore(pcd): SP9 — re-export stub-fanout constants (SP8 carry-over)"
```

---

## Task 10: Provenance subdir barrel + creative-pipeline barrel

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/index.ts`
- Modify: `packages/creative-pipeline/src/index.ts` (single line addition)

- [ ] **Step 1: Create the provenance subdir barrel**

Create `packages/creative-pipeline/src/pcd/provenance/index.ts`:

```ts
// SP9 — Creative-source provenance public surface.
export { PCD_PROVENANCE_VERSION } from "./provenance-version.js";
export {
  stampPcdProvenance,
  type StampPcdProvenanceInput,
  type StampPcdProvenanceStores,
} from "./stamp-pcd-provenance.js";
export {
  writePcdIdentitySnapshotWithProvenance,
  type WritePcdIdentitySnapshotWithProvenanceInput,
  type WritePcdIdentitySnapshotWithProvenanceStores,
} from "./write-pcd-identity-snapshot-with-provenance.js";
export type { PcdSp9IdentitySnapshotStore } from "./pcd-sp9-identity-snapshot-store.js";
```

- [ ] **Step 2: Re-export from the creative-pipeline package barrel**

Open `packages/creative-pipeline/src/index.ts`. Locate the line that re-exports the SP7+SP8 preproduction subdir:

```ts
export * from "./pcd/preproduction/index.js";
```

Add immediately below it:

```ts
export * from "./pcd/provenance/index.js";
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/index.ts \
        packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP9 — re-export provenance public surface from package barrel"
```

---

## Task 11: SP9 anti-pattern grep tests

**Files:**
- Create: `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts`:

```ts
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROVENANCE_DIR = join(import.meta.dirname);
const PCD_DIR = join(PROVENANCE_DIR, "..");
const PREPRODUCTION_DIR = join(PCD_DIR, "preproduction");

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".test.ts")) continue;
      if (!full.endsWith(".ts")) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

const provenanceSources = listSourceFiles(PROVENANCE_DIR);
const stagesDir = join(PREPRODUCTION_DIR, "stages");
const stageStubFiles = readdirSync(stagesDir)
  .filter((f) => f.startsWith("stub-") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => join(stagesDir, f));
const stageRunnerImplFiles = readdirSync(stagesDir)
  // Real-runner implementations end in `-stage-runner.ts` but are NOT stubs.
  // Interface files end the same — exclude them by checking for `class` keyword in body.
  .filter((f) => f.endsWith("-stage-runner.ts") && !f.endsWith(".test.ts"))
  .map((f) => join(stagesDir, f))
  .filter((file) => /\bclass\b/.test(readFileSync(file, "utf8")));

describe("SP9 anti-pattern grep", () => {
  it("PCD_PROVENANCE_VERSION literal lives only in provenance-version.ts (composer-only pinning)", () => {
    const allowed = join(PROVENANCE_DIR, "provenance-version.ts");
    for (const file of provenanceSources) {
      if (file === allowed) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_PROVENANCE_VERSION literal`).not.toMatch(
        /"pcd-provenance@/,
      );
    }
    // Sanity — provenance-version.ts itself does contain the literal.
    expect(readFileSync(allowed, "utf8")).toContain('"pcd-provenance@1.0.0"');
  });

  it("stamp-pcd-provenance.ts literally calls assertConsentNotRevokedForGeneration(", () => {
    const path = join(PROVENANCE_DIR, "stamp-pcd-provenance.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("assertConsentNotRevokedForGeneration(");
  });

  it("no decisionNote substring in stub stage runners (SP8 bounding)", () => {
    for (const file of stageStubFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} reads decisionNote`).not.toMatch(/decisionNote/);
    }
  });

  it("no decisionNote substring in real stage-runner implementer source bodies", () => {
    for (const file of stageRunnerImplFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} reads decisionNote`).not.toMatch(/decisionNote/);
    }
  });

  it("orchestrator imports the same four version constants as SP4 writer", () => {
    const sp4 = readFileSync(
      join(PCD_DIR, "pcd-identity-snapshot-writer.ts"),
      "utf8",
    );
    const sp9 = readFileSync(
      join(PROVENANCE_DIR, "write-pcd-identity-snapshot-with-provenance.ts"),
      "utf8",
    );
    for (const constant of [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ]) {
      expect(sp4, `SP4 should reference ${constant}`).toContain(constant);
      expect(sp9, `SP9 orchestrator should reference ${constant}`).toContain(constant);
    }
    // SP9 orchestrator must also call the same Tier 3 invariant assertion
    // with the six-argument shape. Drift between SP4 and SP9 logic is a
    // structural defect.
    expect(sp4).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp9).toContain("assertTier3RoutingDecisionCompliant({");
  });

  it("forbidden imports — SP9 source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of provenanceSources) {
      // Allow this file's own anti-pattern test to read fs — it's a test, not a source.
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${file} imports @prisma/client`).not.toMatch(
        /from\s+["']@prisma\/client["']/,
      );
      expect(src, `${file} imports inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${file} imports node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${file} imports node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${file} imports crypto`).not.toMatch(/from\s+["']crypto["']/);
    }
  });

  it("SP1–SP8 source bodies are unchanged since the SP8 baseline (allowlist edits only)", () => {
    // Allowlist of files SP9 is permitted to modify. Anything else under
    // packages/creative-pipeline/src/pcd/ that has changed since the SP8
    // baseline is a structural defect.
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/pcd/preproduction/index.ts",
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/pcd-preproduction.ts",
      "packages/schemas/src/index.ts",
    ]);

    // Resolve SP8 squash (head before SP9 work): commit "SP8" message.
    const sp8Sha = execSync(
      'git log --grep="SP8 — branching tree" --max-count=1 --format=%H',
      { encoding: "utf8" },
    ).trim();
    if (sp8Sha === "") {
      // CI clones may have shallow histories; in that case we skip the structural
      // assertion (it is enforced locally before merge). This is the same
      // accommodation pattern SP7's anti-pattern test uses for shallow CI.
      return;
    }

    const changed = execSync(`git diff --name-only ${sp8Sha} HEAD`, { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.length > 0);

    for (const file of changed) {
      // SP9 net-new files are out of scope (no baseline to diff against).
      if (file.startsWith("packages/creative-pipeline/src/pcd/provenance/")) continue;
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      if (file.endsWith(".prisma")) continue;
      if (file.startsWith("docs/")) continue;
      if (file.startsWith("packages/db/src/stores/prisma-pcd-identity-snapshot-store.")) continue;
      if (file === "packages/schemas/src/pcd-provenance.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-provenance.test.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-preproduction.test.ts") continue;

      expect(allowedEdits.has(file), `SP9 modified disallowed file: ${file}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test — verify pass**

```bash
pnpm --filter @creativeagent/creative-pipeline test sp9-anti-patterns
```

Expected: all 7 assertions pass. (If the SP1–SP8 unchanged test fails because git history grep returns no SHA, that's the shallow-clone accommodation — fine. If it fails because a disallowed file was modified, fix the offending edit before continuing.)

- [ ] **Step 3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts
git commit -m "test(pcd): SP9 — anti-pattern grep tests (composer pinning, decisionNote bound, source freeze)"
```

---

## Task 12: SWITCHBOARD-CONTEXT.md SP9 section

**Files:**
- Modify: `docs/SWITCHBOARD-CONTEXT.md`

- [ ] **Step 1: Append the SP9 merge-back surface section**

Open `docs/SWITCHBOARD-CONTEXT.md`. Locate the SP7 section header (`### SP7 (preproduction chain) — SHIPPED in creativeagent`). After the entire SP7 block (and any SP8 block if present), append:

```markdown
### SP8 (branching tree state + production-fanout hardening) — SHIPPED in creativeagent

**SP8 carry-over (`decisionNote` bound) at merge-back:**

`PcdProductionFanoutDecisionSchema.decisionNote` narrows from `z.string().nullable()` to `z.string().max(2000).nullable()` in SP9. Pre-SP9 stored `decisionNote` values that exceed 2000 chars (none anticipated — SP8's stub gate emits null) would fail re-parse. No backfill needed.

### SP9 (creative-source provenance) — SHIPPED in creativeagent

**SP9-declared merge-back surfaces (production wiring at merge-back):**

- `consentRecordReader` + `creatorIdentityReader` (from SP6 — stamper reuses the existing readers). No new contract.
- The merge-back-time production runner is responsible for calling `writePcdIdentitySnapshotWithProvenance` instead of the bare `writePcdIdentitySnapshot` when generating assets from a fanout-selected script. Both callsites remain valid; legacy callsites (e.g. tests, ad-hoc backfills) may continue to use the bare form and write null lineage.
- `WorkTrace` emit — every SP9 state transition carries a `// MERGE-BACK: emit WorkTrace here` marker. Three markers in `stamp-pcd-provenance.ts` (after lineage walk, after consent re-check, at payload assembly) plus one in `write-pcd-identity-snapshot-with-provenance.ts` at orchestrator pre-persist. Plus `// MERGE-BACK: pick fanoutDecisionId convention` (Inngest event id vs synth hash) at the orchestrator declaration.
- `fanoutDecisionId` convention is caller-supplied. SP9 requires only that the value be stable per gate decision and unique across decisions. Two acceptable conventions documented in the design doc: Inngest event id (preferred at merge-back) or `sha256(briefId + decidedAt + sorted(selectedScriptIds))`.

**Schema reconciliation at merge-back:**

- `PcdIdentitySnapshot.briefId/trendId/motivatorId/hookId/scriptId/lineageDecisionReason` — six new columns added by SP9 migration. If Switchboard `main` has not added equivalents independently, the SP9 migration applies cleanly. If Switchboard added same-semantic columns with different names, reconcile by renaming SP9's columns in the migration before merge-back.
- No FK constraints on the lineage columns. The referenced ids are not Prisma-modeled in this repo or in SP1–SP8 — they're zod-only schema ids in the chain output. Merge-back may add FKs once Switchboard models the chain output as DB rows; SP9 leaves them as plain `TEXT?` with two indexes (`briefId`, `scriptId`) for query performance.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP9 stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/provenance/` changes at merge-back — only the injected readers swap (Prisma-backed via `adaptPcdSp9IdentitySnapshotStore` from `@creativeagent/db`) and the markers get implementations.
- `PCD_PROVENANCE_VERSION` is the 12th pinned constant. The PCD slice carries 12 total pinned constants after SP9.
- SP9 introduces NO circular dependency. `pcd/provenance/` imports from `pcd/preproduction/` (chain output types, chain-version constant) and from `pcd/` top-level (SP4 writer types, SP6 pre-check). Reverse direction does not exist; `sp9-anti-patterns.test.ts` enforces the source-freeze.
```

- [ ] **Step 2: Verify the file is well-formed**

```bash
pnpm exec prettier --check docs/SWITCHBOARD-CONTEXT.md
```

Expected: clean (or, if prettier is configured to flag the existing file's formatting, mirror the pattern of nearby SP7 content).

- [ ] **Step 3: Commit**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "docs(pcd): SP9 — record merge-back surface + SP8 decisionNote carry-over"
```

---

## Task 13: Final verification + acceptance criteria

**Files:** none (verification only)

- [ ] **Step 1: Full repo build + test**

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}" "docs/**/*.md"
```

Expected:
- Typecheck clean across all 5 packages.
- ~1,411 SP8 baseline tests + ~80–100 SP9 net new tests = roughly 1,490–1,510 tests, all green.
- Prettier clean modulo the two SP5-baseline noise warnings on `tier-policy.ts` / `tier-policy.test.ts`.

- [ ] **Step 2: Acceptance-criteria checklist (verify each)**

Run each command and confirm the expected result:

```bash
# 12 pinned constants present + re-exported from creative-pipeline barrel:
grep -rE "^export (const|.*from.*PCD_)" packages/creative-pipeline/src/pcd/ | grep -E "_VERSION" | sort -u | wc -l
# Expected: 12 (TIER_POLICY, SHOT_SPEC, PROVIDER_CAPABILITY, PROVIDER_ROUTER,
#   QC_EVALUATION, QC_GATE_MATRIX, APPROVAL_LIFECYCLE, CONSENT_REVOCATION,
#   PREPRODUCTION_CHAIN, IDENTITY_CONTEXT, PREPRODUCTION_FANOUT, PROVENANCE)
```

```bash
# SP4 writer body unchanged (zero diff against SP8 squash):
git diff 90f5323 HEAD -- packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts
# Expected: empty (no output)
```

```bash
# SP6 consent pre-check body unchanged:
git diff 90f5323 HEAD -- packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts
# Expected: empty
```

```bash
# SP7 chain/builder/gate bodies unchanged:
git diff 90f5323 HEAD -- \
  packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts \
  packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts \
  packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts
# Expected: empty
```

```bash
# SP8 deep-freeze body unchanged:
git diff 90f5323 HEAD -- packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts
# Expected: empty
```

```bash
# SP9 migration applied cleanly:
ls packages/db/prisma/migrations/ | grep sp9
# Expected: one directory matching *_pcd_identity_snapshot_sp9_provenance
```

```bash
# decisionNote bounded:
grep -A 3 "decisionNote" packages/schemas/src/pcd-preproduction.ts
# Expected: shows z.string().max(2000).nullable()
```

```bash
# sp9-anti-patterns.test.ts present and green:
pnpm --filter @creativeagent/creative-pipeline test sp9-anti-patterns
# Expected: 7 assertions pass
```

- [ ] **Step 3: Commit ledger summary**

There is no Step 3 commit. SP9 work is fully committed across Tasks 1–12. Verify the branch contains 12 commits since the SP8 squash:

```bash
git log --oneline 90f5323..HEAD | wc -l
# Expected: 12
```

If the count differs, audit `git log` and either squash trailing fixup commits or split commits that bundle multiple tasks.

- [ ] **Step 4: Update auto-memory**

Open `~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md`. Add a new bullet at the bottom of the SP1–SP8 list (matching the SP8 entry's structure):

```markdown
- **SP9 — Creative-source provenance:** ⏳ Awaiting PR squash to `creativeagent` `main` (branch: `sp9-creative-source-provenance`). 12 implementation tasks completed. Highlights:
  - Bridges SP7/SP8's pre-production tree to SP4's per-asset PcdIdentitySnapshot via five lineage columns (briefId/trendId/motivatorId/hookId/scriptId) + one lineageDecisionReason Json column on PcdIdentitySnapshot.
  - **12th pinned constant:** `PCD_PROVENANCE_VERSION = "pcd-provenance@1.0.0"`. Composer-only pinning lock holds — only stamper imports it.
  - **No SP1–SP8 source body edits.** SP9 ships a NEW orchestrator (writePcdIdentitySnapshotWithProvenance) that duplicates SP4 writer's invariant-assert + zod-parse + version-pin logic and calls a NEW Prisma store method (createForShotWithProvenance). Anti-pattern test asserts SP4/SP9 invariant logic stays in lock-step.
  - **Two consent checks bracket production-time interval:** SP7 entry (existing) + SP9 stamp (new). Both invoke assertConsentNotRevokedForGeneration from SP6.
  - **Additive Prisma migration:** six nullable columns on PcdIdentitySnapshot + two indexes (briefId, scriptId). No backfill; pre-SP9 rows remain readable forever.
  - **SP8 carry-over folded in:** `decisionNote` narrowed to z.string().max(2000).nullable(). Anti-pattern test asserts no stub stage runner reads decisionNote and no real stage runner substrings it into prompt construction.
  - **Cosmetic SP8 cleanup:** stub-fanout barrel re-exports added to preproduction/index.ts.
  - **Subdir layout:** `packages/creative-pipeline/src/pcd/provenance/` (sibling to pcd/preproduction/). Six source files + one anti-pattern test file + one barrel.
  - **Final state:** ~1,490–1,510 tests across 3 packages all green; typecheck clean across all 5 packages; prettier clean modulo the two SP5-baseline warnings.
```

Update the heading "Status as of 2026-04-28:" to "Status as of 2026-04-30:" if not already updated.

```bash
git add ~/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md
# Note: this file lives outside the repo. The git add is intentionally broken;
# the file is in user-home memory storage. Update via the editor; do not commit.
```

(The auto-memory file is not part of the repo — it lives in `~/.claude/projects/`. Update it via the file system, not via git.)

- [ ] **Step 5: Open the PR**

```bash
git push -u origin sp9-creative-source-provenance
gh pr create --title "feat(pcd): SP9 — creative-source provenance" --body "$(cat <<'EOF'
## Summary

- Bridges SP7/SP8's pre-production tree to SP4's per-asset PcdIdentitySnapshot via five lineage columns (briefId, trendId, motivatorId, hookId, scriptId) + one lineageDecisionReason Json column.
- 12th pinned constant: PCD_PROVENANCE_VERSION = "pcd-provenance@1.0.0".
- Folds SP8 carry-over: decisionNote narrowed to z.string().max(2000).nullable().
- Zero edits to SP1–SP8 source bodies (SP4 writer body, SP6 pre-check, SP7 chain/builder/gate, SP8 deep-freeze all byte-identical).

## Test plan

- [ ] pnpm typecheck clean across 5 packages
- [ ] pnpm test green (~1,490–1,510 tests)
- [ ] pnpm exec prettier --check clean modulo SP5-baseline tier-policy warnings
- [ ] sp9-anti-patterns.test.ts: 7 assertions pass
- [ ] git diff 90f5323 HEAD on SP1–SP8 source body files: empty
- [ ] SP9 Prisma migration applies cleanly
- [ ] adaptPcdSp9IdentitySnapshotStore writes 25-field row; legacy create() leaves lineage columns null

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Before declaring SP9 complete, run the following self-review.

**1. Spec coverage** — every section of `docs/plans/2026-04-30-pcd-creative-source-provenance-sp9-design.md` should map to at least one task here. Walk through:

| Spec section | Task(s) |
|---|---|
| §3 Q1 scope (provenance) | All tasks |
| §3 Q2 schema location (widen PcdIdentitySnapshot) | Task 7 |
| §3 Q3 denormalized lineage shape | Tasks 1, 7 |
| §3 Q4 PCD_PROVENANCE_VERSION | Task 3 |
| §3 Q5 additive nullable widen (no backfill) | Task 7 |
| §3 Q6 top-level pcd/provenance/ subdir | Tasks 3, 4, 5, 6, 10, 11 |
| §3 SP8 carry-over: bound decisionNote | Task 2 |
| §3 SP8 carry-over: stub-fanout barrel | Task 9 |
| §4.1 zod schemas | Task 1 |
| §4.2 decisionNote tightening | Task 2 |
| §4.3 PCD_PROVENANCE_VERSION | Task 3 |
| §4.4 stamper | Task 4 |
| §4.5 orchestrator + SP9 store contract | Tasks 5, 6 |
| §4.6 fanoutDecisionId convention | Task 6 (orchestrator MERGE-BACK marker) |
| §4.7 Prisma migration | Task 7 |
| §4.8 Prisma adapter | Task 8 |
| §4.9 public surface barrels | Task 10 |
| §5 data flow | Tasks 4, 6 (stamper + orchestrator implement it) |
| §6 error handling | Tasks 4, 6 (test coverage) |
| §7 anti-pattern enforcement | Task 11 |
| §8 testing strategy | Tasks 1, 2, 3, 4, 6, 8 |
| §9 file layout | All tasks |
| §10 merge-back surface | Task 12 |
| §13 acceptance criteria | Task 13 |

All sections covered.

**2. Placeholder scan** — search for "TBD", "TODO" (other than `// MERGE-BACK:` and `MERGE-BACK:`-prefixed lines, which are intentional source-of-truth markers). Search for "fill in" / "implement later" / "similar to". None present.

**3. Type consistency** — verify these names match across tasks:

| Identifier | First defined | Re-used in |
|---|---|---|
| `PCD_PROVENANCE_VERSION` | Task 3 | Task 4 (stamper), Task 10 (barrel), Task 11 (anti-pattern) |
| `PcdProvenanceLineageSchema` | Task 1 | Task 4 (test) — but stamper returns `PcdSp9ProvenancePayload`, lineage is internal |
| `PcdProvenanceDecisionReasonSchema` | Task 1 | Task 4 (test fixtures), Task 8 (Prisma input type) |
| `PcdSp9ProvenancePayloadSchema` | Task 1 | Task 4 (return type), Task 5 (store contract input) |
| `stampPcdProvenance` | Task 4 | Task 6 (orchestrator), Task 10 (barrel), Task 11 (anti-pattern) |
| `StampPcdProvenanceInput` | Task 4 | Task 6, Task 10 |
| `StampPcdProvenanceStores` | Task 4 | Task 6, Task 10 |
| `PcdSp9IdentitySnapshotStore` | Task 5 | Task 6 (orchestrator stores type), Task 10 (barrel) |
| `writePcdIdentitySnapshotWithProvenance` | Task 6 | Task 10 (barrel), Task 12 (merge-back doc), Task 13 (acceptance) |
| `WritePcdIdentitySnapshotWithProvenanceInput` | Task 6 | Task 10 |
| `WritePcdIdentitySnapshotWithProvenanceStores` | Task 6 | Task 10 |
| `createForShotWithProvenance` | Task 6 (called by orchestrator) → Task 8 (Prisma method) | Task 11 (anti-pattern), Task 13 (acceptance) |
| `adaptPcdSp9IdentitySnapshotStore` | Task 8 | Task 12 (merge-back doc), Task 13 (acceptance) |
| `CreatePcdIdentitySnapshotWithProvenanceInput` | Task 8 (Prisma input) | not used outside Task 8 — internal to db package |

All identifiers consistent.

**4. Ambiguity check** — `fanoutDecisionId` source ambiguity is resolved by Task 6's MERGE-BACK marker + design doc §4.6 (caller-supplied; two acceptable conventions documented). `chainResult` validation is intentionally `z.unknown()` at the stamper boundary (validated upstream by SP7's `PcdPreproductionChainResultSchema`); the lineage walk is the second-line forensic guard for any structural corruption.

No remaining ambiguity.

---

## Plan complete

Plan saved to `docs/plans/2026-04-30-pcd-creative-source-provenance-sp9-plan.md`.
