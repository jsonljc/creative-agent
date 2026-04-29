import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { assertConsentNotRevokedForEdit } from "./consent-pre-check-edit.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, PcdIdentitySnapshotReader } from "./lifecycle-readers.js";

const reader =
  <T>(row: T) =>
  async () =>
    row;

describe("assertConsentNotRevokedForEdit", () => {
  it("returns silently when no PcdIdentitySnapshot exists (non-PCD asset)", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader(null),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when snapshot has no consentRecordId", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: null,
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns silently when bound ConsentRecord.revoked === false", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws ConsentRevokedRefusalError when bound ConsentRecord.revoked === true", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: true, revokedAt: new Date() }),
          } as ConsentRecordReader,
        },
      ),
    ).rejects.toMatchObject({
      name: "ConsentRevokedRefusalError",
      priorAssetRecordId: "asset_1",
      consentRecordId: "consent_1",
      creatorIdentityId: null,
    });
  });

  it("throws InvariantViolationError when bound ConsentRecord is missing", async () => {
    await expect(
      assertConsentNotRevokedForEdit(
        { priorAssetRecordId: "asset_1" },
        {
          pcdIdentitySnapshotReader: {
            findByAssetRecordId: reader({
              assetRecordId: "asset_1",
              creatorIdentityId: "c",
              consentRecordId: "consent_1",
            }),
          } as PcdIdentitySnapshotReader,
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
