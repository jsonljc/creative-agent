import { describe, expect, it } from "vitest";
import { PrismaAssetRecordReader } from "./prisma-asset-record-reader.js";
import { PrismaProductQcResultReader } from "./prisma-product-qc-result-reader.js";
import { PrismaPcdIdentitySnapshotReader } from "./prisma-pcd-identity-snapshot-reader.js";
import { PrismaConsentRecordReader } from "./prisma-consent-record-reader.js";
import { PrismaCreativeJobReader } from "./prisma-creative-job-reader.js";
import { PrismaCreatorIdentityReader } from "./prisma-creator-identity-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    assetRecord: { findUnique: async ({ where }: { where: { id: string } }) => rows[`asset:${where.id}`] ?? null },
    productQcResult: {
      findFirst: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`qc:${where.assetRecordId}`] ?? null,
    },
    pcdIdentitySnapshot: {
      findUnique: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`snapshot:${where.assetRecordId}`] ?? null,
    },
    consentRecord: { findUnique: async ({ where }: { where: { id: string } }) => rows[`consent:${where.id}`] ?? null },
    creativeJob: { findUnique: async ({ where }: { where: { id: string } }) => rows[`job:${where.id}`] ?? null },
    creatorIdentity: { findUnique: async ({ where }: { where: { id: string } }) => rows[`creator:${where.id}`] ?? null },
  }) as never;

describe("PrismaAssetRecordReader", () => {
  it("returns the documented narrow shape", async () => {
    const r = new PrismaAssetRecordReader(
      fakePrisma({
        "asset:a1": { id: "a1", jobId: "j1", creatorId: "c1", approvalState: "pending", consentRevokedAfterGeneration: false, lockedDerivativeOf: null },
      }),
    );
    expect(await r.findById("a1")).toEqual({ id: "a1", jobId: "j1", creatorId: "c1", approvalState: "pending" });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaAssetRecordReader(fakePrisma({}));
    expect(await r.findById("a1")).toBeNull();
  });
});

describe("PrismaProductQcResultReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaProductQcResultReader(
      fakePrisma({ "qc:a1": { assetRecordId: "a1", passFail: "pass" } }),
    );
    expect(await r.findByAssetRecordId("a1")).toEqual({ assetRecordId: "a1", passFail: "pass" });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaProductQcResultReader(fakePrisma({}));
    expect(await r.findByAssetRecordId("a1")).toBeNull();
  });
  it("throws on unexpected passFail value", async () => {
    const r = new PrismaProductQcResultReader(
      fakePrisma({ "qc:a1": { assetRecordId: "a1", passFail: "garbage" } }),
    );
    await expect(r.findByAssetRecordId("a1")).rejects.toThrow();
  });
});

describe("PrismaPcdIdentitySnapshotReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaPcdIdentitySnapshotReader(
      fakePrisma({
        "snapshot:a1": { assetRecordId: "a1", creatorIdentityId: "c1", consentRecordId: "consent_1" },
      }),
    );
    expect(await r.findByAssetRecordId("a1")).toEqual({
      assetRecordId: "a1",
      creatorIdentityId: "c1",
      consentRecordId: "consent_1",
    });
  });
  it("returns null when the row is missing", async () => {
    const r = new PrismaPcdIdentitySnapshotReader(fakePrisma({}));
    expect(await r.findByAssetRecordId("a1")).toBeNull();
  });
});

describe("PrismaConsentRecordReader", () => {
  it("returns the narrow shape", async () => {
    const revokedAt = new Date("2026-04-29T00:00:00Z");
    const r = new PrismaConsentRecordReader(
      fakePrisma({ "consent:c1": { id: "c1", revoked: true, revokedAt } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", revoked: true, revokedAt });
  });
});

describe("PrismaCreativeJobReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreativeJobReader(fakePrisma({ "job:j1": { id: "j1", effectiveTier: 2 } }));
    expect(await r.findById("j1")).toEqual({ id: "j1", effectiveTier: 2 });
  });
});

describe("PrismaCreatorIdentityReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreatorIdentityReader(
      fakePrisma({ "creator:c1": { id: "c1", consentRecordId: null } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", consentRecordId: null });
  });
});
