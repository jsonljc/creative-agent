import {
  IdentityTierSchema,
  type AvatarQualityTier,
  type IdentityTier,
  type PcdBriefInput,
  type PcdIdentityContext,
  type PcdShotType,
  type ProductQualityTier,
  PcdBriefInputSchema,
  PcdShotTypeSchema,
  OutputIntentSchema,
  type OutputIntent,
  type UgcStyleConstraint,
} from "@creativeagent/schemas";
import { decidePcdGenerationAccess } from "../tier-policy.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import {
  assertConsentNotRevokedForGeneration,
  type AssertConsentNotRevokedForGenerationStores,
} from "../consent-pre-check-generation.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { deepFreeze } from "./deep-freeze.js";
import type { Sp7CreatorRegistryReader, Sp7ProductRegistryReader } from "./sp7-readers.js";

export type BuildPcdIdentityContextStores = {
  sp7ProductRegistryReader: Sp7ProductRegistryReader;
  sp7CreatorRegistryReader: Sp7CreatorRegistryReader;
} & AssertConsentNotRevokedForGenerationStores;

// Pure tier mapping — duplicates SP3's pure logic (SP3 source is not edited).
function mapProductQualityTier(t: ProductQualityTier): IdentityTier {
  switch (t) {
    case "url_imported":
      return 1;
    case "verified":
      return 2;
    case "canonical":
      return 3;
  }
}

function mapCreatorQualityTier(t: AvatarQualityTier): IdentityTier {
  switch (t) {
    case "stock":
      return 1;
    case "anchored":
      return 2;
    case "soul_id":
      return 3;
  }
}

function computeEffectiveTier(p: IdentityTier, c: IdentityTier): IdentityTier {
  return (p <= c ? p : c) as IdentityTier;
}

const ALL_SHOT_TYPES = PcdShotTypeSchema.options as readonly PcdShotType[];
const ALL_OUTPUT_INTENTS = OutputIntentSchema.options as readonly OutputIntent[];

function projectAllowedShotTypes(
  productTier: IdentityTier,
  creatorTier: IdentityTier,
): PcdShotType[] {
  return ALL_SHOT_TYPES.filter((shotType) => {
    const decision = decidePcdGenerationAccess({
      avatarTier: creatorTier,
      productTier,
      shotType,
      outputIntent: "preview",
    });
    return decision.allowed === true;
  });
}

function projectAllowedOutputIntents(
  productTier: IdentityTier,
  creatorTier: IdentityTier,
): OutputIntent[] {
  return ALL_OUTPUT_INTENTS.filter((outputIntent) =>
    ALL_SHOT_TYPES.some(
      (shotType) =>
        decidePcdGenerationAccess({
          avatarTier: creatorTier,
          productTier,
          shotType,
          outputIntent,
        }).allowed === true,
    ),
  );
}

function projectTier3Rules(
  effectiveTier: IdentityTier,
  allowedShotTypes: readonly PcdShotType[],
): PcdIdentityContext["tier3Rules"] {
  const isTier3 = effectiveTier === 3;
  return {
    firstLastFrameRequired: isTier3,
    performanceTransferRequired: isTier3 && allowedShotTypes.includes("talking_head"),
    editOverRegenerateRequired: isTier3,
  };
}

const DEFAULT_UGC_STYLE_CONSTRAINTS: readonly UgcStyleConstraint[] = [
  "native_vertical",
  "creator_led",
  "no_overproduced_storyboard",
  "product_fidelity_required",
  "no_invented_product_claims",
];

export async function buildPcdIdentityContext(
  brief: PcdBriefInput,
  stores: BuildPcdIdentityContextStores,
): Promise<PcdIdentityContext> {
  // 1. Validate brief — propagates ZodError raw.
  const validated = PcdBriefInputSchema.parse(brief);

  // 2. Read product registry by ref.
  const product = await stores.sp7ProductRegistryReader.findById(validated.productIdentityRef);
  if (product === null) {
    throw new InvariantViolationError("product identity not found", {
      productIdentityRef: validated.productIdentityRef,
    });
  }

  // 3. Read creator registry by ref.
  const creator = await stores.sp7CreatorRegistryReader.findById(validated.creatorIdentityRef);
  if (creator === null) {
    throw new InvariantViolationError("creator identity not found", {
      creatorIdentityRef: validated.creatorIdentityRef,
    });
  }

  // 4. SP6 consent pre-check — propagates ConsentRevokedRefusalError /
  //    InvariantViolationError raw.
  await assertConsentNotRevokedForGeneration(
    { creatorIdentityId: creator.id },
    {
      creatorIdentityReader: stores.creatorIdentityReader,
      consentRecordReader: stores.consentRecordReader,
    },
  );

  // 5. Project tiers.
  const productTier = mapProductQualityTier(product.qualityTier);
  const creatorTier = mapCreatorQualityTier(creator.qualityTier);
  const effectiveTier = computeEffectiveTier(productTier, creatorTier);

  // Validate via schema as a defense-in-depth check.
  IdentityTierSchema.parse(effectiveTier);

  const allowedShotTypes = projectAllowedShotTypes(productTier, creatorTier);
  const allowedOutputIntents = projectAllowedOutputIntents(productTier, creatorTier);
  const tier3Rules = projectTier3Rules(effectiveTier, allowedShotTypes);

  // 6. Populate UGC style constraints.
  const ugcStyleConstraints = [...DEFAULT_UGC_STYLE_CONSTRAINTS];

  // 7. Build the immutable context.
  const context: PcdIdentityContext = {
    creatorIdentityId: creator.id,
    productIdentityId: product.id,
    consentRecordId: creator.consentRecordId,

    effectiveTier,
    productTierAtResolution: productTier,
    creatorTierAtResolution: creatorTier,
    allowedShotTypes,
    allowedOutputIntents,
    tier3Rules,

    voiceId: creator.voiceId,
    productCanonicalText: product.canonicalPackageText ?? "",
    productHeroPackshotAssetId: product.heroPackshotAssetId,
    brandPositioningText: product.brandPositioningText,

    ugcStyleConstraints,

    consentRevoked: false, // SP6 pre-check throws on revoked, so reaching here means false
    // treeBudget is reserved for SP10 enforcement; SP8 always emits null.
    treeBudget: null,
    identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
  };

  // MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.
  return deepFreeze(context);
}
