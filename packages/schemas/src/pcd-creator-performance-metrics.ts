// SP20 — CreatorPerformanceMetrics schema.
//
// Per-creator aggregation grain (per-creator overall in v1).
//
// MERGE-BACK: SP20.1 may add byShotType?: Record<PcdShotType, CreatorPerformanceMetrics>
// MERGE-BACK: SP20.5 may add costVarianceUsd?: number — joins SP10A forecast × SP19 actual.
//
// Cross-field invariants (enforced via .refine() — defense-in-depth at every
// reader boundary, not a comment promise):
//   - successCount + failureCount + manualSkipCount === sampleSize
//   - sampleSize === 0  ⇒ medianLatencyMs === null AND successRate === 0
//   - sampleSize > 0    ⇒ medianLatencyMs !== null
//   - windowEnd > windowStart
// NOT enforced in schema (would couple schema load order to constant):
//   - metricsVersion === PCD_PERFORMANCE_OVERLAY_VERSION
//   Anti-pattern test #3 + the bounded reader-importer allowlist (only two
//   non-test runtime sources import the constant) together guarantee this at
//   production-write time. Tests assert it at the reader-output boundary.

import { z } from "zod";

export const CreatorPerformanceMetricsSchema = z
  .object({
    creatorIdentityId: z.string().min(1),
    sampleSize: z.number().int().min(0),
    successCount: z.number().int().min(0),
    failureCount: z.number().int().min(0),
    manualSkipCount: z.number().int().min(0),
    successRate: z.number().min(0).max(1),
    medianLatencyMs: z.number().int().min(0).nullable(),
    windowStart: z.date(),
    windowEnd: z.date(),
    metricsVersion: z.string().min(1),
  })
  .strict()
  .refine((m) => m.successCount + m.failureCount + m.manualSkipCount === m.sampleSize, {
    path: ["sampleSize"],
    message: "counts must sum to sampleSize",
  })
  .refine(
    (m) =>
      m.sampleSize === 0
        ? m.successRate === 0 && m.medianLatencyMs === null
        : m.medianLatencyMs !== null,
    {
      path: ["medianLatencyMs"],
      message: "medianLatencyMs/successRate must match sampleSize",
    },
  )
  .refine((m) => m.windowEnd.getTime() > m.windowStart.getTime(), {
    path: ["windowEnd"],
    message: "windowEnd must be after windowStart",
  })
  .readonly();

export type CreatorPerformanceMetrics = z.infer<typeof CreatorPerformanceMetricsSchema>;
