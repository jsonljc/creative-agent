import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IdentityTierSchema,
  PcdQcGateApplicabilitySchema,
  PcdShotTypeSchema,
  type IdentityTier,
  type PcdShotType,
} from "@creativeagent/schemas";
import {
  PCD_QC_GATE_MATRIX,
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./qc-gate-matrix.js";

describe("qc-gate-matrix — version pinning", () => {
  it("pins PCD_QC_GATE_MATRIX_VERSION to pcd-qc-gate-matrix@1.0.0", () => {
    expect(PCD_QC_GATE_MATRIX_VERSION).toBe("pcd-qc-gate-matrix@1.0.0");
  });
});

describe("qc-gate-matrix — shape", () => {
  it("every row passes PcdQcGateApplicabilitySchema", () => {
    for (const row of PCD_QC_GATE_MATRIX) {
      expect(() => PcdQcGateApplicabilitySchema.parse(row)).not.toThrow();
    }
  });

  it("no duplicate (shotType, effectiveTier, gate) triples", () => {
    const seen = new Set<string>();
    for (const row of PCD_QC_GATE_MATRIX) {
      const key = `${row.shotType}|${row.effectiveTier}|${row.gate}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(PCD_QC_GATE_MATRIX.length);
  });
});

describe("qc-gate-matrix — Tier 1 invariant (binding)", () => {
  it("PCD_QC_GATE_MATRIX has zero Tier 1 rows", () => {
    const tier1 = PCD_QC_GATE_MATRIX.filter((r) => r.effectiveTier === 1);
    expect(tier1).toEqual([]);
  });

  it("getPcdQcGateApplicability returns [] for Tier 1 + every shot type", () => {
    const allShotTypes: PcdShotType[] = [
      "script_only",
      "storyboard",
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const shotType of allShotTypes) {
      const rows = getPcdQcGateApplicability({ shotType, effectiveTier: 1 });
      expect(rows).toEqual([]);
    }
  });
});

describe("qc-gate-matrix — coverage assertions (hand-listed in test)", () => {
  // The expected cells below are intentionally NOT imported from the matrix
  // module — listing them here independently prevents the "test imports same
  // wrong table" failure mode.
  it("Tier 2 + Tier 3 label_closeup includes ocr_package_text (mode: block)", () => {
    for (const tier of [2, 3] as IdentityTier[]) {
      const rows = getPcdQcGateApplicability({ shotType: "label_closeup", effectiveTier: tier });
      const ocr = rows.find((r) => r.gate === "ocr_package_text");
      expect(ocr).toBeDefined();
      expect(ocr?.mode).toBe("block");
    }
  });

  it("Tier 3 face_closeup includes face_similarity (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "face_closeup", effectiveTier: 3 });
    const face = rows.find((r) => r.gate === "face_similarity");
    expect(face).toBeDefined();
    expect(face?.mode).toBe("block");
  });

  it("Tier 3 product_in_hand includes geometry_scale (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "product_in_hand", effectiveTier: 3 });
    const geom = rows.find((r) => r.gate === "geometry_scale");
    expect(geom).toBeDefined();
    expect(geom?.mode).toBe("block");
  });

  it("Tier 3 object_insert includes geometry_scale + logo_similarity (mode: block)", () => {
    const rows = getPcdQcGateApplicability({ shotType: "object_insert", effectiveTier: 3 });
    const geom = rows.find((r) => r.gate === "geometry_scale");
    const logo = rows.find((r) => r.gate === "logo_similarity");
    expect(geom?.mode).toBe("block");
    expect(logo?.mode).toBe("block");
  });
});

describe("qc-gate-matrix — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-gate-matrix.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });
});
