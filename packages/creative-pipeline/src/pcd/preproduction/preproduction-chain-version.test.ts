import { describe, expect, it } from "vitest";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "./preproduction-chain-version.js";

describe("PCD_PREPRODUCTION_CHAIN_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PREPRODUCTION_CHAIN_VERSION).toBe("preproduction-chain@1.0.0");
  });
});
