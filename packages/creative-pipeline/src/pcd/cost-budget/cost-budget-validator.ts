// SP10C — Pure synchronous validator. Compares the coarse cost estimate
// against the budget threshold and assembles a CostBudgetMeta forensic
// record. Strict > semantics — estimate === threshold passes.
//
// Sole import site for PCD_COST_BUDGET_VERSION (composer-only pinning lock,
// sp10c-anti-patterns test #1 enforces). Returns a structured result so the
// orchestrator decides whether to throw — same precedent as SP10B's
// validateTreeShapeAgainstBudget.
import type { CostBudgetMeta } from "@creativeagent/schemas";
import type { CoarseCostEstimatorOutput } from "./coarse-cost-estimator.js";
import { PCD_COST_BUDGET_VERSION } from "./cost-budget-version.js";

export type ValidateCostAgainstBudgetInput = {
  estimate: CoarseCostEstimatorOutput;
  threshold: number; // budget.maxEstimatedUsd — non-null by precondition (orchestrator gates the call)
  estimatedAt: string; // ISO timestamp captured at orchestrator level via stores.clock()
};

export type ValidateCostAgainstBudgetOutput =
  | { ok: true; meta: CostBudgetMeta }
  | { ok: false; meta: CostBudgetMeta };

export function validateCostAgainstBudget(
  input: ValidateCostAgainstBudgetInput,
): ValidateCostAgainstBudgetOutput {
  const meta: CostBudgetMeta = {
    costBudgetVersion: PCD_COST_BUDGET_VERSION,
    estimatorVersion: input.estimate.estimatorVersion,
    estimatedUsd: input.estimate.estimatedUsd,
    currency: input.estimate.currency,
    threshold: input.threshold,
    lineItems: input.estimate.lineItems,
    estimatedAt: input.estimatedAt,
  };
  return input.estimate.estimatedUsd > input.threshold ? { ok: false, meta } : { ok: true, meta };
}
