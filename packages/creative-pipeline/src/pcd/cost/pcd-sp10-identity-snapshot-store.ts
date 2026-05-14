import type {
  PcdIdentitySnapshot,
  PcdSp9ProvenancePayload,
  PcdSp10CostForecastReason,
} from "@creativeagent/schemas";
import type { PcdIdentitySnapshotStoreInput } from "../pcd-identity-snapshot-writer.js";

/**
 * SP10A — additive store contract. Imported only by the SP10A orchestrator
 * (write-pcd-identity-snapshot-with-cost-forecast.ts) and implemented by the
 * Prisma adapter at packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts.
 *
 * The SP4 contract (PcdIdentitySnapshotStore.createForShot) is preserved
 * verbatim. The SP9 contract (PcdSp9IdentitySnapshotStore.createForShotWithProvenance)
 * is preserved verbatim. This contract widens the persistence shape with the
 * SP10A cost forecast reason. The Prisma adapter implements all three.
 *
 * MERGE-BACK: at merge-back, Switchboard's apps/api wires this store into the
 * production runner's per-asset snapshot path via writePcdIdentitySnapshotWithCostForecast.
 */
export type PcdSp10IdentitySnapshotStore = {
  createForShotWithCostForecast(
    input: PcdIdentitySnapshotStoreInput &
      PcdSp9ProvenancePayload & {
        costForecastReason: PcdSp10CostForecastReason;
      },
  ): Promise<PcdIdentitySnapshot>;
};
