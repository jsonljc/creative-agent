import { describe, expect, it } from "vitest";
import {
  CreatorIdentityKindSchema,
  TreatmentClassSchema,
  VibeSchema,
  MarketSchema,
  EthnicityFamilySchema,
  AgeBandSchema,
  PricePositioningSchema,
  SyntheticStatusSchema,
  CreatorIdentitySyntheticPayloadSchema,
  type CreatorIdentitySyntheticPayload,
} from "../creator-identity-synthetic.js";
import * as barrel from "../index.js";

describe("CreatorIdentityKindSchema", () => {
  it("accepts real and synthetic", () => {
    expect(CreatorIdentityKindSchema.parse("real")).toBe("real");
    expect(CreatorIdentityKindSchema.parse("synthetic")).toBe("synthetic");
  });

  it("rejects unknown kinds", () => {
    expect(() => CreatorIdentityKindSchema.parse("hybrid")).toThrow();
    expect(() => CreatorIdentityKindSchema.parse("")).toThrow();
  });
});

describe("TreatmentClassSchema", () => {
  it("accepts the four v1 treatment classes", () => {
    for (const t of ["med_spa", "dental", "anti_ageing", "halal_wellness"]) {
      expect(TreatmentClassSchema.parse(t)).toBe(t);
    }
  });

  it("rejects slimming (deferred per spec §11)", () => {
    expect(() => TreatmentClassSchema.parse("slimming")).toThrow();
  });
});

describe("VibeSchema", () => {
  it("accepts the six v1 vibes", () => {
    for (const v of [
      "omg_look",
      "quiet_confidence",
      "telling_her_friend",
      "seven_days_later",
      "just_left_clinic",
      "softly_glowing",
    ]) {
      expect(VibeSchema.parse(v)).toBe(v);
    }
  });

  it("rejects skeptic_converted (deferred per spec §11)", () => {
    expect(() => VibeSchema.parse("skeptic_converted")).toThrow();
  });
});

describe("MarketSchema", () => {
  it("accepts SG, MY, HK", () => {
    for (const m of ["SG", "MY", "HK"]) expect(MarketSchema.parse(m)).toBe(m);
  });
});

describe("AgeBandSchema", () => {
  it("accepts the four v1 age bands", () => {
    for (const a of ["gen_z", "mid_20s", "early_30s", "mid_30s_plus"]) {
      expect(AgeBandSchema.parse(a)).toBe(a);
    }
  });

  it("rejects mid_35s_plus (was a transcription typo)", () => {
    expect(() => AgeBandSchema.parse("mid_35s_plus")).toThrow();
  });
});

describe("EthnicityFamilySchema", () => {
  it("accepts the six v1 ethnicity families", () => {
    for (const e of [
      "sg_chinese",
      "my_chinese",
      "thai_chinese",
      "filipino_sg",
      "my_malay",
      "hk_chinese",
    ]) {
      expect(EthnicityFamilySchema.parse(e)).toBe(e);
    }
  });

  it("rejects unknown ethnicity values", () => {
    expect(() => EthnicityFamilySchema.parse("sg_indian")).toThrow();
    expect(() => EthnicityFamilySchema.parse("")).toThrow();
  });
});

describe("PricePositioningSchema", () => {
  it("accepts entry, standard, premium", () => {
    for (const p of ["entry", "standard", "premium"]) {
      expect(PricePositioningSchema.parse(p)).toBe(p);
    }
  });

  it("rejects unknown positioning values", () => {
    expect(() => PricePositioningSchema.parse("luxury")).toThrow();
  });
});

describe("SyntheticStatusSchema", () => {
  it("accepts active and retired", () => {
    expect(SyntheticStatusSchema.parse("active")).toBe("active");
    expect(SyntheticStatusSchema.parse("retired")).toBe("retired");
  });

  it("rejects deleted (caller must use isActive on parent CreatorIdentity)", () => {
    expect(() => SyntheticStatusSchema.parse("deleted")).toThrow();
  });
});

describe("CreatorIdentitySyntheticPayloadSchema", () => {
  const valid: CreatorIdentitySyntheticPayload = {
    creatorIdentityId: "cid_test_01",
    treatmentClass: "med_spa",
    vibe: "omg_look",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Heart-shaped, pointed chin",
      skinTone: "Light-medium NC20",
      eyeShape: "Double eyelid",
      hair: "Black messy half-bun",
      ageRead: "21-23",
      buildNote: "Petite slim shoulders",
    },
    dallePromptLocked: "Vertical lo-fi selfie photo. ...",
    klingDirection: {
      setting: "Clinic bathroom mirror",
      motion: "Sudden lean into camera",
      energy: "Mouth opening mid-sentence",
      lighting: "Unflattering fluorescent",
      avoid: ["Slow pans", "Beauty lighting"],
    },
    voiceCaptionStyle: {
      voice: "Fast, rising intonation",
      captionStyle: "ALL CAPS moments, lots of ellipses",
      sampleHook: "okay but why did nobody tell me",
      sampleCta: "just go. seriously. just book it.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  };

  it("accepts a fully populated synthetic payload", () => {
    expect(CreatorIdentitySyntheticPayloadSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty dallePromptLocked", () => {
    expect(() =>
      CreatorIdentitySyntheticPayloadSchema.parse({ ...valid, dallePromptLocked: "" }),
    ).toThrow();
  });

  it("rejects a payload missing physicalDescriptors", () => {
    const bad = { ...valid } as Partial<typeof valid>;
    delete (bad as { physicalDescriptors?: unknown }).physicalDescriptors;
    expect(() => CreatorIdentitySyntheticPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects status outside the enum", () => {
    expect(() =>
      CreatorIdentitySyntheticPayloadSchema.parse({ ...valid, status: "deleted" }),
    ).toThrow();
  });
});

describe("schemas package barrel", () => {
  it("re-exports SP11 synthetic-creator surface", () => {
    expect(barrel.CreatorIdentityKindSchema).toBeDefined();
    expect(barrel.TreatmentClassSchema).toBeDefined();
    expect(barrel.VibeSchema).toBeDefined();
    expect(barrel.MarketSchema).toBeDefined();
    expect(barrel.EthnicityFamilySchema).toBeDefined();
    expect(barrel.AgeBandSchema).toBeDefined();
    expect(barrel.PricePositioningSchema).toBeDefined();
    expect(barrel.CreatorIdentitySyntheticPayloadSchema).toBeDefined();
  });

  it("re-exports SP11 CreativeBrief surface", () => {
    expect(barrel.CreativeBriefSchema).toBeDefined();
    expect(barrel.JurisdictionCodeSchema).toBeDefined();
    expect(barrel.PlatformSchema).toBeDefined();
  });
});
