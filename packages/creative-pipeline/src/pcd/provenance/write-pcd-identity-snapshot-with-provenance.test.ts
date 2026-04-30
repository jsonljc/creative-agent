import { describe, expect, it, vi } from "vitest";
import type {
  PcdIdentitySnapshot,
  PcdPreproductionChainResult,
  PcdProductionFanoutDecision,
} from "@creativeagent/schemas";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { Tier3RoutingViolationError } from "../tier3-routing-rules.js";
import { writePcdIdentitySnapshotWithProvenance } from "./write-pcd-identity-snapshot-with-provenance.js";

const decision: PcdProductionFanoutDecision = {
  briefId: "brf_1",
  creatorIdentityId: "cre_1",
  productIdentityId: "prd_1",
  consentRecordId: null,
  effectiveTier: 1,
  selectedScriptIds: ["scr_1"],
  availableScriptIds: ["scr_1"],
  preproductionChainVersion: "preproduction-chain@1.0.0",
  identityContextVersion: "identity-context@1.0.0",
  approvalLifecycleVersion: "approval-lifecycle@1.0.0",
  preproductionFanoutVersion: "preproduction-fanout@1.0.0",
  decidedAt: "2026-04-30T12:00:00.000Z",
  decidedBy: null,
  decisionNote: null,
  costForecast: null,
};

const chainResult: PcdPreproductionChainResult = {
  decision,
  stageOutputs: {
    trends: { signals: [{ id: "trd_1", summary: "s", audienceFit: "a", evidenceRefs: [] }] },
    motivators: {
      motivators: [
        {
          id: "mot_1",
          frictionOrDesire: "f",
          audienceSegment: "as",
          evidenceRefs: [],
          parentTrendId: "trd_1",
        },
      ],
    },
    hooks: {
      hooks: [
        {
          id: "hk_1",
          text: "h",
          hookType: "direct_camera",
          parentMotivatorId: "mot_1",
          parentTrendId: "trd_1",
        },
      ],
    },
    scripts: {
      scripts: [
        {
          id: "scr_1",
          hookText: "h",
          creatorAngle: "a",
          visualBeats: [],
          productMoment: "p",
          cta: "c",
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: "cre_1",
            productIdentityId: "prd_1",
            voiceId: null,
          },
          parentHookId: "hk_1",
          scriptStyle: "spoken_lines",
          spokenLines: ["l"],
        },
      ],
    },
  },
};

// Tier 1 happy-path snapshot input. shotType=script_only / outputIntent=draft means
// no Tier 3 rules fire and the assertTier3RoutingDecisionCompliant short-circuits.
const baseSnapshotInput = {
  assetRecordId: "ast_1",
  productIdentityId: "prd_1",
  productTierAtGeneration: 1 as const,
  productImageAssetIds: [],
  productCanonicalTextHash: "hash",
  productLogoAssetId: null,
  creatorIdentityId: "cre_1",
  avatarTierAtGeneration: 1 as const,
  avatarReferenceAssetIds: [],
  voiceAssetId: null,
  consentRecordId: null,
  selectedProvider: "openai_text",
  providerModelSnapshot: "gpt-x@v1",
  seedOrNoSeed: "no-seed",
  rewrittenPromptText: null,
  shotSpecVersion: "shot-spec@1.0.0",
  routerVersion: "provider-router@1.0.0",
  routingDecisionReason: {
    capabilityRefIndex: 0,
    matchedShotType: "script_only" as const,
    matchedEffectiveTier: 1 as const,
    matchedOutputIntent: "draft" as const,
    tier3RulesApplied: [] as ReadonlyArray<
      "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate"
    >,
    candidatesEvaluated: 1,
    candidatesAfterTier3Filter: 1,
    selectionRationale: "first match",
  },
  effectiveTier: 1 as const,
  shotType: "script_only" as const,
  outputIntent: "draft" as const,
  selectedCapability: {
    provider: "openai_text",
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
};

const happyPathStores = () => ({
  pcdSp9IdentitySnapshotStore: {
    createForShotWithProvenance: vi
      .fn()
      .mockImplementation(async (input) => ({ id: "snap_1", ...input }) as PcdIdentitySnapshot),
  },
  creatorIdentityReader: {
    findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
  },
  consentRecordReader: {
    findById: vi.fn().mockResolvedValue(null),
  },
  clock: () => new Date("2026-04-30T13:00:00.000Z"),
});

describe("writePcdIdentitySnapshotWithProvenance", () => {
  it("happy path — stamps lineage and calls SP9 store with merged 25-field payload", async () => {
    const stores = happyPathStores();
    const out = await writePcdIdentitySnapshotWithProvenance(
      {
        snapshot: baseSnapshotInput,
        provenance: {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
      },
      stores,
    );

    expect(out.id).toBe("snap_1");
    const call = stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance.mock.calls[0]![0];
    expect(call.briefId).toBe("brf_1");
    expect(call.trendId).toBe("trd_1");
    expect(call.motivatorId).toBe("mot_1");
    expect(call.hookId).toBe("hk_1");
    expect(call.scriptId).toBe("scr_1");
    expect(call.lineageDecisionReason.fanoutDecisionId).toBe("fdec_1");
    expect(call.policyVersion).toBe("tier-policy@1.0.0");
    expect(call.providerCapabilityVersion).toBe("provider-capability@1.0.0");
    expect(call.routerVersion).toBe("provider-router@1.0.0");
    expect(call.shotSpecVersion).toBe("shot-spec@1.0.0");
  });

  it("aborts before calling the store when consent revoked at stamp time", async () => {
    const stores = happyPathStores();
    stores.creatorIdentityReader.findById = vi
      .fn()
      .mockResolvedValue({ id: "cre_1", consentRecordId: "cnt_1" });
    stores.consentRecordReader.findById = vi
      .fn()
      .mockResolvedValue({ id: "cnt_1", revoked: true, revokedAt: new Date() });

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: baseSnapshotInput,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(ConsentRevokedRefusalError);

    expect(stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance).not.toHaveBeenCalled();
  });

  it("aborts before calling the store when SP4 Tier 3 invariant fails", async () => {
    const stores = happyPathStores();
    // Tier 3 talking_head + final_export requires both first_last_frame_anchor AND performance_transfer.
    // Capability without supportsFirstLastFrame trips Tier3RoutingViolationError.
    const tier3Input = {
      ...baseSnapshotInput,
      effectiveTier: 3 as const,
      shotType: "talking_head" as const,
      outputIntent: "final_export" as const,
      selectedCapability: {
        provider: "openai_text",
        tiers: [3 as const],
        shotTypes: ["talking_head" as const],
        outputIntents: ["final_export" as const],
        supportsFirstLastFrame: false, // missing — triggers violation
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
        selectionRationale: "tier3 test",
      },
    };

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: tier3Input,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);

    expect(stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance).not.toHaveBeenCalled();
  });

  it("propagates store rejection raw", async () => {
    const stores = happyPathStores();
    const dbErr = new Error("simulated DB failure");
    stores.pcdSp9IdentitySnapshotStore.createForShotWithProvenance = vi
      .fn()
      .mockRejectedValue(dbErr);

    await expect(
      writePcdIdentitySnapshotWithProvenance(
        {
          snapshot: baseSnapshotInput,
          provenance: {
            briefId: "brf_1",
            creatorIdentityId: "cre_1",
            scriptId: "scr_1",
            chainResult,
            fanoutDecisionId: "fdec_1",
          },
        },
        stores,
      ),
    ).rejects.toBe(dbErr);
  });
});
