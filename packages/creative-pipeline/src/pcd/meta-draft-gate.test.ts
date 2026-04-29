import { describe, expect, it } from "vitest";
import type { PcdShotType } from "@creativeagent/schemas";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./compliance-check.js";
import { decidePcdMetaDraftGate } from "./meta-draft-gate.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
} from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

const baseAsset = { id: "asset_1", jobId: "job_1", creatorId: "creator_1", approvalState: "approved" };
const baseJob = { id: "job_1", effectiveTier: 2 as const };
const baseSnapshot = { assetRecordId: "asset_1", creatorIdentityId: "creator_1", consentRecordId: null };

class SpyComplianceCheck implements ComplianceCheck {
  calls: ComplianceCheckInput[] = [];
  constructor(private result: ComplianceCheckResult = { pass: true }) {}
  async checkMetaDraftCompliance(input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
    this.calls.push(input);
    return this.result;
  }
}

const stores = (overrides: {
  asset?: Awaited<ReturnType<AssetRecordReader["findById"]>> | null;
  job?: Awaited<ReturnType<CreativeJobReader["findById"]>> | null;
  snapshot?: Awaited<ReturnType<PcdIdentitySnapshotReader["findByAssetRecordId"]>> | null;
  consent?: Awaited<ReturnType<ConsentRecordReader["findById"]>> | null;
  complianceCheck?: ComplianceCheck;
}) => ({
  assetRecordReader: {
    findById: reader("asset" in overrides ? overrides.asset : baseAsset),
  } as AssetRecordReader,
  pcdIdentitySnapshotReader: {
    findByAssetRecordId: reader("snapshot" in overrides ? overrides.snapshot : baseSnapshot),
  } as PcdIdentitySnapshotReader,
  consentRecordReader: {
    findById: reader(
      "consent" in overrides
        ? overrides.consent
        : { id: "consent_1", revoked: false, revokedAt: null },
    ),
  } as ConsentRecordReader,
  creativeJobReader: {
    findById: reader("job" in overrides ? overrides.job : baseJob),
  } as CreativeJobReader,
  complianceCheck: overrides.complianceCheck ?? new AlwaysPassComplianceCheck(),
});

describe("decidePcdMetaDraftGate", () => {
  const shotType: PcdShotType = "talking_head";

  it("allows when tier ≥ 2 + approved + compliance pass + consent OK", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({}));
    expect(d.allowed).toBe(true);
    expect(d.refusalReasons).toEqual([]);
    expect(d.complianceCheckPassed).toBe(true);
    expect(d.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on tier_insufficient at Tier 1", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: 1 } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on null effectiveTier", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: null } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on approval_not_granted", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ asset: { ...baseAsset, approvalState: "pending" } }),
    );
    expect(d.refusalReasons).toContain("approval_not_granted");
  });

  it("refuses on consent_revoked", async () => {
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
      }),
    );
    expect(d.consentRevoked).toBe(true);
    expect(d.refusalReasons).toContain("consent_revoked");
  });

  it("refuses on compliance_check_failed", async () => {
    const spy = new SpyComplianceCheck({ pass: false, reason: "ftc_disclosure_missing" });
    const d = await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ complianceCheck: spy }),
    );
    expect(d.complianceCheckPassed).toBe(false);
    expect(d.refusalReasons).toContain("compliance_check_failed");
  });

  it("ALWAYS invokes complianceCheck (even on happy-path allow)", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ complianceCheck: spy }),
    );
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toEqual({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    });
  });

  it("ALWAYS invokes complianceCheck even when other refusal reasons exist", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({
        asset: { ...baseAsset, approvalState: "pending" },
        job: { id: "job_1", effectiveTier: 1 },
        complianceCheck: spy,
      }),
    );
    expect(spy.calls).toHaveLength(1);
  });

  it("passes effectiveTier: null to ComplianceCheck when CreativeJob.effectiveTier is null", async () => {
    const spy = new SpyComplianceCheck();
    await decidePcdMetaDraftGate(
      { assetRecordId: "asset_1", shotType },
      stores({ job: { id: "job_1", effectiveTier: null }, complianceCheck: spy }),
    );
    expect(spy.calls[0]?.effectiveTier).toBeNull();
  });

  it("snapshot referencing missing ConsentRecord → throws InvariantViolationError", async () => {
    await expect(
      decidePcdMetaDraftGate(
        { assetRecordId: "asset_1", shotType },
        stores({
          snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
          consent: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("AssetRecord missing → asset_not_found single refusal", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({ asset: null }));
    expect(d.refusalReasons).toEqual(["asset_not_found"]);
  });

  it("CreativeJob missing → creative_job_not_found", async () => {
    const d = await decidePcdMetaDraftGate({ assetRecordId: "asset_1", shotType }, stores({ job: null }));
    expect(d.refusalReasons).toContain("creative_job_not_found");
  });
});
