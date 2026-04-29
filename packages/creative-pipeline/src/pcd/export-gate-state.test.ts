import { describe, expect, it } from "vitest";
import {
  AlwaysOpenExportGateState,
  type ExportGateOpenness,
  type ExportGateState,
} from "./export-gate-state.js";

describe("ExportGateState type contract", () => {
  it("supports the open: true variant", () => {
    const state: ExportGateOpenness = { open: true };
    expect(state.open).toBe(true);
  });

  it("supports the open: false + reason variant", () => {
    const state: ExportGateOpenness = { open: false, reason: "embargo" };
    expect(state.open).toBe(false);
    if (state.open === false) {
      expect(state.reason).toBe("embargo");
    }
  });
});

describe("AlwaysOpenExportGateState", () => {
  it("returns open: true for any asset id", async () => {
    const gate: ExportGateState = new AlwaysOpenExportGateState();
    expect(await gate.isOpen("asset_1")).toEqual({ open: true });
    expect(await gate.isOpen("asset_999")).toEqual({ open: true });
  });

  it("does not throw on empty string id", async () => {
    const gate = new AlwaysOpenExportGateState();
    await expect(gate.isOpen("")).resolves.toEqual({ open: true });
  });
});
