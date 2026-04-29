import { describe, expect, it } from "vitest";
import { PreproductionChainStageEnumSchema } from "../pcd-preproduction.js";
import { UgcStyleConstraintSchema } from "../pcd-preproduction.js";

describe("PreproductionChainStageEnumSchema", () => {
  it("accepts every documented stage name", () => {
    const stages = [
      "trends",
      "motivators",
      "hooks",
      "creator_scripts",
      "production_fanout_gate",
    ];
    for (const s of stages) {
      expect(PreproductionChainStageEnumSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects undocumented stage names", () => {
    expect(PreproductionChainStageEnumSchema.safeParse("storyboard").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("scripts").success).toBe(false);
  });
});

describe("UgcStyleConstraintSchema", () => {
  it("accepts the five locked constraint values", () => {
    const values = [
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ];
    for (const v of values) {
      expect(UgcStyleConstraintSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects undocumented constraints", () => {
    expect(UgcStyleConstraintSchema.safeParse("polished_brand_film").success).toBe(false);
    expect(UgcStyleConstraintSchema.safeParse("").success).toBe(false);
  });
});

import { PcdBriefInputSchema } from "../pcd-preproduction.js";

describe("PcdBriefInputSchema", () => {
  const valid = {
    briefId: "brief-1",
    productDescription: "AI WhatsApp lead-reply assistant",
    targetAudience: "Solo founders running paid traffic",
    platforms: ["instagram_reels", "tiktok"],
    brandVoice: null,
    references: [],
    creatorIdentityRef: "creator-1",
    productIdentityRef: "product-1",
  };

  it("accepts a minimal valid brief", () => {
    expect(PcdBriefInputSchema.safeParse(valid).success).toBe(true);
  });

  it("requires briefId", () => {
    const { briefId: _b, ...withoutId } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutId).success).toBe(false);
  });

  it("requires creatorIdentityRef", () => {
    const { creatorIdentityRef: _c, ...withoutCreator } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutCreator).success).toBe(false);
  });

  it("requires productIdentityRef", () => {
    const { productIdentityRef: _p, ...withoutProduct } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutProduct).success).toBe(false);
  });

  it("allows brandVoice to be null or undefined", () => {
    expect(PcdBriefInputSchema.safeParse({ ...valid, brandVoice: null }).success).toBe(true);
    const { brandVoice: _bv, ...withoutBrandVoice } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutBrandVoice).success).toBe(true);
  });

  it("allows references to be omitted", () => {
    const { references: _r, ...withoutRefs } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutRefs).success).toBe(true);
  });
});
