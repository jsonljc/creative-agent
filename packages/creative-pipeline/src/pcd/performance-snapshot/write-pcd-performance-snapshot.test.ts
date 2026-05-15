import { describe, expect, it, vi } from "vitest";
import type {
  PcdPerformanceSnapshotInput,
  PcdPerformanceSnapshotPayload,
} from "@creativeagent/schemas";
import type { PcdSp19PerformanceSnapshotStore } from "./pcd-sp19-performance-snapshot-store.js";
import { writePcdPerformanceSnapshot } from "./write-pcd-performance-snapshot.js";

const fixedDate = new Date("2026-05-15T12:00:00.000Z");
const fixedClock = () => fixedDate;

function successInput(): PcdPerformanceSnapshotInput {
  return {
    terminalKind: "success",
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD",
    costActual: null,
  };
}

describe("writePcdPerformanceSnapshot", () => {
  it("stamps then writes to the store", async () => {
    const captured: PcdPerformanceSnapshotPayload[] = [];
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn(async (p) => {
        captured.push(p);
      }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].terminalKind).toBe("success");
    expect(captured[0].capturedAt).toEqual(fixedDate);
  });

  it("passes the stamped payload byte-equal to the store", async () => {
    let received: PcdPerformanceSnapshotPayload | undefined;
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn(async (p) => {
        received = p;
      }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(received?.performanceSnapshotVersion).toBe("pcd-performance-snapshot@1.0.0");
    expect(received?.costActualReason.performanceSnapshotVersion).toBe(
      "pcd-performance-snapshot@1.0.0",
    );
  });

  it("awaits the store call (no fire-and-forget)", async () => {
    let storeResolved = false;
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            storeResolved = true;
            resolve();
          }, 10);
        }),
    };
    await writePcdPerformanceSnapshot(successInput(), {
      performanceSnapshotStore: store,
      clock: fixedClock,
    });
    expect(storeResolved).toBe(true);
  });

  it("re-throws store errors", async () => {
    const store: PcdSp19PerformanceSnapshotStore = {
      createForAssetRecord: vi.fn().mockRejectedValue(new Error("DB blew up")),
    };
    await expect(
      writePcdPerformanceSnapshot(successInput(), {
        performanceSnapshotStore: store,
        clock: fixedClock,
      }),
    ).rejects.toThrow("DB blew up");
  });

  it("does not call store when stamper throws (defense-in-depth)", async () => {
    const create = vi.fn(async () => undefined);
    const store: PcdSp19PerformanceSnapshotStore = { createForAssetRecord: create };
    await expect(
      writePcdPerformanceSnapshot(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...successInput(), latencyMs: -1 } as any,
        { performanceSnapshotStore: store, clock: fixedClock },
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
