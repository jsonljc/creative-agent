import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import {
  GEOMETRY_SCORE_THRESHOLD,
  SCALE_CONFIDENCE_THRESHOLD,
  runGeometryScaleGate,
} from "./qc-geometry.js";

const makeProviders = (measure: PcdQcProviders["geometryProvider"]["measure"]): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText: vi.fn() },
  geometryProvider: { measure },
});

describe("runGeometryScaleGate", () => {
  it("skipped when productDimensionsMm is null (no provider call)", async () => {
    const measure = vi.fn();
    const providers = makeProviders(measure);
    const v = await runGeometryScaleGate(
      { candidateAssetId: "asset_1", productDimensionsMm: null, shotType: "product_in_hand" },
      providers,
    );
    expect(v.status).toBe("skipped");
    expect(measure).not.toHaveBeenCalled();
  });

  it("pass requires both score >= threshold AND scaleConfidence >= threshold", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD + 0.05,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD + 0.05,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBeCloseTo(GEOMETRY_SCORE_THRESHOLD + 0.05);
    expect(v.evidence?.scaleConfidence).toBeCloseTo(SCALE_CONFIDENCE_THRESHOLD + 0.05);
  });

  it("fail when geometry score is below threshold (even if scaleConfidence ok)", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD - 0.1,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD + 0.1,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("fail");
  });

  it("fail when scaleConfidence is below threshold (even if geometry ok)", async () => {
    const providers = makeProviders(async () => ({
      score: GEOMETRY_SCORE_THRESHOLD + 0.1,
      scaleConfidence: SCALE_CONFIDENCE_THRESHOLD - 0.1,
    }));
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "product_in_hand",
      },
      providers,
    );
    expect(v.status).toBe("fail");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("geom down");
    });
    const v = await runGeometryScaleGate(
      {
        candidateAssetId: "asset_1",
        productDimensionsMm: { h: 100, w: 50, d: 30 },
        shotType: "object_insert",
      },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("geom down");
  });
});

describe("qc-geometry — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-geometry.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
