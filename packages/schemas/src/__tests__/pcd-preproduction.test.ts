import { describe, expect, it } from "vitest";
import { PreproductionChainStageEnumSchema } from "../pcd-preproduction.js";
import { UgcStyleConstraintSchema } from "../pcd-preproduction.js";

describe("PreproductionChainStageEnumSchema", () => {
  it("accepts every documented stage name", () => {
    const stages = [
      "trends",
      "motivators",
      "hooks",
      "creator_scripts",
      "production_fanout_gate",
    ];
    for (const s of stages) {
      expect(PreproductionChainStageEnumSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects undocumented stage names", () => {
    expect(PreproductionChainStageEnumSchema.safeParse("storyboard").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("").success).toBe(false);
    expect(PreproductionChainStageEnumSchema.safeParse("scripts").success).toBe(false);
  });
});

describe("UgcStyleConstraintSchema", () => {
  it("accepts the five locked constraint values", () => {
    const values = [
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ];
    for (const v of values) {
      expect(UgcStyleConstraintSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects undocumented constraints", () => {
    expect(UgcStyleConstraintSchema.safeParse("polished_brand_film").success).toBe(false);
    expect(UgcStyleConstraintSchema.safeParse("").success).toBe(false);
  });
});

import { PcdBriefInputSchema } from "../pcd-preproduction.js";

describe("PcdBriefInputSchema", () => {
  const valid = {
    briefId: "brief-1",
    productDescription: "AI WhatsApp lead-reply assistant",
    targetAudience: "Solo founders running paid traffic",
    platforms: ["instagram_reels", "tiktok"],
    brandVoice: null,
    references: [],
    creatorIdentityRef: "creator-1",
    productIdentityRef: "product-1",
  };

  it("accepts a minimal valid brief", () => {
    expect(PcdBriefInputSchema.safeParse(valid).success).toBe(true);
  });

  it("requires briefId", () => {
    const { briefId: _b, ...withoutId } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutId).success).toBe(false);
  });

  it("requires creatorIdentityRef", () => {
    const { creatorIdentityRef: _c, ...withoutCreator } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutCreator).success).toBe(false);
  });

  it("requires productIdentityRef", () => {
    const { productIdentityRef: _p, ...withoutProduct } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutProduct).success).toBe(false);
  });

  it("allows brandVoice to be null or undefined", () => {
    expect(PcdBriefInputSchema.safeParse({ ...valid, brandVoice: null }).success).toBe(true);
    const { brandVoice: _bv, ...withoutBrandVoice } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutBrandVoice).success).toBe(true);
  });

  it("allows references to be omitted", () => {
    const { references: _r, ...withoutRefs } = valid;
    expect(PcdBriefInputSchema.safeParse(withoutRefs).success).toBe(true);
  });
});

import { PcdIdentityContextSchema } from "../pcd-preproduction.js";

describe("PcdIdentityContextSchema", () => {
  const valid = {
    creatorIdentityId: "creator-1",
    productIdentityId: "product-1",
    consentRecordId: null,
    effectiveTier: 2,
    productTierAtResolution: 2,
    creatorTierAtResolution: 2,
    allowedShotTypes: ["simple_ugc", "talking_head"],
    allowedOutputIntents: ["draft", "preview", "final_export"],
    tier3Rules: {
      firstLastFrameRequired: false,
      performanceTransferRequired: false,
      editOverRegenerateRequired: false,
    },
    voiceId: null,
    productCanonicalText: "ACME Pro 200ml Hand Cream",
    productHeroPackshotAssetId: null,
    brandPositioningText: null,
    ugcStyleConstraints: [
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ],
    consentRevoked: false,
    identityContextVersion: "identity-context@1.0.0",
  };

  it("accepts a fully populated context", () => {
    expect(PcdIdentityContextSchema.safeParse(valid).success).toBe(true);
  });

  it("requires identityContextVersion", () => {
    const { identityContextVersion: _v, ...withoutVersion } = valid;
    expect(PcdIdentityContextSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it("rejects effectiveTier=0 or 4", () => {
    expect(PcdIdentityContextSchema.safeParse({ ...valid, effectiveTier: 0 }).success).toBe(false);
    expect(PcdIdentityContextSchema.safeParse({ ...valid, effectiveTier: 4 }).success).toBe(false);
  });

  it("rejects unknown shot type in allowedShotTypes", () => {
    expect(
      PcdIdentityContextSchema.safeParse({
        ...valid,
        allowedShotTypes: ["unknown_shot"],
      }).success,
    ).toBe(false);
  });

  it("requires all tier3Rules sub-flags", () => {
    expect(
      PcdIdentityContextSchema.safeParse({
        ...valid,
        tier3Rules: { firstLastFrameRequired: false },
      }).success,
    ).toBe(false);
  });
});

import {
  TrendStageOutputSchema,
  MotivatorsStageOutputSchema,
  HooksStageOutputSchema,
  HookTypeSchema,
} from "../pcd-preproduction.js";

describe("TrendStageOutputSchema", () => {
  const valid = {
    signals: [
      {
        id: "trend-1",
        summary: "Solo founders are losing leads after-hours",
        audienceFit: "founder/operator",
        evidenceRefs: [],
      },
    ],
  };
  it("accepts length-1 signal list", () => {
    expect(TrendStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty signals list", () => {
    expect(TrendStageOutputSchema.safeParse({ signals: [] }).success).toBe(false);
  });
  it("requires id, summary, audienceFit, evidenceRefs per signal", () => {
    expect(
      TrendStageOutputSchema.safeParse({
        signals: [{ id: "trend-1", summary: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("MotivatorsStageOutputSchema", () => {
  const valid = {
    motivators: [
      {
        id: "motivator-1",
        frictionOrDesire: "Slow lead reply kills conversion",
        audienceSegment: "solo-founder",
        evidenceRefs: [],
        parentTrendId: "trend-1",
      },
    ],
  };
  it("accepts length-1 motivators list with parentTrendId", () => {
    expect(MotivatorsStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires parentTrendId per motivator", () => {
    const noParent = { motivators: [{ ...valid.motivators[0], parentTrendId: undefined }] };
    expect(MotivatorsStageOutputSchema.safeParse(noParent).success).toBe(false);
  });
});

describe("HookTypeSchema", () => {
  it("accepts the four UGC hook types", () => {
    for (const v of ["direct_camera", "mid_action", "reaction", "text_overlay_start"]) {
      expect(HookTypeSchema.safeParse(v).success).toBe(true);
    }
  });
  it("rejects unknown hook types", () => {
    expect(HookTypeSchema.safeParse("voiceover_static").success).toBe(false);
  });
});

describe("HooksStageOutputSchema", () => {
  const valid = {
    hooks: [
      {
        id: "hook-1",
        text: "Still losing WhatsApp leads after running ads?",
        hookType: "direct_camera" as const,
        parentMotivatorId: "motivator-1",
        parentTrendId: "trend-1",
      },
    ],
  };
  it("accepts length-1 hooks list with both parent IDs", () => {
    expect(HooksStageOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("requires both parentMotivatorId and parentTrendId", () => {
    const { parentMotivatorId: _m, ...rest } = valid.hooks[0]!;
    expect(HooksStageOutputSchema.safeParse({ hooks: [rest] }).success).toBe(false);
  });
});

import {
  CreatorScriptSchema,
  CreatorScriptsStageOutputSchema,
} from "../pcd-preproduction.js";

describe("CreatorScriptSchema", () => {
  const baseFields = {
    id: "script-1",
    hookText: "Still losing WhatsApp leads after running ads?",
    creatorAngle: "founder explaining the hidden leak",
    visualBeats: ["show inbox", "show instant reply", "show booking"],
    productMoment: "Lead → reply → booking",
    cta: "Try Switchboard",
    complianceNotes: [],
    identityConstraints: {
      creatorIdentityId: "creator-1",
      productIdentityId: "product-1",
      voiceId: null,
    },
    parentHookId: "hook-1",
  };

  it("accepts a spoken_lines script", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: ["Most businesses don't lose leads because the ads are bad."],
      }).success,
    ).toBe(true);
  });

  it("accepts a talking_points script", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "talking_points",
        talkingPoints: ["Slow reply kills leads.", "Switchboard auto-replies."],
      }).success,
    ).toBe(true);
  });

  it("rejects a script with both spokenLines and talkingPoints", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: ["x"],
        talkingPoints: ["y"],
      }).success,
    ).toBe(false);
  });

  it("rejects a script with neither spokenLines nor talkingPoints", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
      }).success,
    ).toBe(false);
  });

  it("rejects a script with empty spokenLines list", () => {
    expect(
      CreatorScriptSchema.safeParse({
        ...baseFields,
        scriptStyle: "spoken_lines",
        spokenLines: [],
      }).success,
    ).toBe(false);
  });

  it("requires parentHookId", () => {
    const { parentHookId: _p, ...rest } = baseFields;
    expect(
      CreatorScriptSchema.safeParse({
        ...rest,
        scriptStyle: "spoken_lines",
        spokenLines: ["x"],
      }).success,
    ).toBe(false);
  });
});

describe("CreatorScriptsStageOutputSchema", () => {
  it("accepts length-1 scripts list", () => {
    const valid = {
      scripts: [
        {
          id: "script-1",
          hookText: "x",
          creatorAngle: "y",
          visualBeats: [],
          productMoment: "z",
          cta: "w",
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: "c1",
            productIdentityId: "p1",
            voiceId: null,
          },
          parentHookId: "h1",
          scriptStyle: "talking_points" as const,
          talkingPoints: ["a"],
        },
      ],
    };
    expect(CreatorScriptsStageOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty scripts list", () => {
    expect(CreatorScriptsStageOutputSchema.safeParse({ scripts: [] }).success).toBe(false);
  });
});
