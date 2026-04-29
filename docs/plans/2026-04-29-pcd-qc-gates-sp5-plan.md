# PCD SP5 — QC Gates Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship SP5 of the PCD vertical — a pure store-injected `evaluatePcdQcResult` orchestrator over four pure-async gate predicates (face/logo/OCR/geometry), governed by a declarative `PCD_QC_GATE_MATRIX`, persisting one forensic QC ledger row per generated asset via a new `PrismaPcdQcResultStore`.

**Architecture:** Additive widen of SP1's `ProductQcResult` table (six nullable columns + one non-null array column). Pure orchestration in `packages/creative-pipeline/src/pcd/`; provider contract surfaces shipped as types only (production implementations reserved for merge-back). Gate predicates know nothing about tier or shot type — matrix governs, predicates score. Hard-block invariant ("label-visible without OCR match → fail") encoded structurally end-to-end. SP5 ships zero approval/lifecycle/outbox surface; SP6 consumes the persisted row.

**Tech Stack:** TypeScript ESM, Vitest, Zod, Prisma 5, pnpm + Turborepo. Layer rules per `CLAUDE.md`: schemas (zod-only deps) → db (schemas + Prisma) → creative-pipeline (schemas + db + inngest).

**Source-of-truth design:** `docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md`. **Read this entirely before starting any task — it carries the binding invariants, the matrix authoring, and the seven applied review redlines.**

**Upstream context to read once before Task 0:**
- `CLAUDE.md` — repo conventions (ESM, `.js` extensions, no `any`, no `console.log`, Conventional Commits, co-located tests, 400-line soft / 600-line hard file limit).
- `docs/SWITCHBOARD-CONTEXT.md` — merge-back rules. SP5 needs `// MERGE-BACK:` markers on the three QC provider contracts.
- `docs/plans/2026-04-27-pcd-identity-registry-design.md` — sections "QC gates", "Architecture", "Identity snapshot", "Measurable QC metrics" (binding source-of-truth for SP5 scope).
- `docs/plans/2026-04-28-pcd-provider-router-sp4-design.md` — defines the `PcdIdentitySnapshot` row shape that SP5 reads as QC input.
- `packages/schemas/src/pcd-identity.ts` — existing SP1 schemas; SP5 widens `ProductQcResultSchema` here.
- `packages/db/prisma/schema.prisma` — existing `ProductQcResult` model. **Confirmed scalar columns already present:** `logoSimilarityScore`, `packageOcrMatchScore`, `colorDeltaScore`, `geometryMatchScore`, `scaleConfidence`, `passFail`, `warnings`, `productIdentityId`, `assetRecordId`. SP5 adds only `faceSimilarityScore` plus six forensic columns.

---

## File structure (locked)

**NEW files:**

```
packages/creative-pipeline/src/pcd/
  qc-evaluation-version.ts           # PCD_QC_EVALUATION_VERSION sibling const
  qc-providers.ts                    # SimilarityProvider, OcrProvider, GeometryProvider, PcdQcProviders types
  qc-gate-matrix.ts                  # PCD_QC_GATE_MATRIX, PCD_QC_GATE_MATRIX_VERSION, getPcdQcGateApplicability
  qc-gate-matrix.test.ts
  qc-aggregator.ts                   # applyPcdQcGateMode, aggregatePcdQcGateVerdicts
  qc-aggregator.test.ts
  qc-face-similarity.ts              # runFaceSimilarityGate + FACE_SIMILARITY_THRESHOLD
  qc-face-similarity.test.ts
  qc-logo-similarity.ts              # runLogoSimilarityGate + LOGO_SIMILARITY_THRESHOLD
  qc-logo-similarity.test.ts
  qc-ocr-match.ts                    # runOcrPackageTextGate + OCR_EDIT_DISTANCE_THRESHOLD
  qc-ocr-match.test.ts
  qc-geometry.ts                     # runGeometryScaleGate + GEOMETRY_SCORE_THRESHOLD + SCALE_CONFIDENCE_THRESHOLD
  qc-geometry.test.ts
  qc-evaluator.ts                    # evaluatePcdQcResult orchestrator
  qc-evaluator.test.ts

packages/db/src/stores/
  prisma-pcd-qc-result-store.ts      # PrismaPcdQcResultStore.createForAsset

packages/db/src/stores/__tests__/
  prisma-pcd-qc-result-store-sp5.test.ts

packages/schemas/src/__tests__/
  pcd-identity-sp5.test.ts

packages/db/prisma/migrations/<timestamp>_pcd_qc_result_sp5_gates/
  migration.sql                      # 7 columns added: 6 nullable + 1 non-null array default '{}'
```

**MODIFIED files:**

```
packages/schemas/src/pcd-identity.ts            # 7 new schemas/types + 7 fields on ProductQcResultSchema
packages/db/prisma/schema.prisma                # 7 new columns on ProductQcResult model
packages/creative-pipeline/src/index.ts         # SP5 re-exports
docs/SWITCHBOARD-CONTEXT.md                     # 2 lines: provider implementations + ProductQcResult naming reconciliation
```

**Untouched (forbidden to modify):** `registry-backfill.ts`, `tier-policy.ts`, `registry-resolver.ts`, `provider-router.ts`, `pcd-identity-snapshot-writer.ts`, `tier3-routing-rules.ts`, `provider-capability-matrix.ts`, all other `packages/db/src/stores/*`, `PcdIdentitySnapshot` Prisma model body, all other Prisma models.

---

## Task 0: Pre-flight — sync local with origin/main, branch, baseline

**Why:** Local main is currently behind origin/main (3 docs commits local-only; 1 SP4 implementation merge on origin not yet pulled). SP5 implementation must build on top of the actual SP4 source. Also baseline build/test green so any later red is SP5-caused.

**Files:** none modified; git operations only.

- [ ] **Step 0.1: Verify current state**

```bash
git status
git log --oneline -3
git fetch origin
git log --oneline origin/main -3
```

Expected: working tree clean, local HEAD shows the two SP5 design commits (`e6afacc` redlines + `4b0b522` initial spec), origin shows `05ffa25` SP4 merge.

- [ ] **Step 0.2: Rebase local onto origin/main**

```bash
git pull --rebase origin main
```

Expected: rebase succeeds, all SP4 source files (`provider-router.ts`, `tier3-routing-rules.ts`, `pcd-identity-snapshot-writer.ts`, `provider-capability-matrix.ts`, the two SP4 migrations, the `adapt*Store` adapter, etc.) now present in working tree. The two SP5 design doc commits sit on top.

- [ ] **Step 0.3: Verify SP4 source landed**

```bash
ls packages/creative-pipeline/src/pcd/ | sort
ls packages/db/prisma/migrations/ | sort
```

Expected: pipeline directory now contains `provider-router.ts`, `tier3-routing-rules.ts`, `pcd-identity-snapshot-writer.ts`, `provider-capability-matrix.ts` (all `.ts` + `.test.ts`). Migrations directory contains both SP1 migration plus the two SP4 migrations.

- [ ] **Step 0.4: Create SP5 feature branch**

```bash
git checkout -b feat/pcd-sp5-qc-gates
```

- [ ] **Step 0.5: Baseline install and build**

```bash
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all green. Test count should be ~1,024 (per memory: 941 creative-pipeline + 47 db + 36 schemas). If anything is red, stop and reconcile with the user before any SP5 work.

- [ ] **Step 0.6: Snapshot baseline test count**

```bash
pnpm test 2>&1 | grep -E "Tests +[0-9]+ passed" | tail -3
```

Record the baseline numbers (used in Task 18 to verify SP5 only adds tests, never breaks existing).

- [ ] **Step 0.7: Re-read the design doc end-to-end**

```bash
cat docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md | wc -l
```

Open `docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md` and read all seven sections. The plan below assumes you have the design's invariants in working memory — especially Section 3 (decision logic + invariants), the Evidence bounds binding rules, and the seven Q&A redlines.

---

## Task 1: Add Zod schemas — gate keys, status, mode, verdict, applicability

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts` (append after the existing `ProductQcResultSchema` definition)
- Test: `packages/schemas/src/__tests__/pcd-identity-sp5.test.ts` (new)

- [ ] **Step 1.1: Write failing test for gate-key/status/mode enums**

Create `packages/schemas/src/__tests__/pcd-identity-sp5.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PcdQcGateKeySchema,
  PcdQcGateStatusSchema,
  PcdQcAggregateStatusSchema,
  PcdQcGateModeSchema,
} from "../pcd-identity.js";

describe("SP5 enum schemas", () => {
  it("PcdQcGateKey accepts the four gate keys", () => {
    expect(PcdQcGateKeySchema.parse("face_similarity")).toBe("face_similarity");
    expect(PcdQcGateKeySchema.parse("logo_similarity")).toBe("logo_similarity");
    expect(PcdQcGateKeySchema.parse("ocr_package_text")).toBe("ocr_package_text");
    expect(PcdQcGateKeySchema.parse("geometry_scale")).toBe("geometry_scale");
  });

  it("PcdQcGateKey rejects unknown keys", () => {
    expect(() => PcdQcGateKeySchema.parse("color_delta")).toThrow();
  });

  it("PcdQcGateStatus accepts pass/warn/fail/skipped", () => {
    for (const s of ["pass", "warn", "fail", "skipped"] as const) {
      expect(PcdQcGateStatusSchema.parse(s)).toBe(s);
    }
  });

  it("PcdQcAggregateStatus rejects 'skipped'", () => {
    expect(() => PcdQcAggregateStatusSchema.parse("skipped")).toThrow();
  });

  it("PcdQcGateMode accepts block/warn_only and rejects 'skip'", () => {
    expect(PcdQcGateModeSchema.parse("block")).toBe("block");
    expect(PcdQcGateModeSchema.parse("warn_only")).toBe("warn_only");
    expect(() => PcdQcGateModeSchema.parse("skip")).toThrow();
  });
});
```

- [ ] **Step 1.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: FAIL — `PcdQcGateKeySchema` (and the others) not exported from `pcd-identity.js`.

- [ ] **Step 1.3: Add the enum schemas to `pcd-identity.ts`**

Append to `packages/schemas/src/pcd-identity.ts` (after the existing `ProductQcResultSchema` definition):

```ts
export const PcdQcGateKeySchema = z.enum([
  "face_similarity",
  "logo_similarity",
  "ocr_package_text",
  "geometry_scale",
]);
export type PcdQcGateKey = z.infer<typeof PcdQcGateKeySchema>;

export const PcdQcGateStatusSchema = z.enum(["pass", "warn", "fail", "skipped"]);
export type PcdQcGateStatus = z.infer<typeof PcdQcGateStatusSchema>;

export const PcdQcAggregateStatusSchema = z.enum(["pass", "warn", "fail"]);
export type PcdQcAggregateStatus = z.infer<typeof PcdQcAggregateStatusSchema>;

export const PcdQcGateModeSchema = z.enum(["block", "warn_only"]);
export type PcdQcGateMode = z.infer<typeof PcdQcGateModeSchema>;
```

- [ ] **Step 1.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: PASS — five tests green.

- [ ] **Step 1.5: Add verdict + verdicts + applicability schemas with tests**

Append to `pcd-identity-sp5.test.ts`:

```ts
import {
  PcdQcGateVerdictSchema,
  PcdQcGateVerdictsSchema,
  PcdQcGateApplicabilitySchema,
} from "../pcd-identity.js";

describe("SP5 verdict + applicability schemas", () => {
  it("PcdQcGateVerdict requires non-empty reason", () => {
    expect(() =>
      PcdQcGateVerdictSchema.parse({
        gate: "face_similarity",
        status: "pass",
        reason: "",
      }),
    ).toThrow();
  });

  it("PcdQcGateVerdict accepts skipped without score", () => {
    const v = PcdQcGateVerdictSchema.parse({
      gate: "face_similarity",
      status: "skipped",
      reason: "no creator references",
    });
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
  });

  it("PcdQcGateVerdict accepts evidence record", () => {
    const v = PcdQcGateVerdictSchema.parse({
      gate: "geometry_scale",
      status: "pass",
      score: 0.92,
      threshold: 0.8,
      reason: "geometry pass",
      evidence: { scaleConfidence: 0.95, editDistance: 12 },
    });
    expect(v.evidence?.scaleConfidence).toBe(0.95);
  });

  it("PcdQcGateVerdicts requires aggregateStatus", () => {
    const vs = PcdQcGateVerdictsSchema.parse({
      gates: [],
      aggregateStatus: "warn",
    });
    expect(vs.aggregateStatus).toBe("warn");
  });

  it("PcdQcGateApplicability requires shotType, effectiveTier, gate, mode", () => {
    const a = PcdQcGateApplicabilitySchema.parse({
      shotType: "label_closeup",
      effectiveTier: 3,
      gate: "ocr_package_text",
      mode: "block",
      rationale: "Tier 3 hard-blocks on OCR mismatch",
    });
    expect(a.mode).toBe("block");
  });
});
```

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: FAIL — schemas not yet exported.

- [ ] **Step 1.6: Add verdict + applicability schemas to `pcd-identity.ts`**

Append after the enum schemas:

```ts
export const PcdQcGateVerdictSchema = z.object({
  gate: PcdQcGateKeySchema,
  status: PcdQcGateStatusSchema,
  score: z.number().optional(),
  threshold: z.number().optional(),
  reason: z.string().min(1),
  // evidence is a small, non-PII, non-binary diagnostic bag. See design doc
  // "Evidence bounds (binding)" — no raw OCR text, no embeddings, no image
  // payloads, ≤2 KB JSON soft limit.
  evidence: z.record(z.unknown()).optional(),
});
export type PcdQcGateVerdict = z.infer<typeof PcdQcGateVerdictSchema>;

export const PcdQcGateVerdictsSchema = z.object({
  gates: z.array(PcdQcGateVerdictSchema),
  aggregateStatus: PcdQcAggregateStatusSchema,
});
export type PcdQcGateVerdicts = z.infer<typeof PcdQcGateVerdictsSchema>;

export const PcdQcGateApplicabilitySchema = z.object({
  shotType: PcdShotTypeSchema,
  effectiveTier: IdentityTierSchema,
  gate: PcdQcGateKeySchema,
  mode: PcdQcGateModeSchema,
  rationale: z.string().max(200).optional(),
});
export type PcdQcGateApplicability = z.infer<typeof PcdQcGateApplicabilitySchema>;
```

(`PcdShotTypeSchema` and `IdentityTierSchema` already exist in `pcd-identity.ts` from prior slices — no new import needed.)

- [ ] **Step 1.7: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: PASS — all tests green.

- [ ] **Step 1.8: Commit**

```bash
git add packages/schemas/src/pcd-identity.ts \
        packages/schemas/src/__tests__/pcd-identity-sp5.test.ts
git commit -m "feat(pcd): SP5 schemas — QC gate key/status/mode/verdict/applicability"
```

---

## Task 2: Widen `ProductQcResultSchema` with seven new fields

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts` (`ProductQcResultSchema` body)
- Test: `packages/schemas/src/__tests__/pcd-identity-sp5.test.ts` (append)

- [ ] **Step 2.1: Write failing test**

Append to `pcd-identity-sp5.test.ts`:

```ts
import { ProductQcResultSchema } from "../pcd-identity.js";

describe("SP5 ProductQcResultSchema widening", () => {
  it("parses pre-SP5 row (new fields absent / null / [] for gatesRan)", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_pre",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      passFail: "pass",
      warnings: [],
      createdAt: new Date(),
      // creatorIdentityId, pcdIdentitySnapshotId, faceSimilarityScore,
      // gatesRan, gateVerdicts, qcEvaluationVersion, qcGateMatrixVersion all absent
    });
    expect(row.creatorIdentityId).toBeUndefined();
    expect(row.gateVerdicts).toBeUndefined();
  });

  it("parses pre-SP5 row with gatesRan = [] (Postgres array default)", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_pre2",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      passFail: "warn",
      warnings: [],
      createdAt: new Date(),
      gatesRan: [],
    });
    expect(row.gatesRan).toEqual([]);
  });

  it("parses fully-populated SP5 row", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_sp5",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      creatorIdentityId: "creator_1",
      pcdIdentitySnapshotId: "snap_1",
      faceSimilarityScore: 0.91,
      gatesRan: ["face_similarity"],
      gateVerdicts: {
        gates: [
          {
            gate: "face_similarity",
            status: "pass",
            score: 0.91,
            threshold: 0.78,
            reason: "face similarity 0.910 >= threshold 0.78",
          },
        ],
        aggregateStatus: "pass",
      },
      qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
      qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
      passFail: "pass",
      warnings: [],
      createdAt: new Date(),
    });
    expect(row.qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(row.gateVerdicts?.aggregateStatus).toBe("pass");
  });
});
```

- [ ] **Step 2.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: FAIL — fields not on schema; `gateVerdicts` returns undefined for the SP5-row test, etc.

- [ ] **Step 2.3: Widen `ProductQcResultSchema`**

In `packages/schemas/src/pcd-identity.ts`, locate the existing `ProductQcResultSchema` definition. Append the seven new fields inside its `z.object({ ... })`:

```ts
export const ProductQcResultSchema = z.object({
  id: z.string(),
  productIdentityId: z.string(),
  assetRecordId: z.string(),
  logoSimilarityScore: z.number().min(0).max(1).nullable().optional(),
  packageOcrMatchScore: z.number().min(0).max(1).nullable().optional(),
  colorDeltaScore: z.number().min(0).nullable().optional(),
  geometryMatchScore: z.number().min(0).max(1).nullable().optional(),
  scaleConfidence: z.number().min(0).max(1).nullable().optional(),
  passFail: z.enum(["pass", "fail", "warn"]),
  warnings: z.array(z.string()),
  createdAt: z.coerce.date(),
  // SP5 additions — see docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md.
  // nullable = DB historical-compat (pre-SP5 rows).
  // optional = schema-compat for partial in-memory test fixtures.
  creatorIdentityId: z.string().nullable().optional(),
  pcdIdentitySnapshotId: z.string().nullable().optional(),
  faceSimilarityScore: z.number().min(0).max(1).nullable().optional(),
  gatesRan: z.array(PcdQcGateKeySchema).nullable().optional(),
  gateVerdicts: PcdQcGateVerdictsSchema.nullable().optional(),
  qcEvaluationVersion: z.string().nullable().optional(),
  qcGateMatrixVersion: z.string().nullable().optional(),
});
export type ProductQcResult = z.infer<typeof ProductQcResultSchema>;
```

- [ ] **Step 2.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: PASS — three new tests green.

- [ ] **Step 2.5: Commit**

```bash
git add packages/schemas/src/pcd-identity.ts \
        packages/schemas/src/__tests__/pcd-identity-sp5.test.ts
git commit -m "feat(pcd): SP5 schemas — widen ProductQcResultSchema with 7 forensic fields"
```

---

## Task 3: Add `PcdSp5QcLedgerInputSchema` with refines

**Files:**
- Modify: `packages/schemas/src/pcd-identity.ts`
- Test: `packages/schemas/src/__tests__/pcd-identity-sp5.test.ts`

- [ ] **Step 3.1: Write failing test for required forensic fields**

Append to `pcd-identity-sp5.test.ts`:

```ts
import { PcdSp5QcLedgerInputSchema } from "../pcd-identity.js";

describe("PcdSp5QcLedgerInputSchema", () => {
  const happy = () => ({
    assetRecordId: "asset_1",
    productIdentityId: "prod_1",
    pcdIdentitySnapshotId: "snap_1",
    creatorIdentityId: null,
    qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
    qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
    gateVerdicts: { gates: [], aggregateStatus: "warn" as const },
    gatesRan: [] as ("face_similarity" | "logo_similarity" | "ocr_package_text" | "geometry_scale")[],
    faceSimilarityScore: null,
    logoSimilarityScore: null,
    packageOcrMatchScore: null,
    geometryMatchScore: null,
    scaleConfidence: null,
    colorDeltaScore: null,
    passFail: "warn" as const,
    warnings: [] as string[],
  });

  it("accepts happy-path input", () => {
    expect(() => PcdSp5QcLedgerInputSchema.parse(happy())).not.toThrow();
  });

  it("rejects missing pcdIdentitySnapshotId", () => {
    const bad: any = happy();
    delete bad.pcdIdentitySnapshotId;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow();
  });

  it("rejects missing qcEvaluationVersion", () => {
    const bad: any = happy();
    delete bad.qcEvaluationVersion;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow();
  });

  it("rejects missing qcGateMatrixVersion", () => {
    const bad: any = happy();
    delete bad.qcGateMatrixVersion;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow();
  });

  it("rejects missing gateVerdicts", () => {
    const bad: any = happy();
    delete bad.gateVerdicts;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow();
  });

  it("rejects missing gatesRan", () => {
    const bad: any = happy();
    delete bad.gatesRan;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 3.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: FAIL — schema not exported.

- [ ] **Step 3.3: Add `PcdSp5QcLedgerInputSchema`**

Append to `pcd-identity.ts` after `ProductQcResultSchema`:

```ts
export const PcdSp5QcLedgerInputSchema = z
  .object({
    // Identity-side (required)
    assetRecordId: z.string(),
    productIdentityId: z.string(),
    pcdIdentitySnapshotId: z.string(),
    creatorIdentityId: z.string().nullable(),

    // Forensic version pins (REQUIRED, evaluator-pinned from imports)
    qcEvaluationVersion: z.string(),
    qcGateMatrixVersion: z.string(),

    // Gate result fields (REQUIRED)
    gateVerdicts: PcdQcGateVerdictsSchema,
    gatesRan: z.array(PcdQcGateKeySchema),

    // Per-gate scalar scores (nullable when gate skipped or not run)
    faceSimilarityScore: z.number().min(0).max(1).nullable(),
    logoSimilarityScore: z.number().min(0).max(1).nullable(),
    packageOcrMatchScore: z.number().min(0).max(1).nullable(),
    geometryMatchScore: z.number().min(0).max(1).nullable(),
    scaleConfidence: z.number().min(0).max(1).nullable(),
    colorDeltaScore: z.number().min(0).nullable(),

    // Aggregate (derived from gateVerdicts.aggregateStatus)
    passFail: z.enum(["pass", "fail", "warn"]),
    warnings: z.array(z.string()),
  })
  .refine(
    (v) =>
      !v.gatesRan.includes("face_similarity") ||
      (v.creatorIdentityId !== null && v.faceSimilarityScore !== null),
    {
      message:
        "creatorIdentityId and faceSimilarityScore required when face_similarity gate ran",
    },
  )
  .refine(
    (v) =>
      v.gatesRan.length === v.gateVerdicts.gates.length &&
      v.gatesRan.every((g, i) => g === v.gateVerdicts.gates[i].gate),
    { message: "gatesRan must equal gateVerdicts.gates[*].gate (same order)" },
  );
export type PcdSp5QcLedgerInput = z.infer<typeof PcdSp5QcLedgerInputSchema>;
```

- [ ] **Step 3.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: PASS — six new tests green.

- [ ] **Step 3.5: Add refine-rule tests**

Append to `pcd-identity-sp5.test.ts`:

```ts
describe("PcdSp5QcLedgerInputSchema refines", () => {
  const happy = () => ({
    assetRecordId: "asset_1",
    productIdentityId: "prod_1",
    pcdIdentitySnapshotId: "snap_1",
    creatorIdentityId: null,
    qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
    qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
    gateVerdicts: { gates: [], aggregateStatus: "warn" as const },
    gatesRan: [] as ("face_similarity" | "logo_similarity" | "ocr_package_text" | "geometry_scale")[],
    faceSimilarityScore: null,
    logoSimilarityScore: null,
    packageOcrMatchScore: null,
    geometryMatchScore: null,
    scaleConfidence: null,
    colorDeltaScore: null,
    passFail: "warn" as const,
    warnings: [] as string[],
  });

  it("rejects face in gatesRan + creatorIdentityId null", () => {
    const bad = happy();
    bad.gatesRan = ["face_similarity"];
    bad.gateVerdicts = {
      gates: [
        { gate: "face_similarity", status: "pass", score: 0.9, threshold: 0.78, reason: "ok" },
      ],
      aggregateStatus: "pass",
    };
    bad.creatorIdentityId = null;
    bad.faceSimilarityScore = 0.9;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow(
      /creatorIdentityId and faceSimilarityScore required/,
    );
  });

  it("rejects face in gatesRan + faceSimilarityScore null", () => {
    const bad = happy();
    bad.gatesRan = ["face_similarity"];
    bad.gateVerdicts = {
      gates: [
        { gate: "face_similarity", status: "pass", score: 0.9, threshold: 0.78, reason: "ok" },
      ],
      aggregateStatus: "pass",
    };
    bad.creatorIdentityId = "creator_1";
    bad.faceSimilarityScore = null;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow(
      /creatorIdentityId and faceSimilarityScore required/,
    );
  });

  it("rejects gatesRan order != gateVerdicts.gates order", () => {
    const bad = happy();
    bad.gatesRan = ["logo_similarity", "face_similarity"];
    bad.gateVerdicts = {
      gates: [
        { gate: "face_similarity", status: "pass", score: 0.9, threshold: 0.78, reason: "ok" },
        { gate: "logo_similarity", status: "pass", score: 0.9, threshold: 0.7, reason: "ok" },
      ],
      aggregateStatus: "pass",
    };
    bad.creatorIdentityId = "creator_1";
    bad.faceSimilarityScore = 0.9;
    expect(() => PcdSp5QcLedgerInputSchema.parse(bad)).toThrow(/same order/);
  });

  it("accepts face in gatesRan + creatorIdentityId + faceSimilarityScore present", () => {
    const ok = happy();
    ok.gatesRan = ["face_similarity"];
    ok.gateVerdicts = {
      gates: [
        { gate: "face_similarity", status: "pass", score: 0.9, threshold: 0.78, reason: "ok" },
      ],
      aggregateStatus: "pass",
    };
    ok.creatorIdentityId = "creator_1";
    ok.faceSimilarityScore = 0.9;
    ok.passFail = "pass";
    expect(() => PcdSp5QcLedgerInputSchema.parse(ok)).not.toThrow();
  });
});
```

Run: `pnpm --filter @creativeagent/schemas test -- pcd-identity-sp5`
Expected: PASS — all ten tests green (including the four refine tests).

- [ ] **Step 3.6: Commit**

```bash
git add packages/schemas/src/pcd-identity.ts \
        packages/schemas/src/__tests__/pcd-identity-sp5.test.ts
git commit -m "feat(pcd): SP5 schemas — PcdSp5QcLedgerInputSchema with refines"
```

---

## Task 4: Update Prisma schema and write the migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`ProductQcResult` model)
- Create: `packages/db/prisma/migrations/<timestamp>_pcd_qc_result_sp5_gates/migration.sql`

- [ ] **Step 4.1: Add the seven fields to the Prisma model**

In `packages/db/prisma/schema.prisma`, find the `ProductQcResult` model. Append the seven new fields just before the closing brace, before `@@index` lines:

```prisma
model ProductQcResult {
  id                    String          @id @default(cuid())
  productIdentityId     String
  productIdentity       ProductIdentity @relation(fields: [productIdentityId], references: [id], onDelete: Cascade)
  assetRecordId         String
  logoSimilarityScore   Float?
  packageOcrMatchScore  Float?
  colorDeltaScore       Float?
  geometryMatchScore    Float?
  scaleConfidence       Float?
  passFail              String
  warnings              String[]
  createdAt             DateTime        @default(now())

  // SP5 additions (nullable for historical compatibility; empty array for gatesRan)
  creatorIdentityId         String?
  pcdIdentitySnapshotId     String?
  faceSimilarityScore       Float?
  gatesRan                  String[]
  gateVerdicts              Json?
  qcEvaluationVersion       String?
  qcGateMatrixVersion       String?

  @@index([productIdentityId])
  @@index([assetRecordId])
  @@index([passFail])
}
```

(No new index on the SP5 columns — design decision in Section 5 hard guardrails.)

- [ ] **Step 4.2: Generate Prisma client**

```bash
pnpm db:generate
```

Expected: client regenerates without error.

- [ ] **Step 4.3: Create the migration directory and SQL**

Find the existing migrations directory:

```bash
ls packages/db/prisma/migrations/
```

Create a new directory using a fresh timestamp (use the format Prisma uses: `YYYYMMDDHHMMSS`). For example, if today is 2026-04-29, use `20260429120000_pcd_qc_result_sp5_gates`:

```bash
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "packages/db/prisma/migrations/${TS}_pcd_qc_result_sp5_gates"
```

Write the SQL to `packages/db/prisma/migrations/${TS}_pcd_qc_result_sp5_gates/migration.sql`:

```sql
-- SP5: add forensic gate-result columns to ProductQcResult.
-- Columns are nullable for historical compatibility (pre-SP5 / merge-back-time
-- Switchboard rows that predate this slice). SP5 evaluator treats them as
-- mandatory for any newly written QC ledger row. A future cleanup migration
-- may flip to NOT NULL once legacy rows are backfilled or archived.
--
-- gatesRan uses TEXT[] NOT NULL DEFAULT '{}' because Postgres array columns
-- can't be NULL the same way scalars are. Empty-array is the historical
-- equivalent of NULL for this column.

ALTER TABLE "ProductQcResult"
  ADD COLUMN "creatorIdentityId"        TEXT,
  ADD COLUMN "pcdIdentitySnapshotId"    TEXT,
  ADD COLUMN "faceSimilarityScore"      DOUBLE PRECISION,
  ADD COLUMN "gatesRan"                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "gateVerdicts"             JSONB,
  ADD COLUMN "qcEvaluationVersion"      TEXT,
  ADD COLUMN "qcGateMatrixVersion"      TEXT;
```

- [ ] **Step 4.4: Verify migration applies and Prisma is in sync**

```bash
pnpm db:migrate
```

Expected: migration applies; `prisma migrate dev` reports the schema is in sync. Re-run `pnpm db:generate` if needed.

If the local DB is not available (CI / clean checkout), this is the moment to run `pnpm exec prisma validate --schema=packages/db/prisma/schema.prisma` instead — that confirms the schema parses without applying.

- [ ] **Step 4.5: Run typecheck across packages**

```bash
pnpm typecheck
```

Expected: green. The Prisma generated types now include the seven new columns.

- [ ] **Step 4.6: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/*_pcd_qc_result_sp5_gates/migration.sql
git commit -m "feat(pcd): SP5 db — add 7 QC ledger forensic columns to ProductQcResult"
```

---

## Task 5: Add `PCD_QC_EVALUATION_VERSION` sibling const

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-evaluation-version.ts`

- [ ] **Step 5.1: Write the const file**

Create `packages/creative-pipeline/src/pcd/qc-evaluation-version.ts`:

```ts
// PCD QC evaluation contract version.
// Bumped when any predicate threshold changes, when the gate-verdict shape
// changes, or when aggregator/mode-lowering rules change. Matrix version is
// pinned separately as PCD_QC_GATE_MATRIX_VERSION (in qc-gate-matrix.ts).
export const PCD_QC_EVALUATION_VERSION = "pcd-qc-evaluation@1.0.0";
```

- [ ] **Step 5.2: Run typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: green.

- [ ] **Step 5.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-evaluation-version.ts
git commit -m "feat(pcd): SP5 — PCD_QC_EVALUATION_VERSION sibling const"
```

---

## Task 6: Add QC provider contract types

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-providers.ts`

- [ ] **Step 6.1: Write the contract module**

Create `packages/creative-pipeline/src/pcd/qc-providers.ts`:

```ts
// MERGE-BACK: replace with Switchboard QC provider contracts at merge-back time.
// SP5 ships only the contract surface; concrete production implementations
// land in Switchboard's QC service. In-tree consumers (predicates, tests)
// inject test stubs that conform to these types.

export type SimilarityProvider = {
  scoreFaceSimilarity(input: {
    creatorReferenceAssetIds: string[];
    candidateAssetId: string;
  }): Promise<{ score: number }>;
  scoreLogoSimilarity(input: {
    productLogoAssetId: string;
    candidateAssetId: string;
  }): Promise<{ score: number }>;
};

export type OcrProvider = {
  extractText(input: { candidateAssetId: string }): Promise<{ text: string }>;
};

export type GeometryProvider = {
  measure(input: {
    candidateAssetId: string;
    productDimensionsMm?: { h: number; w: number; d: number } | null;
    shotType: string;
  }): Promise<{ score: number; scaleConfidence: number }>;
};

export type PcdQcProviders = {
  similarityProvider: SimilarityProvider;
  ocrProvider: OcrProvider;
  geometryProvider: GeometryProvider;
};
```

- [ ] **Step 6.2: Run typecheck**

```bash
pnpm --filter @creativeagent/creative-pipeline typecheck
```

Expected: green.

- [ ] **Step 6.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-providers.ts
git commit -m "feat(pcd): SP5 — QC provider contract types (similarity/ocr/geometry)"
```

---

## Task 7: Build `PCD_QC_GATE_MATRIX` + `getPcdQcGateApplicability`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-gate-matrix.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-gate-matrix.test.ts`

- [ ] **Step 7.1: Write the failing test file (full)**

Create `packages/creative-pipeline/src/pcd/qc-gate-matrix.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IdentityTierSchema,
  PcdQcGateApplicabilitySchema,
  PcdShotTypeSchema,
  type IdentityTier,
  type PcdShotType,
} from "@creativeagent/schemas";
import {
  PCD_QC_GATE_MATRIX,
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./qc-gate-matrix.js";

describe("qc-gate-matrix — version pinning", () => {
  it("pins PCD_QC_GATE_MATRIX_VERSION to pcd-qc-gate-matrix@1.0.0", () => {
    expect(PCD_QC_GATE_MATRIX_VERSION).toBe("pcd-qc-gate-matrix@1.0.0");
  });
});

describe("qc-gate-matrix — shape", () => {
  it("every row passes PcdQcGateApplicabilitySchema", () => {
    for (const row of PCD_QC_GATE_MATRIX) {
      expect(() => PcdQcGateApplicabilitySchema.parse(row)).not.toThrow();
    }
  });

  it("no duplicate (shotType, effectiveTier, gate) triples", () => {
    const seen = new Set<string>();
    for (const row of PCD_QC_GATE_MATRIX) {
      const key = `${row.shotType}|${row.effectiveTier}|${row.gate}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(PCD_QC_GATE_MATRIX.length);
  });
});

describe("qc-gate-matrix — Tier 1 invariant (binding)", () => {
  it("PCD_QC_GATE_MATRIX has zero Tier 1 rows", () => {
    const tier1 = PCD_QC_GATE_MATRIX.filter((r) => r.effectiveTier === 1);
    expect(tier1).toEqual([]);
  });

  it("getPcdQcGateApplicability returns [] for Tier 1 + every shot type", () => {
    const allShotTypes: PcdShotType[] = [
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
    for (const shotType of allShotTypes) {
      const rows = getPcdQcGateApplicability({ shotType, effectiveTier: 1 });
      expect(rows).toEqual([]);
    }
  });
});

describe("qc-gate-matrix — coverage assertions (hand-listed in test)", () => {
  // The expected cells below are intentionally NOT imported from the matrix
  // module — listing them here independently prevents the "test imports same
  // wrong table" failure mode.
  it("Tier 2 + Tier 3 label_closeup includes ocr_package_text (mode: block)", () => {
    for (const tier of [2, 3] as IdentityTier[]) {
      const rows = getPcdQcGateApplicability({ shotType: "label_closeup", effectiveTier: tier });
      const ocr = rows.find((r) => r.gate === "ocr_package_text");
      expect(ocr).toBeDefined();
      expect(ocr?.mode).toBe("block");
    }
  });

  it("Tier 3 face_closeup includes face_similarity (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "face_closeup", effectiveTier: 3 });
    const face = rows.find((r) => r.gate === "face_similarity");
    expect(face).toBeDefined();
    expect(face?.mode).toBe("block");
  });

  it("Tier 3 product_in_hand includes geometry_scale (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "product_in_hand", effectiveTier: 3 });
    const geom = rows.find((r) => r.gate === "geometry_scale");
    expect(geom).toBeDefined();
    expect(geom?.mode).toBe("block");
  });

  it("Tier 3 object_insert includes geometry_scale + logo_similarity (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "object_insert", effectiveTier: 3 });
    const geom = rows.find((r) => r.gate === "geometry_scale");
    const logo = rows.find((r) => r.gate === "logo_similarity");
    expect(geom?.mode).toBe("block");
    expect(logo?.mode).toBe("block");
  });
});

describe("qc-gate-matrix — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(
      new URL("./qc-gate-matrix.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });
});
```

- [ ] **Step 7.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-gate-matrix`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7.3: Implement `qc-gate-matrix.ts`**

Create `packages/creative-pipeline/src/pcd/qc-gate-matrix.ts`:

```ts
import type {
  IdentityTier,
  PcdQcGateApplicability,
  PcdShotType,
} from "@creativeagent/schemas";

export const PCD_QC_GATE_MATRIX_VERSION = "pcd-qc-gate-matrix@1.0.0";

export const PCD_QC_GATE_MATRIX: ReadonlyArray<PcdQcGateApplicability> = [
  // OCR — label-visible shots
  { shotType: "label_closeup",   effectiveTier: 3, gate: "ocr_package_text", mode: "block",     rationale: "Label-visible Tier 3 final cannot ship without OCR match" },
  { shotType: "label_closeup",   effectiveTier: 2, gate: "ocr_package_text", mode: "block",     rationale: "Label-visible Tier 2 still requires OCR match" },
  { shotType: "product_demo",    effectiveTier: 3, gate: "ocr_package_text", mode: "block",     rationale: "Product demos at Tier 3 typically show readable label" },
  { shotType: "product_demo",    effectiveTier: 2, gate: "ocr_package_text", mode: "warn_only", rationale: "Tier 2 product_demo: OCR informational" },

  // Logo — package-visible shots
  { shotType: "label_closeup",   effectiveTier: 3, gate: "logo_similarity",  mode: "block" },
  { shotType: "label_closeup",   effectiveTier: 2, gate: "logo_similarity",  mode: "warn_only" },
  { shotType: "product_demo",    effectiveTier: 3, gate: "logo_similarity",  mode: "block" },
  { shotType: "product_demo",    effectiveTier: 2, gate: "logo_similarity",  mode: "warn_only" },
  { shotType: "product_in_hand", effectiveTier: 3, gate: "logo_similarity",  mode: "block" },
  { shotType: "product_in_hand", effectiveTier: 2, gate: "logo_similarity",  mode: "warn_only" },
  { shotType: "object_insert",   effectiveTier: 3, gate: "logo_similarity",  mode: "block" },
  { shotType: "simple_ugc",      effectiveTier: 3, gate: "logo_similarity",  mode: "warn_only" },

  // Face — face-visible shots
  { shotType: "face_closeup",    effectiveTier: 3, gate: "face_similarity",  mode: "block",     rationale: "Tier 3 face_closeup: identity drift hard-blocks" },
  { shotType: "talking_head",    effectiveTier: 3, gate: "face_similarity",  mode: "block" },
  { shotType: "talking_head",    effectiveTier: 2, gate: "face_similarity",  mode: "warn_only" },
  { shotType: "simple_ugc",      effectiveTier: 3, gate: "face_similarity",  mode: "warn_only" },
  { shotType: "simple_ugc",      effectiveTier: 2, gate: "face_similarity",  mode: "warn_only" },
  { shotType: "product_in_hand", effectiveTier: 3, gate: "face_similarity",  mode: "warn_only", rationale: "Face often visible holding product" },

  // Geometry / scale — product-in-hand and object-insert
  { shotType: "product_in_hand", effectiveTier: 3, gate: "geometry_scale",   mode: "block",     rationale: "Hand-product scale must match canonical dimensions" },
  { shotType: "product_in_hand", effectiveTier: 2, gate: "geometry_scale",   mode: "warn_only" },
  { shotType: "object_insert",   effectiveTier: 3, gate: "geometry_scale",   mode: "block" },
  { shotType: "object_insert",   effectiveTier: 2, gate: "geometry_scale",   mode: "warn_only" },

  // Tier 1: zero rows — by design. Future telemetry comes on via warn_only
  // rows + PCD_QC_GATE_MATRIX_VERSION bump. Zero orchestrator code change.
] as const;

export function getPcdQcGateApplicability(input: {
  shotType: PcdShotType;
  effectiveTier: IdentityTier;
}): PcdQcGateApplicability[] {
  return PCD_QC_GATE_MATRIX.filter(
    (row) => row.shotType === input.shotType && row.effectiveTier === input.effectiveTier,
  );
}
```

- [ ] **Step 7.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-gate-matrix`
Expected: PASS — all tests green.

- [ ] **Step 7.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-gate-matrix.ts \
        packages/creative-pipeline/src/pcd/qc-gate-matrix.test.ts
git commit -m "feat(pcd): SP5 — declarative PCD_QC_GATE_MATRIX with version pinning"
```

---

## Task 8: Build `applyPcdQcGateMode` + `aggregatePcdQcGateVerdicts`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-aggregator.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-aggregator.test.ts`

- [ ] **Step 8.1: Write the failing test file**

Create `packages/creative-pipeline/src/pcd/qc-aggregator.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PcdQcGateMode, PcdQcGateVerdict } from "@creativeagent/schemas";
import { aggregatePcdQcGateVerdicts, applyPcdQcGateMode } from "./qc-aggregator.js";

const v = (partial: Partial<PcdQcGateVerdict>): PcdQcGateVerdict => ({
  gate: "face_similarity",
  status: "pass",
  reason: "default",
  ...partial,
});

describe("applyPcdQcGateMode", () => {
  it("block mode + pass → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "pass" }), "block");
    expect(out.status).toBe("pass");
  });

  it("block mode + warn → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "warn" }), "block");
    expect(out.status).toBe("warn");
  });

  it("block mode + fail → unchanged (no downgrade)", () => {
    const out = applyPcdQcGateMode(v({ status: "fail", reason: "below threshold" }), "block");
    expect(out.status).toBe("fail");
    expect(out.reason).toBe("below threshold");
  });

  it("block mode + skipped → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "skipped" }), "block");
    expect(out.status).toBe("skipped");
  });

  it("warn_only mode + fail → warn, reason suffixed", () => {
    const out = applyPcdQcGateMode(v({ status: "fail", reason: "below threshold" }), "warn_only");
    expect(out.status).toBe("warn");
    expect(out.reason).toBe("below threshold (warn-only for this tier)");
  });

  it("warn_only mode + pass → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "pass" }), "warn_only");
    expect(out.status).toBe("pass");
  });

  it("warn_only mode + warn → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "warn" }), "warn_only");
    expect(out.status).toBe("warn");
  });

  it("warn_only mode + skipped → unchanged (skipped never lowered)", () => {
    const out = applyPcdQcGateMode(v({ status: "skipped" }), "warn_only");
    expect(out.status).toBe("skipped");
  });
});

describe("aggregatePcdQcGateVerdicts", () => {
  it("empty array → warn (skipped/unevaluated never aggregates to pass)", () => {
    const r = aggregatePcdQcGateVerdicts([]);
    expect(r.aggregateStatus).toBe("warn");
    expect(r.gates).toEqual([]);
  });

  it("all skipped → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "skipped" }),
      v({ gate: "logo_similarity", status: "skipped" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("mix of pass + skipped → pass", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "skipped" }),
    ]);
    expect(r.aggregateStatus).toBe("pass");
  });

  it("mix of pass + warn → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "warn" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("mix of pass + fail → fail", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "fail" }),
    ]);
    expect(r.aggregateStatus).toBe("fail");
  });

  it("all fail → fail", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "fail" }),
      v({ gate: "logo_similarity", status: "fail" }),
    ]);
    expect(r.aggregateStatus).toBe("fail");
  });

  it("all warn → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "warn" }),
      v({ gate: "logo_similarity", status: "warn" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("all pass → pass", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "pass" }),
    ]);
    expect(r.aggregateStatus).toBe("pass");
  });
});

describe("qc-aggregator — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(
      new URL("./qc-aggregator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });
});
```

- [ ] **Step 8.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-aggregator`
Expected: FAIL — module doesn't exist.

- [ ] **Step 8.3: Implement `qc-aggregator.ts`**

Create `packages/creative-pipeline/src/pcd/qc-aggregator.ts`:

```ts
import type {
  PcdQcAggregateStatus,
  PcdQcGateMode,
  PcdQcGateVerdict,
  PcdQcGateVerdicts,
} from "@creativeagent/schemas";

// warn_only lowers a fail to warn; never lowers skipped, never changes pass
// or warn. Mode lowering happens after the predicate returns and before
// aggregation. block mode never lowers anything.
export function applyPcdQcGateMode(
  verdict: PcdQcGateVerdict,
  mode: PcdQcGateMode,
): PcdQcGateVerdict {
  if (mode === "warn_only" && verdict.status === "fail") {
    return {
      ...verdict,
      status: "warn",
      reason: `${verdict.reason} (warn-only for this tier)`,
    };
  }
  return verdict;
}

// Aggregation rule (binding):
//   any fail            → "fail"
//   else any warn       → "warn"
//   else any pass       → "pass"
//   else (all skipped, or empty)   → "warn"
//
// The empty/all-skipped → "warn" rule is intentional. "warn" here means "QC
// was not conclusively pass" — NOT "a defect was detected." Consumers (SP6,
// future UI) MUST interpret "warn" as "not conclusively QC-passed". Skipped
// or unevaluated gates must not become implicit approval.
export function aggregatePcdQcGateVerdicts(
  verdicts: ReadonlyArray<PcdQcGateVerdict>,
): PcdQcGateVerdicts {
  let status: PcdQcAggregateStatus;
  if (verdicts.some((v) => v.status === "fail")) {
    status = "fail";
  } else if (verdicts.some((v) => v.status === "warn")) {
    status = "warn";
  } else if (verdicts.some((v) => v.status === "pass")) {
    status = "pass";
  } else {
    status = "warn";
  }
  return { gates: [...verdicts], aggregateStatus: status };
}
```

- [ ] **Step 8.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-aggregator`
Expected: PASS — all 18 tests green.

- [ ] **Step 8.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-aggregator.ts \
        packages/creative-pipeline/src/pcd/qc-aggregator.test.ts
git commit -m "feat(pcd): SP5 — applyPcdQcGateMode + aggregatePcdQcGateVerdicts"
```

---

## Task 9: Build `runFaceSimilarityGate`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-face-similarity.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-face-similarity.test.ts`

- [ ] **Step 9.1: Write the failing test file**

Create `packages/creative-pipeline/src/pcd/qc-face-similarity.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import {
  FACE_SIMILARITY_THRESHOLD,
  runFaceSimilarityGate,
} from "./qc-face-similarity.js";

const makeProviders = (
  scoreFaceImpl: PcdQcProviders["similarityProvider"]["scoreFaceSimilarity"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: scoreFaceImpl,
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure: vi.fn() },
});

describe("runFaceSimilarityGate", () => {
  it("skipped when creatorReferenceAssetIds is empty (no provider call)", async () => {
    const scoreFace = vi.fn();
    const providers = makeProviders(scoreFace);
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: [] },
      providers,
    );
    expect(v.gate).toBe("face_similarity");
    expect(v.status).toBe("skipped");
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
    expect(v.reason).toBeTruthy();
    expect(scoreFace).not.toHaveBeenCalled();
  });

  it("pass when score >= threshold", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD + 0.1 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBeCloseTo(FACE_SIMILARITY_THRESHOLD + 0.1);
    expect(v.threshold).toBe(FACE_SIMILARITY_THRESHOLD);
    expect(v.reason).toMatch(/face similarity/);
  });

  it("boundary: score === threshold → pass (>= semantics)", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("pass");
  });

  it("fail when score < threshold", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD - 0.1 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.score).toBeCloseTo(FACE_SIMILARITY_THRESHOLD - 0.1);
    expect(v.threshold).toBe(FACE_SIMILARITY_THRESHOLD);
    expect(v.reason).toContain("<");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("boom");
    });
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("boom");
    expect(v.reason).toContain("face similarity provider error");
  });

  it("reason is non-empty on every return path", async () => {
    const providers = makeProviders(async () => ({ score: 0.99 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.reason.length).toBeGreaterThan(0);
  });
});

describe("qc-face-similarity — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(
      new URL("./qc-face-similarity.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });

  it("does not import qc-gate-matrix.js or qc-evaluator.js (predicate independence)", () => {
    const src = readFileSync(
      new URL("./qc-face-similarity.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
```

- [ ] **Step 9.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-face-similarity`
Expected: FAIL — module doesn't exist.

- [ ] **Step 9.3: Implement `qc-face-similarity.ts`**

Create `packages/creative-pipeline/src/pcd/qc-face-similarity.ts`:

```ts
import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

// SP5-pinned threshold. Bumping this requires bumping
// PCD_QC_EVALUATION_VERSION (pcd-qc-evaluation@1.x.0).
export const FACE_SIMILARITY_THRESHOLD = 0.78;

export type FaceSimilarityGateInput = {
  candidateAssetId: string;
  creatorReferenceAssetIds: string[];
};

export async function runFaceSimilarityGate(
  input: FaceSimilarityGateInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  if (input.creatorReferenceAssetIds.length === 0) {
    return {
      gate: "face_similarity",
      status: "skipped",
      reason: "no creator reference assets available",
    };
  }
  try {
    const { score } = await providers.similarityProvider.scoreFaceSimilarity({
      creatorReferenceAssetIds: input.creatorReferenceAssetIds,
      candidateAssetId: input.candidateAssetId,
    });
    const status = score >= FACE_SIMILARITY_THRESHOLD ? "pass" : "fail";
    return {
      gate: "face_similarity",
      status,
      score,
      threshold: FACE_SIMILARITY_THRESHOLD,
      reason:
        status === "pass"
          ? `face similarity ${score.toFixed(3)} >= threshold ${FACE_SIMILARITY_THRESHOLD}`
          : `face similarity ${score.toFixed(3)} < threshold ${FACE_SIMILARITY_THRESHOLD}`,
    };
  } catch (err) {
    return {
      gate: "face_similarity",
      status: "fail",
      reason: `face similarity provider error: ${(err as Error).message}`,
    };
  }
}
```

- [ ] **Step 9.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-face-similarity`
Expected: PASS — all eight tests green.

- [ ] **Step 9.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-face-similarity.ts \
        packages/creative-pipeline/src/pcd/qc-face-similarity.test.ts
git commit -m "feat(pcd): SP5 — runFaceSimilarityGate predicate"
```

---

## Task 10: Build `runLogoSimilarityGate`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-logo-similarity.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-logo-similarity.test.ts`

- [ ] **Step 10.1: Write the failing test file**

Create `packages/creative-pipeline/src/pcd/qc-logo-similarity.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import {
  LOGO_SIMILARITY_THRESHOLD,
  runLogoSimilarityGate,
} from "./qc-logo-similarity.js";

const makeProviders = (
  scoreLogoImpl: PcdQcProviders["similarityProvider"]["scoreLogoSimilarity"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: scoreLogoImpl,
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure: vi.fn() },
});

describe("runLogoSimilarityGate", () => {
  it("skipped when productLogoAssetId is null (no provider call)", async () => {
    const scoreLogo = vi.fn();
    const providers = makeProviders(scoreLogo);
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: null },
      providers,
    );
    expect(v.status).toBe("skipped");
    expect(scoreLogo).not.toHaveBeenCalled();
    expect(v.score).toBeUndefined();
    expect(v.reason).toBeTruthy();
  });

  it("pass when score >= threshold", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD + 0.1 }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.threshold).toBe(LOGO_SIMILARITY_THRESHOLD);
  });

  it("boundary: score === threshold → pass", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("pass");
  });

  it("fail when score < threshold", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD - 0.1 }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("fail");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("net down");
    });
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("net down");
  });
});

describe("qc-logo-similarity — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(
      new URL("./qc-logo-similarity.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
```

- [ ] **Step 10.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-logo-similarity`
Expected: FAIL.

- [ ] **Step 10.3: Implement `qc-logo-similarity.ts`**

Create `packages/creative-pipeline/src/pcd/qc-logo-similarity.ts`:

```ts
import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

export const LOGO_SIMILARITY_THRESHOLD = 0.8;

export type LogoSimilarityGateInput = {
  candidateAssetId: string;
  productLogoAssetId: string | null;
};

export async function runLogoSimilarityGate(
  input: LogoSimilarityGateInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  if (input.productLogoAssetId === null) {
    return {
      gate: "logo_similarity",
      status: "skipped",
      reason: "no productLogoAssetId available",
    };
  }
  try {
    const { score } = await providers.similarityProvider.scoreLogoSimilarity({
      productLogoAssetId: input.productLogoAssetId,
      candidateAssetId: input.candidateAssetId,
    });
    const status = score >= LOGO_SIMILARITY_THRESHOLD ? "pass" : "fail";
    return {
      gate: "logo_similarity",
      status,
      score,
      threshold: LOGO_SIMILARITY_THRESHOLD,
      reason:
        status === "pass"
          ? `logo similarity ${score.toFixed(3)} >= threshold ${LOGO_SIMILARITY_THRESHOLD}`
          : `logo similarity ${score.toFixed(3)} < threshold ${LOGO_SIMILARITY_THRESHOLD}`,
    };
  } catch (err) {
    return {
      gate: "logo_similarity",
      status: "fail",
      reason: `logo similarity provider error: ${(err as Error).message}`,
    };
  }
}
```

- [ ] **Step 10.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-logo-similarity`
Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-logo-similarity.ts \
        packages/creative-pipeline/src/pcd/qc-logo-similarity.test.ts
git commit -m "feat(pcd): SP5 — runLogoSimilarityGate predicate"
```

---

## Task 11: Build `runOcrPackageTextGate`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-ocr-match.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-ocr-match.test.ts`

- [ ] **Step 11.1: Write the failing test file**

Create `packages/creative-pipeline/src/pcd/qc-ocr-match.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import {
  OCR_EDIT_DISTANCE_THRESHOLD,
  runOcrPackageTextGate,
} from "./qc-ocr-match.js";

const makeProviders = (
  extractText: PcdQcProviders["ocrProvider"]["extractText"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText },
  geometryProvider: { measure: vi.fn() },
});

describe("runOcrPackageTextGate", () => {
  it("skipped when productCanonicalText is null (no provider call)", async () => {
    const extract = vi.fn();
    const providers = makeProviders(extract);
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: null },
      providers,
    );
    expect(v.status).toBe("skipped");
    expect(extract).not.toHaveBeenCalled();
  });

  it("pass when extracted text matches canonical text exactly (ratio = 1.0)", async () => {
    const providers = makeProviders(async () => ({ text: "Acme Hot Sauce 8oz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBe(1);
    expect(v.threshold).toBe(OCR_EDIT_DISTANCE_THRESHOLD);
  });

  it("fail when extracted text deviates beyond threshold", async () => {
    const providers = makeProviders(async () => ({ text: "Bcme Cold Mustrd 99zz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.score).toBeLessThan(OCR_EDIT_DISTANCE_THRESHOLD);
  });

  it("evidence carries editDistanceRatio but NOT raw text (PII bounds)", async () => {
    const providers = makeProviders(async () => ({ text: "Acme Hot Sauce 8oz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.evidence?.editDistanceRatio).toBe(1);
    expect(v.evidence).not.toHaveProperty("text");
    expect(v.evidence).not.toHaveProperty("extractedText");
    expect(JSON.stringify(v.evidence)).not.toContain("Acme Hot Sauce 8oz");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("ocr down");
    });
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("ocr down");
  });
});

describe("qc-ocr-match — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-ocr-match.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
```

- [ ] **Step 11.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-ocr-match`
Expected: FAIL.

- [ ] **Step 11.3: Implement `qc-ocr-match.ts`**

Create `packages/creative-pipeline/src/pcd/qc-ocr-match.ts`:

```ts
import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

// Levenshtein-ratio threshold: 1.0 = exact, 0.0 = totally different.
// Pass requires ratio >= threshold. Bumping this requires bumping
// PCD_QC_EVALUATION_VERSION.
export const OCR_EDIT_DISTANCE_THRESHOLD = 0.85;

export type OcrPackageTextGateInput = {
  candidateAssetId: string;
  productCanonicalText: string | null;
};

// Pure Levenshtein implementation. We avoid raw text in the verdict's
// evidence bag (PII bounds, see design doc "Evidence bounds (binding)").
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function ratio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  const denom = Math.max(a.length, b.length);
  return 1 - dist / denom;
}

export async function runOcrPackageTextGate(
  input: OcrPackageTextGateInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  if (input.productCanonicalText === null) {
    return {
      gate: "ocr_package_text",
      status: "skipped",
      reason: "no productCanonicalText available",
    };
  }
  try {
    const { text } = await providers.ocrProvider.extractText({
      candidateAssetId: input.candidateAssetId,
    });
    const r = ratio(
      text.trim().toLowerCase(),
      input.productCanonicalText.trim().toLowerCase(),
    );
    const status = r >= OCR_EDIT_DISTANCE_THRESHOLD ? "pass" : "fail";
    // Evidence intentionally omits raw text — PII bounds.
    return {
      gate: "ocr_package_text",
      status,
      score: r,
      threshold: OCR_EDIT_DISTANCE_THRESHOLD,
      reason:
        status === "pass"
          ? `ocr edit-distance ratio ${r.toFixed(3)} >= threshold ${OCR_EDIT_DISTANCE_THRESHOLD}`
          : `ocr edit-distance ratio ${r.toFixed(3)} < threshold ${OCR_EDIT_DISTANCE_THRESHOLD}`,
      evidence: { editDistanceRatio: r },
    };
  } catch (err) {
    return {
      gate: "ocr_package_text",
      status: "fail",
      reason: `ocr provider error: ${(err as Error).message}`,
    };
  }
}
```

- [ ] **Step 11.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-ocr-match`
Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-ocr-match.ts \
        packages/creative-pipeline/src/pcd/qc-ocr-match.test.ts
git commit -m "feat(pcd): SP5 — runOcrPackageTextGate predicate (PII-safe evidence)"
```

---

## Task 12: Build `runGeometryScaleGate`

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-geometry.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-geometry.test.ts`

- [ ] **Step 12.1: Write the failing test file**

Create `packages/creative-pipeline/src/pcd/qc-geometry.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import {
  GEOMETRY_SCORE_THRESHOLD,
  SCALE_CONFIDENCE_THRESHOLD,
  runGeometryScaleGate,
} from "./qc-geometry.js";

const makeProviders = (
  measure: PcdQcProviders["geometryProvider"]["measure"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure },
});

describe("runGeometryScaleGate", () => {
  it("skipped when productDimensionsMm is null (no provider call)", async () => {
    const measure = vi.fn();
    const providers = makeProviders(measure);
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: null,
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("skipped");
    expect(measure).not.toHaveBeenCalled();
  });

  it("pass requires both score >= threshold AND scaleConfidence >= threshold", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD + 0.05,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD + 0.05,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBeCloseTo(GEOMETRY_SCORE_THRESHOLD + 0.05);
    expect(v.evidence?.scaleConfidence).toBeCloseTo(SCALE_CONFIDENCE_THRESHOLD + 0.05);
  });

  it("fail when geometry score is below threshold (even if scaleConfidence ok)", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD - 0.1,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD + 0.1,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("fail");
  });

  it("fail when scaleConfidence is below threshold (even if geometry ok)", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD + 0.1,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD - 0.1,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("fail");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("geom down");
    });
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "object_insert",
      },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("geom down");
  });
});

describe("qc-geometry — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-geometry.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
```

- [ ] **Step 12.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-geometry`
Expected: FAIL.

- [ ] **Step 12.3: Implement `qc-geometry.ts`**

Create `packages/creative-pipeline/src/pcd/qc-geometry.ts`:

```ts
import type { PcdQcGateVerdict, PcdShotType } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

// SP5-pinned thresholds. Both must clear for pass.
export const GEOMETRY_SCORE_THRESHOLD = 0.75;
export const SCALE_CONFIDENCE_THRESHOLD = 0.7;

export type GeometryScaleGateInput = {
  candidateAssetId: string;
  productDimensionsMm: { h: number; w: number; d: number } | null;
  shotType: PcdShotType;
};

export async function runGeometryScaleGate(
  input: GeometryScaleGateInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  if (input.productDimensionsMm === null) {
    return {
      gate: "geometry_scale",
      status: "skipped",
      reason: "no productDimensionsMm available",
    };
  }
  try {
    const { score, scaleConfidence } = await providers.geometryProvider.measure({
      candidateAssetId: input.candidateAssetId,
      productDimensionsMm: input.productDimensionsMm,
      shotType: input.shotType,
    });
    const geometryOk = score >= GEOMETRY_SCORE_THRESHOLD;
    const scaleOk = scaleConfidence >= SCALE_CONFIDENCE_THRESHOLD;
    const status = geometryOk && scaleOk ? "pass" : "fail";
    return {
      gate: "geometry_scale",
      status,
      score,
      threshold: GEOMETRY_SCORE_THRESHOLD,
      reason:
        status === "pass"
          ? `geometry ${score.toFixed(3)} >= ${GEOMETRY_SCORE_THRESHOLD} AND scaleConfidence ${scaleConfidence.toFixed(3)} >= ${SCALE_CONFIDENCE_THRESHOLD}`
          : `geometry ${score.toFixed(3)} (>=${GEOMETRY_SCORE_THRESHOLD}=${geometryOk}) OR scaleConfidence ${scaleConfidence.toFixed(3)} (>=${SCALE_CONFIDENCE_THRESHOLD}=${scaleOk}) failed`,
      evidence: { scaleConfidence },
    };
  } catch (err) {
    return {
      gate: "geometry_scale",
      status: "fail",
      reason: `geometry provider error: ${(err as Error).message}`,
    };
  }
}
```

- [ ] **Step 12.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-geometry`
Expected: PASS.

- [ ] **Step 12.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-geometry.ts \
        packages/creative-pipeline/src/pcd/qc-geometry.test.ts
git commit -m "feat(pcd): SP5 — runGeometryScaleGate predicate (dual-threshold)"
```

---

## Task 13: Build `evaluatePcdQcResult` orchestrator (skeleton + dispatch)

This is the slice's heart. It's split across Tasks 13–15: skeleton + dispatch (13), aggregation + persistence (14), full integration tests (15).

**Files:**
- Create: `packages/creative-pipeline/src/pcd/qc-evaluator.ts`
- Create: `packages/creative-pipeline/src/pcd/qc-evaluator.test.ts`

- [ ] **Step 13.1: Write a minimal failing test for matrix-driven dispatch**

Create `packages/creative-pipeline/src/pcd/qc-evaluator.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  PcdIdentitySnapshot,
  PcdSp5QcLedgerInput,
  ProductQcResult,
} from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";
import type { PcdQcLedgerStore } from "./qc-evaluator.js";
import { evaluatePcdQcResult } from "./qc-evaluator.js";

const makeSnapshot = (overrides: Partial<PcdIdentitySnapshot> = {}): PcdIdentitySnapshot => ({
  id: "snap_1",
  assetRecordId: "asset_1",
  productIdentityId: "prod_1",
  productTierAtGeneration: 3,
  productImageAssetIds: ["img_a"],
  productCanonicalTextHash: "hash_a",
  productLogoAssetId: "logo_1",
  creatorIdentityId: "creator_1",
  avatarTierAtGeneration: 3,
  avatarReferenceAssetIds: ["ref_a", "ref_b"],
  voiceAssetId: null,
  consentRecordId: null,
  policyVersion: "tier-policy@1.0.0",
  providerCapabilityVersion: "provider-capability@1.0.0",
  selectedProvider: "kling",
  providerModelSnapshot: "kling-2",
  seedOrNoSeed: "no-seed",
  rewrittenPromptText: null,
  shotSpecVersion: "shot-spec@1.0.0",
  routerVersion: "provider-router@1.0.0",
  routingDecisionReason: null,
  createdAt: new Date(),
  ...overrides,
});

const makeProviders = () => {
  const scoreFaceSimilarity = vi.fn(async () => ({ score: 0.9 }));
  const scoreLogoSimilarity = vi.fn(async () => ({ score: 0.9 }));
  const extractText = vi.fn(async () => ({ text: "Acme Hot Sauce 8oz" }));
  const measure = vi.fn(async () => ({ score: 0.9, scaleConfidence: 0.85 }));
  const providers: PcdQcProviders = {
    similarityProvider: { scoreFaceSimilarity, scoreLogoSimilarity },
    ocrProvider: { extractText },
    geometryProvider: { measure },
  };
  return { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure };
};

const makeStore = () => {
  const calls: PcdSp5QcLedgerInput[] = [];
  const fakeRow = (input: PcdSp5QcLedgerInput): ProductQcResult => ({
    id: "qc_row_1",
    productIdentityId: input.productIdentityId,
    assetRecordId: input.assetRecordId,
    creatorIdentityId: input.creatorIdentityId,
    pcdIdentitySnapshotId: input.pcdIdentitySnapshotId,
    logoSimilarityScore: input.logoSimilarityScore,
    packageOcrMatchScore: input.packageOcrMatchScore,
    colorDeltaScore: input.colorDeltaScore,
    geometryMatchScore: input.geometryMatchScore,
    scaleConfidence: input.scaleConfidence,
    faceSimilarityScore: input.faceSimilarityScore,
    passFail: input.passFail,
    warnings: input.warnings,
    gatesRan: input.gatesRan,
    gateVerdicts: input.gateVerdicts,
    qcEvaluationVersion: input.qcEvaluationVersion,
    qcGateMatrixVersion: input.qcGateMatrixVersion,
    createdAt: new Date(),
  });
  const store: PcdQcLedgerStore = {
    createForAsset: async (input) => {
      calls.push(input);
      return fakeRow(input);
    },
  };
  return { store, calls };
};

describe("evaluatePcdQcResult — Tier 1 (zero matrix rows, zero providers called)", () => {
  it("calls no providers and writes empty-gates row with passFail=warn", async () => {
    const { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure } =
      makeProviders();
    const { store, calls } = makeStore();

    const row = await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "simple_ugc",
        effectiveTier: 1,
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 1, productTierAtGeneration: 1 }),
        productLogoAssetId: "logo_1",
        productCanonicalText: "Acme Hot Sauce 8oz",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(scoreFaceSimilarity).not.toHaveBeenCalled();
    expect(scoreLogoSimilarity).not.toHaveBeenCalled();
    expect(extractText).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(calls.length).toBe(1);
    expect(calls[0].gatesRan).toEqual([]);
    expect(calls[0].gateVerdicts.gates).toEqual([]);
    expect(calls[0].passFail).toBe("warn");
    expect(row.passFail).toBe("warn");
  });
});
```

- [ ] **Step 13.2: Run test, verify failure**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-evaluator`
Expected: FAIL — module doesn't exist.

- [ ] **Step 13.3: Implement skeleton + dispatch + Tier 1 path**

Create `packages/creative-pipeline/src/pcd/qc-evaluator.ts`:

```ts
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdQcGateApplicability,
  PcdQcGateKey,
  PcdQcGateVerdict,
  PcdShotType,
  PcdSp5QcLedgerInput,
  ProductQcResult,
} from "@creativeagent/schemas";
import { PcdSp5QcLedgerInputSchema } from "@creativeagent/schemas";
import { PCD_QC_EVALUATION_VERSION } from "./qc-evaluation-version.js";
import {
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./qc-gate-matrix.js";
import {
  applyPcdQcGateMode,
  aggregatePcdQcGateVerdicts,
} from "./qc-aggregator.js";
import { runFaceSimilarityGate } from "./qc-face-similarity.js";
import { runLogoSimilarityGate } from "./qc-logo-similarity.js";
import { runOcrPackageTextGate } from "./qc-ocr-match.js";
import { runGeometryScaleGate } from "./qc-geometry.js";
import type { PcdQcProviders } from "./qc-providers.js";

export type PcdQcLedgerStore = {
  createForAsset(input: PcdSp5QcLedgerInput): Promise<ProductQcResult>;
};

export type EvaluatePcdQcResultInput = {
  assetRecordId: string;
  shotType: PcdShotType;
  effectiveTier: IdentityTier;
  identitySnapshot: PcdIdentitySnapshot;
  productLogoAssetId: string | null;
  productCanonicalText: string | null;
  productDimensionsMm: { h: number; w: number; d: number } | null;
};

export type EvaluatePcdQcResultStores = {
  qcLedgerStore: PcdQcLedgerStore;
};

// Predicate dispatch — switch on row.gate is the single allowed string-keyed
// dispatch in this module. Anti-pattern grep tests forbid `if (row.gate ===`
// outside this switch.
async function runGate(
  row: PcdQcGateApplicability,
  input: EvaluatePcdQcResultInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  switch (row.gate) {
    case "face_similarity":
      return runFaceSimilarityGate(
        {
          candidateAssetId: input.assetRecordId,
          creatorReferenceAssetIds: input.identitySnapshot.avatarReferenceAssetIds,
        },
        providers,
      );
    case "logo_similarity":
      return runLogoSimilarityGate(
        {
          candidateAssetId: input.assetRecordId,
          productLogoAssetId: input.productLogoAssetId,
        },
        providers,
      );
    case "ocr_package_text":
      return runOcrPackageTextGate(
        {
          candidateAssetId: input.assetRecordId,
          productCanonicalText: input.productCanonicalText,
        },
        providers,
      );
    case "geometry_scale":
      return runGeometryScaleGate(
        {
          candidateAssetId: input.assetRecordId,
          productDimensionsMm: input.productDimensionsMm,
          shotType: input.shotType,
        },
        providers,
      );
  }
}

// Scalar-score extraction — persistence mapping, not policy. Anti-pattern
// grep tests permit gate-key string literals here.
function verdictByGate(
  verdicts: ReadonlyArray<PcdQcGateVerdict>,
  gate: PcdQcGateKey,
): PcdQcGateVerdict | undefined {
  return verdicts.find((v) => v.gate === gate);
}

export async function evaluatePcdQcResult(
  input: EvaluatePcdQcResultInput,
  providers: PcdQcProviders,
  stores: EvaluatePcdQcResultStores,
): Promise<ProductQcResult> {
  // Step 1 — Matrix lookup. Tier 1 returns []; Tier 2/3 returns the rows for
  // this (shotType, effectiveTier).
  const applicability = getPcdQcGateApplicability({
    shotType: input.shotType,
    effectiveTier: input.effectiveTier,
  });

  // Step 2 — Run applicable predicates in parallel. Empty applicability →
  // Promise.all([]) short-circuits with no provider calls.
  const raw = await Promise.all(
    applicability.map(async (row) => ({
      row,
      verdict: await runGate(row, input, providers),
    })),
  );

  // Step 3 — Apply mode lowering (warn_only: fail → warn).
  const moded = raw.map(({ row, verdict }) => applyPcdQcGateMode(verdict, row.mode));

  // Step 4 — Aggregate.
  const gateVerdicts = aggregatePcdQcGateVerdicts(moded);
  const gatesRan: PcdQcGateKey[] = moded.map((v) => v.gate);

  // Step 5 — Build writer input. Scalar-score columns are forensic-redundant
  // convenience copies of values that already live inside gateVerdicts.
  const faceVerdict = verdictByGate(moded, "face_similarity");
  const logoVerdict = verdictByGate(moded, "logo_similarity");
  const ocrVerdict = verdictByGate(moded, "ocr_package_text");
  const geomVerdict = verdictByGate(moded, "geometry_scale");
  const geomScaleConfidence =
    typeof geomVerdict?.evidence?.scaleConfidence === "number"
      ? (geomVerdict.evidence.scaleConfidence as number)
      : null;

  const ledgerInput = PcdSp5QcLedgerInputSchema.parse({
    assetRecordId: input.assetRecordId,
    productIdentityId: input.identitySnapshot.productIdentityId,
    pcdIdentitySnapshotId: input.identitySnapshot.id,
    creatorIdentityId: gatesRan.includes("face_similarity")
      ? input.identitySnapshot.creatorIdentityId
      : null,
    qcEvaluationVersion: PCD_QC_EVALUATION_VERSION,
    qcGateMatrixVersion: PCD_QC_GATE_MATRIX_VERSION,
    gateVerdicts,
    gatesRan,
    faceSimilarityScore: faceVerdict?.score ?? null,
    logoSimilarityScore: logoVerdict?.score ?? null,
    packageOcrMatchScore: ocrVerdict?.score ?? null,
    geometryMatchScore: geomVerdict?.score ?? null,
    scaleConfidence: geomScaleConfidence,
    colorDeltaScore: null,
    passFail: gateVerdicts.aggregateStatus,
    warnings: moded.filter((v) => v.status === "warn").map((v) => v.reason),
  });

  // Step 6 — Persist.
  return stores.qcLedgerStore.createForAsset(ledgerInput);
}
```

- [ ] **Step 13.4: Re-run test, verify pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-evaluator`
Expected: PASS — Tier 1 zero-providers test green.

- [ ] **Step 13.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-evaluator.ts \
        packages/creative-pipeline/src/pcd/qc-evaluator.test.ts
git commit -m "feat(pcd): SP5 — evaluatePcdQcResult orchestrator (Tier 1 path)"
```

---

## Task 14: Add evaluator tests for matrix dispatch + mode lowering + aggregation

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/qc-evaluator.test.ts`

- [ ] **Step 14.1: Add Tier 2/3 dispatch tests**

Append to `qc-evaluator.test.ts`:

```ts
describe("evaluatePcdQcResult — Tier 3 face_closeup", () => {
  it("calls only face_similarity provider (per matrix); other providers untouched", async () => {
    const { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure } =
      makeProviders();
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: "logo_1",
        productCanonicalText: "Acme Hot Sauce 8oz",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(scoreFaceSimilarity).toHaveBeenCalledTimes(1);
    // face_closeup is not in the logo/ocr/geometry matrix rows → 0 calls each
    expect(scoreLogoSimilarity).not.toHaveBeenCalled();
    expect(extractText).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(calls[0].gatesRan).toEqual(["face_similarity"]);
    expect(calls[0].passFail).toBe("pass");
    expect(calls[0].creatorIdentityId).toBe("creator_1");
    expect(calls[0].faceSimilarityScore).toBeCloseTo(0.9);
  });
});

describe("evaluatePcdQcResult — mode lowering", () => {
  it("warn_only + provider returns below threshold → status warn (lowered)", async () => {
    const { providers } = makeProviders();
    // Override face score to fail
    providers.similarityProvider.scoreFaceSimilarity = vi.fn(async () => ({ score: 0.1 }));
    const { store, calls } = makeStore();

    // talking_head Tier 2 → face_similarity is warn_only per matrix
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "talking_head",
        effectiveTier: 2,
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 2, productTierAtGeneration: 2 }),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    const faceGate = calls[0].gateVerdicts.gates.find((g) => g.gate === "face_similarity");
    expect(faceGate?.status).toBe("warn");
    expect(faceGate?.reason).toMatch(/warn-only/);
    expect(calls[0].passFail).toBe("warn");
  });

  it("block + provider returns below threshold → status fail (no downgrade)", async () => {
    const { providers } = makeProviders();
    providers.similarityProvider.scoreFaceSimilarity = vi.fn(async () => ({ score: 0.1 }));
    const { store, calls } = makeStore();

    // face_closeup Tier 3 → face_similarity is block per matrix
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    const faceGate = calls[0].gateVerdicts.gates.find((g) => g.gate === "face_similarity");
    expect(faceGate?.status).toBe("fail");
    expect(calls[0].passFail).toBe("fail");
  });
});

describe("evaluatePcdQcResult — provider error obeys mode", () => {
  it("warn_only + provider throws → row passFail=warn (after mode lowering)", async () => {
    const { providers } = makeProviders();
    providers.similarityProvider.scoreFaceSimilarity = vi.fn(async () => {
      throw new Error("boom");
    });
    const { store, calls } = makeStore();

    // talking_head Tier 2 face_similarity is warn_only
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "talking_head",
        effectiveTier: 2,
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 2, productTierAtGeneration: 2 }),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("warn");
  });

  it("block + provider throws → row passFail=fail (no escape hatch)", async () => {
    const { providers } = makeProviders();
    providers.similarityProvider.scoreFaceSimilarity = vi.fn(async () => {
      throw new Error("boom");
    });
    const { store, calls } = makeStore();

    // face_closeup Tier 3 face_similarity is block
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("fail");
  });
});
```

- [ ] **Step 14.2: Run tests, verify all pass**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-evaluator`
Expected: PASS — all six new tests + existing one green.

- [ ] **Step 14.3: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-evaluator.test.ts
git commit -m "test(pcd): SP5 — evaluator tests for dispatch, mode lowering, provider-error mode obedience"
```

---

## Task 15: Add evaluator tests for hard-block, persistence, version pinning, anti-pattern grep, determinism, forbidden imports

**Files:**
- Modify: `packages/creative-pipeline/src/pcd/qc-evaluator.test.ts`

- [ ] **Step 15.1: Add hard-block invariant test (the slice's strongest scenario)**

Append to `qc-evaluator.test.ts`:

```ts
describe("evaluatePcdQcResult — hard-block invariant (label-visible without OCR match)", () => {
  it("Tier 3 label_closeup + OCR provider returns garbage → row passFail=fail end-to-end", async () => {
    const { providers } = makeProviders();
    // OCR returns text that doesn't match the canonical text
    providers.ocrProvider.extractText = vi.fn(async () => ({ text: "garbage" }));
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "label_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: "logo_1",
        productCanonicalText: "Acme Hot Sauce 8oz",
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    const ocrGate = calls[0].gateVerdicts.gates.find((g) => g.gate === "ocr_package_text");
    expect(ocrGate?.status).toBe("fail");
    // Matrix block + predicate fail + aggregator any-fail → row fail
    expect(calls[0].passFail).toBe("fail");
  });

  it("Tier 2 product_demo + OCR fail → row passFail=warn (warn_only at Tier 2)", async () => {
    const { providers } = makeProviders();
    providers.ocrProvider.extractText = vi.fn(async () => ({ text: "garbage" }));
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "product_demo",
        effectiveTier: 2,
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 2, productTierAtGeneration: 2 }),
        productLogoAssetId: null,
        productCanonicalText: "Acme Hot Sauce 8oz",
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("warn");
  });
});
```

- [ ] **Step 15.2: Add persistence-shape tests**

Append:

```ts
describe("evaluatePcdQcResult — persistence shape", () => {
  it("calls createForAsset exactly once per evaluation", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(calls.length).toBe(1);
  });

  it("payload pcdIdentitySnapshotId === input.identitySnapshot.id", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot({ id: "snap_xyz" }),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(calls[0].pcdIdentitySnapshotId).toBe("snap_xyz");
  });

  it("payload pins version constants from imports", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "simple_ugc",
        effectiveTier: 1,
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 1, productTierAtGeneration: 1 }),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(calls[0].qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(calls[0].qcGateMatrixVersion).toBe("pcd-qc-gate-matrix@1.0.0");
  });

  it("passFail === gateVerdicts.aggregateStatus", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(calls[0].passFail).toBe(calls[0].gateVerdicts.aggregateStatus);
  });

  it("gatesRan equals gateVerdicts.gates[*].gate in same order", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "object_insert",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: "logo_1",
        productCanonicalText: null,
        productDimensionsMm: { h: 100, w: 50, d: 30 },
      },
      providers,
      { qcLedgerStore: store },
    );
    const verdictGates = calls[0].gateVerdicts.gates.map((g) => g.gate);
    expect(calls[0].gatesRan).toEqual(verdictGates);
  });

  it("creatorIdentityId is null when face_similarity did not run", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    // object_insert at Tier 3: matrix has logo + geometry, NO face. So face didn't run.
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "object_insert",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: "logo_1",
        productCanonicalText: null,
        productDimensionsMm: { h: 100, w: 50, d: 30 },
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(calls[0].gatesRan).not.toContain("face_similarity");
    expect(calls[0].creatorIdentityId).toBeNull();
    expect(calls[0].faceSimilarityScore).toBeNull();
  });

  it("returned row is the store's response (evaluator does not transform)", async () => {
    const { providers } = makeProviders();
    const { store } = makeStore();
    const row = await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );
    expect(row.id).toBe("qc_row_1");
  });
});
```

- [ ] **Step 15.3: Add determinism + anti-pattern + forbidden-imports tests**

Append:

```ts
describe("evaluatePcdQcResult — determinism", () => {
  it("two consecutive identical calls produce deep-equal payloads", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    const input = {
      assetRecordId: "asset_1",
      shotType: "face_closeup" as const,
      effectiveTier: 3 as const,
      identitySnapshot: makeSnapshot(),
      productLogoAssetId: null,
      productCanonicalText: null,
      productDimensionsMm: null,
    };
    await evaluatePcdQcResult(input, providers, { qcLedgerStore: store });
    await evaluatePcdQcResult(input, providers, { qcLedgerStore: store });
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(calls[1]);
  });
});

describe("evaluatePcdQcResult — anti-pattern grep (binding, narrow)", () => {
  const src = readFileSync(new URL("./qc-evaluator.ts", import.meta.url), "utf-8");

  it("contains zero `if (row.gate ===` outside the dispatch switch", () => {
    expect(src).not.toMatch(/if \(row\.gate ===/);
  });
  it("contains zero `if (gate ===`", () => {
    expect(src).not.toMatch(/if \(gate ===/);
  });
  it("contains zero `if (input.shotType ===`", () => {
    expect(src).not.toMatch(/if \(input\.shotType ===/);
  });
  it("contains zero `if (input.effectiveTier ===`", () => {
    expect(src).not.toMatch(/if \(input\.effectiveTier ===/);
  });
  it("contains zero `if (effectiveTier ===` (destructured form)", () => {
    expect(src).not.toMatch(/if \(effectiveTier ===/);
  });
  it("contains zero `if (shotType ===`", () => {
    expect(src).not.toMatch(/if \(shotType ===/);
  });
});

describe("evaluatePcdQcResult — no SP6 leakage (binding)", () => {
  const evalSrc = readFileSync(new URL("./qc-evaluator.ts", import.meta.url), "utf-8");
  const aggSrc = readFileSync(new URL("./qc-aggregator.ts", import.meta.url), "utf-8");

  it("evaluator + aggregator contain zero matches for SP6 surfaces", () => {
    for (const src of [evalSrc, aggSrc]) {
      expect(src).not.toMatch(/approval/i);
      expect(src).not.toMatch(/canApprove/i);
      expect(src).not.toMatch(/WorkTrace/i);
      expect(src).not.toMatch(/outbox/i);
      expect(src).not.toMatch(/ApprovalLifecycle/i);
      expect(src).not.toMatch(/assetRecord\.update/i);
    }
  });
});

describe("evaluatePcdQcResult — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-evaluator.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });
});
```

- [ ] **Step 15.4: Run all evaluator tests**

Run: `pnpm --filter @creativeagent/creative-pipeline test -- qc-evaluator`
Expected: PASS — all tests green (Tier 1 path + dispatch + mode lowering + provider-error obedience + hard-block + persistence + determinism + anti-pattern + no-SP6-leakage + forbidden-imports).

- [ ] **Step 15.5: Commit**

```bash
git add packages/creative-pipeline/src/pcd/qc-evaluator.test.ts
git commit -m "test(pcd): SP5 — evaluator hard-block + persistence + version + anti-pattern + forbidden-imports"
```

---

## Task 16: Implement `PrismaPcdQcResultStore`

**Files:**
- Create: `packages/db/src/stores/prisma-pcd-qc-result-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-pcd-qc-result-store-sp5.test.ts`

- [ ] **Step 16.1: Inspect SP4's snapshot store for the precedent pattern**

```bash
cat packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts
```

Note the patterns: how the constructor takes `PrismaClient`, how `Prisma.JsonNull` is used for null JSON columns, how the input/output types are mapped. Mirror those choices.

- [ ] **Step 16.2: Inspect SP4's `adaptPcdIdentitySnapshotStore` adapter**

```bash
grep -rn "adaptPcdIdentitySnapshotStore" packages/db/src/
```

If an adapter exists for snapshot, this tells us the project pattern is to expose the orchestration-named method via an adapter even when the Prisma store uses a Prisma-natural name. We'll mirror it: SP5 ships `PrismaPcdQcResultStore.create` (Prisma-natural) and an `adaptPcdQcResultStore` that returns a `PcdQcLedgerStore`.

- [ ] **Step 16.3: Write a failing integration test**

Create `packages/db/src/stores/__tests__/prisma-pcd-qc-result-store-sp5.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { PcdSp5QcLedgerInput } from "@creativeagent/schemas";
import { PrismaPcdQcResultStore } from "../prisma-pcd-qc-result-store.js";

// This test follows the SP4 snapshot-store integration test precedent
// (see prisma-pcd-identity-snapshot-store-sp4.test.ts) — uses a real
// Prisma client against the dev database. If this is run in an env
// without a DB, the test should skip via `it.skipIf` rather than fail.

const hasDb = Boolean(process.env.DATABASE_URL);

const happy = (
  productIdentityId: string,
  assetRecordId: string,
  pcdIdentitySnapshotId: string,
  creatorIdentityId: string,
): PcdSp5QcLedgerInput => ({
  assetRecordId,
  productIdentityId,
  pcdIdentitySnapshotId,
  creatorIdentityId,
  qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
  qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
  gateVerdicts: {
    gates: [
      {
        gate: "face_similarity",
        status: "pass",
        score: 0.91,
        threshold: 0.78,
        reason: "face similarity 0.910 >= threshold 0.78",
      },
    ],
    aggregateStatus: "pass",
  },
  gatesRan: ["face_similarity"],
  faceSimilarityScore: 0.91,
  logoSimilarityScore: null,
  packageOcrMatchScore: null,
  geometryMatchScore: null,
  scaleConfidence: null,
  colorDeltaScore: null,
  passFail: "pass",
  warnings: [],
});

describe.skipIf(!hasDb)("PrismaPcdQcResultStore — round-trip", () => {
  let prisma: PrismaClient;
  let store: PrismaPcdQcResultStore;

  beforeAll(async () => {
    prisma = new PrismaClient();
    store = new PrismaPcdQcResultStore(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createForAsset persists all 7 SP5 columns (JSONB round-trip)", async () => {
    // Set up FK rows. Match SP4 snapshot-store test fixture pattern.
    const product = await prisma.productIdentity.create({
      data: { orgId: "org_test_sp5", title: `qc-test-${Date.now()}` },
    });
    const creator = await prisma.creatorIdentity.create({
      data: {
        deploymentId: "dep_test",
        name: "qc-test-creator",
        identityRefIds: [],
        heroImageAssetId: "asset_x",
        identityDescription: "test",
        voice: {},
        personality: {},
        appearanceRules: {},
      },
    });
    const job = await prisma.creativeJob.create({
      data: {
        taskId: `task_${Date.now()}`,
        organizationId: "org_test_sp5",
        deploymentId: "dep_test",
        productDescription: "x",
        targetAudience: "x",
        platforms: [],
        productIdentityId: product.id,
        creatorIdentityId: creator.id,
      },
    });
    const asset = await prisma.assetRecord.create({
      data: {
        jobId: job.id,
        specId: `spec_${Date.now()}`,
        creatorId: creator.id,
        provider: "kling",
        modelId: "kling-2",
        inputHashes: {},
        outputs: {},
      },
    });
    const snapshot = await prisma.pcdIdentitySnapshot.create({
      data: {
        assetRecordId: asset.id,
        productIdentityId: product.id,
        productTierAtGeneration: 3,
        productImageAssetIds: ["img_1"],
        productCanonicalTextHash: "hash_x",
        productLogoAssetId: null,
        creatorIdentityId: creator.id,
        avatarTierAtGeneration: 3,
        avatarReferenceAssetIds: ["ref_1"],
        voiceAssetId: null,
        consentRecordId: null,
        policyVersion: "tier-policy@1.0.0",
        providerCapabilityVersion: "provider-capability@1.0.0",
        selectedProvider: "kling",
        providerModelSnapshot: "kling-2",
        seedOrNoSeed: "no-seed",
        rewrittenPromptText: null,
      },
    });

    const row = await store.createForAsset(
      happy(product.id, asset.id, snapshot.id, creator.id),
    );

    expect(row.id).toBeTruthy();
    expect(row.creatorIdentityId).toBe(creator.id);
    expect(row.pcdIdentitySnapshotId).toBe(snapshot.id);
    expect(row.faceSimilarityScore).toBeCloseTo(0.91);
    expect(row.gatesRan).toEqual(["face_similarity"]);
    expect(row.qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(row.qcGateMatrixVersion).toBe("pcd-qc-gate-matrix@1.0.0");
    expect(row.gateVerdicts).toBeTruthy();
    expect((row.gateVerdicts as { aggregateStatus: string }).aggregateStatus).toBe("pass");

    // Cleanup: delete in reverse FK order
    await prisma.productQcResult.delete({ where: { id: row.id } });
    await prisma.pcdIdentitySnapshot.delete({ where: { id: snapshot.id } });
    await prisma.assetRecord.delete({ where: { id: asset.id } });
    await prisma.creativeJob.delete({ where: { id: job.id } });
    await prisma.creatorIdentity.delete({ where: { id: creator.id } });
    await prisma.productIdentity.delete({ where: { id: product.id } });
  });

  it("createForAsset round-trips empty gatesRan + null gateVerdicts (Tier 1 shape)", async () => {
    // Mirror Tier 1 case: empty gates array + null verdicts (or empty verdicts).
    // Note: the writer-input schema requires gateVerdicts be present, even if empty,
    // so we pass an empty-gates verdict object — verifying JSONB round-trip of {} -ish data.
    const product = await prisma.productIdentity.create({
      data: { orgId: "org_test_sp5_t1", title: `qc-test-t1-${Date.now()}` },
    });
    const creator = await prisma.creatorIdentity.create({
      data: {
        deploymentId: "dep_test",
        name: "qc-test-creator-t1",
        identityRefIds: [],
        heroImageAssetId: "asset_x",
        identityDescription: "test",
        voice: {},
        personality: {},
        appearanceRules: {},
      },
    });
    const job = await prisma.creativeJob.create({
      data: {
        taskId: `task_t1_${Date.now()}`,
        organizationId: "org_test_sp5_t1",
        deploymentId: "dep_test",
        productDescription: "x",
        targetAudience: "x",
        platforms: [],
        productIdentityId: product.id,
        creatorIdentityId: creator.id,
      },
    });
    const asset = await prisma.assetRecord.create({
      data: {
        jobId: job.id,
        specId: `spec_t1_${Date.now()}`,
        creatorId: creator.id,
        provider: "kling",
        modelId: "kling-1",
        inputHashes: {},
        outputs: {},
      },
    });
    const snapshot = await prisma.pcdIdentitySnapshot.create({
      data: {
        assetRecordId: asset.id,
        productIdentityId: product.id,
        productTierAtGeneration: 1,
        productImageAssetIds: [],
        productCanonicalTextHash: "hash_t1",
        productLogoAssetId: null,
        creatorIdentityId: creator.id,
        avatarTierAtGeneration: 1,
        avatarReferenceAssetIds: [],
        voiceAssetId: null,
        consentRecordId: null,
        policyVersion: "tier-policy@1.0.0",
        providerCapabilityVersion: "provider-capability@1.0.0",
        selectedProvider: "kling",
        providerModelSnapshot: "kling-1",
        seedOrNoSeed: "no-seed",
        rewrittenPromptText: null,
      },
    });

    const row = await store.createForAsset({
      assetRecordId: asset.id,
      productIdentityId: product.id,
      pcdIdentitySnapshotId: snapshot.id,
      creatorIdentityId: null,
      qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
      qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
      gateVerdicts: { gates: [], aggregateStatus: "warn" },
      gatesRan: [],
      faceSimilarityScore: null,
      logoSimilarityScore: null,
      packageOcrMatchScore: null,
      geometryMatchScore: null,
      scaleConfidence: null,
      colorDeltaScore: null,
      passFail: "warn",
      warnings: [],
    });

    expect(row.gatesRan).toEqual([]);
    expect(row.passFail).toBe("warn");
    expect((row.gateVerdicts as { aggregateStatus: string }).aggregateStatus).toBe("warn");

    await prisma.productQcResult.delete({ where: { id: row.id } });
    await prisma.pcdIdentitySnapshot.delete({ where: { id: snapshot.id } });
    await prisma.assetRecord.delete({ where: { id: asset.id } });
    await prisma.creativeJob.delete({ where: { id: job.id } });
    await prisma.creatorIdentity.delete({ where: { id: creator.id } });
    await prisma.productIdentity.delete({ where: { id: product.id } });
  });
});
```

- [ ] **Step 16.4: Run test, verify failure**

Run: `pnpm --filter @creativeagent/db test -- prisma-pcd-qc-result-store`
Expected: FAIL — store doesn't exist (or skipped in DB-less env, in which case continue and rely on typecheck).

- [ ] **Step 16.5: Implement `PrismaPcdQcResultStore`**

Create `packages/db/src/stores/prisma-pcd-qc-result-store.ts`:

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type PcdSp5QcLedgerInput,
  type ProductQcResult,
  ProductQcResultSchema,
} from "@creativeagent/schemas";

export class PrismaPcdQcResultStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createForAsset(input: PcdSp5QcLedgerInput): Promise<ProductQcResult> {
    const row = await this.prisma.productQcResult.create({
      data: {
        productIdentityId: input.productIdentityId,
        assetRecordId: input.assetRecordId,
        creatorIdentityId: input.creatorIdentityId,
        pcdIdentitySnapshotId: input.pcdIdentitySnapshotId,
        logoSimilarityScore: input.logoSimilarityScore,
        packageOcrMatchScore: input.packageOcrMatchScore,
        colorDeltaScore: input.colorDeltaScore,
        geometryMatchScore: input.geometryMatchScore,
        scaleConfidence: input.scaleConfidence,
        faceSimilarityScore: input.faceSimilarityScore,
        passFail: input.passFail,
        warnings: input.warnings,
        gatesRan: input.gatesRan,
        // gateVerdicts is JSONB. Cast through Prisma.InputJsonValue.
        gateVerdicts: input.gateVerdicts as unknown as Prisma.InputJsonValue,
        qcEvaluationVersion: input.qcEvaluationVersion,
        qcGateMatrixVersion: input.qcGateMatrixVersion,
      },
    });
    // Round-trip through Zod for guaranteed shape (mirrors SP4 snapshot store).
    return ProductQcResultSchema.parse(row);
  }
}
```

- [ ] **Step 16.6: Re-run test, verify pass (or skipped if no DB)**

Run: `pnpm --filter @creativeagent/db test -- prisma-pcd-qc-result-store`
Expected: PASS (or both tests skipped if `DATABASE_URL` is unset).

- [ ] **Step 16.7: Run typecheck across packages**

```bash
pnpm typecheck
```

Expected: green.

- [ ] **Step 16.8: Commit**

```bash
git add packages/db/src/stores/prisma-pcd-qc-result-store.ts \
        packages/db/src/stores/__tests__/prisma-pcd-qc-result-store-sp5.test.ts
git commit -m "feat(pcd): SP5 db — PrismaPcdQcResultStore.createForAsset"
```

---

## Task 17: Re-export SP5 surfaces from `creative-pipeline`

**Files:**
- Modify: `packages/creative-pipeline/src/index.ts`

- [ ] **Step 17.1: Open the index and locate SP4 re-exports**

```bash
sed -n '1,60p' packages/creative-pipeline/src/index.ts
```

Identify where SP4 re-exports end. SP5 re-exports go after them.

- [ ] **Step 17.2: Append SP5 re-exports**

Append to `packages/creative-pipeline/src/index.ts`:

```ts
// SP5: QC gates
export { PCD_QC_EVALUATION_VERSION } from "./pcd/qc-evaluation-version.js";

export {
  PCD_QC_GATE_MATRIX,
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./pcd/qc-gate-matrix.js";

export type {
  SimilarityProvider,
  OcrProvider,
  GeometryProvider,
  PcdQcProviders,
} from "./pcd/qc-providers.js";

export {
  runFaceSimilarityGate,
  FACE_SIMILARITY_THRESHOLD,
  type FaceSimilarityGateInput,
} from "./pcd/qc-face-similarity.js";

export {
  runLogoSimilarityGate,
  LOGO_SIMILARITY_THRESHOLD,
  type LogoSimilarityGateInput,
} from "./pcd/qc-logo-similarity.js";

export {
  runOcrPackageTextGate,
  OCR_EDIT_DISTANCE_THRESHOLD,
  type OcrPackageTextGateInput,
} from "./pcd/qc-ocr-match.js";

export {
  runGeometryScaleGate,
  GEOMETRY_SCORE_THRESHOLD,
  SCALE_CONFIDENCE_THRESHOLD,
  type GeometryScaleGateInput,
} from "./pcd/qc-geometry.js";

export {
  applyPcdQcGateMode,
  aggregatePcdQcGateVerdicts,
} from "./pcd/qc-aggregator.js";

export {
  evaluatePcdQcResult,
  type EvaluatePcdQcResultInput,
  type EvaluatePcdQcResultStores,
  type PcdQcLedgerStore,
} from "./pcd/qc-evaluator.js";
```

- [ ] **Step 17.3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: green.

- [ ] **Step 17.4: Verify the public surface compiles end-to-end**

Quick smoke check: write a one-line consumer at the workspace root to confirm imports resolve.

```bash
node --input-type=module -e "
  import('@creativeagent/creative-pipeline').then(m => {
    console.error('OK', Object.keys(m).filter(k => k.startsWith('PCD_QC') || k.startsWith('evaluatePcd') || k.startsWith('run') || k.startsWith('aggregate') || k.startsWith('apply')).sort().join(','));
  }).catch(e => { console.error('FAIL', e.message); process.exit(1); });
"
```

Expected: `OK PCD_QC_EVALUATION_VERSION,PCD_QC_GATE_MATRIX,PCD_QC_GATE_MATRIX_VERSION,aggregatePcdQcGateVerdicts,applyPcdQcGateMode,evaluatePcdQcResult,runFaceSimilarityGate,runGeometryScaleGate,runLogoSimilarityGate,runOcrPackageTextGate` (plus prior-slice surfaces). If imports fail, fix before continuing.

- [ ] **Step 17.5: Commit**

```bash
git add packages/creative-pipeline/src/index.ts
git commit -m "feat(pcd): SP5 — re-export QC orchestration surface from creative-pipeline"
```

---

## Task 18: Update `SWITCHBOARD-CONTEXT.md` with SP5 merge-back notes

**Files:**
- Modify: `docs/SWITCHBOARD-CONTEXT.md`

- [ ] **Step 18.1: Locate the SP5 section**

```bash
grep -n "### SP5" docs/SWITCHBOARD-CONTEXT.md
```

- [ ] **Step 18.2: Append the merge-back notes to the SP5 section**

In `docs/SWITCHBOARD-CONTEXT.md`, locate `### SP5 (QC gate)`. Append (or replace its existing brief content) with:

```markdown
### SP5 (QC gate)

**Will need from Switchboard at merge:**
- A real implementer of `SimilarityProvider` (face + logo embedding) — production model lives in Switchboard's QC service.
- A real implementer of `OcrProvider` — Switchboard QC's OCR pipeline.
- A real implementer of `GeometryProvider` — Switchboard QC's depth/object-detection pipeline.
- Optional: a `PrismaPcdQcResultStore` rename if Switchboard ever decides to rename `ProductQcResult → PcdQcResult` (deferred indefinitely; SP5 keeps SP1's name).

**Stub strategy here:** SP5 ships only the three provider contract surfaces (`SimilarityProvider`, `OcrProvider`, `GeometryProvider`) marked `// MERGE-BACK: replace with Switchboard QC provider`. Concrete production implementers are reserved for Switchboard's QC service ownership at merge-back. In-tree consumers (predicates, tests) inject test stubs that conform to these types.

**Merge-back notes:**
- `SimilarityProvider`, `OcrProvider`, `GeometryProvider` are SP5-declared orchestration dependencies; production implementations are reserved for Switchboard QC service ownership at merge-back.
- `ProductQcResult` table-name reconciliation (preserved verbatim from SP1; potential rename to `PcdQcResult`) is deferred to merge-back — SP5 widens additively without renaming.
- `PcdQcLedgerStore.createForAsset` vs Prisma-natural `create` method-name divergence: if any orchestration caller needs the contract method name strictly, ship `adaptPcdQcResultStore` per SP4's `adaptPcdIdentitySnapshotStore` precedent.
```

- [ ] **Step 18.3: Verify the doc parses cleanly**

```bash
grep -A2 "### SP5" docs/SWITCHBOARD-CONTEXT.md | head -20
```

Expected: SP5 section visible with the three new bullet points.

- [ ] **Step 18.4: Commit**

```bash
git add docs/SWITCHBOARD-CONTEXT.md
git commit -m "docs(pcd): SP5 — merge-back notes for QC providers + ProductQcResult naming"
```

---

## Task 19: Final verification — full build, test, lint, typecheck

**Files:** none modified; verification only.

- [ ] **Step 19.1: Clean install**

```bash
pnpm install
```

- [ ] **Step 19.2: Regenerate Prisma client**

```bash
pnpm db:generate
```

- [ ] **Step 19.3: Typecheck all packages**

```bash
pnpm typecheck
```

Expected: green across all packages (creative-pipeline + db + schemas).

- [ ] **Step 19.4: Run all tests**

```bash
pnpm test
```

Expected: PASS. Test count should be baseline (from Task 0.6) + the new SP5 tests across schemas, creative-pipeline, and db. Capture the new total:

```bash
pnpm test 2>&1 | grep -E "Tests +[0-9]+ passed" | tail -3
```

Expected new totals (approximate; exact numbers depend on test fixture counts):
- schemas: baseline + ~13 new (gate enums, verdict, applicability, ProductQcResultSchema widening, PcdSp5QcLedgerInputSchema + refines)
- creative-pipeline: baseline + matrix tests + aggregator tests + 4× predicate tests + evaluator tests (~80–100 new tests in pipeline)
- db: baseline + 2 new integration tests (skipped if no `DATABASE_URL`)

Existing test counts MUST NOT decrease.

- [ ] **Step 19.5: Lint**

```bash
pnpm lint
```

Expected: green. Lint warnings count unchanged from origin/main baseline.

- [ ] **Step 19.6: Quick visual review of SP5 surface**

Run a final source-grep for any pattern that should not be in SP5 source:

```bash
grep -rn "approval\|canApprove\|WorkTrace\|outbox\|ApprovalLifecycle" packages/creative-pipeline/src/pcd/qc-*.ts || echo "OK — no SP6 leakage"
grep -rn "@creativeagent/db\|@prisma/client" packages/creative-pipeline/src/pcd/qc-*.ts || echo "OK — no forbidden imports"
```

Both should print "OK …".

- [ ] **Step 19.7: Confirm clean working tree**

```bash
git status
```

Expected: clean working tree (all SP5 commits merged into branch history).

- [ ] **Step 19.8: Tag the SP5 branch ready state**

```bash
git log --oneline main.. | head -25
```

Expected: ~18 SP5 commits since branching from `main`.

---

## Task 20: Open the SP5 PR

**Files:** none in-tree. PR creation only.

- [ ] **Step 20.1: Push the branch to origin**

```bash
git push -u origin feat/pcd-sp5-qc-gates
```

- [ ] **Step 20.2: Open the PR**

```bash
gh pr create --title "feat(pcd): SP5 — QC gates orchestration + gate matrix + QC ledger writer" --body "$(cat <<'EOF'
## Summary

- Adds the **PCD SP5 QC gates** vertical: a pure store-injected `evaluatePcdQcResult` orchestrator over four pure-async predicates (face/logo/OCR/geometry), governed by a declarative versioned `PCD_QC_GATE_MATRIX`, persisting one forensic QC ledger row per generated asset via the new `PrismaPcdQcResultStore`.
- Additively widens SP1's `ProductQcResult` table with seven new columns (six nullable + `gatesRan TEXT[] NOT NULL DEFAULT '{}'`); no rename, no FK loosening, no follow-up null→non-null migration. Pre-SP5 rows remain readable.
- Introduces two new pinned constants: `PCD_QC_EVALUATION_VERSION = "pcd-qc-evaluation@1.0.0"` and `PCD_QC_GATE_MATRIX_VERSION = "pcd-qc-gate-matrix@1.0.0"`. Both pinned by the orchestrator from imports — caller cannot override.
- **Hard-block invariant** ("label-visible without OCR match cannot be approved for final export") encoded structurally end-to-end through matrix `block` + OCR predicate `fail` + aggregator any-fail → row `passFail: "fail"`. SP5 owns steps 1–4; SP6 owns step 5.
- Tier 1 has zero matrix rows: zero provider calls, empty-gates QC ledger row written with `passFail: "warn"`. Future Tier 1 telemetry comes on with a one-row matrix change + version bump — zero orchestrator code change.
- SP5 ships **no** approval helper, lifecycle code, outbox/event emission, or `WorkTrace` emit. Three QC provider contracts (`SimilarityProvider`, `OcrProvider`, `GeometryProvider`) ship as types only with `// MERGE-BACK:` markers; production implementations reserved for Switchboard's QC service.

## Test plan

- [x] `pnpm typecheck` — green across all 5 packages
- [x] `pnpm test` — schemas + creative-pipeline + db all green; SP5 adds dozens of unit tests covering matrix shape, predicates (skipped/pass/fail/threshold-boundary/provider-error), aggregator truth tables, evaluator dispatch + mode lowering + provider-error mode obedience + hard-block end-to-end + persistence shape + version pinning + determinism + anti-pattern grep + no-SP6-leakage + forbidden imports
- [x] `pnpm lint` — green; warnings count unchanged
- [x] `pnpm db:migrate` applies the new SP5 migration (one new column-add migration adding 7 columns to `ProductQcResult`)
- [x] Pre-SP5 row read-back round-trips through `ProductQcResultSchema` (NULL/empty for new fields)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Open it in the browser to verify the description renders and the diff is bounded to SP5 surfaces.

- [ ] **Step 20.3: Update the slice-progress memory after merge**

After the PR merges to `main`, update `/Users/jasonli/.claude/projects/-Users-jasonli-creativeagent/memory/project_pcd_slice_progress.md` with the SP5 entry (status: shipped, commit hash, test count, key invariants, merge-back concerns recorded). Mirror SP4's entry shape.

---

## Self-review checklist (run before handing off)

- **Spec coverage:** every binding rule in the design is implemented:
  - Q1 row shape (additive widen) → Tasks 2, 4
  - Q2 all-async predicates → Tasks 9–12
  - Q3 declarative matrix + version → Task 7
  - Q4 one-way QC → snapshot pointer → Task 2 (`pcdIdentitySnapshotId` on schema), Task 13 (evaluator wires it)
  - Q5 SP6 boundary (no approval helpers) → Task 15 no-SP6-leakage grep
  - Q6 Tier 1 empty-gates row → Tasks 7, 13
  - R1 Tier 1 warn semantics comment → Task 8 (in-source comment)
  - R2 SP1 scalars not re-added → Task 4 (migration adds only the 7 new fields)
  - R3 six-nullable + one-array wording → all docs
  - R4 provider-error obeys mode → Task 14 (two tests)
  - R5 anti-pattern grep, not gate-name grep → Task 15
  - R6 nullable vs. optional clarified → Task 2 schema comment
  - R7 evidence bounds → Tasks 11 (OCR omits raw text), 12 (geometry stores scaleConfidence)
- **Placeholder scan:** no TBD / TODO / "fill in" anywhere in this plan.
- **Type consistency:** `evaluatePcdQcResult` signature uses the same `EvaluatePcdQcResultInput` shape across Tasks 13–15. `PcdQcLedgerStore.createForAsset` is consistently named everywhere. `PCD_QC_EVALUATION_VERSION` and `PCD_QC_GATE_MATRIX_VERSION` are the only two SP5-introduced pinned constants and both are referenced consistently.
- **Architectural invariants:** all four `creative-pipeline/src/pcd/qc-*.ts` modules forbid `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `http`, `https` (forbidden-imports test in every test file). Predicates do not import the matrix or evaluator. Evaluator imports each predicate by name.

If subsequent execution encounters an issue not covered here, add the missing task inline rather than improvising silently.
