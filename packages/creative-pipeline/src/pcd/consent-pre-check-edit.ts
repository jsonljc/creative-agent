import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, PcdIdentitySnapshotReader } from "./lifecycle-readers.js";

export type AssertConsentNotRevokedForEditInput = {
  priorAssetRecordId: string;
};

export type AssertConsentNotRevokedForEditStores = {
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
};

/**
 * SP6 pre-check fired before new edit/extend creation against a prior asset.
 * Caller composes after fetching the prior asset id:
 *   assertConsentNotRevokedForEdit(priorAssetRecordId) → editor / extender
 *
 * Returns silently when:
 *   - The prior asset has no PcdIdentitySnapshot (non-PCD historical asset).
 *   - The snapshot has no consentRecordId bound.
 *   - The bound ConsentRecord exists with revoked === false.
 *
 * Throws:
 *   - ConsentRevokedRefusalError when bound ConsentRecord.revoked === true.
 *   - InvariantViolationError when the snapshot references a missing
 *     ConsentRecord (corrupted state).
 */
export async function assertConsentNotRevokedForEdit(
  input: AssertConsentNotRevokedForEditInput,
  stores: AssertConsentNotRevokedForEditStores,
): Promise<void> {
  const { priorAssetRecordId } = input;
  const snapshot = await stores.pcdIdentitySnapshotReader.findByAssetRecordId(priorAssetRecordId);
  if (snapshot === null) return;
  if (snapshot.consentRecordId === null) return;
  const consent = await stores.consentRecordReader.findById(snapshot.consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError(
      "consent record referenced by snapshot does not exist",
      { priorAssetRecordId, consentRecordId: snapshot.consentRecordId },
    );
  }
  if (consent.revoked === true) {
    throw new ConsentRevokedRefusalError({
      priorAssetRecordId,
      consentRecordId: consent.id,
      revokedAt: consent.revokedAt,
    });
  }
}
