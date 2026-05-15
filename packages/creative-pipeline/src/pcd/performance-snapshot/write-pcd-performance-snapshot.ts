// SP19 — thin store-injected writer for PcdPerformanceSnapshot.
// Standalone, NOT an orchestrator. No SP4-invariant lock-step, no SP9 stamper
// composition, no SP10A stamper composition, no SP18 stamper composition.
// SP19 captures observation-time values at terminal state; lock-stepping
// against generation-decision-time constants would be ceremonial.
//
// MERGE-BACK: future reconciliation module joins PcdPerformanceSnapshot ⨯
// PcdIdentitySnapshot on assetRecordId to compute forecast-vs-actual cost
// variance. Reconciler pins its own version constant. SP19 ships the data
// foundation only.

import type { PcdPerformanceSnapshotInput } from "@creativeagent/schemas";
import type { PcdSp19PerformanceSnapshotStore } from "./pcd-sp19-performance-snapshot-store.js";
import {
  stampPcdPerformanceSnapshot,
  type StampPcdPerformanceSnapshotStores,
} from "./stamp-pcd-performance-snapshot.js";

export interface WritePcdPerformanceSnapshotStores extends StampPcdPerformanceSnapshotStores {
  performanceSnapshotStore: PcdSp19PerformanceSnapshotStore;
}

export async function writePcdPerformanceSnapshot(
  input: PcdPerformanceSnapshotInput,
  stores: WritePcdPerformanceSnapshotStores,
): Promise<void> {
  const payload = stampPcdPerformanceSnapshot(input, stores);
  await stores.performanceSnapshotStore.createForAssetRecord(payload);
}
