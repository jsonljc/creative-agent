export { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
export { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
export { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";
export { PreproductionChainError } from "./preproduction-chain-error.js";
export { deepFreeze } from "./deep-freeze.js";
export type { Sp7ProductRegistryReader, Sp7CreatorRegistryReader } from "./sp7-readers.js";

export {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";

export {
  AutoApproveAllScriptsGate,
  type ProductionFanoutGate,
  type RequestSelectionInput,
} from "./production-fanout-gate.js";

export {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "./preproduction-chain.js";

// Stage-runner interfaces
export type { TrendsStageRunner } from "./stages/trends-stage-runner.js";
export type { MotivatorsStageRunner } from "./stages/motivators-stage-runner.js";
export type { HooksStageRunner } from "./stages/hooks-stage-runner.js";
export type { CreatorScriptsStageRunner } from "./stages/creator-scripts-stage-runner.js";

// Stub stage-runner implementers
export { StubTrendsStageRunner } from "./stages/stub-trends-stage-runner.js";
export { StubMotivatorsStageRunner } from "./stages/stub-motivators-stage-runner.js";
export { StubHooksStageRunner } from "./stages/stub-hooks-stage-runner.js";
export { StubCreatorScriptsStageRunner } from "./stages/stub-creator-scripts-stage-runner.js";

// Stub stage-runner fanout constants (SP8). Exposed for tests + future
// SP10 tree-budget enforcement.
export { STUB_TRENDS_FANOUT } from "./stages/stub-trends-stage-runner.js";
export { STUB_MOTIVATORS_PER_TREND } from "./stages/stub-motivators-stage-runner.js";
export { STUB_HOOKS_PER_MOTIVATOR } from "./stages/stub-hooks-stage-runner.js";
export { STUB_SCRIPTS_PER_HOOK } from "./stages/stub-creator-scripts-stage-runner.js";
