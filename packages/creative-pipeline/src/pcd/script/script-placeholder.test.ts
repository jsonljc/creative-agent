import { describe, expect, it } from "vitest";
import { isPlaceholderScriptText, PLACEHOLDER_SCRIPT_PREFIX } from "./script-placeholder.js";

describe("PLACEHOLDER_SCRIPT_PREFIX", () => {
  it('is the literal "[SCRIPT_PENDING_CREATIVE_REVIEW:"', () => {
    expect(PLACEHOLDER_SCRIPT_PREFIX).toBe("[SCRIPT_PENDING_CREATIVE_REVIEW:");
  });
});

describe("isPlaceholderScriptText", () => {
  it("returns true for text starting with the prefix", () => {
    expect(isPlaceholderScriptText("[SCRIPT_PENDING_CREATIVE_REVIEW: omg_look/med_spa]")).toBe(
      true,
    );
  });

  it("returns false for real-looking text", () => {
    expect(isPlaceholderScriptText("Hook line + body + CTA.")).toBe(false);
    expect(isPlaceholderScriptText("")).toBe(false);
    expect(isPlaceholderScriptText("  [SCRIPT_PENDING_CREATIVE_REVIEW: leading space]")).toBe(
      false,
    );
  });
});
