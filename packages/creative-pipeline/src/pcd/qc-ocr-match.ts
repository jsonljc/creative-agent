import type { PcdQcGateVerdict } from "@creativeagent/schemas";
import type { PcdQcProviders } from "./qc-providers.js";

// Levenshtein-ratio threshold: 1.0 = exact, 0.0 = totally different.
// Pass requires ratio >= threshold. Bumping this requires bumping
// PCD_QC_EVALUATION_VERSION.
export const OCR_EDIT_DISTANCE_THRESHOLD = 0.85;

export type OcrPackageTextGateInput = {
  candidateAssetId: string;
  productCanonicalText: string | null;
};

// Pure Levenshtein implementation. We avoid raw text in the verdict's
// evidence bag (PII bounds, see design doc "Evidence bounds (binding)").
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Indices are loop-bounded; ! asserts they are always defined (safe here).
  const prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  const curr: number[] = Array.from({ length: n + 1 }, () => 0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
  }
  return prev[n]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
}

function ratio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  const denom = Math.max(a.length, b.length);
  return 1 - dist / denom;
}

export async function runOcrPackageTextGate(
  input: OcrPackageTextGateInput,
  providers: PcdQcProviders,
): Promise<PcdQcGateVerdict> {
  if (input.productCanonicalText === null) {
    return {
      gate: "ocr_package_text",
      status: "skipped",
      reason: "no productCanonicalText available",
    };
  }
  try {
    const { text } = await providers.ocrProvider.extractText({
      candidateAssetId: input.candidateAssetId,
    });
    const r = ratio(text.trim().toLowerCase(), input.productCanonicalText.trim().toLowerCase());
    const status = r >= OCR_EDIT_DISTANCE_THRESHOLD ? "pass" : "fail";
    // Evidence intentionally omits raw text — PII bounds.
    return {
      gate: "ocr_package_text",
      status,
      score: r,
      threshold: OCR_EDIT_DISTANCE_THRESHOLD,
      reason:
        status === "pass"
          ? `ocr edit-distance ratio ${r.toFixed(3)} >= threshold ${OCR_EDIT_DISTANCE_THRESHOLD}`
          : `ocr edit-distance ratio ${r.toFixed(3)} < threshold ${OCR_EDIT_DISTANCE_THRESHOLD}`,
      evidence: { editDistanceRatio: r },
    };
  } catch (err) {
    return {
      gate: "ocr_package_text",
      status: "fail",
      reason: `ocr provider error: ${(err as Error).message}`,
    };
  }
}
