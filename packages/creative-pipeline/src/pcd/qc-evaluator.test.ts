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
        identitySnapshot: makeSnapshot({ avatarTierAtGeneration: 1, productTierAtGeneration: 1 }),
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
