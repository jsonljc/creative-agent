import { describe, expect, it, vi } from "vitest";
import { PrismaPcdPerformanceSnapshotReader } from "../prisma-pcd-performance-snapshot-reader.js";

describe("PrismaPcdPerformanceSnapshotReader.findByAssetRecordId", () => {
  it("returns the mapped payload when the row exists", async () => {
    const row = {
      id: "row_1",
      assetRecordId: "asset_abc",
      terminalKind: "success",
      errorCategory: null,
      latencyMs: 1234,
      actualCostUsd: 0.42,
      currency: "USD",
      costActualReason: {
        performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
        capturedAt: "2026-05-15T12:00:00.000Z",
        costActual: null,
      },
      attemptNumber: 1,
      providerCalled: "kling",
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: new Date("2026-05-15T12:00:00.000Z"),
      createdAt: new Date("2026-05-15T12:00:01.000Z"),
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    const result = await reader.findByAssetRecordId("asset_abc");
    expect(result).not.toBeNull();
    expect(result?.assetRecordId).toBe("asset_abc");
    expect(result?.terminalKind).toBe("success");
    expect(result?.actualCostUsd).toBe(0.42);
  });

  it("returns null when the row does not exist", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    const result = await reader.findByAssetRecordId("asset_nope");
    expect(result).toBeNull();
  });

  it("passes the correct where clause to Prisma", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const client = {
      pcdPerformanceSnapshot: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaPcdPerformanceSnapshotReader>[0];
    const reader = new PrismaPcdPerformanceSnapshotReader(client);
    await reader.findByAssetRecordId("asset_abc");
    expect(findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "asset_abc" },
    });
  });
});
