import {
  IdentityTierSchema,
  type IdentityTier,
  type PcdLifecycleRefusalReason,
  type PcdMetaDraftDecision,
  type PcdShotType,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { ComplianceCheck } from "./compliance-check.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
} from "./lifecycle-readers.js";

export type DecidePcdMetaDraftGateInput = {
  assetRecordId: string;
  shotType: PcdShotType;
};

export type DecidePcdMetaDraftGateStores = {
  assetRecordReader: AssetRecordReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  complianceCheck: ComplianceCheck;
};

/**
 * SP6 Meta-draft gate. Refuses unless effectiveTier ≥ 2 + approvalState ===
 * approved + ComplianceCheck.pass + non-revoked consent.
 *
 * Does NOT re-check QC: approval already implies QC passed (the approval gate
 * refuses on QC fail/warn). Re-checking would create a duplicate source of
 * truth and potential drift.
 *
 * The Meta-draft gate ALWAYS invokes complianceCheck.checkMetaDraftCompliance —
 * even when other refusal reasons are already present, even when effectiveTier
 * is null. Anti-pattern grep test (Task 17) enforces this is not invisible
 * theater. ComplianceCheck is the merge-back seam for real FTC-disclosure logic.
 *
 * // MERGE-BACK: emit WorkTrace here at return statement.
 */
export async function decidePcdMetaDraftGate(
  input: DecidePcdMetaDraftGateInput,
  stores: DecidePcdMetaDraftGateStores,
): Promise<PcdMetaDraftDecision> {
  const { assetRecordId, shotType } = input;
  const requiredTier: IdentityTier = 2;

  const asset = await stores.assetRecordReader.findById(assetRecordId);
  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      effectiveTier: null,
      approvalState: null,
      complianceCheckPassed: false,
      consentRevoked: false,
      refusalReasons: ["asset_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  const refusalReasons: PcdLifecycleRefusalReason[] = [];
  const job = await stores.creativeJobReader.findById(asset.jobId);
  let effectiveTier: IdentityTier | null = null;
  if (job === null) {
    refusalReasons.push("creative_job_not_found");
  } else if (job.effectiveTier === null) {
    refusalReasons.push("tier_insufficient");
  } else {
    const parsed = IdentityTierSchema.safeParse(job.effectiveTier);
    if (!parsed.success) {
      throw new InvariantViolationError("effectiveTier out of range", {
        jobId: job.id,
        value: job.effectiveTier,
      });
    }
    effectiveTier = parsed.data;
    if (effectiveTier < requiredTier) {
      refusalReasons.push("tier_insufficient");
    }
  }

  if (asset.approvalState !== "approved") {
    refusalReasons.push("approval_not_granted");
  }

  const snapshot = await stores.pcdIdentitySnapshotReader.findByAssetRecordId(assetRecordId);
  let consentRevoked = false;
  if (snapshot !== null && snapshot.consentRecordId !== null) {
    const consent = await stores.consentRecordReader.findById(snapshot.consentRecordId);
    if (consent === null) {
      throw new InvariantViolationError("consent record referenced by snapshot does not exist", {
        assetRecordId,
        consentRecordId: snapshot.consentRecordId,
      });
    }
    if (consent.revoked === true) {
      consentRevoked = true;
      refusalReasons.push("consent_revoked");
    }
  }

  // ALWAYS invoke ComplianceCheck — preserves the merge-back seam regardless
  // of other refusal state. Anti-pattern grep test enforces the literal
  // `complianceCheck.checkMetaDraftCompliance(` token in this source.
  const complianceResult = await stores.complianceCheck.checkMetaDraftCompliance({
    assetRecordId,
    shotType,
    effectiveTier,
  });
  const complianceCheckPassed = complianceResult.pass === true;
  if (!complianceCheckPassed) {
    refusalReasons.push("compliance_check_failed");
  }

  // MERGE-BACK: emit WorkTrace here. Applies to every decision return in this
  // function (the asset_not_found early return at the top, and the collect-all
  // return below). Wrap the call site at merge-back rather than duplicating.
  return {
    allowed: refusalReasons.length === 0,
    assetRecordId,
    effectiveTier,
    approvalState: asset.approvalState,
    complianceCheckPassed,
    consentRevoked,
    refusalReasons,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
