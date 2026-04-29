import { describe, expect, it } from "vitest";
import { PreproductionChainStageEnumSchema } from "../pcd-preproduction.js";

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
