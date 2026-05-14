import { describe, expect, it, vi } from "vitest";
import type { PcdBriefInput, PreproductionTreeBudget } from "@creativeagent/schemas";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";
import { TreeBudgetExceededError } from "../budget/tree-budget-exceeded-error.js";
import { StubCoarseCostEstimator } from "./stub-coarse-cost-estimator.js";
import {
  runIdentityAwarePreproductionChainWithCostBudget,
  type RunIdentityAwarePreproductionChainWithCostBudgetStores,
} from "./run-identity-aware-preproduction-chain-with-cost-budget.js";
import { StubTrendsStageRunner } from "../preproduction/stages/stub-trends-stage-runner.js";
import { StubMotivatorsStageRunner } from "../preproduction/stages/stub-motivators-stage-runner.js";
import { StubHooksStageRunner } from "../preproduction/stages/stub-hooks-stage-runner.js";
import { StubCreatorScriptsStageRunner } from "../preproduction/stages/stub-creator-scripts-stage-runner.js";
import { AutoApproveAllScriptsGate } from "../preproduction/production-fanout-gate.js";

// ----- buildSp10cTestStores helper (adapted from SP10B test file) -----
// Builds a fully-wired stores object using real stub stage runners so the
// chain executes end-to-end without mocking. SP10C tests assert on
// out.result.stageOutputs.scripts.scripts.length which requires the real chain.
//
// Stub fanout: 2 trends × 2 motivators × 3 hooks × 2 scripts = 24 scripts.
// StubCoarseCostEstimator: 24 × $1.50 = $36.00 estimated.

function buildSp10cTestStores(args: {
  budget: PreproductionTreeBudget | null;
}): RunIdentityAwarePreproductionChainWithCostBudgetStores {
  return {
    // SP7 registry readers — return minimal valid rows for the sampleBrief refs.
    sp7ProductRegistryReader: {
      findById: async (id: string) => {
        if (id === "product-1") {
          return {
            id: "product-1",
            qualityTier: "url_imported" as const,
            canonicalPackageText: "Test product",
            heroPackshotAssetId: null,
            brandPositioningText: null,
          };
        }
        return null;
      },
    },
    sp7CreatorRegistryReader: {
      findById: async (id: string) => {
        if (id === "creator-1") {
          return {
            id: "creator-1",
            qualityTier: "stock" as const,
            voiceId: null,
            consentRecordId: null,
          };
        }
        return null;
      },
    },
    // SP6 consent readers — creator has no consentRecordId so consent check passes silently.
    creatorIdentityReader: {
      findById: async (id: string) => {
        if (id === "creator-1") {
          return { id: "creator-1", consentRecordId: null };
        }
        return null;
      },
    },
    consentRecordReader: {
      findById: async (_id: string) => null,
    },
    // Real stub stage runners — produce the deterministic fanout tree.
    trendsRunner: new StubTrendsStageRunner(),
    motivatorsRunner: new StubMotivatorsStageRunner(),
    hooksRunner: new StubHooksStageRunner(),
    creatorScriptsRunner: new StubCreatorScriptsStageRunner(),
    // Auto-approve gate selects all scripts.
    productionFanoutGate: new AutoApproveAllScriptsGate(),
    // Budget reader returns args.budget; overridable per-test via stores.budgetReader reassignment.
    budgetReader: {
      async resolveBudget(_input) {
        return args.budget;
      },
    },
    // Stub cost estimator — $1.50 per script deterministically.
    coarseCostEstimator: new StubCoarseCostEstimator(),
    // Fixed clock for deterministic timestamps.
    clock: () => new Date("2026-05-14T00:00:00.000Z"),
    organizationId: null,
  };
}

const sampleBrief: PcdBriefInput = {
  briefId: "b1",
  productDescription: "p",
  targetAudience: "a",
  platforms: ["instagram"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

describe("runIdentityAwarePreproductionChainWithCostBudget", () => {
  it("null-budget bypass — all three meta fields null on outcome, chain still runs", async () => {
    const stores = buildSp10cTestStores({ budget: null });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).toBeNull();
    expect(out.costMeta).toBeNull();
    expect(out.result.stageOutputs.scripts.scripts.length).toBeGreaterThan(0);
  });

  it("count-only budget (maxEstimatedUsd: null) — costMeta null, budgetMeta populated", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).not.toBeNull();
    expect(out.costMeta).toBeNull();
  });

  it("full count+cost budget happy path — all three meta fields populated", async () => {
    // SP8 stub fanout produces 24 scripts. Stub estimator = 24 × $1.50 = $36.
    // Threshold $100 passes.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).not.toBeNull();
    expect(out.costMeta).not.toBeNull();
    expect(out.costMeta?.estimatedUsd).toBe(36);
    expect(out.costMeta?.threshold).toBe(100);
    expect(out.costMeta?.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
  });

  it("cost gate fails — throws CostBudgetExceededError with meta", async () => {
    // 24 × $1.50 = $36, threshold $10 → fails.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 10 },
    });
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(CostBudgetExceededError);
    try {
      await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    } catch (err) {
      expect(err).toBeInstanceOf(CostBudgetExceededError);
      const e = err as CostBudgetExceededError;
      expect(e.meta.estimatedUsd).toBe(36);
      expect(e.meta.threshold).toBe(10);
      expect(e.meta.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
    }
  });

  it("cost equals threshold — passes (strict > semantics)", async () => {
    // 24 × $1.50 = $36 exactly.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 36 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.costMeta?.estimatedUsd).toBe(36);
  });

  it("SP10B throws TreeBudgetExceededError — propagated raw, estimator NEVER called", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 2, maxTreeSize: 10, maxEstimatedUsd: 1000 },
    });
    const estimateSpy = vi.spyOn(stores.coarseCostEstimator, "estimate");
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(TreeBudgetExceededError);
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("budgetReader throws — propagated raw", async () => {
    const stores = buildSp10cTestStores({ budget: null });
    stores.budgetReader = {
      async resolveBudget() {
        throw new Error("budget reader failure");
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrow("budget reader failure");
  });

  it("estimator throws — propagated raw", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    stores.coarseCostEstimator = {
      async estimate() {
        throw new Error("estimator failure");
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrow("estimator failure");
  });

  it("estimator output zod parse fails — ZodError propagated raw", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    stores.coarseCostEstimator = {
      async estimate() {
        return {
          estimatedUsd: -1,
          currency: "USD" as const,
          lineItems: [],
          estimatorVersion: "broken@0.0.0",
        };
      },
    };
    await expect(
      runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores),
    ).rejects.toThrowError(/estimatedUsd|nonnegative|Number must|too_small/);
  });

  it("budget reader called for the top-level fetch AND inside SP10B via stripMaxUsdReader", async () => {
    const callCount = { n: 0 };
    const stores = buildSp10cTestStores({ budget: null });
    stores.budgetReader = {
      async resolveBudget() {
        callCount.n += 1;
        return { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 };
      },
    };
    await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(callCount.n).toBe(2);
  });

  it("SP10B sees stripped budget (maxEstimatedUsd: null) via the wrapper", async () => {
    // If SP10C did NOT strip, SP10B's invariant assertion would throw
    // InvariantViolationError. Reaching the success path means the strip worked.
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.budgetMeta).not.toBeNull();
  });

  it("identityContext is built once at SP10C entry (estimator receives it)", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    let capturedIdentityContext: unknown = null;
    stores.coarseCostEstimator = {
      async estimate(input) {
        capturedIdentityContext = input.identityContext;
        return {
          estimatedUsd: 10,
          currency: "USD",
          lineItems: [{ label: "x", estimatedUsd: 10 }],
          estimatorVersion: "test@1.0.0",
        };
      },
    };
    await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(capturedIdentityContext).not.toBeNull();
    expect(
      (capturedIdentityContext as { identityContextVersion: string }).identityContextVersion,
    ).toBe("identity-context@1.0.0");
  });

  it("scriptCount in estimator call equals result.stageOutputs.scripts.scripts.length", async () => {
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 1000 },
    });
    let capturedScriptCount = -1;
    stores.coarseCostEstimator = {
      async estimate(input) {
        capturedScriptCount = input.scriptCount;
        return {
          estimatedUsd: 10,
          currency: "USD",
          lineItems: [],
          estimatorVersion: "t@1.0.0",
        };
      },
    };
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(capturedScriptCount).toBe(out.result.stageOutputs.scripts.scripts.length);
  });

  it("clock injection — estimatedAt uses stores.clock() when present", async () => {
    const fixedDate = new Date("2026-12-25T12:00:00.000Z");
    const stores = buildSp10cTestStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 1000 },
    });
    stores.clock = () => fixedDate;
    const out = await runIdentityAwarePreproductionChainWithCostBudget(sampleBrief, stores);
    expect(out.costMeta?.estimatedAt).toBe("2026-12-25T12:00:00.000Z");
  });
});
