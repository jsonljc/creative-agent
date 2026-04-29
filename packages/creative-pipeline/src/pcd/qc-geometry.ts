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
