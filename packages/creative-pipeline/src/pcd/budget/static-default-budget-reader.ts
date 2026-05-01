// MERGE-BACK: replace with Switchboard org-budget reader (production reads
// per-organization defaults with brief-level overrides from OrganizationBudget).
// Stub is deterministic for tests + local development. DO NOT add config flags
// or environment-driven fan-in — the swap is by injection, not by feature flag.
import type { PreproductionTreeBudget } from "@creativeagent/schemas";
import type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";

export const STATIC_DEFAULT_BUDGET_READER_VERSION = "static-default-budget-reader@1.0.0";

// Loud-stub values — SP8-stub fanout (2→4→12→24, max-fanout=3, total=42)
// passes this budget. Production wiring at merge-back swaps in a per-org reader.
export const STATIC_DEFAULT_BUDGET: PreproductionTreeBudget = Object.freeze({
  maxBranchFanout: 5,
  maxTreeSize: 50,
  maxEstimatedUsd: null,
});

export class StaticDefaultBudgetReader implements Sp10bBudgetReader {
  async resolveBudget(_input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null> {
    return STATIC_DEFAULT_BUDGET;
  }
}
