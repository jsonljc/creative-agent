// PCD slice SP14 — pure deterministic disclosure resolver.
// Mirrors SP12 license-gate / SP13 selector shape: typed input record,
// no I/O, no clock reads — caller supplies `now` and the templates
// snapshot. Invoked at job-creation time per umbrella spec §4 step 6.
//
// Algorithm:
//   1. Exact-tuple filter on (jurisdictionCode, platform, treatmentClass).
//   2. Half-open window filter at `now`: [effectiveFrom, effectiveTo),
//      with effectiveTo: null meaning indefinite.
//   3. Pick highest `version`; final tie-break `id` ASC.
//
// No wildcard fallback. Two failure reasons. Decision is zod-only;
// persistence is SP17's responsibility.
//
// MERGE-BACK: Caller (SP21 composer or equivalent) supplies the templates
// snapshot via PrismaDisclosureTemplateReader.listByTuple(...). SP14 itself
// never reads. Mirrors SP12 licenseGate(leases) / SP13 selectSyntheticCreator
// (roster, leases) snapshot pattern.

import type {
  CreativeBrief,
  DisclosureResolutionDecision,
  DisclosureTemplatePayload,
} from "@creativeagent/schemas";
import { PCD_DISCLOSURE_RESOLVER_VERSION } from "./disclosure-resolver-version.js";

export type ResolveDisclosureInput = {
  brief: CreativeBrief;
  now: Date;
  templates: readonly DisclosureTemplatePayload[];
};

export function resolveDisclosure(input: ResolveDisclosureInput): DisclosureResolutionDecision {
  // Step 1 — exact-tuple filter
  const tupleMatched = input.templates.filter(
    (t) =>
      t.jurisdictionCode === input.brief.jurisdictionCode &&
      t.platform === input.brief.platform &&
      t.treatmentClass === input.brief.treatmentClass,
  );

  if (tupleMatched.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_template_for_tuple",
      jurisdictionCode: input.brief.jurisdictionCode,
      platform: input.brief.platform,
      treatmentClass: input.brief.treatmentClass,
      inspectedTemplateIds: [],
      resolverVersion: PCD_DISCLOSURE_RESOLVER_VERSION,
    };
  }

  // Steps 2 + 3 are placeholders for tasks 9 + 10. For now, naively pick
  // the first tuple-matched row.
  const winner = tupleMatched[0]!;
  return {
    allowed: true,
    briefId: input.brief.briefId,
    disclosureTemplateId: winner.id,
    jurisdictionCode: input.brief.jurisdictionCode,
    platform: input.brief.platform,
    treatmentClass: input.brief.treatmentClass,
    templateVersion: winner.version,
    disclosureText: winner.text,
    resolverVersion: PCD_DISCLOSURE_RESOLVER_VERSION,
    decisionReason: `tuple_resolved (active=1, total_for_tuple=${tupleMatched.length}, picked_version=${winner.version})`,
  };
}
