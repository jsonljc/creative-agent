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
