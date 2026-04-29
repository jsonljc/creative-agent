import { ConsentRevokedRefusalError } from "./consent-revocation-error.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader, CreatorIdentityReader } from "./lifecycle-readers.js";

export type AssertConsentNotRevokedForGenerationInput = {
  creatorIdentityId: string;
};

export type AssertConsentNotRevokedForGenerationStores = {
  creatorIdentityReader: CreatorIdentityReader;
  consentRecordReader: ConsentRecordReader;
};

/**
 * SP6 pre-check fired before new PCD generation against a creator identity.
 * Caller composes after SP3 resolver runs:
 *   resolvePcdRegistryContext → assertConsentNotRevokedForGeneration → routePcdShot
 *
 * Returns silently when:
 *   - CreatorIdentity has no consentRecordId (Tier 1/2 case; no consent bound).
 *   - Bound ConsentRecord exists with revoked === false.
 *
 * Throws:
 *   - ConsentRevokedRefusalError when bound ConsentRecord.revoked === true.
 *   - InvariantViolationError when the row hierarchy is corrupted (creator
 *     missing, or consent record bound but row missing).
 */
export async function assertConsentNotRevokedForGeneration(
  input: AssertConsentNotRevokedForGenerationInput,
  stores: AssertConsentNotRevokedForGenerationStores,
): Promise<void> {
  const { creatorIdentityId } = input;
  const creator = await stores.creatorIdentityReader.findById(creatorIdentityId);
  if (creator === null) {
    throw new InvariantViolationError("creator identity not found", { creatorIdentityId });
  }
  if (creator.consentRecordId === null) {
    return;
  }
  const consent = await stores.consentRecordReader.findById(creator.consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError("consent record referenced by creator does not exist", {
      creatorIdentityId,
      consentRecordId: creator.consentRecordId,
    });
  }
  if (consent.revoked === true) {
    throw new ConsentRevokedRefusalError({
      creatorIdentityId,
      consentRecordId: consent.id,
      revokedAt: consent.revokedAt,
    });
  }
}
