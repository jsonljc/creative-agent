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
