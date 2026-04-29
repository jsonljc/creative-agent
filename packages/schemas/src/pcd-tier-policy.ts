import { z } from "zod";
import { IdentityTierSchema } from "./pcd-identity.js";

// Re-export so @creativeagent/schemas barrel consumers continue to find them here.
export { PcdShotTypeSchema, OutputIntentSchema } from "./pcd-identity.js";
export type { PcdShotType, OutputIntent } from "./pcd-identity.js";

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
