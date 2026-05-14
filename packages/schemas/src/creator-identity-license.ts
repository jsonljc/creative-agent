// PCD slice SP12 — Creator identity license payload. Per-clinic leasing
// over (creatorIdentityId, market, treatmentClass) for synthetic creators.
// Three lock-types per design spec §3.3:
//   - hard_exclusive   only the holder can use the creator at job time
//   - priority_access  multiple holders allowed; downstream ordering by priorityRank
//   - soft_exclusive   single primary, others pass with override flag in provenance
// The pure license-gate (`packages/creative-pipeline/src/pcd/synthetic-creator/
// license-gate.ts`) consumes this schema as a snapshot input. Real-kind
// CreatorIdentity rows continue through SP6 consent enforcement; the gate is
// invoked only for kind="synthetic".
import { z } from "zod";
import { MarketSchema, TreatmentClassSchema } from "./creator-identity-synthetic.js";

export const LockTypeSchema = z.enum(["hard_exclusive", "priority_access", "soft_exclusive"]);
export type LockType = z.infer<typeof LockTypeSchema>;

export const LeaseStatusSchema = z.enum(["active", "suspended", "expired", "superseded"]);
export type LeaseStatus = z.infer<typeof LeaseStatusSchema>;

export const ExclusivityScopeSchema = z.enum(["market_treatment", "free"]);
export type ExclusivityScope = z.infer<typeof ExclusivityScopeSchema>;

export const CreatorIdentityLicensePayloadSchema = z
  .object({
    id: z.string().min(1),
    creatorIdentityId: z.string().min(1),
    clinicId: z.string().min(1),
    market: MarketSchema,
    treatmentClass: TreatmentClassSchema,
    lockType: LockTypeSchema,
    exclusivityScope: ExclusivityScopeSchema,
    effectiveFrom: z.date(),
    effectiveTo: z.date().nullable(),
    priorityRank: z.number().int().min(0).nullable(),
    status: LeaseStatusSchema,
  })
  .readonly()
  .refine(
    (lease) =>
      lease.effectiveTo === null ||
      lease.effectiveTo.getTime() > lease.effectiveFrom.getTime(),
    { message: "effectiveTo must be strictly after effectiveFrom (or null for indefinite leases)" },
  );
export type CreatorIdentityLicensePayload = z.infer<typeof CreatorIdentityLicensePayloadSchema>;
