import { describe, expect, it } from "vitest";
import { PCD_DISCLOSURE_RESOLVER_VERSION } from "./disclosure-resolver-version.js";

describe("PCD_DISCLOSURE_RESOLVER_VERSION", () => {
  it("is the pinned 18th PCD constant value", () => {
    expect(PCD_DISCLOSURE_RESOLVER_VERSION).toBe("pcd-disclosure-resolver@1.0.0");
  });
});
