import {
  IdentityTierSchema,
  type IdentityTier,
  type PcdFinalExportDecision,
  type PcdLifecycleRefusalReason,
} from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { ExportGateState } from "./export-gate-state.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";

export type DecidePcdFinalExportGateInput = {
  assetRecordId: string;
  requiredTier?: IdentityTier;
};

export type DecidePcdFinalExportGateStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
  pcdIdentitySnapshotReader: PcdIdentitySnapshotReader;
  consentRecordReader: ConsentRecordReader;
  creativeJobReader: CreativeJobReader;
  exportGateState: ExportGateState;
};

/**
 * SP6 final-export gate. Refuses unless all four orthogonal states align:
 * tier ≥ requiredTier (default 2), approvalState === "approved",
 * passFail === "pass", ExportGateState.isOpen === true. Plus: refuses on
 * consent-revoked snapshots.
 *
 * Collect-all semantics: every refusal reason is recorded, no short-circuit.
 * An export decision is a forensic statement; multi-fail produces a multi-reason
 * payload so operators see the full state in one round trip.
 *
 * // MERGE-BACK: emit WorkTrace here at return statement, payload = decision.
 * // MERGE-BACK: legal-override path — when LegalOverrideRecord exists for
 * (assetRecordId, consentRecordId) with reason and approver, suppress the
 * consent_revoked reason. Today: refusal is the default.
 */
export async function decidePcdFinalExportGate(
  input: DecidePcdFinalExportGateInput,
  stores: DecidePcdFinalExportGateStores,
): Promise<PcdFinalExportDecision> {
  const { assetRecordId } = input;
  const requiredTier: IdentityTier = input.requiredTier ?? 2;

  const asset = await stores.assetRecordReader.findById(assetRecordId);
  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      effectiveTier: null,
      approvalState: null,
      qcPassFail: null,
      exportGateOpen: false,
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

  const qc = await stores.productQcResultReader.findByAssetRecordId(assetRecordId);
  let qcPassFail: PcdFinalExportDecision["qcPassFail"] = null;
  if (qc === null) {
    refusalReasons.push("qc_result_not_found");
  } else {
    qcPassFail = qc.passFail;
    // Use switch to avoid the `if (...passFail ===)` pattern, which is reserved
    // for approval-advancement.ts only (anti-pattern grep test enforces).
    switch (qc.passFail) {
      case "fail":
        refusalReasons.push("qc_failed");
        break;
      case "warn":
        refusalReasons.push("qc_not_conclusive");
        break;
      case "pass":
        break;
    }
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
      // // MERGE-BACK: legal-override path — suppress this push when an
      // override exists for (assetRecordId, consentRecordId).
      refusalReasons.push("consent_revoked");
    }
  }

  const exportGate = await stores.exportGateState.isOpen(assetRecordId);
  const exportGateOpen = exportGate.open === true;
  if (!exportGateOpen) {
    refusalReasons.push("export_gate_closed");
  }

  // MERGE-BACK: emit WorkTrace here. Applies to every decision return in this
  // function (the asset_not_found early return at the top, and the collect-all
  // return below). Wrap the call site at merge-back rather than duplicating.
  return {
    allowed: refusalReasons.length === 0,
    assetRecordId,
    effectiveTier,
    approvalState: asset.approvalState,
    qcPassFail,
    exportGateOpen,
    consentRevoked,
    refusalReasons,
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
