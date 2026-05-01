import { describe, expect, it } from "vitest";
import {
  TreeBudgetExceededError,
  type FanoutLevelObservation,
  type TreeShapeMeta,
} from "./tree-budget-exceeded-error.js";

const sampleMeta: TreeShapeMeta = {
  treeBudgetVersion: "pcd-tree-budget@1.0.0",
  observedTreeSize: 60,
  observedMaxBranchFanout: 7,
  perStageCounts: { trends: 5, motivators: 10, hooks: 20, scripts: 25 },
  fanoutLevels: [
    { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
    { level: "hooks_per_motivator", parentId: "motivator-1", fanout: 4 },
    { level: "motivators_per_trend", parentId: "trend-1", fanout: 2 },
  ],
};
const sampleBudget = { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null };

describe("TreeBudgetExceededError", () => {
  it("constructs with reason, budget, violations, meta", () => {
    const violations: FanoutLevelObservation[] = [
      { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
    ];
    const err = new TreeBudgetExceededError({
      reason: "max_branch_fanout_exceeded",
      budget: sampleBudget,
      violations,
      meta: sampleMeta,
    });
    expect(err.reason).toBe("max_branch_fanout_exceeded");
    expect(err.budget).toBe(sampleBudget);
    expect(err.violations).toBe(violations);
    expect(err.meta).toBe(sampleMeta);
  });

  it("has name 'TreeBudgetExceededError'", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.name).toBe("TreeBudgetExceededError");
  });

  it("formats message with the reason", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.message).toBe("tree budget exceeded: max_tree_size_exceeded");
  });

  it("size violations carry empty violations array", () => {
    const err = new TreeBudgetExceededError({
      reason: "max_tree_size_exceeded",
      budget: sampleBudget,
      violations: [],
      meta: sampleMeta,
    });
    expect(err.violations).toHaveLength(0);
  });

  it("fanout violations can carry 1-3 entries (multi-level fail)", () => {
    const violations: FanoutLevelObservation[] = [
      { level: "scripts_per_hook", parentId: "hook-1", fanout: 7 },
      { level: "hooks_per_motivator", parentId: "motivator-1", fanout: 6 },
    ];
    const err = new TreeBudgetExceededError({
      reason: "max_branch_fanout_exceeded",
      budget: sampleBudget,
      violations,
      meta: sampleMeta,
    });
    expect(err.violations).toHaveLength(2);
    expect(err.violations[0].level).toBe("scripts_per_hook");
  });
});
