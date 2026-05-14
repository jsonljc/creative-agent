// ⚠️ PLACEHOLDER DISCLOSURE TEMPLATES — NOT FOR PRODUCTION USE.
// Every row's `text` is a stub; legal must replace before any
// synthetic-creator-rendered ad ships. Render paths MUST guard against
// isPlaceholderDisclosureText() returning true.
//
// MERGE-BACK: Replace with real legal-authored copy before Switchboard
// production launch. Seed is dev/test only. Production launch requires
// a separate legal-authoring pass; do NOT promote placeholder rows.
//
// SP14 seed shape: 48 cells covering SG/MY/HK × meta/tiktok/red/youtube_shorts
// × med_spa/dental/anti_ageing/halal_wellness. Every cell version=1,
// effectiveFrom=2026-01-01T00:00:00Z, effectiveTo=null.

import type { DisclosureTemplatePayload } from "@creativeagent/schemas";
import { PLACEHOLDER_DISCLOSURE_PREFIX } from "./disclosure-placeholder.js";

const JURISDICTIONS = ["SG", "MY", "HK"] as const;
const PLATFORMS = ["meta", "tiktok", "red", "youtube_shorts"] as const;
const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;
const SEED_EPOCH = new Date("2026-01-01T00:00:00Z");

function buildRow(
  jurisdictionCode: (typeof JURISDICTIONS)[number],
  platform: (typeof PLATFORMS)[number],
  treatmentClass: (typeof TREATMENTS)[number],
): DisclosureTemplatePayload {
  const tag = `${jurisdictionCode}/${platform}/${treatmentClass}`;
  return {
    id: `disclosure-template-${jurisdictionCode}-${platform}-${treatmentClass}-v1`,
    jurisdictionCode,
    platform,
    treatmentClass,
    version: 1,
    text: `${PLACEHOLDER_DISCLOSURE_PREFIX} ${tag}]`,
    effectiveFrom: SEED_EPOCH,
    effectiveTo: null,
  };
}

const rows: DisclosureTemplatePayload[] = [];
for (const j of JURISDICTIONS) {
  for (const p of PLATFORMS) {
    for (const t of TREATMENTS) {
      rows.push(buildRow(j, p, t));
    }
  }
}

export const DISCLOSURE_TEMPLATE_SEED: readonly DisclosureTemplatePayload[] = Object.freeze(rows);
