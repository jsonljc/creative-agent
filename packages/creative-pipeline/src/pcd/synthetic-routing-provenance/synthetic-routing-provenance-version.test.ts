import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

describe("PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION", () => {
  it("is the exact literal 'pcd-synthetic-routing-provenance@1.0.0'", () => {
    expect(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION).toBe(
      "pcd-synthetic-routing-provenance@1.0.0",
    );
  });

  it("starts with the 'pcd-synthetic-routing-provenance@' prefix", () => {
    expect(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION.startsWith(
      "pcd-synthetic-routing-provenance@",
    )).toBe(true);
  });
});
