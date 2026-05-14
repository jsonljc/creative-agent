import { describe, expect, it } from "vitest";
import {
  type ScriptSelectionDecision,
  ScriptSelectionDecisionSchema,
  ScriptSelectionRejectionReasonSchema,
  type ScriptTemplatePayload,
  ScriptTemplatePayloadSchema,
  ScriptTemplateStatusSchema,
} from "../pcd-script-template.js";

const goodRow: ScriptTemplatePayload = {
  id: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  text: "Hook + body + CTA.",
  compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
  version: 1,
  status: "active",
};

describe("ScriptTemplatePayloadSchema", () => {
  it("round-trips a well-formed row", () => {
    expect(() => ScriptTemplatePayloadSchema.parse(goodRow)).not.toThrow();
  });

  it("rejects empty compatibleCreatorIdentityIds (min 1)", () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, compatibleCreatorIdentityIds: [] }),
    ).toThrow();
  });

  it('rejects wildcard "*" inside compatibleCreatorIdentityIds', () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({
        ...goodRow,
        compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01", "*"],
      }),
    ).toThrow();
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, compatibleCreatorIdentityIds: ["*"] }),
    ).toThrow();
  });

  it("rejects version < 1", () => {
    expect(() => ScriptTemplatePayloadSchema.parse({ ...goodRow, version: 0 })).toThrow();
  });

  it("rejects empty text", () => {
    expect(() => ScriptTemplatePayloadSchema.parse({ ...goodRow, text: "" })).toThrow();
  });

  it("rejects text > 8000 chars", () => {
    expect(() =>
      ScriptTemplatePayloadSchema.parse({ ...goodRow, text: "x".repeat(8001) }),
    ).toThrow();
  });
});

describe("ScriptTemplateStatusSchema", () => {
  it("accepts active / retired and rejects other values", () => {
    expect(() => ScriptTemplateStatusSchema.parse("active")).not.toThrow();
    expect(() => ScriptTemplateStatusSchema.parse("retired")).not.toThrow();
    expect(() => ScriptTemplateStatusSchema.parse("draft")).toThrow();
  });
});

describe("ScriptSelectionRejectionReasonSchema", () => {
  it('accepts both reasons; rejects "other"', () => {
    expect(() => ScriptSelectionRejectionReasonSchema.parse("no_compatible_script")).not.toThrow();
    expect(() =>
      ScriptSelectionRejectionReasonSchema.parse("all_filtered_by_creator"),
    ).not.toThrow();
    expect(() => ScriptSelectionRejectionReasonSchema.parse("other")).toThrow();
  });
});

const goodSuccess: ScriptSelectionDecision = {
  allowed: true,
  briefId: "brief_01",
  scriptTemplateId: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  scriptTemplateVersion: 1,
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  scriptText: "Hook + body + CTA.",
  selectorVersion: "pcd-script-selector@1.0.0",
  decisionReason: "script_selected (creator_matched=1, three_way=1, picked_version=1)",
};

const goodFailure: ScriptSelectionDecision = {
  allowed: false,
  briefId: "brief_01",
  reason: "no_compatible_script",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  inspectedTemplateIds: [],
  selectorVersion: "pcd-script-selector@1.0.0",
};

describe("ScriptSelectionDecisionSchema", () => {
  it("round-trips the success branch", () => {
    expect(() => ScriptSelectionDecisionSchema.parse(goodSuccess)).not.toThrow();
  });

  it("round-trips the failure branch", () => {
    expect(() => ScriptSelectionDecisionSchema.parse(goodFailure)).not.toThrow();
  });

  it("rejects a success-shape missing scriptTemplateId", () => {
    const { scriptTemplateId: _drop, ...partial } = goodSuccess;
    expect(() => ScriptSelectionDecisionSchema.parse(partial)).toThrow();
  });

  it("rejects a failure-shape missing reason", () => {
    const { reason: _drop, ...partial } = goodFailure;
    expect(() => ScriptSelectionDecisionSchema.parse(partial)).toThrow();
  });

  it("rejects success-branch decisionReason > 2000 chars", () => {
    const bigReason = "x".repeat(2001);
    expect(() =>
      ScriptSelectionDecisionSchema.parse({ ...goodSuccess, decisionReason: bigReason }),
    ).toThrow();
  });
});
