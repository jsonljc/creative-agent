// PCD slice SP16 — Synthetic provider pairing data.
//
// Declarative synthetic pairing matrix. v1 single-row covers all
// video-modality shot types defined in SP2's PcdShotType enum. Authoring
// intent: every synthetic-creator shot at a video-modality shot type uses
// the locked DALL-E + Kling pairing. Out-of-pairing shot types
// (script_only, storyboard) are deliberately absent — those route via
// SP4's existing matrix through the delegation branch of
// SyntheticPcdRoutingDecision.
//
// MERGE-BACK: Future modalities (e.g., voice for talking_head — different
// model pairing) add NEW rows. Adding a row that overlaps shot-types with
// the existing row requires a row-precedence rule (first-match? explicit
// priority?) — that's a future-PR design call. v1's single row makes the
// question moot.
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

// PCD slice SP16 — 21st pinned PCD constant.
// Pairing-data version. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (which
// versions the routing logic, not the data). Bumped when matrix membership
// changes in any way that can affect routing decisions.
//
// MERGE-BACK: Same provenance-replay assessment as router version.
export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.0.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling";
};

export const PCD_SYNTHETIC_PROVIDER_PAIRING: ReadonlyArray<SyntheticProviderPairing> = [
  {
    shotTypes: [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ],
    outputIntents: ["draft", "preview", "final_export", "meta_draft"],
    imageProvider: "dalle",
    videoProvider: "kling",
  },
] as const;
