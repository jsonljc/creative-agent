import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { PcdSp5QcLedgerInput } from "@creativeagent/schemas";
import { PrismaPcdQcResultStore } from "../prisma-pcd-qc-result-store.js";

// This test follows the SP4 snapshot-store integration test precedent
// (see prisma-pcd-identity-snapshot-store-sp4.test.ts) — uses a real
// Prisma client against the dev database. If this is run in an env
// without a DB, the test should skip via `it.skipIf` rather than fail.

const hasDb = Boolean(process.env.DATABASE_URL);

const happy = (
  productIdentityId: string,
  assetRecordId: string,
  pcdIdentitySnapshotId: string,
  creatorIdentityId: string,
): PcdSp5QcLedgerInput => ({
  assetRecordId,
  productIdentityId,
  pcdIdentitySnapshotId,
  creatorIdentityId,
  qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
  qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
  gateVerdicts: {
    gates: [
      {
        gate: "face_similarity",
        status: "pass",
        score: 0.91,
        threshold: 0.78,
        reason: "face similarity 0.910 >= threshold 0.78",
      },
    ],
    aggregateStatus: "pass",
  },
  gatesRan: ["face_similarity"],
  faceSimilarityScore: 0.91,
  logoSimilarityScore: null,
  packageOcrMatchScore: null,
  geometryMatchScore: null,
  scaleConfidence: null,
  colorDeltaScore: null,
  passFail: "pass",
  warnings: [],
});

describe.skipIf(!hasDb)("PrismaPcdQcResultStore — round-trip", () => {
  let prisma: PrismaClient;
  let store: PrismaPcdQcResultStore;

  beforeAll(async () => {
    prisma = new PrismaClient();
    store = new PrismaPcdQcResultStore(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createForAsset persists all 7 SP5 columns (JSONB round-trip)", async () => {
    // Set up FK rows. Match SP4 snapshot-store test fixture pattern.
    const product = await prisma.productIdentity.create({
      data: { orgId: "org_test_sp5", title: `qc-test-${Date.now()}` },
    });
    const creator = await prisma.creatorIdentity.create({
      data: {
        deploymentId: "dep_test",
        name: "qc-test-creator",
        identityRefIds: [],
        heroImageAssetId: "asset_x",
        identityDescription: "test",
        voice: {},
        personality: {},
        appearanceRules: {},
      },
    });
    const job = await prisma.creativeJob.create({
      data: {
        taskId: `task_${Date.now()}`,
        organizationId: "org_test_sp5",
        deploymentId: "dep_test",
        productDescription: "x",
        targetAudience: "x",
        platforms: [],
        productIdentityId: product.id,
        creatorIdentityId: creator.id,
      },
    });
    const asset = await prisma.assetRecord.create({
      data: {
        jobId: job.id,
        specId: `spec_${Date.now()}`,
        creatorId: creator.id,
        provider: "kling",
        modelId: "kling-2",
        inputHashes: {},
        outputs: {},
      },
    });
    const snapshot = await prisma.pcdIdentitySnapshot.create({
      data: {
        assetRecordId: asset.id,
        productIdentityId: product.id,
        productTierAtGeneration: 3,
        productImageAssetIds: ["img_1"],
        productCanonicalTextHash: "hash_x",
        productLogoAssetId: null,
        creatorIdentityId: creator.id,
        avatarTierAtGeneration: 3,
        avatarReferenceAssetIds: ["ref_1"],
        voiceAssetId: null,
        consentRecordId: null,
        policyVersion: "tier-policy@1.0.0",
        providerCapabilityVersion: "provider-capability@1.0.0",
        selectedProvider: "kling",
        providerModelSnapshot: "kling-2",
        seedOrNoSeed: "no-seed",
        rewrittenPromptText: null,
      },
    });

    const row = await store.createForAsset(happy(product.id, asset.id, snapshot.id, creator.id));

    expect(row.id).toBeTruthy();
    expect(row.creatorIdentityId).toBe(creator.id);
    expect(row.pcdIdentitySnapshotId).toBe(snapshot.id);
    expect(row.faceSimilarityScore).toBeCloseTo(0.91);
    expect(row.gatesRan).toEqual(["face_similarity"]);
    expect(row.qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(row.qcGateMatrixVersion).toBe("pcd-qc-gate-matrix@1.0.0");
    expect(row.gateVerdicts).toBeTruthy();
    expect((row.gateVerdicts as { aggregateStatus: string }).aggregateStatus).toBe("pass");

    // Cleanup: delete in reverse FK order
    await prisma.productQcResult.delete({ where: { id: row.id } });
    await prisma.pcdIdentitySnapshot.delete({ where: { id: snapshot.id } });
    await prisma.assetRecord.delete({ where: { id: asset.id } });
    await prisma.creativeJob.delete({ where: { id: job.id } });
    await prisma.creatorIdentity.delete({ where: { id: creator.id } });
    await prisma.productIdentity.delete({ where: { id: product.id } });
  });

  it("createForAsset round-trips empty gatesRan + null gateVerdicts (Tier 1 shape)", async () => {
    // Mirror Tier 1 case: empty gates array + null verdicts (or empty verdicts).
    // Note: the writer-input schema requires gateVerdicts be present, even if empty,
    // so we pass an empty-gates verdict object — verifying JSONB round-trip of {} -ish data.
    const product = await prisma.productIdentity.create({
      data: { orgId: "org_test_sp5_t1", title: `qc-test-t1-${Date.now()}` },
    });
    const creator = await prisma.creatorIdentity.create({
      data: {
        deploymentId: "dep_test",
        name: "qc-test-creator-t1",
        identityRefIds: [],
        heroImageAssetId: "asset_x",
        identityDescription: "test",
        voice: {},
        personality: {},
        appearanceRules: {},
      },
    });
    const job = await prisma.creativeJob.create({
      data: {
        taskId: `task_t1_${Date.now()}`,
        organizationId: "org_test_sp5_t1",
        deploymentId: "dep_test",
        productDescription: "x",
        targetAudience: "x",
        platforms: [],
        productIdentityId: product.id,
        creatorIdentityId: creator.id,
      },
    });
    const asset = await prisma.assetRecord.create({
      data: {
        jobId: job.id,
        specId: `spec_t1_${Date.now()}`,
        creatorId: creator.id,
        provider: "kling",
        modelId: "kling-1",
        inputHashes: {},
        outputs: {},
      },
    });
    const snapshot = await prisma.pcdIdentitySnapshot.create({
      data: {
        assetRecordId: asset.id,
        productIdentityId: product.id,
        productTierAtGeneration: 1,
        productImageAssetIds: [],
        productCanonicalTextHash: "hash_t1",
        productLogoAssetId: null,
        creatorIdentityId: creator.id,
        avatarTierAtGeneration: 1,
        avatarReferenceAssetIds: [],
        voiceAssetId: null,
        consentRecordId: null,
        policyVersion: "tier-policy@1.0.0",
        providerCapabilityVersion: "provider-capability@1.0.0",
        selectedProvider: "kling",
        providerModelSnapshot: "kling-1",
        seedOrNoSeed: "no-seed",
        rewrittenPromptText: null,
      },
    });

    const row = await store.createForAsset({
      assetRecordId: asset.id,
      productIdentityId: product.id,
      pcdIdentitySnapshotId: snapshot.id,
      creatorIdentityId: null,
      qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
      qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
      gateVerdicts: { gates: [], aggregateStatus: "warn" },
      gatesRan: [],
      faceSimilarityScore: null,
      logoSimilarityScore: null,
      packageOcrMatchScore: null,
      geometryMatchScore: null,
      scaleConfidence: null,
      colorDeltaScore: null,
      passFail: "warn",
      warnings: [],
    });

    expect(row.gatesRan).toEqual([]);
    expect(row.passFail).toBe("warn");
    expect((row.gateVerdicts as { aggregateStatus: string }).aggregateStatus).toBe("warn");

    await prisma.productQcResult.delete({ where: { id: row.id } });
    await prisma.pcdIdentitySnapshot.delete({ where: { id: snapshot.id } });
    await prisma.assetRecord.delete({ where: { id: asset.id } });
    await prisma.creativeJob.delete({ where: { id: job.id } });
    await prisma.creatorIdentity.delete({ where: { id: creator.id } });
    await prisma.productIdentity.delete({ where: { id: product.id } });
  });
});
