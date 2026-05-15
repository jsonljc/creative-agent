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

describe("routeSyntheticPcdShot — synthetic-path ACCESS_POLICY denial (Step 3)", () => {
  it("tier-1 face_closeup → denied (face_closeup needs avatarTier>=3)", async () => {
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
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    expect(result).toMatchObject({
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
    });
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) return;
    expect(result.accessDecision.allowed).toBe(false);
  });

  it("tier-1 simple_ugc + final_export → denied (final_export needs both tiers >= 2)", async () => {
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
        shotType: "simple_ugc",
        outputIntent: "final_export",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect(result.denialKind).toBe("ACCESS_POLICY");
  });

  it("denial branch does NOT carry imageProvider/videoProvider/locked-artifacts", async () => {
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
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect("imageProvider" in result).toBe(false);
    expect("videoProvider" in result).toBe(false);
    expect("dallePromptLocked" in result).toBe(false);
    expect("klingDirection" in result).toBe(false);
  });

  it("denial branch returns BEFORE consulting SP4 (campaignTakeStore never called)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    await routeSyntheticPcdShot(
      makeInput({
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    expect(log.calls).toBe(0);
  });

  it("denial branch syntheticRouterVersion is stamped", async () => {
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
        shotType: "face_closeup",
        outputIntent: "preview",
      }),
      stores,
    );
    if (result.kind !== "synthetic_pairing" || result.allowed !== false) {
      throw new Error("expected synthetic-pairing denial");
    }
    expect(result.syntheticRouterVersion).toBe(PCD_SYNTHETIC_ROUTER_VERSION);
  });
});

import { PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION } from "./synthetic-provider-pairing.js";

const VIDEO_SHOT_TYPES = [
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
] as const;

const OUTPUT_INTENTS = ["draft", "preview", "final_export", "meta_draft"] as const;

describe("routeSyntheticPcdShot — synthetic-pairing success (Step 4)", () => {
  for (const shotType of VIDEO_SHOT_TYPES) {
    for (const outputIntent of OUTPUT_INTENTS) {
      it(`tier-3 ${shotType} + ${outputIntent} → allowed synthetic_pairing`, async () => {
        const log = { calls: 0 };
        const stores: ProviderRouterStores = {
          campaignTakeStore: makeCampaignTakeStore(false, log),
        };
        const result = await routeSyntheticPcdShot(makeInput({ shotType, outputIntent }), stores);
        expect(result).toMatchObject({
          allowed: true,
          kind: "synthetic_pairing",
          imageProvider: "dalle",
          videoProvider: "kling",
          pairingRefIndex: 0,
          pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
          syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
        });
        if (result.kind !== "synthetic_pairing" || result.allowed !== true) return;
        // Locked-artifact byte equality.
        expect(result.dallePromptLocked).toBe(cheryl.dallePromptLocked);
        expect(result.klingDirection).toEqual(cheryl.klingDirection);
        // decisionReason fields echo input.
        expect(result.decisionReason.matchedShotType).toBe(shotType);
        expect(result.decisionReason.matchedOutputIntent).toBe(outputIntent);
      });
    }
  }

  it("perturbing dallePromptLocked by one char shifts the success-branch dallePromptLocked by one char (verbatim)", async () => {
    const tweaked = { ...cheryl, dallePromptLocked: cheryl.dallePromptLocked + "X" };
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ syntheticIdentity: tweaked }), stores);
    if (result.kind !== "synthetic_pairing" || result.allowed !== true) {
      throw new Error("expected synthetic_pairing allowed");
    }
    expect(result.dallePromptLocked).toBe(cheryl.dallePromptLocked + "X");
    expect(result.dallePromptLocked.endsWith("X")).toBe(true);
  });

  it("perturbing klingDirection.setting shifts the success-branch klingDirection.setting (verbatim)", async () => {
    const tweaked = {
      ...cheryl,
      klingDirection: { ...cheryl.klingDirection, setting: "Different setting!" },
    };
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routeSyntheticPcdShot(makeInput({ syntheticIdentity: tweaked }), stores);
    if (result.kind !== "synthetic_pairing" || result.allowed !== true) {
      throw new Error("expected synthetic_pairing allowed");
    }
    expect(result.klingDirection.setting).toBe("Different setting!");
  });
});

import { buildSyntheticSelectionRationale } from "./route-synthetic-pcd-shot.js";

describe("buildSyntheticSelectionRationale", () => {
  it('contains "synthetic-pairing", "dalle+kling", tier number, shotType, outputIntent', () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft");
    expect(out).toContain("synthetic-pairing");
    expect(out).toContain("dalle+kling");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=simple_ugc");
    expect(out).toContain("intent=draft");
  });

  it("never exceeds 200 chars", () => {
    for (const tier of [1, 2, 3] as const) {
      for (const shot of VIDEO_SHOT_TYPES) {
        for (const intent of OUTPUT_INTENTS) {
          expect(buildSyntheticSelectionRationale(tier, shot, intent).length).toBeLessThanOrEqual(
            200,
          );
        }
      }
    }
  });

  it("template form mirrors SP4's buildSelectionRationale shape (tier=, shot=, intent=, →)", () => {
    expect(buildSyntheticSelectionRationale(3, "talking_head", "preview")).toBe(
      "synthetic-pairing tier=3 shot=talking_head intent=preview → dalle+kling",
    );
  });
});

describe("routeSyntheticPcdShot — determinism", () => {
  it("identical input twice → deep-equal decisions (synthetic path)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const inputA = makeInput({ shotType: "simple_ugc", outputIntent: "draft" });
    const inputB = makeInput({ shotType: "simple_ugc", outputIntent: "draft" });
    const a = await routeSyntheticPcdShot(inputA, stores);
    const b = await routeSyntheticPcdShot(inputB, stores);
    expect(a).toEqual(b);
  });

  it("identical input twice → deep-equal decisions (delegation path)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const inputA = makeInput({ shotType: "script_only", outputIntent: "draft" });
    const inputB = makeInput({ shotType: "script_only", outputIntent: "draft" });
    const a = await routeSyntheticPcdShot(inputA, stores);
    const b = await routeSyntheticPcdShot(inputB, stores);
    expect(a).toEqual(b);
  });
});

import { routePcdShot } from "../provider-router.js";
import { PcdRoutingDecisionSchema } from "@creativeagent/schemas";

describe("routeSyntheticPcdShot — stores discipline", () => {
  it("synthetic path: campaignTakeStore throw-on-any-call mock, in-pairing shot still succeeds", async () => {
    const stores: ProviderRouterStores = {
      campaignTakeStore: {
        hasApprovedTier3TakeForCampaign: async () => {
          throw new Error("synthetic path must not consult campaignTakeStore");
        },
      },
    };
    const result = await routeSyntheticPcdShot(
      makeInput({ shotType: "simple_ugc", outputIntent: "draft" }),
      stores,
    );
    expect(result.kind).toBe("synthetic_pairing");
    if (result.kind !== "synthetic_pairing") return;
    expect(result.allowed).toBe(true);
  });

  it("delegation path: routePcdShot is invoked and its decision is returned verbatim on sp4Decision", async () => {
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
    if (result.kind !== "delegated_to_generic_router") return;
    expect(result.sp4Decision).toBeDefined();
    expect(result.sp4Decision.allowed).toBe(true);
    if (!result.sp4Decision.allowed) return;
    // SP4 picks openai_text for storyboard; this proves routePcdShot ran
    // (the synthetic path would have set imageProvider/videoProvider, not
    // selectedProvider).
    expect(result.sp4Decision.selectedProvider).toBe("openai_text");
  });
});

describe("routeSyntheticPcdShot — PcdRoutingDecisionSchema drift verification (real SP4 outputs)", () => {
  it("real SP4 ACCESS_POLICY denial round-trips through PcdRoutingDecisionSchema.parse()", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTierAtResolution: 1,
          creatorTierAtResolution: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(sp4Decision.allowed).toBe(false);
    const parsed = PcdRoutingDecisionSchema.parse(sp4Decision);
    expect(parsed).toEqual(sp4Decision);
  });

  it("real SP4 allowed success round-trips through PcdRoutingDecisionSchema.parse()", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const sp4Decision = await routePcdShot(
      {
        resolvedContext: makeContext(),
        shotType: "simple_ugc",
        outputIntent: "draft",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(sp4Decision.allowed).toBe(true);
    const parsed = PcdRoutingDecisionSchema.parse(sp4Decision);
    expect(parsed).toEqual(sp4Decision);
  });

  // NB: NO_PROVIDER_CAPABILITY is structurally unreachable under SP4's v1
  // matrix (runway covers every video shot type at every tier with
  // supportsFirstLastFrame + supportsEditExtend + supportsPerformanceTransfer
  // all true; openai_text covers script/storyboard). That branch is exercised
  // via the hand-built fixture in packages/schemas/src/__tests__/pcd-synthetic-router.test.ts
  // (Task 2). If a future SP4 matrix tightening introduces a reachable
  // NO_PROVIDER_CAPABILITY path, promote the hand-fixture to a real-call test
  // here at that time.
});

export { cheryl, makeContext, makeInput, makeCampaignTakeStore, NO_CAMPAIGN, WITH_CAMPAIGN };
