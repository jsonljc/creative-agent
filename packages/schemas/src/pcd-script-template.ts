// PCD slice SP15 — Script-template registry zod surface. Mirrors SP14
// (disclosure-template) and SP13 (synthetic-creator selector) precedent:
// readonly payload + readonly discriminated decision (success + failure
// branches). Consumed by Prisma reader (parse-at-the-edges) and by the
// pure selectScript() resolver in the creative-pipeline package.
//
// Material SP14↔SP15 difference: SP15 is creator-keyed. The selector
// takes a bare creatorIdentityId parameter, NOT the SP13
// SyntheticCreatorSelectionDecision. The composer (SP21) joins SP13 +
// SP14 + SP15 decisions for provenance.
import { z } from "zod";
import { TreatmentClassSchema, VibeSchema } from "./creator-identity-synthetic.js";

export const ScriptTemplateStatusSchema = z.enum(["active", "retired"]);
export type ScriptTemplateStatus = z.infer<typeof ScriptTemplateStatusSchema>;

export const ScriptTemplatePayloadSchema = z
  .object({
    id: z.string().min(1),
    vibe: VibeSchema,
    treatmentClass: TreatmentClassSchema,
    text: z.string().min(1).max(8000),
    compatibleCreatorIdentityIds: z
      .array(z.string().min(1))
      .min(1)
      .readonly()
      .refine((ids) => !ids.includes("*"), {
        message: "wildcard creator compatibility forbidden in v1",
      }),
    version: z.number().int().min(1),
    status: ScriptTemplateStatusSchema,
  })
  .readonly();
export type ScriptTemplatePayload = z.infer<typeof ScriptTemplatePayloadSchema>;

export const ScriptSelectionRejectionReasonSchema = z.enum([
  "no_compatible_script",
  "all_filtered_by_creator",
]);
export type ScriptSelectionRejectionReason = z.infer<
  typeof ScriptSelectionRejectionReasonSchema
>;

// NB: `z.union` not `z.discriminatedUnion`. Zod 3.x's discriminatedUnion
// factory does not see literal discriminators on branches wrapped in
// `.readonly()` — the `allowed: z.literal(true) | z.literal(false)` slot
// is invisible to the discriminatedUnion factory. `z.union` parses by
// trying members in order; semantically equivalent for our two-branch
// decision shape. Same carve-out as SP13's SyntheticCreatorSelectionDecision
// (packages/schemas/src/pcd-synthetic-selector.ts) and SP14's
// DisclosureResolutionDecision (packages/schemas/src/pcd-disclosure-template.ts).
export const ScriptSelectionDecisionSchema = z.union([
  z
    .object({
      allowed: z.literal(true),
      briefId: z.string().min(1),
      scriptTemplateId: z.string().min(1),
      vibe: VibeSchema,
      treatmentClass: TreatmentClassSchema,
      scriptTemplateVersion: z.number().int().min(1),
      creatorIdentityId: z.string().min(1),
      scriptText: z.string().min(1),
      selectorVersion: z.string().min(1),
      decisionReason: z.string().min(1).max(2000),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      briefId: z.string().min(1),
      reason: ScriptSelectionRejectionReasonSchema,
      vibe: VibeSchema,
      treatmentClass: TreatmentClassSchema,
      creatorIdentityId: z.string().min(1),
      inspectedTemplateIds: z.array(z.string().min(1)).readonly(),
      selectorVersion: z.string().min(1),
    })
    .readonly(),
]);
export type ScriptSelectionDecision = z.infer<typeof ScriptSelectionDecisionSchema>;
