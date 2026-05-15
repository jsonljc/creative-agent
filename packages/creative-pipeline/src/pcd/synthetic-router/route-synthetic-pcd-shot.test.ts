import { describe, expect, it } from "vitest";
import {
  routeSyntheticPcdShot,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";
import type { ApprovedCampaignContext, ProviderRouterStores } from "../provider-router.js";
import type { CampaignTakeStore } from "../tier3-routing-rules.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "../shot-spec-version.js";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/index.js";

const cheryl = SP11_SYNTHETIC_CREATOR_ROSTER[0].synthetic;

function makeContext(overrides: Partial<ResolvedPcdContext> = {}): ResolvedPcdContext {
  return {
    productIdentityId: "p-1",
    creatorIdentityId: cheryl.creatorIdentityId,
    productTierAtResolution: 3,
    creatorTierAtResolution: 3,
    effectiveTier: 3,
    allowedOutputTier: 3,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    ...overrides,
  };
}

function makeCampaignTakeStore(returns: boolean, log: { calls: number }): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      log.calls += 1;
      return returns;
    },
  };
}

const NO_CAMPAIGN: ApprovedCampaignContext = { kind: "none" };
const WITH_CAMPAIGN: ApprovedCampaignContext = {
  kind: "campaign",
  organizationId: "org-1",
  campaignId: "camp-1",
};

function makeInput(
  overrides: Partial<RouteSyntheticPcdShotInput> = {},
): RouteSyntheticPcdShotInput {
  return {
    resolvedContext: makeContext(),
    syntheticIdentity: cheryl,
    shotType: "simple_ugc",
    outputIntent: "draft",
    approvedCampaignContext: NO_CAMPAIGN,
    ...overrides,
  };
}

describe("routeSyntheticPcdShot — delegation branch (out-of-pairing shot types)", () => {
  it("script_only delegates to SP4 and wraps the decision", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "script_only" }), stores);
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.reason).toBe("shot_type_not_in_synthetic_pairing");
    expect(result.shotType).toBe("script_only");
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
    expect(result.sp4Decision).toBeDefined();
  });

  it("storyboard delegates to SP4 and wraps the decision", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "storyboard" }), stores);
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.shotType).toBe("storyboard");
  });

  it("delegation embeds SP4 success — tier-3 storyboard → openai_text", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({ shotType: "storyboard", outputIntent: "draft" }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision.allowed).toBe(true);
    if (!result.sp4Decision.allowed) return;
    expect(result.sp4Decision.selectedProvider).toBe("openai_text");
  });

  it("delegation embeds SP4 ACCESS_POLICY denial when SP2 denies the shot", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "script_only",
        outputIntent: "final_export",
      }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision.allowed).toBe(false);
    if (result.sp4Decision.allowed) return;
    expect(result.sp4Decision.denialKind).toBe("ACCESS_POLICY");
  });

  it("WITH_CAMPAIGN tier-3 storyboard delegates and SP4 path runs (campaign-take store may be consulted)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(
      makeInput({
        shotType: "storyboard",
        outputIntent: "draft",
        approvedCampaignContext: WITH_CAMPAIGN,
      }),
      stores,
    );
    expect(result.kind).toBe("delegated_to_generic_router");
  });

  it("delegation branch carries syntheticRouterVersion verbatim", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ shotType: "script_only" }), stores);
    if (result.kind !== "delegated_to_generic_router") throw new Error("expected delegation");
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
  });
});

export { cheryl, makeContext, makeInput, makeCampaignTakeStore, NO_CAMPAIGN, WITH_CAMPAIGN };
