import type { IdentityTier, PcdShotType } from "@creativeagent/schemas";

/**
 * SP6 merge-back seam — future Switchboard FTC-disclosure / Meta-draft
 * compliance pipeline.
 *
 * The Meta-draft gate genuinely invokes this interface (anti-pattern grep
 * test in Task 17 enforces). The default in-tree implementer always passes;
 * merge-back replaces it with the real check.
 *
 * // MERGE-BACK: replace AlwaysPassComplianceCheck with real FTC-disclosure /
 * Meta-draft compliance pipeline at production wiring time.
 */

export type ComplianceCheckInput = {
  assetRecordId: string;
  shotType: PcdShotType;
  // Widened to allow null because the Meta-draft gate must call ComplianceCheck
  // even when CreativeJob.effectiveTier is null. Real implementers may treat
  // null as a refusal reason; the in-tree default ignores tier.
  effectiveTier: IdentityTier | null;
  // Future merge-back fields: scriptClaimsPath, testimonialFlags, voiceConsentRecordId.
};

export type ComplianceCheckResult = { pass: true } | { pass: false; reason: string };

export interface ComplianceCheck {
  checkMetaDraftCompliance(input: ComplianceCheckInput): Promise<ComplianceCheckResult>;
}

export class AlwaysPassComplianceCheck implements ComplianceCheck {
  async checkMetaDraftCompliance(_input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
    return { pass: true };
  }
}
