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
      revoked: false,
      revokedAt: null,
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

describe("composeGenerationRouting — synthetic-route seedance happy path (Case C)", () => {
  it("routes via SP16 and writes via writePcdIdentitySnapshotWithSyntheticRouting with selectedProvider='dalle+seedance'", async () => {
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
      revoked: false,
      revokedAt: null,
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "product_demo" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({
            seedanceDirection: {
              setting: "outdoor-park",
              motion: "static",
              energy: "calm",
              lighting: "natural",
              avoid: ["fast-cuts"],
            },
          }),
          videoProviderChoice: "seedance" as const,
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
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);

    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).toBe("dalle+seedance");
    expect(writerPayload.videoProvider).toBe("seedance");
    expect(writerPayload.videoProviderChoice).toBe("seedance");
  });
});

describe("composeGenerationRouting — Tier-3 synthetic invariant interaction (§11.3)", () => {
  it("tier 3 + talking_head + final_export + synthetic kling: tier3RulesApplied=[first_last_frame_anchor, performance_transfer]", async () => {
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
      revoked: false,
      revokedAt: null,
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "talking_head" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;

    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    const tier3Applied = reason.tier3RulesApplied as ReadonlyArray<string>;
    // For tier 3 + talking_head + final_export: requiresFirstLastFrameAnchor (publishable video)
    // AND requiresPerformanceTransfer (talking_head specifically). Both required.
    expect(new Set(tier3Applied)).toEqual(
      new Set(["first_last_frame_anchor", "performance_transfer"]),
    );

    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
  });

  it("tier 3 + product_demo + final_export + campaign + approved-take=true + synthetic seedance: tier3RulesApplied includes edit_over_regenerate", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockResolvedValue(
      buildSnapshotReturn(),
    );
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockResolvedValue(true);
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
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "product_demo" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({
            seedanceDirection: {
              setting: "studio-dark",
              motion: "subtle-dolly",
              energy: "calm",
              lighting: "moody",
              avoid: ["fast-cuts"],
            },
          }),
          videoProviderChoice: "seedance" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    const result = await composeGenerationRouting(input, stores);

    expect(result.outcome).toBe("routed_and_written");
    if (result.outcome !== "routed_and_written") return;

    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).toHaveBeenCalledTimes(1);
    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mock.calls[0]![0]).toEqual({
      organizationId: "org_1",
      campaignId: "camp_1",
    });

    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).toHaveBeenCalledTimes(1);
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    const tier3Applied = reason.tier3RulesApplied as ReadonlyArray<string>;
    // product_demo is NOT talking_head so performance_transfer is NOT required.
    // first_last_frame_anchor (publishable video) + edit_over_regenerate (approved take).
    expect(new Set(tier3Applied)).toEqual(
      new Set(["first_last_frame_anchor", "edit_over_regenerate"]),
    );
  });

  it("tier ≤ 2 synthetic skips Step 5a recompute (campaignTakeStore not called, tier3RulesApplied=[])", async () => {
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
      revoked: false,
      revokedAt: null,
    });

    const input = {
      routing: {
        resolvedContext: buildResolvedContext(), // tier 2
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

    await composeGenerationRouting(input, stores);

    expect(stores.campaignTakeStore.hasApprovedTier3TakeForCampaign).not.toHaveBeenCalled();
    const writerPayload = stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mock.calls[0]![0] as Record<string, unknown>;
    const reason = writerPayload.routingDecisionReason as Record<string, unknown>;
    expect(reason.tier3RulesApplied).toEqual([]);
  });

  it("campaignTakeStore throws on tier 3 + campaign synthetic → composer rethrows, writer not called", async () => {
    const stores = buildStores();
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockRejectedValue(
      new Error("db unavailable"),
    );

    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "talking_head" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };

    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("db unavailable");
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});

describe("composeGenerationRouting — denial branches return decision verbatim, no write", () => {
  it("SP4 ACCESS_POLICY denial (tier policy reject combo)", async () => {
    // avatarTier=1 + productTier=3 + simple_ugc + final_export:
    // outputIntent=final_export bumps requiredAvatarTier to 2; a=1 < 2 →
    // upgrade_avatar_identity + use_lower_output_intent → denied.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    // SP4 decision has no `kind` discriminator.
    expect("kind" in result.decision).toBe(false);
    expect(result.decision.allowed).toBe(false);
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("SP16 ACCESS_POLICY denial (synthetic + tier policy reject)", async () => {
    // simple_ugc is IN the synthetic pairing matrix → SP16 runs its own tier
    // policy gate (Step 3). avatarTier=1 + productTier=3 + final_export →
    // denied before any writer call.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    // SP16 synthetic decision has a `kind` discriminator.
    expect("kind" in result.decision).toBe(true);
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("SP16 NO_DIRECTION_AUTHORED denial (seedance choice with seedanceDirection=null)", async () => {
    // simple_ugc is IN the pairing matrix for seedance. buildSyntheticIdentity
    // default has seedanceDirection=null → Step 4 of routeSyntheticPcdShot
    // returns NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext(),
        shotType: "simple_ugc" as const,
        outputIntent: "draft" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity({ seedanceDirection: null }),
          videoProviderChoice: "seedance" as const,
        },
      },
      snapshotPersistence: buildSnapshotPersistence(),
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("Delegation envelope wrapping a denied sp4Decision (script_only + tier policy reject)", async () => {
    // script_only is OUT of the synthetic pairing matrix → SP16 delegates to
    // SP4. SP4: avatarTier=1 + productTier=3 + script_only + final_export →
    // final_export bumps requiredAvatarTier to 2; a=1 < 2 → denied. The
    // delegation envelope wraps the denied sp4Decision.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "script_only" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    // Delegation envelope has `kind` discriminator.
    expect("kind" in result.decision).toBe(true);
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });

  it("Delegation envelope wrapping a denied sp4Decision (storyboard + draft → tier 1 + final_export denial)", async () => {
    // storyboard is OUT of the synthetic pairing matrix → SP16 delegates to SP4.
    // SP4: avatarTier=1 + productTier=3 + storyboard + final_export →
    // final_export bumps requiredAvatarTier to 2; a=1 < 2 → denied.
    // Distinct from the script_only case: exercises the second delegation-path
    // denial (storyboard instead of script_only), confirming the denial
    // pass-through is shot-type-agnostic.
    const stores = buildStores();
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 1,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "storyboard" as const,
        outputIntent: "final_export" as const,
        approvedCampaignContext: { kind: "none" as const },
        syntheticSelection: {
          creatorIdentityId: "creator_resolved_1",
          syntheticIdentity: buildSyntheticIdentity(),
          videoProviderChoice: "kling" as const,
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    const result = await composeGenerationRouting(input, stores);
    expect(result.outcome).toBe("denied");
    if (result.outcome !== "denied") return;
    expect("kind" in result.decision).toBe(true);
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});

describe("composeGenerationRouting — synthetic delegation Case B (the SP10A-not-SP18 invariant)", () => {
  it("SP16 delegated_to_generic_router with allowed sp4Decision: writePcdIdentitySnapshotWithCostForecast called, SP18 writer NOT called", async () => {
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
        // script_only is OUT of the synthetic-pairing matrix → SP16 delegates to SP4.
        shotType: "script_only" as const,
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
    expect(result.writerKind).toBe("writePcdIdentitySnapshotWithCostForecast");

    // KEY INVARIANT: SP18 writer NOT called on delegation.
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
    // SP10A writer called.
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(1);

    // Confirm the writer was given the sp4Decision's selectedProvider (NOT a composite "dalle+kling").
    const writerPayload = stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mock.calls[0]![0] as Record<string, unknown>;
    expect(writerPayload.selectedProvider).not.toContain("+");
  });
});

describe("composeGenerationRouting — cost-forecast input plumbing post-routing", () => {
  it("generic path: cost-forecast input mirrors provider, model, shotType, outputIntent, costHints", async () => {
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
        outputIntent: "preview" as const,
        approvedCampaignContext: { kind: "none" as const },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        providerModelSnapshot: "specific-model-1.2.3",
      },
      provenance: buildProvenance(),
      costHints: { durationSec: 12, tokenCount: 8000 },
      now: FIXED_NOW,
    };
    await composeGenerationRouting(input, stores);

    expect(stores.costEstimator.estimate).toHaveBeenCalledTimes(1);
    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    expect(estimateInput.model).toBe("specific-model-1.2.3");
    expect(estimateInput.shotType).toBe("simple_ugc");
    expect(estimateInput.outputIntent).toBe("preview");
    expect(estimateInput.durationSec).toBe(12);
    expect(estimateInput.tokenCount).toBe(8000);
    expect(estimateInput.provider).toEqual(expect.any(String));
  });

  it("delegation path: cost-forecast uses sp4Decision.selectedProvider (NOT the synthetic composite)", async () => {
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
        shotType: "script_only" as const,
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
    await composeGenerationRouting(input, stores);

    const estimateInput = stores.costEstimator.estimate.mock.calls[0]![0] as Record<string, unknown>;
    // Must NOT contain a '+' — that would indicate a synthetic composite leaked
    // into the cost forecast.
    expect(estimateInput.provider).not.toContain("+");
  });
});

describe("composeGenerationRouting — error propagation", () => {
  it("writePcdIdentitySnapshotWithCostForecast throws → composer rethrows", async () => {
    const stores = buildStores();
    stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast.mockRejectedValue(
      new Error("snapshot store failure"),
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
      now: FIXED_NOW,
    };
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("snapshot store failure");
  });

  it("writePcdIdentitySnapshotWithSyntheticRouting throws → composer rethrows", async () => {
    const stores = buildStores();
    stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting.mockRejectedValue(
      new Error("sp18 store failure"),
    );
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
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("sp18 store failure");
  });

  it("router throws (campaignTakeStore failure on generic tier-3 + campaign path) → composer rethrows, no writer called", async () => {
    // SP4 router Step 3 calls requiresEditOverRegenerate(...) which queries
    // campaignTakeStore for tier 3 + campaign context. A throwing store
    // surfaces as router throw → composer rethrow.
    const stores = buildStores();
    stores.campaignTakeStore.hasApprovedTier3TakeForCampaign.mockRejectedValue(
      new Error("campaign-take db failure"),
    );
    const input = {
      routing: {
        resolvedContext: buildResolvedContext({
          creatorTierAtResolution: 3,
          productTierAtResolution: 3,
          effectiveTier: 3,
        }),
        shotType: "simple_ugc" as const,
        outputIntent: "preview" as const,
        approvedCampaignContext: {
          kind: "campaign" as const,
          organizationId: "org_1",
          campaignId: "camp_1",
        },
      },
      snapshotPersistence: {
        ...buildSnapshotPersistence(),
        productTierAtGeneration: 3 as const,
        avatarTierAtGeneration: 3 as const,
      },
      provenance: buildProvenance(),
      now: FIXED_NOW,
    };
    await expect(composeGenerationRouting(input, stores)).rejects.toThrow("campaign-take db failure");
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).not.toHaveBeenCalled();
    expect(stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting).not.toHaveBeenCalled();
  });
});
