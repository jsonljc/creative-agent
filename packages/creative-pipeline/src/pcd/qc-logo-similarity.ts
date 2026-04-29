import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

// SP5-pinned threshold. Bumping this requires bumping
// PCD_QC_EVALUATION_VERSION (pcd-qc-evaluation@1.x.0).
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
