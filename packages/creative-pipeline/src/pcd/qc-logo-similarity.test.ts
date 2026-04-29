import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import { LOGO_SIMILARITY_THRESHOLD, runLogoSimilarityGate } from "./qc-logo-similarity.js";

const makeProviders = (
  scoreLogoImpl: PcdQcProviders["similarityProvider"]["scoreLogoSimilarity"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: scoreLogoImpl,
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure: vi.fn() },
});

describe("runLogoSimilarityGate", () => {
  it("skipped when productLogoAssetId is null (no provider call)", async () => {
    const scoreLogo = vi.fn();
    const providers = makeProviders(scoreLogo);
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: null },
      providers,
    );
    expect(v.gate).toBe("logo_similarity");
    expect(v.status).toBe("skipped");
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
    expect(v.reason).toBeTruthy();
    expect(scoreLogo).not.toHaveBeenCalled();
  });

  it("pass when score >= threshold", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD + 0.1 }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBeCloseTo(LOGO_SIMILARITY_THRESHOLD + 0.1);
    expect(v.threshold).toBe(LOGO_SIMILARITY_THRESHOLD);
    expect(v.reason).toMatch(/logo similarity/);
  });

  it("boundary: score === threshold → pass (>= semantics)", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("pass");
  });

  it("fail when score < threshold", async () => {
    const providers = makeProviders(async () => ({ score: LOGO_SIMILARITY_THRESHOLD - 0.1 }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.score).toBeCloseTo(LOGO_SIMILARITY_THRESHOLD - 0.1);
    expect(v.threshold).toBe(LOGO_SIMILARITY_THRESHOLD);
    expect(v.reason).toContain("<");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("boom");
    });
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("boom");
    expect(v.reason).toContain("logo similarity provider error");
  });

  it("reason is non-empty on every return path", async () => {
    const providers = makeProviders(async () => ({ score: 0.99 }));
    const v = await runLogoSimilarityGate(
      { candidateAssetId: "asset_1", productLogoAssetId: "logo_1" },
      providers,
    );
    expect(v.reason.length).toBeGreaterThan(0);
  });
});

describe("qc-logo-similarity — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-logo-similarity.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });

  it("does not import qc-gate-matrix.js or qc-evaluator.js (predicate independence)", () => {
    const src = readFileSync(new URL("./qc-logo-similarity.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
