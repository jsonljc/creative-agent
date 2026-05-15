// SP19 — store + reader contracts for PcdPerformanceSnapshot.
//
// MERGE-BACK: type-level bridge PcdSp19PerformanceSnapshotStore =
// adaptPcdSp19PerformanceSnapshotStore(prismaStore) at apps/api or
// integration scope (db layer rule forbids local assertion). Matches SP18
// U8 deferral pattern.

import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";

export interface PcdSp19PerformanceSnapshotStore {
  createForAssetRecord(input: PcdPerformanceSnapshotPayload): Promise<void>;
}

export interface PcdSp19PerformanceSnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<PcdPerformanceSnapshotPayload | null>;
}
