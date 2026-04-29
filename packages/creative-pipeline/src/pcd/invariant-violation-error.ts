/**
 * Thrown when invariant state is violated — a row that should always exist is
 * missing, a stamped tier is out of range, etc. Two construction shapes are
 * supported via overload:
 *
 *   new InvariantViolationError("reason", { ...context })   // SP6+ generic
 *   new InvariantViolationError(jobId, fieldName)            // SP3/SP4 legacy
 *
 * Both forms populate `message` and `context`. The legacy form is preserved
 * so existing call sites in registry-resolver.ts do not change behavior.
 * New SP6+ call sites should use the generic form.
 */
export class InvariantViolationError extends Error {
  readonly name = "InvariantViolationError";
  readonly context: Readonly<Record<string, unknown>>;

  constructor(reason: string, context?: Record<string, unknown>);
  constructor(jobId: string, fieldName: string);
  constructor(arg1: string, arg2?: string | Record<string, unknown>) {
    if (typeof arg2 === "string") {
      // Legacy (jobId, fieldName) form — preserve a useful message for the
      // existing registry-resolver call sites.
      super(`InvariantViolationError: job "${arg1}" — field "${arg2}" is NULL or invalid`);
      this.context = Object.freeze({ jobId: arg1, fieldName: arg2 });
    } else {
      // Generic (reason, context?) form
      super(arg1);
      this.context = Object.freeze({ ...(arg2 ?? {}) });
    }
    Object.setPrototypeOf(this, InvariantViolationError.prototype);
  }
}
