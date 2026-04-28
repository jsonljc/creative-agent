import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdRoutingDecisionReason,
} from "@creativeagent/schemas";

export interface CreatePcdIdentitySnapshotInput {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: IdentityTier;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: IdentityTier;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  policyVersion: string;
  providerCapabilityVersion: string;
  selectedProvider: string;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  // SP4 additions
  shotSpecVersion: string | null;
  routerVersion: string | null;
  routingDecisionReason: PcdRoutingDecisionReason | null;
}

export class PrismaPcdIdentitySnapshotStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
      },
    }) as unknown as PcdIdentitySnapshot;
  }

  async getByAssetRecordId(assetRecordId: string): Promise<PcdIdentitySnapshot | null> {
    return this.prisma.pcdIdentitySnapshot.findUnique({
      where: { assetRecordId },
    }) as unknown as PcdIdentitySnapshot | null;
  }
}
