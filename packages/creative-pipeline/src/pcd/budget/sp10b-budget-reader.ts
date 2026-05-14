// SP10B — Budget reader contract. Production implementer at merge-back fetches
// per-organization defaults with brief-level overrides from a Switchboard-side
// OrganizationBudget table. SP10B ships only the contract + a deterministic stub
// (StaticDefaultBudgetReader, see static-default-budget-reader.ts).
//
// Returns null = "no budget configured" (orchestrator falls through to the
// chain without enforcement). Returns non-null = "enforce this budget."
import type { PreproductionTreeBudget } from "@creativeagent/schemas";

export type Sp10bBudgetReaderInput = {
  briefId: string;
  organizationId: string | null;
};

export type Sp10bBudgetReader = {
  resolveBudget(input: Sp10bBudgetReaderInput): Promise<PreproductionTreeBudget | null>;
};
