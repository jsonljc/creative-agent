import { describe, expect, it } from "vitest";
import {
  PcdLifecycleRefusalReasonSchema,
  PcdApprovalAdvancementDecisionSchema,
  PcdFinalExportDecisionSchema,
  PcdMetaDraftDecisionSchema,
  PcdConsentRevocationPropagationResultSchema,
} from "../pcd-identity.js";

describe("PcdLifecycleRefusalReasonSchema", () => {
  it("accepts every documented refusal reason", () => {
    const reasons = [
      "qc_failed",
      "qc_not_conclusive",
      "qc_result_not_found",
      "approval_not_granted",
      "tier_insufficient",
      "export_gate_closed",
      "consent_revoked",
      "compliance_check_failed",
      "asset_not_found",
      "snapshot_not_found",
      "creator_identity_not_found",
      "creative_job_not_found",
    ];
    for (const r of reasons) {
      expect(PcdLifecycleRefusalReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects undocumented reasons", () => {
    expect(PcdLifecycleRefusalReasonSchema.safeParse("unknown_reason").success).toBe(false);
    expect(PcdLifecycleRefusalReasonSchema.safeParse("").success).toBe(false);
  });
});

describe("PcdApprovalAdvancementDecisionSchema", () => {
  it("accepts a full allow decision", () => {
    const ok = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "approved",
      qcPassFail: "pass",
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts a refuse decision with multiple reasons", () => {
    const ok = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "rejected",
      qcPassFail: "fail",
      refusalReasons: ["qc_failed"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects proposedApprovalState outside the approved/rejected pair", () => {
    const bad = PcdApprovalAdvancementDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      currentApprovalState: "pending",
      proposedApprovalState: "deferred",
      qcPassFail: "pass",
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(bad.success).toBe(false);
  });
});

describe("PcdFinalExportDecisionSchema", () => {
  it("accepts a full allow with all four states aligned", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      qcPassFail: "pass",
      exportGateOpen: true,
      consentRevoked: false,
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts collect-all multi-reason refusal", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: 1,
      approvalState: "pending",
      qcPassFail: "fail",
      exportGateOpen: false,
      consentRevoked: true,
      refusalReasons: [
        "tier_insufficient",
        "approval_not_granted",
        "qc_failed",
        "export_gate_closed",
        "consent_revoked",
      ],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts null effectiveTier (per type-boundary normalization)", () => {
    const ok = PcdFinalExportDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: null,
      approvalState: "pending",
      qcPassFail: null,
      exportGateOpen: true,
      consentRevoked: false,
      refusalReasons: ["tier_insufficient"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});

describe("PcdMetaDraftDecisionSchema", () => {
  it("accepts allow with compliance pass", () => {
    const ok = PcdMetaDraftDecisionSchema.safeParse({
      allowed: true,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      complianceCheckPassed: true,
      consentRevoked: false,
      refusalReasons: [],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts refusal on compliance fail", () => {
    const ok = PcdMetaDraftDecisionSchema.safeParse({
      allowed: false,
      assetRecordId: "asset_1",
      effectiveTier: 2,
      approvalState: "approved",
      complianceCheckPassed: false,
      consentRevoked: false,
      refusalReasons: ["compliance_check_failed"],
      approvalLifecycleVersion: "approval-lifecycle@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});

describe("PcdConsentRevocationPropagationResultSchema", () => {
  it("accepts a propagation result with both partitions", () => {
    const ok = PcdConsentRevocationPropagationResultSchema.safeParse({
      consentRecordId: "consent_1",
      assetIdsFlagged: ["a1", "a2"],
      assetIdsAlreadyFlagged: ["a3"],
      consentRevocationVersion: "consent-revocation@1.0.0",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts an empty propagation result", () => {
    const ok = PcdConsentRevocationPropagationResultSchema.safeParse({
      consentRecordId: "consent_1",
      assetIdsFlagged: [],
      assetIdsAlreadyFlagged: [],
      consentRevocationVersion: "consent-revocation@1.0.0",
    });
    expect(ok.success).toBe(true);
  });
});

import * as schemasIndex from "../index.js";

describe("schemas barrel — SP6 surface", () => {
  it("re-exports all SP6 names", () => {
    expect(schemasIndex.PcdLifecycleRefusalReasonSchema).toBeDefined();
    expect(schemasIndex.PcdApprovalAdvancementDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdFinalExportDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdMetaDraftDecisionSchema).toBeDefined();
    expect(schemasIndex.PcdConsentRevocationPropagationResultSchema).toBeDefined();
  });
});
