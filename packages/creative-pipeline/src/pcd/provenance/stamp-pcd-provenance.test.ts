import { describe, expect, it, vi } from "vitest";
import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdPreproductionChainResult,
  PcdProductionFanoutDecision,
  TrendStageOutput,
} from "@creativeagent/schemas";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { stampPcdProvenance } from "./stamp-pcd-provenance.js";

const trendsOutput: TrendStageOutput = {
  signals: [
    { id: "trd_1", summary: "s1", audienceFit: "a1", evidenceRefs: [] },
    { id: "trd_2", summary: "s2", audienceFit: "a2", evidenceRefs: [] },
  ],
};

const motivatorsOutput: MotivatorsStageOutput = {
  motivators: [
    {
      id: "mot_1",
      frictionOrDesire: "f1",
      audienceSegment: "as1",
      evidenceRefs: [],
      parentTrendId: "trd_1",
    },
  ],
};

const hooksOutput: HooksStageOutput = {
  hooks: [
    {
      id: "hk_1",
      text: "h1",
      hookType: "direct_camera",
      parentMotivatorId: "mot_1",
      parentTrendId: "trd_1",
    },
  ],
};

const scriptsOutput: CreatorScriptsStageOutput = {
  scripts: [
    {
      id: "scr_1",
      hookText: "h1",
      creatorAngle: "ca",
      visualBeats: [],
      productMoment: "pm",
      cta: "cta",
      complianceNotes: [],
      identityConstraints: {
        creatorIdentityId: "cre_1",
        productIdentityId: "prd_1",
        voiceId: null,
      },
      parentHookId: "hk_1",
      scriptStyle: "spoken_lines",
      spokenLines: ["line1"],
    },
  ],
};

const decision: PcdProductionFanoutDecision = {
  briefId: "brf_1",
  creatorIdentityId: "cre_1",
  productIdentityId: "prd_1",
  consentRecordId: null,
  effectiveTier: 1,
  selectedScriptIds: ["scr_1"],
  availableScriptIds: ["scr_1"],
  preproductionChainVersion: "preproduction-chain@1.0.0",
  identityContextVersion: "identity-context@1.0.0",
  approvalLifecycleVersion: "approval-lifecycle@1.0.0",
  preproductionFanoutVersion: "preproduction-fanout@1.0.0",
  decidedAt: "2026-04-30T12:00:00.000Z",
  decidedBy: null,
  decisionNote: null,
  costForecast: null,
};

const chainResult: PcdPreproductionChainResult = {
  decision,
  stageOutputs: {
    trends: trendsOutput,
    motivators: motivatorsOutput,
    hooks: hooksOutput,
    scripts: scriptsOutput,
  },
};

const happyPathStores = {
  creatorIdentityReader: {
    findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
  },
  consentRecordReader: {
    findById: vi.fn().mockResolvedValue(null),
  },
  clock: () => new Date("2026-04-30T13:00:00.000Z"),
};

describe("stampPcdProvenance", () => {
  it("returns a fully populated payload for a valid lineage walk", async () => {
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      happyPathStores,
    );

    expect(out.briefId).toBe("brf_1");
    expect(out.trendId).toBe("trd_1");
    expect(out.motivatorId).toBe("mot_1");
    expect(out.hookId).toBe("hk_1");
    expect(out.scriptId).toBe("scr_1");
    expect(out.lineageDecisionReason.fanoutDecisionId).toBe("fdec_1");
    expect(out.lineageDecisionReason.chainVersion).toBe("preproduction-chain@1.0.0");
    expect(out.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
    expect(out.lineageDecisionReason.decidedAt).toBe("2026-04-30T13:00:00.000Z");
  });

  it("uses new Date() when no clock is injected", async () => {
    const before = Date.now();
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      {
        creatorIdentityReader: happyPathStores.creatorIdentityReader,
        consentRecordReader: happyPathStores.consentRecordReader,
      },
    );
    const after = Date.now();
    const stampedAt = Date.parse(out.lineageDecisionReason.decidedAt);
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);
  });

  it("throws InvariantViolationError when scriptId is not in chain output", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_missing",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when hook ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        scripts: {
          scripts: [
            {
              ...scriptsOutput.scripts[0]!,
              parentHookId: "hk_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when motivator ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        hooks: {
          hooks: [
            {
              ...hooksOutput.hooks[0]!,
              parentMotivatorId: "mot_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when trend ancestor is missing", async () => {
    const broken: PcdPreproductionChainResult = {
      ...chainResult,
      stageOutputs: {
        ...chainResult.stageOutputs,
        motivators: {
          motivators: [
            {
              ...motivatorsOutput.motivators[0]!,
              parentTrendId: "trd_missing",
            },
          ],
        },
      },
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult: broken,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws ConsentRevokedRefusalError when consent revoked between gate and stamp", async () => {
    const stores = {
      creatorIdentityReader: {
        findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: "cnt_1" }),
      },
      consentRecordReader: {
        findById: vi.fn().mockResolvedValue({ id: "cnt_1", revoked: true, revokedAt: new Date() }),
      },
      clock: happyPathStores.clock,
    };
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        stores,
      ),
    ).rejects.toBeInstanceOf(ConsentRevokedRefusalError);
  });

  it("returns silently for Tier 1 creators with no bound consent record", async () => {
    const stores = {
      creatorIdentityReader: {
        findById: vi.fn().mockResolvedValue({ id: "cre_1", consentRecordId: null }),
      },
      consentRecordReader: {
        findById: vi.fn().mockResolvedValue(null),
      },
      clock: happyPathStores.clock,
    };
    const out = await stampPcdProvenance(
      {
        briefId: "brf_1",
        creatorIdentityId: "cre_1",
        scriptId: "scr_1",
        chainResult,
        fanoutDecisionId: "fdec_1",
      },
      stores,
    );
    expect(out.scriptId).toBe("scr_1");
    expect(stores.consentRecordReader.findById).not.toHaveBeenCalled();
  });

  it("rejects an empty scriptId at zod-parse time (defense-in-depth)", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "",
          chainResult,
          fanoutDecisionId: "fdec_1",
        },
        happyPathStores,
      ),
    ).rejects.toThrow();
  });

  it("rejects an empty fanoutDecisionId at zod-parse time", async () => {
    await expect(
      stampPcdProvenance(
        {
          briefId: "brf_1",
          creatorIdentityId: "cre_1",
          scriptId: "scr_1",
          chainResult,
          fanoutDecisionId: "",
        },
        happyPathStores,
      ),
    ).rejects.toThrow();
  });
});
