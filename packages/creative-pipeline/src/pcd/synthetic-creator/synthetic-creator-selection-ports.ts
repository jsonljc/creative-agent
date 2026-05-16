// SP21 — port interfaces for the synthetic-creator selection composer.
//
// Defined here (synthetic-creator/) rather than in selector/ so the cross-dir
// import direction stays selector → synthetic-creator (the same direction
// already used by the SP13 selector's `RosterEntry` import from ./seed.js).
// The composer imports these types; concrete adapters implement them.
//
// LAYERING GUARDRAIL — these interfaces deliberately encode no Prisma types.
// Concrete Prisma readers live in @creativeagent/db; in-memory adapters live
// alongside the seed in this package. SP21 anti-pattern test #1 enforces.

import type {
  CreatorIdentityLicensePayload,
  CreatorPerformanceMetrics,
  Market,
  TreatmentClass,
} from "@creativeagent/schemas";
import type { RosterEntry } from "./seed.js";

export interface SyntheticCreatorRosterReader {
  // v1: returns SP11_SYNTHETIC_CREATOR_ROSTER pre-filtered by market +
  // treatmentClass (the schema-indexable fields). The SP13 selector applies
  // the full compatibility predicate (vibe, ethnicityFamily, ageBand,
  // pricePositioning) downstream. MERGE-BACK: replaced by a real Prisma
  // reader at SP21.1.
  listActiveCompatibleRoster(input: {
    market: Market;
    treatmentClass: TreatmentClass;
  }): Promise<readonly RosterEntry[]>;
}

export interface SyntheticCreatorLeaseReader {
  // DB-side filter — composer never fetches "all leases for clinic" and trims
  // in memory. SP13 selector still license-gates each candidate against this
  // narrow pool. Satisfied by
  // PrismaCreatorIdentityLicenseReader.findActiveByClinicAndScope at the
  // app/runner wiring layer.
  findActiveLeasesForBriefScope(input: {
    clinicId: string;
    market: Market;
    treatmentClass: TreatmentClass;
    now: Date;
  }): Promise<readonly CreatorIdentityLicensePayload[]>;
}

export interface SyntheticCreatorMetricsReader {
  // Port shape matches PrismaPcdCreatorPerformanceMetricsReader and
  // InMemoryPcdCreatorPerformanceMetricsReader EXACTLY (SP20). Both concrete
  // readers satisfy this port without an adapter.
  findMetricsForCreators(input: {
    creatorIdentityIds: readonly string[];
    window: { since: Date };
  }): Promise<ReadonlyMap<string, CreatorPerformanceMetrics>>;
}
