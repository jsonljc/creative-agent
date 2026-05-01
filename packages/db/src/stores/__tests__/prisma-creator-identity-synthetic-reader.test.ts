import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentitySyntheticReader } from "../prisma-creator-identity-synthetic-reader.js";

function createMockPrisma() {
  return {
    creatorIdentitySynthetic: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  creatorIdentityId: "cid_sp11_test_001",
  treatmentClass: "med_spa",
  vibe: "omg_look",
  market: "SG",
  ethnicityFamily: "sg_chinese",
  ageBand: "mid_20s",
  pricePositioning: "entry",
  physicalDescriptors: {
    faceShape: "Heart-shaped",
    skinTone: "NC20",
    eyeShape: "Double eyelid",
    hair: "Black messy",
    ageRead: "21-23",
    buildNote: "Petite",
  },
  dallePromptLocked: "Vertical lo-fi selfie photo. Test prompt.",
  klingDirection: {
    setting: "Clinic bathroom",
    motion: "Sudden lean",
    energy: "Mouth opening",
    lighting: "Fluorescent",
    avoid: ["Slow pans"],
  },
  voiceCaptionStyle: {
    voice: "Fast, breathy",
    captionStyle: "lowercase",
    sampleHook: "okay but",
    sampleCta: "just go",
  },
  mutuallyExclusiveWithIds: [],
  status: "active",
  ...overrides,
});

describe("PrismaCreatorIdentitySyntheticReader", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let reader: PrismaCreatorIdentitySyntheticReader;

  beforeEach(() => {
    prisma = createMockPrisma();
    reader = new PrismaCreatorIdentitySyntheticReader(prisma as never);
  });

  describe("findById", () => {
    it("returns the parsed payload when row exists", async () => {
      prisma.creatorIdentitySynthetic.findUnique.mockResolvedValue(dbRow());
      const result = await reader.findById("cid_sp11_test_001");
      expect(result).toBeDefined();
      expect(result?.dallePromptLocked).toBe("Vertical lo-fi selfie photo. Test prompt.");
      expect(result?.treatmentClass).toBe("med_spa");
    });

    it("returns null when no row found", async () => {
      prisma.creatorIdentitySynthetic.findUnique.mockResolvedValue(null);
      const result = await reader.findById("cid_missing");
      expect(result).toBeNull();
    });

    it("throws when the row fails zod validation (data corruption guard)", async () => {
      prisma.creatorIdentitySynthetic.findUnique.mockResolvedValue(
        dbRow({ dallePromptLocked: "" }),
      );
      await expect(reader.findById("cid_sp11_test_001")).rejects.toThrow();
    });
  });

  describe("findByMarketAndTreatmentClass", () => {
    it("filters by market, treatmentClass, status='active' and orders correctly", async () => {
      prisma.creatorIdentitySynthetic.findMany.mockResolvedValue([dbRow()]);
      const result = await reader.findByMarketAndTreatmentClass("SG", "med_spa");

      expect(result).toHaveLength(1);
      const call = prisma.creatorIdentitySynthetic.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        market: "SG",
        treatmentClass: "med_spa",
        status: "active",
        creatorIdentity: { isActive: true },
      });
      expect(call?.orderBy).toEqual([{ pricePositioning: "desc" }, { creatorIdentityId: "asc" }]);
    });

    it("returns empty array when no matches", async () => {
      prisma.creatorIdentitySynthetic.findMany.mockResolvedValue([]);
      const result = await reader.findByMarketAndTreatmentClass("HK", "dental");
      expect(result).toEqual([]);
    });

    it("excludes synthetic rows whose parent CreatorIdentity is inactive (via isActive: true filter)", async () => {
      prisma.creatorIdentitySynthetic.findMany.mockResolvedValue([]);
      await reader.findByMarketAndTreatmentClass("SG", "med_spa");

      const call = prisma.creatorIdentitySynthetic.findMany.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        creatorIdentity: { isActive: true },
      });
    });
  });

  describe("listAll", () => {
    it("returns all rows parsed and ordered by creatorIdentityId asc", async () => {
      prisma.creatorIdentitySynthetic.findMany.mockResolvedValue([
        dbRow(),
        dbRow({ creatorIdentityId: "cid_sp11_test_002" }),
      ]);
      const result = await reader.listAll();

      expect(result).toHaveLength(2);
      const call = prisma.creatorIdentitySynthetic.findMany.mock.calls[0]?.[0];
      expect(call?.orderBy).toEqual({ creatorIdentityId: "asc" });
    });
  });
});
