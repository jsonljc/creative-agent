// SP12 license gate — table-driven tests across the three lock-types.
// The gate is a pure function; tests inject snapshot leases directly,
// no DB / Prisma anywhere in this file (an SP12 anti-pattern test
// asserts this structurally).
import { describe, expect, it } from "vitest";
import type { CreatorIdentityLicensePayload } from "@creativeagent/schemas";
import {
  licenseGate,
  PCD_LICENSE_GATE_VERSION,
  type LicenseGateDecision,
  type LicenseGateInput,
} from "./license-gate.js";

const NOW = new Date("2026-05-15T00:00:00.000Z");

const makeLease = (
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload => ({
  id: "lic_test_default",
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
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

const baseInput = (
  leases: readonly CreatorIdentityLicensePayload[],
  overrides: Partial<LicenseGateInput> = {},
): LicenseGateInput => ({
  creatorIdentityId: "cid_synth_cheryl_sg_01",
  clinicId: "clinic_a",
  market: "SG",
  treatmentClass: "med_spa",
  now: NOW,
  leases,
  ...overrides,
});

describe("licenseGate — version pin", () => {
  it("exposes a stable version constant", () => {
    expect(PCD_LICENSE_GATE_VERSION).toBe("license-gate@1.0.0");
  });
});

describe("licenseGate — no_lease", () => {
  it("blocks when there are no leases at all on the scope", () => {
    const decision = licenseGate(baseInput([]));
    expect(decision).toEqual({
      allowed: false,
      license: null,
      reason: "no_lease",
    } satisfies LicenseGateDecision);
  });

  it("blocks when leases exist on the creator but for other clinics only", () => {
    const decision = licenseGate(
      baseInput([makeLease({ id: "lic_other", clinicId: "clinic_b", lockType: "priority_access" })]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_lease");
  });
});

describe("licenseGate — expired / suspended", () => {
  it("returns reason='expired' when this clinic's lease has effectiveTo <= now", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-05-01T00:00:00.000Z"), // before NOW
          status: "active",
        }),
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("expired");
  });

  it("returns reason='suspended' when this clinic's lease has status='suspended'", () => {
    const decision = licenseGate(
      baseInput([makeLease({ id: "lic_susp", status: "suspended" })]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("suspended");
  });

  it("expired beats suspended when both are present (most-recent-failure wins)", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_susp", status: "suspended" }),
        makeLease({
          id: "lic_expired",
          effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-05-01T00:00:00.000Z"),
          status: "active",
        }),
      ]),
    );
    expect(decision.reason).toBe("expired");
  });
});

describe("licenseGate — hard_exclusive", () => {
  it("allows the holder of the hard_exclusive lease", () => {
    const lease = makeLease({ lockType: "hard_exclusive", priorityRank: null });
    const decision = licenseGate(baseInput([lease]));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe(lease.id);
      expect(decision.reason).toBe("active_lease");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });

  it("blocks a competing clinic when another clinic holds an active hard_exclusive on the same scope", () => {
    const competing = makeLease({
      id: "lic_competing_hard",
      clinicId: "clinic_b",
      lockType: "hard_exclusive",
      priorityRank: null,
    });
    const decision = licenseGate(baseInput([competing]));
    expect(decision).toEqual({
      allowed: false,
      license: null,
      reason: "blocked_by_hard_exclusive",
    } satisfies LicenseGateDecision);
  });

  it("blocks even when the requesting clinic also holds a priority_access lease on the same scope", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({
          id: "lic_competing_hard",
          clinicId: "clinic_b",
          lockType: "hard_exclusive",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.reason).toBe("blocked_by_hard_exclusive");
  });

  it("does NOT block when the competing hard_exclusive is suspended or out-of-window", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({
          id: "lic_competing_hard_susp",
          clinicId: "clinic_b",
          lockType: "hard_exclusive",
          status: "suspended",
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_mine_priority");
  });
});

describe("licenseGate — priority_access", () => {
  it("allows multiple concurrent priority_access holders (no blocking)", () => {
    const a = makeLease({ id: "lic_a", clinicId: "clinic_a", lockType: "priority_access", priorityRank: 0 });
    const b = makeLease({ id: "lic_b", clinicId: "clinic_b", lockType: "priority_access", priorityRank: 1 });
    const decisionA = licenseGate(baseInput([a, b]));
    const decisionB = licenseGate(baseInput([a, b], { clinicId: "clinic_b" }));
    expect(decisionA.allowed).toBe(true);
    expect(decisionB.allowed).toBe(true);
    if (decisionA.allowed) expect(decisionA.license.id).toBe("lic_a");
    if (decisionB.allowed) expect(decisionB.license.id).toBe("lic_b");
  });

  it("when the same clinic holds multiple priority_access leases, picks the lowest priorityRank", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_high", lockType: "priority_access", priorityRank: 5 }),
        makeLease({ id: "lic_low", lockType: "priority_access", priorityRank: 0 }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_low");
  });

  it("hard_exclusive trumps priority_access when both belong to the requesting clinic", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_priority", lockType: "priority_access", priorityRank: 0 }),
        makeLease({ id: "lic_hard", lockType: "hard_exclusive", priorityRank: null }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.license.id).toBe("lic_hard");
  });
});

describe("licenseGate — soft_exclusive (override semantics)", () => {
  it("allows the sole soft_exclusive holder without an override flag", () => {
    const lease = makeLease({
      id: "lic_soft_solo",
      lockType: "soft_exclusive",
      priorityRank: null,
    });
    const decision = licenseGate(baseInput([lease]));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe("lic_soft_solo");
      expect(decision.isSoftExclusivityOverride).toBe(false);
    }
  });

  it("flags isSoftExclusivityOverride=true when another clinic also holds an active soft_exclusive", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_soft", lockType: "soft_exclusive", priorityRank: null }),
        makeLease({
          id: "lic_other_soft",
          clinicId: "clinic_b",
          lockType: "soft_exclusive",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.license.id).toBe("lic_mine_soft");
      expect(decision.isSoftExclusivityOverride).toBe(true);
    }
  });

  it("does not flag override when the other clinic's soft_exclusive is expired / suspended", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_mine_soft", lockType: "soft_exclusive", priorityRank: null }),
        makeLease({
          id: "lic_other_soft_susp",
          clinicId: "clinic_b",
          lockType: "soft_exclusive",
          status: "suspended",
          priorityRank: null,
        }),
      ]),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.isSoftExclusivityOverride).toBe(false);
  });
});

describe("licenseGate — scope filtering (defensive)", () => {
  it("ignores leases whose creatorIdentityId / market / treatmentClass do not match the input scope", () => {
    const decision = licenseGate(
      baseInput([
        makeLease({ id: "lic_wrong_creator", creatorIdentityId: "cid_synth_other_99" }),
        makeLease({ id: "lic_wrong_market", market: "MY" }),
        makeLease({ id: "lic_wrong_treatment", treatmentClass: "dental" }),
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_lease");
  });
});

describe("licenseGate — determinism", () => {
  it("produces the same decision regardless of input lease order", () => {
    const a = makeLease({ id: "lic_a", lockType: "priority_access", priorityRank: 5 });
    const b = makeLease({ id: "lic_b", lockType: "priority_access", priorityRank: 0 });
    const c = makeLease({ id: "lic_c", lockType: "priority_access", priorityRank: 1 });

    const decision1 = licenseGate(baseInput([a, b, c]));
    const decision2 = licenseGate(baseInput([c, a, b]));
    const decision3 = licenseGate(baseInput([b, c, a]));

    expect(decision1).toEqual(decision2);
    expect(decision2).toEqual(decision3);
    if (decision1.allowed) expect(decision1.license.id).toBe("lic_b");
  });
});
