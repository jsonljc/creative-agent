import { describe, expect, it } from "vitest";
import { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";

describe("PCD_COST_BUDGET_VERSION", () => {
  it("equals the exact pinned literal", () => {
    expect(PCD_COST_BUDGET_VERSION).toBe("pcd-cost-budget@1.0.0");
  });
});
