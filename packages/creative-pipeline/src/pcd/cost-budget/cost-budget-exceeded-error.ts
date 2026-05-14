// SP10C — Thrown when the coarse cost estimate exceeds budget.maxEstimatedUsd.
// Carries the full CostBudgetMeta for operator forensics — symmetric with
// the success-path outcome.costMeta so dashboard renders the same fields
// either way.
//
// MERGE-BACK: surface CostBudgetExceededError to dashboard with retry-with-
// raised-budget UI alongside SP10B's TreeBudgetExceededError UI.
import type { CostBudgetMeta } from "@creativeagent/schemas";

export class CostBudgetExceededError extends Error {
  readonly meta: CostBudgetMeta;

  constructor(args: { meta: CostBudgetMeta }) {
    super(
      `cost budget exceeded: estimated $${args.meta.estimatedUsd.toFixed(2)} > threshold $${args.meta.threshold.toFixed(2)}`,
    );
    this.name = "CostBudgetExceededError";
    this.meta = args.meta;
  }
}
