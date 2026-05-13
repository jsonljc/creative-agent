import { describe, expect, it } from "vitest";
import type { PcdIdentityContext } from "@creativeagent/schemas";
import {
  StubCoarseCostEstimator,
  STUB_COARSE_COST_ESTIMATOR_VERSION,
} from "./stub-coarse-cost-estimator.js";

function sampleIdentityContext(): PcdIdentityContext {
  return {
    creatorIdentityId: "c1",
    productIdentityId: "p1",
    consentRecordId: null,
    effectiveTier: 1,
    productTierAtResolution: 1,
    creatorTierAtResolution: 1,
    allowedShotTypes: [],
    allowedOutputIntents: [],
    tier3Rules: {
      firstLastFrameRequired: false,
      performanceTransferRequired: false,
      editOverRegenerateRequired: false,
    },
    voiceId: null,
    productCanonicalText: "",
    productHeroPackshotAssetId: null,
    brandPositioningText: null,
    ugcStyleConstraints: [],
    consentRevoked: false,
    treeBudget: null,
    identityContextVersion: "identity-context@1.0.0",
  };
}

describe("StubCoarseCostEstimator", () => {
  it("STUB_COARSE_COST_ESTIMATOR_VERSION equals the exact literal", () => {
    expect(STUB_COARSE_COST_ESTIMATOR_VERSION).toBe("stub-coarse-cost-estimator@1.0.0");
  });

  it("is deterministic — same scriptCount produces same estimate", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const a = await stub.estimate({
      briefId: "b1",
      identityContext: ctx,
      scriptCount: 10,
    });
    const b = await stub.estimate({
      briefId: "b2",
      identityContext: ctx,
      scriptCount: 10,
    });
    expect(a.estimatedUsd).toBe(b.estimatedUsd);
    expect(a.currency).toBe(b.currency);
  });

  it("scales linearly with scriptCount", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const one = await stub.estimate({
      briefId: "b",
      identityContext: ctx,
      scriptCount: 1,
    });
    const ten = await stub.estimate({
      briefId: "b",
      identityContext: ctx,
      scriptCount: 10,
    });
    expect(ten.estimatedUsd).toBeCloseTo(one.estimatedUsd * 10, 5);
  });

  it("returns currency `USD`", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({
      briefId: "b",
      identityContext: ctx,
      scriptCount: 5,
    });
    expect(out.currency).toBe("USD");
  });

  it("carries the stub estimatorVersion", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({
      briefId: "b",
      identityContext: ctx,
      scriptCount: 5,
    });
    expect(out.estimatorVersion).toBe(STUB_COARSE_COST_ESTIMATOR_VERSION);
  });

  it("zero-script edge returns zero estimatedUsd", async () => {
    const stub = new StubCoarseCostEstimator();
    const ctx = sampleIdentityContext();
    const out = await stub.estimate({
      briefId: "b",
      identityContext: ctx,
      scriptCount: 0,
    });
    expect(out.estimatedUsd).toBe(0);
  });
});
