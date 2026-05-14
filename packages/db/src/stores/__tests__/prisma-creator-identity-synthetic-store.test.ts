import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentitySyntheticStore } from "../prisma-creator-identity-synthetic-store.js";
import type { CreatorIdentitySyntheticPayload } from "@creativeagent/schemas";

function createMockPrisma() {
  return {
    creatorIdentitySynthetic: {
      upsert: vi.fn(),
    },
  };
}

const validPayload = (
  overrides: Partial<CreatorIdentitySyntheticPayload> = {},
): CreatorIdentitySyntheticPayload => ({
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

describe("PrismaCreatorIdentitySyntheticStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreatorIdentitySyntheticStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreatorIdentitySyntheticStore(prisma as never);
  });

  describe("create", () => {
    it("upserts a synthetic payload via Prisma", async () => {
      const payload = validPayload();
      await store.create(payload);

      expect(prisma.creatorIdentitySynthetic.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.creatorIdentitySynthetic.upsert.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ creatorIdentityId: "cid_sp11_test_001" });
      expect(call?.create.dallePromptLocked).toBe("Vertical lo-fi selfie photo. Test prompt.");
      expect(call?.create.treatmentClass).toBe("med_spa");
      expect(call?.update.vibe).toBe("omg_look");
    });

    it("validates the payload via zod and rejects invalid input", async () => {
      await expect(store.create({ ...validPayload(), dallePromptLocked: "" })).rejects.toThrow();
      expect(prisma.creatorIdentitySynthetic.upsert).not.toHaveBeenCalled();
    });

    it("passes mutuallyExclusiveWithIds through as a fresh array (not the readonly reference)", async () => {
      const payload = validPayload({ mutuallyExclusiveWithIds: ["cid_other_01", "cid_other_02"] });
      await store.create(payload);

      const call = prisma.creatorIdentitySynthetic.upsert.mock.calls[0]?.[0];
      expect(call?.create.mutuallyExclusiveWithIds).toEqual(["cid_other_01", "cid_other_02"]);
      // The store should pass a writable array to Prisma, not the readonly source.
      expect(Object.isFrozen(call?.create.mutuallyExclusiveWithIds)).toBe(false);
    });
  });
});
