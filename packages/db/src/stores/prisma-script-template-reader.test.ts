import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaScriptTemplateReader } from "./prisma-script-template-reader.js";

function makeMockPrisma(rows: unknown[]) {
  return {
    scriptTemplate: {
      findMany: vi.fn().mockResolvedValue(rows),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient & {
    scriptTemplate: { findMany: ReturnType<typeof vi.fn> };
  };
}

const goodDbRow = {
  id: "script-template-omg_look-med_spa-v1",
  vibe: "omg_look",
  treatmentClass: "med_spa",
  text: "Hook + body + CTA.",
  compatibleCreatorIdentityIds: ["cid_synth_cheryl_sg_01"],
  version: 1,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("PrismaScriptTemplateReader.listByVibeAndTreatment", () => {
  it("returns rows matching the (vibe, treatmentClass) pair", async () => {
    const prisma = makeMockPrisma([goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(goodDbRow.id);
    expect(prisma.scriptTemplate.findMany).toHaveBeenCalledWith({
      where: { vibe: "omg_look", treatmentClass: "med_spa" },
    });
  });

  it("returns empty array when Prisma returns no rows", async () => {
    const prisma = makeMockPrisma([]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "softly_glowing",
      treatmentClass: "halal_wellness",
    });
    expect(result).toEqual([]);
  });

  it("parses every row through ScriptTemplatePayloadSchema (parse-at-the-edges)", async () => {
    const prisma = makeMockPrisma([goodDbRow, goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    const result = await reader.listByVibeAndTreatment({
      vibe: "omg_look",
      treatmentClass: "med_spa",
    });
    expect(result).toHaveLength(2);
    for (const row of result) {
      expect(row.compatibleCreatorIdentityIds).toEqual(["cid_synth_cheryl_sg_01"]);
      expect(row.version).toBe(1);
      expect(row.status).toBe("active");
    }
  });

  it("throws when Prisma returns a row that violates the schema", async () => {
    const badRow = { ...goodDbRow, version: 0 }; // version < 1
    const prisma = makeMockPrisma([badRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    await expect(
      reader.listByVibeAndTreatment({ vibe: "omg_look", treatmentClass: "med_spa" }),
    ).rejects.toThrow();
  });

  it("does not call create / update / upsert / delete (read-only by design)", async () => {
    const prisma = makeMockPrisma([goodDbRow]);
    const reader = new PrismaScriptTemplateReader(prisma);
    await reader.listByVibeAndTreatment({ vibe: "omg_look", treatmentClass: "med_spa" });
    const stMock = prisma.scriptTemplate as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(stMock.create).not.toHaveBeenCalled();
    expect(stMock.update).not.toHaveBeenCalled();
    expect(stMock.upsert).not.toHaveBeenCalled();
    expect(stMock.delete).not.toHaveBeenCalled();
  });
});
