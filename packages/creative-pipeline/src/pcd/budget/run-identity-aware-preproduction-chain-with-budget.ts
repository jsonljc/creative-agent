// SP10B — Production callsite that wraps SP7's chain with a tree-budget gate.
//
// Returns RunPreproductionChainWithBudgetOutcome { result, budgetMeta } so callers
// get computed tree shape on the success path without re-walking the tree (Q16).
//
// Calls budgetReader.resolveBudget(); if null, returns { result, budgetMeta: null }
// (gated bypass). If non-null and maxEstimatedUsd is non-null, throws
// InvariantViolationError (SP10C-bleed protection — SP10B is count-only).
// Otherwise runs SP7's chain to completion, then validates tree shape against budget.
// Throws TreeBudgetExceededError on violation; returns the wrapped outcome on pass.
//
// MERGE-BACK: dashboard surfaces TreeBudgetExceededError with retry-with-raised-budget UI.

import type { PcdBriefInput, PcdPreproductionChainResult } from "@creativeagent/schemas";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "../preproduction/preproduction-chain.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type { Sp10bBudgetReader } from "./sp10b-budget-reader.js";
import { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
import { validateTreeShapeAgainstBudget, type TreeShapeMeta } from "./tree-shape-validator.js";

export type RunIdentityAwarePreproductionChainWithBudgetStores = PreproductionChainStores & {
  budgetReader: Sp10bBudgetReader;
  organizationId?: string | null;
};

export type RunPreproductionChainWithBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when reader returned null (gated bypass); populated otherwise.
  budgetMeta: TreeShapeMeta | null;
};

export async function runIdentityAwarePreproductionChainWithBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithBudgetStores,
): Promise<RunPreproductionChainWithBudgetOutcome> {
  // 1. Resolve budget. Reader throws → propagated raw.
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved — value or null)

  // 2. SP10C-bleed protection: SP10B is count-only.
  if (budget !== null && budget.maxEstimatedUsd !== null) {
    // MERGE-BACK: SP10C will populate budget.maxEstimatedUsd; SP10B asserts null here.
    throw new InvariantViolationError(
      "maxEstimatedUsd is reserved for SP10C; SP10B is count-only",
      { budget },
    );
  }

  // 3. Run SP7 chain to completion. Errors propagated raw.
  const result = await runIdentityAwarePreproductionChain(brief, stores);

  // 4. Skip gate if no budget configured (legacy / pre-rollout paths).
  if (budget === null) {
    // MERGE-BACK: emit WorkTrace here (budget gate skipped — gated bypass)
    return { result, budgetMeta: null };
  }

  // 5. Validate tree shape against budget.
  const validation = validateTreeShapeAgainstBudget({ result, budget });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (budget gate passed)
    return { result, budgetMeta: validation.meta };
  }

  // 6. Throw on violation.
  // MERGE-BACK: emit WorkTrace here (budget gate violated)
  throw new TreeBudgetExceededError({
    reason: validation.reason,
    budget,
    violations: validation.violations,
    meta: validation.meta,
  });
}
