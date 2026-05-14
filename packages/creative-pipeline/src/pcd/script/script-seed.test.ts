import { describe, expect, it } from "vitest";
import { ScriptTemplatePayloadSchema } from "@creativeagent/schemas";
import { SP11_ROSTER_SIZE, SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import { isPlaceholderScriptText, PLACEHOLDER_SCRIPT_PREFIX } from "./script-placeholder.js";
import { SCRIPT_TEMPLATE_SEED } from "./script-seed.js";

const VIBES = [
  "omg_look",
  "quiet_confidence",
  "telling_her_friend",
  "seven_days_later",
  "just_left_clinic",
  "softly_glowing",
] as const;
const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;

const SP11_IDS = SP11_SYNTHETIC_CREATOR_ROSTER.map((r) => r.creatorIdentity.id);

describe("SCRIPT_TEMPLATE_SEED", () => {
  it("contains exactly 24 rows (6 vibes × 4 treatments)", () => {
    expect(SCRIPT_TEMPLATE_SEED).toHaveLength(24);
  });

  it("every (vibe, treatmentClass) pair appears exactly once", () => {
    const seen = new Set<string>();
    for (const r of SCRIPT_TEMPLATE_SEED) {
      const key = `${r.vibe}/${r.treatmentClass}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(24);
    for (const v of VIBES) {
      for (const t of TREATMENTS) {
        expect(seen.has(`${v}/${t}`)).toBe(true);
      }
    }
  });

  it("every row's id matches the canonical regex", () => {
    const ID_RE =
      /^script-template-(omg_look|quiet_confidence|telling_her_friend|seven_days_later|just_left_clinic|softly_glowing)-(med_spa|dental|anti_ageing|halal_wellness)-v\d+$/;
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.id).toMatch(ID_RE);
    }
  });

  it("every row's text starts with PLACEHOLDER_SCRIPT_PREFIX", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.text.startsWith(PLACEHOLDER_SCRIPT_PREFIX)).toBe(true);
      expect(isPlaceholderScriptText(r.text)).toBe(true);
    }
  });

  it("every row's text echoes its (vibe, treatmentClass) tuple", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.text).toContain(`${r.vibe}/${r.treatmentClass}`);
    }
  });

  it("every row has version=1 and status=active", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.version).toBe(1);
      expect(r.status).toBe("active");
    }
  });

  it("every row's compatibleCreatorIdentityIds equals the full SP11 roster (drift-proof)", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.compatibleCreatorIdentityIds.length).toBe(SP11_ROSTER_SIZE);
      expect([...r.compatibleCreatorIdentityIds]).toEqual(SP11_IDS);
    }
  });

  it("ScriptTemplatePayloadSchema.parse() accepts every row", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(() => ScriptTemplatePayloadSchema.parse(r)).not.toThrow();
    }
  });

  it("no row's compatibleCreatorIdentityIds contains the wildcard sentinel", () => {
    for (const r of SCRIPT_TEMPLATE_SEED) {
      expect(r.compatibleCreatorIdentityIds.includes("*")).toBe(false);
    }
  });
});
