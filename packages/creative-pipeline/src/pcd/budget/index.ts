// SP10B — Tree-budget enforcement public surface.
export { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";
export {
  TreeBudgetExceededError,
  type FanoutLevelObservation,
  type TreeShapeMeta,
} from "./tree-budget-exceeded-error.js";
export type { Sp10bBudgetReader, Sp10bBudgetReaderInput } from "./sp10b-budget-reader.js";
export {
  StaticDefaultBudgetReader,
  STATIC_DEFAULT_BUDGET_READER_VERSION,
  STATIC_DEFAULT_BUDGET,
} from "./static-default-budget-reader.js";
export {
  validateTreeShapeAgainstBudget,
  type ValidateTreeShapeInput,
  type ValidateTreeShapeOutput,
} from "./tree-shape-validator.js";
export {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
  type RunPreproductionChainWithBudgetOutcome,
} from "./run-identity-aware-preproduction-chain-with-budget.js";
