// ⚠️ PLACEHOLDER SCRIPT TEMPLATES — NOT FOR PRODUCTION USE.
// Every row's `text` is a stub; creative content team must replace
// before any synthetic-creator-rendered ad ships. Render paths MUST
// guard against isPlaceholderScriptText() returning true.
//
// MERGE-BACK: Replace with real authored copy before Switchboard
// production launch. Seed is dev/test only. Production launch requires
// a separate authoring pass; do NOT promote placeholder rows.
//
// SP15 seed shape: 24 cells covering 6 vibes × 4 treatments.
// Every cell version=1, status="active", compatibleCreatorIdentityIds
// = all 10 SP11 roster creator IDs (imported, not duplicated).
import type { ScriptTemplatePayload } from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import { PLACEHOLDER_SCRIPT_PREFIX } from "./script-placeholder.js";

const COMPATIBLE_IDS = SP11_SYNTHETIC_CREATOR_ROSTER.map((r) => r.creatorIdentity.id);

const VIBES = [
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
] as const;

const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;

function makeRow(
  vibe: (typeof VIBES)[number],
  treatmentClass: (typeof TREATMENTS)[number],
): ScriptTemplatePayload {
  return {
    id: `script-template-${vibe}-${treatmentClass}-v1`,
    vibe,
    treatmentClass,
    text: `${PLACEHOLDER_SCRIPT_PREFIX} ${vibe}/${treatmentClass}]`,
    compatibleCreatorIdentityIds: COMPATIBLE_IDS,
    version: 1,
    status: "active",
  };
}

export const SCRIPT_TEMPLATE_SEED: readonly ScriptTemplatePayload[] = VIBES.flatMap((v) =>
  TREATMENTS.map((t) => makeRow(v, t)),
);
