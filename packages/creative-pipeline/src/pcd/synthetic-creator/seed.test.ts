import { describe, expect, it } from "vitest";
import { CreatorIdentitySyntheticPayloadSchema } from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER, SP11_ROSTER_SIZE } from "./seed.js";

describe("SP11 synthetic creator seed roster", () => {
  it("contains exactly 10 characters", () => {
    expect(SP11_ROSTER_SIZE).toBe(10);
    expect(SP11_SYNTHETIC_CREATOR_ROSTER).toHaveLength(10);
  });

  it("every entry has a unique creatorIdentityId", () => {
    const ids = SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.creatorIdentityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every synthetic payload validates against the schema", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(() => CreatorIdentitySyntheticPayloadSchema.parse(c.synthetic)).not.toThrow();
    }
  });

  it("every mutuallyExclusiveWithIds reference resolves to another roster member", () => {
    const ids = new Set(SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.creatorIdentityId));
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      for (const ref of c.synthetic.mutuallyExclusiveWithIds) {
        expect(ids.has(ref)).toBe(true);
      }
    }
  });

  it("Nana and Bua are mutually exclusive (Thai-Chinese substitution)", () => {
    const nana = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.creatorIdentity.name === "Nana");
    const bua = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.creatorIdentity.name === "Bua");
    expect(nana).toBeDefined();
    expect(bua).toBeDefined();
    expect(nana?.synthetic.mutuallyExclusiveWithIds).toContain(bua?.synthetic.creatorIdentityId);
    expect(bua?.synthetic.mutuallyExclusiveWithIds).toContain(nana?.synthetic.creatorIdentityId);
  });

  it("the roster covers all four v1 treatment classes", () => {
    const classes = new Set(SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.treatmentClass));
    expect(classes.has("med_spa")).toBe(true);
    expect(classes.has("dental")).toBe(true);
    expect(classes.has("anti_ageing")).toBe(true);
    expect(classes.has("halal_wellness")).toBe(true);
  });

  it("the roster covers all three v1 markets", () => {
    const markets = new Set(SP11_SYNTHETIC_CREATOR_ROSTER.map((c) => c.synthetic.market));
    expect(markets).toEqual(new Set(["SG", "MY", "HK"]));
  });

  it("every dallePromptLocked starts with the locked phrase 'Vertical lo-fi selfie photo'", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(c.synthetic.dallePromptLocked).toMatch(/^Vertical lo-fi selfie photo\./);
    }
  });

  it("every entry has a CreatorIdentity stub with kind: 'synthetic'", () => {
    for (const c of SP11_SYNTHETIC_CREATOR_ROSTER) {
      expect(c.creatorIdentity.kind).toBe("synthetic");
      expect(c.creatorIdentity.id).toBe(c.synthetic.creatorIdentityId);
    }
  });
});
