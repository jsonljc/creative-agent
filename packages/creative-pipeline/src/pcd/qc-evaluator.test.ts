import { readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// T15 — Hard-block invariant, persistence shape, determinism, anti-pattern
//        grep, no-SP6 leakage, forbidden imports.
// ---------------------------------------------------------------------------

describe("evaluatePcdQcResult — hard-block invariant", () => {
  it("block mode + fail → row.passFail is fail (hard-block is enforced)", async () => {
    const { providers, scoreFaceSimilarity } = makeProviders();
    // Score below threshold triggers fail; face_closeup+tier3 is mode:block
    scoreFaceSimilarity.mockResolvedValue({ score: 0.3 });
    const { store, calls } = makeStore();

    const row = await evaluatePcdQcResult(
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

    expect(calls[0].passFail).toBe("fail");
    expect(row.passFail).toBe("fail");
  });

  it("block mode + pass → row.passFail is pass (block mode does not affect passing scores)", async () => {
    const { providers } = makeProviders(); // default score: 0.9, above threshold 0.78
    const { store, calls } = makeStore();

    const row = await evaluatePcdQcResult(
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

    expect(calls[0].passFail).toBe("pass");
    expect(row.passFail).toBe("pass");
  });
});

describe("evaluatePcdQcResult — persistence shape", () => {
  it("createForAsset is called exactly once per evaluation", async () => {
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

    expect(calls.length).toBe(1);
  });

  it("pcdIdentitySnapshotId matches snapshot.id", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();
    const snap = makeSnapshot({ id: "snap_xyz" });

    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "face_closeup",
        effectiveTier: 3 as const,
        identitySnapshot: snap,
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].pcdIdentitySnapshotId).toBe("snap_xyz");
  });

  it("version pins match imported constants", async () => {
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

    expect(calls[0].qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(calls[0].qcGateMatrixVersion).toBe("pcd-qc-gate-matrix@1.0.0");
  });

  it("passFail is derived from gateVerdicts.aggregateStatus", async () => {
    const { providers } = makeProviders(); // pass verdict
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

    expect(calls[0].passFail).toBe(calls[0].gateVerdicts.aggregateStatus);
  });

  it("gatesRan equals gateVerdicts.gates[*].gate in the same order", async () => {
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

    const { gatesRan, gateVerdicts } = calls[0];
    expect(gatesRan).toEqual(gateVerdicts.gates.map((g) => g.gate));
  });

  it("creatorIdentityId is null when face gate did not run", async () => {
    const { providers } = makeProviders();
    const { store, calls } = makeStore();

    // Tier 1: no gates run at all
    await evaluatePcdQcResult(
      {
        assetRecordId: "asset_1",
        shotType: "simple_ugc",
        effectiveTier: 1 as const,
        identitySnapshot: makeSnapshot(),
        productLogoAssetId: null,
        productCanonicalText: null,
        productDimensionsMm: null,
      },
      providers,
      { qcLedgerStore: store },
    );

    expect(calls[0].creatorIdentityId).toBeNull();
  });

  it("returned row is the store's response (fakeRow shape round-trips)", async () => {
    const { providers } = makeProviders();
    const { store } = makeStore();

    const row = await evaluatePcdQcResult(
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

    // fakeRow always sets id to "qc_row_1"
    expect(row.id).toBe("qc_row_1");
    expect(row.passFail).toBeDefined();
  });
});

describe("evaluatePcdQcResult — determinism", () => {
  it("two calls with identical inputs produce deep-equal payloads to the store", async () => {
    const { providers: p1 } = makeProviders();
    const { providers: p2 } = makeProviders();
    const { store: s1, calls: c1 } = makeStore();
    const { store: s2, calls: c2 } = makeStore();

    const inputA = {
      assetRecordId: "asset_det",
      shotType: "face_closeup" as const,
      effectiveTier: 3 as const,
      identitySnapshot: makeSnapshot({ id: "snap_det" }),
      productLogoAssetId: null,
      productCanonicalText: null,
      productDimensionsMm: null,
    };
    const inputB = { ...inputA };

    await evaluatePcdQcResult(inputA, p1, { qcLedgerStore: s1 });
    await evaluatePcdQcResult(inputB, p2, { qcLedgerStore: s2 });

    // Strip createdAt from the compared payload (it's set by fakeRow, not evaluator)
    const strip = (ledger: PcdSp5QcLedgerInput) => ledger;
    expect(strip(c1[0])).toEqual(strip(c2[0]));
  });
});

describe("evaluatePcdQcResult — anti-pattern grep", () => {
  const src = readFileSync(new URL("./qc-evaluator.ts", import.meta.url).pathname, "utf-8");
  // Strip comment lines so grep tests only see live code.
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  it("zero `if (row.gate ===` outside the switch (gate dispatch uses switch, not if-chains)", () => {
    // The switch(row.gate) in runGate is the single allowed dispatch; no
    // if-chain fallback should exist.
    expect(codeOnly).not.toMatch(/if\s*\(\s*row\.gate\s*===/);
  });

  it("zero `if (gate ===` — gate key dispatch must go through switch or verdictByGate", () => {
    expect(codeOnly).not.toMatch(/if\s*\(\s*gate\s*===/);
  });

  it("zero `if (input.shotType ===` — shotType dispatch is owned by the matrix, not the evaluator", () => {
    expect(codeOnly).not.toMatch(/if\s*\(\s*input\.shotType\s*===/);
  });

  it("zero `if (input.effectiveTier ===` — tier dispatch is owned by the matrix, not the evaluator", () => {
    expect(codeOnly).not.toMatch(/if\s*\(\s*input\.effectiveTier\s*===/);
  });

  it("zero `if (effectiveTier ===` — destructured form also forbidden in evaluator", () => {
    expect(codeOnly).not.toMatch(/if\s*\(\s*effectiveTier\s*===/);
  });

  it("zero `if (shotType ===` — destructured form also forbidden in evaluator", () => {
    expect(codeOnly).not.toMatch(/if\s*\(\s*shotType\s*===/);
  });
});

describe("evaluatePcdQcResult — no SP6 leakage (binding)", () => {
  const evalSrc = readFileSync(new URL("./qc-evaluator.ts", import.meta.url), "utf-8");
  const aggSrc = readFileSync(new URL("./qc-aggregator.ts", import.meta.url), "utf-8");

  it("evaluator + aggregator contain zero matches for SP6 surfaces", () => {
    for (const src of [evalSrc, aggSrc]) {
      expect(src).not.toMatch(/approval/i);
      expect(src).not.toMatch(/canApprove/i);
      expect(src).not.toMatch(/WorkTrace/i);
      expect(src).not.toMatch(/outbox/i);
      expect(src).not.toMatch(/ApprovalLifecycle/i);
      expect(src).not.toMatch(/assetRecord\.update/i);
    }
  });
});

describe("evaluatePcdQcResult — forbidden imports", () => {
  it("evaluator does not import from outside the PCD scope (no Switchboard-only modules)", () => {
    const src = readFileSync(new URL("./qc-evaluator.ts", import.meta.url).pathname, "utf-8");
    // No imports from workspace packages other than @creativeagent/schemas and
    // relative ./  imports inside creative-pipeline.
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@switchboard\//);
    expect(src).not.toMatch(/WorkTrace/);
    expect(src).not.toMatch(/PlatformIngress/);
  });
});
