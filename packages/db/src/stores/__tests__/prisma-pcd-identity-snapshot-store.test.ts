import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  PrismaPcdIdentitySnapshotStore,
  adaptPcdSp9IdentitySnapshotStore,
  adaptPcdSp10IdentitySnapshotStore,
  adaptPcdSp18IdentitySnapshotStore,
} from "../prisma-pcd-identity-snapshot-store.js";

function createMockPrisma() {
  return {
    pcdIdentitySnapshot: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  };
}

describe("PrismaPcdIdentitySnapshotStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaPcdIdentitySnapshotStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaPcdIdentitySnapshotStore(prisma as never);
  });

  it("create() writes the full snapshot input to prisma.pcdIdentitySnapshot.create", async () => {
    const mockSnapshot = {
      id: "snap_1",
      assetRecordId: "asset_1",
      productIdentityId: "prod_id_1",
      productTierAtGeneration: 2 as const,
      productImageAssetIds: ["image_1", "image_2"],
      productCanonicalTextHash: "hash_abc123",
      productLogoAssetId: "logo_1",
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 1 as const,
      avatarReferenceAssetIds: ["avatar_ref_1"],
      voiceAssetId: "voice_1",
      consentRecordId: "consent_1",
      policyVersion: "1.0",
      providerCapabilityVersion: "2.1",
      selectedProvider: "openai",
      providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      seedOrNoSeed: "seed",
      rewrittenPromptText: "rewritten prompt",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.pcdIdentitySnapshot.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSnapshot);

    const result = await store.create({
      assetRecordId: "asset_1",
      productIdentityId: "prod_id_1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["image_1", "image_2"],
      productCanonicalTextHash: "hash_abc123",
      productLogoAssetId: "logo_1",
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 1,
      avatarReferenceAssetIds: ["avatar_ref_1"],
      voiceAssetId: "voice_1",
      consentRecordId: "consent_1",
      policyVersion: "1.0",
      providerCapabilityVersion: "2.1",
      selectedProvider: "openai",
      providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      seedOrNoSeed: "seed",
      rewrittenPromptText: "rewritten prompt",
    });

    expect(result).toEqual(mockSnapshot);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetRecordId: "asset_1",
        productIdentityId: "prod_id_1",
        productTierAtGeneration: 2,
        avatarTierAtGeneration: 1,
        selectedProvider: "openai",
        providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      }),
    });
  });

  it("getByAssetRecordId() calls findUnique with where: { assetRecordId } and returns the result", async () => {
    const mockSnapshot = {
      id: "snap_2",
      assetRecordId: "asset_2",
      productIdentityId: "prod_id_2",
      productTierAtGeneration: 3 as const,
      productImageAssetIds: ["image_3"],
      productCanonicalTextHash: "hash_def456",
      productLogoAssetId: null,
      creatorIdentityId: "creator_2",
      avatarTierAtGeneration: 2 as const,
      avatarReferenceAssetIds: ["avatar_ref_2", "avatar_ref_3"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "2.0",
      providerCapabilityVersion: "3.0",
      selectedProvider: "anthropic",
      providerModelSnapshot: '{"model":"claude-3","temp":0.5}',
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.pcdIdentitySnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockSnapshot,
    );

    const result = await store.getByAssetRecordId("asset_2");

    expect(result).toEqual(mockSnapshot);
    expect(prisma.pcdIdentitySnapshot.findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "asset_2" },
    });
  });

  it("getByAssetRecordId() returns null when nothing is found", async () => {
    (prisma.pcdIdentitySnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await store.getByAssetRecordId("nonexistent_asset");

    expect(result).toBeNull();
    expect(prisma.pcdIdentitySnapshot.findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "nonexistent_asset" },
    });
  });
});

describe("PrismaPcdIdentitySnapshotStore.createForShotWithProvenance (SP9)", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaPcdIdentitySnapshotStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaPcdIdentitySnapshotStore(prisma as never);
  });

  it("persists the merged 25-field row including five lineage ids and the lineage decision reason", async () => {
    const mockSnapshot = {
      id: "snap_1",
      assetRecordId: "asset_1",
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    };
    (prisma.pcdIdentitySnapshot.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSnapshot);

    const result = await store.createForShotWithProvenance({
      // SP4 19-field shape
      assetRecordId: "asset_1",
      productIdentityId: "prod_id_1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["image_1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: "logo_1",
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 1,
      avatarReferenceAssetIds: ["avatar_1"],
      voiceAssetId: "voice_1",
      consentRecordId: "consent_1",
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "openai",
      providerModelSnapshot: "gpt-x@v1",
      seedOrNoSeed: "seed",
      rewrittenPromptText: "rewritten",
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      // SP9 lineage
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    });

    expect(result).toEqual(mockSnapshot);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        briefId: "brf_1",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
        scriptId: "scr_1",
        lineageDecisionReason: expect.objectContaining({ fanoutDecisionId: "fdec_1" }),
      }),
    });
  });

  it("uses Prisma.JsonNull when routingDecisionReason is null on the SP9 path", async () => {
    (prisma.pcdIdentitySnapshot.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "snap_2",
    });

    await store.createForShotWithProvenance({
      assetRecordId: "asset_2",
      productIdentityId: "prod_id_2",
      productTierAtGeneration: 1,
      productImageAssetIds: [],
      productCanonicalTextHash: "h",
      productLogoAssetId: null,
      creatorIdentityId: "creator_2",
      avatarTierAtGeneration: 1,
      avatarReferenceAssetIds: [],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "openai_text",
      providerModelSnapshot: "gpt@v1",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      briefId: "brf_2",
      trendId: "trd_2",
      motivatorId: "mot_2",
      hookId: "hk_2",
      scriptId: "scr_2",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_2",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    });

    const callArg = (prisma.pcdIdentitySnapshot.create as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(callArg.data.routingDecisionReason).toBe(Prisma.JsonNull);
  });
});

describe("adaptPcdSp9IdentitySnapshotStore", () => {
  it("returns a store conforming to the SP9 contract (createForShotWithProvenance method)", () => {
    const prisma = createMockPrisma();
    const prismaStore = new PrismaPcdIdentitySnapshotStore(prisma as never);
    const adapted = adaptPcdSp9IdentitySnapshotStore(prismaStore);
    expect(typeof adapted.createForShotWithProvenance).toBe("function");
  });

  it("delegates createForShotWithProvenance to the underlying Prisma store", async () => {
    const prisma = createMockPrisma();
    const prismaStore = new PrismaPcdIdentitySnapshotStore(prisma as never);
    const spy = vi
      .spyOn(prismaStore, "createForShotWithProvenance")
      .mockResolvedValue({ id: "snap_3" } as never);
    const adapted = adaptPcdSp9IdentitySnapshotStore(prismaStore);

    const input = {
      assetRecordId: "a3",
      productIdentityId: "p3",
      productTierAtGeneration: 1 as const,
      productImageAssetIds: [],
      productCanonicalTextHash: "h",
      productLogoAssetId: null,
      creatorIdentityId: "c3",
      avatarTierAtGeneration: 1 as const,
      avatarReferenceAssetIds: [],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "openai_text",
      providerModelSnapshot: "gpt@v1",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      briefId: "brf_3",
      trendId: "trd_3",
      motivatorId: "mot_3",
      hookId: "hk_3",
      scriptId: "scr_3",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_3",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    };
    await adapted.createForShotWithProvenance(input);
    expect(spy).toHaveBeenCalledWith(input);
  });
});

describe("PrismaPcdIdentitySnapshotStore.createForShotWithCostForecast (SP10A)", () => {
  function makeMockPrisma() {
    return {
      pcdIdentitySnapshot: {
        create: vi.fn(async (args: unknown) => ({
          id: "snap_1",
          ...(args as { data: object }).data,
        })),
      },
    };
  }

  const baseInput = {
    assetRecordId: "asset_1",
    productIdentityId: "prod_1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: [] as string[],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "creator_1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: [] as string[],
    voiceAssetId: null,
    consentRecordId: "consent_1",
    policyVersion: "tier-policy@1.0.0",
    providerCapabilityVersion: "provider-capability@1.0.0",
    selectedProvider: "sora",
    providerModelSnapshot: "sora-1.0",
    seedOrNoSeed: "seed:42",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
    routerVersion: "provider-router@1.0.0",
    routingDecisionReason: null,
    briefId: "brief_1",
    trendId: "trend_1",
    motivatorId: "motivator_1",
    hookId: "hook_1",
    scriptId: "script_1",
    lineageDecisionReason: {
      decidedAt: "2026-04-30T12:00:00.000Z",
      fanoutDecisionId: "fanout_1",
      chainVersion: "preproduction-chain@1.0.0",
      provenanceVersion: "pcd-provenance@1.0.0",
    },
    costForecastReason: {
      estimatedUsd: 1.23,
      currency: "USD" as const,
      lineItems: [{ label: "x", estimatedUsd: 1.23 }],
      costForecastVersion: "pcd-cost-forecast@1.0.0",
      estimatorVersion: "stub-cost-estimator@1.0.0",
      estimatedAt: "2026-04-30T12:00:00.000Z",
    },
  };

  it("persists costForecastReason as the assembled JSON object", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.costForecastReason).toEqual(baseInput.costForecastReason);
  });

  it("persists lineage fields alongside the cost forecast (SP9 + SP10A composed)", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.briefId).toBe("brief_1");
    expect(dataArg.scriptId).toBe("script_1");
    expect(dataArg.lineageDecisionReason).toEqual(baseInput.lineageDecisionReason);
  });

  it("persists null routingDecisionReason as Prisma.JsonNull", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    await store.createForShotWithCostForecast(baseInput);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.routingDecisionReason).toBe(Prisma.JsonNull);
  });

  it("preserves legacy create() behavior unchanged (SP4 path)", async () => {
    const prisma = makeMockPrisma();
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    const legacyInput = { ...baseInput };
    // Strip SP9 + SP10A fields to make a SP4-shaped input
    delete (legacyInput as Record<string, unknown>).briefId;
    delete (legacyInput as Record<string, unknown>).trendId;
    delete (legacyInput as Record<string, unknown>).motivatorId;
    delete (legacyInput as Record<string, unknown>).hookId;
    delete (legacyInput as Record<string, unknown>).scriptId;
    delete (legacyInput as Record<string, unknown>).lineageDecisionReason;
    delete (legacyInput as Record<string, unknown>).costForecastReason;
    await store.create(legacyInput as never);
    const dataArg = prisma.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(dataArg.costForecastReason).toBeUndefined();
    expect(dataArg.lineageDecisionReason).toBeUndefined();
  });
});

describe("adaptPcdSp10IdentitySnapshotStore", () => {
  it("forwards createForShotWithCostForecast to the Prisma store", async () => {
    const prisma = {
      pcdIdentitySnapshot: {
        create: vi.fn(async () => ({ id: "snap_1" })),
      },
    };
    const store = new PrismaPcdIdentitySnapshotStore(prisma as unknown as never);
    const adapter = adaptPcdSp10IdentitySnapshotStore(store);
    expect(typeof adapter.createForShotWithCostForecast).toBe("function");
    const baseInput = {
      assetRecordId: "asset_1",
      productIdentityId: "prod_1",
      productTierAtGeneration: 2 as const,
      productImageAssetIds: [] as string[],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 2 as const,
      avatarReferenceAssetIds: [] as string[],
      voiceAssetId: null,
      consentRecordId: "consent_1",
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "sora",
      providerModelSnapshot: "sora-1.0",
      seedOrNoSeed: "seed:42",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      briefId: "brief_1",
      trendId: "trend_1",
      motivatorId: "motivator_1",
      hookId: "hook_1",
      scriptId: "script_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fanout_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
      costForecastReason: {
        estimatedUsd: 1.23,
        currency: "USD" as const,
        lineItems: [{ label: "x", estimatedUsd: 1.23 }],
        costForecastVersion: "pcd-cost-forecast@1.0.0",
        estimatorVersion: "stub-cost-estimator@1.0.0",
        estimatedAt: "2026-04-30T12:00:00.000Z",
      },
    };
    await adapter.createForShotWithCostForecast(baseInput);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
  });
});

describe("createForShotWithSyntheticRouting (SP18)", () => {
  it("writes a row populated with the 7 SP18 columns", async () => {
    const prismaMock = {
      pcdIdentitySnapshot: {
        create: vi.fn().mockResolvedValue({
          id: "snap-1",
          assetRecordId: "asset-1",
          briefId: "brief-1",
          imageProvider: "dalle",
          videoProvider: "kling",
          videoProviderChoice: "kling",
          syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
          syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
          promptHash: "a".repeat(64),
          syntheticRoutingDecisionReason: { videoProvider: "kling" },
          createdAt: new Date(),
        }),
      },
    };
    const store = new PrismaPcdIdentitySnapshotStore(prismaMock as unknown as never);

    const result = await store.createForShotWithSyntheticRouting({
      assetRecordId: "asset-1",
      productIdentityId: "prod-1",
      productTierAtGeneration: 3,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash-x",
      productLogoAssetId: null,
      creatorIdentityId: "creator-1",
      avatarTierAtGeneration: 3,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "pcd-tier-policy@1.0.0",
      providerCapabilityVersion: "pcd-provider-capability@1.0.0",
      selectedProvider: "dalle",
      providerModelSnapshot: "dalle-3",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "pcd-shot-spec@1.0.0",
      routerVersion: "pcd-provider-router@1.0.0",
      routingDecisionReason: {
        capabilityRefIndex: 0,
        matchedShotType: "simple_ugc",
        matchedEffectiveTier: 3,
        matchedOutputIntent: "draft",
        tier3RulesApplied: [],
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
        selectionRationale: "test",
      },
      briefId: "brief-1",
      trendId: "trend-1",
      motivatorId: "mot-1",
      hookId: "hook-1",
      scriptId: "script-1",
      lineageDecisionReason: {
        decidedAt: "2026-05-16T08:00:00.000Z",
        fanoutDecisionId: "fanout-1",
        chainVersion: "pcd-preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
      imageProvider: "dalle",
      videoProvider: "kling",
      videoProviderChoice: "kling",
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
      syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
      promptHash: "a".repeat(64),
      syntheticRoutingDecisionReason: {
        videoProvider: "kling",
        klingDirection: {
          setting: "x",
          motion: "y",
          energy: "z",
          lighting: "w",
          avoid: [],
        },
        pairingRefIndex: 0,
        decisionReason: {
          matchedShotType: "simple_ugc",
          matchedOutputIntent: "draft",
          selectionRationale: "test",
        },
        decidedAt: "2026-05-16T08:00:00.000Z",
        syntheticRoutingProvenanceVersion: "pcd-synthetic-routing-provenance@1.0.0",
      },
    });

    expect(prismaMock.pcdIdentitySnapshot.create).toHaveBeenCalledTimes(1);
    const callArg = prismaMock.pcdIdentitySnapshot.create.mock.calls[0][0].data;
    expect(callArg.imageProvider).toBe("dalle");
    expect(callArg.videoProvider).toBe("kling");
    expect(callArg.videoProviderChoice).toBe("kling");
    expect(callArg.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(callArg.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
    expect(callArg.promptHash).toBe("a".repeat(64));
    expect(callArg.syntheticRoutingDecisionReason).toMatchObject({ videoProvider: "kling" });
    expect(callArg.costForecastReason).toBeUndefined();
    expect(result.imageProvider).toBe("dalle");
  });
});

describe("adaptPcdSp18IdentitySnapshotStore (SP18)", () => {
  it("returns an adapter object delegating to createForShotWithSyntheticRouting", () => {
    const prismaStore = {
      createForShotWithSyntheticRouting: vi.fn(),
    } as unknown as PrismaPcdIdentitySnapshotStore;
    const adapted = adaptPcdSp18IdentitySnapshotStore(prismaStore);
    expect(typeof adapted.createForShotWithSyntheticRouting).toBe("function");
  });
});
