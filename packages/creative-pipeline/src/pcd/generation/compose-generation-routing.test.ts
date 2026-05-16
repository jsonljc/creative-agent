import { describe, expect, it, vi } from "vitest";
import type {
  CreatorIdentitySyntheticPayload,
  PcdIdentitySnapshot,
  PcdPreproductionChainResult,
} from "@creativeagent/schemas";
import type { CostEstimatorOutput } from "../cost/cost-estimator.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { composeGenerationRouting } from "./compose-generation-routing.js";
import type { ComposeGenerationRoutingInput } from "./compose-generation-routing.js";

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
    vibe: "omg_look",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
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

function buildSnapshotPersistence(): ComposeGenerationRoutingInput["snapshotPersistence"] {
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
    consentRecordReader: { findById: vi.fn() },
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

function buildSnapshotReturn(): PcdIdentitySnapshot {
  return { id: "snap_returned_1" } as unknown as PcdIdentitySnapshot;
}

function buildCostEstimateReturn(): CostEstimatorOutput {
  return {
    estimatedUsd: 0.42,
    currency: "USD",
    lineItems: [{ label: "model", estimatedUsd: 0.42 }],
    estimatorVersion: "stub-cost-estimator@1.0.0",
  };
}

describe("composeGenerationRouting — generic-route happy path (Case A)", () => {
  it("routes via SP4 and writes via writePcdIdentitySnapshotWithCostForecast with reconstructed args", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.costEstimator.estimate.mockResolvedValue(buildCostEstimateReturn());
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findById.mockResolvedValue({
      id: "consent_1",
      revoked: false,
      revokedAt: null,
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      costHints: { durationSec: 8 },
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithCostForecast");
    expect(result.snapshot).toEqual(buildSnapshotReturn());

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();

    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(1);
    const writerCall = stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mock.calls[0]!;
    const writerPayload = writerCall[0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toBe("runway");
    expect(writerPayload.assetRecordId).toBe("asset_1");
    expect(writerPayload.shotSpecVersion).toBe("shot-spec@1.0.0");

    expect(stores.costEstimator.estimate).toHaveBeenCalledTimes(1);
    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(estimateInput.provider).toBe("runway");
    expect(estimateInput.model).toBe("model-1.0");
    expect(estimateInput.shotType).toBe("simple_ugc");
    expect(estimateInput.outputIntent).toBe("draft");
    expect(estimateInput.durationSec).toBe(8);
  });
});

describe("composeGenerationRouting — synthetic-route kling happy path (Case C)", () => {
  it("routes via SP16 and writes via writePcdIdentitySnapshotWithSyntheticRouting with selectedProvider='dalle+kling'", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.creatorIdentityReader.findById.mockResolvedValue({
      id: "creator_resolved_1",
      consentRecordId: "consent_1",
    });
    stores.consentRecordReader.findById.mockResolvedValue({
      id: "consent_1",
      creatorIdentityId: "creator_resolved_1",
      status: "active",
    });

    const input = {
      routing: {
        // tier 2 — Tier 3 invariant short-circuits.
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithSyntheticRouting");

    // Generic writer not called.
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.costEstimator.estimate).not.toHaveBeenCalled();

    // SP18 writer called exactly once with selectedProvider = "dalle+kling".
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerCall = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]!;
    const writerPayload = writerCall[0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toBe("dalle+kling");
    expect(writerPayload.imageProvider).toBe("dalle");
    expect(writerPayload.videoProvider).toBe("kling");
    expect(writerPayload.videoProviderChoice).toBe("kling");
  });
});
