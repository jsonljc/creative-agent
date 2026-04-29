import type { PrismaClient } from "@prisma/client";

/**
 * Structural mirror of CreativeJobReader from `@creativeagent/creative-pipeline`.
 * Defined locally to respect Layer 2 (db → schemas + @prisma/client only).
 */
export interface CreativeJobReader {
  findById(jobId: string): Promise<{
    id: string;
    effectiveTier: number | null;
  } | null>;
}

export class PrismaCreativeJobReader implements CreativeJobReader {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    const row = await this.prisma.creativeJob.findUnique({ where: { id } });
    if (row === null) return null;
    return { id: row.id, effectiveTier: row.effectiveTier };
  }
}
