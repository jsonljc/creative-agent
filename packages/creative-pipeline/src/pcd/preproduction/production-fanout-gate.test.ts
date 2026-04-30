import { describe, expect, it } from "vitest";
import {
  ProductionFanoutGateOperatorDecisionSchema,
  type PcdIdentityContext,
} from "@creativeagent/schemas";
import { AutoApproveAllScriptsGate, type RequestSelectionInput } from "./production-fanout-gate.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const fixedClock = () => new Date("2026-04-30T12:00:00.000Z");

const baseScript = {
  id: "script-1",
  hookText: "h",
  creatorAngle: "a",
  visualBeats: [],
  productMoment: "p",
  cta: "c",
  complianceNotes: [],
  identityConstraints: { creatorIdentityId: "c1", productIdentityId: "p1", voiceId: null },
  parentHookId: "hook-1",
  scriptStyle: "talking_points" as const,
  talkingPoints: ["x"],
};

const baseCtx: PcdIdentityContext = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  consentRecordId: null,
  effectiveTier: 2,
  productTierAtResolution: 2,
  creatorTierAtResolution: 2,
  allowedShotTypes: ["simple_ugc"],
  allowedOutputIntents: ["draft", "preview", "final_export"],
  tier3Rules: {
    firstLastFrameRequired: false,
    performanceTransferRequired: false,
    editOverRegenerateRequired: false,
  },
  voiceId: null,
  productCanonicalText: "ACME",
  productHeroPackshotAssetId: null,
  brandPositioningText: null,
  ugcStyleConstraints: [
    "native_vertical",
    "creator_led",
    "no_overproduced_storyboard",
    "product_fidelity_required",
    "no_invented_product_claims",
  ],
  consentRevoked: false,
  treeBudget: null,
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
};

describe("AutoApproveAllScriptsGate", () => {
  const gate = new AutoApproveAllScriptsGate();

  it("with one script, selects it and returns operator-decision tuple", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual(["script-1"]);
    expect(out.decidedBy).toBe(null);
    expect(out.decidedAt).toBe("2026-04-30T12:00:00.000Z");
  });

  it("with three scripts, selects all three sorted ascending", async () => {
    const input: RequestSelectionInput = {
      scripts: [
        { ...baseScript, id: "script-c" },
        { ...baseScript, id: "script-a" },
        { ...baseScript, id: "script-b" },
      ],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual(["script-a", "script-b", "script-c"]);
  });

  it("returned shape parses cleanly via the operator-decision schema", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(ProductionFanoutGateOperatorDecisionSchema.safeParse(out).success).toBe(true);
  });

  it("returned object contains exactly the three operator-decision keys", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(Object.keys(out).sort()).toEqual(["decidedAt", "decidedBy", "selectedScriptIds"]);
  });

  it("does NOT include any pinned-version field on the return shape", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out).not.toHaveProperty("preproductionChainVersion");
    expect(out).not.toHaveProperty("identityContextVersion");
    expect(out).not.toHaveProperty("approvalLifecycleVersion");
    expect(out).not.toHaveProperty("preproductionFanoutVersion");
  });

  it("does NOT echo identity carry-through fields on the return shape", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out).not.toHaveProperty("briefId");
    expect(out).not.toHaveProperty("creatorIdentityId");
    expect(out).not.toHaveProperty("productIdentityId");
    expect(out).not.toHaveProperty("consentRecordId");
    expect(out).not.toHaveProperty("effectiveTier");
  });

  it("with empty scripts, returns an empty selectedScriptIds (parse-fails upstream)", async () => {
    const input: RequestSelectionInput = {
      scripts: [],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const out = await gate.requestSelection(input);
    expect(out.selectedScriptIds).toEqual([]);
    // Schema rejects empty selectedScriptIds — composer's runStageWrapped catches.
    expect(ProductionFanoutGateOperatorDecisionSchema.safeParse(out).success).toBe(false);
  });
});
