import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_DISCLOSURE_PREFIX,
  isPlaceholderDisclosureText,
} from "./disclosure-placeholder.js";

describe("PLACEHOLDER_DISCLOSURE_PREFIX", () => {
  it("is the exact machine-detectable prefix", () => {
    expect(PLACEHOLDER_DISCLOSURE_PREFIX).toBe("[DISCLOSURE_PENDING_LEGAL_REVIEW:");
  });
});

describe("isPlaceholderDisclosureText", () => {
  it("returns true for text starting with the placeholder prefix", () => {
    expect(isPlaceholderDisclosureText("[DISCLOSURE_PENDING_LEGAL_REVIEW: SG/meta/med_spa]")).toBe(
      true,
    );
  });

  it("returns false for text not starting with the prefix", () => {
    expect(isPlaceholderDisclosureText("This product is for medical use only.")).toBe(false);
  });

  it("returns false when the prefix appears mid-string", () => {
    expect(
      isPlaceholderDisclosureText("Real copy [DISCLOSURE_PENDING_LEGAL_REVIEW: SG/meta] suffix"),
    ).toBe(false);
  });
});
