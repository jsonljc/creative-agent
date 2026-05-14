import { describe, expect, it } from "vitest";
import type { CreativeBrief, DisclosureTemplatePayload } from "@creativeagent/schemas";
import { resolveDisclosure } from "./disclosure-resolver.js";
import { PCD_DISCLOSURE_RESOLVER_VERSION } from "./disclosure-resolver-version.js";

const NOW = new Date("2026-05-14T12:00:00Z");

const baseBrief: CreativeBrief = {
  briefId: "brief_t01",
  clinicId: "clinic_t01",
  treatmentClass: "med_spa",
  market: "SG",
  jurisdictionCode: "SG",
  platform: "meta",
  targetVibe: "omg_look",
  targetEthnicityFamily: "sg_chinese",
  targetAgeBand: "mid_20s",
  pricePositioning: "premium",
  hardConstraints: [] as const,
};

describe("resolveDisclosure — skeleton", () => {
  it("returns no_template_for_tuple with empty inspectedTemplateIds when called with an empty snapshot", () => {
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [] });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_template_for_tuple");
      expect(decision.inspectedTemplateIds).toEqual([]);
      expect(decision.resolverVersion).toBe(PCD_DISCLOSURE_RESOLVER_VERSION);
      expect(decision.briefId).toBe("brief_t01");
      expect(decision.jurisdictionCode).toBe("SG");
      expect(decision.platform).toBe("meta");
      expect(decision.treatmentClass).toBe("med_spa");
    }
  });
});

// Local helper used by later-task tests (kept here so the resolver-test
// file is self-contained across tasks).
export function makeTemplate(
  overrides: Partial<DisclosureTemplatePayload> = {},
): DisclosureTemplatePayload {
  return {
    id: "disclosure-template-SG-meta-med_spa-v1",
    jurisdictionCode: "SG",
    platform: "meta",
    treatmentClass: "med_spa",
    version: 1,
    text: "[DISCLOSURE_PENDING_LEGAL_REVIEW: SG/meta/med_spa]",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  };
}

describe("resolveDisclosure — tuple matching", () => {
  it("returns success when exactly one row matches the tuple (and is currently active with default window)", () => {
    const template = makeTemplate();
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [template] });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.disclosureTemplateId).toBe(template.id);
      expect(decision.templateVersion).toBe(1);
      expect(decision.disclosureText).toBe(template.text);
    }
  });

  it("returns no_template_for_tuple when the snapshot has zero matching rows", () => {
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [] });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_template_for_tuple");
      expect(decision.inspectedTemplateIds).toEqual([]);
    }
  });

  it("returns no_template_for_tuple when only the jurisdiction differs", () => {
    const wrongJurisdiction = makeTemplate({ jurisdictionCode: "MY" });
    const decision = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [wrongJurisdiction],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_template_for_tuple");
  });

  it("returns no_template_for_tuple when only the platform differs", () => {
    const wrongPlatform = makeTemplate({ platform: "tiktok" });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [wrongPlatform] });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_template_for_tuple");
  });

  it("returns no_template_for_tuple when only the treatment differs", () => {
    const wrongTreatment = makeTemplate({ treatmentClass: "dental" });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [wrongTreatment] });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe("no_template_for_tuple");
  });
});

describe("resolveDisclosure — window boundaries", () => {
  const yearStart = new Date("2026-01-01T00:00:00Z");
  const yearEnd = new Date("2026-12-31T23:59:59Z");

  it("now === effectiveFrom is active (inclusive lower bound)", () => {
    const tpl = makeTemplate({ effectiveFrom: NOW, effectiveTo: yearEnd });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(decision.allowed).toBe(true);
  });

  it("now === effectiveTo is inactive (exclusive upper bound)", () => {
    const tpl = makeTemplate({ effectiveFrom: yearStart, effectiveTo: NOW });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_active_template_at_now");
      expect(decision.inspectedTemplateIds).toEqual([tpl.id]);
    }
  });

  it("now = effectiveFrom - 1ms is inactive", () => {
    const tpl = makeTemplate({
      effectiveFrom: new Date(NOW.getTime() + 1),
      effectiveTo: yearEnd,
    });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(decision.allowed).toBe(false);
  });

  it("now = effectiveTo - 1ms is active", () => {
    const tpl = makeTemplate({
      effectiveFrom: yearStart,
      effectiveTo: new Date(NOW.getTime() + 1),
    });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(decision.allowed).toBe(true);
  });

  it("effectiveTo === null with now >= effectiveFrom is active indefinitely", () => {
    const tpl = makeTemplate({ effectiveFrom: yearStart, effectiveTo: null });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(decision.allowed).toBe(true);
  });

  it("all tuple-matched rows expired → no_active_template_at_now, inspectedTemplateIds ASC", () => {
    const tplC = makeTemplate({
      id: "disclosure-template-SG-meta-med_spa-v3",
      version: 3,
      effectiveFrom: yearStart,
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
    });
    const tplA = makeTemplate({
      id: "disclosure-template-SG-meta-med_spa-v1",
      version: 1,
      effectiveFrom: yearStart,
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
    });
    const tplB = makeTemplate({
      id: "disclosure-template-SG-meta-med_spa-v2",
      version: 2,
      effectiveFrom: yearStart,
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
    });
    const decision = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [tplC, tplA, tplB],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_active_template_at_now");
      expect(decision.inspectedTemplateIds).toEqual([tplA.id, tplB.id, tplC.id]);
    }
  });
});
