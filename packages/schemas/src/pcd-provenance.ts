// PCD slice SP9 — Creative-source provenance schema. Bridges SP7/SP8's
// pre-production tree to SP4's per-asset PcdIdentitySnapshot so every
// generated asset carries a forensic lineage back to the brief that
// authorized it.
//
// Shape: denormalized — one row per asset, flat lineage columns. Mirrors
// SP4's routingDecisionReason precedent: flat columns for query performance,
// Json reason field for the full forensic trail. The chain output's
// parent*Id walk remains structurally reconstructible from the persisted
// PcdPreproductionChainResult JSON if needed.
import { z } from "zod";

export const PcdProvenanceLineageSchema = z
  .object({
    briefId: z.string().min(1),
    trendId: z.string().min(1),
    motivatorId: z.string().min(1),
    hookId: z.string().min(1),
    scriptId: z.string().min(1),
  })
  .readonly();
export type PcdProvenanceLineage = z.infer<typeof PcdProvenanceLineageSchema>;

export const PcdProvenanceDecisionReasonSchema = z
  .object({
    decidedAt: z.string().datetime(),
    fanoutDecisionId: z.string().min(1),
    chainVersion: z.string().min(1),
    provenanceVersion: z.string().min(1),
  })
  .readonly();
export type PcdProvenanceDecisionReason = z.infer<typeof PcdProvenanceDecisionReasonSchema>;

export const PcdSp9ProvenancePayloadSchema = z.object({
  briefId: z.string().min(1),
  trendId: z.string().min(1),
  motivatorId: z.string().min(1),
  hookId: z.string().min(1),
  scriptId: z.string().min(1),
  lineageDecisionReason: PcdProvenanceDecisionReasonSchema,
});
export type PcdSp9ProvenancePayload = z.infer<typeof PcdSp9ProvenancePayloadSchema>;
