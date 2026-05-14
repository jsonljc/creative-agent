// PCD slice SP12 — pure deterministic license gate for synthetic creators.
// Mirrors the SP2 PcdTierPolicy shape: typed input record, no I/O, no
// clock reads — caller supplies `now` and the lease snapshot. The gate
// is invoked at job-creation time per the design spec §4 step 5.
//
// Lock-type semantics (design §3.3):
//   - hard_exclusive   only the holder can use the creator at job time
//   - priority_access  multiple holders allowed; selector orders by priorityRank
//   - soft_exclusive   single primary, others pass with override flag
//
// The gate never imports @creativeagent/db, @prisma/client, or performs
// any I/O. Anti-pattern test in `pcd/sp12-anti-patterns.test.ts` enforces.
import type {
  CreatorIdentityLicensePayload,
  Market,
  TreatmentClass,
} from "@creativeagent/schemas";

export const PCD_LICENSE_GATE_VERSION = "license-gate@1.0.0";

export type LicenseGateInput = {
  creatorIdentityId: string;
  clinicId: string;
  market: Market;
  treatmentClass: TreatmentClass;
  now: Date;
  /**
   * Snapshot of leases the gate decides over. Caller pulls these via
   * `PrismaCreatorIdentityLicenseReader.findActiveByCreatorAndScope`
   * (or a wider query if non-active leases are needed for the
   * expired/suspended distinction). The gate filters defensively by
   * (creatorIdentityId, market, treatmentClass) before deciding.
   */
  leases: readonly CreatorIdentityLicensePayload[];
};

export type LicenseGateReason =
  | "active_lease"
  | "no_lease"
  | "expired"
  | "suspended"
  | "blocked_by_hard_exclusive";

export type LicenseGateDecision =
  | {
      allowed: true;
      license: CreatorIdentityLicensePayload;
      reason: "active_lease";
      isSoftExclusivityOverride: boolean;
    }
  | {
      allowed: false;
      license: null;
      reason: Exclude<LicenseGateReason, "active_lease">;
    };

export function licenseGate(input: LicenseGateInput): LicenseGateDecision {
  const inScope = input.leases.filter(
    (l) =>
      l.creatorIdentityId === input.creatorIdentityId &&
      l.market === input.market &&
      l.treatmentClass === input.treatmentClass,
  );

  const mine = inScope.filter((l) => l.clinicId === input.clinicId);
  const competing = inScope.filter((l) => l.clinicId !== input.clinicId);

  // Step 1 — Competing hard_exclusive blocks unconditionally.
  const competingHardActive = competing.filter(
    (l) => l.lockType === "hard_exclusive" && isActiveAt(l, input.now),
  );
  if (competingHardActive.length > 0) {
    return { allowed: false, license: null, reason: "blocked_by_hard_exclusive" };
  }

  // Step 2 — Requesting clinic's active leases.
  const mineActive = mine.filter((l) => isActiveAt(l, input.now));

  if (mineActive.length === 0) {
    // Distinguish expired vs suspended vs no_lease for caller diagnostics.
    if (mine.some((l) => isExpiredAt(l, input.now))) {
      return { allowed: false, license: null, reason: "expired" };
    }
    if (mine.some((l) => l.status === "suspended")) {
      return { allowed: false, license: null, reason: "suspended" };
    }
    return { allowed: false, license: null, reason: "no_lease" };
  }

  // Step 3 — Pick strongest active lease for this clinic.
  //   Precedence: hard_exclusive > priority_access (lowest rank wins) > soft_exclusive.
  //   Tie-break: effectiveFrom ASC, then id ASC (deterministic, replayable).
  const strongest = pickStrongest(mineActive);

  // Step 4 — Soft-exclusive override flag.
  let isSoftExclusivityOverride = false;
  if (strongest.lockType === "soft_exclusive") {
    isSoftExclusivityOverride = competing.some(
      (l) => l.lockType === "soft_exclusive" && isActiveAt(l, input.now),
    );
  }

  return {
    allowed: true,
    license: strongest,
    reason: "active_lease",
    isSoftExclusivityOverride,
  };
}

function isActiveAt(lease: CreatorIdentityLicensePayload, now: Date): boolean {
  if (lease.status !== "active") return false;
  if (lease.effectiveFrom.getTime() > now.getTime()) return false;
  if (lease.effectiveTo === null) return true;
  return lease.effectiveTo.getTime() > now.getTime();
}

function isExpiredAt(lease: CreatorIdentityLicensePayload, now: Date): boolean {
  return lease.effectiveTo !== null && lease.effectiveTo.getTime() <= now.getTime();
}

const LOCK_TYPE_RANK: Record<CreatorIdentityLicensePayload["lockType"], number> = {
  hard_exclusive: 0,
  priority_access: 1,
  soft_exclusive: 2,
};

function pickStrongest(
  leases: readonly CreatorIdentityLicensePayload[],
): CreatorIdentityLicensePayload {
  const sorted = [...leases].sort((a, b) => {
    const ra = LOCK_TYPE_RANK[a.lockType];
    const rb = LOCK_TYPE_RANK[b.lockType];
    if (ra !== rb) return ra - rb;
    if (a.lockType === "priority_access" && b.lockType === "priority_access") {
      const pa = a.priorityRank ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priorityRank ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
    }
    if (a.effectiveFrom.getTime() !== b.effectiveFrom.getTime()) {
      return a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Non-empty by precondition (caller passes mineActive.length > 0).
  return sorted[0]!;
}
