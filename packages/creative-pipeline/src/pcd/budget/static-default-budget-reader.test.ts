import { describe, expect, it } from "vitest";
import {
  STATIC_DEFAULT_BUDGET,
  STATIC_DEFAULT_BUDGET_READER_VERSION,
  StaticDefaultBudgetReader,
} from "./static-default-budget-reader.js";

describe("StaticDefaultBudgetReader", () => {
  it("returns the STATIC_DEFAULT_BUDGET unchanged for any input", async () => {
    const reader = new StaticDefaultBudgetReader();
    const result = await reader.resolveBudget({ briefId: "any", organizationId: null });
    expect(result).toBe(STATIC_DEFAULT_BUDGET);
  });

  it("ignores briefId and organizationId (loud-stub posture)", async () => {
    const reader = new StaticDefaultBudgetReader();
    const a = await reader.resolveBudget({ briefId: "brief-a", organizationId: "org-1" });
    const b = await reader.resolveBudget({ briefId: "brief-b", organizationId: "org-2" });
    expect(a).toBe(b);
  });

  it("returns a non-null budget always (rolls out enforcement by default)", async () => {
    const reader = new StaticDefaultBudgetReader();
    const result = await reader.resolveBudget({ briefId: "x", organizationId: null });
    expect(result).not.toBeNull();
  });

  it("STATIC_DEFAULT_BUDGET has the expected three-field shape", () => {
    expect(STATIC_DEFAULT_BUDGET).toEqual({
      maxBranchFanout: 5,
      maxTreeSize: 50,
      maxEstimatedUsd: null,
    });
  });

  it("STATIC_DEFAULT_BUDGET_READER_VERSION equals the exact pinned literal", () => {
    expect(STATIC_DEFAULT_BUDGET_READER_VERSION).toBe("static-default-budget-reader@1.0.0");
  });
});
