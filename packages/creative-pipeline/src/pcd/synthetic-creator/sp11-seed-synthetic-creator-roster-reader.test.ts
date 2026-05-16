import { describe, expect, it } from "vitest";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./seed.js";
import { Sp11SeedSyntheticCreatorRosterReader } from "./sp11-seed-synthetic-creator-roster-reader.js";

describe("Sp11SeedSyntheticCreatorRosterReader", () => {
  it("returns only roster entries matching market + treatmentClass + active status", async () => {
    const reader = new Sp11SeedSyntheticCreatorRosterReader();
    const rows = await reader.listActiveCompatibleRoster({
      market: "SG",
      treatmentClass: "med_spa",
    });

    for (const r of rows) {
      expect(r.synthetic.market).toBe("SG");
      expect(r.synthetic.treatmentClass).toBe("med_spa");
      expect(r.synthetic.status).toBe("active");
    }

    // Expected set is the SP11 roster filtered the same way.
    const expectedIds = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === "SG" &&
        e.synthetic.treatmentClass === "med_spa",
    )
      .map((e) => e.creatorIdentity.id)
      .sort();
    expect(rows.map((r) => r.creatorIdentity.id).sort()).toEqual(expectedIds);
    expect(rows.length).toBeGreaterThan(0); // SP11 seed has SG/med_spa entries.
  });

  it("returns an empty array when no roster entry matches the scope", async () => {
    const reader = new Sp11SeedSyntheticCreatorRosterReader();
    // dental is not present in the SP11 seed for any market — exact pair
    // (TH, dental) is guaranteed to be empty regardless of seed evolution.
    const rows = await reader.listActiveCompatibleRoster({
      market: "TH",
      treatmentClass: "dental",
    });
    expect(rows).toEqual([]);
  });
});
