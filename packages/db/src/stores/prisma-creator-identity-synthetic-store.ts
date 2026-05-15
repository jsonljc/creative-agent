// PCD slice SP11 — write surface for CreatorIdentitySynthetic.
// Validates input via the SP11 zod schema before any DB write.
// Upsert semantics on (creatorIdentityId): the parent CreatorIdentity
// row must exist and have kind = "synthetic".
import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentitySyntheticStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async create(input: CreatorIdentitySyntheticPayload): Promise<void> {
    const payload = CreatorIdentitySyntheticPayloadSchema.parse(input);

    const data = {
      treatmentClass: payload.treatmentClass,
      vibe: payload.vibe,
      market: payload.market,
      ethnicityFamily: payload.ethnicityFamily,
      ageBand: payload.ageBand,
      pricePositioning: payload.pricePositioning,
      physicalDescriptors: payload.physicalDescriptors,
      dallePromptLocked: payload.dallePromptLocked,
      klingDirection: payload.klingDirection,
      // SP17 — normalize undefined → DB NULL at write time per design J1.
      // The schema accepts nullish() at ingestion; the DB column only ever
      // stores SQL NULL or a structured object. Prisma's nullable Json input
      // requires Prisma.JsonNull (not raw null) to write SQL NULL.
      seedanceDirection: payload.seedanceDirection
        ? (payload.seedanceDirection as object)
        : Prisma.JsonNull,
      voiceCaptionStyle: payload.voiceCaptionStyle,
      mutuallyExclusiveWithIds: [...payload.mutuallyExclusiveWithIds],
      status: payload.status,
    };

    await this.prisma.creatorIdentitySynthetic.upsert({
      where: { creatorIdentityId: payload.creatorIdentityId },
      create: { creatorIdentityId: payload.creatorIdentityId, ...data },
      update: data,
    });
  }
}
