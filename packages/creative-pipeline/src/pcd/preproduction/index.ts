export { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
export { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
export { PreproductionChainError } from "./preproduction-chain-error.js";
export type { Sp7ProductRegistryReader, Sp7CreatorRegistryReader } from "./sp7-readers.js";

export {
  buildPcdIdentityContext,
  type BuildPcdIdentityContextStores,
} from "./build-pcd-identity-context.js";

export {
  AutoApproveOnlyScriptGate,
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
