import type { PcdIdentitySnapshot, PcdSp9ProvenancePayload } from "@creativeagent/schemas";
import type { PcdIdentitySnapshotStoreInput } from "../pcd-identity-snapshot-writer.js";

/**
 * SP9 — additive store contract. Imported only by the SP9 orchestrator
 * (write-pcd-identity-snapshot-with-provenance.ts) and implemented by the
 * Prisma adapter at packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts.
 *
 * The SP4 contract (PcdIdentitySnapshotStore.createForShot) is preserved
 * verbatim and continues to serve legacy callsites that write null lineage.
 * This contract widens the persistence shape with the five lineage ids and the
 * lineage decision reason. The Prisma adapter implements both interfaces.
 *
 * MERGE-BACK: at merge-back, Switchboard's apps/api wires this store into the
 * production runner's per-asset snapshot path via writePcdIdentitySnapshotWithProvenance.
 */
export type PcdSp9IdentitySnapshotStore = {
  createForShotWithProvenance(
    input: PcdIdentitySnapshotStoreInput & PcdSp9ProvenancePayload,
  ): Promise<PcdIdentitySnapshot>;
};
