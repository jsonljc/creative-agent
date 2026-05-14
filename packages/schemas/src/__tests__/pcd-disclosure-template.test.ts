import { describe, expect, it } from "vitest";
import {
  DisclosureResolutionDecisionSchema,
  DisclosureResolutionRejectionReasonSchema,
  DisclosureTemplatePayloadSchema,
  type DisclosureResolutionDecision,
  type DisclosureTemplatePayload,
} from "../pcd-disclosure-template.js";

const validPayload: DisclosureTemplatePayload = {
  id: "disclosure-template-SG-meta-med_spa-v1",
  jurisdictionCode: "SG",
  platform: "meta",
  treatmentClass: "med_spa",
  version: 1,
  text: "[DISCLOSURE_PENDING_LEGAL_REVIEW: SG/meta/med_spa]",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
};

const validSuccess: DisclosureResolutionDecision = {
  allowed: true,
  briefId: "brief_test_01",
  disclosureTemplateId: validPayload.id,
  jurisdictionCode: "SG",
  platform: "meta",
  treatmentClass: "med_spa",
  templateVersion: 1,
  disclosureText: validPayload.text,
  resolverVersion: "pcd-disclosure-resolver@1.0.0",
  decisionReason: "tuple_resolved (active=1, total_for_tuple=1, picked_version=1)",
};

const validRejection: DisclosureResolutionDecision = {
  allowed: false,
  briefId: "brief_test_02",
  reason: "no_template_for_tuple",
  jurisdictionCode: "SG",
  platform: "meta",
  treatmentClass: "med_spa",
  inspectedTemplateIds: [],
  resolverVersion: "pcd-disclosure-resolver@1.0.0",
};

describe("DisclosureTemplatePayloadSchema", () => {
  it("round-trips a valid payload", () => {
    const parsed = DisclosureTemplatePayloadSchema.parse(validPayload);
    expect(parsed).toEqual(validPayload);
  });

  it("accepts effectiveTo: null (indefinite)", () => {
    expect(DisclosureTemplatePayloadSchema.parse({ ...validPayload, effectiveTo: null })).toEqual(
      validPayload,
    );
  });

  it("rejects effectiveTo === effectiveFrom (zero-length window)", () => {
    expect(() =>
      DisclosureTemplatePayloadSchema.parse({
        ...validPayload,
        effectiveTo: validPayload.effectiveFrom,
      }),
    ).toThrow(/effectiveTo must be strictly after effectiveFrom/);
  });

  it("rejects effectiveTo < effectiveFrom (inverted window)", () => {
    expect(() =>
      DisclosureTemplatePayloadSchema.parse({
        ...validPayload,
        effectiveTo: new Date("2025-12-31T00:00:00Z"),
      }),
    ).toThrow(/effectiveTo must be strictly after effectiveFrom/);
  });

  it("rejects version: 0", () => {
    expect(() => DisclosureTemplatePayloadSchema.parse({ ...validPayload, version: 0 })).toThrow();
  });

  it("rejects empty text", () => {
    expect(() => DisclosureTemplatePayloadSchema.parse({ ...validPayload, text: "" })).toThrow();
  });

  it("rejects text > 2000 chars", () => {
    expect(() =>
      DisclosureTemplatePayloadSchema.parse({ ...validPayload, text: "x".repeat(2001) }),
    ).toThrow();
  });
});

describe("DisclosureResolutionRejectionReasonSchema", () => {
  it("accepts the two SP14 reasons", () => {
    expect(DisclosureResolutionRejectionReasonSchema.parse("no_template_for_tuple")).toBe(
      "no_template_for_tuple",
    );
    expect(DisclosureResolutionRejectionReasonSchema.parse("no_active_template_at_now")).toBe(
      "no_active_template_at_now",
    );
  });

  it("rejects unknown reasons", () => {
    expect(() => DisclosureResolutionRejectionReasonSchema.parse("other")).toThrow();
  });
});

describe("DisclosureResolutionDecisionSchema", () => {
  it("round-trips a success decision", () => {
    expect(DisclosureResolutionDecisionSchema.parse(validSuccess)).toEqual(validSuccess);
  });

  it("round-trips a rejection decision", () => {
    expect(DisclosureResolutionDecisionSchema.parse(validRejection)).toEqual(validRejection);
  });

  it("discriminator: success requires disclosureTemplateId", () => {
    const broken = { ...validSuccess, disclosureTemplateId: undefined };
    expect(() => DisclosureResolutionDecisionSchema.parse(broken)).toThrow();
  });

  it("discriminator: rejection requires reason", () => {
    const broken = { ...validRejection, reason: undefined };
    expect(() => DisclosureResolutionDecisionSchema.parse(broken)).toThrow();
  });

  it("decisionReason max length is 2000", () => {
    const bad = { ...validSuccess, decisionReason: "x".repeat(2001) };
    expect(() => DisclosureResolutionDecisionSchema.parse(bad)).toThrow();
  });
});
