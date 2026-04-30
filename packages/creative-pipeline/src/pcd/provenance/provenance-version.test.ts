import { describe, expect, it } from "vitest";
import { PCD_PROVENANCE_VERSION } from "./provenance-version.js";

describe("PCD_PROVENANCE_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PROVENANCE_VERSION).toBe("pcd-provenance@1.0.0");
  });

  it("matches the slug@semver format", () => {
    expect(PCD_PROVENANCE_VERSION).toMatch(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/);
  });
});
