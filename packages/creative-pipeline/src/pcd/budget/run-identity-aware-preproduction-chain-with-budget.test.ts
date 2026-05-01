import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PcdBriefInput,
  PcdPreproductionChainResult,
  PreproductionTreeBudget,
} from "@creativeagent/schemas";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { TreeBudgetExceededError } from "./tree-budget-exceeded-error.js";
import {
  runIdentityAwarePreproductionChainWithBudget,
  type RunIdentityAwarePreproductionChainWithBudgetStores,
} from "./run-identity-aware-preproduction-chain-with-budget.js";

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

// Build a minimal valid PcdPreproductionChainResult (small tree).
function smallResult(): PcdPreproductionChainResult {
  return {
    decision: {
      briefId: "b1",
      creatorIdentityId: "c1",
      productIdentityId: "p1",
      consentRecordId: null,
      effectiveTier: 1,
      selectedScriptIds: ["s-0-0-0-0"],
      availableScriptIds: ["s-0-0-0-0"],
      preproductionChainVersion: "x",
      identityContextVersion: "x",
      approvalLifecycleVersion: "x",
      preproductionFanoutVersion: "x",
      decidedAt: "2026-05-01T00:00:00.000Z",
      decidedBy: null,
      decisionNote: null,
      costForecast: null,
    },
    stageOutputs: {
      trends: {
        signals: [{ id: "t-0", summary: "s", audienceFit: "x", evidenceRefs: [] }],
      },
      motivators: {
        motivators: [
          {
            id: "m-0-0",
            frictionOrDesire: "f",
            audienceSegment: "a",
            evidenceRefs: [],
            parentTrendId: "t-0",
          },
        ],
      },
      hooks: {
        hooks: [
          {
            id: "h-0-0-0",
            text: "h",
            hookType: "direct_camera",
            parentMotivatorId: "m-0-0",
            parentTrendId: "t-0",
          },
        ],
      },
      scripts: {
        scripts: [
          {
            id: "s-0-0-0-0",
            hookText: "x",
            creatorAngle: "x",
            visualBeats: [],
            productMoment: "x",
            cta: "x",
            complianceNotes: [],
            identityConstraints: {
              creatorIdentityId: "c1",
              productIdentityId: "p1",
              voiceId: null,
            },
            parentHookId: "h-0-0-0",
            scriptStyle: "spoken_lines",
            spokenLines: ["line"],
          },
        ],
      },
    },
  };
}

// Helper: build a stores object with all SP7 fields stubbed + budgetReader injectable.
function buildStores(opts: {
  budget: PreproductionTreeBudget | null;
  organizationId?: string | null;
  resolveBudgetThrows?: unknown;
}): RunIdentityAwarePreproductionChainWithBudgetStores {
  return {
    // SP7 stub fields (typed but not exercised — we mock the chain at the import boundary)
    sp7ProductRegistryReader: { findById: vi.fn() } as never,
    sp7CreatorRegistryReader: { findById: vi.fn() } as never,
    creatorIdentityReader: { findById: vi.fn() } as never,
    consentRecordReader: { findById: vi.fn() } as never,
    trendsRunner: { run: vi.fn() } as never,
    motivatorsRunner: { run: vi.fn() } as never,
    hooksRunner: { run: vi.fn() } as never,
    creatorScriptsRunner: { run: vi.fn() } as never,
    productionFanoutGate: { requestSelection: vi.fn() } as never,
    clock: () => new Date("2026-05-01T00:00:00.000Z"),
    budgetReader: {
      resolveBudget: opts.resolveBudgetThrows
        ? vi.fn().mockRejectedValue(opts.resolveBudgetThrows)
        : vi.fn().mockResolvedValue(opts.budget),
    },
    organizationId: opts.organizationId ?? null,
  };
}

// Mock SP7's runIdentityAwarePreproductionChain so we control the result without
// running real stage runners. Vitest hoists vi.mock to the top of the file.
vi.mock("../preproduction/preproduction-chain.js", () => ({
  runIdentityAwarePreproductionChain: vi.fn(),
}));
import { runIdentityAwarePreproductionChain } from "../preproduction/preproduction-chain.js";

describe("runIdentityAwarePreproductionChainWithBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path — budget resolved, chain runs, validator passes, returns { result, budgetMeta }", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.result).toBeDefined();
    expect(outcome.budgetMeta).not.toBeNull();
    expect(outcome.budgetMeta?.observedTreeSize).toBe(4);
    expect(outcome.budgetMeta?.fanoutLevels).toHaveLength(3);
  });

  it("null-budget bypass — returns { result, budgetMeta: null }", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({ budget: null });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.result).toBeDefined();
    expect(outcome.budgetMeta).toBeNull();
  });

  it("non-null maxEstimatedUsd throws InvariantViolationError (SP10C-bleed protection)", async () => {
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: 100 },
    });
    await expect(
      runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores),
    ).rejects.toBeInstanceOf(InvariantViolationError);
    // Chain MUST NOT have been called — invariant fires before chain run.
    expect(runIdentityAwarePreproductionChain).not.toHaveBeenCalled();
  });

  it("validator fail-path — throws TreeBudgetExceededError carrying meta + violations", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 1, maxEstimatedUsd: null }, // observed=4 > 1
    });
    try {
      await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TreeBudgetExceededError);
      if (err instanceof TreeBudgetExceededError) {
        expect(err.reason).toBe("max_tree_size_exceeded");
        expect(err.budget.maxTreeSize).toBe(1);
        expect(err.meta.observedTreeSize).toBe(4);
        expect(err.violations).toHaveLength(0);
      }
    }
  });

  it("chain throw is propagated raw", async () => {
    const chainErr = new Error("chain blew up");
    vi.mocked(runIdentityAwarePreproductionChain).mockRejectedValueOnce(chainErr);
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    await expect(runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores)).rejects.toBe(
      chainErr,
    );
  });

  it("reader throw is propagated raw (chain MUST NOT run)", async () => {
    const readerErr = new Error("reader blew up");
    const stores = buildStores({ budget: null, resolveBudgetThrows: readerErr });
    await expect(runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores)).rejects.toBe(
      readerErr,
    );
    expect(runIdentityAwarePreproductionChain).not.toHaveBeenCalled();
  });

  it("reader is called BEFORE the chain (ordering invariant)", async () => {
    const callOrder: string[] = [];
    vi.mocked(runIdentityAwarePreproductionChain).mockImplementationOnce(async () => {
      callOrder.push("chain");
      return smallResult();
    });
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    stores.budgetReader.resolveBudget = vi.fn().mockImplementationOnce(async () => {
      callOrder.push("reader");
      return { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null };
    });
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(callOrder).toEqual(["reader", "chain"]);
  });

  it("reader receives briefId and organizationId from input", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
      organizationId: "org-42",
    });
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(stores.budgetReader.resolveBudget).toHaveBeenCalledWith({
      briefId: "b1",
      organizationId: "org-42",
    });
  });

  it("reader gets organizationId: null when stores.organizationId is undefined", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    delete (stores as { organizationId?: string | null }).organizationId;
    await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(stores.budgetReader.resolveBudget).toHaveBeenCalledWith({
      briefId: "b1",
      organizationId: null,
    });
  });

  it("validator ok-path forwards validation.meta unchanged into outcome.budgetMeta", async () => {
    vi.mocked(runIdentityAwarePreproductionChain).mockResolvedValueOnce(smallResult());
    const stores = buildStores({
      budget: { maxBranchFanout: 5, maxTreeSize: 50, maxEstimatedUsd: null },
    });
    const outcome = await runIdentityAwarePreproductionChainWithBudget(sampleBrief, stores);
    expect(outcome.budgetMeta?.treeBudgetVersion).toBe("pcd-tree-budget@1.0.0");
    expect(outcome.budgetMeta?.perStageCounts).toEqual({
      trends: 1,
      motivators: 1,
      hooks: 1,
      scripts: 1,
    });
  });
});
