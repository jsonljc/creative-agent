import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import type {
  CreatorScript,
  PcdIdentityContext,
  PcdProductionFanoutDecision,
} from "@creativeagent/schemas";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";

export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision>;
}

// MERGE-BACK: replace AutoApproveOnlyScriptGate with Switchboard Inngest waitForEvent + dashboard UI.
export class AutoApproveOnlyScriptGate implements ProductionFanoutGate {
  async requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision> {
    if (input.scripts.length !== 1) {
      throw new InvariantViolationError("AutoApproveOnlyScriptGate requires exactly one script", {
        scriptsLength: input.scripts.length,
      });
    }
    const script = input.scripts[0]!;
    const sortedIds = [script.id].slice().sort();
    return {
      briefId: input.briefId,
      creatorIdentityId: input.identityContext.creatorIdentityId,
      productIdentityId: input.identityContext.productIdentityId,
      consentRecordId: input.identityContext.consentRecordId,
      effectiveTier: input.identityContext.effectiveTier,
      selectedScriptIds: sortedIds,
      availableScriptIds: sortedIds,
      preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
      identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
      decidedAt: input.clock().toISOString(),
      decidedBy: null,
      costForecast: null,
    };
  }
}
