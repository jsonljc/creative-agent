import { describe, expect, it } from "vitest";
import type { PcdPreproductionChainResult, PreproductionTreeBudget } from "@creativeagent/schemas";
import { validateTreeShapeAgainstBudget } from "./tree-shape-validator.js";
import { PCD_TREE_BUDGET_VERSION } from "./tree-budget-version.js";

// Helper: build a minimal valid PcdPreproductionChainResult with explicit shape.
// trends → motivators → hooks → scripts with parent-id propagation.
function buildResult(opts: {
  trends: number;
  motivatorsPerTrend: number[]; // length === trends
  hooksPerMotivator: number[][]; // length === trends, each inner length === motivatorsPerTrend[i]
  scriptsPerHook: number[][][]; // shape mirrors hooksPerMotivator
}): PcdPreproductionChainResult {
  const trends = Array.from({ length: opts.trends }, (_, t) => ({
    id: `trend-${t}`,
    summary: `s${t}`,
    audienceFit: "x",
    evidenceRefs: [],
  }));

  const motivators = trends.flatMap((trend, t) =>
    Array.from({ length: opts.motivatorsPerTrend[t] }, (_, m) => ({
      id: `mot-${t}-${m}`,
      frictionOrDesire: "f",
      audienceSegment: "a",
      evidenceRefs: [],
      parentTrendId: trend.id,
    })),
  );

  const hooks = motivators.flatMap((mot) => {
    const t = Number(mot.id.split("-")[1]);
    const m = Number(mot.id.split("-")[2]);
    const count = opts.hooksPerMotivator[t][m];
    return Array.from({ length: count }, (_, h) => ({
      id: `hook-${t}-${m}-${h}`,
      text: "h",
      hookType: "direct_camera" as const,
      parentMotivatorId: mot.id,
      parentTrendId: mot.parentTrendId,
    }));
  });

  const scripts = hooks.flatMap((hook) => {
    const [_label, t, m, h] = hook.id.split("-");
    const count = opts.scriptsPerHook[Number(t)][Number(m)][Number(h)];
    return Array.from({ length: count }, (_, s) => ({
      id: `script-${t}-${m}-${h}-${s}`,
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
      parentHookId: hook.id,
      scriptStyle: "spoken_lines" as const,
      spokenLines: ["line"],
    }));
  });

  return {
    decision: {
      briefId: "b1",
      creatorIdentityId: "c1",
      productIdentityId: "p1",
      consentRecordId: null,
      effectiveTier: 1,
      selectedScriptIds: [scripts[0].id],
      availableScriptIds: scripts.map((s) => s.id),
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
      trends: { signals: trends },
      motivators: { motivators },
      hooks: { hooks },
      scripts: { scripts },
    },
  };
}

const within: PreproductionTreeBudget = {
  maxBranchFanout: 5,
  maxTreeSize: 50,
  maxEstimatedUsd: null,
};
const tight: PreproductionTreeBudget = {
  maxBranchFanout: 2,
  maxTreeSize: 10,
  maxEstimatedUsd: null,
};
const tinySize: PreproductionTreeBudget = {
  maxBranchFanout: 100,
  maxTreeSize: 5,
  maxEstimatedUsd: null,
};
const tinyFanout: PreproductionTreeBudget = {
  maxBranchFanout: 1,
  maxTreeSize: 1000,
  maxEstimatedUsd: null,
};

describe("validateTreeShapeAgainstBudget", () => {
  it("happy path — within budget returns ok with populated meta", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.meta.treeBudgetVersion).toBe(PCD_TREE_BUDGET_VERSION);
      expect(out.meta.observedTreeSize).toBe(4); // 1+1+1+1
      expect(out.meta.observedMaxBranchFanout).toBe(1);
      expect(out.meta.perStageCounts).toEqual({
        trends: 1,
        motivators: 1,
        hooks: 1,
        scripts: 1,
      });
      expect(out.meta.fanoutLevels).toHaveLength(3);
    }
  });

  it("max_tree_size_exceeded — violations is empty", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[3]]], // total 1+1+1+3 = 6 > tinySize.maxTreeSize=5
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinySize });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_tree_size_exceeded");
      expect(out.violations).toHaveLength(0);
      expect(out.meta.observedTreeSize).toBe(6);
    }
  });

  it("max_branch_fanout_exceeded at motivators_per_trend level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [2], // > tinyFanout.maxBranchFanout=1
      hooksPerMotivator: [[1, 1]],
      scriptsPerHook: [[[1], [1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "motivators_per_trend")).toBe(true);
    }
  });

  it("max_branch_fanout_exceeded at hooks_per_motivator level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[3]], // > tinyFanout.maxBranchFanout=1
      scriptsPerHook: [[[1, 1, 1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "hooks_per_motivator")).toBe(true);
    }
  });

  it("max_branch_fanout_exceeded at scripts_per_hook level", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[3]]], // > tinyFanout.maxBranchFanout=1
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tinyFanout });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.some((v) => v.level === "scripts_per_hook")).toBe(true);
    }
  });

  it("multi-level fanout violation — violations sorted desc by fanout", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[5]], // 5 > 2
      scriptsPerHook: [[[3, 3, 3, 3, 3]]], // each hook has 3 scripts > 2
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 2, maxTreeSize: 1000, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_branch_fanout_exceeded");
      expect(out.violations.length).toBeGreaterThanOrEqual(2);
      // Sort: desc by fanout
      for (let i = 1; i < out.violations.length; i++) {
        expect(out.violations[i - 1].fanout).toBeGreaterThanOrEqual(out.violations[i].fanout);
      }
    }
  });

  it("PRIORITY LOCK — if both dimensions exceeded, reason is always max_tree_size_exceeded", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [3], // fanout 3 > tight.maxBranchFanout=2
      hooksPerMotivator: [[3, 3, 3]],
      scriptsPerHook: [
        [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
      ],
      // total = 1+3+9+9 = 22 > tight.maxTreeSize=10
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: tight });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("max_tree_size_exceeded");
      expect(out.violations).toHaveLength(0); // size-reason has empty violations
    }
  });

  it("tied-fanout stable sort — equal fanouts preserve insertion order", () => {
    // All three levels have fanout = 1, no violation. Assert sort stability.
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      // All three fanouts are 1, so sort is stable → insertion order:
      // motivators_per_trend → hooks_per_motivator → scripts_per_hook
      expect(out.meta.fanoutLevels[0].level).toBe("motivators_per_trend");
      expect(out.meta.fanoutLevels[1].level).toBe("hooks_per_motivator");
      expect(out.meta.fanoutLevels[2].level).toBe("scripts_per_hook");
    }
  });

  it("SP8-stub shape (2→4→12→24) passes STATIC_DEFAULT_BUDGET (5,50,null)", () => {
    // Hand-build a tree mirroring the SP8 stub: 2 trends, each → 2 motivators (4 total),
    // each motivator → 3 hooks (12 total), each hook → 2 scripts (24 total).
    const result = buildResult({
      trends: 2,
      motivatorsPerTrend: [2, 2],
      hooksPerMotivator: [
        [3, 3],
        [3, 3],
      ],
      scriptsPerHook: [
        [
          [2, 2, 2],
          [2, 2, 2],
        ],
        [
          [2, 2, 2],
          [2, 2, 2],
        ],
      ],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.meta.observedTreeSize).toBe(2 + 4 + 12 + 24); // 42
      expect(out.meta.observedMaxBranchFanout).toBe(3); // hooks-per-motivator
    }
  });

  it("exact-limit edge — observedTreeSize === maxTreeSize is OK (strict >)", () => {
    // total = 1+1+1+2 = 5
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[2]]],
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 5, maxTreeSize: 5, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(true);
  });

  it("exactly-1-over edge — observedTreeSize === maxTreeSize + 1 fails", () => {
    // total = 1+1+1+2 = 5
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[2]]],
    });
    const out = validateTreeShapeAgainstBudget({
      result,
      budget: { maxBranchFanout: 5, maxTreeSize: 4, maxEstimatedUsd: null },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("max_tree_size_exceeded");
  });

  it("meta.fanoutLevels always has length 3 (one per level), even when no violation", () => {
    const result = buildResult({
      trends: 1,
      motivatorsPerTrend: [1],
      hooksPerMotivator: [[1]],
      scriptsPerHook: [[[1]]],
    });
    const out = validateTreeShapeAgainstBudget({ result, budget: within });
    expect(out.meta.fanoutLevels).toHaveLength(3);
    const levels = out.meta.fanoutLevels.map((f) => f.level).sort();
    expect(levels).toEqual(["hooks_per_motivator", "motivators_per_trend", "scripts_per_hook"]);
  });
});
