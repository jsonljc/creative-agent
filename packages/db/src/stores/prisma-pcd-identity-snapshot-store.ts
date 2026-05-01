import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
  PcdRoutingDecisionReason,
  PcdSp10CostForecastReason,
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

// SP9 — wider input. Same shape as SP4's input, plus five lineage ids and
// the lineage decision reason. Used only by createForShotWithProvenance.
export interface CreatePcdIdentitySnapshotWithProvenanceInput extends CreatePcdIdentitySnapshotInput {
  briefId: string;
  trendId: string;
  motivatorId: string;
  hookId: string;
  scriptId: string;
  lineageDecisionReason: PcdProvenanceDecisionReason;
}

// SP10A — wider input. Same shape as SP9's input, plus the cost forecast
// reason. Used only by createForShotWithCostForecast.
export interface CreatePcdIdentitySnapshotWithCostForecastInput extends CreatePcdIdentitySnapshotWithProvenanceInput {
  costForecastReason: PcdSp10CostForecastReason;
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

  // SP9 — additive persistence path. Writes the 19-field SP4 shape PLUS the
  // five lineage ids and the lineage decision reason. Legacy create() is
  // preserved unchanged for callsites that have no lineage to stamp.
  async createForShotWithProvenance(
    input: CreatePcdIdentitySnapshotWithProvenanceInput,
  ): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, lineageDecisionReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
        lineageDecisionReason: lineageDecisionReason as unknown as object,
      },
    }) as unknown as PcdIdentitySnapshot;
  }

  // SP10A — additive persistence path. Writes the SP9 25-field shape PLUS
  // the SP10A cost forecast reason. Legacy create() and SP9
  // createForShotWithProvenance() are preserved unchanged.
  async createForShotWithCostForecast(
    input: CreatePcdIdentitySnapshotWithCostForecastInput,
  ): Promise<PcdIdentitySnapshot> {
    const { routingDecisionReason, lineageDecisionReason, costForecastReason, ...rest } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
        lineageDecisionReason: lineageDecisionReason as unknown as object,
        costForecastReason: costForecastReason as unknown as object,
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

// SP9 adapter — bridges the SP9 orchestrator's PcdSp9IdentitySnapshotStore
// contract to the Prisma createForShotWithProvenance() method. Production
// wiring at merge-back consumes this adapter from the apps/api layer.
export type PcdSp9IdentitySnapshotStoreAdapter = {
  createForShotWithProvenance(
    input: CreatePcdIdentitySnapshotWithProvenanceInput,
  ): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdSp9IdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdSp9IdentitySnapshotStoreAdapter {
  return {
    createForShotWithProvenance: (input) => store.createForShotWithProvenance(input),
  };
}

// SP10A adapter — bridges the SP10A orchestrator's PcdSp10IdentitySnapshotStore
// contract to the Prisma createForShotWithCostForecast() method. Production
// wiring at merge-back consumes this adapter from the apps/api layer.
export type PcdSp10IdentitySnapshotStoreAdapter = {
  createForShotWithCostForecast(
    input: CreatePcdIdentitySnapshotWithCostForecastInput,
  ): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdSp10IdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdSp10IdentitySnapshotStoreAdapter {
  return {
    createForShotWithCostForecast: (input) => store.createForShotWithCostForecast(input),
  };
}
