import { describe, expect, it } from "vitest";
import { StubCostEstimator, STUB_COST_ESTIMATOR_VERSION } from "./stub-cost-estimator.js";

describe("StubCostEstimator", () => {
  const estimator = new StubCostEstimator();

  it("returns the literal STUB_COST_ESTIMATOR_VERSION as estimatorVersion", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.estimatorVersion).toBe(STUB_COST_ESTIMATOR_VERSION);
  });

  it("returns currency 'USD'", async () => {
    const result = await estimator.estimate({
      provider: "veo",
      model: "veo-2.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.currency).toBe("USD");
  });

  it("is deterministic — same input returns same output", async () => {
    const input = {
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 15,
    };
    const a = await estimator.estimate(input);
    const b = await estimator.estimate(input);
    expect(a).toEqual(b);
  });

  it("returns nonnegative estimatedUsd", async () => {
    const result = await estimator.estimate({
      provider: "x",
      model: "y",
      shotType: "z",
      outputIntent: "w",
    });
    expect(result.estimatedUsd).toBeGreaterThanOrEqual(0);
  });

  it("returns nonempty lineItems with label + estimatedUsd shape", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
    for (const item of result.lineItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.estimatedUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("estimatedUsd is the sum of lineItems.estimatedUsd (within float tolerance)", async () => {
    const result = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 30,
      tokenCount: 1000,
    });
    const sum = result.lineItems.reduce((acc, it) => acc + it.estimatedUsd, 0);
    expect(Math.abs(result.estimatedUsd - sum)).toBeLessThan(0.0001);
  });

  it("durationSec scales the estimate linearly above the base", async () => {
    const base = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 1,
    });
    const longer = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      durationSec: 10,
    });
    expect(longer.estimatedUsd).toBeGreaterThan(base.estimatedUsd);
  });

  it("tokenCount scales the estimate above the base", async () => {
    const base = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
    });
    const withTokens = await estimator.estimate({
      provider: "sora",
      model: "sora-1.0",
      shotType: "live_action_video",
      outputIntent: "meta_creative",
      tokenCount: 5000,
    });
    expect(withTokens.estimatedUsd).toBeGreaterThan(base.estimatedUsd);
  });

  it("falls back to a default for unknown provider×model combinations", async () => {
    const result = await estimator.estimate({
      provider: "unknown-vendor",
      model: "unknown-model",
      shotType: "x",
      outputIntent: "y",
    });
    expect(result.estimatedUsd).toBeGreaterThan(0);
    expect(result.lineItems.length).toBeGreaterThanOrEqual(1);
  });
});
