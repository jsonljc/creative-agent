import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityLicenseReader } from "../prisma-creator-identity-license-reader.js";

function createMockPrisma() {
  return {
    creatorIdentityLicense: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  id: "lic_sp12_test_001",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_test_01",
  market: "SG",
  treatmentClass: "med_spa",
  lockType: "priority_access",
  exclusivityScope: "market_treatment",
  effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-05-31T00:00:00.000Z"),
  priorityRank: 0,
  status: "active",
  ...overrides,
});

describe("PrismaCreatorIdentityLicenseReader", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let reader: PrismaCreatorIdentityLicenseReader;

  beforeEach(() => {
    prisma = createMockPrisma();
    reader = new PrismaCreatorIdentityLicenseReader(prisma as never);
  });

  describe("findById", () => {
    it("returns the parsed payload when row exists", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(dbRow());
      const result = await reader.findById("lic_sp12_test_001");
      expect(result?.id).toBe("lic_sp12_test_001");
      expect(result?.lockType).toBe("priority_access");
    });

    it("returns null when no row found", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(null);
      expect(await reader.findById("lic_missing")).toBeNull();
    });

    it("throws when the row fails zod validation (data corruption guard)", async () => {
      prisma.creatorIdentityLicense.findUnique.mockResolvedValue(dbRow({ lockType: "garbage" }));
      await expect(reader.findById("lic_sp12_test_001")).rejects.toThrow();
    });
  });

  describe("findActiveByCreatorAndScope", () => {
    it("filters by (creatorIdentityId, market, treatmentClass), status='active', and effectiveFrom <= now < effectiveTo", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([dbRow()]);
      const now = new Date("2026-05-15T00:00:00.000Z");
      const result = await reader.findActiveByCreatorAndScope(
        "cid_synth_cheryl_sg_01",
        "SG",
        "med_spa",
        now,
      );

      expect(result).toHaveLength(1);
      const call = prisma.creatorIdentityLicense.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        market: "SG",
        treatmentClass: "med_spa",
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      });
    });

    it("returns empty array when no matches", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([]);
      const result = await reader.findActiveByCreatorAndScope(
        "cid_missing",
        "SG",
        "med_spa",
        new Date(),
      );
      expect(result).toEqual([]);
    });
  });

  describe("findAllByCreatorAndScope", () => {
    it("returns rows regardless of status or window — used for diagnostics / lifecycle ops", async () => {
      prisma.creatorIdentityLicense.findMany.mockResolvedValue([
        dbRow(),
        dbRow({ id: "lic_sp12_test_002", status: "expired" }),
      ]);
      const result = await reader.findAllByCreatorAndScope(
        "cid_synth_cheryl_sg_01",
        "SG",
        "med_spa",
      );

      expect(result).toHaveLength(2);
      const call = prisma.creatorIdentityLicense.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        market: "SG",
        treatmentClass: "med_spa",
      });
      expect(call?.orderBy).toEqual([{ effectiveFrom: "asc" }, { id: "asc" }]);
    });
  });
});

describe("findActiveByClinicAndScope", () => {
  it("returns active leases for the clinic+market+treatmentClass scope at `now`, excluding revoked and out-of-window rows", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const before = new Date("2026-04-01T00:00:00.000Z");
    const after = new Date("2026-06-30T00:00:00.000Z");
    const longPast = new Date("2025-01-01T00:00:00.000Z");
    const longPastEnd = new Date("2025-12-31T00:00:00.000Z");

    const clinicId = "clinic_sp21_a";
    const otherClinicId = "clinic_sp21_b";

    // Two creators in scope, plus rows that should NOT match.
    const mockPrisma = {
      creatorIdentityLicense: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    };

    mockPrisma.creatorIdentityLicense.findMany.mockResolvedValue([
      // Match #1: active, in-window, target scope, target clinic.
      {
        id: "lic_match_1",
        creatorIdentityId: "cid_sp21_alpha",
        clinicId,
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "priority_access",
        exclusivityScope: "market_treatment",
        effectiveFrom: before,
        effectiveTo: after,
        priorityRank: 1,
        status: "active",
      },
      // Match #2: active, open-ended (effectiveTo null), target scope, target clinic.
      {
        id: "lic_match_2",
        creatorIdentityId: "cid_sp21_beta",
        clinicId,
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "soft_exclusive",
        exclusivityScope: "market_treatment",
        effectiveFrom: before,
        effectiveTo: null,
        priorityRank: null,
        status: "active",
      },
    ]);

    const reader = new PrismaCreatorIdentityLicenseReader(mockPrisma as never);
    const rows = await reader.findActiveByClinicAndScope(clinicId, "SG", "med_spa", now);

    expect(rows.map((r) => r.id).sort()).toEqual(["lic_match_1", "lic_match_2"]);

    // Verify the WHERE clause passed to Prisma enforces all exclusion conditions.
    const call = mockPrisma.creatorIdentityLicense.findMany.mock.calls[0]?.[0];
    expect(call?.where).toEqual({
      clinicId,
      market: "SG",
      treatmentClass: "med_spa",
      status: "active",
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    });

    // Confirm the rejected rows (wrong clinic, wrong market, wrong treatmentClass,
    // revoked, expired) are excluded by the DB-side filter, not fetched at all.
    // Since we mock findMany to return only matches, calling findActiveByClinicAndScope
    // with otherClinicId should yield no results.
    mockPrisma.creatorIdentityLicense.findMany.mockResolvedValue([]);
    const otherClinicRows = await reader.findActiveByClinicAndScope(
      otherClinicId,
      "SG",
      "med_spa",
      now,
    );
    expect(otherClinicRows).toEqual([]);
    const otherCall = mockPrisma.creatorIdentityLicense.findMany.mock.calls[1]?.[0];
    expect(otherCall?.where.clinicId).toBe(otherClinicId);

    void longPast;
    void longPastEnd;
  });
});
