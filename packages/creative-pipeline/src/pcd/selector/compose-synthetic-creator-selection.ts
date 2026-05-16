// SP21 — Synthetic-creator selection composer.
//
// The first impure orchestrator in the PCD vertical. Reads the roster,
// brief-scoped active leases, and a 30-day SP20 performance-metrics window
// through three injected port interfaces, then invokes the unchanged
// SP13/SP20 pure selectSyntheticCreator and returns its decision.
//
// LAYERING GUARDRAIL — this file MUST NOT import from @creativeagent/db.
// Concrete Prisma readers live in @creativeagent/db and are wired in by the
// runner/app layer (// MERGE-BACK). The composer depends on the port
// interfaces in ../synthetic-creator/synthetic-creator-selection-ports.ts.
//
// CLOCK DISCIPLINE — metricsSince is derived from input.now. The composer
// MUST NOT call new Date() in its body. SP21 anti-pattern test #2 enforces.
//
// EMPTY-ROSTER SHORT-CIRCUIT — when the roster reader returns [], the
// composer does NOT call the lease reader or the metrics reader. The
// selector is invoked with empty arrays and returns
// no_compatible_candidates.
//
// MERGE-BACK markers:
//   1. Replace Sp11SeedSyntheticCreatorRosterReader with a real
//      PrismaCreatorIdentitySyntheticReader.findActive(...) at SP21.1.
//   2. Inngest step wrapping at the call site (Switchboard runner owns).
//   3. WorkTrace emission at composer entry / exit (forensic record-keeping).
//   4. Operator-facing composer-selection dashboards.
//   5. SP21_PERFORMANCE_WINDOW_DAYS becomes a Switchboard-side config knob
//      (per-tier or per-clinic).

import type { CreativeBrief, SyntheticCreatorSelectionDecision } from "@creativeagent/schemas";
import type {
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
  SyntheticCreatorRosterReader,
} from "../synthetic-creator/synthetic-creator-selection-ports.js";
import { selectSyntheticCreator } from "./selector.js";

const SP21_PERFORMANCE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ComposeSyntheticCreatorSelectionInput = {
  brief: CreativeBrief;
  now: Date;
};

export type ComposeSyntheticCreatorSelectionStores = {
  rosterReader: SyntheticCreatorRosterReader;
  leaseReader: SyntheticCreatorLeaseReader;
  metricsReader: SyntheticCreatorMetricsReader;
};

export async function composeSyntheticCreatorSelection(
  input: ComposeSyntheticCreatorSelectionInput,
  stores: ComposeSyntheticCreatorSelectionStores,
): Promise<SyntheticCreatorSelectionDecision> {
  // Step 1 — read roster (market + treatmentClass scope).
  const roster = await stores.rosterReader.listActiveCompatibleRoster({
    market: input.brief.market,
    treatmentClass: input.brief.treatmentClass,
  });

  // Step 2 — empty-roster short-circuit. Skip lease + metrics reads entirely.
  if (roster.length === 0) {
    return selectSyntheticCreator({
      brief: input.brief,
      now: input.now,
      roster: [],
      leases: [],
      performanceHistory: undefined,
    });
  }

  // Step 3 — read brief-scoped active leases.
  const leases = await stores.leaseReader.findActiveLeasesForBriefScope({
    clinicId: input.brief.clinicId,
    market: input.brief.market,
    treatmentClass: input.brief.treatmentClass,
    now: input.now,
  });

  // Step 4 — read 30-day performance metrics. metricsSince derived from
  // input.now (never new Date()).
  const metricsSince = new Date(input.now.getTime() - SP21_PERFORMANCE_WINDOW_DAYS * MS_PER_DAY);
  const performanceHistory = await stores.metricsReader.findMetricsForCreators({
    creatorIdentityIds: roster.map((entry) => entry.creatorIdentity.id),
    window: { since: metricsSince },
  });

  // Step 5 — invoke the pure selector with the assembled input.
  return selectSyntheticCreator({
    brief: input.brief,
    now: input.now,
    roster,
    leases,
    performanceHistory,
  });
}
