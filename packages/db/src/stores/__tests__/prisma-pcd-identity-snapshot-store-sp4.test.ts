import { describe, expect, it, vi } from "vitest";
import {
  adaptPcdIdentitySnapshotStore,
  type CreatePcdIdentitySnapshotInput,
  type PcdIdentitySnapshotStoreAdapter,
  type PrismaPcdIdentitySnapshotStore,
} from "../prisma-pcd-identity-snapshot-store.js";
import type { PcdIdentitySnapshot, PcdRoutingDecisionReason } from "@creativeagent/schemas";

describe("CreatePcdIdentitySnapshotInput (SP4 widening)", () => {
  it("accepts the three new nullable SP4 fields", () => {
    const reason: PcdRoutingDecisionReason = {
      capabilityRefIndex: 0,
      matchedShotType: "simple_ugc",
      matchedEffectiveTier: 2,
      matchedOutputIntent: "final_export",
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "test",
    };

    // Type-only assertion: this object must be assignable to the input type.
    const input: CreatePcdIdentitySnapshotInput = {
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: reason,
    };

    expect(input.shotSpecVersion).toBe("shot-spec@1.0.0");
    expect(input.routerVersion).toBe("provider-router@1.0.0");
    expect(input.routingDecisionReason).toEqual(reason);
  });

  it("adaptPcdIdentitySnapshotStore exposes createForShot delegating to create", async () => {
    const created: PcdIdentitySnapshot = {
      id: "snap-1",
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
      createdAt: new Date("2026-04-28T00:00:00Z"),
    };
    const fakeStore = {
      create: vi.fn(async (_input: CreatePcdIdentitySnapshotInput) => created),
    } as unknown as PrismaPcdIdentitySnapshotStore;

    const adapter: PcdIdentitySnapshotStoreAdapter = adaptPcdIdentitySnapshotStore(fakeStore);

    const input: CreatePcdIdentitySnapshotInput = {
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      routingDecisionReason: null,
    };

    const result = await adapter.createForShot(input);
    expect(result).toBe(created);
    expect(fakeStore.create).toHaveBeenCalledTimes(1);
    expect(fakeStore.create).toHaveBeenCalledWith(input);
  });

  it("adapter return shape structurally matches the writer's PcdIdentitySnapshotStore contract", () => {
    // Type-only assertion: PcdIdentitySnapshotStoreAdapter must have exactly
    // the shape `creative-pipeline`'s PcdIdentitySnapshotStore expects. If a
    // future change to either side drifts, this assignment fails to compile.
    type WriterContract = {
      createForShot(input: CreatePcdIdentitySnapshotInput): Promise<PcdIdentitySnapshot>;
    };
    const _typeCheck: WriterContract = {} as PcdIdentitySnapshotStoreAdapter;
    void _typeCheck;
    expect(true).toBe(true);
  });

  it("accepts NULL for all three new fields", () => {
    const input: CreatePcdIdentitySnapshotInput = {
      assetRecordId: "asset-1",
      productIdentityId: "p-1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["img-1"],
      productCanonicalTextHash: "hash",
      productLogoAssetId: null,
      creatorIdentityId: "c-1",
      avatarTierAtGeneration: 2,
      avatarReferenceAssetIds: ["ref-1"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "tier-policy@1.0.0",
      providerCapabilityVersion: "provider-capability@1.0.0",
      selectedProvider: "kling",
      providerModelSnapshot: "kling-v2.0",
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      shotSpecVersion: null,
      routerVersion: null,
      routingDecisionReason: null,
    };

    expect(input.shotSpecVersion).toBeNull();
  });
});
