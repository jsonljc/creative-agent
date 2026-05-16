import { describe, expect, it, vi } from "vitest";
import type {
  CreatorIdentitySyntheticPayload,
  PcdPreproductionChainResult,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { composeGenerationRouting } from "./compose-generation-routing.js";

const FIXED_NOW = new Date("2026-05-16T12:00:00.000Z");

function buildResolvedContext(
  overrides: Partial<ResolvedPcdContext> = {},
): ResolvedPcdContext {
  return {
    creatorIdentityId: "creator_resolved_1",
    productIdentityId: "product_resolved_1",
    creatorTierAtResolution: 2,
    productTierAtResolution: 2,
    effectiveTier: 2,
    allowedOutputTier: 2,
    shotSpecVersion: "shot-spec@1.0.0",
    ...overrides,
  };
}

function buildSyntheticIdentity(
  overrides: Partial<CreatorIdentitySyntheticPayload> = {},
): CreatorIdentitySyntheticPayload {
  return {
    creatorIdentityId: "creator_resolved_1",
    status: "active",
    market: "SG",
    treatmentClass: "med_spa",
    vibe: "warm",
    ethnicityFamily: "east_asian",
    ageBand: "25_34",
    pricePositioning: "mid",
    physicalDescriptors: {
      faceShape: "oval",
      skinTone: "medium",
      eyeShape: "almond",
      hair: "dark-straight",
      ageRead: "25-30",
      buildNote: "slim",
    },
    dallePromptLocked: "studio shot, soft light, neutral background",
    klingDirection: {
      setting: "studio-bright",
      motion: "subtle-dolly",
      energy: "calm",
      lighting: "soft",
      avoid: ["shaky-cam"],
    },
    seedanceDirection: null,
    voiceCaptionStyle: {
      voice: "warm-female",
      captionStyle: "subtitle",
      sampleHook: "Discover your glow",
      sampleCta: "Book now",
    },
    mutuallyExclusiveWithIds: [],
    ...overrides,
  };
}

function buildSnapshotPersistence(): {
  assetRecordId: string;
  productIdentityId: string;
  productTierAtGeneration: 1 | 2 | 3;
  productImageAssetIds: string[];
  productCanonicalTextHash: string;
  productLogoAssetId: string | null;
  creatorIdentityId: string;
  avatarTierAtGeneration: 1 | 2 | 3;
  avatarReferenceAssetIds: string[];
  voiceAssetId: string | null;
  consentRecordId: string | null;
  providerModelSnapshot: string;
  seedOrNoSeed: string;
  rewrittenPromptText: string | null;
  shotSpecVersion: string | null;
} {
  return {
    assetRecordId: "asset_1",
    productIdentityId: "product_resolved_1",
    productTierAtGeneration: 2,
    productImageAssetIds: [],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "creator_resolved_1",
    avatarTierAtGeneration: 2,
    avatarReferenceAssetIds: [],
    voiceAssetId: null,
    consentRecordId: "consent_1",
    providerModelSnapshot: "model-1.0",
    seedOrNoSeed: "seed:42",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
  };
}

function buildProvenance(): {
  briefId: string;
  creatorIdentityId: string;
  scriptId: string;
  chainResult: PcdPreproductionChainResult;
  fanoutDecisionId: string;
} {
  return {
    briefId: "brief_1",
    creatorIdentityId: "creator_resolved_1",
    scriptId: "script_1",
    chainResult: {
      stageOutputs: {
        trends: { signals: [{ id: "trend_1", parentSignalIds: [] }] },
        motivators: { motivators: [{ id: "motivator_1", parentTrendId: "trend_1" }] },
        hooks: { hooks: [{ id: "hook_1", parentMotivatorId: "motivator_1" }] },
        scripts: { scripts: [{ id: "script_1", parentHookId: "hook_1" }] },
      },
    } as unknown as PcdPreproductionChainResult,
    fanoutDecisionId: "fanout_1",
  };
}

function buildStores() {
  return {
    campaignTakeStore: { hasApprovedTier3TakeForCampaign: vi.fn() },
    pcdSp10IdentitySnapshotStore: { createForShotWithCostForecast: vi.fn() },
    pcdSp18IdentitySnapshotStore: { createForShotWithSyntheticRouting: vi.fn() },
    costEstimator: { estimate: vi.fn() },
    creatorIdentityReader: { findById: vi.fn() },
    consentRecordReader: { findActiveByCreator: vi.fn() },
    clock: () => FIXED_NOW,
  };
}

describe("composeGenerationRouting — Step 1 consistency assert", () => {
  it("throws InvariantViolationError when syntheticSelection.creatorIdentityId differs from resolvedContext.creatorIdentityId", async () => {
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({ creatorIdentityId: "creator_A" }),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_B", // mismatch
          syntheticIdentity: buildSyntheticIdentity({ creatorIdentityId: "creator_B" }),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    await expect(composeGenerationRouting(input, stores)).rejects.toThrow(InvariantViolationError);

    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
