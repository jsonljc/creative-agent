import { describe, expect, it } from "vitest";
import { PCD_SCRIPT_SELECTOR_VERSION } from "./script-selector-version.js";

describe("PCD_SCRIPT_SELECTOR_VERSION", () => {
  it('is the literal "pcd-script-selector@1.0.0"', () => {
    expect(PCD_SCRIPT_SELECTOR_VERSION).toBe("pcd-script-selector@1.0.0");
  });
});
