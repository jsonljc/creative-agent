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
