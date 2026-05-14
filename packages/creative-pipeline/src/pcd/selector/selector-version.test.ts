import { describe, expect, it } from "vitest";
import { PCD_SELECTOR_VERSION } from "./selector-version.js";

describe("PCD_SELECTOR_VERSION", () => {
  it("is the SP13 v1.0.0 literal", () => {
    expect(PCD_SELECTOR_VERSION).toBe("pcd-selector@1.0.0");
  });
});
