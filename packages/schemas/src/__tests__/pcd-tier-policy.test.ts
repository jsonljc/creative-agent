import { describe, expect, it } from "vitest";
import {
  PcdShotTypeSchema,
  OutputIntentSchema,
  PcdRequiredActionSchema,
  PcdTierDecisionSchema,
  type PcdShotType,
  type OutputIntent,
  type PcdRequiredAction,
  type PcdTierDecision,
} from "../pcd-tier-policy.js";

describe("PcdShotTypeSchema", () => {
  it("accepts every shot type and rejects meta_ad_draft", () => {
    const valid: PcdShotType[] = [
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
    for (const v of valid) expect(PcdShotTypeSchema.parse(v)).toBe(v);
    expect(() => PcdShotTypeSchema.parse("meta_ad_draft")).toThrow();
    expect(() => PcdShotTypeSchema.parse("garbage")).toThrow();
  });
});

describe("OutputIntentSchema", () => {
  it("accepts the four intents", () => {
    const valid: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
    for (const v of valid) expect(OutputIntentSchema.parse(v)).toBe(v);
    expect(() => OutputIntentSchema.parse("publish")).toThrow();
  });
});

describe("PcdRequiredActionSchema", () => {
  it("accepts the four canonical actions", () => {
    const valid: PcdRequiredAction[] = [
      "upgrade_avatar_identity",
      "upgrade_product_identity",
      "use_lower_output_intent",
      "choose_safer_shot_type",
    ];
    for (const v of valid) expect(PcdRequiredActionSchema.parse(v)).toBe(v);
    expect(() => PcdRequiredActionSchema.parse("nope")).toThrow();
  });
});

describe("PcdTierDecisionSchema", () => {
  it("parses an allowed minimal decision", () => {
    const parsed = PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 2 });
    expect(parsed.allowed).toBe(true);
    expect(parsed.effectiveTier).toBe(2);
    expect(parsed.reason).toBeUndefined();
    expect(parsed.requiredActions).toBeUndefined();
  });

  it("parses a blocked decision with optional fields", () => {
    const decision: PcdTierDecision = {
      allowed: false,
      effectiveTier: 1,
      requiredAvatarTier: 3,
      requiredProductTier: 2,
      reason: "generation requires avatarTier>=3 and productTier>=2",
      requiredActions: ["upgrade_avatar_identity", "upgrade_product_identity"],
    };
    const parsed = PcdTierDecisionSchema.parse(decision);
    expect(parsed).toEqual(decision);
  });

  it("rejects out-of-range tiers", () => {
    expect(() => PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 4 })).toThrow();
    expect(() => PcdTierDecisionSchema.parse({ allowed: true, effectiveTier: 0 })).toThrow();
  });
});
