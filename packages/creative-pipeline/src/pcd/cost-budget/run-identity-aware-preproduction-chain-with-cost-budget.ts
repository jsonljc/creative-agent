// SP10C — Production callsite that wraps SP10B's count-gated chain with a
// post-chain coarse cost-budget gate.
//
// Returns RunPreproductionChainWithCostBudgetOutcome { result, budgetMeta, costMeta }
// so callers get computed tree shape + cost on the success path without
// re-walking the tree or re-calling the estimator (design Q16).
//
// Composition order (one entry per inline `Step N` comment in the body):
//   1. buildPcdIdentityContext (for estimator input)
//   2. budgetReader.resolveBudget (top-level, full budget including maxEstimatedUsd)
//   3. null budget → bypass SP10C entirely (run SP7 chain directly, return all null meta)
//   4. SP10B (count gate) called with stripMaxUsdReader wrapper (maxEstimatedUsd: null)
//      to preserve SP10B's load-bearing count-only invariant.
//   5. maxEstimatedUsd null → cost gate skipped, return {result, budgetMeta, costMeta: null}
//   6. coarseCostEstimator.estimate → defense-in-depth zod parse
//   7. validateCostAgainstBudget → assemble CostBudgetMeta; ok-path returns outcome
//   8. validation fail → throw CostBudgetExceededError (carries meta)
//
// MERGE-BACK: dashboard surfaces CostBudgetExceededError with retry-with-raised-
// budget UI alongside SP10B's TreeBudgetExceededError UI.

import type {
  CostBudgetMeta,
  PcdBriefInput,
  PcdPreproductionChainResult,
} from "@creativeagent/schemas";
import { CoarseCostEstimatorOutputSchema } from "@creativeagent/schemas";
import { buildPcdIdentityContext } from "../preproduction/build-pcd-identity-context.js";
import { runIdentityAwarePreproductionChain } from "../preproduction/preproduction-chain.js";
import {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "../budget/run-identity-aware-preproduction-chain-with-budget.js";
import type { Sp10bBudgetReader } from "../budget/sp10b-budget-reader.js";
import type { TreeShapeMeta } from "../budget/tree-shape-validator.js";
import type { CoarseCostEstimator } from "./coarse-cost-estimator.js";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
import { validateCostAgainstBudget } from "./cost-budget-validator.js";

export type RunIdentityAwarePreproductionChainWithCostBudgetStores =
  RunIdentityAwarePreproductionChainWithBudgetStores & {
    coarseCostEstimator: CoarseCostEstimator;
  };

export type RunPreproductionChainWithCostBudgetOutcome = {
  result: PcdPreproductionChainResult;
  // null when top-level budget was null (whole SP10C orchestrator bypassed).
  // Populated when SP10B ran (count gate succeeded).
  budgetMeta: TreeShapeMeta | null;
  // null when top-level budget was null OR budget.maxEstimatedUsd was null.
  // Populated when the cost gate ran and passed. (On cost-gate failure
  // CostBudgetExceededError is thrown; the error itself carries `meta: CostBudgetMeta`
  // for symmetric forensics.)
  costMeta: CostBudgetMeta | null;
};

export async function runIdentityAwarePreproductionChainWithCostBudget(
  brief: PcdBriefInput,
  stores: RunIdentityAwarePreproductionChainWithCostBudgetStores,
): Promise<RunPreproductionChainWithCostBudgetOutcome> {
  // Step 1 — Build identityContext at SP10C entry (for estimator). SP7 will
  // build it again internally; double-build accepted per design §0 risk #2.
  const identityContext = await buildPcdIdentityContext(brief, stores);

  // Step 2 — Resolve full budget at SP10C top level (including maxEstimatedUsd).
  const budget = await stores.budgetReader.resolveBudget({
    briefId: brief.briefId,
    organizationId: stores.organizationId ?? null,
  });
  // MERGE-BACK: emit WorkTrace here (budget resolved at SP10C top level)

  // Step 3 — Null-budget bypass: run SP7 chain directly without SP10B/SP10C gates.
  if (budget === null) {
    const result = await runIdentityAwarePreproductionChain(brief, stores);
    return { result, budgetMeta: null, costMeta: null };
  }

  // Step 4 — Wrap the reader so SP10B sees a count-only budget. Preserves
  // SP10B's load-bearing maxEstimatedUsd === null invariant structurally.
  const stripMaxUsdReader: Sp10bBudgetReader = {
    async resolveBudget(input) {
      const raw = await stores.budgetReader.resolveBudget(input);
      if (raw === null) return null;
      return { ...raw, maxEstimatedUsd: null };
    },
  };
  const sp10bStores: RunIdentityAwarePreproductionChainWithBudgetStores = {
    ...stores,
    budgetReader: stripMaxUsdReader,
  };
  const sp10bOutcome: RunPreproductionChainWithBudgetOutcome =
    await runIdentityAwarePreproductionChainWithBudget(brief, sp10bStores);
  // MERGE-BACK: emit WorkTrace here (count gate passed via SP10B)

  const { result, budgetMeta } = sp10bOutcome;

  // Step 5 — Cost gate skipped if maxEstimatedUsd is null.
  if (budget.maxEstimatedUsd === null) {
    // MERGE-BACK: emit WorkTrace here (cost gate skipped — maxEstimatedUsd null)
    return { result, budgetMeta, costMeta: null };
  }

  // Step 6 — Coarse cost estimator. Errors propagated raw.
  const scriptCount = result.stageOutputs.scripts.scripts.length;
  const rawEstimate = await stores.coarseCostEstimator.estimate({
    briefId: brief.briefId,
    identityContext,
    scriptCount,
  });
  // Defense-in-depth zod parse on the estimator output. Catches malformed
  // estimator implementations (e.g. non-USD currency, negative usd).
  const estimate = CoarseCostEstimatorOutputSchema.parse(rawEstimate);

  // Step 7 — Validator. Pure synchronous. Assembles meta with version pin.
  const estimatedAt = (stores.clock?.() ?? new Date()).toISOString();
  const validation = validateCostAgainstBudget({
    estimate,
    threshold: budget.maxEstimatedUsd,
    estimatedAt,
  });
  if (validation.ok === true) {
    // MERGE-BACK: emit WorkTrace here (cost gate passed)
    return { result, budgetMeta, costMeta: validation.meta };
  }

  // Step 8 — Throw on violation.
  // MERGE-BACK: emit WorkTrace here (cost gate violated)
  throw new CostBudgetExceededError({ meta: validation.meta });
}
