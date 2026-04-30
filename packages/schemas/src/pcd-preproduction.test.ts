import { describe, expect, it } from "vitest";
import {
  PreproductionTreeBudgetSchema,
  ProductionFanoutGateOperatorDecisionSchema,
} from "./pcd-preproduction.js";

describe("PreproductionTreeBudgetSchema", () => {
  it("accepts positive integers", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3, maxTreeSize: 100 }).success,
    ).toBe(true);
  });

  it("rejects zero or negative fanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 0, maxTreeSize: 100 }).success,
    ).toBe(false);
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: -1, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects non-integer fanout", () => {
    expect(
      PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 1.5, maxTreeSize: 100 }).success,
    ).toBe(false);
  });

  it("rejects missing maxTreeSize", () => {
    expect(PreproductionTreeBudgetSchema.safeParse({ maxBranchFanout: 3 }).success).toBe(false);
  });
});

describe("ProductionFanoutGateOperatorDecisionSchema", () => {
  it("accepts a minimal valid decision", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: null,
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects empty selectedScriptIds", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: [],
        decidedBy: null,
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects non-ISO decidedAt", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: null,
        decidedAt: "not-a-datetime",
      }).success,
    ).toBe(false);
  });

  it("accepts decidedBy as a string", () => {
    expect(
      ProductionFanoutGateOperatorDecisionSchema.safeParse({
        selectedScriptIds: ["script-1"],
        decidedBy: "operator-abc",
        decidedAt: "2026-04-30T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
