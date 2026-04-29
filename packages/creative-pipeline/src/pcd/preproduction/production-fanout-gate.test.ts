import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "../approval-lifecycle-version.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PcdProductionFanoutDecisionSchema } from "@creativeagent/schemas";
import { AutoApproveOnlyScriptGate, type RequestSelectionInput } from "./production-fanout-gate.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");

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

const baseCtx = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  consentRecordId: null,
  effectiveTier: 2 as const,
  productTierAtResolution: 2 as const,
  creatorTierAtResolution: 2 as const,
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
  identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
} as const;

describe("AutoApproveOnlyScriptGate", () => {
  const gate = new AutoApproveOnlyScriptGate();

  it("selects the only script and returns a forensic decision struct", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const decision = await gate.requestSelection(input);

    expect(PcdProductionFanoutDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.briefId).toBe("brief-1");
    expect(decision.creatorIdentityId).toBe("creator-1");
    expect(decision.productIdentityId).toBe("product-1");
    expect(decision.consentRecordId).toBe(null);
    expect(decision.effectiveTier).toBe(2);
    expect(decision.selectedScriptIds).toEqual(["script-1"]);
    expect(decision.availableScriptIds).toEqual(["script-1"]);
    expect(decision.preproductionChainVersion).toBe(PCD_PREPRODUCTION_CHAIN_VERSION);
    expect(decision.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
    expect(decision.decidedAt).toBe("2026-04-29T12:00:00.000Z");
    expect(decision.decidedBy).toBe(null);
    expect(decision.costForecast).toBe(null);
  });

  it("throws InvariantViolationError on zero scripts", async () => {
    const input: RequestSelectionInput = {
      scripts: [],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    await expect(gate.requestSelection(input)).rejects.toThrow(InvariantViolationError);
  });

  it("throws InvariantViolationError on two scripts (SP7 invariant: single-script)", async () => {
    const input: RequestSelectionInput = {
      scripts: [baseScript, { ...baseScript, id: "script-2" }],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    await expect(gate.requestSelection(input)).rejects.toThrow(InvariantViolationError);
  });

  it("returned selectedScriptIds and availableScriptIds are sorted ascending", async () => {
    // With one script in SP7, sortedness is trivial; the assertion locks
    // the contract for SP8's N-script world.
    const input: RequestSelectionInput = {
      scripts: [baseScript],
      identityContext: baseCtx,
      briefId: "brief-1",
      clock: fixedClock,
    };
    const decision = await gate.requestSelection(input);
    expect(decision.selectedScriptIds).toEqual([...decision.selectedScriptIds].sort());
    expect(decision.availableScriptIds).toEqual([...decision.availableScriptIds].sort());
  });
});
