// SP10A — Injected per-asset cost estimator contract.
//
// MERGE-BACK: replace with Switchboard cost estimator (ad-optimizer team owns
// the production cost model — FX rates, volume tiers, contract pricing).
//
// Shape rationale:
//   - provider AND model — cost varies by tier (e.g. Sora-1.0 vs Sora-Pro).
//   - shotType / outputIntent — typed as plain string (not enums) so
//     merge-back can plug in any Switchboard provider naming without
//     re-versioning the SP10A contract.
//   - durationSec / tokenCount — optional; the estimator decides how to
//     fold them in (or ignore them).
//   - currency: "USD" — single-currency by design. Multi-currency is a
//     future PCD_COST_FORECAST_VERSION bump.
//   - estimatorVersion — orthogonal to PCD_COST_FORECAST_VERSION; tags the
//     cost MODEL (not the schema). Lets mixed-version analytics work.
export type CostEstimatorInput = {
  provider: string;
  model: string;
  shotType: string;
  outputIntent: string;
  durationSec?: number;
  tokenCount?: number;
};

export type CostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  lineItems: Array<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CostEstimator = {
  estimate(input: CostEstimatorInput): Promise<CostEstimatorOutput>;
};
