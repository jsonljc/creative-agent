---
date: 2026-04-29
tags: [pcd, sp5, qc-gates, qc-evaluator, qc-matrix, design]
status: approved
---

# PCD SP5 — QC Gates Orchestration + Gate Matrix + QC Ledger Writer Design

**Slice:** SP5 of the PCD vertical. SP1 (`05bc4655` in Switchboard, extracted as `creativeagent` `10a5ce0`), SP2 (`creativeagent` `cb7a378`, PR #1), SP3 (`creativeagent` `715e325`, PR #2), and SP4 (`creativeagent` `05ffa25`, PR #3) have shipped.
**Goal:** Ship one coherent vertical that (a) widens `ProductQcResult` additively into the PCD QC ledger, (b) introduces a declarative `PCD_QC_GATE_MATRIX` plus `PCD_QC_GATE_MATRIX_VERSION` and `PCD_QC_EVALUATION_VERSION`, (c) ships four pure-async gate predicates over an injected provider contract surface, (d) ships a pure store-injected `evaluatePcdQcResult` orchestrator that runs only matrix-applicable gates, applies mode lowering, aggregates verdicts, and persists exactly one QC ledger row per generated asset, and (e) ships a `PrismaPcdQcResultStore` implementer in `packages/db`.
**Source-of-truth spec:** `docs/plans/2026-04-27-pcd-identity-registry-design.md` — sections "QC gates", "Architecture", "Identity snapshot", "Tier policy test matrix", "Measurable QC metrics".
**Upstream slices consumed:** SP4 design (`docs/plans/2026-04-28-pcd-provider-router-sp4-design.md`) — defines the `PcdIdentitySnapshot` row shape SP5 reads as QC input. SP3 / SP2 / SP1 are not modified.

This design document captures the design decisions made during brainstorming and the implementation contract for SP5. It is binding: SP5 ships exactly what is described here. Anything not described here is out of scope for SP5.

## Section 1 — Scope & non-goals

### In scope (SP5)

**Schemas (`packages/schemas/src/pcd-identity.ts`):**
- New `PcdQcGateKeySchema = z.enum(["face_similarity", "logo_similarity", "ocr_package_text", "geometry_scale"])`.
- New `PcdQcGateStatusSchema = z.enum(["pass", "warn", "fail", "skipped"])`.
- New `PcdQcAggregateStatusSchema = z.enum(["pass", "warn", "fail"])`.
- New `PcdQcGateModeSchema = z.enum(["block", "warn_only"])`.
- New `PcdQcGateVerdictSchema` = `{ gate, status, score?, threshold?, reason: string, evidence?: Record<string, unknown> }`.
- New `PcdQcGateVerdictsSchema` = `{ gates: PcdQcGateVerdict[], aggregateStatus: PcdQcAggregateStatus }`.
- New `PcdQcGateApplicabilitySchema` = `{ shotType, effectiveTier, gate, mode, rationale? }`.
- New `PcdSp5QcLedgerInputSchema` (writer-input shape — narrower than the persisted row; SP5-required forensic fields are non-nullable here).
- Extended `ProductQcResultSchema` with seven new nullable fields: `creatorIdentityId`, `pcdIdentitySnapshotId`, `faceSimilarityScore`, `gatesRan`, `gateVerdicts`, `qcEvaluationVersion`, `qcGateMatrixVersion`. Nullable so the schema parses both pre-SP5 rows (NULL / `[]` for `gatesRan`) and SP5-and-later rows (non-NULL).

**Migration (`packages/db/prisma/migrations/<timestamp>_pcd_qc_result_sp5_gates/migration.sql`):**
- One Prisma migration adding seven nullable columns to `ProductQcResult`. No defaults except for `gatesRan` (Postgres array, default `'{}'`). No column renames. No FK loosening (`productIdentityId` stays required). Migration SQL has a comment explaining historical-compatibility nullability.

**Module files (`packages/creative-pipeline/src/pcd/`, all new):**
- `qc-evaluation-version.ts` — sibling const file (mirrors SP3's `shot-spec-version.ts` pattern) exporting `PCD_QC_EVALUATION_VERSION = "pcd-qc-evaluation@1.0.0"`.
- `qc-providers.ts` — `SimilarityProvider`, `OcrProvider`, `GeometryProvider`, `PcdQcProviders` contract types. Marked `// MERGE-BACK: replace with Switchboard QC provider`.
- `qc-gate-matrix.ts` — `PCD_QC_GATE_MATRIX`, `PCD_QC_GATE_MATRIX_VERSION = "pcd-qc-gate-matrix@1.0.0"`, `getPcdQcGateApplicability`. Pure data + lookup; no logic.
- `qc-face-similarity.ts` — `runFaceSimilarityGate(input, providers): Promise<PcdQcGateVerdict>` + `FACE_SIMILARITY_THRESHOLD`. Pure async predicate.
- `qc-logo-similarity.ts` — `runLogoSimilarityGate` + `LOGO_SIMILARITY_THRESHOLD`.
- `qc-ocr-match.ts` — `runOcrPackageTextGate` + `OCR_EDIT_DISTANCE_THRESHOLD` (Levenshtein-ratio).
- `qc-geometry.ts` — `runGeometryScaleGate` + `GEOMETRY_SCORE_THRESHOLD` + `SCALE_CONFIDENCE_THRESHOLD`.
- `qc-aggregator.ts` — `aggregatePcdQcGateVerdicts`, `applyPcdQcGateMode`. Pure helpers.
- `qc-evaluator.ts` — `evaluatePcdQcResult(input, providers, stores): Promise<ProductQcResult>` orchestrator. Pins both version constants from imports.
- Co-located `*.test.ts` for each module.

**Store (`packages/db/src/stores/prisma-pcd-qc-result-store.ts`, new):**
- `PrismaPcdQcResultStore` implementing `PcdQcLedgerStore.createForAsset`. Writes a `ProductQcResult` row including all seven SP5 columns. JSON columns use `Prisma.JsonNull` for null literals (matches SP4 precedent). If method-name divergence emerges between the SP5 contract (`createForAsset`) and a Prisma-natural name (`create`), an `adaptPcdQcResultStore` adapter ships in `packages/db` per SP4's `adaptPcdIdentitySnapshotStore` precedent.

**Re-exports (`packages/creative-pipeline/src/index.ts`):**
- All new public functions, constants, types, and contracts.

**Switchboard merge-back doc (`docs/SWITCHBOARD-CONTEXT.md`):**
- Lines reserving the three QC provider implementations (`SimilarityProvider`, `OcrProvider`, `GeometryProvider`) for Switchboard's QC service ownership at merge-back, and noting that the `ProductQcResult` table-name reconciliation (vs. a future `PcdQcResult` rename) is deferred to merge-back.

### Out of scope (do not touch in SP5)

- SP4's router / capability matrix / snapshot writer / Tier 3 rules — consumed only.
- SP6's approval / Meta draft / consent revocation behavior — no `canApprove`, no `interpretPcdQcResult`, no `AssetRecord.approvalState` mutation, no `WorkTrace`/outbox emit, no `ApprovalLifecycle` code.
- The QC engine implementations — actual face-embedding model, OCR provider, logo similarity model, geometry/depth model are all merge-back-only. SP5 ships contract surfaces and test stubs only.
- `ProductQcResult` rename (kept as-is per row-shape decision; rename deferred indefinitely).
- `PcdIdentitySnapshot` schema body — zero columns added in SP5.
- Backfill of legacy `ProductQcResult` rows; no follow-up null→non-null migration.
- Provider call retry / fallback / circuit-breaker orchestration — predicates surface provider errors as gate-level `fail` verdicts.
- Inngest functions / async-job refactor.
- UI / dashboard / chat integration.
- API route changes.
- New indexes on the seven new columns.
- `registry-backfill.ts` / `tier-policy.ts` / `registry-resolver.ts` / `provider-router.ts` / `pcd-identity-snapshot-writer.ts` / `tier3-routing-rules.ts` / `provider-capability-matrix.ts` body changes.
- Any concrete production implementer of the three QC provider contracts. Only test stubs ship in-tree; production implementers reserved for merge-back.

### Layer rules (binding)

- All new `creative-pipeline/src/pcd/*.ts` modules are pure orchestration.
- **Allowed imports:** `@creativeagent/schemas`, sibling files in `./pcd/`.
- **Forbidden imports** (forbidden-imports test in every new test file): `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `from "http"`, `from "https"`.
- Schema changes happen only in `@creativeagent/schemas` (`pcd-identity.ts`).
- The Prisma migration plus the new `prisma-pcd-qc-result-store.ts` (and optional adapter) are the only edits inside `packages/db/`.
- Gate matrix is data, not logic. `evaluatePcdQcResult` contains zero hardcoded gate names in conditionals other than the `switch (row.gate)` predicate dispatch (which is data-keyed).
- Predicates are unaware of tier and shot-type policy. They score; matrix governs.
- One-way module dependency inside SP5: evaluator → predicates + matrix + aggregator. Predicates and matrix and aggregator are siblings; none import from each other (except predicates importing `qc-providers.ts`).

### Merge-back ownership notes

SP5 owns the QC orchestration surface and the three provider contracts. SP5 does **not** own the production QC provider implementations. Production implementations should be provided at merge-back through Switchboard's QC service. Only test stubs exist in-tree.

`docs/SWITCHBOARD-CONTEXT.md` is updated with lines under SP5's section: "SimilarityProvider, OcrProvider, GeometryProvider are SP5-declared orchestration dependencies; production implementations are reserved for Switchboard QC service ownership at merge-back" and "ProductQcResult table-name reconciliation (preserved verbatim from SP1; potential rename to PcdQcResult) is deferred to merge-back."

## Section 2 — File layout & exports

### `packages/schemas/src/pcd-identity.ts` (extended)

New exports:

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

export const PcdQcGateVerdictSchema = z.object({
  gate: PcdQcGateKeySchema,
  status: PcdQcGateStatusSchema,
  score: z.number().optional(),
  threshold: z.number().optional(),
  reason: z.string().min(1),
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

Modified `ProductQcResultSchema` — seven new nullable fields appended:

```ts
creatorIdentityId: z.string().nullable().optional(),
pcdIdentitySnapshotId: z.string().nullable().optional(),
faceSimilarityScore: z.number().min(0).max(1).nullable().optional(),
gatesRan: z.array(PcdQcGateKeySchema).nullable().optional(),
gateVerdicts: PcdQcGateVerdictsSchema.nullable().optional(),
qcEvaluationVersion: z.string().nullable().optional(),
qcGateMatrixVersion: z.string().nullable().optional(),
```

New writer-input schema (separate, narrower):

```ts
export const PcdSp5QcLedgerInputSchema = z.object({
  // Identity-side (required)
  assetRecordId: z.string(),
  productIdentityId: z.string(),
  pcdIdentitySnapshotId: z.string(),                    // REQUIRED for SP5 writes
  creatorIdentityId: z.string().nullable(),             // required when face gate ran (refine below)

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
  colorDeltaScore: z.number().min(0).nullable(),         // not in SP5 gate set; always null in SP5

  // Aggregate (derived from gateVerdicts.aggregateStatus)
  passFail: z.enum(["pass", "fail", "warn"]),
  warnings: z.array(z.string()),
})
.refine(
  (v) => !v.gatesRan.includes("face_similarity")
    || (v.creatorIdentityId !== null && v.faceSimilarityScore !== null),
  {
    message:
      "creatorIdentityId and faceSimilarityScore required when face_similarity gate ran",
  },
)
.refine(
  (v) => v.gatesRan.length === v.gateVerdicts.gates.length
    && v.gatesRan.every((g, i) => g === v.gateVerdicts.gates[i].gate),
  { message: "gatesRan must equal gateVerdicts.gates[*].gate (same order)" },
);
export type PcdSp5QcLedgerInput = z.infer<typeof PcdSp5QcLedgerInputSchema>;
```

### `packages/db/prisma/schema.prisma` (`ProductQcResult` model — seven new fields)

```prisma
model ProductQcResult {
  // ... existing fields unchanged ...

  // SP5 additions (nullable for historical compatibility)
  creatorIdentityId         String?
  pcdIdentitySnapshotId     String?
  faceSimilarityScore       Float?
  gatesRan                  String[]
  gateVerdicts              Json?
  qcEvaluationVersion       String?
  qcGateMatrixVersion       String?

  // No new index on these columns.
}
```

### `packages/db/prisma/migrations/<timestamp>_pcd_qc_result_sp5_gates/migration.sql`

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

### `packages/db/src/stores/prisma-pcd-qc-result-store.ts` (new)

```ts
import type { Prisma, PrismaClient, ProductQcResult as PrismaProductQcResultRow } from "@prisma/client";
import type { PcdSp5QcLedgerInput, ProductQcResult } from "@creativeagent/schemas";

export class PrismaPcdQcResultStore {
  constructor(private readonly prisma: PrismaClient) {}

  async createForAsset(input: PcdSp5QcLedgerInput): Promise<ProductQcResult> {
    const row = await this.prisma.productQcResult.create({
      data: {
        productIdentityId:        input.productIdentityId,
        assetRecordId:            input.assetRecordId,
        creatorIdentityId:        input.creatorIdentityId,
        pcdIdentitySnapshotId:    input.pcdIdentitySnapshotId,
        logoSimilarityScore:      input.logoSimilarityScore,
        packageOcrMatchScore:     input.packageOcrMatchScore,
        colorDeltaScore:          input.colorDeltaScore,
        geometryMatchScore:       input.geometryMatchScore,
        scaleConfidence:          input.scaleConfidence,
        faceSimilarityScore:      input.faceSimilarityScore,
        passFail:                 input.passFail,
        warnings:                 input.warnings,
        gatesRan:                 input.gatesRan,
        gateVerdicts:             input.gateVerdicts as unknown as Prisma.InputJsonValue,
        qcEvaluationVersion:      input.qcEvaluationVersion,
        qcGateMatrixVersion:      input.qcGateMatrixVersion,
      },
    });
    return mapPrismaRow(row);
  }
}
```

If method-name divergence emerges between the SP5 contract (`createForAsset`) and a Prisma-natural name (`create`), an `adaptPcdQcResultStore` adapter ships per SP4 precedent.

### `packages/creative-pipeline/src/pcd/qc-evaluation-version.ts` (new)

```ts
export const PCD_QC_EVALUATION_VERSION = "pcd-qc-evaluation@1.0.0";
```

### `packages/creative-pipeline/src/pcd/qc-providers.ts` (new)

```ts
// MERGE-BACK: replace with Switchboard QC provider contracts at merge-back time.
// SP5 ships only the contract surface; concrete implementations land in
// Switchboard's QC service.

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

### `packages/creative-pipeline/src/pcd/qc-gate-matrix.ts` (new)

```ts
import type {
  IdentityTier, PcdQcGateApplicability, PcdShotType,
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

  // Tier 1 deliberately empty for SP5 — telemetry enabled later via warn_only
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

The authored matrix above is illustrative; final rows tuned during implementation against the test invariants. Tier 1 rows: zero, by design.

### `packages/creative-pipeline/src/pcd/qc-face-similarity.ts` (new)

```ts
import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

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

The other three predicates follow the same shape:

- `runLogoSimilarityGate` — uses `LOGO_SIMILARITY_THRESHOLD`; skipped when `productLogoAssetId === null`.
- `runOcrPackageTextGate` — uses `OCR_EDIT_DISTANCE_THRESHOLD` (Levenshtein-ratio); skipped when `productCanonicalText === null`. Edit-distance compare is in-process; OCR provider returns text only.
- `runGeometryScaleGate` — uses `GEOMETRY_SCORE_THRESHOLD` and `SCALE_CONFIDENCE_THRESHOLD`; skipped when `productDimensionsMm === null`. Geometry returns two scalars (`score` + `scaleConfidence`); the predicate places `score` in `verdict.score` (the standard field) and `scaleConfidence` in `verdict.evidence.scaleConfidence` (since `PcdQcGateVerdict` reserves only one `score` field). Pass requires both `score >= GEOMETRY_SCORE_THRESHOLD` AND `scaleConfidence >= SCALE_CONFIDENCE_THRESHOLD`; either threshold miss → `fail`.

All four threshold constants are SP5-pinned and live next to their predicates. Bumping any threshold bumps `PCD_QC_EVALUATION_VERSION`.

### `packages/creative-pipeline/src/pcd/qc-aggregator.ts` (new)

```ts
import type {
  PcdQcAggregateStatus, PcdQcGateMode, PcdQcGateVerdict, PcdQcGateVerdicts,
} from "@creativeagent/schemas";

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
    // all skipped (or empty) → warn (skipped never aggregates to pass)
    status = "warn";
  }
  return { gates: [...verdicts], aggregateStatus: status };
}
```

### `packages/creative-pipeline/src/pcd/qc-evaluator.ts` (new)

```ts
import type {
  IdentityTier, OutputIntent, PcdIdentitySnapshot, PcdQcGateKey,
  PcdShotType, PcdSp5QcLedgerInput, ProductQcResult,
} from "@creativeagent/schemas";
import { PcdSp5QcLedgerInputSchema } from "@creativeagent/schemas";
import { PCD_QC_EVALUATION_VERSION } from "./qc-evaluation-version.js";
import {
  PCD_QC_GATE_MATRIX_VERSION, getPcdQcGateApplicability,
} from "./qc-gate-matrix.js";
import {
  applyPcdQcGateMode, aggregatePcdQcGateVerdicts,
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
// Note: outputIntent is intentionally NOT in the SP5 input. The matrix is
// keyed by (shotType, effectiveTier) only — QC scores generated assets the
// same way regardless of intent. SP6 consumes the persisted row alongside
// outputIntent state from elsewhere when deciding approval/export gates.

export type EvaluatePcdQcResultStores = {
  qcLedgerStore: PcdQcLedgerStore;
};

export async function evaluatePcdQcResult(
  input: EvaluatePcdQcResultInput,
  providers: PcdQcProviders,
  stores: EvaluatePcdQcResultStores,
): Promise<ProductQcResult>;
```

### `packages/creative-pipeline/src/index.ts` (re-exports added)

```ts
// SP5: QC gates
export {
  PCD_QC_EVALUATION_VERSION,
} from "./pcd/qc-evaluation-version.js";

export {
  PCD_QC_GATE_MATRIX,
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./pcd/qc-gate-matrix.js";

export {
  type SimilarityProvider,
  type OcrProvider,
  type GeometryProvider,
  type PcdQcProviders,
} from "./pcd/qc-providers.js";

export {
  runFaceSimilarityGate,
  type FaceSimilarityGateInput,
  FACE_SIMILARITY_THRESHOLD,
} from "./pcd/qc-face-similarity.js";

export {
  runLogoSimilarityGate,
  type LogoSimilarityGateInput,
  LOGO_SIMILARITY_THRESHOLD,
} from "./pcd/qc-logo-similarity.js";

export {
  runOcrPackageTextGate,
  type OcrPackageTextGateInput,
  OCR_EDIT_DISTANCE_THRESHOLD,
} from "./pcd/qc-ocr-match.js";

export {
  runGeometryScaleGate,
  type GeometryScaleGateInput,
  GEOMETRY_SCORE_THRESHOLD,
  SCALE_CONFIDENCE_THRESHOLD,
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

## Section 3 — Decision logic & invariants

### `evaluatePcdQcResult` algorithm

```
Input:    EvaluatePcdQcResultInput
Providers: PcdQcProviders
Stores:   { qcLedgerStore }

Step 1 — Matrix lookup.
  applicability = getPcdQcGateApplicability({
    shotType: input.shotType,
    effectiveTier: input.effectiveTier,
  })
  // Tier 1 returns []; non-applicable shot/tier combos return [].

Step 2 — Run applicable predicates in parallel.
  raw = await Promise.all(applicability.map(row => runGate(row.gate, …)))
  // Each predicate returns PcdQcGateVerdict; provider errors → status: "fail".
  // No try/catch swallowing in evaluator — predicates own their error mapping.

Step 3 — Apply mode lowering.
  moded = raw.map(({row, verdict}) => applyPcdQcGateMode(verdict, row.mode))
  // warn_only: fail → warn. Never lowers skipped/pass. Never raises status.

Step 4 — Aggregate.
  gateVerdicts = aggregatePcdQcGateVerdicts(moded)
  // any fail → fail; else any warn → warn; else any pass → pass; else warn (skipped/empty).

Step 5 — Build writer input.
  // Scalar-score columns are forensic-redundant convenience: they mirror
  // values that already live in gateVerdicts.gates[*].score (or, for
  // geometry's scaleConfidence, in verdict.evidence.scaleConfidence).
  // Extracted by gate key:
  //   faceSimilarityScore   = verdict("face_similarity")?.score   ?? null
  //   logoSimilarityScore   = verdict("logo_similarity")?.score   ?? null
  //   packageOcrMatchScore  = verdict("ocr_package_text")?.score  ?? null
  //   geometryMatchScore    = verdict("geometry_scale")?.score    ?? null
  //   scaleConfidence       = verdict("geometry_scale")?.evidence?.scaleConfidence ?? null
  //   colorDeltaScore       = null  (not a gate in SP5; column stays NULL)
  //
  // warnings is the list of reason strings from verdicts where status === "warn"
  // (post-mode-lowering). Skipped/pass verdicts contribute nothing to warnings.

  ledgerInput = PcdSp5QcLedgerInputSchema.parse({
    assetRecordId, productIdentityId: snapshot.productIdentityId,
    pcdIdentitySnapshotId: snapshot.id,
    creatorIdentityId: gatesRan.includes("face_similarity")
      ? snapshot.creatorIdentityId
      : null,
    qcEvaluationVersion: PCD_QC_EVALUATION_VERSION,        // import-pinned
    qcGateMatrixVersion: PCD_QC_GATE_MATRIX_VERSION,       // import-pinned
    gateVerdicts, gatesRan,
    faceSimilarityScore, logoSimilarityScore, packageOcrMatchScore,
    geometryMatchScore, scaleConfidence, colorDeltaScore: null,
    passFail: gateVerdicts.aggregateStatus,                // derived
    warnings,
  })

Step 6 — Persist.
  return qcLedgerStore.createForAsset(ledgerInput)
```

**Invariants:**

| Property | Guarantee |
|---|---|
| **Purity / I/O surface** | All I/O via injected `providers` and `stores`. No direct DB, network, time, or randomness in evaluator or any predicate. |
| **Matrix-driven, not code-driven** | Evaluator never branches on `effectiveTier` or `shotType`. Both flow through `getPcdQcGateApplicability` only. Tests assert evaluator source contains zero `if (effectiveTier ===` or `if (shotType ===` patterns. |
| **One row per asset** | `qcLedgerStore.createForAsset` is called exactly once per `evaluatePcdQcResult` invocation. Idempotency boundary owned by the store; SP5 ships single-call semantics. |
| **Tier 1 = zero providers called** | `Promise.all([])` short-circuits; no `providers.*` method invoked when matrix returns `[]`. Tested via fake recorder. |
| **`passFail` derives from `gateVerdicts.aggregateStatus`** | Never set independently. Test asserts equality. |
| **Block-mode fails cannot be downgraded** | `applyPcdQcGateMode` lowers only `warn_only` mode + `fail` status. Test asserts `block`+`fail` round-trips unchanged. |
| **Skipped never aggregates to pass** | All-skipped → `warn`. Tested. |
| **`creatorIdentityId` required when face gate ran** | Zod `.refine` on `PcdSp5QcLedgerInputSchema` enforces. |
| **`gatesRan` consistent with `gateVerdicts.gates`** | Zod `.refine` ensures order + identity match. |
| **Version pinning — both from imports** | `qcEvaluationVersion`, `qcGateMatrixVersion` come from imports; caller cannot override. |
| **No SP6 surface leakage** | Source grep test forbids `approval`, `canApprove`, `WorkTrace`, `outbox`, `ApprovalLifecycle`, `assetRecord.update` (case-insensitive) in evaluator + aggregator + predicate sources. |
| **Hard-block invariant (label-visible without OCR match)** | Structurally encoded: matrix `block` + OCR fail + aggregator any-fail → row `passFail: "fail"`. Test scenario asserts the full chain. SP5 owns steps 1–4; SP6 owns step 5 (refusal of approval advancement). |

**Predicate invariants (per-gate):**

| Property | Guarantee |
|---|---|
| **Skipped on missing inputs** | Face: empty `creatorReferenceAssetIds` → `skipped`. Logo: `productLogoAssetId === null` → `skipped`. OCR: `productCanonicalText === null` → `skipped`. Geometry: `productDimensionsMm === null` → `skipped`. |
| **Provider error → fail (not throw)** | Try/catch wraps the provider call; non-throw error returns `status: "fail"` with reason text including the error message. No exception escapes a predicate. |
| **Threshold pinned in source** | Each predicate exports its threshold const. Bumping threshold → bump `PCD_QC_EVALUATION_VERSION`. |
| **Reason required for every status** | `PcdQcGateVerdictSchema` requires `reason: string.min(1)`. Pass verdicts include the comparison; skipped includes the reason; fail includes the score + threshold. |
| **`>=` threshold semantics** | `score >= threshold → pass`; strict `<` → `fail`. Boundary case tested. |
| **No `score` for skipped verdicts** | Skipped verdicts omit `score` and `threshold`. Skipped never pretends to be a perfect pass. |

### Mode lowering rules (binding)

`applyPcdQcGateMode(verdict, mode)` semantics:

- `block` mode + any status → unchanged.
- `warn_only` mode + `fail` → `warn`, reason suffixed with `" (warn-only for this tier)"`.
- `warn_only` mode + `pass` → unchanged.
- `warn_only` mode + `warn` → unchanged.
- `warn_only` mode + `skipped` → unchanged.
- Mode lowering happens after the gate predicate returns and before aggregation. Never lowers skipped, never changes pass, never hides non-fail status.

### Aggregation rules (binding)

`aggregatePcdQcGateVerdicts(verdicts)` semantics:

- Any `fail` → `aggregateStatus = "fail"`.
- Else any `warn` → `aggregateStatus = "warn"`.
- Else any non-skipped `pass` → `aggregateStatus = "pass"`.
- Else (all skipped, or empty) → `aggregateStatus = "warn"`.
- Skipped never aggregates to `pass`.

### Tier 1 behavior (binding)

- `PCD_QC_GATE_MATRIX` ships with zero Tier 1 rows in SP5.
- `evaluatePcdQcResult` does not special-case Tier 1.
- `getPcdQcGateApplicability({ effectiveTier: 1, ... })` returns `[]` for any shot type.
- When no gates apply: no provider predicate is called; `gatesRan: []`; `gateVerdicts.gates: []`; `gateVerdicts.aggregateStatus: "warn"`; `passFail: "warn"`; `ProductQcResult` row is persisted.
- Invariant: every PCD-generated asset has a `ProductQcResult` row. Missing row remains an error/unprocessed state for SP6.
- Future Tier 1 telemetry: add `warn_only` rows + bump `PCD_QC_GATE_MATRIX_VERSION` to `pcd-qc-gate-matrix@1.1.0`. Zero orchestrator code change.

### Hard-block invariant (binding)

"A label-visible output without OCR match cannot be approved for final export" is structurally encoded end-to-end:

1. Matrix lists OCR for label-visible Tier 2/3 shots with `mode: "block"`.
2. OCR predicate returns `status: "fail"` when edit-distance exceeds threshold.
3. `applyPcdQcGateMode` does not lower a `block`-mode fail.
4. Aggregator: any fail → row `passFail = "fail"`.
5. SP6 (later, against merged-back Switchboard surface) refuses to advance approval when `passFail === "fail"`.

SP5 owns steps 1–4. SP6 owns step 5. SP5 ships zero approval-side code.

### Error semantics

| Failure | Where | Behavior |
|---|---|---|
| Provider throws | Inside predicate | Caught → returns `{ status: "fail", reason: "<gate> provider error: <message>" }`. Evaluator continues. |
| Matrix lookup empty | Step 1 | Continues with empty predicate set; row written with empty `gatesRan`, `aggregateStatus: "warn"`. |
| Bad ledger-input shape | Step 5 | `ZodError` propagates — evaluator bug, not caller bug. |
| `qcLedgerStore.createForAsset` throws | Step 6 | Propagates. Caller's retry policy decides. |

## Section 4 — Test plan

Vitest, in-memory fakes, no DB, no network. Co-located tests for every new module.

### `qc-providers.test.ts` (contract-only smoke)

- Type-shape assertions: `PcdQcProviders` has the three sub-providers; each has the expected method signature. No runtime tests beyond type-shape.

### `qc-gate-matrix.test.ts`

- **Constant pinning:** `expect(PCD_QC_GATE_MATRIX_VERSION).toBe("pcd-qc-gate-matrix@1.0.0")`.
- **Shape:** every row passes `PcdQcGateApplicabilitySchema.parse`.
- **No duplicate `(shotType, effectiveTier, gate)` rows** — Set-size equality assertion.
- **No Tier 1 rows** — `PCD_QC_GATE_MATRIX.filter(r => r.effectiveTier === 1)` is `[]`.
- **`getPcdQcGateApplicability({ effectiveTier: 1, shotType: any })` → `[]`** — exhaustive over all `PcdShotType` values.
- **Coverage assertions** (hand-listed in test, NOT imported from matrix file — prevents the "test imports same wrong table" failure mode):
  - Tier 2 + 3 `label_closeup` includes `ocr_package_text` with `mode: "block"`.
  - Tier 3 `face_closeup` includes `face_similarity` with `mode: "block"`.
  - Tier 3 `product_in_hand` includes `geometry_scale` with `mode: "block"`.
  - Tier 3 `object_insert` includes `geometry_scale` + `logo_similarity` with `mode: "block"`.
- **Forbidden-imports check.**

### `qc-aggregator.test.ts`

- **`applyPcdQcGateMode` truth table:**
  - `block` mode + each of `pass`, `warn`, `fail`, `skipped` → unchanged.
  - `warn_only` mode + `fail` → `warn`, reason suffixed with `" (warn-only for this tier)"`.
  - `warn_only` mode + `pass` → unchanged.
  - `warn_only` mode + `warn` → unchanged.
  - `warn_only` mode + `skipped` → unchanged.
- **`aggregatePcdQcGateVerdicts` truth table:**
  - Empty array → `warn`.
  - All skipped → `warn`.
  - Mix of pass + skipped → `pass`.
  - Mix of pass + warn → `warn`.
  - Mix of pass + fail → `fail`.
  - All fail → `fail`.
  - All warn → `warn`.
  - All pass → `pass`.
- **Forbidden-imports check.**

### Per-predicate test files (`qc-face-similarity.test.ts`, `qc-logo-similarity.test.ts`, `qc-ocr-match.test.ts`, `qc-geometry.test.ts`)

- **Skipped path:** empty refs / null inputs → `status: "skipped"`, no provider call (asserted via fake recorder).
- **Pass path:** provider returns score above threshold → `status: "pass"`, includes `score` + `threshold`.
- **Fail path:** provider returns score below threshold → `status: "fail"`, reason includes both numbers.
- **Provider-throw path:** `status: "fail"` with reason including the error message; no exception escapes.
- **Threshold-boundary test:** `score === threshold` → `pass` (`>=` semantics).
- **Reason-non-empty assertion** on every return path.
- **Forbidden-imports check.**

### `qc-evaluator.test.ts` (the slice's heart)

In-memory fakes for all three providers (recording every call) and `qcLedgerStore` (recording every `createForAsset` call). Tests use the live `PCD_QC_GATE_MATRIX` import except where `vi.doMock` is needed for matrix manipulation; those blocks wrap in `describe`/`beforeEach`/`afterEach` calling `vi.resetModules()` and `vi.restoreAllMocks()`.

**Part A — Matrix-driven dispatch.**
1. Tier-2 + `simple_ugc` + `final_export`: only matrix-listed gates run. Asserted via fake-recorder count.
2. Tier-3 + `face_closeup`: face_similarity called; logo/ocr/geometry not called (unless matrix lists them). Exact assertion against the live matrix state.
3. **Tier-1 + any shot:** zero provider calls across all three providers. `Promise.all([])` short-circuit verified via fake recorder.
4. Evaluator source contains zero string-literal references to gate keys in conditionals (regex-grep test). The `switch (row.gate)` predicate dispatch is allowed — it's data-keyed.
5. Evaluator source contains zero `if (effectiveTier ===` and zero `if (shotType ===` patterns (regex-grep).

**Part B — Mode lowering.**
6. `warn_only` row + provider returns below threshold → row's `gateVerdicts.gates[i].status === "warn"` (lowered).
7. `block` row + provider returns below threshold → `status === "fail"`.
8. `block` + `fail` round-trip: status unchanged through `applyPcdQcGateMode`.

**Part C — Aggregation correctness.**
9. Single fail among warns/passes → row `passFail === "fail"`.
10. No fails, single warn → `passFail === "warn"`.
11. All pass → `passFail === "pass"`.
12. All skipped → `passFail === "warn"`.
13. Empty matrix (Tier 1) → `passFail === "warn"`, `gatesRan: []`, `gateVerdicts.gates: []`.

**Part D — Hard-block invariant (the slice's strongest scenario).**
14. Tier-3 `label_closeup` + OCR provider returns text that fails edit-distance threshold → row `passFail === "fail"`. End-to-end chain: matrix `block` + predicate `fail` + aggregator any-fail → `fail`. Asserts no mode-lowering escape hatch.
15. Tier-2 `product_demo` + OCR fail → `passFail === "warn"` (row is `warn_only` at Tier 2 per the authored matrix; if matrix changes, test reflects).

**Part E — Persistence shape.**
16. `qcLedgerStore.createForAsset` called exactly once per evaluation.
17. Payload `pcdIdentitySnapshotId === input.identitySnapshot.id`.
18. Payload `qcEvaluationVersion === PCD_QC_EVALUATION_VERSION`; `qcGateMatrixVersion === PCD_QC_GATE_MATRIX_VERSION`.
19. Payload `passFail === gateVerdicts.aggregateStatus`.
20. Payload `gatesRan` exactly equals `gateVerdicts.gates.map(g => g.gate)` in same order.
21. Payload `creatorIdentityId === snapshot.creatorIdentityId` when face_similarity ran; `null` otherwise.
22. Payload `faceSimilarityScore === <face verdict score>` when face_similarity ran; `null` otherwise.
23. Returned value is the fake's response (evaluator does not transform).

**Part F — Version-pinning bypass closure.**
24. Caller passes input with extra `qcEvaluationVersion: "bogus"` key (cast as `unknown`); assert `createForAsset` payload's `qcEvaluationVersion === PCD_QC_EVALUATION_VERSION`. Same for `qcGateMatrixVersion`. Demonstrates the evaluator does not consume caller-provided versions.

**Part G — No SP6 leakage.**
25. Source-grep across `qc-evaluator.ts`, `qc-aggregator.ts`, four predicates: zero matches for `approval`, `canApprove`, `WorkTrace`, `outbox`, `ApprovalLifecycle`, `assetRecord.update` (case-insensitive).

**Part H — Determinism.**
26. Two consecutive calls with identical inputs and identical fake-provider responses → deep-equal `createForAsset` payloads.

**Part I — Forbidden imports.** Same regex set as SP4: `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `from "http"`, `from "https"`.

### `prisma-pcd-qc-result-store-sp5.test.ts` (`packages/db/src/stores/__tests__/`)

Integration-style test using the Prisma test-DB harness (matches SP4's `prisma-pcd-identity-snapshot-store-sp4.test.ts` precedent).

- `createForAsset` round-trip: writes a row, reads it back, all seven new columns present and round-trip-equal.
- `gateVerdicts` JSON round-trip: stored as JSONB, parsed back equals input.
- `gatesRan` empty array round-trip: stored as `[]`, read back as `[]`.
- `pcdIdentitySnapshotId` references a real `PcdIdentitySnapshot` row inserted in test setup.
- Pre-SP5 row read-back: insert a row via raw SQL with the seven new columns NULL (or `'{}'` for `gatesRan`); read via the store; schema parse succeeds.

### `pcd-identity-sp5.test.ts` (`packages/schemas/src/__tests__/`)

- All new schemas Zod-parse on canonical happy-path input.
- `PcdQcGateVerdictSchema`: `reason` empty string rejected.
- `PcdSp5QcLedgerInputSchema`: missing required forensic field (`pcdIdentitySnapshotId`, `qcEvaluationVersion`, `qcGateMatrixVersion`, `gateVerdicts`, `gatesRan`) → `ZodError`.
- `PcdSp5QcLedgerInputSchema` `.refine`: face_similarity in `gatesRan` + `creatorIdentityId === null` → `ZodError`.
- `PcdSp5QcLedgerInputSchema` `.refine`: face_similarity in `gatesRan` + `faceSimilarityScore === null` → `ZodError`.
- `PcdSp5QcLedgerInputSchema` `.refine`: `gatesRan` order doesn't match `gateVerdicts.gates` order → `ZodError`.
- Round-trip `ProductQcResultSchema` parses both pre-SP5 (NULL fields) and SP5 (filled) shapes.

## Section 5 — Hard guardrails for implementation

- **No new provider integrations.** Three contract surfaces ship; concrete implementations are merge-back-only.
- **No UI, no dashboard, no API route changes.**
- **No retry / fallback / circuit-breaker logic.** Provider errors map to gate-level `fail` verdicts.
- **No async-job refactor.** SP5 ships zero Inngest functions.
- **No QC engine implementation.** Face-embedding model, OCR provider, logo similarity, geometry/depth model are all out of scope.
- **No approval / Meta draft / consent revocation behavior.** SP6 owns these.
- **No `WorkTrace` / outbox emission.** Reserved for merge-back.
- **No backfill of legacy `ProductQcResult` rows.** No follow-up null→non-null migration.
- **No edits to SP1–SP4 module bodies** (`registry-backfill.ts`, `tier-policy.ts`, `registry-resolver.ts`, `provider-router.ts`, `pcd-identity-snapshot-writer.ts`, `tier3-routing-rules.ts`, `provider-capability-matrix.ts`).
- **No new index** on the seven new `ProductQcResult` columns.
- **No edits to any `packages/db/src/stores/*` file** other than the new `prisma-pcd-qc-result-store.ts` (and optional adapter).
- **No hardcoded gate names in `qc-evaluator.ts` conditionals.** The `switch (row.gate)` for predicate dispatch is allowed (data-keyed). No `if (gate === ...)` outside that switch.
- **No mutation of `PCD_QC_GATE_MATRIX`** at runtime.
- **No re-import of `PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`, or `PCD_SHOT_SPEC_VERSION`** in SP5 modules — those belong to other slices' forensic state.
- **Predicates do not import `qc-gate-matrix.ts` or `qc-evaluator.ts`.** One-way dependency: evaluator → predicates + matrix + aggregator.
- **Evaluator imports each predicate by name; no dynamic require / no string-keyed dispatch table.** Static imports keep tree-shaking and grep clean.
- **All new test files include the forbidden-imports regex check.**
- **All four QC predicate modules live in `packages/creative-pipeline/src/pcd/`** with co-located `*.test.ts`.

## Section 6 — Acceptance criteria

The six locked SP5 acceptance conditions:

1. `evaluatePcdQcResult` returns the persisted `ProductQcResult` row.
2. `passFail` is derived from `gateVerdicts.aggregateStatus`.
3. Block-mode gate failures cannot be downgraded.
4. `ProductQcResult` includes `pcdIdentitySnapshotId` when written by SP5.
5. SP5 exports pure QC aggregation/mode helpers only.
6. SP5 exports no approval helper, no approval-state mutation, no lifecycle code, no outbox/event emission.

Plus the structural guardrails:

7. **Tier 1 = zero provider calls.** Verified by Part A test 3 (fake-recorder count) plus the gate-matrix invariant (zero Tier 1 rows).
8. **Hard-block invariant proven end-to-end.** Verified by Part D test 14 — matrix `block` + OCR `fail` + aggregator any-fail → row `passFail === "fail"`.
9. **Build / typecheck / lint green** across all packages: `pnpm install && pnpm db:generate && pnpm typecheck && pnpm test && pnpm lint`. Lint warnings count unchanged from `origin/main`.

## Section 7 — Module file inventory (delta from `origin/main`)

```
NEW:
  packages/creative-pipeline/src/pcd/qc-evaluation-version.ts
  packages/creative-pipeline/src/pcd/qc-providers.ts
  packages/creative-pipeline/src/pcd/qc-gate-matrix.ts
  packages/creative-pipeline/src/pcd/qc-gate-matrix.test.ts
  packages/creative-pipeline/src/pcd/qc-face-similarity.ts
  packages/creative-pipeline/src/pcd/qc-face-similarity.test.ts
  packages/creative-pipeline/src/pcd/qc-logo-similarity.ts
  packages/creative-pipeline/src/pcd/qc-logo-similarity.test.ts
  packages/creative-pipeline/src/pcd/qc-ocr-match.ts
  packages/creative-pipeline/src/pcd/qc-ocr-match.test.ts
  packages/creative-pipeline/src/pcd/qc-geometry.ts
  packages/creative-pipeline/src/pcd/qc-geometry.test.ts
  packages/creative-pipeline/src/pcd/qc-aggregator.ts
  packages/creative-pipeline/src/pcd/qc-aggregator.test.ts
  packages/creative-pipeline/src/pcd/qc-evaluator.ts
  packages/creative-pipeline/src/pcd/qc-evaluator.test.ts
  packages/db/src/stores/prisma-pcd-qc-result-store.ts
  packages/db/src/stores/__tests__/prisma-pcd-qc-result-store-sp5.test.ts
  packages/schemas/src/__tests__/pcd-identity-sp5.test.ts
  packages/db/prisma/migrations/<timestamp>_pcd_qc_result_sp5_gates/migration.sql

MODIFIED:
  packages/schemas/src/pcd-identity.ts
    + 7 new schemas/types (PcdQcGateKey, PcdQcGateStatus, PcdQcAggregateStatus,
        PcdQcGateMode, PcdQcGateVerdict, PcdQcGateVerdicts, PcdQcGateApplicability,
        PcdSp5QcLedgerInput)
    + 7 nullable fields on ProductQcResultSchema

  packages/db/prisma/schema.prisma
    + 7 nullable fields on ProductQcResult model

  packages/creative-pipeline/src/index.ts
    + SP5 re-exports

  docs/SWITCHBOARD-CONTEXT.md
    + lines on QC provider implementations and ProductQcResult name reconciliation
```

## Design questions resolved during brainstorming

| Q | Answer | Rationale |
|---|---|---|
| Q1: How should the QC ledger row evolve — additive widen, rename, or two-table? | **A — additive widen `ProductQcResult` in place.** Add seven nullable columns (`creatorIdentityId`, `pcdIdentitySnapshotId`, `faceSimilarityScore`, `gatesRan`, `gateVerdicts`, `qcEvaluationVersion`, `qcGateMatrixVersion`). Do not rename in SP5. Do not split tables. | Rename creates merge-back friction (SP1 was extracted verbatim from Switchboard). Two-table model fragments the QC ledger and forces SP6 into multi-row joins. Additive widen matches SP4's discipline (nullable for historical compatibility, required at writer-input). One generated asset → one QC row carrying both product-side and creator-side outcomes. |
| Q2: Predicate signature — all-async, mixed, or sync-with-pre-fetched-evidence? | **A — all-async, uniform predicate signature** `(input, providers) => Promise<PcdQcGateVerdict>`. Geometry uses a provider abstraction even though the first implementer is a stub. | Mixed sync/async leaks orchestration policy into predicates. Sync-with-evidence adds a second surface (evidence gathering) before SP5 has stable provider contracts. Uniform async matches SP4's store/provider injection discipline. Skipped gates omit `score` — never `score: 1.0` (avoids fake-pass misread). |
| Q3: Where does the gate-applicability matrix live? | **A — new declarative `PCD_QC_GATE_MATRIX` data table** with its own `PCD_QC_GATE_MATRIX_VERSION`, separate from SP4's provider capability matrix. | SP4 answers "which provider may generate this shot?" SP5 answers "which QC gates must evaluate this generated asset, and are failures blocking or warn-only?" Different governance questions; different evolution rates; keep matrices separate. Predicates know nothing about tier or shot type — matrix governs. Absence from matrix means skip; no `"skip"` rows. |
| Q4: Linkage direction between `PcdIdentitySnapshot` and the QC row? | **A — one-way QC → snapshot only.** `ProductQcResult.pcdIdentitySnapshotId` (nullable in DB, required at SP5 writer-input). Zero columns added to `PcdIdentitySnapshot`. | Snapshot is written before QC exists; reverse pointer would require a later mutation, breaking SP4's append-only invariant. The forward pointer matches the temporal order (snapshot first, QC scores it later). SP6 can join QC ↔ snapshot via `assetRecordId` for any reverse query. |
| Q5: SP5 ↔ SP6 boundary — what does SP5 expose? | **A — only the persisted QC row + pure QC helpers.** SP5 ships `evaluatePcdQcResult`, `aggregatePcdQcGateVerdicts`, `applyPcdQcGateMode`, `getPcdQcGateApplicability`, four pure-async predicates, and the persisted `ProductQcResult` row with `passFail` + `gateVerdicts`. SP5 ships **no** `canApprove`, no `interpretPcdQcResult`, no approval helpers, no lifecycle code, no outbox/event emission. | Approval may later depend on signals QC should not know about (consent state, campaign approval, Meta draft status, human override, revocation, WorkTrace state). Shipping any "approval helper" in SP5 is governance leakage. The contract surface SP6 consumes is the persisted row, not a helper function. |
| Q6: Tier 1 behavior — do QC gates run? | **C — matrix-controlled with zero Tier 1 rows in SP5; still write the QC ledger row.** `evaluatePcdQcResult` is one orchestration path; matrix returns `[]` for Tier 1; row written with empty `gatesRan`, `gateVerdicts.gates: []`, `aggregateStatus: "warn"`, `passFail: "warn"`. | Hardcoding `if (effectiveTier === 1)` puts Tier 1 policy in code (B). Running real providers on every Tier 1 draft is unnecessary spend before the product proves the telemetry's value (A). Matrix-empty-Tier-1 keeps the orchestrator one path, gives Tier 1 a forensic row (preserves the "every PCD asset has a QC row" invariant SP6 relies on), and lets future Tier 1 telemetry come on with a one-row matrix change + version bump — zero orchestrator code change. |

## Architectural context

This SP5 module set sits at the **post-generation evidence** position in the broader PCD orchestration:

```
PCD job submitted
  → PcdRegistryResolver        (SP3; ResolvedPcdContext stamps tier)
  → ShotSpecPlanner            (later)
  → PcdTierPolicy              (SP2; called by SP4 router per shot)
  → ProviderRouter             (SP4)
  → execution / provider call  (apps/api at merge-back)
  → PcdIdentitySnapshot writer (SP4)
  → QC                         ◀── SP5 (this slice)
  → Approval / export          (SP6)
```

The deliberate design choice: **gates score, matrix governs, orchestrator normalizes and persists.** Predicates know nothing about tiers or shot types. The matrix is the entire policy surface. The orchestrator is one code path. SP5's hard-block invariant ("label-visible without OCR match cannot be approved for final export") is proven structurally end-to-end through the matrix + predicate + aggregator chain — no procedural special-casing.

Every other concern — actual QC provider implementations, retries, approval transitions, Meta draft creation, consent enforcement, WorkTrace emission — lives downstream and consumes SP5's outputs.
