import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { PrismaCreatorIdentitySyntheticStore } from "../prisma-creator-identity-synthetic-store.js";
import { PrismaCreatorIdentitySyntheticReader } from "../prisma-creator-identity-synthetic-reader.js";
import type {
  CreatorIdentitySyntheticPayload,
  SeedanceDirection,
} from "@creativeagent/schemas";

function createMockPrisma() {
  return {
    creatorIdentitySynthetic: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
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

  // SP17 — round-trip seedanceDirection through store write + reader parse.
  // Existing tests in this file mock the Prisma client (no real DB available
  // in the extracted PCD repo). These round-trip tests therefore (a) verify
  // the store sends the right value (or null) to Prisma at the write boundary,
  // and (b) feed that captured value back through the reader's mock to verify
  // the parse path round-trips. This matches the existing mock pattern.
  describe("seedanceDirection (SP17)", () => {
    const reader = (): PrismaCreatorIdentitySyntheticReader =>
      new PrismaCreatorIdentitySyntheticReader(prisma as never);

    it("round-trips seedanceDirection = null (default for back-compat rows)", async () => {
      const id = "ci_sp17_null_seedance_001";
      const payload = makeValidSeedancePayload(id, null);
      await store.create(payload);

      // Write boundary: schema-null becomes Prisma.JsonNull so Postgres writes SQL NULL.
      const call = prisma.creatorIdentitySynthetic.upsert.mock.calls[0]?.[0];
      expect(call?.create.seedanceDirection).toBe(Prisma.JsonNull);

      // Read boundary: Postgres returns JS null for a NULL JSONB column.
      prisma.creatorIdentitySynthetic.findUnique.mockResolvedValue({
        ...call?.create,
        creatorIdentityId: id,
        seedanceDirection: null,
      });
      const row = await reader().findById(id);
      expect(row).not.toBeNull();
      expect(row!.seedanceDirection).toBeNull();
    });

    it("round-trips seedanceDirection populated", async () => {
      const id = "ci_sp17_populated_seedance_001";
      const seedance: SeedanceDirection = {
        setting: "Bright counter",
        motion: "Reveal hand",
        energy: "Warm",
        lighting: "Soft window",
        avoid: ["Cuts"],
      };
      const payload = makeValidSeedancePayload(id, seedance);
      await store.create(payload);

      const call = prisma.creatorIdentitySynthetic.upsert.mock.calls[0]?.[0];
      expect(call?.create.seedanceDirection).toEqual(seedance);

      // Read boundary: Postgres returns the stored object as-is.
      prisma.creatorIdentitySynthetic.findUnique.mockResolvedValue({
        ...call?.create,
        creatorIdentityId: id,
        seedanceDirection: seedance,
      });
      const row = await reader().findById(id);
      expect(row).not.toBeNull();
      expect(row!.seedanceDirection).toEqual(seedance);
    });

    it("normalizes undefined seedanceDirection on write to null in DB", async () => {
      const id = "ci_sp17_undef_seedance_001";
      const payload = makeValidSeedancePayload(id, undefined);
      await store.create(payload);

      const call = prisma.creatorIdentitySynthetic.upsert.mock.calls[0]?.[0];
      // Per design J1: undefined at ingestion becomes Prisma.JsonNull (i.e. SQL NULL)
      // at the DB boundary so the column only ever stores NULL or a structured object.
      expect(call?.create.seedanceDirection).toBe(Prisma.JsonNull);
      expect(call?.update.seedanceDirection).toBe(Prisma.JsonNull);
    });
  });
});

function makeValidSeedancePayload(
  id: string,
  seedanceDirection: SeedanceDirection | null | undefined,
): CreatorIdentitySyntheticPayload {
  const payload: CreatorIdentitySyntheticPayload = {
    creatorIdentityId: id,
    treatmentClass: "med_spa",
    vibe: "quiet_confidence",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_30s_plus",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Oval",
      skinTone: "Fair",
      eyeShape: "Hooded",
      hair: "Shoulder brunette",
      ageRead: "36",
      buildNote: "Slim",
    },
    dallePromptLocked: "Lo-fi photo prompt for SP17 round-trip test.",
    klingDirection: {
      setting: "Dim room",
      motion: "Head turn",
      energy: "Composed",
      lighting: "Warm key",
      avoid: ["Filter"],
    },
    voiceCaptionStyle: {
      voice: "Calm",
      captionStyle: "lowercase",
      sampleHook: "okay so",
      sampleCta: "book it",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  };
  if (seedanceDirection === null) {
    return { ...payload, seedanceDirection: null };
  }
  if (seedanceDirection !== undefined) {
    return { ...payload, seedanceDirection };
  }
  return payload;
}
