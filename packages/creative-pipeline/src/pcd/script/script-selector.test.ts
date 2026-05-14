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
