// PCD slice SP16/SP17 — 21st pinned PCD constant + declarative pairing matrix.
//
// SP17 bumped PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION from 1.0.0 → 1.1.0
// because the matrix grew from one row (kling only) to two rows (kling +
// seedance), partitioning lookups by 3-tuple (shotType, outputIntent,
// videoProvider).
//
// MERGE-BACK: Future provider-specific narrowing (e.g., Seedance loses
// label_closeup) edits a row's shotTypes array. Adding
// INVALID_VIDEO_PROVIDER_CHOICE as a reachable denial requires the slice
// that introduces the narrowing to add the denial branch, the routing step,
// and the tests. v1.1.0 keeps both rows covering the full 7×4 grid.
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

export const PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION = "pcd-synthetic-provider-pairing@1.1.0";

export type SyntheticProviderPairing = {
  shotTypes: ReadonlyArray<PcdShotType>;
  outputIntents: ReadonlyArray<OutputIntent>;
  imageProvider: "dalle";
  videoProvider: "kling" | "seedance";
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
    videoProvider: "seedance",
  },
] as const;
