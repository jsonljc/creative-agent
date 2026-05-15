// SP20 — in-memory CreatorPerformanceMetrics reader.
// Runtime test double for SP21+ composer tests; not used by SP20 selector
// tests (those use a plain Map<string, CreatorPerformanceMetrics>).
//
// Imports the version constant from @creativeagent/schemas per Guardrail C-1
// (schema-owned constant). One of the two allowlisted runtime importers of
// PCD_PERFORMANCE_OVERLAY_VERSION (anti-pattern test #3).
//
// MERGE-BACK: shipped at @creativeagent/db package locality; rename pass at merge.

import {
  PCD_PERFORMANCE_OVERLAY_VERSION,
  type CreatorPerformanceMetrics,
} from "@creativeagent/schemas";

export type FindMetricsForCreatorsInput = {
  creatorIdentityIds: readonly string[];
  window: { since: Date };
};

export class InMemoryPcdCreatorPerformanceMetricsReader {
  constructor(private readonly seed: ReadonlyMap<string, CreatorPerformanceMetrics>) {}

  async findMetricsForCreators(
    input: FindMetricsForCreatorsInput,
  ): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>> {
    const out = new Map<string, CreatorPerformanceMetrics>();
    const now = new Date();
    for (const id of input.creatorIdentityIds) {
      const seeded = this.seed.get(id);
      if (seeded !== undefined) {
        out.set(id, seeded);
      } else {
        out.set(id, {
          creatorIdentityId: id,
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
          windowStart: input.window.since,
          windowEnd: now,
          metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
        });
      }
    }
    return out;
  }
}
