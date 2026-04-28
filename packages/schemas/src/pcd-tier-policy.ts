import { z } from "zod";
import { IdentityTierSchema } from "./pcd-identity.js";

export const PcdShotTypeSchema = z.enum([
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
]);
export type PcdShotType = z.infer<typeof PcdShotTypeSchema>;

export const OutputIntentSchema = z.enum([
  "draft",
  "preview",
  "final_export",
  "meta_draft",
]);
export type OutputIntent = z.infer<typeof OutputIntentSchema>;

export const PcdRequiredActionSchema = z.enum([
  "upgrade_avatar_identity",
  "upgrade_product_identity",
  "use_lower_output_intent",
  "choose_safer_shot_type",
]);
export type PcdRequiredAction = z.infer<typeof PcdRequiredActionSchema>;

export const PcdTierDecisionSchema = z.object({
  allowed: z.boolean(),
  effectiveTier: IdentityTierSchema,
  requiredAvatarTier: IdentityTierSchema.optional(),
  requiredProductTier: IdentityTierSchema.optional(),
  reason: z.string().optional(),
  requiredActions: z.array(PcdRequiredActionSchema).optional(),
});
export type PcdTierDecision = z.infer<typeof PcdTierDecisionSchema>;
