import { describe, expect, it } from "vitest";
import {
  CreatorPerformanceMetricsSchema,
  type CreatorPerformanceMetrics,
} from "@creativeagent/schemas";
import { InMemoryPcdCreatorPerformanceMetricsReader } from "./in-memory-pcd-creator-performance-metrics-reader.js";

const make = (overrides: Partial<CreatorPerformanceMetrics> = {}): CreatorPerformanceMetrics => ({
  creatorIdentityId: "creator-A",
  sampleSize: 5,
  successCount: 4,
  failureCount: 1,
  manualSkipCount: 0,
  successRate: 0.8,
  medianLatencyMs: 1200,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: "pcd-performance-overlay@1.0.0",
  ...overrides,
});

describe("InMemoryPcdCreatorPerformanceMetricsReader", () => {
  it("returns metrics for known creators and cold-start entries for unknown creators", async () => {
    const seed = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", make({ creatorIdentityId: "creator-A" })],
    ]);
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(seed);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.get("creator-A")).toBeDefined();
    const cold = out.get("creator-B");
    expect(cold).toBeDefined();
    expect(cold!.sampleSize).toBe(0);
    expect(cold!.medianLatencyMs).toBeNull();
    expect(cold!.successRate).toBe(0);
  });

  it("returns Zod-valid entries for every queried id", async () => {
    const seed = new Map<string, CreatorPerformanceMetrics>([
      ["creator-A", make({ creatorIdentityId: "creator-A" })],
    ]);
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(seed);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    for (const entry of out.values()) {
      expect(() => CreatorPerformanceMetricsSchema.parse(entry)).not.toThrow();
    }
  });

  it("returns empty map when queried with empty id list", async () => {
    const reader = new InMemoryPcdCreatorPerformanceMetricsReader(new Map());
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: [],
      window: { since: new Date("2026-04-16T00:00:00Z") },
    });
    expect(out.size).toBe(0);
  });
});
