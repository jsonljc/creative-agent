// SP13 selector — table-driven tests. The selector is pure; tests inject
// roster + leases snapshots directly. No DB / Prisma anywhere in this
// file (SP13 anti-pattern test asserts this structurally).
import { describe, expect, it } from "vitest";
import type {
  CreativeBrief,
  CreatorIdentityLicensePayload,
  SyntheticCreatorSelectionDecision,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import type { RosterEntry } from "../synthetic-creator/seed.js";
import { selectSyntheticCreator } from "./selector.js";
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
