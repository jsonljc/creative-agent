import { describe, expect, it, vi } from "vitest";
import type {
  PcdIdentitySnapshot,
  PcdSp5QcLedgerInput,
  ProductQcResult,
} from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";
import type { PcdQcLedgerStore } from "./qc-evaluator.js";
import { evaluatePcdQcResult } from "./qc-evaluator.js";

const makeSnapshot = (overrides: Partial<PcdIdentitySnapshot> = {}): PcdIdentitySnapshot => ({
  id: "snap_1",
  assetRecordId: "asset_1",
  productIdentityId: "prod_1",
  productTierAtGeneration: 3,
  productImageAssetIds: ["img_a"],
  productCanonicalTextHash: "hash_a",
  productLogoAssetId: "logo_1",
  creatorIdentityId: "creator_1",
  avatarTierAtGeneration: 3,
  avatarReferenceAssetIds: ["ref_a", "ref_b"],
  voiceAssetId: null,
  consentRecordId: null,
  policyVersion: "tier-policy@1.0.0",
  providerCapabilityVersion: "provider-capability@1.0.0",
  selectedProvider: "kling",
  providerModelSnapshot: "kling-2",
  seedOrNoSeed: "no-seed",
  rewrittenPromptText: null,
  shotSpecVersion: "shot-spec@1.0.0",
  routerVersion: "provider-router@1.0.0",
  routingDecisionReason: null,
  createdAt: new Date(),
  ...overrides,
});

const makeProviders = () => {
  const scoreFaceSimilarity = vi.fn(async () => ({ score: 0.9 }));
  const scoreLogoSimilarity = vi.fn(async () => ({ score: 0.9 }));
  const extractText = vi.fn(async () => ({ text: "Acme Hot Sauce 8oz" }));
  const measure = vi.fn(async () => ({ score: 0.9, scaleConfidence: 0.85 }));
  const providers: PcdQcProviders = {
    similarityProvider: { scoreFaceSimilarity, scoreLogoSimilarity },
    ocrProvider: { extractText },
    geometryProvider: { measure },
  };
  return { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure };
};

const makeStore = () => {
  const calls: PcdSp5QcLedgerInput[] = [];
  const fakeRow = (input: PcdSp5QcLedgerInput): ProductQcResult => ({
    id: "qc_row_1",
    productIdentityId: input.productIdentityId,
    assetRecordId: input.assetRecordId,
    creatorIdentityId: input.creatorIdentityId,
    pcdIdentitySnapshotId: input.pcdIdentitySnapshotId,
    logoSimilarityScore: input.logoSimilarityScore,
    packageOcrMatchScore: input.packageOcrMatchScore,
    colorDeltaScore: input.colorDeltaScore,
    geometryMatchScore: input.geometryMatchScore,
    scaleConfidence: input.scaleConfidence,
    faceSimilarityScore: input.faceSimilarityScore,
    passFail: input.passFail,
    warnings: input.warnings,
    gatesRan: input.gatesRan,
    gateVerdicts: input.gateVerdicts,
    qcEvaluationVersion: input.qcEvaluationVersion,
    qcGateMatrixVersion: input.qcGateMatrixVersion,
    createdAt: new Date(),
  });
  const store: PcdQcLedgerStore = {
    createForAsset: async (input) => {
      calls.push(input);
      return fakeRow(input);
    },
  };
  return { store, calls };
};

describe("evaluatePcdQcResult — Tier 1 (zero matrix rows, zero providers called)", () => {
  it("calls no providers and writes empty-gates row with passFail=warn", async () => {
    const { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure } =
      makeProviders();
    const { store, calls } = makeStore();

    const row = await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "simple_ugc",
        effectiveTier: 1,
        // Snapshot tier fields don't govern gate selection — input.effectiveTier does.
        // Default snapshot (Tier 3 fields) is fine here.
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: "logo_1",
        productCanonicalText: "Acme Hot Sauce 8oz",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(scoreFaceSimilarity).not.toHaveBeenCalled();
    expect(scoreLogoSimilarity).not.toHaveBeenCalled();
    expect(extractText).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(calls.length).toBe(1);
    expect(calls[0].gatesRan).toEqual([]);
    expect(calls[0].gateVerdicts.gates).toEqual([]);
    expect(calls[0].passFail).toBe("warn");
    expect(row.passFail).toBe("warn");
  });
});

describe("evaluatePcdQcResult — Tier 3 face_closeup dispatch", () => {
  it("calls scoreFaceSimilarity and persists face gate in gatesRan with creatorIdentityId set", async () => {
    const { providers, scoreFaceSimilarity, scoreLogoSimilarity, extractText, measure } =
      makeProviders();
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(scoreFaceSimilarity).toHaveBeenCalledTimes(1);
    expect(scoreLogoSimilarity).not.toHaveBeenCalled();
    expect(extractText).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(calls.length).toBe(1);
    expect(calls[0].gatesRan).toEqual(["face_similarity"]);
    expect(calls[0].creatorIdentityId).toBe("creator_1");
  });

  it("persists faceSimilarityScore from provider and passFail=pass when score passes threshold", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    // makeProviders() returns score: 0.9, threshold is 0.78, so pass
    expect(calls[0].faceSimilarityScore).toBe(0.9);
    expect(calls[0].passFail).toBe("pass");
    expect(calls[0].gateVerdicts.gates[0]?.status).toBe("pass");
  });
});

describe("evaluatePcdQcResult — mode lowering", () => {
  it("warn_only mode: face gate below threshold → passFail=warn not fail", async () => {
    const { providers, scoreFaceSimilarity } = makeProviders();
    // Return score below threshold (0.78)
    scoreFaceSimilarity.mockResolvedValue({ score: 0.5 });
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        // talking_head + tier 2 → face_similarity with mode: "warn_only"
        shotType: "talking_head",
        effectiveTier: 2 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("warn");
    expect(calls[0].gateVerdicts.gates[0]?.status).toBe("warn");
    expect(calls[0].gateVerdicts.aggregateStatus).toBe("warn");
  });

  it("block mode: face gate below threshold → passFail=fail", async () => {
    const { providers, scoreFaceSimilarity } = makeProviders();
    // Return score below threshold (0.78)
    scoreFaceSimilarity.mockResolvedValue({ score: 0.5 });
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        // face_closeup + tier 3 → face_similarity with mode: "block"
        shotType: "face_closeup",
        effectiveTier: 3 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("fail");
    expect(calls[0].gateVerdicts.gates[0]?.status).toBe("fail");
    expect(calls[0].gateVerdicts.aggregateStatus).toBe("fail");
  });
});

describe("evaluatePcdQcResult — provider-error obeys mode", () => {
  it("provider throws in warn_only mode → passFail=warn, faceSimilarityScore=null", async () => {
    const { providers, scoreFaceSimilarity } = makeProviders();
    scoreFaceSimilarity.mockRejectedValue(new Error("boom"));
    const { store, calls } = makeStore();

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        // talking_head + tier 2 → face_similarity with mode: "warn_only"
        shotType: "talking_head",
        effectiveTier: 2 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].passFail).toBe("warn");
    expect(calls[0].faceSimilarityScore).toBeNull();
    expect(calls[0].gateVerdicts.gates[0]?.status).toBe("warn");
    expect(calls[0].gateVerdicts.gates[0]?.reason).toMatch(/provider error.*boom/);
  });
});
