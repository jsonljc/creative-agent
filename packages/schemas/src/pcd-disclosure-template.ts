// PCD slice SP14 — Disclosure registry payload + decision schemas.
// Per-jurisdiction × platform × treatment-class regulated-copy registry.
// Keyed exactly by (jurisdictionCode, platform, treatmentClass); no
// market axis, no wildcards. Half-open [effectiveFrom, effectiveTo)
// windows; monotonic per-tuple `version: int`.
//
// MERGE-BACK: Decision struct is zod-only in SP14. Persistence is SP17's
// responsibility (SP9 provenance widen). SP17 will add disclosureResolutionId
// and/or (disclosureTemplateId + disclosureTemplateVersion) to
// PcdIdentitySnapshot. Whether SP17 also persists resolvedDisclosureText
// (the full rendered text) is a separate decision for SP17 to make.
//
// NB: `z.union` not `z.discriminatedUnion`. Zod 3.x's discriminatedUnion
// requires each member to be a raw `ZodObject`, but SP14 applies `.readonly()`
// to each branch (matches SP13 precedent for readonly decision structs).
// `.readonly()` wraps the object and hides the discriminator field from the
// discriminatedUnion factory. `z.union` parses by trying members in order;
// semantically equivalent here because both branches are mutually exclusive
// on `allowed`.
import { z } from "zod";
import { JurisdictionCodeSchema, PlatformSchema } from "./creative-brief.js";
import { TreatmentClassSchema } from "./creator-identity-synthetic.js";

export const DisclosureTemplatePayloadSchema = z
  .object({
    id: z.string().min(1),
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    treatmentClass: TreatmentClassSchema,
    version: z.number().int().min(1),
    text: z.string().min(1).max(2000),
    effectiveFrom: z.date(),
    effectiveTo: z.date().nullable(),
  })
  .readonly()
  .refine(
    (t) => t.effectiveTo === null || t.effectiveTo.getTime() > t.effectiveFrom.getTime(),
    { message: "effectiveTo must be strictly after effectiveFrom (or null for indefinite)" },
  );
export type DisclosureTemplatePayload = z.infer<typeof DisclosureTemplatePayloadSchema>;

export const DisclosureResolutionRejectionReasonSchema = z.enum([
  "no_template_for_tuple",
  "no_active_template_at_now",
]);
export type DisclosureResolutionRejectionReason = z.infer<
  typeof DisclosureResolutionRejectionReasonSchema
>;

const DisclosureResolutionSuccessSchema = z
  .object({
    allowed: z.literal(true),
    briefId: z.string().min(1),
    disclosureTemplateId: z.string().min(1),
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    treatmentClass: TreatmentClassSchema,
    templateVersion: z.number().int().min(1),
    disclosureText: z.string().min(1),
    resolverVersion: z.string().min(1),
    decisionReason: z.string().min(1).max(2000),
  })
  .readonly();

const DisclosureResolutionRejectionSchema = z
  .object({
    allowed: z.literal(false),
    briefId: z.string().min(1),
    reason: DisclosureResolutionRejectionReasonSchema,
    jurisdictionCode: JurisdictionCodeSchema,
    platform: PlatformSchema,
    treatmentClass: TreatmentClassSchema,
    inspectedTemplateIds: z.array(z.string().min(1)).readonly(),
    resolverVersion: z.string().min(1),
  })
  .readonly();

export const DisclosureResolutionDecisionSchema = z.union([
  DisclosureResolutionSuccessSchema,
  DisclosureResolutionRejectionSchema,
]);
export type DisclosureResolutionDecision = z.infer<typeof DisclosureResolutionDecisionSchema>;
