import { describe, expect, it, vi } from "vitest";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "@creativeagent/schemas";
import { PrismaPcdCreatorPerformanceMetricsReader } from "../prisma-pcd-creator-performance-metrics-reader.js";

function buildReader(queryRaw: ReturnType<typeof vi.fn>) {
  const client = { $queryRaw: queryRaw } as unknown as ConstructorParameters<
    typeof PrismaPcdCreatorPerformanceMetricsReader
  >[0];
  return new PrismaPcdCreatorPerformanceMetricsReader(client);
}

describe("PrismaPcdCreatorPerformanceMetricsReader", () => {
  it("empty id list short-circuits without calling $queryRaw", async () => {
    const queryRaw = vi.fn();
    const reader = buildReader(queryRaw);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: [],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    expect(out.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("returns cold-start entries for ids with no aggregate rows", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const reader = buildReader(queryRaw);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    expect(out.size).toBe(2);
    for (const id of ["creator-A", "creator-B"]) {
      const entry = out.get(id);
      expect(entry).toBeDefined();
      expect(entry!.sampleSize).toBe(0);
      expect(entry!.successCount).toBe(0);
      expect(entry!.failureCount).toBe(0);
      expect(entry!.manualSkipCount).toBe(0);
      expect(entry!.medianLatencyMs).toBeNull();
      expect(entry!.successRate).toBe(0);
      expect(entry!.metricsVersion).toBe("pcd-performance-overlay@1.0.0");
    }
  });

  it("maps aggregate rows correctly including bigint conversion", async () => {
    const fixtureRow = {
      creator_identity_id: "creator-A",
      sample_size: 6n,
      success_count: 3n,
      failure_count: 2n,
      manual_skip_count: 1n,
      median_latency_ms: 1100,
    };
    const queryRaw = vi.fn().mockResolvedValue([fixtureRow]);
    const reader = buildReader(queryRaw);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    expect(out.size).toBe(1);
    const entry = out.get("creator-A");
    expect(entry).toBeDefined();
    expect(entry!.sampleSize).toBe(6);
    expect(entry!.successCount).toBe(3);
    expect(entry!.failureCount).toBe(2);
    expect(entry!.manualSkipCount).toBe(1);
    expect(entry!.medianLatencyMs).toBe(1100);
    expect(entry!.successRate).toBeCloseTo(0.5, 5);
    expect(entry!.metricsVersion).toBe(PCD_PERFORMANCE_OVERLAY_VERSION);
  });

  it("mixes seeded rows with cold-start for uncovered ids", async () => {
    const fixtureRow = {
      creator_identity_id: "creator-A",
      sample_size: 4n,
      success_count: 2n,
      failure_count: 1n,
      manual_skip_count: 1n,
      median_latency_ms: 800,
    };
    const queryRaw = vi.fn().mockResolvedValue([fixtureRow]);
    const reader = buildReader(queryRaw);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    expect(out.size).toBe(2);

    const a = out.get("creator-A");
    expect(a!.sampleSize).toBe(4);
    expect(a!.medianLatencyMs).toBe(800);

    const b = out.get("creator-B");
    expect(b!.sampleSize).toBe(0);
    expect(b!.medianLatencyMs).toBeNull();
    expect(b!.successRate).toBe(0);
  });

  it("calls $queryRaw with expected SQL shape (joins, percentile_cont, GROUP BY)", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const reader = buildReader(queryRaw);
    await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    const sqlArg = queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    const fullSql = sqlArg.strings.join(" ");
    expect(fullSql).toContain('"PcdPerformanceSnapshot"');
    expect(fullSql).toContain('"PcdIdentitySnapshot"');
    expect(fullSql).toContain('"AssetRecord"');
    expect(fullSql).toContain("INNER JOIN");
    expect(fullSql).toContain("percentile_cont");
    expect(fullSql).toContain("GROUP BY");
  });

  it("windowStart equals input since; windowEnd is recent", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const reader = buildReader(queryRaw);
    const since = new Date("2026-04-16T00:00:00Z");
    const before = new Date();
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A"],
      window: { since },
    });
    const after = new Date();
    const entry = out.get("creator-A");
    expect(entry).toBeDefined();
    expect(entry!.windowStart).toBe(since);
    expect(entry!.windowEnd.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry!.windowEnd.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("stamps PCD_PERFORMANCE_OVERLAY_VERSION on every entry (seeded and cold-start)", async () => {
    const fixtureRow = {
      creator_identity_id: "creator-A",
      sample_size: 2n,
      success_count: 1n,
      failure_count: 1n,
      manual_skip_count: 0n,
      median_latency_ms: 500,
    };
    const queryRaw = vi.fn().mockResolvedValue([fixtureRow]);
    const reader = buildReader(queryRaw);
    const out = await reader.findMetricsForCreators({
      creatorIdentityIds: ["creator-A", "creator-B"],
      window: { since: new Date("2026-04-01T00:00:00Z") },
    });
    for (const [_id, entry] of out) {
      expect(entry.metricsVersion).toBe(PCD_PERFORMANCE_OVERLAY_VERSION);
    }
  });
});
