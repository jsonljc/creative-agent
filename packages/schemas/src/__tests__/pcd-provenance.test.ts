import { describe, expect, it } from "vitest";
import {
  PcdProvenanceLineageSchema,
  PcdProvenanceDecisionReasonSchema,
  PcdSp9ProvenancePayloadSchema,
} from "../pcd-provenance.js";

describe("PcdProvenanceLineageSchema", () => {
  it("accepts a fully populated lineage", () => {
    const ok = PcdProvenanceLineageSchema.parse({
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
    });
    expect(ok.scriptId).toBe("scr_1");
  });

  it("rejects empty briefId", () => {
    expect(() =>
      PcdProvenanceLineageSchema.parse({
        briefId: "",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
        scriptId: "scr_1",
      }),
    ).toThrow();
  });

  it("rejects missing field", () => {
    expect(() =>
      PcdProvenanceLineageSchema.parse({
        briefId: "brf_1",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
      }),
    ).toThrow();
  });
});

describe("PcdProvenanceDecisionReasonSchema", () => {
  it("accepts a fully populated reason", () => {
    const ok = PcdProvenanceDecisionReasonSchema.parse({
      decidedAt: "2026-04-30T12:00:00.000Z",
      fanoutDecisionId: "fdec_1",
      chainVersion: "preproduction-chain@1.0.0",
      provenanceVersion: "pcd-provenance@1.0.0",
    });
    expect(ok.provenanceVersion).toBe("pcd-provenance@1.0.0");
  });

  it("rejects non-iso decidedAt", () => {
    expect(() =>
      PcdProvenanceDecisionReasonSchema.parse({
        decidedAt: "2026-04-30",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      }),
    ).toThrow();
  });
});

describe("PcdSp9ProvenancePayloadSchema", () => {
  it("accepts the merged five-id + reason shape", () => {
    const ok = PcdSp9ProvenancePayloadSchema.parse({
      briefId: "brf_1",
      trendId: "trd_1",
      motivatorId: "mot_1",
      hookId: "hk_1",
      scriptId: "scr_1",
      lineageDecisionReason: {
        decidedAt: "2026-04-30T12:00:00.000Z",
        fanoutDecisionId: "fdec_1",
        chainVersion: "preproduction-chain@1.0.0",
        provenanceVersion: "pcd-provenance@1.0.0",
      },
    });
    expect(ok.lineageDecisionReason.provenanceVersion).toBe("pcd-provenance@1.0.0");
  });

  it("rejects payload with malformed lineageDecisionReason", () => {
    expect(() =>
      PcdSp9ProvenancePayloadSchema.parse({
        briefId: "brf_1",
        trendId: "trd_1",
        motivatorId: "mot_1",
        hookId: "hk_1",
        scriptId: "scr_1",
        lineageDecisionReason: {
          decidedAt: "not-an-iso-string",
          fanoutDecisionId: "fdec_1",
          chainVersion: "preproduction-chain@1.0.0",
          provenanceVersion: "pcd-provenance@1.0.0",
        },
      }),
    ).toThrow();
  });
});
