import { describe, expect, it } from "vitest";
import { PrismaProductQcResultReader } from "../prisma-product-qc-result-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    productQcResult: {
      findFirst: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`qc:${where.assetRecordId}`] ?? null,
    },
  }) as never;

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
