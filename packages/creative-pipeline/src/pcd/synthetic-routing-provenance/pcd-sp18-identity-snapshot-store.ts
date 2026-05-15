import type {
  PcdIdentitySnapshot,
  PcdSp9ProvenancePayload,
  PcdSp18SyntheticRoutingProvenancePayload,
} from "@creativeagent/schemas";
import type { PcdIdentitySnapshotStoreInput } from "../pcd-identity-snapshot-writer.js";

/**
 * SP18 — additive store contract. Imported only by the SP18 orchestrator
 * (write-pcd-identity-snapshot-with-synthetic-routing.ts) and implemented by
 * the Prisma adapter at packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts
 * (via the structurally-equivalent local PcdSp18IdentitySnapshotStoreAdapter type).
 *
 * The SP4 contract (PcdIdentitySnapshotStore.createForShot), the SP9 contract
 * (PcdSp9IdentitySnapshotStore.createForShotWithProvenance), and the SP10A
 * contract (PcdSp10IdentitySnapshotStore.createForShotWithCostForecast) are
 * preserved verbatim. This contract widens the persistence shape with the
 * SP18 synthetic-routing provenance fields (6 flat + 1 Json).
 *
 * Composes: SP4 base input + SP9 provenance payload + SP18 synthetic-routing
 * payload. costForecastReason is intentionally NOT in the intersection —
 * SP18 path does not bundle SP10A cost (orthogonal slices).
 *
 * MERGE-BACK: at merge-back, Switchboard's apps/api wires this store into the
 * production runner's per-asset synthetic-pairing-success snapshot path via
 * writePcdIdentitySnapshotWithSyntheticRouting.
 */
export type PcdSp18IdentitySnapshotStore = {
  createForShotWithSyntheticRouting(
    input: PcdIdentitySnapshotStoreInput &
      PcdSp9ProvenancePayload &
      PcdSp18SyntheticRoutingProvenancePayload,
  ): Promise<PcdIdentitySnapshot>;
};
