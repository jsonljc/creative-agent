import { describe, expect, it } from "vitest";
import {
  SyntheticCreatorSelectionDecisionSchema,
  SyntheticCreatorSelectorRejectionReasonSchema,
  type SyntheticCreatorSelectionDecision,
} from "../pcd-synthetic-selector.js";

const validSuccess: SyntheticCreatorSelectionDecision = {
  allowed: true,
  briefId: "brief_test_01",
  selectedCreatorIdentityId: "cid_synth_cheryl_sg_01",
  fallbackCreatorIdentityIds: ["cid_synth_felicia_my_03"] as const,
  selectedLicenseId: "lic_test_01",
  selectedLockType: "priority_access",
  isSoftExclusivityOverride: false,
  selectorVersion: "pcd-selector@1.0.0",
  selectorRank: 0,
  metricsSnapshotVersion: null,
  performanceOverlayApplied: false,
  decisionReason: "primary_compatible (1 survivor, 1 fallback)",
};

const validRejection = {
  allowed: false as const,
  briefId: "brief_test_02",
  reason: "no_compatible_candidates" as const,
  compatibleCandidateIds: [] as const,
  blockedCandidateIds: [] as const,
  selectorVersion: "pcd-selector@1.0.0",
};

describe("SyntheticCreatorSelectorRejectionReasonSchema", () => {
  it("accepts the two SP13 reasons", () => {
    expect(SyntheticCreatorSelectorRejectionReasonSchema.parse("no_compatible_candidates")).toBe(
      "no_compatible_candidates",
    );
    expect(SyntheticCreatorSelectorRejectionReasonSchema.parse("all_blocked_by_license")).toBe(
      "all_blocked_by_license",
    );
  });

  it("rejects unknown reasons", () => {
    expect(() => SyntheticCreatorSelectorRejectionReasonSchema.parse("other")).toThrow();
  });
});

describe("SyntheticCreatorSelectionDecisionSchema", () => {
  it("round-trips a success decision", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse(validSuccess);
    expect(parsed).toEqual(validSuccess);
  });

  it("round-trips a rejection decision", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse(validRejection);
    expect(parsed).toEqual(validRejection);
  });

  it("discriminator routes by `allowed`: success requires selectedCreatorIdentityId", () => {
    const broken = { ...validSuccess, selectedCreatorIdentityId: undefined };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(broken)).toThrow();
  });

  it("discriminator routes by `allowed`: rejection requires reason", () => {
    const broken = { ...validRejection, reason: undefined };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(broken)).toThrow();
  });

  it("selectorRank: 0 literal rejects 1", () => {
    const bad = { ...validSuccess, selectorRank: 1 };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("performanceOverlayApplied: SP20 widened to z.boolean() — accepts true and false", () => {
    expect(
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...validSuccess,
        performanceOverlayApplied: false,
      }).performanceOverlayApplied,
    ).toBe(false);
    expect(
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...validSuccess,
        performanceOverlayApplied: true,
      }).performanceOverlayApplied,
    ).toBe(true);
  });

  it("metricsSnapshotVersion: SP20 widened to z.string().min(1).nullable() — accepts null and non-empty string, rejects empty string", () => {
    expect(
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...validSuccess,
        metricsSnapshotVersion: null,
      }).metricsSnapshotVersion,
    ).toBeNull();

    expect(
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...validSuccess,
        metricsSnapshotVersion: "snap@2026-05-14",
      }).metricsSnapshotVersion,
    ).toBe("snap@2026-05-14");

    expect(() =>
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...validSuccess,
        metricsSnapshotVersion: "",
      }),
    ).toThrow();
  });

  it("decisionReason max length is 2000", () => {
    const bad = { ...validSuccess, decisionReason: "x".repeat(2001) };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("fallbackCreatorIdentityIds may be empty", () => {
    const empty = { ...validSuccess, fallbackCreatorIdentityIds: [] as const };
    expect(SyntheticCreatorSelectionDecisionSchema.parse(empty).fallbackCreatorIdentityIds).toEqual(
      [],
    );
  });
});

describe("SyntheticCreatorSelectionDecisionSchema (SP20-widened slots)", () => {
  const successBase = {
    allowed: true as const,
    briefId: "brief-1",
    selectedCreatorIdentityId: "creator-A",
    fallbackCreatorIdentityIds: [] as readonly string[],
    selectedLicenseId: "license-1",
    selectedLockType: "hard_exclusive" as const,
    isSoftExclusivityOverride: false,
    selectorVersion: "pcd-selector@1.0.0",
    selectorRank: 0 as const,
    decisionReason: "primary_compatible (1 survivor, 0 license-blocked)",
  };

  it("accepts metricsSnapshotVersion as a non-empty string", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
      ...successBase,
      metricsSnapshotVersion: "pcd-performance-overlay@1.0.0",
      performanceOverlayApplied: true,
    });
    expect(parsed).toBeDefined();
  });

  it("accepts metricsSnapshotVersion as null", () => {
    const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
      ...successBase,
      metricsSnapshotVersion: null,
      performanceOverlayApplied: false,
    });
    expect(parsed).toBeDefined();
  });

  it("rejects metricsSnapshotVersion as an empty string", () => {
    expect(() =>
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        metricsSnapshotVersion: "",
        performanceOverlayApplied: true,
      }),
    ).toThrow();
  });

  it("accepts performanceOverlayApplied as true OR false", () => {
    for (const flag of [true, false]) {
      const parsed = SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        metricsSnapshotVersion: flag ? "pcd-performance-overlay@1.0.0" : null,
        performanceOverlayApplied: flag,
      });
      expect(parsed).toBeDefined();
    }
  });

  it("keeps selectorRank locked at the literal 0 (Guardrail J)", () => {
    expect(() =>
      SyntheticCreatorSelectionDecisionSchema.parse({
        ...successBase,
        selectorRank: 1,
        metricsSnapshotVersion: null,
        performanceOverlayApplied: false,
      }),
    ).toThrow();
  });
});
