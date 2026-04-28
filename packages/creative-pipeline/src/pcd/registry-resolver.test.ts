import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
  type ResolvedPcdContext,
} from "./registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";
import type { AvatarQualityTier, IdentityTier, ProductQualityTier } from "@creativeagent/schemas";

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
  it("returns context with two finder calls and zero attachIdentityRefs writes", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, stores);
    expect(result).toEqual({
      productIdentityId: "p1",
      creatorIdentityId: "c1",
      productTier: 2,
      creatorTier: 2,
      effectiveTier: 2,
      allowedOutputTier: 2,
      shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    });
    expect(log.findOrCreateForJobCalls).toBe(1);
    expect(log.findOrCreateStockForDeploymentCalls).toBe(1);
    expect(log.attachIdentityRefsCalls).toBe(0);
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
      productTier: 2,
      creatorTier: 2,
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

describe("resolvePcdRegistryContext — idempotency guard edge cases (full path)", () => {
  const baseResolvedExceptVersion: PcdResolvableJob = {
    ...RESOLVED_JOB,
    shotSpecVersion: "shot-spec@0.9.0", // stale
  };

  const cases: Array<{ name: string; job: PcdResolvableJob }> = [
    { name: "stale shotSpecVersion", job: baseResolvedExceptVersion },
    { name: "missing productIdentityId", job: { ...RESOLVED_JOB, productIdentityId: null } },
    { name: "missing creatorIdentityId", job: { ...RESOLVED_JOB, creatorIdentityId: null } },
    { name: "missing effectiveTier", job: { ...RESOLVED_JOB, effectiveTier: null } },
    { name: "missing allowedOutputTier", job: { ...RESOLVED_JOB, allowedOutputTier: null } },
    { name: "missing shotSpecVersion", job: { ...RESOLVED_JOB, shotSpecVersion: null } },
    {
      name: "effectiveTier out of range (0)",
      job: { ...RESOLVED_JOB, effectiveTier: 0 as unknown as IdentityTier },
    },
    {
      name: "allowedOutputTier out of range (4)",
      job: { ...RESOLVED_JOB, allowedOutputTier: 4 as unknown as IdentityTier },
    },
  ];

  it.each(cases)("$name → full path runs and stamps current version", async ({ job }) => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const result = await resolvePcdRegistryContext(job, stores);
    expect(log.findOrCreateForJobCalls).toBe(1);
    expect(log.findOrCreateStockForDeploymentCalls).toBe(1);
    expect(log.attachIdentityRefsCalls).toBe(1);
    expect(result.shotSpecVersion).toBe(PCD_SHOT_SPEC_VERSION);
  });
});

describe("PCD_SHOT_SPEC_VERSION constant", () => {
  it("is locked to shot-spec@1.0.0 (SP4 snapshot writer pins this value)", () => {
    expect(PCD_SHOT_SPEC_VERSION).toBe("shot-spec@1.0.0");
  });
});

describe("resolvePcdRegistryContext — output shape & determinism", () => {
  it("ResolvedPcdContext has exactly the seven expected keys", async () => {
    const { stores } = makeFakes();
    const result = await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
    expect(Object.keys(result).sort()).toEqual(
      [
        "allowedOutputTier",
        "creatorIdentityId",
        "creatorTier",
        "effectiveTier",
        "productIdentityId",
        "productTier",
        "shotSpecVersion",
      ].sort(),
    );
  });

  it("two calls with identical inputs and fakes return deeply equal contexts", async () => {
    const fakes1 = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
      productId: "p1",
      creatorId: "c1",
    });
    const fakes2 = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
      productId: "p1",
      creatorId: "c1",
    });
    const a = await resolvePcdRegistryContext(UNRESOLVED_JOB, fakes1.stores);
    const b = await resolvePcdRegistryContext(UNRESOLVED_JOB, fakes2.stores);
    expect(a).toEqual(b);
  });
});

describe("resolvePcdRegistryContext — store-contract idempotency expectations", () => {
  it("repeat call on same stale-version job does not duplicate identity rows", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const staleJob: PcdResolvableJob = { ...RESOLVED_JOB, shotSpecVersion: "shot-spec@0.9.0" };

    await resolvePcdRegistryContext(staleJob, stores);
    await resolvePcdRegistryContext(staleJob, stores);

    // Both finders called twice (once per resolve), but only one row created
    // for product (keyed by job.id) and one for creator (keyed by deploymentId).
    expect(log.findOrCreateForJobCalls).toBe(2);
    expect(log.findOrCreateStockForDeploymentCalls).toBe(2);
    expect(log.productCreateCount).toBe(1);
    expect(log.creatorCreateCount).toBe(1);
    expect(log.attachIdentityRefsCalls).toBe(2);
  });

  it("attachIdentityRefs payload always carries all five fields with current version", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "url_imported",
      creatorQualityTier: "stock",
    });
    await resolvePcdRegistryContext(UNRESOLVED_JOB, stores);
    expect(log.attachIdentityRefsArgs).toHaveLength(1);
    const refs = log.attachIdentityRefsArgs[0]!.refs;
    expect(typeof refs.productIdentityId).toBe("string");
    expect(typeof refs.creatorIdentityId).toBe("string");
    expect([1, 2, 3]).toContain(refs.effectiveTier);
    expect([1, 2, 3]).toContain(refs.allowedOutputTier);
    expect(refs.shotSpecVersion).toBe(PCD_SHOT_SPEC_VERSION);
  });
});

describe("registry-resolver — forbidden imports guard (Layer 2 purity)", () => {
  it("registry-resolver.ts source contains no forbidden module references", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "registry-resolver.ts"), "utf8");
    const banned = [
      "@creativeagent/db",
      "@prisma/client",
      "inngest",
      'from "node:fs"',
      "from 'node:fs'",
      'from "http"',
      "from 'http'",
      'from "https"',
      "from 'https'",
      'from "./tier-policy.js"',
      "from './tier-policy.js'",
      'from "./registry-backfill.js"',
      "from './registry-backfill.js'",
    ];
    for (const needle of banned) {
      expect(source).not.toContain(needle);
    }
  });
});

describe("SP4 additive contract deltas", () => {
  it("returns productTier and creatorTier in the full-attach path (verified + anchored → tier 2 + tier 2)", async () => {
    const { stores, log } = makeFakes({
      productQualityTier: "verified",
      creatorQualityTier: "anchored",
    });
    const unresolvedJob: PcdResolvableJob = {
      id: "job-2",
      organizationId: "org-1",
      deploymentId: "dep-1",
      productDescription: "another product",
      productImages: [],
    };
    const result = await resolvePcdRegistryContext(unresolvedJob, stores);
    expect(result.productTier).toBe(2);
    expect(result.creatorTier).toBe(2);
    expect(result.effectiveTier).toBe(2);
    expect(log.attachIdentityRefsCalls).toBe(1);
  });

  it("no-op path returns current registry component tiers with originally-stamped effectiveTier (divergence case)", async () => {
    // Job was stamped at effectiveTier=2 originally. Registry now reports
    // productQualityTier=canonical (would map to tier 3) and creatorQualityTier=stock
    // (tier 1). The no-op path must return the current component tiers,
    // even though the stamped effectiveTier=2 no longer equals min(3, 1)=1.
    const { stores } = makeFakes({
      productQualityTier: "canonical",
      creatorQualityTier: "stock",
    });
    const result = await resolvePcdRegistryContext(RESOLVED_JOB, stores);
    expect(result.productTier).toBe(3); // current registry state
    expect(result.creatorTier).toBe(1); // current registry state
    expect(result.effectiveTier).toBe(2); // originally-stamped
    expect(result.allowedOutputTier).toBe(2);
  });

  it("full-attach path: each (productQualityTier, creatorQualityTier) maps correctly", async () => {
    const cases: Array<{
      product: "url_imported" | "verified" | "canonical";
      creator: "stock" | "anchored" | "soul_id";
      productTier: 1 | 2 | 3;
      creatorTier: 1 | 2 | 3;
    }> = [
      { product: "url_imported", creator: "stock", productTier: 1, creatorTier: 1 },
      { product: "verified", creator: "stock", productTier: 2, creatorTier: 1 },
      { product: "canonical", creator: "soul_id", productTier: 3, creatorTier: 3 },
    ];
    for (const c of cases) {
      const { stores } = makeFakes({
        productQualityTier: c.product,
        creatorQualityTier: c.creator,
      });
      const job: PcdResolvableJob = {
        id: `job-${c.product}-${c.creator}`,
        organizationId: "org",
        deploymentId: "dep",
        productDescription: "x",
        productImages: [],
      };
      const result = await resolvePcdRegistryContext(job, stores);
      expect(result.productTier).toBe(c.productTier);
      expect(result.creatorTier).toBe(c.creatorTier);
    }
  });
});
