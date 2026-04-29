import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  requiresEditOverRegenerate,
  assertTier3RoutingDecisionCompliant,
  Tier3RoutingViolationError,
  Tier3RoutingMetadataMismatchError,
  type CampaignTakeStore,
  type Tier3RoutingRuleStores,
} from "./tier3-routing-rules.js";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

const ALL_SHOT_TYPES: PcdShotType[] = [
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];
const ALL_OUTPUT_INTENTS: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
const ALL_TIERS: IdentityTier[] = [1, 2, 3];

const VIDEO_SHOTS: ReadonlyArray<PcdShotType> = [
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];
const PUBLISHABLE: ReadonlyArray<OutputIntent> = ["preview", "final_export", "meta_draft"];

describe("requiresFirstLastFrameAnchor", () => {
  it.each(
    ALL_TIERS.flatMap((t) =>
      ALL_SHOT_TYPES.flatMap((s) => ALL_OUTPUT_INTENTS.map((o) => [t, s, o] as const)),
    ),
  )("tier=%s shot=%s intent=%s", (effectiveTier, shotType, outputIntent) => {
    const expected =
      effectiveTier === 3 && VIDEO_SHOTS.includes(shotType) && PUBLISHABLE.includes(outputIntent);
    expect(requiresFirstLastFrameAnchor({ effectiveTier, shotType, outputIntent })).toBe(expected);
  });
});

describe("requiresPerformanceTransfer", () => {
  it.each(ALL_TIERS.flatMap((t) => ALL_SHOT_TYPES.map((s) => [t, s] as const)))(
    "tier=%s shot=%s",
    (effectiveTier, shotType) => {
      const expected = effectiveTier === 3 && shotType === "talking_head";
      expect(requiresPerformanceTransfer({ effectiveTier, shotType })).toBe(expected);
    },
  );
});

function makeCampaignTakeStore(returns: boolean, calls: { count: number }): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      calls.count += 1;
      return returns;
    },
  };
}

describe("requiresEditOverRegenerate", () => {
  it("at Tier 1, never consults the store and returns false", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    const result = await requiresEditOverRegenerate(
      { effectiveTier: 1, organizationId: "o", campaignId: "c" },
      stores,
    );
    expect(result).toBe(false);
    expect(calls.count).toBe(0);
  });

  it("at Tier 2, never consults the store and returns false", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    const result = await requiresEditOverRegenerate(
      { effectiveTier: 2, organizationId: "o", campaignId: "c" },
      stores,
    );
    expect(result).toBe(false);
    expect(calls.count).toBe(0);
  });

  it("at Tier 3, returns the store's verdict (true)", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(true, calls),
    };
    expect(
      await requiresEditOverRegenerate(
        { effectiveTier: 3, organizationId: "o", campaignId: "c" },
        stores,
      ),
    ).toBe(true);
    expect(calls.count).toBe(1);
  });

  it("at Tier 3, returns the store's verdict (false)", async () => {
    const calls = { count: 0 };
    const stores: Tier3RoutingRuleStores = {
      campaignTakeStore: makeCampaignTakeStore(false, calls),
    };
    expect(
      await requiresEditOverRegenerate(
        { effectiveTier: 3, organizationId: "o", campaignId: "c" },
        stores,
      ),
    ).toBe(false);
    expect(calls.count).toBe(1);
  });
});

const SUPPORTS_ALL: PcdProviderCapability = {
  provider: "test-all",
  tiers: [1, 2, 3],
  shotTypes: [...ALL_SHOT_TYPES],
  outputIntents: [...ALL_OUTPUT_INTENTS],
  supportsFirstLastFrame: true,
  supportsEditExtend: true,
  supportsPerformanceTransfer: true,
};

const SUPPORTS_NONE: PcdProviderCapability = {
  ...SUPPORTS_ALL,
  provider: "test-none",
  supportsFirstLastFrame: false,
  supportsEditExtend: false,
  supportsPerformanceTransfer: false,
};

describe("assertTier3RoutingDecisionCompliant — capability checks", () => {
  it("returns void at Tier 1/2 regardless of capability flags", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 1,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_NONE,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 2,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_NONE,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });

  it("Tier 3 + simple_ugc + final_export: rule 1 required, capability supports it → returns void", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });

  it("Tier 3 + rule 1 required, capability missing supportsFirstLastFrame → throws Tier3RoutingViolationError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsFirstLastFrame: false },
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("Tier 3 + talking_head: rule 1 + rule 2 required → both flags must be present on capability", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsPerformanceTransfer: false },
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("Tier 3 + rule 3 required (editOverRegenerateRequired=true), capability missing supportsEditExtend → throws", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsEditExtend: false },
        tier3RulesApplied: ["first_last_frame_anchor", "edit_over_regenerate"],
        editOverRegenerateRequired: true,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });
});

describe("assertTier3RoutingDecisionCompliant — forensic-vs-enforcement separation (bypass closure)", () => {
  it("BYPASS CLOSURE: editOverRegenerateRequired=true + tier3RulesApplied=[] + supportsEditExtend=false throws Tier3RoutingViolationError", () => {
    // Caller suppresses tier3RulesApplied to hide the rule. Recompute path
    // identifies rule 3 as required (from explicit boolean), finds capability
    // missing the flag, throws — regardless of forensic claim.
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: {
          ...SUPPORTS_ALL,
          supportsEditExtend: false,
        },
        tier3RulesApplied: [], // caller lies
        editOverRegenerateRequired: true,
      }),
    ).toThrow(Tier3RoutingViolationError);
  });

  it("FORENSIC MISMATCH: rule 1 recomputed-required but tier3RulesApplied=[] (capability OK) → Tier3RoutingMetadataMismatchError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: [], // omits required rule 1
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingMetadataMismatchError);
  });

  it("FORENSIC MISMATCH: rule 1 NOT recomputed-required but tier3RulesApplied=['first_last_frame_anchor'] → Tier3RoutingMetadataMismatchError", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "script_only", // not a video shot; rule 1 not recomputed-required
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor"], // forensic claims a rule that did not fire
        editOverRegenerateRequired: false,
      }),
    ).toThrow(Tier3RoutingMetadataMismatchError);
  });

  it("tier3RulesApplied set equality is order-independent", () => {
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["performance_transfer", "first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "talking_head",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
        editOverRegenerateRequired: false,
      }),
    ).not.toThrow();
  });
});

describe("Error class shapes", () => {
  it("Tier3RoutingViolationError populates name + rule + provider", () => {
    try {
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: { ...SUPPORTS_ALL, supportsFirstLastFrame: false },
        tier3RulesApplied: ["first_last_frame_anchor"],
        editOverRegenerateRequired: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Tier3RoutingViolationError);
      const e = err as Tier3RoutingViolationError;
      expect(e.name).toBe("Tier3RoutingViolationError");
      expect(e.rule).toBe("first_last_frame_anchor");
      expect(e.provider).toBe("test-all");
      expect(e.message).toContain("first_last_frame_anchor");
      expect(e.message).toContain("test-all");
    }
  });

  it("Tier3RoutingMetadataMismatchError populates name + expected + actual", () => {
    try {
      assertTier3RoutingDecisionCompliant({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        selectedCapability: SUPPORTS_ALL,
        tier3RulesApplied: [],
        editOverRegenerateRequired: false,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Tier3RoutingMetadataMismatchError);
      const e = err as Tier3RoutingMetadataMismatchError;
      expect(e.name).toBe("Tier3RoutingMetadataMismatchError");
      expect(e.expected).toEqual(["first_last_frame_anchor"]);
      expect(e.actual).toEqual([]);
    }
  });
});

describe("Forbidden imports in tier3-routing-rules.ts", () => {
  it("contains none of the forbidden import paths", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "tier3-routing-rules.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
  });
});
