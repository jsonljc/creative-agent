import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of ProductQcResultReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface ProductQcResultReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    passFail: "pass" | "fail" | "warn";
  } | null>;
}

export class PrismaProductQcResultReader implements ProductQcResultReader {
  constructor(private prisma: PrismaClient) {}

  async findByAssetRecordId(assetRecordId: string) {
    const row = await this.prisma.productQcResult.findFirst({ where: { assetRecordId } });
    if (row === null) return null;
    if (row.passFail !== "pass" && row.passFail !== "fail" && row.passFail !== "warn") {
      // Defensive narrow — DB column is unconstrained String. SP5 writes one of
      // the three values; any other value is upstream corruption.
      throw new Error(`PrismaProductQcResultReader: unexpected passFail value "${row.passFail}"`);
    }
    return { assetRecordId: row.assetRecordId, passFail: row.passFail as "pass" | "fail" | "warn" };
  }
}
