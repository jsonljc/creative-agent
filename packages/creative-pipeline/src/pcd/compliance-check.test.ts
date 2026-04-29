import { describe, expect, it } from "vitest";
import {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./compliance-check.js";

describe("ComplianceCheck type contract", () => {
  it("supports the pass: true variant", () => {
    const r: ComplianceCheckResult = { pass: true };
    expect(r.pass).toBe(true);
  });

  it("supports the pass: false + reason variant", () => {
    const r: ComplianceCheckResult = { pass: false, reason: "ftc_disclosure_missing" };
    expect(r.pass).toBe(false);
    if (r.pass === false) {
      expect(r.reason).toBe("ftc_disclosure_missing");
    }
  });
});

describe("ComplianceCheckInput", () => {
  it("permits effectiveTier: null (per SP6 type-boundary normalization)", () => {
    const input: ComplianceCheckInput = {
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: null,
    };
    expect(input.effectiveTier).toBeNull();
  });

  it("permits effectiveTier: 1 | 2 | 3", () => {
    const input: ComplianceCheckInput = {
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    };
    expect(input.effectiveTier).toBe(2);
  });
});

describe("AlwaysPassComplianceCheck", () => {
  it("returns exactly { pass: true } — no reason field", async () => {
    const check: ComplianceCheck = new AlwaysPassComplianceCheck();
    const result = await check.checkMetaDraftCompliance({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: 2,
    });
    expect(result).toEqual({ pass: true });
    expect(JSON.stringify(result)).not.toContain("reason");
  });

  it("ignores effectiveTier (returns pass: true even when null)", async () => {
    const check = new AlwaysPassComplianceCheck();
    const result = await check.checkMetaDraftCompliance({
      assetRecordId: "asset_1",
      shotType: "talking_head",
      effectiveTier: null,
    });
    expect(result).toEqual({ pass: true });
  });
});
