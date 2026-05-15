import { describe, expect, it } from "vitest";
import {
  PcdRoutingDecisionSchema,
  SyntheticPcdRoutingDecisionSchema,
} from "../pcd-synthetic-router.js";

const goodAccessDecisionAllowed = {
  allowed: true as const,
  effectiveTier: 3 as const,
};

const goodAccessDecisionDenied = {
  allowed: false as const,
  effectiveTier: 1 as const,
  requiredAvatarTier: 2 as const,
  requiredProductTier: 2 as const,
  reason: "generation requires avatarTier>=2 and productTier>=2",
  requiredActions: ["upgrade_avatar_identity", "upgrade_product_identity"] as const,
};

const goodKlingDirection = {
  setting: "Clinic bathroom",
  motion: "Lean in then pull back",
  energy: "Open mouth excited",
  lighting: "Fluorescent",
  avoid: ["Slow pans"],
} as const;

describe("PcdRoutingDecisionSchema", () => {
  it("round-trips SP4 ACCESS_POLICY denial", () => {
    const v = {
      allowed: false as const,
      denialKind: "ACCESS_POLICY" as const,
      accessDecision: goodAccessDecisionDenied,
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("round-trips SP4 NO_PROVIDER_CAPABILITY denial", () => {
    const v = {
      allowed: false as const,
      denialKind: "NO_PROVIDER_CAPABILITY" as const,
      accessDecision: goodAccessDecisionAllowed,
      reason: "no provider satisfies tier3 routing rules for this shot" as const,
      requiredActions: ["choose_safer_shot_type"] as const,
      candidatesEvaluated: 2,
      candidatesAfterTier3Filter: 0,
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("round-trips SP4 allowed-success", () => {
    const v = {
      allowed: true as const,
      accessDecision: goodAccessDecisionAllowed,
      selectedCapability: {
        provider: "runway",
        tiers: [3] as const,
        shotTypes: ["simple_ugc"] as const,
        outputIntents: ["draft"] as const,
        supportsFirstLastFrame: true,
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
      selectedProvider: "runway",
      providerCapabilityVersion: "provider-capability@1.0.0",
      routerVersion: "provider-router@1.0.0",
      decisionReason: {
        capabilityRefIndex: 2,
        matchedShotType: "simple_ugc" as const,
        matchedEffectiveTier: 3 as const,
        matchedOutputIntent: "draft" as const,
        tier3RulesApplied: ["first_last_frame_anchor"],
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
        selectionRationale:
          "tier=3 shot=simple_ugc intent=draft → runway (tier3 rules [first_last_frame_anchor])",
      },
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).not.toThrow();
  });

  it("rejects allowed-success with missing decisionReason.selectionRationale", () => {
    const v = {
      allowed: true as const,
      accessDecision: goodAccessDecisionAllowed,
      selectedCapability: {
        provider: "runway",
        tiers: [3] as const,
        shotTypes: ["simple_ugc"] as const,
        outputIntents: ["draft"] as const,
        supportsFirstLastFrame: true,
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
      selectedProvider: "runway",
      providerCapabilityVersion: "provider-capability@1.0.0",
      routerVersion: "provider-router@1.0.0",
      decisionReason: {
        capabilityRefIndex: 2,
        matchedShotType: "simple_ugc" as const,
        matchedEffectiveTier: 3 as const,
        matchedOutputIntent: "draft" as const,
        tier3RulesApplied: [],
        candidatesEvaluated: 1,
        candidatesAfterTier3Filter: 1,
      },
    };
    expect(() => PcdRoutingDecisionSchema.parse(v)).toThrow();
  });
});

const goodSyntheticAllowed = {
  allowed: true as const,
  kind: "synthetic_pairing" as const,
  accessDecision: goodAccessDecisionAllowed,
  imageProvider: "dalle" as const,
  videoProvider: "kling" as const,
  dallePromptLocked: "Vertical lo-fi selfie photo. Young Chinese woman, 23.",
  klingDirection: goodKlingDirection,
  pairingRefIndex: 0,
  pairingVersion: "pcd-synthetic-provider-pairing@1.0.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
  decisionReason: {
    matchedShotType: "simple_ugc" as const,
    matchedOutputIntent: "draft" as const,
    selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
  },
};

const goodSyntheticDenied = {
  allowed: false as const,
  kind: "synthetic_pairing" as const,
  denialKind: "ACCESS_POLICY" as const,
  accessDecision: goodAccessDecisionDenied,
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
};

const goodDelegated = {
  kind: "delegated_to_generic_router" as const,
  reason: "shot_type_not_in_synthetic_pairing" as const,
  shotType: "script_only" as const,
  sp4Decision: {
    allowed: true as const,
    accessDecision: goodAccessDecisionAllowed,
    selectedCapability: {
      provider: "openai_text",
      tiers: [3] as const,
      shotTypes: ["script_only"] as const,
      outputIntents: ["draft"] as const,
      supportsFirstLastFrame: false,
      supportsEditExtend: true,
      supportsPerformanceTransfer: false,
    },
    selectedProvider: "openai_text",
    providerCapabilityVersion: "provider-capability@1.0.0",
    routerVersion: "provider-router@1.0.0",
    decisionReason: {
      capabilityRefIndex: 1,
      matchedShotType: "script_only" as const,
      matchedEffectiveTier: 3 as const,
      matchedOutputIntent: "draft" as const,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "tier=3 shot=script_only intent=draft → openai_text (no tier3 rules)",
    },
  },
  syntheticRouterVersion: "pcd-synthetic-router@1.0.0",
};

describe("SyntheticPcdRoutingDecisionSchema", () => {
  it("round-trips synthetic-pairing allowed", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodSyntheticAllowed)).not.toThrow();
  });

  it("round-trips synthetic-pairing denial (ACCESS_POLICY)", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodSyntheticDenied)).not.toThrow();
  });

  it("round-trips delegation envelope", () => {
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(goodDelegated)).not.toThrow();
  });

  it('rejects allowed branch with imageProvider !== "dalle"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({
        ...goodSyntheticAllowed,
        imageProvider: "midjourney",
      }),
    ).toThrow();
  });

  it('rejects allowed branch with videoProvider !== "kling"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, videoProvider: "runway" }),
    ).toThrow();
  });

  it("rejects allowed branch with empty dallePromptLocked", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, dallePromptLocked: "" }),
    ).toThrow();
  });

  it("rejects allowed branch with dallePromptLocked.length > 4000", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({
        ...goodSyntheticAllowed,
        dallePromptLocked: "x".repeat(4001),
      }),
    ).toThrow();
  });

  it("rejects allowed branch with malformed klingDirection (missing field)", () => {
    const { lighting: _drop, ...partial } = goodKlingDirection;
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticAllowed, klingDirection: partial }),
    ).toThrow();
  });

  it('rejects denial branch with kind !== "synthetic_pairing"', () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodSyntheticDenied, kind: "something_else" }),
    ).toThrow();
  });

  it("rejects every branch missing syntheticRouterVersion", () => {
    const { syntheticRouterVersion: _a, ...allowedNoVer } = goodSyntheticAllowed;
    const { syntheticRouterVersion: _b, ...deniedNoVer } = goodSyntheticDenied;
    const { syntheticRouterVersion: _c, ...delegatedNoVer } = goodDelegated;
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(allowedNoVer)).toThrow();
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(deniedNoVer)).toThrow();
    expect(() => SyntheticPcdRoutingDecisionSchema.parse(delegatedNoVer)).toThrow();
  });

  it("rejects delegation branch with non-`shot_type_not_in_synthetic_pairing` reason", () => {
    expect(() =>
      SyntheticPcdRoutingDecisionSchema.parse({ ...goodDelegated, reason: "other_reason" }),
    ).toThrow();
  });
});
