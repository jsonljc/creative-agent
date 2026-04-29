import type { IdentityTier, PcdQcGateApplicability, PcdShotType } from "@creativeagent/schemas";

export const PCD_QC_GATE_MATRIX_VERSION = "pcd-qc-gate-matrix@1.0.0";

export const PCD_QC_GATE_MATRIX: ReadonlyArray<PcdQcGateApplicability> = [
  // OCR — label-visible shots
  {
    shotType: "label_closeup",
    effectiveTier: 3,
    gate: "ocr_package_text",
    mode: "block",
    rationale: "Label-visible Tier 3 final cannot ship without OCR match",
  },
  {
    shotType: "label_closeup",
    effectiveTier: 2,
    gate: "ocr_package_text",
    mode: "block",
    rationale: "Label-visible Tier 2 still requires OCR match",
  },
  {
    shotType: "product_demo",
    effectiveTier: 3,
    gate: "ocr_package_text",
    mode: "block",
    rationale: "Product demos at Tier 3 typically show readable label",
  },
  {
    shotType: "product_demo",
    effectiveTier: 2,
    gate: "ocr_package_text",
    mode: "warn_only",
    rationale: "Tier 2 product_demo: OCR informational",
  },

  // Logo — package-visible shots
  { shotType: "label_closeup", effectiveTier: 3, gate: "logo_similarity", mode: "block" },
  { shotType: "label_closeup", effectiveTier: 2, gate: "logo_similarity", mode: "warn_only" },
  { shotType: "product_demo", effectiveTier: 3, gate: "logo_similarity", mode: "block" },
  { shotType: "product_demo", effectiveTier: 2, gate: "logo_similarity", mode: "warn_only" },
  { shotType: "product_in_hand", effectiveTier: 3, gate: "logo_similarity", mode: "block" },
  { shotType: "product_in_hand", effectiveTier: 2, gate: "logo_similarity", mode: "warn_only" },
  { shotType: "object_insert", effectiveTier: 3, gate: "logo_similarity", mode: "block" },
  { shotType: "simple_ugc", effectiveTier: 3, gate: "logo_similarity", mode: "warn_only" },

  // Face — face-visible shots
  {
    shotType: "face_closeup",
    effectiveTier: 3,
    gate: "face_similarity",
    mode: "block",
    rationale: "Tier 3 face_closeup: identity drift hard-blocks",
  },
  { shotType: "talking_head", effectiveTier: 3, gate: "face_similarity", mode: "block" },
  { shotType: "talking_head", effectiveTier: 2, gate: "face_similarity", mode: "warn_only" },
  { shotType: "simple_ugc", effectiveTier: 3, gate: "face_similarity", mode: "warn_only" },
  { shotType: "simple_ugc", effectiveTier: 2, gate: "face_similarity", mode: "warn_only" },
  {
    shotType: "product_in_hand",
    effectiveTier: 3,
    gate: "face_similarity",
    mode: "warn_only",
    rationale: "Face often visible holding product",
  },

  // Geometry / scale — product-in-hand and object-insert
  {
    shotType: "product_in_hand",
    effectiveTier: 3,
    gate: "geometry_scale",
    mode: "block",
    rationale: "Hand-product scale must match canonical dimensions",
  },
  { shotType: "product_in_hand", effectiveTier: 2, gate: "geometry_scale", mode: "warn_only" },
  { shotType: "object_insert", effectiveTier: 3, gate: "geometry_scale", mode: "block" },
  { shotType: "object_insert", effectiveTier: 2, gate: "geometry_scale", mode: "warn_only" },

  // Tier 1: zero rows — by design. Future telemetry comes on via warn_only
  // rows + PCD_QC_GATE_MATRIX_VERSION bump. Zero orchestrator code change.
] as const;

export function getPcdQcGateApplicability(input: {
  shotType: PcdShotType;
  effectiveTier: IdentityTier;
}): PcdQcGateApplicability[] {
  return PCD_QC_GATE_MATRIX.filter(
    (row) => row.shotType === input.shotType && row.effectiveTier === input.effectiveTier,
  );
}
