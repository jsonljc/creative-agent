import { describe, expect, it } from "vitest";
import { PCD_PERFORMANCE_SNAPSHOT_VERSION } from "./performance-snapshot-version.js";

describe("PCD_PERFORMANCE_SNAPSHOT_VERSION", () => {
  it("is pinned to pcd-performance-snapshot@1.0.0", () => {
    expect(PCD_PERFORMANCE_SNAPSHOT_VERSION).toBe("pcd-performance-snapshot@1.0.0");
  });
});
