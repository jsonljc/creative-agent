import { describe, expect, it } from "vitest";
import { PrismaCreativeJobReader } from "../prisma-creative-job-reader.js";

const fakePrisma = (rows: Record<string, unknown>) =>
  ({
    creativeJob: {
      findUnique: async ({ where }: { where: { id: string } }) => rows[`job:${where.id}`] ?? null,
    },
  }) as never;

describe("PrismaCreativeJobReader", () => {
  it("returns the narrow shape", async () => {
    const r = new PrismaCreativeJobReader(fakePrisma({ "job:j1": { id: "j1", effectiveTier: 2 } }));
    expect(await r.findById("j1")).toEqual({ id: "j1", effectiveTier: 2 });
  });

  it("returns null when the row is missing", async () => {
    const r = new PrismaCreativeJobReader(fakePrisma({}));
    expect(await r.findById("j1")).toBeNull();
  });
});
