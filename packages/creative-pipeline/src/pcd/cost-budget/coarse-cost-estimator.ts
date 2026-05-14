// SP10C — Coarse pre-routing cost estimator contract.
//
// MERGE-BACK: replace with Switchboard ad-optimizer's coarse pre-routing estimator
// (production reads per-tier × per-allowed-shot-type pricing tables, FX rates,
// volume tiers, contract pricing). SP10C ships only the contract + a deterministic
// stub (StubCoarseCostEstimator, see stub-coarse-cost-estimator.ts).
//
// Shape rationale (see design Q1):
//   - briefId — forensic traceability and per-brief override pricing lookups.
//   - identityContext — carries tier projection (effectiveTier, productTierAtResolution,
//     creatorTierAtResolution), allowed shot/intent universe (allowedShotTypes,
//     allowedOutputIntents), UGC constraints, tier-3 rule flags. The estimator
//     uses these to compute a tier/intent-weighted worst-case-or-average estimate
//     over the provider-capability matrix.
//   - scriptCount — per-asset multiplier. From chainResult.stageOutputs.scripts.scripts.length.
//   - NOT in the contract:
//       provider/model (unknown at gate time — SP4 routing is downstream of fanout),
//       shotTypeMix/outputIntentMix (per-script shotType is not in CreatorScriptSchema;
//         identityContext.allowedShotTypes covers the universe),
//       organizationId (already encoded in the budget value via the reader).
//   - currency: "USD" — single-currency by design (§0 risk #10).
//   - estimatorVersion — orthogonal to PCD_COST_BUDGET_VERSION; tags the cost MODEL
//     (not the schema). Lets mixed-version analytics work. Same precedent as SP10A.
import type { PcdIdentityContext } from "@creativeagent/schemas";

export type CoarseCostEstimatorInput = {
  briefId: string;
  identityContext: PcdIdentityContext;
  scriptCount: number;
};

export type CoarseCostEstimatorOutput = {
  estimatedUsd: number;
  currency: "USD";
  // ReadonlyArray matches CoarseCostEstimatorOutputSchema's `.readonly()` shape
  // so the orchestrator's `CoarseCostEstimatorOutputSchema.parse()` result
  // assigns cleanly into this slot (no Array→ReadonlyArray narrowing error).
  lineItems: ReadonlyArray<{ label: string; estimatedUsd: number }>;
  estimatorVersion: string;
};

export type CoarseCostEstimator = {
  estimate(input: CoarseCostEstimatorInput): Promise<CoarseCostEstimatorOutput>;
};
