// SP20 test fixture — builds a Zod-valid CreatorPerformanceMetrics with
// sensible defaults; accepts partial overrides. Imports the version
// constant from @creativeagent/schemas per Guardrail C-1 (schemas-owned).
// .fixture.ts files are allowlisted by anti-pattern test #3 as permitted
// importers of PCD_PERFORMANCE_OVERLAY_VERSION.
import { PCD_PERFORMANCE_OVERLAY_VERSION, type CreatorPerformanceMetrics } from "@creativeagent/schemas";

const BASELINE: CreatorPerformanceMetrics = {
  creatorIdentityId: "creator-baseline",
  sampleSize: 10,
  successCount: 7,
  failureCount: 2,
  manualSkipCount: 1,
  successRate: 0.7,
  medianLatencyMs: 1500,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
};

export function buildCreatorPerformanceMetrics(
  overrides: Partial<CreatorPerformanceMetrics> = {},
): CreatorPerformanceMetrics {
  return { ...BASELINE, ...overrides };
}
