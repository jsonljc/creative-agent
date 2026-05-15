import { describe, expect, it, vi } from "vitest";
import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";
import { PrismaPcdPerformanceSnapshotStore } from "../prisma-pcd-performance-snapshot-store.js";

function makePayload(
  overrides: Partial<PcdPerformanceSnapshotPayload> = {},
): PcdPerformanceSnapshotPayload {
  return {
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
    ...overrides,
  };
}

describe("PrismaPcdPerformanceSnapshotStore.createForAssetRecord", () => {
  it("calls prisma.pcdPerformanceSnapshot.create with mapped payload", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(makePayload());
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.data.assetRecordId).toBe("asset_abc");
    expect(call.data.terminalKind).toBe("success");
    expect(call.data.actualCostUsd).toBe(0.42);
    expect(call.data.currency).toBe("USD");
    expect(call.data.costActualReason).toEqual({
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: "2026-05-15T12:00:00.000Z",
      costActual: null,
    });
  });

  it("writes null actualCostUsd / currency for failure inputs", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(
      makePayload({
        terminalKind: "failure",
        errorCategory: "provider_timeout",
        actualCostUsd: null,
        currency: null,
      }),
    );
    const call = create.mock.calls[0][0];
    expect(call.data.actualCostUsd).toBeNull();
    expect(call.data.currency).toBeNull();
    expect(call.data.errorCategory).toBe("provider_timeout");
  });

  it("rethrows Prisma errors (unique constraint)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Unique constraint failed"));
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await expect(store.createForAssetRecord(makePayload())).rejects.toThrow(
      "Unique constraint failed",
    );
  });

  it("rethrows Prisma errors (FK violation)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Foreign key constraint failed"));
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await expect(store.createForAssetRecord(makePayload())).rejects.toThrow(
      "Foreign key constraint failed",
    );
  });

  it("passes capturedAt as a Date object (not ISO string)", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = { pcdPerformanceSnapshot: { create } } as unknown as ConstructorParameters<
      typeof PrismaPcdPerformanceSnapshotStore
    >[0];
    const store = new PrismaPcdPerformanceSnapshotStore(client);
    await store.createForAssetRecord(makePayload());
    const call = create.mock.calls[0][0];
    expect(call.data.capturedAt).toBeInstanceOf(Date);
  });
});
