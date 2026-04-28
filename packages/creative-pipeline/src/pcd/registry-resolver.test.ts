import { describe, expect, it } from "vitest";
import {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
} from "./registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";
import type { AvatarQualityTier, ProductQualityTier } from "@creativeagent/schemas";
import type { ResolvedPcdContext } from "./registry-resolver.js";

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

type CallLog = {
  findOrCreateForJobCalls: number;
  findOrCreateStockForDeploymentCalls: number;
  attachIdentityRefsCalls: number;
  attachIdentityRefsArgs: Array<{ jobId: string; refs: ResolvedPcdContext }>;
  // Order tokens: incremented before each store call; used to assert relative ordering.
  productResolvedAt: number | null;
  creatorResolvedAt: number | null;
  attachStartedAt: number | null;
  productCreateCount: number; // tracks unique identity rows created
  creatorCreateCount: number;
};

type FakeOptions = {
  productQualityTier?: ProductQualityTier;
  creatorQualityTier?: AvatarQualityTier;
  productId?: string;
  creatorId?: string;
};

function makeFakes(opts: FakeOptions = {}): {
  stores: RegistryResolverStores;
  log: CallLog;
} {
  const log: CallLog = {
    findOrCreateForJobCalls: 0,
    findOrCreateStockForDeploymentCalls: 0,
    attachIdentityRefsCalls: 0,
    attachIdentityRefsArgs: [],
    productResolvedAt: null,
    creatorResolvedAt: null,
    attachStartedAt: null,
    productCreateCount: 0,
    creatorCreateCount: 0,
  };
  let orderTick = 0;
  // Find-or-create semantics: one row per (jobId | deploymentId).
  const productRows = new Map<string, { id: string; qualityTier: ProductQualityTier }>();
  const creatorRows = new Map<string, { id: string; qualityTier: AvatarQualityTier }>();

  const stores: RegistryResolverStores = {
    productStore: {
      async findOrCreateForJob(job) {
        log.findOrCreateForJobCalls += 1;
        log.productResolvedAt = ++orderTick;
        const existing = productRows.get(job.id);
        if (existing) return existing;
        log.productCreateCount += 1;
        const row = {
          id: opts.productId ?? `p_${log.productCreateCount}`,
          qualityTier: opts.productQualityTier ?? "verified",
        } as const;
        productRows.set(job.id, row);
        return row;
      },
    },
    creatorStore: {
      async findOrCreateStockForDeployment(deploymentId) {
        log.findOrCreateStockForDeploymentCalls += 1;
        log.creatorResolvedAt = ++orderTick;
        const existing = creatorRows.get(deploymentId);
        if (existing) return existing;
        log.creatorCreateCount += 1;
        const row = {
          id: opts.creatorId ?? `c_${log.creatorCreateCount}`,
          qualityTier: opts.creatorQualityTier ?? "anchored",
        } as const;
        creatorRows.set(deploymentId, row);
        return row;
      },
    },
    jobStore: {
      async attachIdentityRefs(jobId, refs) {
        log.attachIdentityRefsCalls += 1;
        log.attachStartedAt = ++orderTick;
        log.attachIdentityRefsArgs.push({ jobId, refs });
      },
    },
  };
  return { stores, log };
}

const UNRESOLVED_JOB: PcdResolvableJob = {
  id: "job-1",
  organizationId: "org-1",
  deploymentId: "dep-1",
  productDescription: "test product",
  productImages: [],
};

describe("resolvePcdRegistryContext — full attach flow (happy path)", () => {
  it("verified + anchored → effectiveTier 2; calls finders and attachIdentityRefs once", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
      productId: "p1",
      creatorId: "c1",
    });

    const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);

    expect(result).toEqual({
      productIdentityId: "p1",
      creatorIdentityId: "c1",
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    });
    expect(log.findOrCreateForJobCalls).toBe(1);
    expect(log.findOrCreateStockForDeploymentCalls).toBe(1);
    expect(log.attachIdentityRefsCalls).toBe(1);
    expect(log.attachIdentityRefsArgs[0]).toEqual({ jobId: "job-1", refs: result });

    // attachIdentityRefs must run after both finders. Relative finder order is
    // intentionally NOT asserted (leaves room for future Promise.all).
    expect(log.productResolvedAt).not.toBeNull();
    expect(log.creatorResolvedAt).not.toBeNull();
    expect(log.attachStartedAt).not.toBeNull();
    expect(log.attachStartedAt!).toBeGreaterThan(log.productResolvedAt!);
    expect(log.attachStartedAt!).toBeGreaterThan(log.creatorResolvedAt!);
  });
});

const PRODUCT_TIERS: ProductQualityTier[] = ["url_imported", "verified", "canonical"];
const CREATOR_TIERS: AvatarQualityTier[] = ["stock", "anchored", "soul_id"];

const PRODUCT_TIER_TO_IDENTITY: Record<ProductQualityTier, 1 | 2 | 3> = {
  url_imported: 1,
  verified: 2,
  canonical: 3,
};
const CREATOR_TIER_TO_IDENTITY: Record<AvatarQualityTier, 1 | 2 | 3> = {
  stock: 1,
  anchored: 2,
  soul_id: 3,
};

describe("resolvePcdRegistryContext — product qualityTier mapping", () => {
  it.each(PRODUCT_TIERS)("product %s maps correctly", async (productQualityTier) => {
    const { stores } = makeFakes({ productQualityTier, creatorQualityTier: "soul_id" });
    const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
    const expectedProductTier = PRODUCT_TIER_TO_IDENTITY[productQualityTier];
    // creator is soul_id → 3, so effectiveTier = product mapping.
    expect(result.effectiveTier).toBe(expectedProductTier);
    expect(result.allowedOutputTier).toBe(expectedProductTier);
  });
});

describe("resolvePcdRegistryContext — creator qualityTier mapping", () => {
  it.each(CREATOR_TIERS)("creator %s maps correctly", async (creatorQualityTier) => {
    const { stores } = makeFakes({ productQualityTier: "canonical", creatorQualityTier });
    const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
    const expectedCreatorTier = CREATOR_TIER_TO_IDENTITY[creatorQualityTier];
    // product is canonical → 3, so effectiveTier = creator mapping.
    expect(result.effectiveTier).toBe(expectedCreatorTier);
    expect(result.allowedOutputTier).toBe(expectedCreatorTier);
  });
});

describe("resolvePcdRegistryContext — 3×3 effectiveTier = min cross-product", () => {
  const rows = PRODUCT_TIERS.flatMap((pq) =>
    CREATOR_TIERS.map((cq) => ({
      pq,
      cq,
      expected: Math.min(PRODUCT_TIER_TO_IDENTITY[pq], CREATOR_TIER_TO_IDENTITY[cq]) as 1 | 2 | 3,
    })),
  );

  it.each(rows)(
    "product=$pq creator=$cq → effectiveTier=$expected",
    async ({ pq, cq, expected }) => {
      const { stores } = makeFakes({ productQualityTier: pq, creatorQualityTier: cq });
      const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
      expect(result.effectiveTier).toBe(expected);
      expect(result.allowedOutputTier).toBe(expected);
    },
  );

  it("named asymmetry case: canonical product + stock creator → tier 1", async () => {
    const { stores } = makeFakes({
      productQualityTier: "canonical",
      creatorQualityTier: "stock",
    });
    const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
    expect(result.effectiveTier).toBe(1);
    expect(result.allowedOutputTier).toBe(1);
  });
});
