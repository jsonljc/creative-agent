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
// No performance overlay in SP13 — `metricsSnapshotVersion` is `z.null()`
// at the schema level (SP19 will widen to `z.string().min(1).nullable()`)
// and `performanceOverlayApplied: z.literal(false)`. Reserved slots only.
// MERGE-BACK: Switchboard's composer should pull the roster + leases
// via Prisma readers before calling this pure function.
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
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

  // Step 3 — pick the first allowed candidate (Task 6 will rank).
  const primary = allowedCandidates[0]!;
  const fallbacks = allowedCandidates.slice(1);

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
    metricsSnapshotVersion: null,
    performanceOverlayApplied: false,
    decisionReason: `primary_compatible (${allowedCandidates.length} survivor${
      allowedCandidates.length === 1 ? "" : "s"
    }, ${blockedCandidates.length} license-blocked)`,
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
