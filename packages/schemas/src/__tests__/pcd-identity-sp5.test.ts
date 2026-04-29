import { describe, expect, it } from "vitest";
import {
  PcdQcGateKeySchema,
  PcdQcGateStatusSchema,
  PcdQcAggregateStatusSchema,
  PcdQcGateModeSchema,
  PcdQcGateVerdictSchema,
  PcdQcGateVerdictsSchema,
  PcdQcGateApplicabilitySchema,
  ProductQcResultSchema,
} from "../pcd-identity.js";

describe("SP5 enum schemas", () => {
  it("PcdQcGateKey accepts the four gate keys", () => {
    expect(PcdQcGateKeySchema.parse("face_similarity")).toBe("face_similarity");
    expect(PcdQcGateKeySchema.parse("logo_similarity")).toBe("logo_similarity");
    expect(PcdQcGateKeySchema.parse("ocr_package_text")).toBe("ocr_package_text");
    expect(PcdQcGateKeySchema.parse("geometry_scale")).toBe("geometry_scale");
  });

  it("PcdQcGateKey rejects unknown keys", () => {
    expect(() => PcdQcGateKeySchema.parse("color_delta")).toThrow();
  });

  it("PcdQcGateStatus accepts pass/warn/fail/skipped", () => {
    for (const s of ["pass", "warn", "fail", "skipped"] as const) {
      expect(PcdQcGateStatusSchema.parse(s)).toBe(s);
    }
  });

  it("PcdQcGateStatus rejects unknown values", () => {
    expect(() => PcdQcGateStatusSchema.parse("unknown_status")).toThrow();
  });

  it("PcdQcAggregateStatus rejects 'skipped'", () => {
    expect(() => PcdQcAggregateStatusSchema.parse("skipped")).toThrow();
  });

  it("PcdQcGateMode accepts block/warn_only and rejects 'skip'", () => {
    expect(PcdQcGateModeSchema.parse("block")).toBe("block");
    expect(PcdQcGateModeSchema.parse("warn_only")).toBe("warn_only");
    expect(() => PcdQcGateModeSchema.parse("skip")).toThrow();
  });
});

describe("SP5 verdict + applicability schemas", () => {
  it("PcdQcGateVerdict requires non-empty reason", () => {
    expect(() =>
      PcdQcGateVerdictSchema.parse({
        gate: "face_similarity",
        status: "pass",
        reason: "",
      }),
    ).toThrow();
  });

  it("PcdQcGateVerdict accepts skipped without score", () => {
    const v = PcdQcGateVerdictSchema.parse({
      gate: "face_similarity",
      status: "skipped",
      reason: "no creator references",
    });
    expect(v.score).toBeUndefined();
    expect(v.threshold).toBeUndefined();
  });

  it("PcdQcGateVerdict accepts evidence record", () => {
    const v = PcdQcGateVerdictSchema.parse({
      gate: "geometry_scale",
      status: "pass",
      score: 0.92,
      threshold: 0.8,
      reason: "geometry pass",
      evidence: { scaleConfidence: 0.95, editDistance: 12 },
    });
    expect(v.evidence?.scaleConfidence).toBe(0.95);
  });

  it("PcdQcGateVerdicts requires aggregateStatus", () => {
    const vs = PcdQcGateVerdictsSchema.parse({
      gates: [],
      aggregateStatus: "warn",
    });
    expect(vs.aggregateStatus).toBe("warn");
  });

  it("PcdQcGateVerdicts rejects empty gates with aggregateStatus='pass' (skipped never aggregates to pass)", () => {
    expect(() =>
      PcdQcGateVerdictsSchema.parse({
        gates: [],
        aggregateStatus: "pass",
      }),
    ).toThrow();
  });

  it("PcdQcGateVerdicts accepts empty gates with aggregateStatus='warn'", () => {
    const vs = PcdQcGateVerdictsSchema.parse({
      gates: [],
      aggregateStatus: "warn",
    });
    expect(vs.aggregateStatus).toBe("warn");
  });

  it("PcdQcGateApplicability requires shotType, effectiveTier, gate, mode", () => {
    const a = PcdQcGateApplicabilitySchema.parse({
      shotType: "label_closeup",
      effectiveTier: 3,
      gate: "ocr_package_text",
      mode: "block",
      rationale: "Tier 3 hard-blocks on OCR mismatch",
    });
    expect(a.mode).toBe("block");
  });
});

describe("PcdQcGateApplicabilitySchema rejection paths", () => {
  const valid = () => ({
    shotType: "label_closeup" as const,
    effectiveTier: 3 as const,
    gate: "ocr_package_text" as const,
    mode: "block" as const,
  });

  it("rejects unknown shotType", () => {
    expect(() =>
      PcdQcGateApplicabilitySchema.parse({ ...valid(), shotType: "unknown_shot" }),
    ).toThrow();
  });

  it("rejects effectiveTier outside 1/2/3", () => {
    expect(() => PcdQcGateApplicabilitySchema.parse({ ...valid(), effectiveTier: 4 })).toThrow();
    expect(() => PcdQcGateApplicabilitySchema.parse({ ...valid(), effectiveTier: 0 })).toThrow();
  });

  it("rejects unknown gate", () => {
    expect(() => PcdQcGateApplicabilitySchema.parse({ ...valid(), gate: "color_delta" })).toThrow();
  });

  it("rejects unknown mode", () => {
    expect(() => PcdQcGateApplicabilitySchema.parse({ ...valid(), mode: "skip" })).toThrow();
  });

  it("rejects rationale exceeding 200 chars", () => {
    expect(() =>
      PcdQcGateApplicabilitySchema.parse({
        ...valid(),
        rationale: "x".repeat(201),
      }),
    ).toThrow();
  });
});

describe("SP5 ProductQcResultSchema widening", () => {
  it("parses pre-SP5 row (new fields absent / null / [] for gatesRan)", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_pre",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      passFail: "pass",
      warnings: [],
      createdAt: new Date(),
      // creatorIdentityId, pcdIdentitySnapshotId, faceSimilarityScore,
      // gatesRan, gateVerdicts, qcEvaluationVersion, qcGateMatrixVersion all absent
    });
    expect(row.creatorIdentityId).toBeUndefined();
    expect(row.gateVerdicts).toBeUndefined();
  });

  it("parses pre-SP5 row with gatesRan = [] (Postgres array default)", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_pre2",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      passFail: "warn",
      warnings: [],
      createdAt: new Date(),
      gatesRan: [],
    });
    expect(row.gatesRan).toEqual([]);
  });

  it("parses fully-populated SP5 row", () => {
    const row = ProductQcResultSchema.parse({
      id: "qc_sp5",
      productIdentityId: "prod_1",
      assetRecordId: "asset_1",
      creatorIdentityId: "creator_1",
      pcdIdentitySnapshotId: "snap_1",
      faceSimilarityScore: 0.91,
      gatesRan: ["face_similarity"],
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
      qcEvaluationVersion: "pcd-qc-evaluation@1.0.0",
      qcGateMatrixVersion: "pcd-qc-gate-matrix@1.0.0",
      passFail: "pass",
      warnings: [],
      createdAt: new Date(),
    });
    expect(row.qcEvaluationVersion).toBe("pcd-qc-evaluation@1.0.0");
    expect(row.gateVerdicts?.aggregateStatus).toBe("pass");
    expect(row.creatorIdentityId).toBe("creator_1");
    expect(row.pcdIdentitySnapshotId).toBe("snap_1");
    expect(row.faceSimilarityScore).toBe(0.91);
    expect(row.gatesRan).toEqual(["face_similarity"]);
    expect(row.qcGateMatrixVersion).toBe("pcd-qc-gate-matrix@1.0.0");
  });
});
