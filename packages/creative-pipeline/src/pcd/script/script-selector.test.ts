import type { CreativeBrief, ScriptTemplatePayload } from "@creativeagent/schemas";
import { describe, expect, it } from "vitest";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";
import { selectScript } from "./script-selector.js";

const NOW = new Date("2026-05-14T12:00:00Z");

const baseBrief: CreativeBrief = {
  briefId: "brief_01",
  clinicId: "clinic_01",
  treatmentClass: "med_spa",
  market: "SG",
  jurisdictionCode: "SG",
  platform: "meta",
  targetVibe: "omg_look",
  targetEthnicityFamily: "sg_chinese",
  targetAgeBand: "mid_20s",
  pricePositioning: "entry",
  hardConstraints: [],
};

describe("selectScript — skeleton", () => {
  it("returns a failure decision when templates is empty", () => {
    const d = selectScript({
      brief: baseBrief,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW,
      templates: [],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.briefId).toBe("brief_01");
      expect(d.reason).toBe("no_compatible_script");
      expect(d.vibe).toBe("omg_look");
      expect(d.treatmentClass).toBe("med_spa");
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(d.inspectedTemplateIds).toEqual([]);
      expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
    }
  });
});

describe("selectScript — 3-way prefilter (vibe + treatment + status='active')", () => {
  it("returns success when exactly one row matches the 3-way filter", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
  });

  it("returns no_compatible_script when vibe does not match", () => {
    const row = mkRow({
      id: "script-template-quiet_confidence-med_spa-v1",
      vibe: "quiet_confidence",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.reason).toBe("no_compatible_script");
  });

  it("returns no_compatible_script when treatmentClass does not match", () => {
    const row = mkRow({
      id: "script-template-omg_look-dental-v1",
      vibe: "omg_look",
      treatmentClass: "dental",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.reason).toBe("no_compatible_script");
  });

  it("returns no_compatible_script when status is retired (NOT a separate reason)", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      status: "retired",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.reason).toBe("no_compatible_script");
      // The retired row was filtered at the 3-way stage; not surfaced in inspectedTemplateIds.
      expect(d.inspectedTemplateIds).toEqual([]);
    }
  });

  it("returns no_compatible_script with empty inspectedTemplateIds when no 3-way matches exist", () => {
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [
        mkRow({ id: "x1", vibe: "softly_glowing", treatmentClass: "dental" }),
        mkRow({ id: "x2", vibe: "quiet_confidence", treatmentClass: "anti_ageing" }),
      ],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) expect(d.inspectedTemplateIds).toEqual([]);
  });
});

describe("selectScript — creator-compat filter + all_filtered_by_creator branch", () => {
  it("returns all_filtered_by_creator when 3-way matches exist but none list this creator", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.reason).toBe("all_filtered_by_creator");
      expect(d.inspectedTemplateIds).toEqual(["script-template-omg_look-med_spa-v1"]);
      expect(d.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
    }
  });

  it("succeeds when the creator IS in compatibleCreatorIdentityIds", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01", "cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.allowed).toBe(true);
  });

  it("inspectedTemplateIds on all_filtered_by_creator is sorted id ASC", () => {
    const rows = [
      mkRow({
        id: "c-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
      mkRow({
        id: "a-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
      mkRow({
        id: "b-row",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
      }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.inspectedTemplateIds).toEqual(["a-row", "b-row", "c-row"]);
    }
  });

  it("inspectedTemplateIds does NOT include retired rows (retired filtered out before creator check)", () => {
    const retired = mkRow({
      id: "retired-row",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      status: "retired",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const active = mkRow({
      id: "active-row",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["cid_synth_vivienne_sg_02"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [retired, active],
    });
    expect(d.allowed).toBe(false);
    if (d.allowed === false) {
      expect(d.inspectedTemplateIds).toEqual(["active-row"]);
    }
  });
});

describe("selectScript — version tie-break (version DESC, id ASC)", () => {
  it("picks the highest version among 2 active creator-matched rows", () => {
    const rows = [
      mkRow({ id: "v1-row", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v2-row", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) {
      expect(d.scriptTemplateId).toBe("v2-row");
      expect(d.scriptTemplateVersion).toBe(2);
    }
  });

  it("picks the highest version among 3 (1/2/3)", () => {
    const rows = [
      mkRow({ id: "v1-row", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v3-row", vibe: "omg_look", treatmentClass: "med_spa", version: 3 }),
      mkRow({ id: "v2-row", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("v3-row");
  });

  it("picks active v1 over retired v2 (retired filtered earlier)", () => {
    const rows = [
      mkRow({
        id: "active-v1",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        version: 1,
        status: "active",
      }),
      mkRow({
        id: "retired-v2",
        vibe: "omg_look",
        treatmentClass: "med_spa",
        version: 2,
        status: "retired",
      }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("active-v1");
  });

  it("breaks ties on equal version by id ASC (final tie-break)", () => {
    const rows = [
      mkRow({ id: "z-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
      mkRow({ id: "a-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
      mkRow({ id: "m-row", vibe: "omg_look", treatmentClass: "med_spa", version: 5 }),
    ];
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    expect(d.allowed).toBe(true);
    if (d.allowed === true) expect(d.scriptTemplateId).toBe("a-row");
  });
});

describe("selectScript — pin invariant + determinism + now-unused", () => {
  it("emits PCD_SCRIPT_SELECTOR_VERSION on every success branch", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("emits PCD_SCRIPT_SELECTOR_VERSION on no_compatible_script", () => {
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("emits PCD_SCRIPT_SELECTOR_VERSION on all_filtered_by_creator", () => {
    const row = mkRow({
      id: "x",
      vibe: "omg_look",
      treatmentClass: "med_spa",
      compatibleCreatorIdentityIds: ["someone-else"],
    });
    const d = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [row],
    });
    expect(d.selectorVersion).toBe(PCD_SCRIPT_SELECTOR_VERSION);
  });

  it("is deterministic: identical input yields byte-equal decisions", () => {
    const rows = [
      mkRow({ id: "v1", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "v2", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const inp = {
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    };
    expect(JSON.stringify(selectScript(inp))).toBe(JSON.stringify(selectScript(inp)));
  });

  it("is order-stable: shuffling templates does not change the chosen scriptTemplateId", () => {
    const rows = [
      mkRow({ id: "a", vibe: "omg_look", treatmentClass: "med_spa", version: 1 }),
      mkRow({ id: "b", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
      mkRow({ id: "c", vibe: "omg_look", treatmentClass: "med_spa", version: 2 }),
    ];
    const d1 = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: rows,
    });
    const d2 = selectScript({
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      now: NOW_FIXTURE,
      templates: [...rows].reverse(),
    });
    expect(d1.allowed).toBe(true);
    expect(d2.allowed).toBe(true);
    if (d1.allowed === true && d2.allowed === true) {
      expect(d1.scriptTemplateId).toBe(d2.scriptTemplateId);
      expect(d1.scriptTemplateId).toBe("b"); // v2 wins; id ASC tie-break picks "b" over "c"
    }
  });

  it("varying `now` does NOT change the decision for identical other inputs (J8 — v1 no time windows)", () => {
    const row = mkRow({
      id: "script-template-omg_look-med_spa-v1",
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    const base = {
      brief: BRIEF_FIXTURE,
      creatorIdentityId: "cid_synth_cheryl_sg_01",
      templates: [row],
    };
    const dEpoch = selectScript({ ...base, now: new Date(0) });
    const d2000 = selectScript({ ...base, now: new Date("2000-01-01T00:00:00Z") });
    const d2100 = selectScript({ ...base, now: new Date("2100-12-31T23:59:59Z") });
    expect(JSON.stringify(dEpoch)).toBe(JSON.stringify(d2000));
    expect(JSON.stringify(d2000)).toBe(JSON.stringify(d2100));
  });
});

// Templates available to later tasks
export const NOW_FIXTURE = NOW;
export const BRIEF_FIXTURE = baseBrief;
export function mkRow(
  partial: Partial<ScriptTemplatePayload> & {
    id: string;
    vibe: ScriptTemplatePayload["vibe"];
    treatmentClass: ScriptTemplatePayload["treatmentClass"];
  },
): ScriptTemplatePayload {
  return {
    text: "ok",
    compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
    version: 1,
    status: "active",
    ...partial,
  } as ScriptTemplatePayload;
}
