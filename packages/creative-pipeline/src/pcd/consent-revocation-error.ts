/**
 * Thrown by SP6 consent pre-checks (assertConsentNotRevokedForGeneration and
 * assertConsentNotRevokedForEdit) when the bound ConsentRecord is revoked.
 * Carries identifiers only — never PII fields like personName or scopeOfUse.
 *
 * Two call sites (generation vs edit) populate different fields:
 *   - generation pre-check sets creatorIdentityId, leaves priorAssetRecordId null
 *   - edit pre-check sets priorAssetRecordId, leaves creatorIdentityId null
 */
export class ConsentRevokedRefusalError extends Error {
  readonly name = "ConsentRevokedRefusalError";
  readonly creatorIdentityId: string | null;
  readonly priorAssetRecordId: string | null;
  readonly consentRecordId: string;
  readonly revokedAt: Date | null;

  constructor(args: {
    creatorIdentityId?: string;
    priorAssetRecordId?: string;
    consentRecordId: string;
    revokedAt: Date | null;
  }) {
    const subject =
      args.creatorIdentityId !== undefined
        ? `creatorIdentityId=${args.creatorIdentityId}`
        : `priorAssetRecordId=${args.priorAssetRecordId ?? "?"}`;
    super(`Consent revoked: ${subject} consentRecordId=${args.consentRecordId}`);
    this.creatorIdentityId = args.creatorIdentityId ?? null;
    this.priorAssetRecordId = args.priorAssetRecordId ?? null;
    this.consentRecordId = args.consentRecordId;
    this.revokedAt = args.revokedAt;
    Object.setPrototypeOf(this, ConsentRevokedRefusalError.prototype);
  }
}
