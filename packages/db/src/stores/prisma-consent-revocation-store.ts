import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of the SP6 ConsentRevocationStore interface from
 * @creativeagent/creative-pipeline. Defined locally to respect the Layer 2
 * constraint (db → schemas + @prisma/client only; creative-pipeline is Layer 3
 * and may not be imported here). TypeScript structural typing ensures the class
 * satisfies the upstream contract.
 */
export interface ConsentRevocationStore {
  findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]>;
  markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }>;
}

/**
 * Prisma implementer of the SP6 ConsentRevocationStore contract.
 *
 * Two queries:
 *   1. JOIN AssetRecord → PcdIdentitySnapshot on consentRecordId.
 *   2. partition AssetRecord rows by current consentRevokedAfterGeneration value,
 *      then updateMany the false ones.
 *
 * Sort outputs ascending for deterministic decision payloads. SP6 idempotency
 * tests depend on stable ordering.
 */
export class PrismaConsentRevocationStore implements ConsentRevocationStore {
  constructor(private prisma: PrismaClient) {}

  async findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]> {
    const rows = await this.prisma.pcdIdentitySnapshot.findMany({
      where: { consentRecordId },
      select: { assetRecordId: true },
    });
    return rows.map((r) => r.assetRecordId).sort();
  }

  async markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }> {
    if (assetRecordIds.length === 0) {
      return { newlyFlagged: [], alreadyFlagged: [] };
    }
    const before = await this.prisma.assetRecord.findMany({
      where: { id: { in: assetRecordIds } },
      select: { id: true, consentRevokedAfterGeneration: true },
    });
    const newlyFlaggedIds = before.filter((r) => !r.consentRevokedAfterGeneration).map((r) => r.id);
    const alreadyFlaggedIds = before
      .filter((r) => r.consentRevokedAfterGeneration)
      .map((r) => r.id);

    if (newlyFlaggedIds.length > 0) {
      await this.prisma.assetRecord.updateMany({
        where: { id: { in: newlyFlaggedIds } },
        data: { consentRevokedAfterGeneration: true },
      });
    }

    return {
      newlyFlagged: newlyFlaggedIds.slice().sort(),
      alreadyFlagged: alreadyFlaggedIds.slice().sort(),
    };
  }
}
