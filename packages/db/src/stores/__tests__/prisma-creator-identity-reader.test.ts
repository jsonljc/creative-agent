import { describe, expect, it } from "vitest";
import { PrismaCreatorIdentityReader } from "../prisma-creator-identity-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    creatorIdentity: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows[`creator:${where.id}`] ?? null,
    },
  }) as never;

describe("PrismaCreatorIdentityReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreatorIdentityReader(
      fakePrisma({ "creator:c1": { id: "c1", consentRecordId: null } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", consentRecordId: null });
  });

  it("returns null when the row is missing", async () => {
    const r = new PrismaCreatorIdentityReader(fakePrisma({}));
    expect(await r.findById("c1")).toBeNull();
  });
});
