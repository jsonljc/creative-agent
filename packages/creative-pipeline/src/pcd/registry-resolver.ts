import type { AvatarQualityTier, IdentityTier, ProductQualityTier } from "@creativeagent/schemas";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";
import { InvariantViolationError } from "./invariant-violation-error.js";

// Re-export so existing consumers (registry-resolver.test.ts and any external
// importer of `./registry-resolver.js`) keep working without an import-path change.
export { InvariantViolationError };

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

/** True iff the original SP3 5-core fields (IDs + effectiveTier +
 *  allowedOutputTier + current shotSpecVersion) are all valid. Does NOT
 *  check the SP4-amend stamped tier fields — that's the asymmetry the
 *  no-op vs malformed-guard path exploits.
 */
function hasFiveFieldCore(j: PcdResolvableJob): boolean {
  return (
    typeof j.productIdentityId === "string" &&
    typeof j.creatorIdentityId === "string" &&
    isIdentityTier(j.effectiveTier) &&
    isIdentityTier(j.allowedOutputTier) &&
    j.shotSpecVersion === PCD_SHOT_SPEC_VERSION
  );
}

function isResolvedPcdJob(j: PcdResolvableJob): j is ResolvedPcdResolvableJob {
  return (
    hasFiveFieldCore(j) &&
    isIdentityTier(j.productTierAtResolution) &&
    isIdentityTier(j.creatorTierAtResolution)
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
  // No-op path: every field comes from the job row. Zero store calls.
  // Restores SP3's original "zero store calls on no-op" idempotency
  // invariant. The pre-amend SP4 design relaxed this to read current
  // registry tiers; the amendment locks it back.
  if (isResolvedPcdJob(job)) {
    return {
      productIdentityId: job.productIdentityId,
      creatorIdentityId: job.creatorIdentityId,
      productTierAtResolution: job.productTierAtResolution,
      creatorTierAtResolution: job.creatorTierAtResolution,
      effectiveTier: job.effectiveTier,
      allowedOutputTier: job.allowedOutputTier,
      shotSpecVersion: job.shotSpecVersion,
    };
  }

  // Malformed-resolved-job invariant: if the resolved 5-field core is
  // present at the current shotSpecVersion but stamped component tiers
  // are missing/invalid, throw. Never fall back to registry reads —
  // silent fallback would silently reintroduce dual-authority routing.
  // Unreachable inside corrected SP4 (every resolution stamps both);
  // the guard catches any future regression that forgets to stamp.
  assertResolvedJobHasStampedComponentTiers(job);

  // Full-attach path: read both registry stores to derive component
  // tiers, compute effectiveTier, stamp all fields via attachIdentityRefs,
  // and return the resolved context.
  const product = await stores.productStore.findOrCreateForJob(job);
  const creator = await stores.creatorStore.findOrCreateStockForDeployment(job.deploymentId);

  const productTierAtResolution = mapProductQualityTierToIdentityTier(product.qualityTier);
  const creatorTierAtResolution = mapCreatorQualityTierToIdentityTier(creator.qualityTier);
  const effectiveTier = computeEffectiveTier(productTierAtResolution, creatorTierAtResolution);

  const resolved: ResolvedPcdContext = {
    productIdentityId: product.id,
    creatorIdentityId: creator.id,
    productTierAtResolution,
    creatorTierAtResolution,
    effectiveTier,
    allowedOutputTier: effectiveTier,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };

  await stores.jobStore.attachIdentityRefs(job.id, resolved);

  return resolved;
}

function assertResolvedJobHasStampedComponentTiers(job: PcdResolvableJob): void {
  // Only triggers when the original 5-core is present at the current
  // shotSpecVersion (signals "claims to be resolved") but the stamped
  // component tiers are missing. The asymmetry vs isResolvedPcdJob is
  // intentional: isResolvedPcdJob requires both stamped + core; this
  // helper catches the (core valid AND stamped invalid) intersection
  // that the no-op path leaves behind.
  if (!hasFiveFieldCore(job)) return;

  if (!isIdentityTier(job.productTierAtResolution)) {
    throw new InvariantViolationError(job.id, "productTierAtResolution");
  }
  if (!isIdentityTier(job.creatorTierAtResolution)) {
    throw new InvariantViolationError(job.id, "creatorTierAtResolution");
  }
}
