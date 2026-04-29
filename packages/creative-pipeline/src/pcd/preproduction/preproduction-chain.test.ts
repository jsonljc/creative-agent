import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import { PcdPreproductionChainResultSchema, type PcdBriefInput } from "@creativeagent/schemas";
import {
  runIdentityAwarePreproductionChain,
  type PreproductionChainStores,
} from "./preproduction-chain.js";
import { PreproductionChainError } from "./preproduction-chain-error.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { StubTrendsStageRunner } from "./stages/stub-trends-stage-runner.js";
import { StubMotivatorsStageRunner } from "./stages/stub-motivators-stage-runner.js";
import { StubHooksStageRunner } from "./stages/stub-hooks-stage-runner.js";
import { StubCreatorScriptsStageRunner } from "./stages/stub-creator-scripts-stage-runner.js";
import { AutoApproveOnlyScriptGate } from "./production-fanout-gate.js";

const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");

const validBrief: PcdBriefInput = {
  briefId: "brief-1",
  productDescription: "AI lead reply",
  targetAudience: "founders",
  platforms: ["instagram_reels"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

function happyStores(): PreproductionChainStores {
  return {
    sp7ProductRegistryReader: {
      async findById() {
        return {
          id: "product-1",
          qualityTier: "verified" as const,
          canonicalPackageText: "ACME",
          heroPackshotAssetId: null,
          brandPositioningText: null,
        };
      },
    },
    sp7CreatorRegistryReader: {
      async findById() {
        return {
          id: "creator-1",
          qualityTier: "anchored" as const,
          voiceId: null,
          consentRecordId: null,
        };
      },
    },
    creatorIdentityReader: {
      async findById() {
        return { id: "creator-1", consentRecordId: null };
      },
    },
    consentRecordReader: {
      async findById() {
        return null;
      },
    },
    trendsRunner: new StubTrendsStageRunner(),
    motivatorsRunner: new StubMotivatorsStageRunner(),
    hooksRunner: new StubHooksStageRunner(),
    creatorScriptsRunner: new StubCreatorScriptsStageRunner(),
    productionFanoutGate: new AutoApproveOnlyScriptGate(),
    clock: fixedClock,
  };
}

describe("runIdentityAwarePreproductionChain — happy path", () => {
  it("returns a schema-valid PcdPreproductionChainResult", async () => {
    const result = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(PcdPreproductionChainResultSchema.safeParse(result).success).toBe(true);
  });

  it("decision pins all three versions from imports", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("decidedAt matches injected clock output exactly", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedAt).toBe("2026-04-29T12:00:00.000Z");
  });

  it("decidedBy is null with the default AutoApproveOnlyScriptGate", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.decidedBy).toBe(null);
  });

  it("costForecast is null in SP7", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.costForecast).toBe(null);
  });

  it("selectedScriptIds and availableScriptIds are sorted", async () => {
    const { decision } = await runIdentityAwarePreproductionChain(validBrief, happyStores());
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    expect(decision.availableScriptIds).toEqual([...decision.availableScriptIds].sort());
  });

  it("calls stages in fixed order: trends, motivators, hooks, creator_scripts", async () => {
    const order: string[] = [];
    const stores = happyStores();
    // Wrap each runner to record call order
    const origTrends = stores.trendsRunner;
    stores.trendsRunner = {
      async run(...args: Parameters<typeof origTrends.run>) {
        order.push("trends");
        return origTrends.run(...args);
      },
    };
    const origMotivators = stores.motivatorsRunner;
    stores.motivatorsRunner = {
      async run(...args: Parameters<typeof origMotivators.run>) {
        order.push("motivators");
        return origMotivators.run(...args);
      },
    };
    const origHooks = stores.hooksRunner;
    stores.hooksRunner = {
      async run(...args: Parameters<typeof origHooks.run>) {
        order.push("hooks");
        return origHooks.run(...args);
      },
    };
    const origScripts = stores.creatorScriptsRunner;
    stores.creatorScriptsRunner = {
      async run(...args: Parameters<typeof origScripts.run>) {
        order.push("creator_scripts");
        return origScripts.run(...args);
      },
    };

    await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(order).toEqual(["trends", "motivators", "hooks", "creator_scripts"]);
  });

  it("identityContext flows by reference equality into each stage runner", async () => {
    const seenContexts: unknown[] = [];
    const stores = happyStores();
    stores.trendsRunner = {
      async run(_b, ctx) {
        seenContexts.push(ctx);
        return new StubTrendsStageRunner().run(_b, ctx);
      },
    };
    stores.motivatorsRunner = {
      async run(_b, ctx, t) {
        seenContexts.push(ctx);
        return new StubMotivatorsStageRunner().run(_b, ctx, t);
      },
    };
    stores.hooksRunner = {
      async run(_b, ctx, t, m) {
        seenContexts.push(ctx);
        return new StubHooksStageRunner().run(_b, ctx, t, m);
      },
    };
    stores.creatorScriptsRunner = {
      async run(_b, ctx, t, m, h) {
        seenContexts.push(ctx);
        return new StubCreatorScriptsStageRunner().run(_b, ctx, t, m, h);
      },
    };
    await runIdentityAwarePreproductionChain(validBrief, stores);
    expect(seenContexts.length).toBe(4);
    expect(seenContexts[0]).toBe(seenContexts[1]);
    expect(seenContexts[1]).toBe(seenContexts[2]);
    expect(seenContexts[2]).toBe(seenContexts[3]);
  });
});

describe("runIdentityAwarePreproductionChain — pre-stage errors propagate raw", () => {
  it("ZodError from invalid brief propagates raw (not wrapped)", async () => {
    await expect(
      runIdentityAwarePreproductionChain(
        { ...validBrief, briefId: "" } as PcdBriefInput,
        happyStores(),
      ),
    ).rejects.not.toBeInstanceOf(PreproductionChainError);
  });

  it("InvariantViolationError from missing product propagates raw", async () => {
    const stores = happyStores();
    stores.sp7ProductRegistryReader = {
      async findById() {
        return null;
      },
    };
    await expect(runIdentityAwarePreproductionChain(validBrief, stores)).rejects.toThrow(
      InvariantViolationError,
    );
  });

  it("ConsentRevokedRefusalError from SP6 pre-check propagates raw", async () => {
    const stores = happyStores();
    stores.sp7CreatorRegistryReader = {
      async findById() {
        return {
          id: "creator-1",
          qualityTier: "anchored" as const,
          voiceId: null,
          consentRecordId: "consent-1",
        };
      },
    };
    stores.creatorIdentityReader = {
      async findById() {
        return { id: "creator-1", consentRecordId: "consent-1" };
      },
    };
    stores.consentRecordReader = {
      async findById() {
        return { id: "consent-1", revoked: true, revokedAt: new Date() };
      },
    };
    await expect(runIdentityAwarePreproductionChain(validBrief, stores)).rejects.toThrow(
      ConsentRevokedRefusalError,
    );
  });
});

describe("runIdentityAwarePreproductionChain — stage-runner errors wrap", () => {
  it("trends runner throw wraps as PreproductionChainError(stage='trends')", async () => {
    const stores = happyStores();
    stores.trendsRunner = {
      async run() {
        throw new Error("trends boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("trends");
      expect((err as PreproductionChainError).cause).toBeInstanceOf(Error);
      expect(((err as PreproductionChainError).cause as Error).message).toBe("trends boom");
    }
  });

  it("motivators runner throw wraps with stage='motivators'", async () => {
    const stores = happyStores();
    stores.motivatorsRunner = {
      async run() {
        throw new Error("motivators boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("motivators");
    }
  });

  it("hooks runner throw wraps with stage='hooks'", async () => {
    const stores = happyStores();
    stores.hooksRunner = {
      async run() {
        throw new Error("hooks boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("hooks");
    }
  });

  it("creator scripts runner throw wraps with stage='creator_scripts'", async () => {
    const stores = happyStores();
    stores.creatorScriptsRunner = {
      async run() {
        throw new Error("scripts boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("creator_scripts");
    }
  });

  it("production fanout gate throw wraps with stage='production_fanout_gate'", async () => {
    const stores = happyStores();
    stores.productionFanoutGate = {
      async requestSelection() {
        throw new Error("gate boom");
      },
    };
    try {
      await runIdentityAwarePreproductionChain(validBrief, stores);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PreproductionChainError);
      expect((err as PreproductionChainError).stage).toBe("production_fanout_gate");
    }
  });
});
