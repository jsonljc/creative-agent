import { describe, expect, it } from "vitest";
import {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
} from "./registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";

function neverCalledStores(): RegistryResolverStores {
  return {
    productStore: {
      findOrCreateForJob: async () => {
        throw new Error("productStore.findOrCreateForJob should not be called");
      },
    },
    creatorStore: {
      findOrCreateStockForDeployment: async () => {
        throw new Error("creatorStore.findOrCreateStockForDeployment should not be called");
      },
    },
    jobStore: {
      attachIdentityRefs: async () => {
        throw new Error("jobStore.attachIdentityRefs should not be called");
      },
    },
  };
}

const RESOLVED_JOB: PcdResolvableJob = {
  id: "job-1",
  organizationId: "org-1",
  deploymentId: "dep-1",
  productDescription: "test product",
  productImages: [],
  productIdentityId: "p1",
  creatorIdentityId: "c1",
  effectiveTier: 2,
  allowedOutputTier: 2,
  shotSpecVersion: PCD_SHOT_SPEC_VERSION,
};

describe("resolvePcdRegistryContext — idempotency guard (already resolved at current version)", () => {
  it("returns existing context with zero store calls", async () => {
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, neverCalledStores());
    expect(result).toEqual({
      productIdentityId: "p1",
      creatorIdentityId: "c1",
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    });
  });
});
