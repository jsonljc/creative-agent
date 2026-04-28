import type { AvatarQualityTier, IdentityTier, ProductQualityTier } from "@creativeagent/schemas";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";

export type PcdResolvableJob = {
  id: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  productImages: string[];
  productIdentityId?: string | null;
  creatorIdentityId?: string | null;
  effectiveTier?: IdentityTier | null;
  allowedOutputTier?: IdentityTier | null;
  shotSpecVersion?: string | null;
};

export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  productTier: IdentityTier; // SP4 addition
  creatorTier: IdentityTier; // SP4 addition
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: string;
};

export type RegistryResolverStores = {
  productStore: {
    findOrCreateForJob(job: PcdResolvableJob): Promise<{
      id: string;
      qualityTier: ProductQualityTier;
    }>;
  };
  creatorStore: {
    findOrCreateStockForDeployment(deploymentId: string): Promise<{
      id: string;
      qualityTier: AvatarQualityTier;
    }>;
  };
  jobStore: {
    attachIdentityRefs(jobId: string, refs: ResolvedPcdContext): Promise<void>;
  };
};

type ResolvedPcdResolvableJob = PcdResolvableJob & {
  productIdentityId: string;
  creatorIdentityId: string;
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: typeof PCD_SHOT_SPEC_VERSION;
};

function isResolvedPcdJob(j: PcdResolvableJob): j is ResolvedPcdResolvableJob {
  return (
    typeof j.productIdentityId === "string" &&
    typeof j.creatorIdentityId === "string" &&
    (j.effectiveTier === 1 || j.effectiveTier === 2 || j.effectiveTier === 3) &&
    (j.allowedOutputTier === 1 || j.allowedOutputTier === 2 || j.allowedOutputTier === 3) &&
    j.shotSpecVersion === PCD_SHOT_SPEC_VERSION
  );
}

function mapProductQualityTierToIdentityTier(t: ProductQualityTier): IdentityTier {
  switch (t) {
    case "url_imported":
      return 1;
    case "verified":
      return 2;
    case "canonical":
      return 3;
  }
}

function mapCreatorQualityTierToIdentityTier(t: AvatarQualityTier): IdentityTier {
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
  // Cast accepted by design: TypeScript widens `1 | 2 | 3` to `number` through the
  // ternary; result is always one of the inputs. See SP3 design Section 3.
  return (p <= c ? p : c) as IdentityTier;
}

export async function resolvePcdRegistryContext(
  job: PcdResolvableJob,
  stores: RegistryResolverStores,
): Promise<ResolvedPcdContext> {
  // Always read current registry component tiers. On the no-op path we still
  // skip attachIdentityRefs (no write), but we need productTier and creatorTier
  // to satisfy the SP4-revised ResolvedPcdContext contract. Registry is the
  // source of truth for component tiers; CreativeJob does not shadow them.
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(job.deploymentId);
  const productTier = mapProductQualityTierToIdentityTier(product.qualityTier);
  const creatorTier = mapCreatorQualityTierToIdentityTier(creator.qualityTier);

  if (isResolvedPcdJob(job)) {
    // No-op path: effectiveTier and allowedOutputTier reflect ORIGINAL
    // resolution time (preserved from job stamp). productTier and creatorTier
    // reflect CURRENT registry state. They may diverge if registry rows were
    // re-tiered after job stamping. Downstream consumers must treat
    // effectiveTier as authoritative for gating.
    return {
      productIdentityId: job.productIdentityId,
      creatorIdentityId: job.creatorIdentityId,
      productTier,
      creatorTier,
      effectiveTier: job.effectiveTier,
      allowedOutputTier: job.allowedOutputTier,
      shotSpecVersion: job.shotSpecVersion,
    };
  }

  const effectiveTier = computeEffectiveTier(productTier, creatorTier);

  const resolved: ResolvedPcdContext = {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
    productTier,
    creatorTier,
    effectiveTier,
    allowedOutputTier: effectiveTier,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };

  await stores.jobStore.attachIdentityRefs(job.id, resolved);

  return resolved;
}
