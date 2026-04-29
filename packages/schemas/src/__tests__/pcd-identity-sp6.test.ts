import { describe, expect, it } from "vitest";
import { PcdLifecycleRefusalReasonSchema } from "../pcd-identity.js";

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
