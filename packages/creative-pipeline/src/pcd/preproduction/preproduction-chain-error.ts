import type { PreproductionChainStage } from "@creativeagent/schemas";

// SP7 — wraps stage-runner / production-gate runtime failures with a stage
// discriminant. Pre-stage errors (zod, ConsentRevokedRefusalError,
// InvariantViolationError) propagate raw and are NOT wrapped.
export class PreproductionChainError extends Error {
  readonly name = "PreproductionChainError";
  readonly stage: PreproductionChainStage;
  declare readonly cause: unknown;

  constructor(args: { stage: PreproductionChainStage; cause: unknown }) {
    super(`Preproduction chain failed at stage ${args.stage}`);
    this.stage = args.stage;
    Object.defineProperty(this, "cause", {
      value: args.cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
