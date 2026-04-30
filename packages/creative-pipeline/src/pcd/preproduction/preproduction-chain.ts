import {
  ProductionFanoutGateOperatorDecisionSchema,
  type CreatorScriptsStageOutput,
  type HooksStageOutput,
  type MotivatorsStageOutput,
  type PcdBriefInput,
  type PcdPreproductionChainResult,
  type PcdProductionFanoutDecision,
  type PreproductionChainStage,
  type TrendStageOutput,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
// MERGE-BACK: include all four pinned versions (chain, identity-context, approval-lifecycle, fanout) in WorkTrace decision payload.
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";
import {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
import type { ProductionFanoutGate } from "./production-fanout-gate.js";
import type { TrendsStageRunner } from "./stages/trends-stage-runner.js";
import type { MotivatorsStageRunner } from "./stages/motivators-stage-runner.js";
import type { HooksStageRunner } from "./stages/hooks-stage-runner.js";
import type { CreatorScriptsStageRunner } from "./stages/creator-scripts-stage-runner.js";

export type PreproductionChainStores = BuildPcdIdentityContextStores & {
  trendsRunner: TrendsStageRunner;
  motivatorsRunner: MotivatorsStageRunner;
  hooksRunner: HooksStageRunner;
  creatorScriptsRunner: CreatorScriptsStageRunner;
  productionFanoutGate: ProductionFanoutGate;
  clock?: () => Date;
};

async function runStageWrapped<T>(
  stage: PreproductionChainStage,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new PreproductionChainError({ stage, cause: err });
  }
}

export async function runIdentityAwarePreproductionChain(
  brief: PcdBriefInput,
  stores: PreproductionChainStores,
): Promise<PcdPreproductionChainResult> {
  // 1. Build identity context — pre-stage errors propagate raw.
  const identityContext = await buildPcdIdentityContext(brief, stores);

  const clock = stores.clock ?? (() => new Date());

  // 2. Trends.
  const trends: TrendStageOutput = await runStageWrapped("trends", () =>
    stores.trendsRunner.run(brief, identityContext),
  );
  // MERGE-BACK: emit WorkTrace here after trends stage returns.

  // 3. Motivators.
  const motivators: MotivatorsStageOutput = await runStageWrapped("motivators", () =>
    stores.motivatorsRunner.run(brief, identityContext, trends),
  );
  // MERGE-BACK: emit WorkTrace here after motivators stage returns.

  // 4. Hooks.
  const hooks: HooksStageOutput = await runStageWrapped("hooks", () =>
    stores.hooksRunner.run(brief, identityContext, trends, motivators),
  );
  // MERGE-BACK: emit WorkTrace here after hooks stage returns.

  // 5. Creator scripts.
  const scripts: CreatorScriptsStageOutput = await runStageWrapped("creator_scripts", () =>
    stores.creatorScriptsRunner.run(brief, identityContext, trends, motivators, hooks),
  );
  // MERGE-BACK: emit WorkTrace here after creator scripts stage returns.

  // 6. Production fanout gate. Composer literally calls
  //    productionFanoutGate.requestSelection(...) — anti-pattern test enforces.
  //    Composer parses gate output via ProductionFanoutGateOperatorDecisionSchema.parse
  //    to defend against malformed merge-back Inngest payload.
  //    Composer asserts selectedScriptIds ⊆ availableScriptIds.
  const operatorDecision = await runStageWrapped("production_fanout_gate", async () => {
    const raw = await stores.productionFanoutGate.requestSelection({
      scripts: scripts.scripts,
      identityContext,
      briefId: brief.briefId,
      clock,
    });
    const parsed = ProductionFanoutGateOperatorDecisionSchema.parse(raw);
    const availableSet = new Set(scripts.scripts.map((s) => s.id));
    for (const id of parsed.selectedScriptIds) {
      if (!availableSet.has(id)) {
        throw new InvariantViolationError("gate selected unknown script id", {
          scriptId: id,
        });
      }
    }
    return parsed;
  });
  // MERGE-BACK: emit WorkTrace here at production fanout gate decision.

  // 7. Composer assembles PcdProductionFanoutDecision — pins versions, identity carry-through.
  const availableScriptIds = scripts.scripts
    .map((s) => s.id)
    .slice()
    .sort();
  const selectedScriptIds = [...operatorDecision.selectedScriptIds].sort();

  const decision: PcdProductionFanoutDecision = {
    briefId: brief.briefId,
    creatorIdentityId: identityContext.creatorIdentityId,
    productIdentityId: identityContext.productIdentityId,
    consentRecordId: identityContext.consentRecordId,
    effectiveTier: identityContext.effectiveTier,
    selectedScriptIds,
    availableScriptIds,
    preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
    identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    preproductionFanoutVersion: PCD_PREPRODUCTION_FANOUT_VERSION,
    decidedAt: operatorDecision.decidedAt,
    decidedBy: operatorDecision.decidedBy,
    decisionNote: null,
    costForecast: null,
  };

  // MERGE-BACK: wire UGC production handoff here.
  return {
    decision,
    stageOutputs: { trends, motivators, hooks, scripts },
  };
}
