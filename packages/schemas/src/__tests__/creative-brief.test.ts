import { describe, expect, it } from "vitest";
import {
  CreativeBriefSchema,
  JurisdictionCodeSchema,
  PlatformSchema,
  type CreativeBrief,
} from "../creative-brief.js";

describe("JurisdictionCodeSchema", () => {
  it("accepts SG, MY, HK", () => {
    for (const j of ["SG", "MY", "HK"]) expect(JurisdictionCodeSchema.parse(j)).toBe(j);
  });

  it("rejects unknown jurisdiction codes", () => {
    expect(() => JurisdictionCodeSchema.parse("US")).toThrow();
  });
});

describe("PlatformSchema", () => {
  it("accepts the four v1 platforms", () => {
    for (const p of ["meta", "tiktok", "red", "youtube_shorts"]) {
      expect(PlatformSchema.parse(p)).toBe(p);
    }
  });

  it("rejects unknown platforms", () => {
    expect(() => PlatformSchema.parse("snapchat")).toThrow();
  });
});

describe("CreativeBriefSchema", () => {
  const valid: CreativeBrief = {
    briefId: "brf_2026_04_30_test",
    clinicId: "clinic_test_01",
    treatmentClass: "med_spa",
    market: "SG",
    jurisdictionCode: "SG",
    platform: "meta",
    targetVibe: "omg_look",
    targetEthnicityFamily: "sg_chinese",
    targetAgeBand: "mid_20s",
    pricePositioning: "entry",
    hardConstraints: [],
  };

  it("accepts a minimal valid brief", () => {
    expect(CreativeBriefSchema.parse(valid)).toEqual(valid);
  });

  it("rejects briefs without a briefId", () => {
    const bad = { ...valid } as Partial<typeof valid>;
    delete (bad as { briefId?: unknown }).briefId;
    expect(() => CreativeBriefSchema.parse(bad)).toThrow();
  });

  it("allows market !== jurisdictionCode in principle (operator override)", () => {
    expect(
      CreativeBriefSchema.parse({ ...valid, market: "MY", jurisdictionCode: "HK" }),
    ).toBeDefined();
  });

  it("rejects empty briefId strings", () => {
    expect(() => CreativeBriefSchema.parse({ ...valid, briefId: "" })).toThrow();
  });
});
