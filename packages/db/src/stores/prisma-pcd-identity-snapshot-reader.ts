import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of PcdIdentitySnapshotReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface PcdIdentitySnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    creatorIdentityId: string;
    consentRecordId: string | null;
  } | null>;
}

export class PrismaPcdIdentitySnapshotReader implements PcdIdentitySnapshotReader {
  constructor(private prisma: PrismaClient) {}

  async findByAssetRecordId(assetRecordId: string) {
    const row = await this.prisma.pcdIdentitySnapshot.findUnique({ where: { assetRecordId } });
    if (row === null) return null;
    return {
      assetRecordId: row.assetRecordId,
      creatorIdentityId: row.creatorIdentityId,
      consentRecordId: row.consentRecordId,
    };
  }
}
