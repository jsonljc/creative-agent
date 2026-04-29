import type { PcdApprovalAdvancementDecision } from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import type { AssetRecordReader, ProductQcResultReader } from "./lifecycle-readers.js";

export type DecidePcdApprovalAdvancementInput = {
  assetRecordId: string;
};

export type DecidePcdApprovalAdvancementStores = {
  assetRecordReader: AssetRecordReader;
  productQcResultReader: ProductQcResultReader;
};

/**
 * SP6 — refuses approval advancement unless SP5's persisted QC ledger row
 * passes. Closes the hard-block invariant step 5 SP5 deferred:
 * "label-visible without OCR match → approval refused."
 *
 * Refusal reasons (the only `if (passFail ===` branch in SP6 source):
 *   passFail === "fail" → qc_failed (SP5 step 5)
 *   passFail === "warn" → qc_not_conclusive (SP5 binding semantic)
 *
 * SP6 returns the decision struct only — does not mutate AssetRecord
 * approvalState. Mutation is wired at merge-back inside Switchboard's
 * ApprovalLifecycle after consuming this decision.
 *
 * // MERGE-BACK: emit WorkTrace here at the return statement, payload =
 * decision struct.
 */
export async function decidePcdApprovalAdvancement(
  input: DecidePcdApprovalAdvancementInput,
  stores: DecidePcdApprovalAdvancementStores,
): Promise<PcdApprovalAdvancementDecision> {
  const { assetRecordId } = input;
  const asset = await stores.assetRecordReader.findById(assetRecordId);

  if (asset === null) {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: "",
      proposedApprovalState: "rejected",
      qcPassFail: null,
      refusalReasons: ["asset_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  const qc = await stores.productQcResultReader.findByAssetRecordId(assetRecordId);

  if (qc === null) {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: null,
      refusalReasons: ["qc_result_not_found"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  // The single `if (passFail ===)` branch permitted in SP6 source — anti-pattern
  // grep test (Task 17) enforces this is the only one.
  if (qc.passFail === "fail") {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: "fail",
      refusalReasons: ["qc_failed"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  if (qc.passFail === "warn") {
    return {
      allowed: false,
      assetRecordId,
      currentApprovalState: asset.approvalState,
      proposedApprovalState: "rejected",
      qcPassFail: "warn",
      refusalReasons: ["qc_not_conclusive"],
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
    };
  }

  // pass
  return {
    allowed: true,
    assetRecordId,
    currentApprovalState: asset.approvalState,
    proposedApprovalState: "approved",
    qcPassFail: "pass",
    refusalReasons: [],
    approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
  };
}
