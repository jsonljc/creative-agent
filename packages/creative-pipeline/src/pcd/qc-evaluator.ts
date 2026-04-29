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
import { PCD_QC_GATE_MATRIX_VERSION, getPcdQcGateApplicability } from "./qc-gate-matrix.js";
import { applyPcdQcGateMode, aggregatePcdQcGateVerdicts } from "./qc-aggregator.js";
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
