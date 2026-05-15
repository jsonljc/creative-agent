import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_ROUTER_VERSION } from "./synthetic-router-version.js";

describe("PCD_SYNTHETIC_ROUTER_VERSION", () => {
  it('is the literal "pcd-synthetic-router@1.1.0"', () => {
    expect(PCD_SYNTHETIC_ROUTER_VERSION).toBe("pcd-synthetic-router@1.1.0");
  });
});
