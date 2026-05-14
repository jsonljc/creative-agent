import { describe, expect, it } from "vitest";
import {
  LockTypeSchema,
  LeaseStatusSchema,
  ExclusivityScopeSchema,
  CreatorIdentityLicensePayloadSchema,
  type CreatorIdentityLicensePayload,
} from "../creator-identity-license.js";

describe("LockTypeSchema", () => {
  it("accepts the three v1 lock types", () => {
    for (const t of ["hard_exclusive", "priority_access", "soft_exclusive"]) {
      expect(LockTypeSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown lock types", () => {
    expect(() => LockTypeSchema.parse("exclusive")).toThrow();
    expect(() => LockTypeSchema.parse("")).toThrow();
  });
});

describe("LeaseStatusSchema", () => {
  it("accepts the four v1 lease statuses", () => {
    for (const s of ["active", "suspended", "expired", "superseded"]) {
      expect(LeaseStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown statuses", () => {
    expect(() => LeaseStatusSchema.parse("cancelled")).toThrow();
  });
});

describe("ExclusivityScopeSchema", () => {
  it("accepts market_treatment (B-tier) and free (D-tier)", () => {
    expect(ExclusivityScopeSchema.parse("market_treatment")).toBe("market_treatment");
    expect(ExclusivityScopeSchema.parse("free")).toBe("free");
  });
});

describe("CreatorIdentityLicensePayloadSchema", () => {
  const valid: CreatorIdentityLicensePayload = {
    id: "lic_test_01",
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
  };

  it("accepts a fully populated priority_access lease", () => {
    expect(CreatorIdentityLicensePayloadSchema.parse(valid)).toEqual(valid);
  });

  it("accepts a hard_exclusive lease without priorityRank", () => {
    const hard: CreatorIdentityLicensePayload = {
      ...valid,
      lockType: "hard_exclusive",
      priorityRank: null,
    };
    expect(CreatorIdentityLicensePayloadSchema.parse(hard)).toEqual(hard);
  });

  it("accepts a soft_exclusive lease without priorityRank", () => {
    const soft: CreatorIdentityLicensePayload = {
      ...valid,
      lockType: "soft_exclusive",
      priorityRank: null,
    };
    expect(CreatorIdentityLicensePayloadSchema.parse(soft)).toEqual(soft);
  });

  it("accepts an indefinite lease (effectiveTo = null)", () => {
    expect(
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, effectiveTo: null }),
    ).toBeDefined();
  });

  it("rejects a lease with effectiveTo earlier than effectiveFrom", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({
        ...valid,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });

  it("rejects a priority_access lease with negative priorityRank", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, priorityRank: -1 }),
    ).toThrow();
  });

  it("rejects empty creatorIdentityId / clinicId / id", () => {
    expect(() => CreatorIdentityLicensePayloadSchema.parse({ ...valid, id: "" })).toThrow();
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, creatorIdentityId: "" }),
    ).toThrow();
    expect(() => CreatorIdentityLicensePayloadSchema.parse({ ...valid, clinicId: "" })).toThrow();
  });

  it("rejects unknown market / treatmentClass values (delegates to SP11 enums)", () => {
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, market: "JP" as never }),
    ).toThrow();
    expect(() =>
      CreatorIdentityLicensePayloadSchema.parse({ ...valid, treatmentClass: "slimming" as never }),
    ).toThrow();
  });
});

import * as barrel from "../index.js";

describe("schemas package barrel — SP12 surface", () => {
  it("re-exports the SP12 license schemas + types", () => {
    expect(barrel.LockTypeSchema).toBeDefined();
    expect(barrel.LeaseStatusSchema).toBeDefined();
    expect(barrel.ExclusivityScopeSchema).toBeDefined();
    expect(barrel.CreatorIdentityLicensePayloadSchema).toBeDefined();
  });
});
