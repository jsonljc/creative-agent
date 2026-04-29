import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";

describe("ConsentRevokedRefusalError", () => {
  it("constructs from generation pre-check (creatorIdentityId form)", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: new Date("2026-04-29T10:00:00Z"),
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConsentRevokedRefusalError");
    expect(err.creatorIdentityId).toBe("creator_1");
    expect(err.priorAssetRecordId).toBeNull();
    expect(err.consentRecordId).toBe("consent_1");
    expect(err.revokedAt).toEqual(new Date("2026-04-29T10:00:00Z"));
  });

  it("constructs from edit pre-check (priorAssetRecordId form)", () => {
    const err = new ConsentRevokedRefusalError({
      priorAssetRecordId: "asset_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    expect(err.creatorIdentityId).toBeNull();
    expect(err.priorAssetRecordId).toBe("asset_1");
    expect(err.consentRecordId).toBe("consent_1");
    expect(err.revokedAt).toBeNull();
  });

  it("message identifies the refusal kind", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    expect(err.message.toLowerCase()).toContain("consent");
    expect(err.message.toLowerCase()).toContain("revoked");
  });

  it("never echoes ConsentRecord PII (no personName, no scopeOfUse)", () => {
    const err = new ConsentRevokedRefusalError({
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
      revokedAt: null,
    });
    const json = JSON.stringify({
      message: err.message,
      creatorIdentityId: err.creatorIdentityId,
      priorAssetRecordId: err.priorAssetRecordId,
      consentRecordId: err.consentRecordId,
      revokedAt: err.revokedAt,
    });
    expect(json).not.toMatch(/personName/i);
    expect(json).not.toMatch(/scopeOfUse/i);
    expect(json).not.toMatch(/territory/i);
  });
});
