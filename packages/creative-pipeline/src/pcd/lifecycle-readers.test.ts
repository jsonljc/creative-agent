import { describe, expect, it } from "vitest";
import type {
  AssetRecordReader,
  ProductQcResultReader,
  PcdIdentitySnapshotReader,
  ConsentRecordReader,
  CreativeJobReader,
  CreatorIdentityReader,
} from "./lifecycle-readers.js";

describe("lifecycle-readers — type contracts", () => {
  it("AssetRecordReader has the documented method signature", () => {
    const reader: AssetRecordReader = {
      async findById(_id) {
        return { id: "x", jobId: "j", creatorId: null, approvalState: "pending" };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("ProductQcResultReader narrows to passFail-only fields", () => {
    const reader: ProductQcResultReader = {
      async findByAssetRecordId(_id) {
        return { assetRecordId: "x", passFail: "pass" as const };
      },
    };
    expect(reader.findByAssetRecordId).toBeDefined();
  });

  it("PcdIdentitySnapshotReader returns consent-relevant fields", () => {
    const reader: PcdIdentitySnapshotReader = {
      async findByAssetRecordId(_id) {
        return { assetRecordId: "x", creatorIdentityId: "c", consentRecordId: null };
      },
    };
    expect(reader.findByAssetRecordId).toBeDefined();
  });

  it("ConsentRecordReader returns revocation status only", () => {
    const reader: ConsentRecordReader = {
      async findById(_id) {
        return { id: "x", revoked: false, revokedAt: null };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("CreativeJobReader returns effectiveTier (number | null)", () => {
    const reader: CreativeJobReader = {
      async findById(_id) {
        return { id: "x", effectiveTier: 2 };
      },
    };
    expect(reader.findById).toBeDefined();
  });

  it("CreatorIdentityReader returns consentRecordId binding", () => {
    const reader: CreatorIdentityReader = {
      async findById(_id) {
        return { id: "x", consentRecordId: null };
      },
    };
    expect(reader.findById).toBeDefined();
  });
});
