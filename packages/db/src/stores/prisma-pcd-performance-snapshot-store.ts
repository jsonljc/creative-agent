// SP19 — PrismaClient-backed write adapter for PcdPerformanceSnapshot.
// Mirrors the post-SP18 PrismaPcdIdentitySnapshotStore pattern: thin wrapper
// over prisma.pcdPerformanceSnapshot.create, no decision logic in this file.
//
// MERGE-BACK: test cleanup delete-order — onDelete: Restrict means
// PcdPerformanceSnapshot rows must be deleted BEFORE their AssetRecord
// rows in any test that creates both.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { PcdPerformanceSnapshotPayload } from "@creativeagent/schemas";

export class PrismaPcdPerformanceSnapshotStore {
  constructor(private readonly client: Pick<PrismaClient, "pcdPerformanceSnapshot">) {}

  async createForAssetRecord(payload: PcdPerformanceSnapshotPayload): Promise<void> {
    await this.client.pcdPerformanceSnapshot.create({
      data: {
        assetRecordId: payload.assetRecordId,
        terminalKind: payload.terminalKind,
        errorCategory: payload.errorCategory,
        latencyMs: payload.latencyMs,
        actualCostUsd: payload.actualCostUsd,
        currency: payload.currency,
        costActualReason: payload.costActualReason as unknown as Prisma.InputJsonValue,
        attemptNumber: payload.attemptNumber,
        providerCalled: payload.providerCalled,
        performanceSnapshotVersion: payload.performanceSnapshotVersion,
        capturedAt: payload.capturedAt,
      },
    });
  }
}
