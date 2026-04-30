// PCD slice SP11 — Synthetic creator identity foundation. Adds the
// `kind` discriminator, the synthetic-only enums (treatment-class /
// vibe / market / ethnicity-family / age-band / price-positioning),
// and the CreatorIdentitySynthetic extension payload. Real-kind
// CreatorIdentity rows are unaffected; synthetic rows pair one-to-one
// with a CreatorIdentitySynthetic row. License gate (SP12), disclosure
// registry (SP13), and selector (SP14) consume these enums but do not
// modify them.
import { z } from "zod";

export const CreatorIdentityKindSchema = z.enum(["real", "synthetic"]);
export type CreatorIdentityKind = z.infer<typeof CreatorIdentityKindSchema>;

// v1 treatment classes — slimming is deferred per spec §11 (regulatory
// exposure). Adding a new class requires a new DisclosureTemplate row
// per (jurisdiction × platform × treatment-class) — see SP13.
export const TreatmentClassSchema = z.enum(["med_spa", "dental", "anti_ageing", "halal_wellness"]);
export type TreatmentClass = z.infer<typeof TreatmentClassSchema>;

// v1 vibes — skeptic_converted is deferred per spec §11 (Phase 3).
export const VibeSchema = z.enum([
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
]);
export type Vibe = z.infer<typeof VibeSchema>;

export const MarketSchema = z.enum(["SG", "MY", "HK"]);
export type Market = z.infer<typeof MarketSchema>;

export const EthnicityFamilySchema = z.enum([
  "sg_chinese",
  "my_chinese",
  "thai_chinese",
  "filipino_sg",
  "my_malay",
  "hk_chinese",
]);
export type EthnicityFamily = z.infer<typeof EthnicityFamilySchema>;

export const AgeBandSchema = z.enum(["gen_z", "mid_20s", "early_30s", "mid_35s_plus"]);
export type AgeBand = z.infer<typeof AgeBandSchema>;

export const PricePositioningSchema = z.enum(["entry", "standard", "premium"]);
export type PricePositioning = z.infer<typeof PricePositioningSchema>;

export const SyntheticStatusSchema = z.enum(["active", "retired"]);
export type SyntheticStatus = z.infer<typeof SyntheticStatusSchema>;

export const PhysicalDescriptorsSchema = z
  .object({
    faceShape: z.string().min(1),
    skinTone: z.string().min(1),
    eyeShape: z.string().min(1),
    hair: z.string().min(1),
    ageRead: z.string().min(1),
    buildNote: z.string().min(1),
  })
  .readonly();
export type PhysicalDescriptors = z.infer<typeof PhysicalDescriptorsSchema>;

export const KlingDirectionSchema = z
  .object({
    setting: z.string().min(1),
    motion: z.string().min(1),
    energy: z.string().min(1),
    lighting: z.string().min(1),
    avoid: z.array(z.string().min(1)).readonly(),
  })
  .readonly();
export type KlingDirection = z.infer<typeof KlingDirectionSchema>;

export const VoiceCaptionStyleSchema = z
  .object({
    voice: z.string().min(1),
    captionStyle: z.string().min(1),
    sampleHook: z.string().min(1),
    sampleCta: z.string().min(1),
  })
  .readonly();
export type VoiceCaptionStyle = z.infer<typeof VoiceCaptionStyleSchema>;

export const CreatorIdentitySyntheticPayloadSchema = z
  .object({
    creatorIdentityId: z.string().min(1),
    treatmentClass: TreatmentClassSchema,
    vibe: VibeSchema,
    market: MarketSchema,
    ethnicityFamily: EthnicityFamilySchema,
    ageBand: AgeBandSchema,
    pricePositioning: PricePositioningSchema,
    physicalDescriptors: PhysicalDescriptorsSchema,
    dallePromptLocked: z.string().min(1).max(4000),
    klingDirection: KlingDirectionSchema,
    voiceCaptionStyle: VoiceCaptionStyleSchema,
    mutuallyExclusiveWithIds: z.array(z.string().min(1)).readonly(),
    status: SyntheticStatusSchema,
  })
  .readonly();
export type CreatorIdentitySyntheticPayload = z.infer<typeof CreatorIdentitySyntheticPayloadSchema>;
