// PCD slice SP11 — read surface for CreatorIdentitySynthetic.
// Pure read methods. The compatible-set queries here are consumed by
// the SP14 SyntheticCreatorSelector — keep the result shape stable so
// the selector contract doesn't churn as new fields are added.
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
  type Market,
  type TreatmentClass,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentitySyntheticReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(creatorIdentityId: string): Promise<CreatorIdentitySyntheticPayload | null> {
    const row = await this.prisma.creatorIdentitySynthetic.findUnique({
      where: { creatorIdentityId },
    });
    if (!row) return null;
    return this.parse(row);
  }

  async findByMarketAndTreatmentClass(
    market: Market,
    treatmentClass: TreatmentClass,
  ): Promise<CreatorIdentitySyntheticPayload[]> {
    const rows = await this.prisma.creatorIdentitySynthetic.findMany({
      where: { market, treatmentClass, status: "active" },
      orderBy: [{ pricePositioning: "desc" }, { creatorIdentityId: "asc" }],
    });
    return rows.map((r) => this.parse(r));
  }

  async listAll(): Promise<CreatorIdentitySyntheticPayload[]> {
    const rows = await this.prisma.creatorIdentitySynthetic.findMany({
      orderBy: { creatorIdentityId: "asc" },
    });
    return rows.map((r) => this.parse(r));
  }

  private parse(row: {
    creatorIdentityId: string;
    treatmentClass: string;
    vibe: string;
    market: string;
    ethnicityFamily: string;
    ageBand: string;
    pricePositioning: string;
    physicalDescriptors: unknown;
    dallePromptLocked: string;
    klingDirection: unknown;
    voiceCaptionStyle: unknown;
    mutuallyExclusiveWithIds: string[];
    status: string;
  }): CreatorIdentitySyntheticPayload {
    return CreatorIdentitySyntheticPayloadSchema.parse({
      creatorIdentityId: row.creatorIdentityId,
      treatmentClass: row.treatmentClass,
      vibe: row.vibe,
      market: row.market,
      ethnicityFamily: row.ethnicityFamily,
      ageBand: row.ageBand,
      pricePositioning: row.pricePositioning,
      physicalDescriptors: row.physicalDescriptors,
      dallePromptLocked: row.dallePromptLocked,
      klingDirection: row.klingDirection,
      voiceCaptionStyle: row.voiceCaptionStyle,
      mutuallyExclusiveWithIds: row.mutuallyExclusiveWithIds,
      status: row.status,
    });
  }
}
