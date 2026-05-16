// SP13 selector — table-driven tests. The selector is pure; tests inject
// roster + leases snapshots directly. No DB / Prisma anywhere in this
// file (SP13 anti-pattern test asserts this structurally).
import { describe, expect, it } from "vitest";
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
  CreatorPerformanceMetrics,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import type { RosterEntry } from "../synthetic-creator/seed.js";
import { buildCreatorPerformanceMetrics } from "./build-creator-performance-metrics.fixture.js";
import { selectSyntheticCreator, type SelectSyntheticCreatorInput } from "./selector.js";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

const NOW = new Date("2026-05-15T00:00:00.000Z");

// Cheryl (cid_synth_cheryl_sg_01) shape: SG / med_spa / omg_look / sg_chinese / mid_20s / entry.
const cherylRoster: readonly RosterEntry[] = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
  (r) => r.creatorIdentity.id === "cid_synth_cheryl_sg_01",
);

const briefForCheryl: CreativeBrief = {
  briefId: "brief_test_cheryl",
  clinicId: "clinic_a",
  treatmentClass: "med_spa",
  market: "SG",
  jurisdictionCode: "SG",
  platform: "tiktok",
  targetVibe: "omg_look",
  targetEthnicityFamily: "sg_chinese",
  targetAgeBand: "mid_20s",
  pricePositioning: "entry",
  hardConstraints: [] as const,
};

describe("selectSyntheticCreator — skeleton (will be fleshed out in subsequent tasks)", () => {
  it("returns a rejection decision when no roster + no leases supplied", () => {
    const decision: SyntheticCreatorSelectionDecision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW,
      roster: [],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
      expect(decision.selectorVersion).toBe(PCD_SELECTOR_VERSION);
      expect(decision.briefId).toBe("brief_test_cheryl");
      expect(decision.compatibleCandidateIds).toEqual([]);
      expect(decision.blockedCandidateIds).toEqual([]);
    }
  });
});

describe("selectSyntheticCreator — compatible-set filter", () => {
  it("matches Cheryl from full roster when brief targets her exactly", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW,
      roster: SP11_SYNTHETIC_CREATOR_ROSTER,
      leases: [], // no leases yet — Task 5 will exercise the gate
    });
    // Compatible-set will match Cheryl alone (omg_look + sg_chinese + entry).
    // No lease → all_blocked_by_license, with Cheryl in compatibleCandidateIds.
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("returns no_compatible_candidates when vibe does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetVibe: "quiet_confidence" }, // Vivienne's vibe
      now: NOW,
      roster: cherylRoster, // Cheryl only — vibe mismatch
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
    }
  });

  it("returns no_compatible_candidates when market does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, market: "MY" },
      now: NOW,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when treatmentClass does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, treatmentClass: "dental" },
      now: NOW,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when pricePositioning does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, pricePositioning: "premium" },
      now: NOW,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when ethnicityFamily does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetEthnicityFamily: "my_malay" },
      now: NOW,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("returns no_compatible_candidates when ageBand does not match", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, targetAgeBand: "gen_z" },
      now: NOW,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });

  it("filters retired candidates even when target fields match", () => {
    const retiredCheryl: RosterEntry = {
      ...cherylRoster[0]!,
      synthetic: { ...cherylRoster[0]!.synthetic, status: "retired" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW,
      roster: [retiredCheryl],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_compatible_candidates");
  });
});

// Shared test helpers exported for later tasks.
export const NOW_FIXTURE = NOW;
export { cherylRoster, briefForCheryl };

export const makeLease = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
  id: "lic_test_default",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});

describe("selectSyntheticCreator — license-gate composition", () => {
  it("succeeds when the lone compatible candidate has an active priority_access lease for the requesting clinic", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_cheryl_a", lockType: "priority_access", priorityRank: 0 })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(decision.selectedLicenseId).toBe("lic_cheryl_a");
      expect(decision.selectedLockType).toBe("priority_access");
      expect(decision.fallbackCreatorIdentityIds).toEqual([]);
      expect(decision.selectorRank).toBe(0);
      expect(decision.metricsSnapshotVersion).toBeNull();
      expect(decision.performanceOverlayApplied).toBe(false);
      expect(decision.selectorVersion).toBe(PCD_SELECTOR_VERSION);
    }
  });

  it("blocks the lone candidate when no lease exists (all_blocked_by_license)", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("blocks when a competing clinic holds an active hard_exclusive on the same scope", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({
          id: "lic_competing_hard",
          clinicId: "clinic_competitor",
          lockType: "hard_exclusive",
        }),
      ],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("blocks when the candidate's lease has expired", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-04-30T00:00:00.000Z"),
          status: "expired",
        }),
      ],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.blockedCandidateIds).toEqual(["cid_synth_cheryl_sg_01"]);
    }
  });

  it("returns all_blocked_by_license when every compatible candidate is gate-rejected", () => {
    // Synthesize a 2-creator roster, both compatible, neither leased.
    const cherylA: RosterEntry = cherylRoster[0]!;
    const cherylB: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_dup", name: "Cheryl-Dup", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_dup" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
      expect(decision.compatibleCandidateIds.length).toBe(2);
      expect(decision.blockedCandidateIds.length).toBe(2);
    }
  });

  it("selects the one allowed candidate; blocked siblings do NOT appear in success-branch fallbacks", () => {
    const cherylA: RosterEntry = cherylRoster[0]!;
    const cherylB: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_dup", name: "Cheryl-Dup", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_dup" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      // Only the first is leased.
      leases: [makeLease({ id: "lic_cheryl_a_only", creatorIdentityId: "cid_synth_cheryl_sg_01" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      // The blocked sibling is NOT a fallback. Success branch has no blocked-candidate field.
      expect(decision.fallbackCreatorIdentityIds).toEqual([]);
    }
  });
});

describe("selectSyntheticCreator — ranking + tie-break", () => {
  // Build a 2-candidate compatible roster where both pass the gate but
  // hold different leases. Test orders verify SP12 pickStrongest semantics
  // applied across candidates.
  const cherylA: RosterEntry = cherylRoster[0]!;
  const cherylB: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_zzz", name: "Cheryl-Z", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_zzz" },
  };

  it("hard_exclusive beats priority_access", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({
          id: "lic_priority",
          creatorIdentityId: cherylA.creatorIdentity.id,
          lockType: "priority_access",
        }),
        makeLease({
          id: "lic_hard",
          creatorIdentityId: cherylB.creatorIdentity.id,
          lockType: "hard_exclusive",
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLockType).toBe("hard_exclusive");
      expect(decision.fallbackCreatorIdentityIds).toEqual([cherylA.creatorIdentity.id]);
    }
  });

  it("priority_access with lower priorityRank wins among priority_access leases", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({
          id: "lic_rank10",
          creatorIdentityId: cherylA.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 10,
        }),
        makeLease({
          id: "lic_rank5",
          creatorIdentityId: cherylB.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLicenseId).toBe("lic_rank5");
    }
  });

  it("priority_access tie on rank → older effectiveFrom wins", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        makeLease({
          id: "lic_newer",
          creatorIdentityId: cherylA.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
          effectiveFrom: new Date("2026-05-10T00:00:00.000Z"),
        }),
        makeLease({
          id: "lic_older",
          creatorIdentityId: cherylB.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
          effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylB.creatorIdentity.id);
      expect(decision.selectedLicenseId).toBe("lic_older");
    }
  });

  it("full tie on lockType, rank, effectiveFrom → creatorIdentityId ASC wins (SP13-vs-SP12 final tie-break)", () => {
    // cherylA.id = "cid_synth_cheryl_sg_01"
    // cherylB.id = "cid_synth_cheryl_sg_zzz"
    // Identical lease shape; selector ties on creator id ASC → cherylA wins.
    const sameLease = (creatorIdentityId: string, id: string) =>
      makeLease({
        id,
        creatorIdentityId,
        lockType: "priority_access",
        priorityRank: 5,
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
      });
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB],
      leases: [
        sameLease(cherylA.creatorIdentity.id, "lic_a"),
        sameLease(cherylB.creatorIdentity.id, "lic_b"),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylA.creatorIdentity.id);
    }
  });

  it("ranked fallback chain reflects full ordering across allowed candidates", () => {
    // Three compatible candidates, all leased, three different strengths:
    //   cherylA: priority_access rank 10
    //   cherylB: priority_access rank 5
    //   cherylC: hard_exclusive
    const cherylC: RosterEntry = {
      creatorIdentity: { id: "cid_synth_cheryl_sg_mid", name: "Cheryl-M", kind: "synthetic" },
      synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_mid" },
    };
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: [
        makeLease({
          id: "lic_a",
          creatorIdentityId: cherylA.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 10,
        }),
        makeLease({
          id: "lic_b",
          creatorIdentityId: cherylB.creatorIdentity.id,
          lockType: "priority_access",
          priorityRank: 5,
        }),
        makeLease({
          id: "lic_c",
          creatorIdentityId: cherylC.creatorIdentity.id,
          lockType: "hard_exclusive",
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedCreatorIdentityId).toBe(cherylC.creatorIdentity.id); // hard wins
      expect(decision.fallbackCreatorIdentityIds).toEqual([
        cherylB.creatorIdentity.id, // priority_access rank 5
        cherylA.creatorIdentity.id, // priority_access rank 10
      ]);
    }
  });
});

describe("selectSyntheticCreator — decisionReason builder", () => {
  it("includes survivor and blocked counts", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).toMatch(/1 survivor/);
      expect(decision.decisionReason).toMatch(/0 license-blocked/);
    }
  });

  it("echoes brief.hardConstraints into decisionReason when non-empty", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, hardConstraints: ["no_pregnancy", "halal_only"] as const },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).toContain("hardConstraints=");
      expect(decision.decisionReason).toContain("no_pregnancy");
      expect(decision.decisionReason).toContain("halal_only");
    }
  });

  it("omits the hardConstraints= prefix when the brief has none", () => {
    const decision = selectSyntheticCreator({
      brief: { ...briefForCheryl, hardConstraints: [] as const },
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_one" })],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.decisionReason).not.toContain("hardConstraints=");
    }
  });
});

describe("selectSyntheticCreator — soft_exclusive override propagation", () => {
  it("emits isSoftExclusivityOverride=true when the chosen lease is soft_exclusive and a competing soft_exclusive is active", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({
          id: "lic_mine_soft",
          clinicId: "clinic_a",
          lockType: "soft_exclusive",
        }),
        makeLease({
          id: "lic_competing_soft",
          clinicId: "clinic_competitor",
          lockType: "soft_exclusive",
        }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedLockType).toBe("soft_exclusive");
      expect(decision.isSoftExclusivityOverride).toBe(true);
    }
  });

  it("emits isSoftExclusivityOverride=false when the chosen lease is soft_exclusive and no competitor exists", () => {
    const decision = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [
        makeLease({ id: "lic_mine_soft", clinicId: "clinic_a", lockType: "soft_exclusive" }),
      ],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.selectedLockType).toBe("soft_exclusive");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });
});

describe("selectSyntheticCreator — determinism", () => {
  // Three compatible candidates, all leased identically except for the
  // license id. Selector must produce byte-equal output regardless of
  // input-array ordering — true determinism, not iteration-order luck.
  const cherylA: RosterEntry = cherylRoster[0]!;
  const cherylB: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_bbb", name: "Cheryl-B", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_bbb" },
  };
  const cherylC: RosterEntry = {
    creatorIdentity: { id: "cid_synth_cheryl_sg_ccc", name: "Cheryl-C", kind: "synthetic" },
    synthetic: { ...cherylA.synthetic, creatorIdentityId: "cid_synth_cheryl_sg_ccc" },
  };

  const leasesForAll = [
    makeLease({
      id: "lic_a",
      creatorIdentityId: cherylA.creatorIdentity.id,
      lockType: "priority_access",
      priorityRank: 5,
    }),
    makeLease({
      id: "lic_b",
      creatorIdentityId: cherylB.creatorIdentity.id,
      lockType: "priority_access",
      priorityRank: 5,
    }),
    makeLease({
      id: "lic_c",
      creatorIdentityId: cherylC.creatorIdentity.id,
      lockType: "priority_access",
      priorityRank: 5,
    }),
  ];

  it("two identical calls produce byte-equal decisions", () => {
    const inputArgs = {
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    };
    const a = selectSyntheticCreator(inputArgs);
    const b = selectSyntheticCreator(inputArgs);
    expect(a).toEqual(b);
  });

  it("shuffling roster order does not change the selected creator", () => {
    const baseline = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    });
    const reversed = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylC, cherylB, cherylA],
      leases: leasesForAll,
    });
    expect(baseline.allowed).toBe(true);
    expect(reversed.allowed).toBe(true);
    if (baseline.allowed === true && reversed.allowed === true) {
      expect(reversed.selectedCreatorIdentityId).toBe(baseline.selectedCreatorIdentityId);
      expect(reversed.fallbackCreatorIdentityIds).toEqual(baseline.fallbackCreatorIdentityIds);
    }
  });

  it("shuffling leases order does not change the selected license", () => {
    const baseline = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: leasesForAll,
    });
    const reversed = selectSyntheticCreator({
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: [cherylA, cherylB, cherylC],
      leases: [...leasesForAll].reverse(),
    });
    expect(baseline.allowed).toBe(true);
    expect(reversed.allowed).toBe(true);
    if (baseline.allowed === true && reversed.allowed === true) {
      expect(reversed.selectedLicenseId).toBe(baseline.selectedLicenseId);
      expect(reversed.selectedCreatorIdentityId).toBe(baseline.selectedCreatorIdentityId);
    }
  });
});

// ---------------------------------------------------------------------------
// SP20 shared helpers — hoisted from T9 describe block so T10 can reuse them.
// ---------------------------------------------------------------------------

function twoEquivalentCandidatesInput(): SelectSyntheticCreatorInput {
  const cherylSynthetic = cherylRoster[0]!.synthetic;
  const rosterA: RosterEntry = {
    creatorIdentity: { id: "creator-A", name: "A", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-A" },
  };
  const rosterB: RosterEntry = {
    creatorIdentity: { id: "creator-B", name: "B", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-B" },
  };
  // Two leases with identical (lockType, priorityRank, effectiveFrom) for the
  // same (clinicId, market, treatmentClass) — positions 1-3 of the comparator
  // tie, so position 4 (performance) decides.
  const leaseShape = {
    clinicId: "clinic_a",
    market: "SG" as const,
    treatmentClass: "med_spa" as const,
    lockType: "hard_exclusive" as const,
    exclusivityScope: "market_treatment" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    priorityRank: null,
    status: "active" as const,
  };
  const leaseA: CreatorIdentityLicensePayload = {
    id: "lease-A",
    creatorIdentityId: "creator-A",
    ...leaseShape,
  };
  const leaseB: CreatorIdentityLicensePayload = {
    id: "lease-B",
    creatorIdentityId: "creator-B",
    ...leaseShape,
  };
  return {
    brief: briefForCheryl,
    now: NOW,
    roster: [rosterA, rosterB],
    leases: [leaseA, leaseB],
  };
}

// Guardrail A helper: creator-A has hard_exclusive; creator-B has priority_access.
// Both candidates hold leases for their own creatorIdentityId — each passes the
// per-candidate gate independently. No two-hard-exclusive conflict here.
function hardExclusiveVsPriorityAccessInput(): SelectSyntheticCreatorInput {
  const cherylSynthetic = cherylRoster[0]!.synthetic;
  const rosterA: RosterEntry = {
    creatorIdentity: { id: "creator-A", name: "A", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-A" },
  };
  const rosterB: RosterEntry = {
    creatorIdentity: { id: "creator-B", name: "B", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-B" },
  };
  const baseLease = {
    clinicId: "clinic_a",
    market: "SG" as const,
    treatmentClass: "med_spa" as const,
    exclusivityScope: "market_treatment" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "active" as const,
  };
  const leaseA: CreatorIdentityLicensePayload = {
    id: "lease-A",
    creatorIdentityId: "creator-A",
    lockType: "hard_exclusive",
    priorityRank: null,
    ...baseLease,
  };
  const leaseB: CreatorIdentityLicensePayload = {
    id: "lease-B",
    creatorIdentityId: "creator-B",
    lockType: "priority_access",
    priorityRank: 1,
    ...baseLease,
  };
  return { brief: briefForCheryl, now: NOW, roster: [rosterA, rosterB], leases: [leaseA, leaseB] };
}

// Guardrail A helper: both priority_access; A has rank 1 (stronger), B has rank 5 (weaker).
function priorityRankInput(): SelectSyntheticCreatorInput {
  const cherylSynthetic = cherylRoster[0]!.synthetic;
  const rosterA: RosterEntry = {
    creatorIdentity: { id: "creator-A", name: "A", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-A" },
  };
  const rosterB: RosterEntry = {
    creatorIdentity: { id: "creator-B", name: "B", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-B" },
  };
  const baseLease = {
    clinicId: "clinic_a",
    market: "SG" as const,
    treatmentClass: "med_spa" as const,
    lockType: "priority_access" as const,
    exclusivityScope: "market_treatment" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "active" as const,
  };
  const leaseA: CreatorIdentityLicensePayload = {
    id: "lease-A",
    creatorIdentityId: "creator-A",
    priorityRank: 1,
    ...baseLease,
  };
  const leaseB: CreatorIdentityLicensePayload = {
    id: "lease-B",
    creatorIdentityId: "creator-B",
    priorityRank: 5,
    ...baseLease,
  };
  return { brief: briefForCheryl, now: NOW, roster: [rosterA, rosterB], leases: [leaseA, leaseB] };
}

// Guardrail A helper: both hard_exclusive; creator-A-earlier started before creator-B-later.
function effectiveFromInput(): SelectSyntheticCreatorInput {
  const cherylSynthetic = cherylRoster[0]!.synthetic;
  const rosterA: RosterEntry = {
    creatorIdentity: { id: "creator-A-earlier", name: "A", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-A-earlier" },
  };
  const rosterB: RosterEntry = {
    creatorIdentity: { id: "creator-B-later", name: "B", kind: "synthetic" },
    synthetic: { ...cherylSynthetic, creatorIdentityId: "creator-B-later" },
  };
  const baseLease = {
    clinicId: "clinic_a",
    market: "SG" as const,
    treatmentClass: "med_spa" as const,
    lockType: "hard_exclusive" as const,
    exclusivityScope: "market_treatment" as const,
    effectiveTo: null,
    priorityRank: null,
    status: "active" as const,
  };
  const leaseA: CreatorIdentityLicensePayload = {
    id: "lease-A",
    creatorIdentityId: "creator-A-earlier",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    ...baseLease,
  };
  const leaseB: CreatorIdentityLicensePayload = {
    id: "lease-B",
    creatorIdentityId: "creator-B-later",
    effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
    ...baseLease,
  };
  return { brief: briefForCheryl, now: NOW, roster: [rosterA, rosterB], leases: [leaseA, leaseB] };
}

describe("selectSyntheticCreator — SP20 comparator sub-tiebreaker", () => {
  it("performance: better successRate wins among license-equivalent candidates", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 10,
          successCount: 9,
          failureCount: 1,
          manualSkipCount: 0,
          successRate: 0.9,
          medianLatencyMs: 2000,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 10,
          successCount: 4,
          failureCount: 6,
          manualSkipCount: 0,
          successRate: 0.4,
          medianLatencyMs: 2000,
        }),
      ],
    ]);
    const decision = selectSyntheticCreator({
      ...twoEquivalentCandidatesInput(),
      performanceHistory: perf,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("performance: lower medianLatencyMs wins as sub-sub-tiebreak when successRate ties", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 5,
          successCount: 5,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 1,
          medianLatencyMs: 2000,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 5,
          successCount: 5,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 1,
          medianLatencyMs: 1000,
        }),
      ],
    ]);
    const decision = selectSyntheticCreator({
      ...twoEquivalentCandidatesInput(),
      performanceHistory: perf,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-B");
    }
  });

  it("cold-start no-op: either side sampleSize === 0 falls through to creatorIdentityId ASC", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 10,
          successCount: 0,
          failureCount: 10,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: 5000,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
        }),
      ],
    ]);
    const decision = selectSyntheticCreator({
      ...twoEquivalentCandidatesInput(),
      performanceHistory: perf,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      // Tied at position 4 ⇒ position 5 picks creator-A (ASC).
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("cold-start no-op: both sides cold-start preserves creatorIdentityId ASC", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
        }),
      ],
    ]);
    const decision = selectSyntheticCreator({
      ...twoEquivalentCandidatesInput(),
      performanceHistory: perf,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("missing entry for one candidate behaves like sampleSize === 0 (no-op)", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 10,
          successCount: 10,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 1,
          medianLatencyMs: 500,
        }),
      ],
      // creator-B intentionally missing.
    ]);
    const decision = selectSyntheticCreator({
      ...twoEquivalentCandidatesInput(),
      performanceHistory: perf,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      // No comparator winner at position 4; ASC tiebreak → creator-A.
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });
});

describe("selectSyntheticCreator — SP20 signature widen", () => {
  function baseInput(): SelectSyntheticCreatorInput {
    // Cheryl with an active priority_access lease — the simplest success path.
    return {
      brief: briefForCheryl,
      now: NOW_FIXTURE,
      roster: cherylRoster,
      leases: [makeLease({ id: "lic_sp20_base", lockType: "priority_access", priorityRank: 0 })],
    };
  }

  it("accepts performanceHistory as an optional input and produces a typed decision", () => {
    const performanceHistory = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A" })],
    ]);
    const decision = selectSyntheticCreator({
      ...baseInput(),
      performanceHistory,
    });
    expect(decision.allowed).toBe(true);
  });

  it("undefined performanceHistory produces decision with performanceOverlayApplied: false and metricsSnapshotVersion: null", () => {
    const decision = selectSyntheticCreator(baseInput());
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.performanceOverlayApplied).toBe(false);
      expect(decision.metricsSnapshotVersion).toBeNull();
    }
  });
});

describe("selectSyntheticCreator — SP20 Guardrail A: contractual ordering NEVER yields to performance", () => {
  it("hard_exclusive with 0% success rate still outranks priority_access with 100% success rate", () => {
    const input = hardExclusiveVsPriorityAccessInput();
    const decision = selectSyntheticCreator({
      ...input,
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        [
          "creator-A",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-A",
            sampleSize: 10,
            successCount: 0,
            failureCount: 10,
            manualSkipCount: 0,
            successRate: 0,
            medianLatencyMs: 5000,
          }),
        ],
        [
          "creator-B",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-B",
            sampleSize: 10,
            successCount: 10,
            failureCount: 0,
            manualSkipCount: 0,
            successRate: 1,
            medianLatencyMs: 500,
          }),
        ],
      ]),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("priority_access priorityRank: 1 with 0% success outranks priorityRank: 5 with 100% success", () => {
    const input = priorityRankInput();
    const decision = selectSyntheticCreator({
      ...input,
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        [
          "creator-A",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-A",
            sampleSize: 10,
            successCount: 0,
            failureCount: 10,
            manualSkipCount: 0,
            successRate: 0,
            medianLatencyMs: 5000,
          }),
        ],
        [
          "creator-B",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-B",
            sampleSize: 10,
            successCount: 10,
            failureCount: 0,
            manualSkipCount: 0,
            successRate: 1,
            medianLatencyMs: 500,
          }),
        ],
      ]),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A");
    }
  });

  it("earlier effectiveFrom outranks later effectiveFrom regardless of performance", () => {
    const input = effectiveFromInput();
    const decision = selectSyntheticCreator({
      ...input,
      performanceHistory: new Map<string, CreatorPerformanceMetrics>([
        [
          "creator-A-earlier",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-A-earlier",
            sampleSize: 10,
            successCount: 0,
            failureCount: 10,
            manualSkipCount: 0,
            successRate: 0,
            medianLatencyMs: 5000,
          }),
        ],
        [
          "creator-B-later",
          buildCreatorPerformanceMetrics({
            creatorIdentityId: "creator-B-later",
            sampleSize: 10,
            successCount: 10,
            failureCount: 0,
            manualSkipCount: 0,
            successRate: 1,
            medianLatencyMs: 500,
          }),
        ],
      ]),
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.selectedCreatorIdentityId).toBe("creator-A-earlier");
    }
  });
});

describe("selectSyntheticCreator — SP20 Guardrail F: now-insensitive with overlay", () => {
  it("varying input.now produces identical decisions when performanceHistory is supplied", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 10,
          successCount: 7,
          failureCount: 3,
          manualSkipCount: 0,
          successRate: 0.7,
          medianLatencyMs: 1500,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 10,
          successCount: 7,
          failureCount: 3,
          manualSkipCount: 0,
          successRate: 0.7,
          medianLatencyMs: 1500,
        }),
      ],
    ]);
    const input = twoEquivalentCandidatesInput();
    const at1 = selectSyntheticCreator({
      ...input,
      now: new Date("2026-01-01"),
      performanceHistory: perf,
    });
    const at2 = selectSyntheticCreator({
      ...input,
      now: new Date("2027-06-15"),
      performanceHistory: perf,
    });
    expect(at1).toEqual(at2);
  });
});

describe("selectSyntheticCreator — SP20 Guardrail G: three-mode empty-history equivalence", () => {
  function nonOverlayFields(d: SyntheticCreatorSelectionDecision) {
    if (!d.allowed) return d;
    const { performanceOverlayApplied: _a, metricsSnapshotVersion: _b, ...rest } = d;
    return rest;
  }

  it("mode (a) — undefined performanceHistory: SP13-equivalent on selection outcome + non-overlay fields; overlay metadata both 'off'", () => {
    const input = twoEquivalentCandidatesInput();
    const sp13 = selectSyntheticCreator(input);
    const sp20Undefined = selectSyntheticCreator({ ...input }); // key omitted
    expect(nonOverlayFields(sp20Undefined)).toEqual(nonOverlayFields(sp13));
    if (sp20Undefined.allowed) {
      expect(sp20Undefined.performanceOverlayApplied).toBe(false);
      expect(sp20Undefined.metricsSnapshotVersion).toBeNull();
    }
  });

  it("mode (b) — empty Map performanceHistory: same selection outcome + non-overlay fields as SP13; overlay metadata { applied: true, version: null }", () => {
    const input = twoEquivalentCandidatesInput();
    const sp13 = selectSyntheticCreator(input);
    const sp20EmptyMap = selectSyntheticCreator({
      ...input,
      performanceHistory: new Map<string, CreatorPerformanceMetrics>(),
    });
    expect(nonOverlayFields(sp20EmptyMap)).toEqual(nonOverlayFields(sp13));
    if (sp20EmptyMap.allowed) {
      expect(sp20EmptyMap.performanceOverlayApplied).toBe(true);
      expect(sp20EmptyMap.metricsSnapshotVersion).toBeNull();
    }
  });

  it("cold-start-only performanceHistory yields SP13-equivalent selection in a tied bucket", () => {
    const input = twoEquivalentCandidatesInput();
    const sp13 = selectSyntheticCreator(input);
    const coldOnly = new Map<string, CreatorPerformanceMetrics>([
      [
        "creator-A",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-A",
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
        }),
      ],
      [
        "creator-B",
        buildCreatorPerformanceMetrics({
          creatorIdentityId: "creator-B",
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
        }),
      ],
    ]);
    const sp20Cold = selectSyntheticCreator({ ...input, performanceHistory: coldOnly });
    if (sp13.allowed && sp20Cold.allowed) {
      expect(sp20Cold.selectedCreatorIdentityId).toBe(sp13.selectedCreatorIdentityId);
    }
  });
});

describe("selectSyntheticCreator — SP20 Guardrail C-2: metricsVersion read-through", () => {
  it("metricsSnapshotVersion echoes metrics.metricsVersion from the supplied map", () => {
    const perf = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-A" })],
      ["creator-B", buildCreatorPerformanceMetrics({ creatorIdentityId: "creator-B" })],
    ]);
    const input = twoEquivalentCandidatesInput();
    const decision = selectSyntheticCreator({ ...input, performanceHistory: perf });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      // Fixture's metricsVersion defaults to PCD_PERFORMANCE_OVERLAY_VERSION.
      expect(decision.metricsSnapshotVersion).toBe("pcd-performance-overlay@1.0.0");
    }
  });
});
