import { describe, expect, it } from "vitest";
import type { CostBudgetMeta } from "@creativeagent/schemas";
import { CostBudgetMetaSchema } from "@creativeagent/schemas";
import { CostBudgetExceededError } from "./cost-budget-exceeded-error.js";

const sampleMeta: CostBudgetMeta = {
  costBudgetVersion: "pcd-cost-budget@1.0.0",
  estimatorVersion: "stub-coarse-cost-estimator@1.0.0",
  estimatedUsd: 250.0,
  currency: "USD",
  threshold: 100.0,
  lineItems: [{ label: "x", estimatedUsd: 250.0 }],
  estimatedAt: "2026-05-14T00:00:00.000Z",
};

describe("CostBudgetExceededError", () => {
  it("constructs with name and meta", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.name).toBe("CostBudgetExceededError");
    expect(err.meta).toEqual(sampleMeta);
  });

  it("is an Error instance", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err).toBeInstanceOf(Error);
  });

  it("message includes dollar-formatted estimate and threshold", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.message).toContain("$250.00");
    expect(err.message).toContain("$100.00");
  });

  it("meta is a valid CostBudgetMeta (defensive round-trip)", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(CostBudgetMetaSchema.safeParse(err.meta).success).toBe(true);
  });

  it("meta is carried by-reference (no deep clone — caller owns the object)", () => {
    const err = new CostBudgetExceededError({ meta: sampleMeta });
    expect(err.meta).toBe(sampleMeta);
  });
});
