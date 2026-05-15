// SP19 — PrismaClient-backed read adapter for PcdPerformanceSnapshot.
// Returns null for missing rows (pre-SP19 AssetRecord rows have no companion).
// SP20 selector consumer treats null as "no historical performance data."

import type { PrismaClient } from "@prisma/client";
import type {
  PcdPerformanceErrorCategory,
  PcdPerformanceSnapshotPayload,
  PcdPerformanceSnapshotReason,
} from "@creativeagent/schemas";

export class PrismaPcdPerformanceSnapshotReader {
  constructor(private readonly client: Pick<PrismaClient, "pcdPerformanceSnapshot">) {}

  async findByAssetRecordId(assetRecordId: string): Promise<PcdPerformanceSnapshotPayload | null> {
    const row = await this.client.pcdPerformanceSnapshot.findUnique({
      where: { assetRecordId },
    });
    if (row === null) return null;
    return {
      assetRecordId: row.assetRecordId,
      terminalKind: row.terminalKind as "success" | "failure" | "manual_skip",
      errorCategory: row.errorCategory as PcdPerformanceErrorCategory | null,
      latencyMs: row.latencyMs,
      actualCostUsd: row.actualCostUsd,
      currency: row.currency as "USD" | null,
      costActualReason: row.costActualReason as unknown as PcdPerformanceSnapshotReason,
      attemptNumber: row.attemptNumber,
      providerCalled: row.providerCalled,
      performanceSnapshotVersion: row.performanceSnapshotVersion,
      capturedAt: row.capturedAt,
    };
  }
}
