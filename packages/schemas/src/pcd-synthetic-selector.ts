// PCD slice SP13 — Synthetic creator selection decision schema.
// Pure zod surface; consumed by the pure selector at
// `packages/creative-pipeline/src/pcd/selector/selector.ts`.
//
// SP13 invariants encoded at schema level (SP20-widened where noted):
//   - selectorRank: z.literal(0)                            — reserved (a future slice may widen)
//   - performanceOverlayApplied: z.boolean()                — SP20 widened (was z.literal(false))
//   - metricsSnapshotVersion: z.string().min(1).nullable()  — SP20 widened (was z.null())
//
// No persistence in SP13; SP17 will widen PcdIdentitySnapshot with a
// selectionDecisionId column when provenance lights up.
import { z } from "zod";
import { LockTypeSchema } from "./creator-identity-license.js";

export const SyntheticCreatorSelectorRejectionReasonSchema = z.enum([
  "no_compatible_candidates",
  "all_blocked_by_license",
]);
export type SyntheticCreatorSelectorRejectionReason = z.infer<
  typeof SyntheticCreatorSelectorRejectionReasonSchema
>;

const SuccessDecisionSchema = z
  .object({
    allowed: z.literal(true),
    briefId: z.string().min(1),
    selectedCreatorIdentityId: z.string().min(1),
    fallbackCreatorIdentityIds: z.array(z.string().min(1)).readonly(),
    selectedLicenseId: z.string().min(1),
    selectedLockType: LockTypeSchema,
    isSoftExclusivityOverride: z.boolean(),
    selectorVersion: z.string().min(1),
    selectorRank: z.literal(0),
    // SP20 widened: was z.null() in SP13; SP20 populates with PCD_PERFORMANCE_OVERLAY_VERSION
    // (read-through from the supplied performanceHistory map) when overlay is applied
    // and the map is non-empty; null otherwise.
    metricsSnapshotVersion: z.string().min(1).nullable(),
    performanceOverlayApplied: z.boolean(),
    decisionReason: z.string().min(1).max(2000),
  })
  .readonly();

const RejectionDecisionSchema = z
  .object({
    allowed: z.literal(false),
    briefId: z.string().min(1),
    reason: SyntheticCreatorSelectorRejectionReasonSchema,
    compatibleCandidateIds: z.array(z.string().min(1)).readonly(),
    blockedCandidateIds: z.array(z.string().min(1)).readonly(),
    selectorVersion: z.string().min(1),
  })
  .readonly();

// NB: `z.union` not `z.discriminatedUnion`. Zod 3.x's discriminatedUnion
// requires each member to be a raw `ZodObject`, but our SP13 invariant
// applies `.readonly()` to each branch (matches SP10B / SP12 precedent
// for readonly decision structs). `.readonly()` wraps the object and
// hides the discriminator field from the discriminatedUnion factory.
// `z.union` parses by trying members in order; semantically equivalent
// here because both branches are mutually exclusive on `allowed`.
export const SyntheticCreatorSelectionDecisionSchema = z.union([
  SuccessDecisionSchema,
  RejectionDecisionSchema,
]);
export type SyntheticCreatorSelectionDecision = z.infer<
  typeof SyntheticCreatorSelectionDecisionSchema
>;
