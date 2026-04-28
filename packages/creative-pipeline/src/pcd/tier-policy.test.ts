import { describe, expect, it } from "vitest";
import { PCD_TIER_POLICY_VERSION, decidePcdGenerationAccess } from "./tier-policy.js";

describe("PCD_TIER_POLICY_VERSION", () => {
  it("is locked to tier-policy@1.0.0 (SP4 snapshot writer pins this value)", () => {
    expect(PCD_TIER_POLICY_VERSION).toBe("tier-policy@1.0.0");
  });
});

describe("decidePcdGenerationAccess (smoke)", () => {
  it("is callable", () => {
    const decision = decidePcdGenerationAccess({
      shotType: "simple_ugc",
      outputIntent: "draft",
    });
    expect(decision.allowed).toBe(true);
  });
});
