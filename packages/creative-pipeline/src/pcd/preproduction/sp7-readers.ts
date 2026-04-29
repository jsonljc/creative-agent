import type {
  AvatarQualityTier,
  ProductQualityTier,
} from "@creativeagent/schemas";

// SP7 — wider readers than SP6's narrow consent-only readers. Read product
// and creator registry rows by ID and return the fields the SP7 chain needs:
// qualityTier (for SP7-side tier mapping), creative substrate fields, and
// the consent record reference (forwarded to SP6's pre-check).
//
// Note: SP7 does NOT call SP3's `resolvePcdRegistryContext`. SP3 takes a
// PcdResolvableJob (with organizationId/deploymentId/productDescription/
// productImages) and persists via jobStore.attachIdentityRefs. SP7's pre-job
// brief surface doesn't fit that signature, and SP7 must not persist. SP7
// duplicates SP3's pure qualityTier→IdentityTier mapping locally.
//
// MERGE-BACK: Switchboard wires a real Prisma adapter implementing both
// readers from packages/db/. The interfaces stay; the implementers swap.

export interface Sp7ProductRegistryReader {
  findById(productIdentityId: string): Promise<{
    id: string;
    qualityTier: ProductQualityTier;
    canonicalPackageText: string | null;
    heroPackshotAssetId: string | null;
    brandPositioningText: string | null;
  } | null>;
}

export interface Sp7CreatorRegistryReader {
  findById(creatorIdentityId: string): Promise<{
    id: string;
    qualityTier: AvatarQualityTier;
    voiceId: string | null;
    consentRecordId: string | null;
  } | null>;
}
