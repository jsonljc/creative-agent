import { describe, expect, it } from "vitest";
import { PCD_COST_FORECAST_VERSION } from "./cost-forecast-version.js";

describe("PCD_COST_FORECAST_VERSION", () => {
  it("is the locked initial version", () => {
    expect(PCD_COST_FORECAST_VERSION).toBe("pcd-cost-forecast@1.0.0");
  });

  it("matches the slug@semver format", () => {
    expect(PCD_COST_FORECAST_VERSION).toMatch(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/);
  });
});
