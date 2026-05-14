import { describe, expect, it } from "vitest";
import { DisclosureTemplatePayloadSchema } from "@creativeagent/schemas";
import { isPlaceholderDisclosureText } from "./disclosure-placeholder.js";
import { DISCLOSURE_TEMPLATE_SEED } from "./disclosure-seed.js";

const JURISDICTIONS = ["SG", "MY", "HK"] as const;
const PLATFORMS = ["meta", "tiktok", "red", "youtube_shorts"] as const;
const TREATMENTS = ["med_spa", "dental", "anti_ageing", "halal_wellness"] as const;
const ID_REGEX =
  /^disclosure-template-(SG|MY|HK)-(meta|tiktok|red|youtube_shorts)-(med_spa|dental|anti_ageing|halal_wellness)-v\d+$/;

describe("DISCLOSURE_TEMPLATE_SEED", () => {
  it("contains exactly 48 rows (3 jurisdictions × 4 platforms × 4 treatments)", () => {
    expect(DISCLOSURE_TEMPLATE_SEED).toHaveLength(48);
  });

  it("covers every (jurisdictionCode, platform, treatmentClass) tuple exactly once", () => {
    const seen = new Set<string>();
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      const key = `${r.jurisdictionCode}/${r.platform}/${r.treatmentClass}`;
      expect(seen.has(key), `duplicate tuple: ${key}`).toBe(false);
      seen.add(key);
    }
    for (const j of JURISDICTIONS) {
      for (const p of PLATFORMS) {
        for (const t of TREATMENTS) {
          expect(seen.has(`${j}/${p}/${t}`), `missing tuple: ${j}/${p}/${t}`).toBe(true);
        }
      }
    }
  });

  it("every row's id matches the canonical regex", () => {
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      expect(r.id, `bad id: ${r.id}`).toMatch(ID_REGEX);
    }
  });

  it("every row's text begins with the placeholder prefix", () => {
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      expect(isPlaceholderDisclosureText(r.text), `not a placeholder: ${r.text}`).toBe(true);
    }
  });

  it("every row's text echoes its own tuple as a substring", () => {
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      const tag = `${r.jurisdictionCode}/${r.platform}/${r.treatmentClass}`;
      expect(r.text.includes(tag), `text missing tuple tag (${tag}): ${r.text}`).toBe(true);
    }
  });

  it("every row uses the SP14 seed-wide defaults: version=1, effectiveFrom=2026-01-01Z, effectiveTo=null", () => {
    const epoch = new Date("2026-01-01T00:00:00Z").getTime();
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      expect(r.version).toBe(1);
      expect(r.effectiveFrom.getTime()).toBe(epoch);
      expect(r.effectiveTo).toBeNull();
    }
  });

  it("every row parses successfully through DisclosureTemplatePayloadSchema", () => {
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      expect(() => DisclosureTemplatePayloadSchema.parse(r)).not.toThrow();
    }
  });

  it("none of id, jurisdictionCode, platform, treatmentClass, text contains wildcard tokens", () => {
    const WILDCARDS = /\b(default|catch_all|wildcard|global|fallback)\b/;
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      for (const field of [r.id, r.jurisdictionCode, r.platform, r.treatmentClass, r.text]) {
        expect(field, `wildcard token in seed value: ${field}`).not.toMatch(WILDCARDS);
      }
    }
  });
});
