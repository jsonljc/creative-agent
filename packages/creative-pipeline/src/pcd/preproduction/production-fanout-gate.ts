import type {
  CreatorScript,
  PcdIdentityContext,
  ProductionFanoutGateOperatorDecision,
} from "@creativeagent/schemas";

export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<ProductionFanoutGateOperatorDecision>;
}

// =============================================================================
// AutoApproveAllScriptsGate — TEST-ONLY / DEFAULT-LOCAL DEVELOPMENT IMPLEMENTER
// =============================================================================
// This gate auto-selects every available script. It is the in-tree default so
// the chain runs deterministically in tests and local dev.
//
// THIS IS NOT THE PRODUCT BEHAVIOR. Real production MUST replace this with a
// human-in-the-loop selection UX (Inngest waitForEvent → dashboard UI →
// operator-event payload populates selectedScriptIds + decidedBy + decidedAt).
// "Auto approve all 24 scripts" is a stub for plumbing, not a UX target.
//
// DO NOT use this class in production. DO NOT add config flags to "enable
// auto-approval in prod". The merge-back swap is by injection, not by flag.
// =============================================================================
// MERGE-BACK: replace AutoApproveAllScriptsGate with Switchboard Inngest waitForEvent + dashboard UI.
export class AutoApproveAllScriptsGate implements ProductionFanoutGate {
  async requestSelection(
    input: RequestSelectionInput,
  ): Promise<ProductionFanoutGateOperatorDecision> {
    const ids = input.scripts
      .map((s) => s.id)
      .slice()
      .sort();
    return {
      selectedScriptIds: ids,
      decidedBy: null,
      decidedAt: input.clock().toISOString(),
    };
  }
}
