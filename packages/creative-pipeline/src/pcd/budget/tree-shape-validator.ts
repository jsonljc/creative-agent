// SP10B — Pure tree-shape validator. Sole import site for PCD_TREE_BUDGET_VERSION
// (composer-only pinning lock — sp10b-anti-patterns test #1 enforces).
//
// Validation priority lock: maxTreeSize is checked FIRST; maxBranchFanout SECOND.
// If both dimensions are exceeded, the reason is always "max_tree_size_exceeded".
// Anti-pattern test #9 enforces source-level ordering (the literal
// "observedTreeSize > budget.maxTreeSize" appears before any reference to
// "budget.maxBranchFanout"). DO NOT reorder these checks.

import type { PcdPreproductionChainResult, PreproductionTreeBudget } from "@creativeagent/schemas";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
import type { FanoutLevelObservation, TreeShapeMeta } from "./tree-budget-exceeded-error.js";

// Re-export types for convenience — callers can import from either file.
export type { FanoutLevelObservation, TreeShapeMeta } from "./tree-budget-exceeded-error.js";

export type ValidateTreeShapeInput = {
  result: PcdPreproductionChainResult;
  budget: PreproductionTreeBudget;
};

export type ValidateTreeShapeOutput =
  | {
      ok: true;
      meta: TreeShapeMeta;
    }
  | {
      ok: false;
      reason: "max_tree_size_exceeded" | "max_branch_fanout_exceeded";
      violations: readonly FanoutLevelObservation[];
      meta: TreeShapeMeta;
    };

export function validateTreeShapeAgainstBudget(
  input: ValidateTreeShapeInput,
): ValidateTreeShapeOutput {
  const { result, budget } = input;
  const { trends, motivators, hooks, scripts } = result.stageOutputs;

  const perStageCounts = {
    trends: trends.signals.length,
    motivators: motivators.motivators.length,
    hooks: hooks.hooks.length,
    scripts: scripts.scripts.length,
  };
  const observedTreeSize =
    perStageCounts.trends +
    perStageCounts.motivators +
    perStageCounts.hooks +
    perStageCounts.scripts;

  const motivatorsPerTrend = topFanout(motivators.motivators, (m) => m.parentTrendId);
  const hooksPerMotivator = topFanout(hooks.hooks, (h) => h.parentMotivatorId);
  const scriptsPerHook = topFanout(scripts.scripts, (s) => s.parentHookId);

  // Stable insertion order. JS Array.prototype.sort is stable as of ES2019,
  // so equal-fanout entries preserve their declared order:
  // motivators_per_trend → hooks_per_motivator → scripts_per_hook.
  const fanoutLevels: FanoutLevelObservation[] = [
    {
      level: "motivators_per_trend",
      parentId: motivatorsPerTrend.parentId,
      fanout: motivatorsPerTrend.fanout,
    },
    {
      level: "hooks_per_motivator",
      parentId: hooksPerMotivator.parentId,
      fanout: hooksPerMotivator.fanout,
    },
    {
      level: "scripts_per_hook",
      parentId: scriptsPerHook.parentId,
      fanout: scriptsPerHook.fanout,
    },
  ].sort((a, b) => b.fanout - a.fanout);

  const observedMaxBranchFanout = fanoutLevels[0].fanout;

  const meta: TreeShapeMeta = {
    treeBudgetVersion: PCD_TREE_BUDGET_VERSION,
    observedTreeSize,
    observedMaxBranchFanout,
    perStageCounts,
    fanoutLevels,
  };

  // Validation priority lock: tree size FIRST, branch fanout SECOND.
  // If both are exceeded, reason is always "max_tree_size_exceeded".
  if (observedTreeSize > budget.maxTreeSize) {
    return { ok: false, reason: "max_tree_size_exceeded", violations: [], meta };
  }

  // Then branch fanout.
  const violations = fanoutLevels.filter((f) => f.fanout > budget.maxBranchFanout);
  if (violations.length > 0) {
    return { ok: false, reason: "max_branch_fanout_exceeded", violations, meta };
  }

  return { ok: true, meta };
}

// Internal helper. Returns the parent id with the highest child count, plus
// that count. Empty arrays return { parentId: "", fanout: 0 } — not reachable
// in SP10B because SP7 schemas enforce min-1 length per stage, but defensive.
// Ties broken by first-seen parentId (deterministic by Map iteration order).
function topFanout<T>(
  xs: readonly T[],
  key: (x: T) => string,
): { parentId: string; fanout: number } {
  const counts = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let topParent = "";
  let topCount = 0;
  for (const [parent, count] of counts) {
    if (count > topCount) {
      topParent = parent;
      topCount = count;
    }
  }
  return { parentId: topParent, fanout: topCount };
}
