import { describe, expect, it } from "vitest";
import { PCD_APPROVAL_LIFECYCLE_VERSION } from "./approval-lifecycle-version.js";
import { decidePcdApprovalAdvancement } from "./approval-advancement.js";
import type {
  AssetRecordReader,
  ProductQcResultReader,
} from "./lifecycle-readers.js";

const makeAssetReader = (
  row: Awaited<ReturnType<AssetRecordReader["findById"]>> | null,
): AssetRecordReader => ({
  async findById() {
    return row;
  },
});

const makeQcReader = (
  row: Awaited<ReturnType<ProductQcResultReader["findByAssetRecordId"]>> | null,
): ProductQcResultReader => ({
  async findByAssetRecordId() {
    return row;
  },
});

const baseAsset = {
  id: "asset_1",
  jobId: "job_1",
  creatorId: "creator_1",
  approvalState: "pending",
};

describe("decidePcdApprovalAdvancement", () => {
  it("allows when QC passFail === pass", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.proposedApprovalState).toBe("approved");
    expect(decision.qcPassFail).toBe("pass");
    expect(decision.refusalReasons).toEqual([]);
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });

  it("refuses on QC fail (SP5 step 5 hard-block closure)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "fail" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.proposedApprovalState).toBe("rejected");
    expect(decision.refusalReasons).toEqual(["qc_failed"]);
  });

  it("refuses on QC warn (SP5 binding: not conclusively pass)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "warn" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["qc_not_conclusive"]);
  });

  it("refuses when QC row is missing (SP5 invariant: every PCD asset has a row)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader(null),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["qc_result_not_found"]);
    expect(decision.qcPassFail).toBeNull();
  });

  it("refuses when AssetRecord is missing", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(null),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusalReasons).toEqual(["asset_not_found"]);
    expect(decision.currentApprovalState).toBe("");
    expect(decision.proposedApprovalState).toBe("rejected");
  });

  it("pins approvalLifecycleVersion from imports (caller cannot override)", async () => {
    const decision = await decidePcdApprovalAdvancement(
      { assetRecordId: "asset_1" },
      {
        assetRecordReader: makeAssetReader(baseAsset),
        productQcResultReader: makeQcReader({ assetRecordId: "asset_1", passFail: "pass" }),
      },
    );
    expect(decision.approvalLifecycleVersion).toBe(PCD_APPROVAL_LIFECYCLE_VERSION);
  });
});
