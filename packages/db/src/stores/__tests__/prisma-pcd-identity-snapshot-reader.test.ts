import { describe, expect, it } from "vitest";
import { PrismaPcdIdentitySnapshotReader } from "../prisma-pcd-identity-snapshot-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    pcdIdentitySnapshot: {
      findUnique: async ({ where }: { where: { assetRecordId: string } }) =>
        rows[`snapshot:${where.assetRecordId}`] ?? null,
    },
  }) as never;

describe("PrismaPcdIdentitySnapshotReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaPcdIdentitySnapshotReader(
      fakePrisma({
        "snapshot:a1": {
          assetRecordId: "a1",
          creatorIdentityId: "c1",
          consentRecordId: "consent_1",
        },
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
