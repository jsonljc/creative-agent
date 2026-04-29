import { describe, expect, it } from "vitest";
import { PrismaConsentRecordReader } from "../prisma-consent-record-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    consentRecord: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows[`consent:${where.id}`] ?? null,
    },
  }) as never;

describe("PrismaConsentRecordReader", () => {
  it("returns the narrow shape", async () => {
    const revokedAt = new Date("2026-04-29T00:00:00Z");
    const r = new PrismaConsentRecordReader(
      fakePrisma({ "consent:c1": { id: "c1", revoked: true, revokedAt } }),
    );
    expect(await r.findById("c1")).toEqual({ id: "c1", revoked: true, revokedAt });
  });

  it("returns null when the row is missing", async () => {
    const r = new PrismaConsentRecordReader(fakePrisma({}));
    expect(await r.findById("c1")).toBeNull();
  });
});
