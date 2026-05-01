import type { CostEstimator, CostEstimatorInput, CostEstimatorOutput } from "./cost-estimator.js";

// MERGE-BACK: real Switchboard cost estimator replaces this in production.
// Stub is deterministic for tests + local development. DO NOT add config
// flags or environment-driven fan-in — the swap is by injection, not by
// feature flag (matches SP8 AutoApproveAllScriptsGate precedent).
export const STUB_COST_ESTIMATOR_VERSION = "stub-cost-estimator@1.0.0";

// Per-provider×model base price (USD). Numbers are synthetic — not based on
// real billing. Picked to give visible spread for tests so determinism + scaling
// assertions can verify shape, not absolute correctness.
const PROVIDER_MODEL_BASE_USD: Record<string, number> = {
  "sora|sora-1.0": 0.4,
  "sora|sora-pro": 0.9,
  "veo|veo-2.0": 0.3,
  "runway|gen-3": 0.5,
  "kling|kling-1.6": 0.25,
  "heygen|avatar-3": 0.6,
};

const DEFAULT_BASE_USD = 0.5;
const PER_SECOND_USD = 0.05;
const PER_THOUSAND_TOKENS_USD = 0.02;

export class StubCostEstimator implements CostEstimator {
  async estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput> {
    const key = `${input.provider}|${input.model}`;
    const base = PROVIDER_MODEL_BASE_USD[key] ?? DEFAULT_BASE_USD;
    // Callers are expected to pass non-negative durationSec / tokenCount.
    // Negative values produce negative charges; schema validation upstream
    // (PcdSp10CostForecastReasonSchema.nonnegative) will catch them there.
    const durationCharge = input.durationSec !== undefined ? input.durationSec * PER_SECOND_USD : 0;
    const tokenCharge =
      input.tokenCount !== undefined ? (input.tokenCount / 1000) * PER_THOUSAND_TOKENS_USD : 0;

    const lineItems: Array<{ label: string; estimatedUsd: number }> = [
      { label: `${input.provider}-${input.model}-base`, estimatedUsd: base },
    ];
    if (durationCharge > 0) {
      lineItems.push({ label: "duration-seconds", estimatedUsd: durationCharge });
    }
    if (tokenCharge > 0) {
      lineItems.push({ label: "token-thousands", estimatedUsd: tokenCharge });
    }

    const estimatedUsd = lineItems.reduce((acc, it) => acc + it.estimatedUsd, 0);

    return {
      estimatedUsd,
      currency: "USD",
      lineItems,
      estimatorVersion: STUB_COST_ESTIMATOR_VERSION,
    };
  }
}
