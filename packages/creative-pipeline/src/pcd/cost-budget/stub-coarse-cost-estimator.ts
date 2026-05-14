// SP10C — Deterministic stub coarse cost estimator. Local default for tests
// and pre-merge-back development.
//
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). Stub is deterministic for tests + local
// development. DO NOT add config flags or environment-driven fan-in — the swap
// is by injection, not by feature flag.
import type {
  CoarseCostEstimator,
  CoarseCostEstimatorInput,
  CoarseCostEstimatorOutput,
} from "./coarse-cost-estimator.js";

export const STUB_COARSE_COST_ESTIMATOR_VERSION = "stub-coarse-cost-estimator@1.0.0";

// Loud-stub value. NOT a Switchboard-pricing claim. Real per-tier × per-shot-type
// pricing lives in the merge-back-time Switchboard ad-optimizer implementer.
const STUB_USD_PER_SCRIPT = 1.5;

export class StubCoarseCostEstimator implements CoarseCostEstimator {
  async estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput> {
    const estimatedUsd = input.scriptCount * STUB_USD_PER_SCRIPT;
    return {
      estimatedUsd,
      currency: "USD",
      lineItems: [
        {
          label: `${input.scriptCount} × $${STUB_USD_PER_SCRIPT.toFixed(2)} per-script (stub)`,
          estimatedUsd,
        },
      ],
      estimatorVersion: STUB_COARSE_COST_ESTIMATOR_VERSION,
    };
  }
}
