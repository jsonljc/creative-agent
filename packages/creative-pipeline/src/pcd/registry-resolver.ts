import type {
  AvatarQualityTier,
  IdentityTier,
  ProductQualityTier,
} from "@creativeagent/schemas";
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

export async function resolvePcdRegistryContext(
  job: PcdResolvableJob,
  stores: RegistryResolverStores,
): Promise<ResolvedPcdContext> {
  if (isResolvedPcdJob(job)) {
    return {
      productIdentityId: job.productIdentityId,
      creatorIdentityId: job.creatorIdentityId,
      effectiveTier: job.effectiveTier,
      allowedOutputTier: job.allowedOutputTier,
      shotSpecVersion: job.shotSpecVersion,
    };
  }

  // Full attach path wired in Task 3.
  void stores;
  throw new Error("registry-resolver: full attach path not yet implemented (Task 3)");
}
