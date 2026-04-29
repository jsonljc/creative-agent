import { describe, expect, it } from "vitest";
import {
  PcdRoutingDecisionReasonSchema,
  type PcdRoutingDecisionReason,
  PcdSp4IdentitySnapshotInputSchema,
  PcdIdentitySnapshotSchema,
} from "../pcd-identity.js";

describe("PcdRoutingDecisionReasonSchema", () => {
  const valid: PcdRoutingDecisionReason = {
    capabilityRefIndex: 0,
    matchedShotType: "simple_ugc",
    matchedEffectiveTier: 2,
    matchedOutputIntent: "final_export",
    tier3RulesApplied: [],
    candidatesEvaluated: 3,
    candidatesAfterTier3Filter: 3,
    selectionRationale: "Tier 2 simple_ugc final_export — first matrix match",
  };

  it("accepts a well-formed reason", () => {
    expect(() => PcdRoutingDecisionReasonSchema.parse(valid)).not.toThrow();
  });

  it("rejects matchedEffectiveTier outside 1|2|3", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, matchedEffectiveTier: 4 }),
    ).toThrow();
  });

  it("rejects negative capabilityRefIndex", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, capabilityRefIndex: -1 }),
    ).toThrow();
  });

  it("rejects selectionRationale longer than 200 chars", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({ ...valid, selectionRationale: "x".repeat(201) }),
    ).toThrow();
  });

  it("accepts the three legal tier3RulesApplied values and rejects others", () => {
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({
        ...valid,
        tier3RulesApplied: [
          "first_last_frame_anchor",
          "performance_transfer",
          "edit_over_regenerate",
        ],
      }),
    ).not.toThrow();
    expect(() =>
      PcdRoutingDecisionReasonSchema.parse({
        ...valid,
        tier3RulesApplied: ["bogus_rule"],
      }),
    ).toThrow();
  });
});

describe("PcdSp4IdentitySnapshotInputSchema", () => {
  const validInput = {
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "abc123",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    selectedProvider: "kling",
    providerModelSnapshot: "kling-v2.0",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@1.0.0",
    routerVersion: "provider-router@1.0.0",
    routingDecisionReason: {
      capabilityRefIndex: 0,
      matchedShotType: "simple_ugc" as const,
      matchedEffectiveTier: 2 as const,
      matchedOutputIntent: "final_export" as const,
      tier3RulesApplied: [],
      candidatesEvaluated: 1,
      candidatesAfterTier3Filter: 1,
      selectionRationale: "test",
    },
  };

  it("accepts a complete writer input", () => {
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(validInput)).not.toThrow();
  });

  it("rejects missing shotSpecVersion (required for SP4 writes)", () => {
    const { shotSpecVersion: _shotSpecVersion, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing routerVersion", () => {
    const { routerVersion: _routerVersion, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("rejects missing routingDecisionReason", () => {
    const { routingDecisionReason: _routingDecisionReason, ...rest } = validInput;
    expect(() => PcdSp4IdentitySnapshotInputSchema.parse(rest)).toThrow();
  });

  it("does not accept policyVersion or providerCapabilityVersion as input keys", () => {
    // Strict-mode-ish check: writer pins these from imports. The schema must
    // not declare them; we assert by parsing with extras and confirming the
    // result type does not surface them. Zod by default strips unknown keys;
    // this test documents intent and locks the key set.
    const parsed = PcdSp4IdentitySnapshotInputSchema.parse({
      ...validInput,
      policyVersion: "should-be-stripped",
      providerCapabilityVersion: "should-be-stripped",
    } as unknown);
    expect("policyVersion" in parsed).toBe(false);
    expect("providerCapabilityVersion" in parsed).toBe(false);
  });
});

describe("PcdIdentitySnapshotSchema (SP4 widening)", () => {
  const baseRow = {
    id: "snap-1",
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2 as const,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "abc123",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2 as const,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    policyVersion: "tier-policy@1.0.0",
    providerCapabilityVersion: "provider-capability@1.0.0",
    selectedProvider: "kling",
    providerModelSnapshot: "kling-v2.0",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    createdAt: new Date(),
  };

  it("accepts a row with all SP4 fields NULL (pre-SP4 historical)", () => {
    expect(() =>
      PcdIdentitySnapshotSchema.parse({
        ...baseRow,
        shotSpecVersion: null,
        routerVersion: null,
        routingDecisionReason: null,
      }),
    ).not.toThrow();
  });

  it("accepts a row with SP4 fields populated", () => {
    expect(() =>
      PcdIdentitySnapshotSchema.parse({
        ...baseRow,
        shotSpecVersion: "shot-spec@1.0.0",
        routerVersion: "provider-router@1.0.0",
        routingDecisionReason: {
          capabilityRefIndex: 0,
          matchedShotType: "simple_ugc",
          matchedEffectiveTier: 2,
          matchedOutputIntent: "final_export",
          tier3RulesApplied: [],
          candidatesEvaluated: 1,
          candidatesAfterTier3Filter: 1,
          selectionRationale: "test",
        },
      }),
    ).not.toThrow();
  });
});
