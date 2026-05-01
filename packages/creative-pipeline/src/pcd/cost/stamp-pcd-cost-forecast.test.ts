import { describe, expect, it, vi } from "vitest";
import { StubCostEstimator, STUB_COST_ESTIMATOR_VERSION } from "./stub-cost-estimator.js";
import { stampPcdCostForecast } from "./stamp-pcd-cost-forecast.js";
import type { CostEstimator } from "./cost-estimator.js";

const validInput = {
  provider: "sora",
  model: "sora-1.0",
  shotType: "live_action_video",
  outputIntent: "meta_creative",
  durationSec: 15,
};

describe("stampPcdCostForecast", () => {
  it("calls the injected estimator with the provided input", async () => {
    const estimator: CostEstimator = {
      estimate: vi.fn(async () => ({
        estimatedUsd: 1.0,
        currency: "USD" as const,
        lineItems: [{ label: "x", estimatedUsd: 1.0 }],
        estimatorVersion: "test@1.0.0",
      })),
    };
    await stampPcdCostForecast(validInput, { costEstimator: estimator });
    expect(estimator.estimate).toHaveBeenCalledWith(validInput);
  });

  it("pins PCD_COST_FORECAST_VERSION from import (not from estimator)", async () => {
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(result.costForecastVersion).toBe("pcd-cost-forecast@1.0.0");
  });

  it("carries the estimator's runtime estimatorVersion verbatim", async () => {
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(result.estimatorVersion).toBe(STUB_COST_ESTIMATOR_VERSION);
  });

  it("stamps estimatedAt from injected clock", async () => {
    const fixedDate = new Date("2026-04-30T12:00:00.000Z");
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
      clock: () => fixedDate,
    });
    expect(result.estimatedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("falls back to current Date when no clock provided", async () => {
    const before = Date.now();
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    const stampedAt = new Date(result.estimatedAt).getTime();
    const after = Date.now();
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);
  });

  it("returns a payload that round-trips through PcdSp10CostForecastReasonSchema", async () => {
    const { PcdSp10CostForecastReasonSchema } = await import("@creativeagent/schemas");
    const result = await stampPcdCostForecast(validInput, {
      costEstimator: new StubCostEstimator(),
    });
    expect(() => PcdSp10CostForecastReasonSchema.parse(result)).not.toThrow();
  });

  it("rejects empty provider via input zod parse", async () => {
    await expect(
      stampPcdCostForecast(
        { ...validInput, provider: "" },
        { costEstimator: new StubCostEstimator() },
      ),
    ).rejects.toThrow();
  });

  it("rejects empty model via input zod parse", async () => {
    await expect(
      stampPcdCostForecast(
        { ...validInput, model: "" },
        { costEstimator: new StubCostEstimator() },
      ),
    ).rejects.toThrow();
  });

  it("propagates estimator errors raw", async () => {
    const estimator: CostEstimator = {
      estimate: vi.fn(async () => {
        throw new Error("estimator crashed");
      }),
    };
    await expect(stampPcdCostForecast(validInput, { costEstimator: estimator })).rejects.toThrow(
      "estimator crashed",
    );
  });
});
