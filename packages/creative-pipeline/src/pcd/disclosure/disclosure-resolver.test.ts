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

describe("resolveDisclosure — version tiebreak", () => {
  const yearStart = new Date("2026-01-01T00:00:00Z");

  it("two active rows: picks higher version (v2 over v1)", () => {
    const v1 = makeTemplate({ id: "tpl-v1", version: 1, effectiveFrom: yearStart });
    const v2 = makeTemplate({ id: "tpl-v2", version: 2, effectiveFrom: yearStart });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [v1, v2] });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) expect(decision.templateVersion).toBe(2);
  });

  it("three active rows: picks the highest of v1/v2/v3", () => {
    const v1 = makeTemplate({ id: "tpl-v1", version: 1, effectiveFrom: yearStart });
    const v2 = makeTemplate({ id: "tpl-v2", version: 2, effectiveFrom: yearStart });
    const v3 = makeTemplate({ id: "tpl-v3", version: 3, effectiveFrom: yearStart });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [v1, v2, v3] });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) expect(decision.templateVersion).toBe(3);
  });

  it("active v1 + inactive (out-of-window) v2: picks the active v1", () => {
    const activeV1 = makeTemplate({ id: "tpl-active-v1", version: 1, effectiveFrom: yearStart });
    const inactiveV2 = makeTemplate({
      id: "tpl-inactive-v2",
      version: 2,
      effectiveFrom: yearStart,
      effectiveTo: new Date(NOW.getTime() - 1), // window closes 1ms before NOW
    });
    const decision = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [activeV1, inactiveV2],
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.disclosureTemplateId).toBe("tpl-active-v1");
      expect(decision.templateVersion).toBe(1);
    }
  });

  it("two active rows same version: picks lexicographically smaller id", () => {
    const idB = makeTemplate({ id: "tpl-b", version: 5, effectiveFrom: yearStart });
    const idA = makeTemplate({ id: "tpl-a", version: 5, effectiveFrom: yearStart });
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [idB, idA] });
    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) expect(decision.disclosureTemplateId).toBe("tpl-a");
  });
});

describe("resolveDisclosure — inspectedTemplateIds ordering", () => {
  const yearStart = new Date("2026-01-01T00:00:00Z");

  it("c, a, b expired rows produce inspectedTemplateIds = [a, b, c] (id ASC)", () => {
    const expired = new Date(NOW.getTime() - 1);
    const c = makeTemplate({ id: "c", version: 1, effectiveFrom: yearStart, effectiveTo: expired });
    const a = makeTemplate({ id: "a", version: 1, effectiveFrom: yearStart, effectiveTo: expired });
    const b = makeTemplate({ id: "b", version: 1, effectiveFrom: yearStart, effectiveTo: expired });
    const decision = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [c, a, b],
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.inspectedTemplateIds).toEqual(["a", "b", "c"]);
    }
  });

  it("snapshot order does not affect inspectedTemplateIds ASC ordering on failure", () => {
    const expired = new Date(NOW.getTime() - 1);
    const ids = ["zeta", "alpha", "mu", "beta"];
    const rows = ids.map((id) =>
      makeTemplate({ id, version: 1, effectiveFrom: yearStart, effectiveTo: expired }),
    );
    const decision = resolveDisclosure({ brief: baseBrief, now: NOW, templates: rows });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.inspectedTemplateIds).toEqual(["alpha", "beta", "mu", "zeta"]);
    }
  });
});

describe("resolveDisclosure — pin invariant", () => {
  it("success carries resolverVersion === PCD_DISCLOSURE_RESOLVER_VERSION", () => {
    const tpl = makeTemplate();
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(d.resolverVersion).toBe(PCD_DISCLOSURE_RESOLVER_VERSION);
  });

  it("no_template_for_tuple carries resolverVersion === PCD_DISCLOSURE_RESOLVER_VERSION", () => {
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [] });
    expect(d.resolverVersion).toBe(PCD_DISCLOSURE_RESOLVER_VERSION);
  });

  it("no_active_template_at_now carries resolverVersion === PCD_DISCLOSURE_RESOLVER_VERSION", () => {
    const expired = new Date(NOW.getTime() - 1);
    const tpl = makeTemplate({
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: expired,
    });
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(d.resolverVersion).toBe(PCD_DISCLOSURE_RESOLVER_VERSION);
  });
});

describe("resolveDisclosure — determinism", () => {
  it("identical input twice yields byte-equal decisions", () => {
    const tpl1 = makeTemplate({ id: "tpl-1", version: 1 });
    const tpl2 = makeTemplate({ id: "tpl-2", version: 2 });
    const d1 = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl1, tpl2] });
    const d2 = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl1, tpl2] });
    expect(d1).toEqual(d2);
  });

  it("shuffling templates order yields the same disclosureTemplateId", () => {
    const tpl1 = makeTemplate({ id: "tpl-1", version: 1 });
    const tpl2 = makeTemplate({ id: "tpl-2", version: 2 });
    const tpl3 = makeTemplate({ id: "tpl-3", version: 3 });
    const d1 = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [tpl1, tpl2, tpl3],
    });
    const d2 = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [tpl3, tpl1, tpl2],
    });
    expect(d1.allowed && d2.allowed).toBe(true);
    if (d1.allowed === true && d2.allowed === true) {
      expect(d1.disclosureTemplateId).toBe(d2.disclosureTemplateId);
    }
  });

  it("duplicate (tuple, version) rows still produce deterministic id-ASC winner under shuffle", () => {
    const a = makeTemplate({ id: "dup-a", version: 5 });
    const b = makeTemplate({ id: "dup-b", version: 5 });
    const c = makeTemplate({ id: "dup-c", version: 5 });
    const d1 = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [a, b, c] });
    const d2 = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [c, a, b] });
    if (d1.allowed === true && d2.allowed === true) {
      expect(d1.disclosureTemplateId).toBe("dup-a");
      expect(d2.disclosureTemplateId).toBe("dup-a");
    }
  });
});

describe("resolveDisclosure — decisionReason content", () => {
  it("success reason substring contains picked_version=N", () => {
    const tpl = makeTemplate({ version: 7 });
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.decisionReason).toMatch(/picked_version=7/);
  });

  it("success reason substring includes both active and total counts", () => {
    const yearStart = new Date("2026-01-01T00:00:00Z");
    const expired = new Date(NOW.getTime() - 1);
    const activeA = makeTemplate({ id: "a", version: 1, effectiveFrom: yearStart });
    const activeB = makeTemplate({ id: "b", version: 2, effectiveFrom: yearStart });
    const inactiveC = makeTemplate({
      id: "c",
      version: 3,
      effectiveFrom: yearStart,
      effectiveTo: expired,
    });
    const d = resolveDisclosure({
      brief: baseBrief,
      now: NOW,
      templates: [activeA, activeB, inactiveC],
    });
    if (d.allowed === true) {
      expect(d.decisionReason).toMatch(/active=2/);
      expect(d.decisionReason).toMatch(/total_for_tuple=3/);
    }
  });
});

describe("resolveDisclosure — brief field echo", () => {
  it("success echoes brief.jurisdictionCode, platform, treatmentClass verbatim", () => {
    const tpl = makeTemplate();
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [tpl] });
    if (d.allowed === true) {
      expect(d.briefId).toBe(baseBrief.briefId);
      expect(d.jurisdictionCode).toBe(baseBrief.jurisdictionCode);
      expect(d.platform).toBe(baseBrief.platform);
      expect(d.treatmentClass).toBe(baseBrief.treatmentClass);
    }
  });

  it("failure echoes brief.jurisdictionCode, platform, treatmentClass verbatim", () => {
    const d = resolveDisclosure({ brief: baseBrief, now: NOW, templates: [] });
    if (d.allowed === false) {
      expect(d.briefId).toBe(baseBrief.briefId);
      expect(d.jurisdictionCode).toBe(baseBrief.jurisdictionCode);
      expect(d.platform).toBe(baseBrief.platform);
      expect(d.treatmentClass).toBe(baseBrief.treatmentClass);
    }
  });
});
