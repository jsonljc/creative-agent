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
  // Skeleton — Tasks 4–8 fill in compatible-set, gate, ranking, decision.
  // Until those land, every call returns no_compatible_candidates so the
  // skeleton test in selector.test.ts passes.
  return {
    allowed: false,
    briefId: input.brief.briefId,
    reason: "no_compatible_candidates",
    compatibleCandidateIds: [],
    blockedCandidateIds: [],
    selectorVersion: PCD_SELECTOR_VERSION,
  };
}
