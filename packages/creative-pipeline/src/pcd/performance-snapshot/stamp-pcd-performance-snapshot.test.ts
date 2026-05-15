import { describe, expect, it } from "vitest";
import type { PcdPerformanceSnapshotInput } from "@creativeagent/schemas";
import { stampPcdPerformanceSnapshot } from "./stamp-pcd-performance-snapshot.js";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

const fixedDate = new Date("2026-05-15T12:00:00.000Z");
const fixedClock = () => fixedDate;

function successInput(
  overrides: Partial<PcdPerformanceSnapshotInput> = {},
): PcdPerformanceSnapshotInput {
  return {
    terminalKind: "success",
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD",
    costActual: null,
    ...overrides,
  } as PcdPerformanceSnapshotInput;
}

describe("stampPcdPerformanceSnapshot — success branch", () => {
  it("stamps a payload with terminalKind=success and populated cost", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.terminalKind).toBe("success");
    expect(payload.actualCostUsd).toBe(0.42);
    expect(payload.currency).toBe("USD");
    expect(payload.errorCategory).toBeNull();
  });

  it("stamps performanceSnapshotVersion from the pinned constant", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.performanceSnapshotVersion).toBe(PCD_PERFORMANCE_SNAPSHOT_VERSION);
    expect(payload.costActualReason.performanceSnapshotVersion).toBe(
      PCD_PERFORMANCE_SNAPSHOT_VERSION,
    );
  });

  it("uses the injected clock for capturedAt", () => {
    const payload = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(payload.capturedAt).toEqual(fixedDate);
    expect(payload.costActualReason.capturedAt).toBe(fixedDate.toISOString());
  });

  it("falls back to new Date() when no clock injected", () => {
    const before = Date.now();
    const payload = stampPcdPerformanceSnapshot(successInput());
    const after = Date.now();
    expect(payload.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(payload.capturedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("is pure: identical input + clock yields deep-equal output", () => {
    const a = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    const b = stampPcdPerformanceSnapshot(successInput(), { clock: fixedClock });
    expect(a).toEqual(b);
  });
});

describe("stampPcdPerformanceSnapshot — failure branch", () => {
  it("stamps a payload with terminalKind=failure and null cost", () => {
    const payload = stampPcdPerformanceSnapshot(
      {
        terminalKind: "failure",
        assetRecordId: "asset_xyz",
        attemptNumber: 2,
        providerCalled: "seedance",
        latencyMs: 30000,
        actualCostUsd: null,
        currency: null,
        errorCategory: "provider_timeout",
        costActual: null,
      },
      { clock: fixedClock },
    );
    expect(payload.terminalKind).toBe("failure");
    expect(payload.actualCostUsd).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.errorCategory).toBe("provider_timeout");
  });
});

describe("stampPcdPerformanceSnapshot — manual_skip branch", () => {
  it("stamps a payload with terminalKind=manual_skip and nulls", () => {
    const payload = stampPcdPerformanceSnapshot(
      {
        terminalKind: "manual_skip",
        assetRecordId: "asset_lmn",
        attemptNumber: 1,
        providerCalled: "dalle",
        latencyMs: 0,
        actualCostUsd: null,
        currency: null,
        costActual: null,
      },
      { clock: fixedClock },
    );
    expect(payload.terminalKind).toBe("manual_skip");
    expect(payload.actualCostUsd).toBeNull();
    expect(payload.currency).toBeNull();
    expect(payload.errorCategory).toBeNull();
  });
});

describe("stampPcdPerformanceSnapshot — defense-in-depth Zod parse", () => {
  it("rejects unknown terminalKind", () => {
    expect(() =>
      stampPcdPerformanceSnapshot(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          terminalKind: "bogus",
          assetRecordId: "a",
          attemptNumber: 1,
          providerCalled: "k",
          latencyMs: 0,
        } as any,
      ),
    ).toThrow();
  });

  it("rejects negative latencyMs", () => {
    expect(() =>
      stampPcdPerformanceSnapshot(
        successInput({ latencyMs: -1 } as Partial<PcdPerformanceSnapshotInput>),
      ),
    ).toThrow();
  });
});
