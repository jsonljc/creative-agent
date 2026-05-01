// PCD slice SP11 — write surface for CreatorIdentitySynthetic.
// Validates input via the SP11 zod schema before any DB write.
// Upsert semantics on (creatorIdentityId): the parent CreatorIdentity
// row must exist and have kind = "synthetic".
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentitySyntheticStore {
  constructor(private readonly prisma: PrismaClient) {}

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
