import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type {
  IdentityTier,
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
  PcdRoutingDecisionReason,
  PcdSp10CostForecastReason,
  PcdSp18SyntheticRoutingDecisionReason,
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

// SP18 — wider input. Same shape as SP9's input, plus the 6 SP18 flat fields
// and the SP18 synthetic-routing decision reason. NOTE: extends SP9 directly,
// not SP10A — SP18 path is the synthetic-routing-only persistence path and
// does NOT bundle SP10A cost (orthogonal slices). costForecastReason on the
// resulting row defaults to NULL.
export interface CreatePcdIdentitySnapshotWithSyntheticRoutingInput extends CreatePcdIdentitySnapshotWithProvenanceInput {
  imageProvider: "dalle";
  videoProvider: "kling" | "seedance";
  videoProviderChoice: "kling" | "seedance";
  syntheticRouterVersion: string;
  syntheticPairingVersion: string;
  promptHash: string;
  syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReason;
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

  // SP18 — additive persistence path. Writes the SP9 25-field shape PLUS the
  // 7 SP18 synthetic-routing fields (6 flat + 1 Json). Legacy create(),
  // createForShotWithProvenance(), and createForShotWithCostForecast() are
  // preserved unchanged. costForecastReason is NOT included in this method's
  // input — SP18 path does not bundle SP10A cost. Prisma writes the column
  // as NULL via its nullable default.
  //
  // MERGE-BACK: net-new SP18 store method.
  async createForShotWithSyntheticRouting(
    input: CreatePcdIdentitySnapshotWithSyntheticRoutingInput,
  ): Promise<PcdIdentitySnapshot> {
    const {
      routingDecisionReason,
      lineageDecisionReason,
      syntheticRoutingDecisionReason,
      ...rest
    } = input;
    return this.prisma.pcdIdentitySnapshot.create({
      data: {
        ...rest,
        routingDecisionReason: routingDecisionReason
          ? (routingDecisionReason as object)
          : Prisma.JsonNull,
        lineageDecisionReason: lineageDecisionReason as unknown as object,
        syntheticRoutingDecisionReason: syntheticRoutingDecisionReason as unknown as object,
        // costForecastReason intentionally not set — SP18 path does not bundle
        // SP10A cost. Prisma writes the column as NULL via its nullable default.
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

// SP18 adapter — bridges the SP18 orchestrator's PcdSp18IdentitySnapshotStore
// contract (defined in @creativeagent/creative-pipeline) to the Prisma
// createForShotWithSyntheticRouting() method. The adapter type is declared
// LOCALLY here — the db layer cannot import from creative-pipeline (CLAUDE.md
// layer rule: db → schemas only). The local type is structurally equivalent
// to the creative-pipeline contract; production wiring at merge-back consumes
// this adapter from the apps/api layer.
export type PcdSp18IdentitySnapshotStoreAdapter = {
  createForShotWithSyntheticRouting(
    input: CreatePcdIdentitySnapshotWithSyntheticRoutingInput,
  ): Promise<PcdIdentitySnapshot>;
};

export function adaptPcdSp18IdentitySnapshotStore(
  store: PrismaPcdIdentitySnapshotStore,
): PcdSp18IdentitySnapshotStoreAdapter {
  return {
    createForShotWithSyntheticRouting: (input) => store.createForShotWithSyntheticRouting(input),
  };
}
