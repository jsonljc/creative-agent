// PCD slice SP18 — Synthetic-routing-provenance forensic record. Carries the
// SP17 synthetic-pairing-success decision's persisted form on PcdIdentitySnapshot.
// Discriminated on videoProvider for the direction-bearing Json.
//
// MERGE-BACK: net-new SP18 schema. No reconciliation needed at Switchboard
// merge (net-new on both sides). If Switchboard adds provider-specific fields
// later, this schema widens here first and merges back additively.
//
// NB: z.union (not z.discriminatedUnion) — same Zod 3.x readonly carve-out as
// SP13/SP14/SP15/SP16/SP17. z.union parses by trying members in order;
// semantically equivalent for the 2-branch shape.
import { z } from "zod";
import {
  KlingDirectionSchema,
  SeedanceDirectionSchema,
} from "./creator-identity-synthetic.js";
import { PcdShotTypeSchema, OutputIntentSchema } from "./pcd-identity.js";

const DecisionReasonInnerSchema = z
  .object({
    matchedShotType: PcdShotTypeSchema,
    matchedOutputIntent: OutputIntentSchema,
    selectionRationale: z.string().min(1).max(200),
  })
  .readonly();

// MERGE-BACK: SP18 Json-reason union. Two branches discriminated on
// videoProvider; provider-specific direction artifact lives on the
// matching branch only (no cross-binding).
export const PcdSp18SyntheticRoutingDecisionReasonSchema = z.union([
  z
    .object({
      videoProvider: z.literal("kling"),
      klingDirection: KlingDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .strict()
    .readonly(),

  z
    .object({
      videoProvider: z.literal("seedance"),
      seedanceDirection: SeedanceDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .strict()
    .readonly(),
]);
export type PcdSp18SyntheticRoutingDecisionReason = z.infer<
  typeof PcdSp18SyntheticRoutingDecisionReasonSchema
>;

// MERGE-BACK: SP18 persistence shape. 6 flat columns + 1 Json reason.
// Cross-field refine: payload.videoProvider MUST match the reason Json's
// videoProvider. Stamper constructs both from the same source value; refine
// defends against tampered or hand-constructed payloads (external callers,
// merge-back integration).
export const PcdSp18SyntheticRoutingProvenancePayloadSchema = z
  .object({
    imageProvider: z.literal("dalle"),
    videoProvider: z.union([z.literal("kling"), z.literal("seedance")]),
    videoProviderChoice: z.union([z.literal("kling"), z.literal("seedance")]),
    syntheticRouterVersion: z.string().min(1),
    syntheticPairingVersion: z.string().min(1),
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),
    syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReasonSchema,
  })
  .refine(
    (payload) =>
      payload.videoProvider === payload.syntheticRoutingDecisionReason.videoProvider,
    {
      path: ["syntheticRoutingDecisionReason", "videoProvider"],
      message:
        "syntheticRoutingDecisionReason.videoProvider must match flat videoProvider",
    },
  );
export type PcdSp18SyntheticRoutingProvenancePayload = z.infer<
  typeof PcdSp18SyntheticRoutingProvenancePayloadSchema
>;
