// SP20 — Prisma-backed CreatorPerformanceMetrics reader.
//
// Aggregates PcdPerformanceSnapshot rows GROUPed by creatorIdentityId for a
// caller-supplied window. Computes sampleSize, per-terminal-kind counts,
// successRate, and medianLatencyMs entirely at the DB boundary
// (Guardrail H). Stamps every returned entry with
// PCD_PERFORMANCE_OVERLAY_VERSION (Guardrail C-3). One of the two allowlisted
// runtime importers of the version constant (anti-pattern test #3).
//
// MERGE-BACK: composer/runner instantiates this reader and threads its
// output into selectSyntheticCreator via the performanceHistory input.
// MERGE-BACK: 30-day default lives at caller site, not in this reader.
// MERGE-BACK: Switchboard may have a richer denormalized join — reconcile.
//
// Join path (per Task 1 findings, Path B — AssetRecord has no creatorIdentityId
// column; we two-hop through PcdIdentitySnapshot):
//   PcdPerformanceSnapshot.assetRecordId → AssetRecord.id
//   PcdIdentitySnapshot.assetRecordId    → AssetRecord.id
//   PcdIdentitySnapshot.creatorIdentityId → grouping key
//
// INNER JOIN on PcdIdentitySnapshot intentionally excludes any PerformanceSnapshot
// whose AssetRecord lacks a PCD identity snapshot (non-PCD or pre-SP1 assets).

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  PCD_PERFORMANCE_OVERLAY_VERSION,
  type CreatorPerformanceMetrics,
} from "@creativeagent/schemas";

export type FindMetricsForCreatorsInput = {
  creatorIdentityIds: readonly string[];
  window: { since: Date };
};

type AggregateRow = {
  creator_identity_id: string;
  sample_size: bigint;
  success_count: bigint;
  failure_count: bigint;
  manual_skip_count: bigint;
  median_latency_ms: number | null;
};

export class PrismaPcdCreatorPerformanceMetricsReader {
  constructor(private readonly client: Pick<PrismaClient, "$queryRaw">) {}

  async findMetricsForCreators(
    input: FindMetricsForCreatorsInput,
  ): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>> {
    const ids = input.creatorIdentityIds;
    const out = new Map<string, CreatorPerformanceMetrics>();
    if (ids.length === 0) return out;

    const since = input.window.since;
    const windowEnd = new Date();

    const rows = await this.client.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        pis."creatorIdentityId"                                                   AS creator_identity_id,
        COUNT(*)::bigint                                                          AS sample_size,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'success')::bigint            AS success_count,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'failure')::bigint            AS failure_count,
        COUNT(*) FILTER (WHERE pps."terminalKind" = 'manual_skip')::bigint        AS manual_skip_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pps."latencyMs")::float8      AS median_latency_ms
      FROM "PcdPerformanceSnapshot" pps
      INNER JOIN "AssetRecord"         ar  ON ar.id              = pps."assetRecordId"
      INNER JOIN "PcdIdentitySnapshot" pis ON pis."assetRecordId" = ar.id
      WHERE pps."capturedAt" >= ${since}
        AND pis."creatorIdentityId" IN (${Prisma.join(ids)})
      GROUP BY pis."creatorIdentityId"
    `);

    for (const row of rows) {
      const sampleSize = Number(row.sample_size);
      const successCount = Number(row.success_count);
      const failureCount = Number(row.failure_count);
      const manualSkipCount = Number(row.manual_skip_count);
      const medianLatencyMs =
        row.median_latency_ms === null ? null : Math.round(row.median_latency_ms);
      const successRate = sampleSize === 0 ? 0 : successCount / sampleSize;
      out.set(row.creator_identity_id, {
        creatorIdentityId: row.creator_identity_id,
        sampleSize,
        successCount,
        failureCount,
        manualSkipCount,
        successRate,
        medianLatencyMs,
        windowStart: since,
        windowEnd,
        metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
      });
    }

    // Cold-start: every queried id MUST appear in the output map.
    for (const id of ids) {
      if (!out.has(id)) {
        out.set(id, {
          creatorIdentityId: id,
          sampleSize: 0,
          successCount: 0,
          failureCount: 0,
          manualSkipCount: 0,
          successRate: 0,
          medianLatencyMs: null,
          windowStart: since,
          windowEnd,
          metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
        });
      }
    }

    return out;
  }
}
