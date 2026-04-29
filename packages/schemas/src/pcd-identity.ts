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
