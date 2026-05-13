import { describe, expect, it } from "vitest";
import type { CoarseCostEstimatorOutput } from "./coarse-cost-estimator.js";
import { validateCostAgainstBudget } from "./cost-budget-validator.js";

function sampleEstimate(
  overrides: Partial<CoarseCostEstimatorOutput> = {},
): CoarseCostEstimatorOutput {
  return {
    estimatedUsd: 50,
    currency: "USD",
    lineItems: [{ label: "x", estimatedUsd: 50 }],
    estimatorVersion: "stub@1.0.0",
    ...overrides,
  };
}

const sampleAt = "2026-05-14T00:00:00.000Z";

describe("validateCostAgainstBudget", () => {
  it("ok when estimate < threshold", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 50 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
    expect(out.meta.estimatedUsd).toBe(50);
    expect(out.meta.threshold).toBe(100);
  });

  it("ok when estimate === threshold (strict > semantics — equality passes)", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 100 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
  });

  it("fail when estimate > threshold by one cent", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 100.01 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(false);
    expect(out.meta.estimatedUsd).toBe(100.01);
  });

  it("ok when estimate is zero", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 0 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.ok).toBe(true);
  });

  it("meta carries costBudgetVersion pinned from import", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.costBudgetVersion).toBe("pcd-cost-budget@1.0.0");
  });

  it("meta carries estimatorVersion from input estimate", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatorVersion: "real-estimator@2.5.0" }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.estimatorVersion).toBe("real-estimator@2.5.0");
  });

  it("meta carries lineItems from input estimate", () => {
    const lineItems = [
      { label: "a", estimatedUsd: 25 },
      { label: "b", estimatedUsd: 25 },
    ];
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate({ lineItems }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(out.meta.lineItems).toEqual(lineItems);
  });

  it("meta carries threshold from input", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 137.42,
      estimatedAt: sampleAt,
    });
    expect(out.meta.threshold).toBe(137.42);
  });

  it("meta carries estimatedAt from input", () => {
    const out = validateCostAgainstBudget({
      estimate: sampleEstimate(),
      threshold: 100,
      estimatedAt: "2026-12-25T12:34:56.789Z",
    });
    expect(out.meta.estimatedAt).toBe("2026-12-25T12:34:56.789Z");
  });

  it("meta is populated on both ok and fail paths (lossless symmetry)", () => {
    const ok = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 50 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    const fail = validateCostAgainstBudget({
      estimate: sampleEstimate({ estimatedUsd: 150 }),
      threshold: 100,
      estimatedAt: sampleAt,
    });
    expect(ok.meta.costBudgetVersion).toBe(fail.meta.costBudgetVersion);
    expect(ok.meta.currency).toBe(fail.meta.currency);
    expect(ok.meta.estimatedAt).toBe(fail.meta.estimatedAt);
  });
});
