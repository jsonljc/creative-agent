import { z } from "zod";

export const IdentityTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type IdentityTier = z.infer<typeof IdentityTierSchema>;

export const ProductQualityTierSchema = z.enum(["url_imported", "verified", "canonical"]);
export type ProductQualityTier = z.infer<typeof ProductQualityTierSchema>;

export const ProductLockStatusSchema = z.enum(["draft", "verified", "locked", "deprecated"]);
export type ProductLockStatus = z.infer<typeof ProductLockStatusSchema>;

export const ProductDimensionsSchema = z.object({
  h: z.number().positive(),
  w: z.number().positive(),
  d: z.number().positive(),
});
export type ProductDimensions = z.infer<typeof ProductDimensionsSchema>;

export const ProductColorSpecSchema = z.object({
  primaryHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondaryHex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  pantone: z.string().optional(),
});
export type ProductColorSpec = z.infer<typeof ProductColorSpecSchema>;

export const ProductIdentitySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  sourceUrl: z.string().url().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  packageType: z.string().nullable().optional(),
  canonicalPackageText: z.string().nullable().optional(),
  dimensionsMm: ProductDimensionsSchema.nullable().optional(),
  colorSpec: ProductColorSpecSchema.nullable().optional(),
  logoAssetId: z.string().nullable().optional(),
  qualityTier: ProductQualityTierSchema,
  lockStatus: ProductLockStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

export const ProductImageViewTypeSchema = z.enum([
  "hero_front",
  "back",
  "side",
  "three_quarter",
  "macro_label",
  "transparent_cutout",
  "logo",
  "fallback_scraped",
]);
export type ProductImageViewType = z.infer<typeof ProductImageViewTypeSchema>;

export const ProductImageSchema = z.object({
  id: z.string(),
  productIdentityId: z.string(),
  viewType: ProductImageViewTypeSchema,
  uri: z.string(),
  resolution: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .nullable()
    .optional(),
  hasReadableLabel: z.boolean().nullable().optional(),
  ocrText: z.string().nullable().optional(),
  backgroundType: z.string().nullable().optional(),
  approvedForGeneration: z.boolean(),
  createdAt: z.coerce.date(),
});
export type ProductImage = z.infer<typeof ProductImageSchema>;

export const ConsentRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  personName: z.string(),
  scopeOfUse: z.array(z.string()).min(1),
  territory: z.array(z.string()).min(1),
  mediaTypes: z.array(z.string()).min(1),
  revocable: z.boolean(),
  revoked: z.boolean(),
  recordingUri: z.string().nullable().optional(),
  effectiveAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable().optional(),
  revokedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

// SP5: QC gate schemas — gate keys, statuses, aggregate statuses, modes, verdicts.
// Note: PcdQcGateApplicabilitySchema is defined further down in this file
// (it depends on PcdShotTypeSchema, which is positioned after ProductQcResultSchema
// per the SP4-era layout). Keep this comment in sync if either schema moves.

export const PcdQcGateKeySchema = z.enum([
  "face_similarity",
  "logo_similarity",
  "ocr_package_text",
  "geometry_scale",
]);
export type PcdQcGateKey = z.infer<typeof PcdQcGateKeySchema>;

export const PcdQcGateStatusSchema = z.enum(["pass", "warn", "fail", "skipped"]);
export type PcdQcGateStatus = z.infer<typeof PcdQcGateStatusSchema>;

export const PcdQcAggregateStatusSchema = z.enum(["pass", "warn", "fail"]);
export type PcdQcAggregateStatus = z.infer<typeof PcdQcAggregateStatusSchema>;

export const PcdQcGateModeSchema = z.enum(["block", "warn_only"]);
export type PcdQcGateMode = z.infer<typeof PcdQcGateModeSchema>;

export const PcdQcGateVerdictSchema = z.object({
  gate: PcdQcGateKeySchema,
  status: PcdQcGateStatusSchema,
  score: z.number().optional(),
  threshold: z.number().optional(),
  reason: z.string().min(1),
  // evidence is a small, non-PII, non-binary diagnostic bag. See design doc
  // "Evidence bounds (binding)" — no raw OCR text, no embeddings, no image
  // payloads, ≤2 KB JSON soft limit.
  evidence: z.record(z.unknown()).optional(),
});
export type PcdQcGateVerdict = z.infer<typeof PcdQcGateVerdictSchema>;

export const PcdQcGateVerdictsSchema = z
  .object({
    gates: z.array(PcdQcGateVerdictSchema),
    aggregateStatus: PcdQcAggregateStatusSchema,
  })
  .refine((v) => !(v.gates.length === 0 && v.aggregateStatus === "pass"), {
    message: "aggregateStatus cannot be 'pass' when no gates ran",
  });
export type PcdQcGateVerdicts = z.infer<typeof PcdQcGateVerdictsSchema>;

export const ProductQcResultSchema = z.object({
  id: z.string(),
  productIdentityId: z.string(),
  assetRecordId: z.string(),
  logoSimilarityScore: z.number().min(0).max(1).nullable().optional(),
  packageOcrMatchScore: z.number().min(0).max(1).nullable().optional(),
  // Unbounded delta (CIE76 ΔE etc.), not a 0–1 ratio like the other scores.
  colorDeltaScore: z.number().min(0).nullable().optional(),
  geometryMatchScore: z.number().min(0).max(1).nullable().optional(),
  scaleConfidence: z.number().min(0).max(1).nullable().optional(),
  passFail: z.enum(["pass", "fail", "warn"]),
  warnings: z.array(z.string()),
  createdAt: z.coerce.date(),
  // SP5 additions — see docs/plans/2026-04-29-pcd-qc-gates-sp5-design.md.
  // nullable = DB historical-compat (pre-SP5 rows).
  // optional = schema-compat for partial in-memory test fixtures.
  creatorIdentityId: z.string().nullable().optional(),
  pcdIdentitySnapshotId: z.string().nullable().optional(),
  faceSimilarityScore: z.number().min(0).max(1).nullable().optional(),
  gatesRan: z.array(PcdQcGateKeySchema).nullable().optional(),
  gateVerdicts: PcdQcGateVerdictsSchema.nullable().optional(),
  qcEvaluationVersion: z.string().nullable().optional(),
  qcGateMatrixVersion: z.string().nullable().optional(),
});
export type ProductQcResult = z.infer<typeof ProductQcResultSchema>;

export const PcdShotTypeSchema = z.enum([
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
]);
export type PcdShotType = z.infer<typeof PcdShotTypeSchema>;

export const OutputIntentSchema = z.enum(["draft", "preview", "final_export", "meta_draft"]);
export type OutputIntent = z.infer<typeof OutputIntentSchema>;

// SP4: routing-decision reason — references PcdShotTypeSchema and OutputIntentSchema
// defined above (single source of truth; pcd-tier-policy.ts imports them from here).
export const PcdRoutingDecisionReasonSchema = z.object({
  capabilityRefIndex: z.number().int().nonnegative(),
  matchedShotType: PcdShotTypeSchema,
  matchedEffectiveTier: IdentityTierSchema,
  matchedOutputIntent: OutputIntentSchema,
  tier3RulesApplied: z.array(
    z.enum(["first_last_frame_anchor", "performance_transfer", "edit_over_regenerate"]),
  ),
  candidatesEvaluated: z.number().int().nonnegative(),
  candidatesAfterTier3Filter: z.number().int().nonnegative(),
  selectionRationale: z.string().max(200),
});
export type PcdRoutingDecisionReason = z.infer<typeof PcdRoutingDecisionReasonSchema>;

export const PcdIdentitySnapshotSchema = z.object({
  id: z.string(),
  assetRecordId: z.string(),

  productIdentityId: z.string(),
  productTierAtGeneration: IdentityTierSchema,
  productImageAssetIds: z.array(z.string()),
  productCanonicalTextHash: z.string(),
  productLogoAssetId: z.string().nullable(),

  creatorIdentityId: z.string(),
  avatarTierAtGeneration: IdentityTierSchema,
  avatarReferenceAssetIds: z.array(z.string()),
  voiceAssetId: z.string().nullable(),
  consentRecordId: z.string().nullable(),

  policyVersion: z.string(),
  providerCapabilityVersion: z.string(),
  selectedProvider: z.string(),
  providerModelSnapshot: z.string(),
  seedOrNoSeed: z.string(),
  rewrittenPromptText: z.string().nullable(),

  // SP4 additions — nullable for historical compatibility (pre-SP4 / merge-back
  // rows that predate this slice). SP4 writer treats them as required for new writes.
  shotSpecVersion: z.string().nullable(),
  routerVersion: z.string().nullable(),
  routingDecisionReason: PcdRoutingDecisionReasonSchema.nullable(),

  createdAt: z.coerce.date(),
});
export type PcdIdentitySnapshot = z.infer<typeof PcdIdentitySnapshotSchema>;

export const PcdSp4IdentitySnapshotInputSchema = z.object({
  // Identity-side
  assetRecordId: z.string(),
  productIdentityId: z.string(),
  productTierAtGeneration: IdentityTierSchema,
  productImageAssetIds: z.array(z.string()),
  productCanonicalTextHash: z.string(),
  productLogoAssetId: z.string().nullable(),
  creatorIdentityId: z.string(),
  avatarTierAtGeneration: IdentityTierSchema,
  avatarReferenceAssetIds: z.array(z.string()),
  voiceAssetId: z.string().nullable(),
  consentRecordId: z.string().nullable(),

  // Provider-side (filled from provider response)
  selectedProvider: z.string(),
  providerModelSnapshot: z.string(),
  seedOrNoSeed: z.string(),
  rewrittenPromptText: z.string().nullable(),

  // SP4 forensic fields (REQUIRED for new writes; nullable on the stored row)
  shotSpecVersion: z.string(),
  routerVersion: z.string(),
  routingDecisionReason: PcdRoutingDecisionReasonSchema,

  // policyVersion + providerCapabilityVersion intentionally absent: writer
  // pins them from imports; caller cannot override.
});
export type PcdSp4IdentitySnapshotInput = z.infer<typeof PcdSp4IdentitySnapshotInputSchema>;

export const PcdQcGateApplicabilitySchema = z.object({
  shotType: PcdShotTypeSchema,
  effectiveTier: IdentityTierSchema,
  gate: PcdQcGateKeySchema,
  mode: PcdQcGateModeSchema,
  rationale: z.string().max(200).optional(),
});
export type PcdQcGateApplicability = z.infer<typeof PcdQcGateApplicabilitySchema>;

export const PcdSp5QcLedgerInputSchema = z
  .object({
    // Identity-side (required)
    assetRecordId: z.string(),
    productIdentityId: z.string(),
    pcdIdentitySnapshotId: z.string(),
    creatorIdentityId: z.string().nullable(),

    // Forensic version pins (REQUIRED, evaluator-pinned from imports)
    qcEvaluationVersion: z.string(),
    qcGateMatrixVersion: z.string(),

    // Gate result fields (REQUIRED)
    gateVerdicts: PcdQcGateVerdictsSchema,
    gatesRan: z.array(PcdQcGateKeySchema),

    // Per-gate scalar scores (nullable when gate skipped or not run)
    faceSimilarityScore: z.number().min(0).max(1).nullable(),
    logoSimilarityScore: z.number().min(0).max(1).nullable(),
    packageOcrMatchScore: z.number().min(0).max(1).nullable(),
    geometryMatchScore: z.number().min(0).max(1).nullable(),
    scaleConfidence: z.number().min(0).max(1).nullable(),
    colorDeltaScore: z.number().min(0).nullable(),

    // Aggregate (derived from gateVerdicts.aggregateStatus)
    passFail: z.enum(["pass", "fail", "warn"]),
    warnings: z.array(z.string()),
  })
  .refine(
    (v) =>
      !v.gatesRan.includes("face_similarity") ||
      (v.creatorIdentityId !== null && v.faceSimilarityScore !== null),
    {
      message: "creatorIdentityId and faceSimilarityScore required when face_similarity gate ran",
    },
  )
  .refine(
    (v) =>
      v.gatesRan.length === v.gateVerdicts.gates.length &&
      v.gatesRan.every((g, i) => g === v.gateVerdicts.gates[i]!.gate),
    { message: "gatesRan must equal gateVerdicts.gates[*].gate (same order)" },
  );
export type PcdSp5QcLedgerInput = z.infer<typeof PcdSp5QcLedgerInputSchema>;
