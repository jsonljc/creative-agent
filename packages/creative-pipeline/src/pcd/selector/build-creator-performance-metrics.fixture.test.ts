import { describe, expect, it } from "vitest";
import { CreatorPerformanceMetricsSchema } from "@creativeagent/schemas";
import { buildCreatorPerformanceMetrics } from "./build-creator-performance-metrics.fixture.js";

describe("buildCreatorPerformanceMetrics", () => {
  it("returns a Zod-valid baseline record", () => {
    const metrics = buildCreatorPerformanceMetrics();
    expect(() => CreatorPerformanceMetricsSchema.parse(metrics)).not.toThrow();
  });

  it("applies overrides", () => {
    const metrics = buildCreatorPerformanceMetrics({
      creatorIdentityId: "creator-X",
      sampleSize: 0,
      successCount: 0,
      failureCount: 0,
      manualSkipCount: 0,
      successRate: 0,
      medianLatencyMs: null,
    });
    expect(metrics.creatorIdentityId).toBe("creator-X");
    expect(metrics.sampleSize).toBe(0);
    expect(metrics.medianLatencyMs).toBeNull();
  });

  it("baseline has sampleSize > 0 and non-null medianLatencyMs", () => {
    const metrics = buildCreatorPerformanceMetrics();
    expect(metrics.sampleSize).toBeGreaterThan(0);
    expect(metrics.medianLatencyMs).not.toBeNull();
  });
});
