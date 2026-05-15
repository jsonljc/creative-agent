import { describe, expect, it } from "vitest";
import {
  PcdRoutingDecisionSchema,
  type OutputIntent,
  type PcdShotType,
} from "@creativeagent/schemas";
import {
  routeSyntheticPcdShot,
  buildSyntheticSelectionRationale,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";
import { PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION } from "./synthetic-provider-pairing.js";
import {
  routePcdShot,
  type ApprovedCampaignContext,
  type ProviderRouterStores,
} from "../provider-router.js";
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
    videoProviderChoice: "kling",
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

describe("routeSyntheticPcdShot — Step 2 delegation (SP17 — videoProviderChoice plumbed)", () => {
  it("delegates with videoProviderChoice=kling on script_only", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const decision = await routeSyntheticPcdShot(
      makeInput({
        shotType: "script_only",
        outputIntent: "draft",
        videoProviderChoice: "kling",
      }),
      stores,
    );
    expect(decision.kind).toBe("delegated_to_generic_router");
    if (decision.kind === "delegated_to_generic_router") {
      expect(decision.reason).toBe("shot_type_not_in_synthetic_pairing");
    }
    expect("videoProviderChoice" in decision).toBe(false);
  });

  it("delegates with videoProviderChoice=seedance on script_only (same behavior; choice not echoed)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const decision = await routeSyntheticPcdShot(
      makeInput({
        shotType: "script_only",
        outputIntent: "draft",
        videoProviderChoice: "seedance",
      }),
      stores,
    );
    expect(decision.kind).toBe("delegated_to_generic_router");
    if (decision.kind === "delegated_to_generic_router") {
      expect(decision.reason).toBe("shot_type_not_in_synthetic_pairing");
    }
    expect("videoProviderChoice" in decision).toBe(false);
  });

  it("delegates on storyboard for either provider choice", async () => {
    for (const choice of ["kling", "seedance"] as const) {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(false, log),
      };
      const decision = await routeSyntheticPcdShot(
        makeInput({ shotType: "storyboard", outputIntent: "draft", videoProviderChoice: choice }),
        stores,
      );
      expect(decision.kind).toBe("delegated_to_generic_router");
      if (decision.kind === "delegated_to_generic_router") {
        expect(decision.reason).toBe("shot_type_not_in_synthetic_pairing");
      }
    }
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
          videoProviderChoice: "kling",
          pairingRefIndex: 0,
          pairingVersion: PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
          syntheticRouterVersion: PCD_SYNTHETIC_ROUTER_VERSION,
        });
        if (result.kind !== "synthetic_pairing" || result.allowed !== true) return;
        if (result.videoProvider !== "kling") throw new Error("expected kling branch");
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
    if (result.videoProvider !== "kling") throw new Error("expected kling branch");
    expect(result.videoProviderChoice).toBe("kling");
    expect(result.klingDirection.setting).toBe("Different setting!");
  });
});

describe("buildSyntheticSelectionRationale", () => {
  it('contains "synthetic-pairing", "dalle+kling", tier number, shotType, outputIntent', () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft", "kling");
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
          expect(
            buildSyntheticSelectionRationale(tier, shot, intent, "kling").length,
          ).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it("template form mirrors SP4's buildSelectionRationale shape (tier=, shot=, intent=, →)", () => {
    expect(buildSyntheticSelectionRationale(3, "talking_head", "preview", "kling")).toBe(
      "synthetic-pairing tier=3 shot=talking_head intent=preview → dalle+kling",
    );
  });
});

describe("buildSyntheticSelectionRationale (SP17 — 4th arg videoProvider)", () => {
  it("includes 'dalle+kling' when videoProvider is kling", () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft", "kling");
    expect(out).toContain("dalle+kling");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=simple_ugc");
    expect(out).toContain("intent=draft");
  });

  it("includes 'dalle+seedance' when videoProvider is seedance", () => {
    const out = buildSyntheticSelectionRationale(3, "product_demo", "final_export", "seedance");
    expect(out).toContain("dalle+seedance");
    expect(out).toContain("tier=3");
    expect(out).toContain("shot=product_demo");
    expect(out).toContain("intent=final_export");
  });

  it("caps output at 200 chars", () => {
    const out = buildSyntheticSelectionRationale(3, "simple_ugc", "draft", "seedance");
    expect(out.length).toBeLessThanOrEqual(200);
  });
});

describe("routeSyntheticPcdShot — Step 5 success branches (SP17 — per-provider)", () => {
  const videoShots: PcdShotType[] = [
    "simple_ugc",
    "talking_head",
    "product_demo",
    "product_in_hand",
    "face_closeup",
    "label_closeup",
    "object_insert",
  ];
  const intents: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];

  it("kling success carries videoProviderChoice='kling' on every video shot × intent (28 combos)", async () => {
    const baseSynth = makeInput().syntheticIdentity;
    for (const shotType of videoShots) {
      for (const outputIntent of intents) {
        const log = { calls: 0 };
        const stores: ProviderRouterStores = {
          campaignTakeStore: makeCampaignTakeStore(false, log),
        };
        const decision = await routeSyntheticPcdShot(
          { ...makeInput(), shotType, outputIntent, videoProviderChoice: "kling" },
          stores,
        );
        expect(decision.allowed).toBe(true);
        if (decision.allowed === true && decision.kind === "synthetic_pairing") {
          expect(decision.videoProvider).toBe("kling");
          expect(decision.videoProviderChoice).toBe("kling");
          expect(decision.imageProvider).toBe("dalle");
          if (decision.videoProvider === "kling") {
            expect(decision.klingDirection).toEqual(baseSynth.klingDirection);
          }
          expect("seedanceDirection" in decision).toBe(false);
          expect(decision.pairingRefIndex).toBe(0);
          expect(decision.pairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
          expect(decision.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
        }
      }
    }
  });

  it("seedance success carries videoProviderChoice='seedance' on every video shot × intent (28 combos, populated fixture)", async () => {
    const seedanceDir = {
      setting: "Bright counter",
      motion: "Hand reveal",
      energy: "Warm",
      lighting: "Soft window",
      avoid: ["Cuts"],
    };
    const populated = {
      ...makeInput().syntheticIdentity,
      seedanceDirection: seedanceDir,
    };
    for (const shotType of videoShots) {
      for (const outputIntent of intents) {
        const log = { calls: 0 };
        const stores: ProviderRouterStores = {
          campaignTakeStore: makeCampaignTakeStore(false, log),
        };
        const decision = await routeSyntheticPcdShot(
          {
            ...makeInput(),
            shotType,
            outputIntent,
            videoProviderChoice: "seedance",
            syntheticIdentity: populated,
          },
          stores,
        );
        expect(decision.allowed).toBe(true);
        if (decision.allowed === true && decision.kind === "synthetic_pairing") {
          expect(decision.videoProvider).toBe("seedance");
          expect(decision.videoProviderChoice).toBe("seedance");
          expect(decision.imageProvider).toBe("dalle");
          if (decision.videoProvider === "seedance") {
            expect(decision.seedanceDirection).toEqual(seedanceDir);
          }
          expect("klingDirection" in decision).toBe(false);
          expect(decision.pairingRefIndex).toBe(1);
          expect(decision.pairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
          expect(decision.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
        }
      }
    }
  });

  it("locked artifacts byte-equality — kling direction shifts when input shifts", async () => {
    const log1 = { calls: 0 };
    const stores1: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log1),
    };
    const dec1 = await routeSyntheticPcdShot(
      { ...makeInput(), videoProviderChoice: "kling" },
      stores1,
    );
    const log2 = { calls: 0 };
    const stores2: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log2),
    };
    const dec2 = await routeSyntheticPcdShot(
      {
        ...makeInput(),
        videoProviderChoice: "kling",
        syntheticIdentity: {
          ...makeInput().syntheticIdentity,
          klingDirection: {
            ...makeInput().syntheticIdentity.klingDirection,
            setting: "DIFFERENT",
          },
        },
      },
      stores2,
    );
    if (dec1.allowed === true && dec1.kind === "synthetic_pairing" && dec1.videoProvider === "kling") {
      if (
        dec2.allowed === true &&
        dec2.kind === "synthetic_pairing" &&
        dec2.videoProvider === "kling"
      ) {
        expect(dec1.klingDirection.setting).not.toBe(dec2.klingDirection.setting);
        expect(dec2.klingDirection.setting).toBe("DIFFERENT");
      }
    }
  });

  it("locked artifacts byte-equality — seedance direction shifts when input shifts", async () => {
    const sdA = {
      setting: "Bright counter A",
      motion: "M",
      energy: "E",
      lighting: "L",
      avoid: ["x"],
    };
    const sdB = { ...sdA, setting: "Bright counter B" };
    const logA = { calls: 0 };
    const storesA: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, logA),
    };
    const decA = await routeSyntheticPcdShot(
      {
        ...makeInput(),
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...makeInput().syntheticIdentity, seedanceDirection: sdA },
      },
      storesA,
    );
    const logB = { calls: 0 };
    const storesB: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, logB),
    };
    const decB = await routeSyntheticPcdShot(
      {
        ...makeInput(),
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...makeInput().syntheticIdentity, seedanceDirection: sdB },
      },
      storesB,
    );
    if (
      decA.allowed === true &&
      decA.kind === "synthetic_pairing" &&
      decA.videoProvider === "seedance"
    ) {
      if (
        decB.allowed === true &&
        decB.kind === "synthetic_pairing" &&
        decB.videoProvider === "seedance"
      ) {
        expect(decA.seedanceDirection.setting).toBe("Bright counter A");
        expect(decB.seedanceDirection.setting).toBe("Bright counter B");
      }
    }
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

describe("routeSyntheticPcdShot — Step 4 NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER (SP17)", () => {
  it("denies when videoProviderChoice=seedance and seedanceDirection is null", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const decision = await routeSyntheticPcdShot(
      {
        ...makeInput(),
        videoProviderChoice: "seedance",
        syntheticIdentity: {
          ...makeInput().syntheticIdentity,
          seedanceDirection: null,
        },
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.kind).toBe("synthetic_pairing");
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
      if (decision.denialKind === "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER") {
        expect(decision.videoProviderChoice).toBe("seedance");
      }
      expect(decision.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    }
  });

  it("denies when videoProviderChoice=seedance and seedanceDirection field is omitted (undefined → null)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const input = makeInput();
    const { seedanceDirection: _omit, ...identityMinusSeedance } = input.syntheticIdentity;
    const decision = await routeSyntheticPcdShot(
      {
        ...input,
        videoProviderChoice: "seedance",
        syntheticIdentity: identityMinusSeedance as typeof input.syntheticIdentity,
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
    }
  });

  it("does NOT deny when videoProviderChoice=kling (klingDirection is always populated on SP11 payload)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const decision = await routeSyntheticPcdShot(
      {
        ...makeInput(),
        videoProviderChoice: "kling",
        syntheticIdentity: { ...makeInput().syntheticIdentity, seedanceDirection: null },
      },
      stores,
    );
    // klingDirection is non-nullable on the SP11 payload schema, so the kling
    // choice never hits NO_DIRECTION_AUTHORED. With the tier-3 fixture the
    // decision should be allowed; assert that decisively rather than only
    // negating the unreachable denial kind.
    expect(decision.allowed).toBe(true);
  });

  it("step ordering: ACCESS_POLICY fires before NO_DIRECTION_AUTHORED", async () => {
    // Build an input that would trigger BOTH ACCESS_POLICY and NO_DIRECTION
    // if Step 4 ran in isolation. Expected: ACCESS_POLICY denial (Step 3 fires
    // first), NOT NO_DIRECTION.
    //
    // Reuse the SP16 ACCESS_POLICY-triggering fixture: tier-1 + simple_ugc +
    // final_export (final_export needs both tiers >= 2). Combine with
    // seedance + null seedanceDirection so Step 4 would also fire.
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const tierDeniedInput = makeInput({
      resolvedContext: makeContext({
        productTierAtResolution: 1,
        creatorTierAtResolution: 1,
        effectiveTier: 1,
        allowedOutputTier: 1,
      }),
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    const decision = await routeSyntheticPcdShot(
      {
        ...tierDeniedInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...tierDeniedInput.syntheticIdentity, seedanceDirection: null },
      },
      stores,
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("ACCESS_POLICY");
    }
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
