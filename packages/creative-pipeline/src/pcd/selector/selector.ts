// PCD slice SP13 — pure deterministic synthetic-creator selector.
// Mirrors SP12 license-gate shape: typed input record, no I/O, no clock
// reads — caller supplies `now`, the roster snapshot, and the leases
// snapshot. Invoked at job-creation time per design spec §4 step 2-4.
//
// The selector composes SP12's licenseGate as a hard pre-filter: every
// compatible candidate is run through the gate; only allowed:true
// candidates survive. Survivors are ranked using SP12 pickStrongest
// semantics across their gate-returned licenses, with creatorIdentityId
// ASC as the final tie-break (SP13-vs-SP12: SP12 ties on license.id;
// SP13 picks among creators, so it ties on creatorIdentityId).
//
// SP13 left `metricsSnapshotVersion` as `z.null()` and `performanceOverlayApplied`
// as `z.literal(false)` — forward-declared reservation slots. SP20 widened the
// schema to `z.string().min(1).nullable()` and `z.boolean()` respectively, and
// this selector now populates them via `resolveMetricsVersion()` and the
// `input.performanceHistory !== undefined` check below.
// MERGE-BACK: Switchboard's composer should pull the roster + leases
// via Prisma readers before calling this pure function.
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
  CreatorPerformanceMetrics,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import { licenseGate, type LicenseGateDecision } from "../synthetic-creator/license-gate.js";
import type { RosterEntry } from "../synthetic-creator/seed.js";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

export type SelectSyntheticCreatorInput = {
  brief: CreativeBrief;
  now: Date;
  roster: readonly RosterEntry[];
  leases: readonly CreatorIdentityLicensePayload[];
  // SP20 — optional performance overlay; absent ⇒ SP13-equivalent decision.
  // The reader (Prisma or in-memory) supplies this Map; selector reads
  // metrics.metricsVersion through onto the decision (Guardrail C-2).
  // MERGE-BACK: Switchboard's composer always supplies this once runner
  // integration ships; optionality is a SP20-land-time accommodation.
  performanceHistory?: ReadonlyMap<string, CreatorPerformanceMetrics>;
};

export function selectSyntheticCreator(
  input: SelectSyntheticCreatorInput,
): SyntheticCreatorSelectionDecision {
  // Step 1 — compatible-set filter (hard exact-match on brief targets).
  const compatible = input.roster.filter((entry) => isCompatible(entry, input.brief));

  if (compatible.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_candidates",
      compatibleCandidateIds: [],
      blockedCandidateIds: [],
      selectorVersion: PCD_SELECTOR_VERSION,
    };
  }

  // Step 2 — per-candidate license gate. Keep only allowed:true.
  const candidateDecisions = compatible.map((entry) => ({
    entry,
    gate: licenseGate({
      creatorIdentityId: entry.creatorIdentity.id,
      clinicId: input.brief.clinicId,
      market: input.brief.market,
      treatmentClass: input.brief.treatmentClass,
      now: input.now,
      leases: input.leases,
    }),
  }));

  const allowedCandidates: AllowedCandidate[] = candidateDecisions.filter(isAllowed);
  const blockedCandidates: BlockedCandidate[] = candidateDecisions.filter(isBlocked);

  if (allowedCandidates.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_blocked_by_license",
      compatibleCandidateIds: compatible.map((e) => e.creatorIdentity.id),
      blockedCandidateIds: blockedCandidates.map((c) => c.entry.creatorIdentity.id),
      selectorVersion: PCD_SELECTOR_VERSION,
    };
  }

  // Step 3 — rank survivors. SP12 pickStrongest semantics applied across
  // candidates' gate-returned licenses; final tie on creatorIdentityId ASC.
  const ranked = [...allowedCandidates].sort((a, b) =>
    compareCandidates(a, b, input.performanceHistory),
  );
  const primary = ranked[0]!;
  const fallbacks = ranked.slice(1);

  // Step 4 — emit success decision. The type predicate above narrows
  // primary.gate to the allowed:true variant, so primary.gate.license and
  // primary.gate.isSoftExclusivityOverride are statically non-null. No
  // runtime narrowing aid needed (invariant #4: selector never throws).
  return {
    allowed: true,
    briefId: input.brief.briefId,
    selectedCreatorIdentityId: primary.entry.creatorIdentity.id,
    fallbackCreatorIdentityIds: fallbacks.map((c) => c.entry.creatorIdentity.id),
    selectedLicenseId: primary.gate.license.id,
    selectedLockType: primary.gate.license.lockType,
    isSoftExclusivityOverride: primary.gate.isSoftExclusivityOverride,
    selectorVersion: PCD_SELECTOR_VERSION,
    selectorRank: 0,
    metricsSnapshotVersion: resolveMetricsVersion(input.performanceHistory),
    performanceOverlayApplied: input.performanceHistory !== undefined,
    decisionReason: buildDecisionReason(input.brief, ranked.length, blockedCandidates.length),
  };
}

function isCompatible(entry: RosterEntry, brief: CreativeBrief): boolean {
  const s = entry.synthetic;
  return (
    s.status === "active" &&
    s.treatmentClass === brief.treatmentClass &&
    s.market === brief.market &&
    s.vibe === brief.targetVibe &&
    s.ethnicityFamily === brief.targetEthnicityFamily &&
    s.ageBand === brief.targetAgeBand &&
    s.pricePositioning === brief.pricePositioning
  );
}

type AllowedCandidate = {
  entry: RosterEntry;
  gate: Extract<LicenseGateDecision, { allowed: true }>;
};

type BlockedCandidate = {
  entry: RosterEntry;
  gate: Extract<LicenseGateDecision, { allowed: false }>;
};

// Type predicate — narrows c.gate to the success branch, so consumers
// access primary.gate.license / primary.gate.isSoftExclusivityOverride
// without any runtime `if (... !== true) throw` narrowing aid.
function isAllowed(c: { entry: RosterEntry; gate: LicenseGateDecision }): c is AllowedCandidate {
  return c.gate.allowed === true;
}

function isBlocked(c: { entry: RosterEntry; gate: LicenseGateDecision }): c is BlockedCandidate {
  return c.gate.allowed === false;
}

const LOCK_TYPE_RANK: Record<"hard_exclusive" | "priority_access" | "soft_exclusive", number> = {
  hard_exclusive: 0,
  priority_access: 1,
  soft_exclusive: 2,
};

// SP13-vs-SP12: identical to SP12 pickStrongest EXCEPT the final tie-break
// uses creatorIdentityId (selector picks creators) rather than license.id
// (SP12 picks leases). Documented divergence; intentional.
//
// SP20 widen: position 4 performance sub-tiebreaker inserted between
// SP12 effectiveFrom and the creatorIdentityId ASC tiebreak. Cold-start
// no-op rule per Guardrail G — comparator returns 0 whenever either side
// is missing metrics or has sampleSize === 0.
function compareCandidates(
  a: AllowedCandidate,
  b: AllowedCandidate,
  performanceHistory: ReadonlyMap<string, CreatorPerformanceMetrics> | undefined,
): number {
  const la = a.gate.license;
  const lb = b.gate.license;
  const ra = LOCK_TYPE_RANK[la.lockType];
  const rb = LOCK_TYPE_RANK[lb.lockType];
  if (ra !== rb) return ra - rb;
  if (la.lockType === "priority_access" && lb.lockType === "priority_access") {
    const pa = la.priorityRank ?? Number.MAX_SAFE_INTEGER;
    const pb = lb.priorityRank ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
  }
  if (la.effectiveFrom.getTime() !== lb.effectiveFrom.getTime()) {
    return la.effectiveFrom.getTime() - lb.effectiveFrom.getTime();
  }
  // SP20 position 4 — performance sub-tiebreaker (Guardrail G cold-start rule).
  if (performanceHistory !== undefined) {
    const am = performanceHistory.get(a.entry.creatorIdentity.id);
    const bm = performanceHistory.get(b.entry.creatorIdentity.id);
    if (am !== undefined && bm !== undefined && am.sampleSize > 0 && bm.sampleSize > 0) {
      if (am.successRate !== bm.successRate) return bm.successRate - am.successRate;
      // Both sampleSize > 0 ⇒ medianLatencyMs !== null by reader contract.
      if (am.medianLatencyMs !== bm.medianLatencyMs) {
        return (am.medianLatencyMs as number) - (bm.medianLatencyMs as number);
      }
    }
  }
  // Position 5 — final determinism tiebreak (unchanged from SP13).
  const cidA = a.entry.creatorIdentity.id;
  const cidB = b.entry.creatorIdentity.id;
  return cidA < cidB ? -1 : cidA > cidB ? 1 : 0;
}

// SP20 — read metrics.metricsVersion through from the supplied map (Guardrail C-2).
// Selector never imports PCD_PERFORMANCE_OVERLAY_VERSION directly.
// Returns null when the map is undefined OR empty; otherwise returns the
// metricsVersion of the first entry (reader contract: all entries share
// the same metricsVersion).
function resolveMetricsVersion(
  history: ReadonlyMap<string, CreatorPerformanceMetrics> | undefined,
): string | null {
  if (history === undefined) return null;
  const first = history.values().next();
  return first.done ? null : first.value.metricsVersion;
}

// Schema caps decisionReason at 2000 chars. Bound the hardConstraints echo
// defensively so a pathological brief (many or long constraint strings)
// can never produce a runtime value that fails schema parse downstream.
const DECISION_REASON_MAX = 2000;

function buildDecisionReason(
  brief: CreativeBrief,
  survivorCount: number,
  blockedCount: number,
): string {
  const survivorWord = survivorCount === 1 ? "survivor" : "survivors";
  const base = `primary_compatible (${survivorCount} ${survivorWord}, ${blockedCount} license-blocked)`;
  if (brief.hardConstraints.length === 0) return base;
  // hardConstraints are opaque strings; echo for forensics but never filter.
  const echoed = `${base} hardConstraints=${JSON.stringify(brief.hardConstraints)}`;
  if (echoed.length <= DECISION_REASON_MAX) return echoed;
  // Truncate the echo (not the base) and append an explicit marker so the
  // forensic reader sees that data was elided rather than missing.
  const room = DECISION_REASON_MAX - base.length - " hardConstraints=…(truncated)".length;
  if (room <= 0) return base;
  return `${base} hardConstraints=${JSON.stringify(brief.hardConstraints).slice(0, room)}…(truncated)`;
}
