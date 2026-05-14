import { describe, expect, it } from "vitest";
import { CoarseCostEstimatorOutputSchema, CostBudgetMetaSchema } from "../pcd-cost-budget.js";

describe("CoarseCostEstimatorOutputSchema", () => {
  const valid = {
    estimatedUsd: 12.5,
    currency: "USD" as const,
    lineItems: [{ label: "stub", estimatedUsd: 12.5 }],
    estimatorVersion: "stub@1.0.0",
  };

  it("accepts a valid output", () => {
    expect(CoarseCostEstimatorOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts estimatedUsd === 0 (nonnegative)", () => {
    expect(CoarseCostEstimatorOutputSchema.safeParse({ ...valid, estimatedUsd: 0 }).success).toBe(
      true,
    );
  });

  it("rejects negative estimatedUsd", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({
        ...valid,
        estimatedUsd: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects non-USD currency", () => {
    expect(CoarseCostEstimatorOutputSchema.safeParse({ ...valid, currency: "EUR" }).success).toBe(
      false,
    );
  });

  it("rejects empty estimatorVersion", () => {
    expect(
      CoarseCostEstimatorOutputSchema.safeParse({
        ...valid,
        estimatorVersion: "",
      }).success,
    ).toBe(false);
  });
});

describe("CostBudgetMetaSchema", () => {
  const valid = {
    costBudgetVersion: "pcd-cost-budget@1.0.0",
    estimatorVersion: "stub@1.0.0",
    estimatedUsd: 12.5,
    currency: "USD" as const,
    threshold: 100,
    lineItems: [{ label: "stub", estimatedUsd: 12.5 }],
    estimatedAt: "2026-05-14T00:00:00.000Z",
  };

  it("accepts a valid meta", () => {
    expect(CostBudgetMetaSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative estimatedUsd", () => {
    expect(CostBudgetMetaSchema.safeParse({ ...valid, estimatedUsd: -1 }).success).toBe(false);
  });

  it("rejects non-positive threshold (zero excluded)", () => {
    expect(CostBudgetMetaSchema.safeParse({ ...valid, threshold: 0 }).success).toBe(false);
    expect(CostBudgetMetaSchema.safeParse({ ...valid, threshold: -1 }).success).toBe(false);
  });

  it("rejects bad ISO timestamp", () => {
    expect(CostBudgetMetaSchema.safeParse({ ...valid, estimatedAt: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("rejects missing field", () => {
    const { estimatorVersion: _ev, ...incomplete } = valid;
    expect(CostBudgetMetaSchema.safeParse(incomplete).success).toBe(false);
  });
});
