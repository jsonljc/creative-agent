import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { assertConsentNotRevokedForGeneration } from "./consent-pre-check-generation.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, CreatorIdentityReader } from "./lifecycle-readers.js";

const reader =
  <T>(row: T) =>
  async () =>
    row;

describe("assertConsentNotRevokedForGeneration", () => {
  it("returns silently when CreatorIdentity has no consentRecordId (Tier 1/2)", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: null }),
          } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when ConsentRecord exists with revoked === false", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws ConsentRevokedRefusalError when ConsentRecord.revoked === true", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({
              id: "consent_1",
              revoked: true,
              revokedAt: new Date("2026-04-29T00:00:00Z"),
            }),
          } as ConsentRecordReader,
        },
      ),
    ).rejects.toMatchObject({
      name: "ConsentRevokedRefusalError",
      creatorIdentityId: "creator_1",
      consentRecordId: "consent_1",
    });
  });

  it("throws InvariantViolationError when CreatorIdentity is missing", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: { findById: reader(null) } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when bound ConsentRecord is missing", async () => {
    await expect(
      assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("ConsentRevokedRefusalError carries revokedAt date", async () => {
    const revokedAt = new Date("2026-04-15T10:30:00Z");
    try {
      await assertConsentNotRevokedForGeneration(
        { creatorIdentityId: "creator_1" },
        {
          creatorIdentityReader: {
            findById: reader({ id: "creator_1", consentRecordId: "consent_1" }),
          } as CreatorIdentityReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: true, revokedAt }),
          } as ConsentRecordReader,
        },
      );
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentRevokedRefusalError);
      expect((e as ConsentRevokedRefusalError).revokedAt).toEqual(revokedAt);
    }
  });
});
