// PCD slice SP13 — Synthetic creator selection decision schema.
// Pure zod surface; consumed by the pure selector at
// `packages/creative-pipeline/src/pcd/selector/selector.ts`.
//
// SP13 invariants encoded at schema level:
//   - selectorRank: z.literal(0)        — SP19 will widen
//   - performanceOverlayApplied: false  — SP19 will widen
//   - metricsSnapshotVersion: z.null()  — SP19 will widen to nullable string
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
    // SP13: strict z.null(). SP19 will widen to z.string().min(1).nullable()
    // when the performance overlay populates this slot.
    metricsSnapshotVersion: z.null(),
    performanceOverlayApplied: z.literal(false),
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

export const SyntheticCreatorSelectionDecisionSchema = z.union([
  SuccessDecisionSchema,
  RejectionDecisionSchema,
]);
export type SyntheticCreatorSelectionDecision = z.infer<
  typeof SyntheticCreatorSelectionDecisionSchema
>;
