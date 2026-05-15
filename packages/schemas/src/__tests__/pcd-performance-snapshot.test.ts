import { describe, expect, it } from "vitest";
import {
  PcdPerformanceErrorCategorySchema,
  PcdPerformanceSnapshotInputSchema,
  PcdPerformanceSnapshotPayloadSchema,
  PcdPerformanceSnapshotReasonSchema,
} from "../pcd-performance-snapshot.js";

describe("PcdPerformanceErrorCategorySchema", () => {
  it("accepts the 5 enum values", () => {
    for (const v of [
      "provider_timeout",
      "provider_error",
      "qc_rejection",
      "policy_denial",
      "internal_error",
    ] as const) {
      expect(() => PcdPerformanceErrorCategorySchema.parse(v)).not.toThrow();
    }
  });

  it("rejects unknown error category", () => {
    expect(() => PcdPerformanceErrorCategorySchema.parse("unknown")).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — success branch", () => {
  const validSuccess = {
    terminalKind: "success" as const,
    assetRecordId: "asset_abc",
    attemptNumber: 1,
    providerCalled: "kling",
    latencyMs: 1234,
    actualCostUsd: 0.42,
    currency: "USD" as const,
    costActualReason: null,
  };

  it("parses a well-formed success input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validSuccess);
    expect(parsed.terminalKind).toBe("success");
    if (parsed.terminalKind === "success") {
      expect(parsed.actualCostUsd).toBe(0.42);
      expect(parsed.currency).toBe("USD");
    }
  });

  it("rejects success with actualCostUsd null", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, actualCostUsd: null }),
    ).toThrow();
  });

  it("rejects success with negative latencyMs", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, latencyMs: -1 }),
    ).toThrow();
  });

  it("rejects success with attemptNumber 0", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSuccess, attemptNumber: 0 }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — failure branch", () => {
  const validFailure = {
    terminalKind: "failure" as const,
    assetRecordId: "asset_xyz",
    attemptNumber: 2,
    providerCalled: "seedance",
    latencyMs: 30000,
    actualCostUsd: null,
    currency: null,
    errorCategory: "provider_timeout" as const,
    costActualReason: null,
  };

  it("parses a well-formed failure input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validFailure);
    expect(parsed.terminalKind).toBe("failure");
    if (parsed.terminalKind === "failure") {
      expect(parsed.errorCategory).toBe("provider_timeout");
      expect(parsed.actualCostUsd).toBeNull();
    }
  });

  it("rejects failure with actualCostUsd number", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validFailure, actualCostUsd: 0.1 }),
    ).toThrow();
  });

  it("rejects failure missing errorCategory", () => {
    const { errorCategory: _e, ...rest } = validFailure;
    expect(() => PcdPerformanceSnapshotInputSchema.parse(rest)).toThrow();
  });
});

describe("PcdPerformanceSnapshotInputSchema — manual_skip branch", () => {
  const validSkip = {
    terminalKind: "manual_skip" as const,
    assetRecordId: "asset_lmn",
    attemptNumber: 1,
    providerCalled: "dalle",
    latencyMs: 0,
    actualCostUsd: null,
    currency: null,
    costActualReason: null,
  };

  it("parses a well-formed manual_skip input", () => {
    const parsed = PcdPerformanceSnapshotInputSchema.parse(validSkip);
    expect(parsed.terminalKind).toBe("manual_skip");
  });

  it("rejects manual_skip with currency USD", () => {
    expect(() =>
      PcdPerformanceSnapshotInputSchema.parse({ ...validSkip, currency: "USD" }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotReasonSchema", () => {
  it("parses a well-formed reason", () => {
    const parsed = PcdPerformanceSnapshotReasonSchema.parse({
      performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
      capturedAt: "2026-05-15T12:00:00.000Z",
      costActual: null,
    });
    expect(parsed.performanceSnapshotVersion).toBe("pcd-performance-snapshot@1.0.0");
  });

  it("rejects empty performanceSnapshotVersion", () => {
    expect(() =>
      PcdPerformanceSnapshotReasonSchema.parse({
        performanceSnapshotVersion: "",
        capturedAt: "2026-05-15T12:00:00.000Z",
        costActual: null,
      }),
    ).toThrow();
  });

  it("rejects invalid datetime", () => {
    expect(() =>
      PcdPerformanceSnapshotReasonSchema.parse({
        performanceSnapshotVersion: "pcd-performance-snapshot@1.0.0",
        capturedAt: "not-a-date",
        costActual: null,
      }),
    ).toThrow();
  });
});

describe("PcdPerformanceSnapshotPayloadSchema", () => {
  it("parses a well-formed payload", () => {
    const parsed = PcdPerformanceSnapshotPayloadSchema.parse({
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
    });
    expect(parsed.terminalKind).toBe("success");
  });
});
