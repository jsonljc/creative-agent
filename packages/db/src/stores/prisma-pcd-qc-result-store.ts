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
