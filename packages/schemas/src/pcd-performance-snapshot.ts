// PCD slice SP19 — PcdPerformanceSnapshot forensic record. Captures post-
// completion observability per AssetRecord attempt: terminal kind, latency,
// actual cost, error category, attempt context, and forensic version + capture
// timestamp.
//
// MERGE-BACK: net-new SP19 schema. No reconciliation needed at Switchboard
// merge for the schema itself (net-new on both sides). Switchboard may have
// a parallel CreativeJobPerformance or AssetTelemetry concept; reconcile then.
//
// MERGE-BACK: actualCostUsd / costActualReason populated upstream by the
// runner's billing-facade reconciliation (Stripe / Anthropic / per-provider
// invoice). SP19 marks the seam; integration is Switchboard-side.
//
// NB: z.union (not z.discriminatedUnion) — same Zod 3.x readonly carve-out as
// SP13/SP14/SP15/SP16/SP17/SP18. z.union parses by trying members in order;
// semantically equivalent for the 3-branch shape.

import { z } from "zod";

export const PcdPerformanceErrorCategorySchema = z.enum([
  "provider_timeout",
  "provider_error",
  "qc_rejection",
  "policy_denial",
  "internal_error",
]);
export type PcdPerformanceErrorCategory = z.infer<typeof PcdPerformanceErrorCategorySchema>;

const CostActualReasonInnerSchema = z
  .object({
    providerCalled: z.string().min(1).max(64),
    providerSku: z.string().min(1).max(128).nullable(),
    billingLineId: z.string().min(1).max(256).nullable(),
    note: z.string().max(500).nullable(),
  })
  .readonly();

export const PcdPerformanceSnapshotReasonSchema = z
  .object({
    performanceSnapshotVersion: z.string().min(1),
    capturedAt: z.string().datetime(),
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .readonly();
export type PcdPerformanceSnapshotReason = z.infer<typeof PcdPerformanceSnapshotReasonSchema>;

const SuccessInputSchema = z
  .object({
    terminalKind: z.literal("success"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.number().min(0),
    currency: z.literal("USD"),
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .strict()
  .readonly();

const FailureInputSchema = z
  .object({
    terminalKind: z.literal("failure"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.null(),
    currency: z.null(),
    errorCategory: PcdPerformanceErrorCategorySchema,
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .strict()
  .readonly();

const ManualSkipInputSchema = z
  .object({
    terminalKind: z.literal("manual_skip"),
    assetRecordId: z.string().min(1),
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.null(),
    currency: z.null(),
    costActual: CostActualReasonInnerSchema.nullable(),
  })
  .strict()
  .readonly();

export const PcdPerformanceSnapshotInputSchema = z.union([
  SuccessInputSchema,
  FailureInputSchema,
  ManualSkipInputSchema,
]);
export type PcdPerformanceSnapshotInput = z.infer<typeof PcdPerformanceSnapshotInputSchema>;

export const PcdPerformanceSnapshotPayloadSchema = z
  .object({
    assetRecordId: z.string().min(1),
    terminalKind: z.enum(["success", "failure", "manual_skip"]),
    errorCategory: PcdPerformanceErrorCategorySchema.nullable(),
    latencyMs: z.number().int().min(0),
    actualCostUsd: z.number().min(0).nullable(),
    currency: z.literal("USD").nullable(),
    costActualReason: PcdPerformanceSnapshotReasonSchema,
    attemptNumber: z.number().int().min(1),
    providerCalled: z.string().min(1).max(64),
    performanceSnapshotVersion: z.string().min(1),
    capturedAt: z.date(),
  })
  .readonly();
export type PcdPerformanceSnapshotPayload = z.infer<typeof PcdPerformanceSnapshotPayloadSchema>;
