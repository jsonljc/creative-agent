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
