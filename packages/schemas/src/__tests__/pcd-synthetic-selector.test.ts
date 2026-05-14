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

  it("performanceOverlayApplied: false literal rejects true", () => {
    const bad = { ...validSuccess, performanceOverlayApplied: true };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(bad)).toThrow();
  });

  it("metricsSnapshotVersion is strict z.null() in SP13 — rejects any string", () => {
    const withNull = { ...validSuccess, metricsSnapshotVersion: null };
    expect(
      SyntheticCreatorSelectionDecisionSchema.parse(withNull).metricsSnapshotVersion,
    ).toBeNull();

    const withStr = { ...validSuccess, metricsSnapshotVersion: "snap@2026-05-14" };
    expect(() => SyntheticCreatorSelectionDecisionSchema.parse(withStr)).toThrow();
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
