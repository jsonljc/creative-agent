import type {
  PcdQcAggregateStatus,
  PcdQcGateMode,
  PcdQcGateVerdict,
  PcdQcGateVerdicts,
} from "@creativeagent/schemas";

// warn_only lowers a fail to warn; never lowers skipped, never changes pass
// or warn. Mode lowering happens after the predicate returns and before
// aggregation. block mode never lowers anything.
export function applyPcdQcGateMode(
  verdict: PcdQcGateVerdict,
  mode: PcdQcGateMode,
): PcdQcGateVerdict {
  if (mode === "warn_only" && verdict.status === "fail") {
    return {
      ...verdict,
      status: "warn",
      reason: `${verdict.reason} (warn-only for this tier)`,
    };
  }
  return verdict;
}

// Aggregation rule (binding):
//   any fail            → "fail"
//   else any warn       → "warn"
//   else any pass       → "pass"
//   else (all skipped, or empty)   → "warn"
//
// The empty/all-skipped → "warn" rule is intentional. "warn" here means "QC
// was not conclusively pass" — NOT "a defect was detected." Consumers MUST
// interpret "warn" as "not conclusively QC-passed". Skipped or unevaluated
// gates must not become an implicit pass.
export function aggregatePcdQcGateVerdicts(
  verdicts: ReadonlyArray<PcdQcGateVerdict>,
): PcdQcGateVerdicts {
  let status: PcdQcAggregateStatus;
  if (verdicts.some((v) => v.status === "fail")) {
    status = "fail";
  } else if (verdicts.some((v) => v.status === "warn")) {
    status = "warn";
  } else if (verdicts.some((v) => v.status === "pass")) {
    status = "pass";
  } else {
    status = "warn";
  }
  return { gates: [...verdicts], aggregateStatus: status };
}
