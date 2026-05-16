import { describe, expect, it } from "vitest";
import {
  CreatorPerformanceMetricsSchema,
  type CreatorPerformanceMetrics,
} from "./pcd-creator-performance-metrics.js";

const baseline: CreatorPerformanceMetrics = {
  creatorIdentityId: "creator-A",
  sampleSize: 10,
  successCount: 7,
  failureCount: 2,
  manualSkipCount: 1,
  successRate: 0.7,
  medianLatencyMs: 1500,
  windowStart: new Date("2026-04-16T00:00:00Z"),
  windowEnd: new Date("2026-05-16T00:00:00Z"),
  metricsVersion: "pcd-performance-overlay@1.0.0",
};

describe("CreatorPerformanceMetricsSchema — primitive shape", () => {
  it("accepts a valid populated record", () => {
    expect(CreatorPerformanceMetricsSchema.parse(baseline)).toEqual(baseline);
  });

  it("accepts a cold-start record (sampleSize 0, null latency, 0 success rate)", () => {
    const cold = {
      ...baseline,
      sampleSize: 0,
      successCount: 0,
      failureCount: 0,
      manualSkipCount: 0,
      successRate: 0,
      medianLatencyMs: null,
    };
    expect(() => CreatorPerformanceMetricsSchema.parse(cold)).not.toThrow();
  });

  it("rejects negative counts", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, successCount: -1 }),
    ).toThrow();
  });

  it("rejects successRate > 1", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, successRate: 1.1 }),
    ).toThrow();
  });

  it("rejects empty creatorIdentityId", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, creatorIdentityId: "" }),
    ).toThrow();
  });

  it("rejects empty metricsVersion", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({ ...baseline, metricsVersion: "" }),
    ).toThrow();
  });

  it("rejects non-integer sampleSize", () => {
    expect(() => CreatorPerformanceMetricsSchema.parse({ ...baseline, sampleSize: 1.5 })).toThrow();
  });
});

describe("CreatorPerformanceMetricsSchema — cross-field invariants (.refine)", () => {
  it("rejects when successCount + failureCount + manualSkipCount !== sampleSize", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        sampleSize: 10,
        successCount: 7,
        failureCount: 2,
        manualSkipCount: 0, // sum=9, not 10
      }),
    ).toThrow(/counts must sum to sampleSize/);
  });

  it("rejects when sampleSize === 0 but medianLatencyMs is non-null", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        sampleSize: 0,
        successCount: 0,
        failureCount: 0,
        manualSkipCount: 0,
        successRate: 0,
        medianLatencyMs: 1000, // must be null when sampleSize 0
      }),
    ).toThrow(/medianLatencyMs/);
  });

  it("rejects when sampleSize === 0 but successRate !== 0", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        sampleSize: 0,
        successCount: 0,
        failureCount: 0,
        manualSkipCount: 0,
        successRate: 0.5, // must be 0 when sampleSize 0
        medianLatencyMs: null,
      }),
    ).toThrow(/medianLatencyMs/);
  });

  it("rejects when sampleSize > 0 but medianLatencyMs is null", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        medianLatencyMs: null, // must be non-null when sampleSize > 0
      }),
    ).toThrow(/medianLatencyMs/);
  });

  it("rejects when windowEnd <= windowStart", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        windowStart: new Date("2026-05-16T00:00:00Z"),
        windowEnd: new Date("2026-05-16T00:00:00Z"), // equal — rejected
      }),
    ).toThrow(/windowEnd must be after windowStart/);
  });

  it("accepts when windowEnd > windowStart by even one millisecond", () => {
    expect(() =>
      CreatorPerformanceMetricsSchema.parse({
        ...baseline,
        windowStart: new Date("2026-05-16T00:00:00.000Z"),
        windowEnd: new Date("2026-05-16T00:00:00.001Z"),
      }),
    ).not.toThrow();
  });
});
