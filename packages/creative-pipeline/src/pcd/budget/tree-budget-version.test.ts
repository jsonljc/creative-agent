import { describe, expect, it } from "vitest";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";

describe("PCD_TREE_BUDGET_VERSION", () => {
  it("equals the exact pinned literal", () => {
    expect(PCD_TREE_BUDGET_VERSION).toBe("pcd-tree-budget@1.0.0");
  });
});
