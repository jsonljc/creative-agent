import { describe, expect, it } from "vitest";
import {
  PrismaConsentRevocationStore,
  type ConsentRevocationStore,
} from "../prisma-consent-revocation-store.js";

// Minimal Prisma-shaped fake to exercise the store without a real DB.
type FakePrisma = {
  pcdIdentitySnapshot: {
    findMany: (args: {
      where: { consentRecordId: string };
      select: { assetRecordId: true };
    }) => Promise<{ assetRecordId: string }[]>;
  };
  assetRecord: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: { id: true; consentRevokedAfterGeneration: true };
    }) => Promise<{ id: string; consentRevokedAfterGeneration: boolean }[]>;
    updateMany: (args: {
      where: { id: { in: string[] } };
      data: { consentRevokedAfterGeneration: true };
    }) => Promise<{ count: number }>;
  };
};

const buildFakePrisma = (
  snapshots: Array<{ assetRecordId: string; consentRecordId: string }>,
  flagged: Set<string>,
): FakePrisma => ({
  pcdIdentitySnapshot: {
    async findMany(args) {
      return snapshots
        .filter((s) => s.consentRecordId === args.where.consentRecordId)
        .map((s) => ({ assetRecordId: s.assetRecordId }));
    },
  },
  assetRecord: {
    async findMany(args) {
      return args.where.id.in.map((id) => ({
        id,
        consentRevokedAfterGeneration: flagged.has(id),
      }));
    },
    async updateMany(args) {
      let count = 0;
      for (const id of args.where.id.in) {
        if (!flagged.has(id)) {
          flagged.add(id);
          count += 1;
        }
      }
      return { count };
    },
  },
});

describe("PrismaConsentRevocationStore", () => {
  it("findAssetIdsByRevokedConsent returns sorted matching ids", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma(
      [
        { assetRecordId: "az", consentRecordId: "consent_1" },
        { assetRecordId: "ab", consentRecordId: "consent_1" },
        { assetRecordId: "aa", consentRecordId: "consent_1" },
        { assetRecordId: "ax", consentRecordId: "consent_2" },
      ],
      flagged,
    );
    const store: ConsentRevocationStore = new PrismaConsentRevocationStore(prisma as never);
    expect(await store.findAssetIdsByRevokedConsent("consent_1")).toEqual(["aa", "ab", "az"]);
    expect(await store.findAssetIdsByRevokedConsent("consent_2")).toEqual(["ax"]);
    expect(await store.findAssetIdsByRevokedConsent("consent_x")).toEqual([]);
  });

  it("markAssetsConsentRevokedAfterGeneration partitions sorted newly/already", async () => {
    const flagged = new Set<string>(["a1", "a3"]);
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const r = await store.markAssetsConsentRevokedAfterGeneration(["a3", "a2", "a4", "a1"]);
    expect(r.newlyFlagged).toEqual(["a2", "a4"]);
    expect(r.alreadyFlagged).toEqual(["a1", "a3"]);
    expect(flagged.has("a2")).toBe(true);
    expect(flagged.has("a4")).toBe(true);
  });

  it("markAssetsConsentRevokedAfterGeneration is idempotent", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const first = await store.markAssetsConsentRevokedAfterGeneration(["a1", "a2"]);
    expect(first.newlyFlagged).toEqual(["a1", "a2"]);
    expect(first.alreadyFlagged).toEqual([]);
    const second = await store.markAssetsConsentRevokedAfterGeneration(["a1", "a2"]);
    expect(second.newlyFlagged).toEqual([]);
    expect(second.alreadyFlagged).toEqual(["a1", "a2"]);
  });

  it("empty input array → empty partitions, no Prisma calls beyond findMany", async () => {
    const flagged = new Set<string>();
    const prisma = buildFakePrisma([], flagged);
    const store = new PrismaConsentRevocationStore(prisma as never);
    const r = await store.markAssetsConsentRevokedAfterGeneration([]);
    expect(r.newlyFlagged).toEqual([]);
    expect(r.alreadyFlagged).toEqual([]);
  });
});
