// SP7 — Identity-Aware Pre-Production Chain schemas.
// Source of truth: docs/plans/2026-04-29-pcd-preproduction-chain-sp7-design.md
import { z } from "zod";
import {
  IdentityTierSchema,
  OutputIntentSchema,
  PcdShotTypeSchema,
} from "./pcd-identity.js";

// Stage discriminant for PreproductionChainError. Also used by anti-pattern
// grep tests to enforce that no SP7 source dispatches by stage name outside
// the error-class discriminator.
export const PreproductionChainStageEnumSchema = z.enum([
  "trends",
  "motivators",
  "hooks",
  "creator_scripts",
  "production_fanout_gate",
]);
export type PreproductionChainStage = z.infer<typeof PreproductionChainStageEnumSchema>;

// UGC creative-format constraints. Lives in PcdIdentityContext so every stage
// runner consumes the same UGC-format ground truth — prevents drift toward
// polished ad-film language.
export const UgcStyleConstraintSchema = z.enum([
  "native_vertical",                  // 9:16 selfie-style framing
  "creator_led",                      // first-person creator voice
  "no_overproduced_storyboard",       // no studio-shoot framing
  "product_fidelity_required",        // canonical text/logo faithfulness
  "no_invented_product_claims",       // no claims absent from registry
]);
export type UgcStyleConstraint = z.infer<typeof UgcStyleConstraintSchema>;

// Brief input schema: creator+product context, platform targets, and style guide.
// Required for all preproduction chain jobs. Combines identity refs with creative
// direction to ensure every stage runner has authoritative context.
export const PcdBriefInputSchema = z.object({
  briefId: z.string().min(1),
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(z.string().min(1)),
  brandVoice: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  creatorIdentityRef: z.string().min(1),
  productIdentityRef: z.string().min(1),
});
export type PcdBriefInput = z.infer<typeof PcdBriefInputSchema>;

// Identity context schema: resolved per-job identity state with tier projection,
// creative substrate, and UGC-format constraints. Stamped at identity-resolve time
// and immutable for the entire preproduction chain. Every stage runner consumes
// the same context to prevent drift toward polished ad-film language.
export const PcdIdentityContextSchema = z.object({
  // Identity refs
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  consentRecordId: z.string().nullable(),

  // Tier projection (stamped at resolve-time)
  effectiveTier: IdentityTierSchema,
  productTierAtResolution: IdentityTierSchema,
  creatorTierAtResolution: IdentityTierSchema,
  allowedShotTypes: z.array(PcdShotTypeSchema),
  allowedOutputIntents: z.array(OutputIntentSchema),

  // Tier 3 rule flags
  tier3Rules: z.object({
    firstLastFrameRequired: z.boolean(),
    performanceTransferRequired: z.boolean(),
    editOverRegenerateRequired: z.boolean(),
  }),

  // Creative substrate
  voiceId: z.string().nullable(),
  productCanonicalText: z.string(),
  productHeroPackshotAssetId: z.string().nullable(),
  brandPositioningText: z.string().nullable(),

  // UGC creative-format constraints
  ugcStyleConstraints: z.array(UgcStyleConstraintSchema),

  // Consent flag
  consentRevoked: z.boolean(),

  // Version pin
  identityContextVersion: z.string(),
});
export type PcdIdentityContext = z.infer<typeof PcdIdentityContextSchema>;

export const TrendSignalSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  audienceFit: z.string(),
  evidenceRefs: z.array(z.string()),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export const TrendStageOutputSchema = z.object({
  signals: z.array(TrendSignalSchema).min(1),
});
export type TrendStageOutput = z.infer<typeof TrendStageOutputSchema>;

export const MotivatorSchema = z.object({
  id: z.string().min(1),
  frictionOrDesire: z.string().min(1),
  audienceSegment: z.string(),
  evidenceRefs: z.array(z.string()),
  parentTrendId: z.string().min(1),
});
export type Motivator = z.infer<typeof MotivatorSchema>;

export const MotivatorsStageOutputSchema = z.object({
  motivators: z.array(MotivatorSchema).min(1),
});
export type MotivatorsStageOutput = z.infer<typeof MotivatorsStageOutputSchema>;

export const HookTypeSchema = z.enum([
  "direct_camera",
  "mid_action",
  "reaction",
  "text_overlay_start",
]);
export type HookType = z.infer<typeof HookTypeSchema>;

export const HookSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  hookType: HookTypeSchema,
  parentMotivatorId: z.string().min(1),
  parentTrendId: z.string().min(1),
});
export type Hook = z.infer<typeof HookSchema>;

export const HooksStageOutputSchema = z.object({
  hooks: z.array(HookSchema).min(1),
});
export type HooksStageOutput = z.infer<typeof HooksStageOutputSchema>;

export const CreatorScriptIdentityConstraintsSchema = z.object({
  creatorIdentityId: z.string().min(1),
  productIdentityId: z.string().min(1),
  voiceId: z.string().nullable(),
});
export type CreatorScriptIdentityConstraints = z.infer<
  typeof CreatorScriptIdentityConstraintsSchema
>;

const CreatorScriptBaseShape = z.object({
  id: z.string().min(1),
  hookText: z.string().min(1),
  creatorAngle: z.string(),
  visualBeats: z.array(z.string()),
  productMoment: z.string(),
  cta: z.string(),
  complianceNotes: z.array(z.string()),
  identityConstraints: CreatorScriptIdentityConstraintsSchema,
  parentHookId: z.string().min(1),
});

// Discriminated union: exactly one of spokenLines OR talkingPoints. Per the
// SP7 design Q10 lock — neither both nor neither is valid.
export const CreatorScriptSchema = z.discriminatedUnion("scriptStyle", [
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("spoken_lines"),
    spokenLines: z.array(z.string()).min(1),
  }).strict(),
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("talking_points"),
    talkingPoints: z.array(z.string()).min(1),
  }).strict(),
]);
export type CreatorScript = z.infer<typeof CreatorScriptSchema>;

export const CreatorScriptsStageOutputSchema = z.object({
  scripts: z.array(CreatorScriptSchema).min(1),
});
export type CreatorScriptsStageOutput = z.infer<typeof CreatorScriptsStageOutputSchema>;
