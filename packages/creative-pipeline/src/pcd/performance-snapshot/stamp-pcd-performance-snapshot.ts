// PCD slice SP19 — pure stamper for PcdPerformanceSnapshot.
// Sole runtime import site for PCD_PERFORMANCE_SNAPSHOT_VERSION.
// Defense-in-depth Zod parse on the input. Clock injection for tests.
// No crypto. No Math.random. No Date.now (we read via the clock callback).
//
// MERGE-BACK: runner integration. The runner (Switchboard-side) assembles
// PcdPerformanceSnapshotInput from {AssetRecord, terminal-state observation}
// and calls writePcdPerformanceSnapshot at terminal-state time. SP19 does
// not own the call site.

import {
  PcdPerformanceSnapshotInputSchema,
  type PcdPerformanceSnapshotInput,
  type PcdPerformanceSnapshotPayload,
} from "@creativeagent/schemas";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

export interface StampPcdPerformanceSnapshotStores {
  clock?: () => Date;
}

export function stampPcdPerformanceSnapshot(
  input: PcdPerformanceSnapshotInput,
  stores: StampPcdPerformanceSnapshotStores = {},
): PcdPerformanceSnapshotPayload {
  const parsed = PcdPerformanceSnapshotInputSchema.parse(input);
  const now = stores.clock?.() ?? new Date();
  const errorCategory = parsed.terminalKind === "failure" ? parsed.errorCategory : null;
  const actualCostUsd = parsed.terminalKind === "success" ? parsed.actualCostUsd : null;
  const currency = parsed.terminalKind === "success" ? "USD" : null;
  return {
    assetRecordId: parsed.assetRecordId,
    terminalKind: parsed.terminalKind,
    errorCategory,
    latencyMs: parsed.latencyMs,
    actualCostUsd,
    currency,
    costActualReason: {
      performanceSnapshotVersion: PCD_PERFORMANCE_SNAPSHOT_VERSION,
      capturedAt: now.toISOString(),
      costActual: parsed.costActual,
    },
    attemptNumber: parsed.attemptNumber,
    providerCalled: parsed.providerCalled,
    performanceSnapshotVersion: PCD_PERFORMANCE_SNAPSHOT_VERSION,
    capturedAt: now,
  };
}
