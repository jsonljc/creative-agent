// SP6 — pinned by propagateConsentRevocation. Separate constant from
// PCD_APPROVAL_LIFECYCLE_VERSION because revocation propagation is a sweep
// with side effects, not a decision; the two surfaces evolve independently.
export const PCD_CONSENT_REVOCATION_VERSION = "consent-revocation@1.0.0";
