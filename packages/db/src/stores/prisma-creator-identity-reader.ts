import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of CreatorIdentityReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface CreatorIdentityReader {
  findById(creatorIdentityId: string): Promise<{
    id: string;
    consentRecordId: string | null;
  } | null>;
}

export class PrismaCreatorIdentityReader implements CreatorIdentityReader {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    const row = await this.prisma.creatorIdentity.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, consentRecordId: row.consentRecordId };
  }
}
