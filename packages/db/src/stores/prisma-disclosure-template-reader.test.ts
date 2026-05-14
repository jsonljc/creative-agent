import { describe, expect, it, vi } from "vitest";
import { PrismaDisclosureTemplateReader } from "./prisma-disclosure-template-reader.js";

type Row = {
  id: string;
  jurisdictionCode: string;
  platform: string;
  treatmentClass: string;
  version: number;
  text: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

const row: Row = {
  id: "disclosure-template-SG-meta-med_spa-v1",
  jurisdictionCode: "SG",
  platform: "meta",
  treatmentClass: "med_spa",
  version: 1,
  text: "[DISCLOSURE_PENDING_LEGAL_REVIEW: SG/meta/med_spa]",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
};

function makePrisma(rows: Row[]) {
  const findMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter(
      (r) =>
        r.jurisdictionCode === where.jurisdictionCode &&
        r.platform === where.platform &&
        r.treatmentClass === where.treatmentClass,
    ),
  );
  const create = vi.fn();
  const update = vi.fn();
  const upsert = vi.fn();
  const deleteMethod = vi.fn();
  // The reader only needs `disclosureTemplate.findMany`. Other methods are spies
  // to assert the reader never calls them (read-only enforcement).
  const prisma = {
    disclosureTemplate: { findMany, create, update, upsert, delete: deleteMethod },
  } as unknown as ConstructorParameters<typeof PrismaDisclosureTemplateReader>[0];
  return { prisma, findMany, create, update, upsert, deleteMethod };
}

describe("PrismaDisclosureTemplateReader", () => {
  it("listByTuple returns rows matching the tuple", async () => {
    const { prisma } = makePrisma([row]);
    const reader = new PrismaDisclosureTemplateReader(prisma);
    const out = await reader.listByTuple({
      jurisdictionCode: "SG",
      platform: "meta",
      treatmentClass: "med_spa",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: row.id,
      version: 1,
      jurisdictionCode: "SG",
      platform: "meta",
      treatmentClass: "med_spa",
    });
  });

  it("listByTuple returns empty array for non-matching tuple", async () => {
    const { prisma } = makePrisma([row]);
    const reader = new PrismaDisclosureTemplateReader(prisma);
    const out = await reader.listByTuple({
      jurisdictionCode: "MY",
      platform: "meta",
      treatmentClass: "med_spa",
    });
    expect(out).toEqual([]);
  });

  it("listByTuple parses every row through DisclosureTemplatePayloadSchema", async () => {
    const { prisma } = makePrisma([row]);
    const reader = new PrismaDisclosureTemplateReader(prisma);
    const out = await reader.listByTuple({
      jurisdictionCode: "SG",
      platform: "meta",
      treatmentClass: "med_spa",
    });
    expect(out[0]?.effectiveFrom).toBeInstanceOf(Date);
    expect(out[0]?.effectiveTo).toBeNull();
  });

  it("listByTuple throws on a DB row with an invalid enum value (parse-at-the-edges)", async () => {
    // Direct Prisma mock: findMany returns the bogus row regardless of `where`,
    // simulating DB drift where a row's stored string is not a valid enum value.
    // We deliberately bypass makePrisma's filter-by-where behaviour so the
    // resolver sees the bogus row and the schema.parse throws.
    const bogus: Row = { ...row, jurisdictionCode: "XX" };
    const findMany = vi.fn(async () => [bogus]);
    const prisma = {
      disclosureTemplate: {
        findMany,
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof PrismaDisclosureTemplateReader>[0];
    const reader = new PrismaDisclosureTemplateReader(prisma);
    await expect(
      reader.listByTuple({ jurisdictionCode: "SG", platform: "meta", treatmentClass: "med_spa" }),
    ).rejects.toThrow();
  });

  it("reader does not invoke create / update / upsert / delete (read-only)", async () => {
    const { prisma, create, update, upsert, deleteMethod } = makePrisma([row]);
    const reader = new PrismaDisclosureTemplateReader(prisma);
    await reader.listByTuple({
      jurisdictionCode: "SG",
      platform: "meta",
      treatmentClass: "med_spa",
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });
});
