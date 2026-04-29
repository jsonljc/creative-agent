import { describe, expect, it } from "vitest";
import { PrismaAssetRecordReader } from "../prisma-asset-record-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    assetRecord: {
      findUnique: async ({ where }: { where: { id: string } }) => rows[`asset:${where.id}`] ?? null,
    },
  }) as never;

describe("PrismaAssetRecordReader", () => {
  it("returns the documented narrow shape", async () => {
    const r = new PrismaAssetRecordReader(
      fakePrisma({
        "asset:a1": {
          id: "a1",
          jobId: "j1",
          creatorId: "c1",
          approvalState: "pending",
          consentRevokedAfterGeneration: false,
          lockedDerivativeOf: null,
        },
      }),
    );
    expect(await r.findById("a1")).toEqual({
      id: "a1",
      jobId: "j1",
      creatorId: "c1",
      approvalState: "pending",
    });
  });

  it("returns null when the row is missing", async () => {
    const r = new PrismaAssetRecordReader(fakePrisma({}));
    expect(await r.findById("a1")).toBeNull();
  });
});
