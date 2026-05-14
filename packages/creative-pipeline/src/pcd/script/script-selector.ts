// PCD slice SP15 — pure deterministic script-template selector.
// Mirrors SP12 / SP13 / SP14 shape: typed input record, no I/O, no
// clock reads — caller supplies `now` (currently unused; reserved
// for future scheduled-activation widen) and the templates snapshot.
// Invoked at job-creation time per umbrella spec §4 step 7, AFTER
// SP12 license gate, SP13 creator selection, and SP14 disclosure
// resolution have settled.
//
// Algorithm:
//   1. 3-way prefilter: vibe + treatmentClass + status === "active".
//      Empty result → no_compatible_script.
//   2. Creator-compat filter: t.compatibleCreatorIdentityIds.includes(creatorIdentityId).
//      Empty result → all_filtered_by_creator (inspectedTemplateIds populated, id ASC).
//   3. Pick highest `version`; final tie-break `id` ASC.
//
// `now` is accepted for shape parity and forward compatibility; v1
// has no time-window semantics on ScriptTemplate. Behavioural test in
// script-selector.test.ts asserts that varying `now` does not change
// the decision for identical other inputs.
//
// MERGE-BACK: Caller (SP21 composer or equivalent) supplies the
// templates snapshot via PrismaScriptTemplateReader.listByVibeAndTreatment(...).
// SP15 itself never reads. Mirrors SP12 licenseGate(leases) / SP13
// selectSyntheticCreator(roster, leases) / SP14 resolveDisclosure(templates)
// snapshot pattern.
import type {
  CreativeBrief,
  ScriptSelectionDecision,
  ScriptTemplatePayload,
} from "@creativeagent/schemas";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";

export type SelectScriptInput = {
  brief: CreativeBrief;
  creatorIdentityId: string;
  now: Date; // accepted, unused in v1 — see top comment
  templates: readonly ScriptTemplatePayload[];
};

export function selectScript(input: SelectScriptInput): ScriptSelectionDecision {
  // Step 1 — 3-way prefilter on vibe + treatmentClass + status === "active"
  const threeWayMatched = input.templates.filter(
    (t) =>
      t.vibe === input.brief.targetVibe &&
      t.treatmentClass === input.brief.treatmentClass &&
      t.status === "active",
  );
  if (threeWayMatched.length === 0) {
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "no_compatible_script",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds: [],
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    };
  }

  // Step 2 — creator-compat filter
  const creatorMatched = threeWayMatched.filter((t) =>
    t.compatibleCreatorIdentityIds.includes(input.creatorIdentityId),
  );
  if (creatorMatched.length === 0) {
    const inspectedTemplateIds = threeWayMatched
      .map((t) => t.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      allowed: false,
      briefId: input.brief.briefId,
      reason: "all_filtered_by_creator",
      vibe: input.brief.targetVibe,
      treatmentClass: input.brief.treatmentClass,
      creatorIdentityId: input.creatorIdentityId,
      inspectedTemplateIds,
      selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    };
  }

  // Step 3 — pick highest version; final tie-break id ASC
  const ranked = [...creatorMatched].sort((a, b) => {
    if (b.version !== a.version) return b.version - a.version;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const winner = ranked[0]!;
  return {
    allowed: true,
    briefId: input.brief.briefId,
    scriptTemplateId: winner.id,
    vibe: input.brief.targetVibe,
    treatmentClass: input.brief.treatmentClass,
    scriptTemplateVersion: winner.version,
    creatorIdentityId: input.creatorIdentityId,
    scriptText: winner.text,
    selectorVersion: PCD_SCRIPT_SELECTOR_VERSION,
    decisionReason: `script_selected (creator_matched=${creatorMatched.length}, three_way=${threeWayMatched.length}, picked_version=${winner.version})`,
  };
}
