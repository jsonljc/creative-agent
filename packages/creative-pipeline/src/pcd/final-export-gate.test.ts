import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { decidePcdFinalExportGate } from "./final-export-gate.js";
import { AlwaysOpenExportGateState, type ExportGateState } from "./export-gate-state.js";
import type {
  AssetRecordReader,
  ConsentRecordReader,
  CreativeJobReader,
  PcdIdentitySnapshotReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";
import { InvariantViolationError } from "./invariant-violation-error.js";

const reader = <T>(row: T) => async () => row;

const baseAsset = { id: "asset_1", jobId: "job_1", creatorId: "creator_1", approvalState: "approved" };
const baseJob = { id: "job_1", effectiveTier: 2 as const };
const baseQc = { assetRecordId: "asset_1", passFail: "pass" as const };
const baseSnapshot = { assetRecordId: "asset_1", creatorIdentityId: "creator_1", consentRecordId: null };
const baseConsentNotRevoked = { id: "consent_1", revoked: false, revokedAt: null };
const closedExportGate: ExportGateState = {
  async isOpen() {
    return { open: false, reason: "embargo" };
  },
};

const stores = (overrides: {
  asset?: Awaited<ReturnType<AssetRecordReader["findById"]>> | null;
  job?: Awaited<ReturnType<CreativeJobReader["findById"]>> | null;
  qc?: Awaited<ReturnType<ProductQcResultReader["findByAssetRecordId"]>> | null;
  snapshot?: Awaited<ReturnType<PcdIdentitySnapshotReader["findByAssetRecordId"]>> | null;
  consent?: Awaited<ReturnType<ConsentRecordReader["findById"]>> | null;
  exportGateState?: ExportGateState;
}) => ({
  assetRecordReader: {
    findById: reader("asset" in overrides ? overrides.asset : baseAsset),
  } as AssetRecordReader,
  productQcResultReader: {
    findByAssetRecordId: reader("qc" in overrides ? overrides.qc : baseQc),
  } as ProductQcResultReader,
  pcdIdentitySnapshotReader: {
    findByAssetRecordId: reader("snapshot" in overrides ? overrides.snapshot : baseSnapshot),
  } as PcdIdentitySnapshotReader,
  consentRecordReader: {
    findById: reader("consent" in overrides ? overrides.consent : baseConsentNotRevoked),
  } as ConsentRecordReader,
  creativeJobReader: {
    findById: reader("job" in overrides ? overrides.job : baseJob),
  } as CreativeJobReader,
  exportGateState: overrides.exportGateState ?? new AlwaysOpenExportGateState(),
});

describe("decidePcdFinalExportGate", () => {
  it("allows when all four states aligned + consent OK", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({}));
    expect(d.allowed).toBe(true);
    expect(d.refusalReasons).toEqual([]);
    expect(d.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on tier_insufficient (effectiveTier=1, requiredTier=2)", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ job: { id: "job_1", effectiveTier: 1 } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on null effectiveTier (tier_insufficient)", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ job: { id: "job_1", effectiveTier: null } }),
    );
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBeNull();
    expect(d.refusalReasons).toContain("tier_insufficient");
  });

  it("refuses on approval_not_granted when approvalState=pending", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ asset: { ...baseAsset, approvalState: "pending" } }),
    );
    expect(d.refusalReasons).toContain("approval_not_granted");
  });

  it("refuses on qc_failed", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ qc: { assetRecordId: "asset_1", passFail: "fail" } }),
    );
    expect(d.refusalReasons).toContain("qc_failed");
  });

  it("refuses on qc_not_conclusive when passFail=warn", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ qc: { assetRecordId: "asset_1", passFail: "warn" } }),
    );
    expect(d.refusalReasons).toContain("qc_not_conclusive");
  });

  it("refuses on export_gate_closed", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ exportGateState: closedExportGate }),
    );
    expect(d.exportGateOpen).toBe(false);
    expect(d.refusalReasons).toContain("export_gate_closed");
  });

  it("refuses on consent_revoked", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
      }),
    );
    expect(d.consentRevoked).toBe(true);
    expect(d.refusalReasons).toContain("consent_revoked");
  });

  it("collect-all: tier + approval + qc + export-gate + consent all wrong → 5 reasons", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({
        asset: { ...baseAsset, approvalState: "pending" },
        job: { id: "job_1", effectiveTier: 1 },
        qc: { assetRecordId: "asset_1", passFail: "fail" },
        snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
        consent: { id: "consent_1", revoked: true, revokedAt: new Date() },
        exportGateState: closedExportGate,
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toEqual(
      expect.arrayContaining([
        "tier_insufficient",
        "approval_not_granted",
        "qc_failed",
        "export_gate_closed",
        "consent_revoked",
      ]),
    );
    expect(d.refusalReasons).toHaveLength(5);
  });

  it("snapshot-null (non-PCD asset) → consentRevoked stays false", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1" },
      stores({ snapshot: null }),
    );
    expect(d.consentRevoked).toBe(false);
    expect(d.allowed).toBe(true);
  });

  it("AssetRecord missing → asset_not_found single-reason refusal", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ asset: null }));
    expect(d.allowed).toBe(false);
    expect(d.refusalReasons).toEqual(["asset_not_found"]);
  });

  it("CreativeJob missing → creative_job_not_found", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ job: null }));
    expect(d.refusalReasons).toContain("creative_job_not_found");
  });

  it("QC row missing → qc_result_not_found", async () => {
    const d = await decidePcdFinalExportGate({ assetRecordId: "asset_1" }, stores({ qc: null }));
    expect(d.refusalReasons).toContain("qc_result_not_found");
  });

  it("snapshot references missing ConsentRecord → throws InvariantViolationError", async () => {
    await expect(
      decidePcdFinalExportGate(
        { assetRecordId: "asset_1" },
        stores({
          snapshot: { assetRecordId: "asset_1", creatorIdentityId: "c", consentRecordId: "consent_1" },
          consent: null,
        }),
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("respects custom requiredTier", async () => {
    const d = await decidePcdFinalExportGate(
      { assetRecordId: "asset_1", requiredTier: 3 },
      stores({ job: { id: "job_1", effectiveTier: 2 } }),
    );
    expect(d.refusalReasons).toContain("tier_insufficient");
  });
});
