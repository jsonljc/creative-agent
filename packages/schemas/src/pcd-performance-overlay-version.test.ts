import { describe, expect, it } from "vitest";
import { PCD_PERFORMANCE_OVERLAY_VERSION } from "./pcd-performance-overlay-version.js";

describe("PCD_PERFORMANCE_OVERLAY_VERSION", () => {
  it("is the literal pcd-performance-overlay@1.0.0", () => {
    expect(PCD_PERFORMANCE_OVERLAY_VERSION).toBe("pcd-performance-overlay@1.0.0");
  });
});
