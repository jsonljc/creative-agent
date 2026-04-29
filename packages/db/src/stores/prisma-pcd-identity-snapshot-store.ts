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

// Adapter for SP4's writer contract. The creative-pipeline writer expects an
// object exposing `createForShot(input)`; the Prisma store exposes `create(input)`
// with the same input/output shape. This adapter bridges the two without
// renaming either side. Adapter ships in @creativeagent/db so it lives next to
// the Prisma store; @creativeagent/creative-pipeline cannot import from db
// (layer rule), so production wiring at merge-back consumes this adapter from
// the apps/api layer.
export type PcdIdentitySnapshotStoreAdapter = {
  createForShot(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdIdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdIdentitySnapshotStoreAdapter {
  return {
    createForShot: (input) => store.create(input),
  };
}
