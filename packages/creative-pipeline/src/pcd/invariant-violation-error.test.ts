import { describe, expect, it } from "vitest";
import { InvariantViolationError } from "./invariant-violation-error.js";

describe("InvariantViolationError", () => {
  it("constructs with reason + context (SP6+ generic form)", () => {
    const err = new InvariantViolationError("snapshot referenced missing consent record", {
      assetRecordId: "asset_1",
      consentRecordId: "consent_1",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InvariantViolationError");
    expect(err.message).toBe("snapshot referenced missing consent record");
    expect(err.context).toEqual({ assetRecordId: "asset_1", consentRecordId: "consent_1" });
  });

  it("constructs with reason only (no context)", () => {
    const err = new InvariantViolationError("required field missing");
    expect(err.message).toBe("required field missing");
    expect(err.context).toEqual({});
  });

  it("preserves backwards-compat (jobId, fieldName) constructor for SP3/SP4 callers", () => {
    const err = new InvariantViolationError("job_xyz", "productTierAtResolution");
    expect(err).toBeInstanceOf(InvariantViolationError);
    expect(err.message).toContain("job_xyz");
    expect(err.message).toContain("productTierAtResolution");
    expect(err.context).toEqual({ jobId: "job_xyz", fieldName: "productTierAtResolution" });
  });
});
