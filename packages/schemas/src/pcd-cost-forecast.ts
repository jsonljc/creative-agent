// PCD slice SP10A — Cost-forecast forensic record. Bridges the injected
// CostEstimator's runtime output to the per-asset PcdIdentitySnapshot's
// new costForecastReason Json column.
//
// Shape: full forensic struct; one record per asset; pinned costForecastVersion
// orthogonal to the runtime estimatorVersion the estimator returned.
import { z } from "zod";

export const PcdSp10CostLineItemSchema = z
  .object({
    label: z.string().min(1),
    estimatedUsd: z.number().nonnegative(),
  })
  .readonly();
export type PcdSp10CostLineItem = z.infer<typeof PcdSp10CostLineItemSchema>;

export const PcdSp10CostForecastReasonSchema = z
  .object({
    estimatedUsd: z.number().nonnegative(),
    currency: z.literal("USD"),
    lineItems: z.array(PcdSp10CostLineItemSchema).readonly(),
    costForecastVersion: z.string().min(1),
    estimatorVersion: z.string().min(1),
    estimatedAt: z.string().datetime(),
  })
  .readonly();
export type PcdSp10CostForecastReason = z.infer<typeof PcdSp10CostForecastReasonSchema>;
