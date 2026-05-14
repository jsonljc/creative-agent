// SP10B — Error class for tree-budget violations. Carries the validator's full
// output (reason + budget + violations + meta) for operator forensics. Symmetric
// with the success-path outcome.budgetMeta so try/catch consumers render the
// same per-stage breakdown as the happy path.
//
// MERGE-BACK: surface this error to dashboard with retry-with-raised-budget UI.
//             Switchboard's dashboard owns the operator-facing form; SP10B emits
//             enough context to drive it (perStageCounts, fanoutLevels, violations).

import type { PreproductionTreeBudget } from "@creativeagent/schemas";

// Per-fanout-level observed maximum. Used by both the validator (to report
// observed shape) and this error (to report which levels exceeded the budget).
// Lossless — neither path collapses information into a single string.
export type FanoutLevelObservation = {
  level: "motivators_per_trend" | "hooks_per_motivator" | "scripts_per_hook";
  parentId: string;
  fanout: number;
};

// Always-populated tree-shape facts. Surfaced on success AND failure paths so
// callers can render the breakdown without re-walking the tree.
export type TreeShapeMeta = {
  treeBudgetVersion: string;
  observedTreeSize: number;
  observedMaxBranchFanout: number;
  perStageCounts: {
    trends: number;
    motivators: number;
    hooks: number;
    scripts: number;
  };
  // All three fanout levels, sorted by fanout desc (ties broken by stable
  // level order: motivators_per_trend → hooks_per_motivator → scripts_per_hook).
  // Length always 3 (one entry per fanout level).
  fanoutLevels: readonly FanoutLevelObservation[];
};

export class TreeBudgetExceededError extends Error {
  readonly name = "TreeBudgetExceededError";
  readonly reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
  readonly budget: PreproductionTreeBudget;
  readonly violations: readonly FanoutLevelObservation[];
  readonly meta: TreeShapeMeta;

  constructor(args: {
    reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
    budget: PreproductionTreeBudget;
    violations: readonly FanoutLevelObservation[];
    meta: TreeShapeMeta;
  }) {
    super(`tree budget exceeded: ${args.reason}`);
    this.reason = args.reason;
    this.budget = args.budget;
    this.violations = args.violations;
    this.meta = args.meta;
    Object.setPrototypeOf(this, TreeBudgetExceededError.prototype);
  }
}
