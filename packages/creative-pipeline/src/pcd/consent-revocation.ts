import type { PcdConsentRevocationPropagationResult } from "@creativeagent/schemas";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader } from "./lifecycle-readers.js";

/**
 * SP6 consent-revocation propagation store. Produces sorted asset id lists
 * for deterministic decision payloads and stable idempotency tests.
 */
export interface ConsentRevocationStore {
  /**
   * Returns AssetRecord ids whose PcdIdentitySnapshot.consentRecordId matches
   * the supplied consentRecordId. Returned ids are sorted ascending.
   */
  findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]>;

  /**
   * Atomically flips AssetRecord.consentRevokedAfterGeneration to true for
   * the supplied ids where it is currently false. Returns both partitions
   * (newly-flagged and already-flagged) sorted ascending.
   */
  markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }>;
}

export type PropagateConsentRevocationInput = {
  consentRecordId: string;
};

export type PropagateConsentRevocationStores = {
  consentRecordReader: ConsentRecordReader;
  consentRevocationStore: ConsentRevocationStore;
};

/**
 * SP6 — when a ConsentRecord transitions to revoked, walk every AssetRecord
 * whose PcdIdentitySnapshot.consentRecordId matches and flip
 * consentRevokedAfterGeneration to true. Idempotent: re-running flips no
 * rows and returns the same already-flagged set.
 *
 * Caller misuse guards (both throw InvariantViolationError):
 *   - ConsentRecord row not found
 *   - ConsentRecord exists but revoked === false (caller should not call this
 *     for a non-revoked record)
 *
 * Does NOT delete WorkTrace, PcdIdentitySnapshot, or AssetRecord rows. Audit
 * integrity is non-negotiable.
 *
 * // MERGE-BACK: emit WorkTrace per asset flagged here.
 * // MERGE-BACK: notification fan-out — Switchboard's three-channel notification
 * system fires per affected campaign owner.
 */
export async function propagateConsentRevocation(
  input: PropagateConsentRevocationInput,
  stores: PropagateConsentRevocationStores,
): Promise<PcdConsentRevocationPropagationResult> {
  const { consentRecordId } = input;
  const consent = await stores.consentRecordReader.findById(consentRecordId);
  if (consent === null) {
    throw new InvariantViolationError("consent record not found", { consentRecordId });
  }
  if (consent.revoked !== true) {
    throw new InvariantViolationError(
      "propagateConsentRevocation called for non-revoked record",
      { consentRecordId },
    );
  }

  const assetIds = await stores.consentRevocationStore.findAssetIdsByRevokedConsent(consentRecordId);
  const partition = await stores.consentRevocationStore.markAssetsConsentRevokedAfterGeneration(assetIds);

  return {
    consentRecordId,
    assetIdsFlagged: partition.newlyFlagged,
    assetIdsAlreadyFlagged: partition.alreadyFlagged,
    consentRevocationVersion: PCD_CONSENT_REVOCATION_VERSION,
  };
}
