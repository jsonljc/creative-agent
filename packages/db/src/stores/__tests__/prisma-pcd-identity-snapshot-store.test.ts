import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  PrismaPcdIdentitySnapshotStore,
  adaptPcdSp9IdentitySnapshotStore,
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
