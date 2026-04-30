import { describe, expect, it } from "vitest";
import { PCD_PREPRODUCTION_FANOUT_VERSION } from "./preproduction-fanout-version.js";

describe("PCD_PREPRODUCTION_FANOUT_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_PREPRODUCTION_FANOUT_VERSION).toBe("preproduction-fanout@1.0.0");
  });
});
