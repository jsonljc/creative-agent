// PCD slice SP11 — CreativeBrief schema. The structured contract that
// pre-production analysis emits and the SP14 SyntheticCreatorSelector
// consumes. Two-stage selection: LLM analysis is reviewable, selector
// is pure and deterministic over this typed brief.
import { z } from "zod";
import {
  AgeBandSchema,
  EthnicityFamilySchema,
  MarketSchema,
  PricePositioningSchema,
  TreatmentClassSchema,
  VibeSchema,
} from "./creator-identity-synthetic.js";

export const JurisdictionCodeSchema = z.enum(["SG", "MY", "HK"]);
export type JurisdictionCode = z.infer<typeof JurisdictionCodeSchema>;

export const PlatformSchema = z.enum(["meta", "tiktok", "red", "youtube_shorts"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const CreativeBriefSchema = z
  .object({
    briefId: z.string().min(1),
    clinicId: z.string().min(1),
    treatmentClass: TreatmentClassSchema,
    market: MarketSchema,
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    targetVibe: VibeSchema,
    targetEthnicityFamily: EthnicityFamilySchema,
    targetAgeBand: AgeBandSchema,
    pricePositioning: PricePositioningSchema,
    hardConstraints: z.array(z.string().min(1)).readonly(),
  })
  .readonly();
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
