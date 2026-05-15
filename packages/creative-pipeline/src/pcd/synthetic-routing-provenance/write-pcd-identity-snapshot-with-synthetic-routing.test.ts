import { describe, expect, it, vi } from "vitest";
import {
  PcdPreproductionChainResultSchema,
  type PcdPreproductionChainResult,
  type PcdIdentitySnapshot,
  type SyntheticPcdRoutingDecision,
} from "@creativeagent/schemas";
import { writePcdIdentitySnapshotWithSyntheticRouting } from "./write-pcd-identity-snapshot-with-synthetic-routing.js";
import type { PcdSp18IdentitySnapshotStore } from "./pcd-sp18-identity-snapshot-store.js";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { Tier3RoutingViolationError } from "../tier3-routing-rules.js";
import { PCD_TIER_POLICY_VERSION } from "../tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "../provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "../provider-router.js";

// --------------------------------------------------------------------------
// Fixtures — copied verbatim from SP10A orchestrator test (makeChainResult /
// makeBaseInput / makeStores shapes), with cost-specific parts replaced by
// SP18 synthetic-routing-specific parts.
// --------------------------------------------------------------------------

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

const klingSuccessDecision: SyntheticPcdRoutingDecision = {
  allowed: true,
  kind: "synthetic_pairing",
  accessDecision: {
    allowed: true,
    effectiveTier: 2,
    reason: "tier_3_allows_all_shots",
    tierPolicyVersion: "pcd-tier-policy@1.0.0",
  },
  imageProvider: "dalle",
  videoProvider: "kling",
  videoProviderChoice: "kling",
  dallePromptLocked: "a studio shot of the product, soft light, neutral background",
  klingDirection: {
    setting: "studio-bright",
    motion: "subtle-dolly",
    energy: "calm",
    lighting: "soft",
    avoid: ["shaky-cam"],
  },
  pairingRefIndex: 0,
  pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  decisionReason: {
    matchedShotType: "simple_ugc",
    matchedOutputIntent: "draft",
    selectionRationale: "synthetic-pairing tier=2 shot=simple_ugc intent=draft → dalle+kling",
  },
};

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
    syntheticRouting: {
      syntheticDecision: klingSuccessDecision,
    },
  };
}

function makeStores(
  overrides: Partial<{
    store: PcdSp18IdentitySnapshotStore;
    consentRevoked: boolean;
  }> = {},
) {
  const persistedSnapshot: PcdIdentitySnapshot = { id: "snap_1" } as PcdIdentitySnapshot;
  const defaultStore: PcdSp18IdentitySnapshotStore = {
    createForShotWithSyntheticRouting: vi.fn(async () => persistedSnapshot),
  };
  return {
    pcdSp18IdentitySnapshotStore: overrides.store ?? defaultStore,
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
    clock: () => new Date("2026-04-30T12:00:00.000Z"),
  };
}

// --------------------------------------------------------------------------
// Happy path
// --------------------------------------------------------------------------

describe("writePcdIdentitySnapshotWithSyntheticRouting — happy path", () => {
  it("calls SP18 store with the full merged payload (kling-success)", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    const result = await writePcdIdentitySnapshotWithSyntheticRouting(input, stores);

    // Returns the store's mock result
    expect(result).toBeDefined();
    expect((result as PcdIdentitySnapshot & { id: string }).id).toBe("snap_1");

    expect(
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting,
    ).toHaveBeenCalledTimes(1);

    const payload = (
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting as ReturnType<
        typeof vi.fn
      >
    ).mock.calls[0][0];

    // SP4 base fields
    expect(payload.assetRecordId).toBe("asset_1");

    // SP9 lineage fields
    expect(payload.briefId).toBe("brief_1");
    expect(payload.scriptId).toBe("script_1");
    expect(payload.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");

    // SP18 7 fields
    expect(payload.imageProvider).toBe("dalle");
    expect(payload.videoProvider).toBe("kling");
    expect(payload.videoProviderChoice).toBe("kling");
    expect(payload.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(payload.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
    expect(payload.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.syntheticRoutingDecisionReason.videoProvider).toBe("kling");
  });

  it("stamps the four SP4 pinned versions from imports", async () => {
    const stores = makeStores();
    await writePcdIdentitySnapshotWithSyntheticRouting(makeBaseInput(), stores);

    const payload = (
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting as ReturnType<
        typeof vi.fn
      >
    ).mock.calls[0][0];

    expect(payload.policyVersion).toBe(PCD_TIER_POLICY_VERSION);
    expect(payload.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
    expect(payload.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
  });
});

// --------------------------------------------------------------------------
// Failure modes
// --------------------------------------------------------------------------

describe("writePcdIdentitySnapshotWithSyntheticRouting — failure modes", () => {
  it("throws ConsentRevokedRefusalError when consent is revoked; SP18 stamper not called; store not called", async () => {
    const stores = makeStores({ consentRevoked: true });
    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(makeBaseInput(), stores),
    ).rejects.toBeInstanceOf(ConsentRevokedRefusalError);
    expect(
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting,
    ).not.toHaveBeenCalled();
  });

  it("throws InvariantViolationError when lineage script id missing from chain", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    // Pass a scriptId that doesn't exist in the chain — SP9 stamper throws InvariantViolationError
    input.provenance = { ...input.provenance, scriptId: "script_missing" };
    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(input, stores),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    expect(
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting,
    ).not.toHaveBeenCalled();
  });

  it("throws when SP18 stamper receives a denial branch (ZodError); store not called", async () => {
    const stores = makeStores();
    const input = makeBaseInput();
    // Pass a denial-branch decision — SP18 stamper throws ZodError (Guardrail A)
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision: { allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as typeof klingSuccessDecision;
    input.syntheticRouting = { syntheticDecision: denial };
    await expect(writePcdIdentitySnapshotWithSyntheticRouting(input, stores)).rejects.toThrow();
    expect(
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting,
    ).not.toHaveBeenCalled();
  });

  it("throws Tier3RoutingViolationError when invariant fails; store not called", async () => {
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
    await expect(
      writePcdIdentitySnapshotWithSyntheticRouting(input, stores),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(
      stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting,
    ).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Step ordering
// --------------------------------------------------------------------------

describe("writePcdIdentitySnapshotWithSyntheticRouting — step ordering", () => {
  it("calls SP9 stamper (consent + lineage) → SP18 stamper → store, in that order", async () => {
    const calls: string[] = [];
    const stores = makeStores();

    // Spy on consent reader (inside SP9 stamper, Step 1)
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

    // Spy on store (Step 6 — last)
    const persistedSnapshot: PcdIdentitySnapshot = { id: "snap_1" } as PcdIdentitySnapshot;
    stores.pcdSp18IdentitySnapshotStore = {
      createForShotWithSyntheticRouting: vi.fn(async () => {
        calls.push("store");
        return persistedSnapshot;
      }),
    };

    await writePcdIdentitySnapshotWithSyntheticRouting(makeBaseInput(), stores);

    // Consent check (inside SP9 stamper) must run before store persist
    const consentIdx = calls.findIndex((c) => c.startsWith("consent:"));
    const storeIdx = calls.indexOf("store");
    expect(consentIdx).toBeGreaterThanOrEqual(0);
    expect(storeIdx).toBeGreaterThan(consentIdx);
    // Store must be the last call
    expect(storeIdx).toBe(calls.length - 1);
  });
});
