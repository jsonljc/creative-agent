import { z } from "zod";
import {
  type PcdSp10CostForecastReason,
  PcdSp10CostForecastReasonSchema,
} from "@creativeagent/schemas";
import type { CostEstimator, CostEstimatorInput } from "./cost-estimator.js";
import { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";

/**
 * SP10A — Pure store-injected stamper. Calls the injected CostEstimator
 * once per asset, pins PCD_COST_FORECAST_VERSION from import (composer-only
 * pinning lock), and returns the forensic record for the SP10A orchestrator's
 * persistence path.
 *
 * FORECAST-ONLY: this function does NOT mutate selection, prune branches,
 * or compare estimatedUsd against any threshold. sp10a-anti-patterns.test.ts
 * enforces structurally. Budget enforcement is SP10B's domain.
 */
export type StampPcdCostForecastInput = CostEstimatorInput;

export type StampPcdCostForecastStores = {
  costEstimator: CostEstimator;
  clock?: () => Date;
};

const StampPcdCostForecastInputSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  shotType: z.string().min(1),
  outputIntent: z.string().min(1),
  durationSec: z.number().nonnegative().optional(),
  tokenCount: z.number().nonnegative().optional(),
});

export async function stampPcdCostForecast(
  input: StampPcdCostForecastInput,
  stores: StampPcdCostForecastStores,
): Promise<PcdSp10CostForecastReason> {
  // Step 1 — defense-in-depth zod parse on the input.
  StampPcdCostForecastInputSchema.parse(input);

  // Step 2 — call injected estimator. Errors propagate raw.
  const estimate = await stores.costEstimator.estimate(input);

  // MERGE-BACK: emit WorkTrace here (estimator returned)

  // Step 3 — assemble forensic record. costForecastVersion is pinned from
  // import (SP10A composer-only pinning lock). estimatorVersion is carried
  // from the estimator's return (orthogonal — see cost-estimator.ts comment).
  // estimatedAt from clock() at assembly time (after the estimator returns).
  // For a slow real estimator, this captures the moment of forecast assembly,
  // not the original request. That is the intended semantic for forensic stamping.
  const estimatedAt = (stores.clock?.() ?? new Date()).toISOString();
  const reason: PcdSp10CostForecastReason = {
    estimatedUsd: estimate.estimatedUsd,
    currency: estimate.currency,
    lineItems: estimate.lineItems,
    costForecastVersion: PCD_COST_FORECAST_VERSION,
    estimatorVersion: estimate.estimatorVersion,
    estimatedAt,
  };

  // Step 4 — defense-in-depth zod parse on the assembled record.
  // Catches malformed estimator output before persistence.
  PcdSp10CostForecastReasonSchema.parse(reason);

  // MERGE-BACK: emit WorkTrace here (cost forecast assembled)

  return reason;
}
