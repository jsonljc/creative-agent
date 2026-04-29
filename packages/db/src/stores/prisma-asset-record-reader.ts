import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of AssetRecordReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface AssetRecordReader {
  findById(assetRecordId: string): Promise<{
    id: string;
    jobId: string;
    creatorId: string | null;
    approvalState: string;
  } | null>;
}

export class PrismaAssetRecordReader implements AssetRecordReader {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    const row = await this.prisma.assetRecord.findUnique({ where: { id } });
    if (row === null) return null;
    return {
      id: row.id,
      jobId: row.jobId,
      creatorId: row.creatorId,
      approvalState: row.approvalState,
    };
  }
}
