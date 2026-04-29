import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdPreproductionChainResult,
  PreproductionChainStage,
  TrendStageOutput,
} from "@creativeagent/schemas";
import {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload.
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
  const decision = await runStageWrapped("production_fanout_gate", () =>
    stores.productionFanoutGate.requestSelection({
      scripts: scripts.scripts,
      identityContext,
      briefId: brief.briefId,
      clock,
    }),
  );
  // MERGE-BACK: emit WorkTrace here at production fanout gate decision.

  // MERGE-BACK: wire UGC production handoff here.
  return {
    decision,
    stageOutputs: { trends, motivators, hooks, scripts },
  };
}
