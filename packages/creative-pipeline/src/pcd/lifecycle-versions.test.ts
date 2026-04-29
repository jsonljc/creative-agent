import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";

describe("SP6 lifecycle version constants", () => {
  it("PCD_APPROVAL_LIFECYCLE_VERSION is the locked 1.0.0 string", () => {
    expect(PCD_APPROVAL_LIFECYCLE_VERSION).toBe("approval-lifecycle@1.0.0");
  });

  it("PCD_CONSENT_REVOCATION_VERSION is the locked 1.0.0 string", () => {
    expect(PCD_CONSENT_REVOCATION_VERSION).toBe("consent-revocation@1.0.0");
  });

  it("constants are non-empty strings (defensive)", () => {
    expect(typeof PCD_APPROVAL_LIFECYCLE_VERSION).toBe("string");
    expect(PCD_APPROVAL_LIFECYCLE_VERSION.length).toBeGreaterThan(0);
    expect(typeof PCD_CONSENT_REVOCATION_VERSION).toBe("string");
    expect(PCD_CONSENT_REVOCATION_VERSION.length).toBeGreaterThan(0);
  });
});
