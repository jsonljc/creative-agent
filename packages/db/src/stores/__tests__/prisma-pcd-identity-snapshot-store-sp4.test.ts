import { describe, expect, it } from "vitest";
import type { CreatePcdIdentitySnapshotInput } from "../prisma-pcd-identity-snapshot-store.js";
import type { PcdRoutingDecisionReason } from "@creativeagent/schemas";

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
