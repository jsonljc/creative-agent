import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of ConsentRecordReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface ConsentRecordReader {
  findById(consentRecordId: string): Promise<{
    id: string;
    revoked: boolean;
    revokedAt: Date | null;
  } | null>;
}

export class PrismaConsentRecordReader implements ConsentRecordReader {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    const row = await this.prisma.consentRecord.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, revoked: row.revoked, revokedAt: row.revokedAt };
  }
}
