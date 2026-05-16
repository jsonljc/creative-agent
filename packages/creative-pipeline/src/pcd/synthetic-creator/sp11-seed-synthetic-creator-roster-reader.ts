// SP21 — temporary in-memory adapter for the SP11 synthetic-creator roster.
//
// MERGE-BACK: this adapter is the v1 stand-in for a real
// PrismaCreatorIdentitySyntheticReader.findActive(...) query. SP21 explicitly
// does NOT create a Prisma synthetic-creator roster reader — that work is
// reserved for SP21.1 (or for Switchboard at merge-back).
//
// The roster narrowing here is intentionally schema-level (market +
// treatmentClass + active status), matching the columns a Prisma successor
// would index on. The SP13 selector applies the full compatibility predicate
// (vibe, ethnicityFamily, ageBand, pricePositioning) downstream — this
// adapter never duplicates that logic.

import type { Market, TreatmentClass } from "@creativeagent/schemas";
import type { RosterEntry } from "./seed.js";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./seed.js";
import type { SyntheticCreatorRosterReader } from "./synthetic-creator-selection-ports.js";

export class Sp11SeedSyntheticCreatorRosterReader implements SyntheticCreatorRosterReader {
  async listActiveCompatibleRoster(input: {
    market: Market;
    treatmentClass: TreatmentClass;
  }): Promise<readonly RosterEntry[]> {
    return SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (entry) =>
        entry.synthetic.status === "active" &&
        entry.synthetic.market === input.market &&
        entry.synthetic.treatmentClass === input.treatmentClass,
    );
  }
}
