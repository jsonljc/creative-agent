import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PcdQcProviders } from "./qc-providers.js";
import { OCR_EDIT_DISTANCE_THRESHOLD, runOcrPackageTextGate } from "./qc-ocr-match.js";

const makeProviders = (
  extractTextImpl: PcdQcProviders["ocrProvider"]["extractText"],
): PcdQcProviders => ({
  similarityProvider: {
    scoreFaceSimilarity: vi.fn(),
    scoreLogoSimilarity: vi.fn(),
  },
  ocrProvider: { extractText: extractTextImpl },
  geometryProvider: { measure: vi.fn() },
});

describe("runOcrPackageTextGate", () => {
  it("skipped when productCanonicalText is null (no provider call)", async () => {
    const extractText = vi.fn();
    const providers = makeProviders(extractText);
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: null },
      providers,
    );
    expect(v.gate).toBe("ocr_package_text");
    expect(v.status).toBe("skipped");
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
    expect(v.reason).toBeTruthy();
    expect(extractText).not.toHaveBeenCalled();
  });

  it("pass when extracted text matches canonical text exactly (ratio = 1.0)", async () => {
    const providers = makeProviders(async () => ({ text: "Acme Hot Sauce 8oz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("pass");
    expect(v.score).toBe(1);
    expect(v.threshold).toBe(OCR_EDIT_DISTANCE_THRESHOLD);
    expect(v.reason).toMatch(/ocr edit-distance ratio/);
  });

  it("fail when extracted text deviates beyond threshold — score < threshold", async () => {
    const providers = makeProviders(async () => ({ text: "completely different text here xyz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.score).toBeDefined();
    expect(v.score as number).toBeLessThan(OCR_EDIT_DISTANCE_THRESHOLD);
  });

  it("evidence carries editDistanceRatio but NOT raw text (PII bounds)", async () => {
    const providers = makeProviders(async () => ({ text: "Acme Hot Sauce 8oz" }));
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.evidence?.editDistanceRatio).toBe(1);
    expect(v.evidence).not.toHaveProperty("text");
    expect(v.evidence).not.toHaveProperty("extractedText");
    expect(JSON.stringify(v.evidence)).not.toContain("Acme Hot Sauce 8oz");
  });

  it("provider error → fail (no exception escapes)", async () => {
    const providers = makeProviders(async () => {
      throw new Error("ocr down");
    });
    const v = await runOcrPackageTextGate(
      { candidateAssetId: "asset_1", productCanonicalText: "Acme Hot Sauce 8oz" },
      providers,
    );
    expect(v.status).toBe("fail");
    expect(v.reason).toContain("ocr down");
    expect(v.reason).toContain("ocr provider error");
  });
});

describe("qc-ocr-match — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-ocr-match.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });

  it("does not import qc-gate-matrix.js or qc-evaluator.js (predicate independence)", () => {
    const src = readFileSync(new URL("./qc-ocr-match.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/qc-gate-matrix\.js/);
    expect(src).not.toMatch(/qc-evaluator\.js/);
  });
});
