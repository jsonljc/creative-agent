import type { AvatarQualityTier, IdentityTier, ProductQualityTier } from "@creativeagent/schemas";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";

/** Thrown when a job claims to be resolved but the stamped tier context
 *  is incomplete or invalid. The resolver does NOT fall back to registry
 *  reads in this case — silent fallback would silently reintroduce the
 *  dual-authority routing bug this slice exists to fix.
 */
export class InvariantViolationError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly missingField: string,
  ) {
    super(
      `PCD resolver invariant violated: job "${jobId}" claims resolved state but ${missingField} is NULL or invalid. Resolver refuses to fall back to registry reads (would reintroduce dual-authority routing).`,
    );
    this.name = "InvariantViolationError";
  }
}

export type PcdResolvableJob = {
  // Identity for the write target.
  id: string;

  // Inputs to productStore.findOrCreateForJob.
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  productImages: string[];

  // Idempotency guard fields. All seven must be present (with current
  // shotSpecVersion) for the no-op zero-store-call path.
  productIdentityId?: string | null;
  creatorIdentityId?: string | null;
  productTierAtResolution?: IdentityTier | null;
  creatorTierAtResolution?: IdentityTier | null;
  effectiveTier?: IdentityTier | null;
  allowedOutputTier?: IdentityTier | null;
  shotSpecVersion?: string | null;
};

export type ResolvedPcdContext = {
  productIdentityId: string;
  creatorIdentityId: string;
  // SP4 amend: stamped at-resolution component tiers. The resolver writes
  // these once at full-attach time and reads them from the job row on the
  // no-op path. ProviderRouter consumes only these stamped fields.
  productTierAtResolution: IdentityTier;
  creatorTierAtResolution: IdentityTier;
  // Existing SP1 columns. Semantically: at-resolution stamps. Names kept
  // as-is to avoid a column-rename migration that would complicate
  // merge-back into Switchboard.
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: string;
};

export type RegistryResolverStores = {
  productStore: {
    /**
     * Idempotent identity resolution.
     *
     * If `job.productIdentityId` is already set, this MUST return the
     * registry row with exactly that id. It must not find-or-create a
     * different row from registry-side keys.
     *
     * If `job.productIdentityId` is unset, it may find or create by
     * registry-side keys.
     */
    findOrCreateForJob(job: PcdResolvableJob): Promise<{
      id: string;
      qualityTier: ProductQualityTier;
    }>;
  };
  creatorStore: {
    /**
     * Idempotent stock-creator resolution. If `job.creatorIdentityId` is
     * already set, MUST return that exact row.
     */
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
  productTierAtResolution: IdentityTier;
  creatorTierAtResolution: IdentityTier;
  effectiveTier: IdentityTier;
  allowedOutputTier: IdentityTier;
  shotSpecVersion: typeof PCD_SHOT_SPEC_VERSION;
};

function isIdentityTier(v: unknown): v is IdentityTier {
  return v === 1 || v === 2 || v === 3;
}

function isResolvedPcdJob(j: PcdResolvableJob): j is ResolvedPcdResolvableJob {
  return (
    typeof j.productIdentityId === "string" &&
    typeof j.creatorIdentityId === "string" &&
    isIdentityTier(j.productTierAtResolution) &&
    isIdentityTier(j.creatorTierAtResolution) &&
    isIdentityTier(j.effectiveTier) &&
    isIdentityTier(j.allowedOutputTier) &&
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
