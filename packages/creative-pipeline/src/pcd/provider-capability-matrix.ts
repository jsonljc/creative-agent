import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_PROVIDER_CAPABILITY_VERSION = "provider-capability@1.0.0";

export type PcdProviderCapability = {
  provider: string;
  tiers: ReadonlyArray<IdentityTier>;
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  supportsFirstLastFrame: boolean;
  supportsEditExtend: boolean;
  supportsPerformanceTransfer: boolean;
};

// Declarative provider capability matrix. Order is policy:
// `routePcdShot` selects first-match. Rows are authored to satisfy the
// matrix coverage and Tier 3 capability sufficiency tests, including the
// rule-1+2+3 combined-flag-on-single-row requirement.
export const PCD_PROVIDER_CAPABILITY_MATRIX: ReadonlyArray<PcdProviderCapability> = [
  // Tier 1/2 draft / storyboard / script — text/image-only providers, no edit/extend.
  {
    provider: "openai_text",
    tiers: [1, 2],
    shotTypes: ["script_only", "storyboard"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: false,
    supportsEditExtend: false,
    supportsPerformanceTransfer: false,
  },

  // Tier 3 script / storyboard — same provider but with edit/extend enabled to
  // satisfy the Tier 3 rule-1+2+3 single-row sufficiency requirement.
  {
    provider: "openai_text",
    tiers: [3],
    shotTypes: ["script_only", "storyboard"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: false,
    supportsEditExtend: true,
    supportsPerformanceTransfer: false,
  },

  // Runway — Tier 1/2/3 video, supports first/last-frame, edit/extend, and Act-Two
  // performance transfer. Single row that satisfies Tier 3 rule 1 + 2 + 3 for
  // all video shot types including talking_head. Tier 1 is included so that
  // Tier-1 draft video shots (the only intent SP2 allows at Tier 1) are covered.
  {
    provider: "runway",
    tiers: [1, 2, 3],
    shotTypes: [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: true,
  },

  // Kling — Tier 1/2/3, first/last-frame + edit/extend; no performance transfer.
  // Tier 1 included for draft video shot coverage.
  {
    provider: "kling",
    tiers: [1, 2, 3],
    shotTypes: [
      "simple_ugc",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: true,
    supportsEditExtend: true,
    supportsPerformanceTransfer: false,
  },

  // HeyGen — Tier 2/3 talking-head digital twin (performance transfer);
  // no first/last-frame or edit/extend at this tier.
  {
    provider: "heygen",
    tiers: [2, 3],
    shotTypes: ["talking_head"],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    supportsFirstLastFrame: false,
    supportsEditExtend: false,
    supportsPerformanceTransfer: true,
  },
] as const;
