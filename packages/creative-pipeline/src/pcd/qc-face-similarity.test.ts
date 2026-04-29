import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import { FACE_SIMILARITY_THRESHOLD, runFaceSimilarityGate } from "./qc-face-similarity.js";

const makeProviders = (
  scoreFaceImpl: PcdQcProviders["similarityProvider"]["scoreFaceSimilarity"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: scoreFaceImpl,
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure: vi.fn() },
});

describe("runFaceSimilarityGate", () => {
  it("skipped when creatorReferenceAssetIds is empty (no provider call)", async () => {
    const scoreFace = vi.fn();
    const providers = makeProviders(scoreFace);
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: [] },
      providers,
    );
    expect(v.gate).toBe("face_similarity");
    expect(v.status).toBe("skipped");
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
    expect(v.reason).toBeTruthy();
    expect(scoreFace).not.toHaveBeenCalled();
  });

  it("pass when score >= threshold", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD + 0.1 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBeCloseTo(FACE_SIMILARITY_THRESHOLD + 0.1);
    expect(v.threshold).toBe(FACE_SIMILARITY_THRESHOLD);
    expect(v.reason).toMatch(/face similarity/);
  });

  it("boundary: score === threshold → pass (>= semantics)", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("pass");
  });

  it("fail when score < threshold", async () => {
    const providers = makeProviders(async () => ({ score: FACE_SIMILARITY_THRESHOLD - 0.1 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.score).toBeCloseTo(FACE_SIMILARITY_THRESHOLD - 0.1);
    expect(v.threshold).toBe(FACE_SIMILARITY_THRESHOLD);
    expect(v.reason).toContain("<");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("boom");
    });
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("boom");
    expect(v.reason).toContain("face similarity provider error");
  });

  it("reason is non-empty on every return path", async () => {
    const providers = makeProviders(async () => ({ score: 0.99 }));
    const v = await runFaceSimilarityGate(
      { candidateAssetId: "asset_1", creatorReferenceAssetIds: ["ref_1"] },
      providers,
    );
    expect(v.reason.length).toBeGreaterThan(0);
  });
});

describe("qc-face-similarity — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-face-similarity.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });

  it("does not import qc-gate-matrix.js or qc-evaluator.js (predicate independence)", () => {
    const src = readFileSync(new URL("./qc-face-similarity.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
