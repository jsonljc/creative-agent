import { describe, expect, it, vi } from "vitest";
import {
  PcdPreproductionChainResultSchema,
  type PcdPreproductionChainResult,
  type PcdIdentitySnapshot,
} from "@creativeagent/schemas";
import { writePcdIdentitySnapshotWithCostForecast } from "./write-pcd-identity-snapshot-with-cost-forecast.js";
import { StubCostEstimator } from "./stub-cost-estimator.js";
import type { PcdSp10IdentitySnapshotStore } from "./pcd-sp10-identity-snapshot-store.js";
import { Tier3RoutingViolationError } from "../tier3-routing-rules.js";

// Build a minimal valid chain result — enough for the lineage walk to succeed.
function makeChainResult(): PcdPreproductionChainResult {
  return {
    decision: {
      briefId: "brief_1",
      creatorIdentityId: "creator_1",
      productIdentityId: "prod_1",
      consentRecordId: "consent_1",
      effectiveTier: 2,
      selectedScriptIds: ["script_1"],
      availableScriptIds: ["script_1"],
      preproductionChainVersion: "preproduction-chain@1.0.0",
      identityContextVersion: "identity-context@1.0.0",
      approvalLifecycleVersion: "pcd-approval-lifecycle@1.0.0",
      preproductionFanoutVersion: "preproduction-fanout@1.0.0",
      decidedAt: "2026-04-30T12:00:00.000Z",
      decidedBy: "operator_1",
      decisionNote: null,
      costForecast: null,
    },
    stageOutputs: {
      trends: { signals: [{ id: "trend_1", summary: "s", audienceFit: "a", evidenceRefs: [] }] },
      motivators: {
        motivators: [
          {
            id: "motivator_1",
            frictionOrDesire: "f",
            audienceSegment: "a",
            evidenceRefs: [],
            parentTrendId: "trend_1",
          },
        ],
      },
      hooks: {
        hooks: [
          {
            id: "hook_1",
            text: "t",
            hookType: "direct_camera",
            parentMotivatorId: "motivator_1",
            parentTrendId: "trend_1",
          },
        ],
      },
      scripts: {
        scripts: [
          {
            id: "script_1",
            scriptStyle: "spoken_lines",
            spokenLines: ["line"],
            hookText: "h",
            creatorAngle: "a",
            visualBeats: [],
            productMoment: "p",
            cta: "c",
            complianceNotes: [],
            identityConstraints: {
              creatorIdentityId: "creator_1",
              productIdentityId: "prod_1",
              voiceId: null,
            },
            parentHookId: "hook_1",
          },
        ],
      },
    },
  };
}

function makeBaseInput() {
  const chainResult = PcdPreproductionChainResultSchema.parse(makeChainResult());
  return {
    snapshot: {
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
      // shotType + outputIntent + effectiveTier chosen so no Tier 3 rule fires
      // (effectiveTier !== 3 short-circuits assertTier3RoutingDecisionCompliant).
      effectiveTier: 2 as const,
      shotType: "script_only" as const,
      outputIntent: "draft" as const,
      selectedProvider: "sora",
      providerModelSnapshot: "sora-1.0",
      seedOrNoSeed: "seed:42",
      rewrittenPromptText: null,
      shotSpecVersion: "shot-spec@1.0.0",
      routerVersion: "provider-router@1.0.0",
      // SP4 Tier 3 invariant inputs — make them pass for tier 2 (no Tier 3 rules apply).
      selectedCapability: {
        provider: "sora",
        tiers: [1 as const, 2 as const],
        shotTypes: ["script_only" as const, "storyboard" as const],
        outputIntents: [
          "draft" as const,
          "preview" as const,
          "final_export" as const,
          "meta_draft" as const,
        ],
        supportsFirstLastFrame: false,
        supportsEditExtend: false,
        supportsPerformanceTransfer: false,
      },
      editOverRegenerateRequired: false,
      routingDecisionReason: {
        capabilityRefIndex: 0,
        matchedShotType: "script_only" as const,
        matchedEffectiveTier: 2 as const,
        matchedOutputIntent: "draft" as const,
        tier3RulesApplied: [] as ReadonlyArray<
          "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate"
        >,
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
        selectionRationale: "first match",
      },
    },
    provenance: {
      briefId: "brief_1",
      creatorIdentityId: "creator_1",
      scriptId: "script_1",
      chainResult,
      fanoutDecisionId: "fanout_1",
    },
    // SP10A cost-forecast input has loose validation (string min(1)) — these
    // values flow only into the StubCostEstimator, not the SP4 schemas.
    costForecast: {
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 15,
    },
  };
}

function makeStores(
  overrides: Partial<{
    store: PcdSp10IdentitySnapshotStore;
    consentRevoked: boolean;
  }> = {},
) {
  const persistedSnapshot: PcdIdentitySnapshot = { id: "snap_1" } as PcdIdentitySnapshot;
  const defaultStore: PcdSp10IdentitySnapshotStore = {
    createForShotWithCostForecast: vi.fn(async () => persistedSnapshot),
  };
  return {
    pcdSp10IdentitySnapshotStore: overrides.store ?? defaultStore,
    creatorIdentityReader: {
      findById: vi.fn(async () => ({
        id: "creator_1",
        consentRecordId: "consent_1",
      })),
    },
    consentRecordReader: {
      findById: vi.fn(async () => ({
        id: "consent_1",
        revoked: overrides.consentRevoked ?? false,
        revocable: true,
        revokedAt: null,
        expiresAt: null,
      })),
    },
    costEstimator: new StubCostEstimator(),
    clock: () => new Date("2026-04-30T12:00:00.000Z"),
  };
}

describe("writePcdIdentitySnapshotWithCostForecast", () => {
  it("persists a snapshot when consent is valid (happy path)", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    const result = await writePcdIdentitySnapshotWithCostForecast(input, stores);
    expect(result).toBeDefined();
    expect(stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast).toHaveBeenCalledTimes(
      1,
    );
  });

  it("calls the SP9 stamper before the cost stamper", async () => {
    const stores = makeStores();
    const calls: string[] = [];
    stores.consentRecordReader.findById = vi.fn(async (id: string) => {
      calls.push(`consent:${id}`);
      return {
        id: "consent_1",
        revoked: false,
        revocable: true,
        revokedAt: null,
        expiresAt: null,
      };
    });
    const baseEstimator = new StubCostEstimator();
    stores.costEstimator = {
      estimate: vi.fn(async (i) => {
        calls.push("estimator");
        return baseEstimator.estimate(i);
      }),
    };
    await writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores);
    // Consent check (inside SP9 stamper) must run before estimator call (SP10A stamper).
    const consentIdx = calls.findIndex((c) => c.startsWith("consent:"));
    const estimatorIdx = calls.indexOf("estimator");
    expect(consentIdx).toBeGreaterThanOrEqual(0);
    expect(estimatorIdx).toBeGreaterThan(consentIdx);
  });

  it("does NOT call the cost estimator when consent is revoked", async () => {
    const stores = makeStores({ consentRevoked: true });
    const baseEstimator = new StubCostEstimator();
    const estimateSpy = vi.fn(async (i) => baseEstimator.estimate(i));
    stores.costEstimator = { estimate: estimateSpy };
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("does NOT call the store when consent is revoked", async () => {
    const stores = makeStores({ consentRevoked: true });
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(
      stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast,
    ).not.toHaveBeenCalled();
  });

  it("persists a 27-field row with both lineage AND cost stamped", async () => {
    const stores = makeStores();
    await writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores);
    const dataArg = (
      stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    // SP4 base
    expect(dataArg.assetRecordId).toBe("asset_1");
    expect(dataArg.policyVersion).toBe("tier-policy@1.0.0");
    // SP9 lineage
    expect(dataArg.briefId).toBe("brief_1");
    expect(dataArg.scriptId).toBe("script_1");
    expect(dataArg.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
    // SP10A cost
    expect(dataArg.costForecastReason.costForecastVersion).toBe("pcd-cost-forecast@1.0.0");
    expect(dataArg.costForecastReason.estimatorVersion).toBe("stub-cost-estimator@1.0.0");
  });

  it("propagates ZodError on bad provenance input", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    (input.provenance as Record<string, unknown>).briefId = ""; // invalid
    await expect(writePcdIdentitySnapshotWithCostForecast(input, stores)).rejects.toThrow();
  });

  it("propagates ZodError on bad cost-forecast input", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    (input.costForecast as Record<string, unknown>).provider = ""; // invalid
    await expect(writePcdIdentitySnapshotWithCostForecast(input, stores)).rejects.toThrow();
  });

  it("propagates estimator errors raw", async () => {
    const stores = makeStores();
    stores.costEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator down");
      }),
    };
    await expect(writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores)).rejects.toThrow(
      "estimator down",
    );
  });

  it("does NOT call the store when estimator throws", async () => {
    const stores = makeStores();
    stores.costEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator down");
      }),
    };
    await expect(
      writePcdIdentitySnapshotWithCostForecast(makeBaseInput(), stores),
    ).rejects.toThrow();
    expect(
      stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast,
    ).not.toHaveBeenCalled();
  });

  it("propagates Tier3RoutingViolationError when invariant fails", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    // Tier 3 talking_head + final_export requires first_last_frame_anchor.
    // Capability without supportsFirstLastFrame trips Tier3RoutingViolationError.
    input.snapshot = {
      ...input.snapshot,
      effectiveTier: 3 as const,
      productTierAtGeneration: 3 as const,
      avatarTierAtGeneration: 3 as const,
      shotType: "talking_head" as const,
      outputIntent: "final_export" as const,
      selectedCapability: {
        provider: "openai_text",
        tiers: [3 as const],
        shotTypes: ["talking_head" as const],
        outputIntents: ["final_export" as const],
        supportsFirstLastFrame: false, // missing — triggers first_last_frame_anchor violation
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
      editOverRegenerateRequired: false,
      routingDecisionReason: {
        capabilityRefIndex: 0,
        matchedShotType: "talking_head" as const,
        matchedEffectiveTier: 3 as const,
        matchedOutputIntent: "final_export" as const,
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"] as ReadonlyArray<
          "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate"
        >,
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
        selectionRationale: "first match",
      },
    };
    await expect(writePcdIdentitySnapshotWithCostForecast(input, stores)).rejects.toBeInstanceOf(
      Tier3RoutingViolationError,
    );
    expect(
      stores.pcdSp10IdentitySnapshotStore.createForShotWithCostForecast,
    ).not.toHaveBeenCalled();
  });
});
