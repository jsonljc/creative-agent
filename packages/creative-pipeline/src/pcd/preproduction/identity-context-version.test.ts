import { describe, expect, it } from "vitest";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

describe("PCD_IDENTITY_CONTEXT_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_IDENTITY_CONTEXT_VERSION).toBe("identity-context@1.0.0");
  });
});
