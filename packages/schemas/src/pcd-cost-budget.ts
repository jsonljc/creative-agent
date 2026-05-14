// SP10C — Cost-budget enforcement schemas. Two zod schemas:
//   1. CoarseCostEstimatorOutputSchema — defense-in-depth parser for the
//      injected CoarseCostEstimator's output. Locks currency to "USD".
//   2. CostBudgetMetaSchema — forensic record carried on the SP10C orchestrator
//      success outcome (costMeta) AND on CostBudgetExceededError.meta (failure).
//      Single source of truth for dashboard rendering on both paths.
import { z } from "zod";

export const CoarseCostEstimatorOutputSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  lineItems: z
    .array(
      z.object({
        label: z.string().min(1),
        estimatedUsd: z.number().nonnegative(),
      }),
    )
    .readonly(),
  estimatorVersion: z.string().min(1),
});

export const CostBudgetMetaSchema = z.object({
  costBudgetVersion: z.string().min(1),
  estimatorVersion: z.string().min(1),
  estimatedUsd: z.number().nonnegative(),
  currency: z.literal("USD"),
  threshold: z.number().positive(),
  lineItems: z
    .array(
      z.object({
        label: z.string().min(1),
        estimatedUsd: z.number().nonnegative(),
      }),
    )
    .readonly(),
  estimatedAt: z.string().datetime(),
});
export type CostBudgetMeta = z.infer<typeof CostBudgetMetaSchema>;
