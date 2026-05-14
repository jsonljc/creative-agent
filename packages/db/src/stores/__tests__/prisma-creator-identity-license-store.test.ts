import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityLicenseStore } from "../prisma-creator-identity-license-store.js";
import type { CreatorIdentityLicensePayload } from "@creativeagent/schemas";

function createMockPrisma() {
  return {
    creatorIdentityLicense: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
}

const validInput = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
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

describe("PrismaCreatorIdentityLicenseStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreatorIdentityLicenseStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreatorIdentityLicenseStore(prisma as never);
  });

  describe("create", () => {
    it("upserts a license payload via Prisma", async () => {
      const payload = validInput();
      await store.create(payload);

      expect(prisma.creatorIdentityLicense.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.creatorIdentityLicense.upsert.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ id: "lic_sp12_test_001" });
      expect(call?.create.creatorIdentityId).toBe("cid_synth_cheryl_sg_01");
      expect(call?.create.clinicId).toBe("clinic_test_01");
      expect(call?.create.lockType).toBe("priority_access");
      expect(call?.update.lockType).toBe("priority_access");
    });

    it("validates the payload via zod and rejects invalid input", async () => {
      await expect(store.create({ ...validInput(), id: "" })).rejects.toThrow();
      expect(prisma.creatorIdentityLicense.upsert).not.toHaveBeenCalled();
    });

    it("applies the 30-day default for effectiveTo when input.effectiveTo is omitted from the convenience helper", async () => {
      const { withDefaultLeaseWindow } = await import(
        "../prisma-creator-identity-license-store.js"
      );
      const filled = withDefaultLeaseWindow({
        id: "lic_sp12_test_002",
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        clinicId: "clinic_test_01",
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "priority_access",
        exclusivityScope: "market_treatment",
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        priorityRank: 0,
        status: "active",
      });
      expect(filled.effectiveTo?.toISOString()).toBe("2026-05-31T00:00:00.000Z");
    });

    it("withDefaultLeaseWindow preserves an explicit null effectiveTo (indefinite lease)", async () => {
      const { withDefaultLeaseWindow } = await import(
        "../prisma-creator-identity-license-store.js"
      );
      const filled = withDefaultLeaseWindow({
        id: "lic_sp12_test_003",
        creatorIdentityId: "cid_synth_cheryl_sg_01",
        clinicId: "clinic_test_01",
        market: "SG",
        treatmentClass: "med_spa",
        lockType: "hard_exclusive",
        exclusivityScope: "market_treatment",
        effectiveFrom: new Date("2026-05-01T00:00:00.000Z"),
        effectiveTo: null,
        priorityRank: null,
        status: "active",
      });
      expect(filled.effectiveTo).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("updates only the status field on a license row", async () => {
      await store.updateStatus("lic_sp12_test_001", "expired");

      expect(prisma.creatorIdentityLicense.update).toHaveBeenCalledWith({
        where: { id: "lic_sp12_test_001" },
        data: { status: "expired" },
      });
    });

    it("rejects an unknown status value via zod", async () => {
      await expect(
        store.updateStatus("lic_sp12_test_001", "cancelled" as never),
      ).rejects.toThrow();
      expect(prisma.creatorIdentityLicense.update).not.toHaveBeenCalled();
    });
  });
});
