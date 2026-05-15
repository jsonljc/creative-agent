import { describe, expect, it } from "vitest";
import {
  routeSyntheticPcdShot,
  type RouteSyntheticPcdShotInput,
} from "./route-synthetic-pcd-shot.js";

describe("routeSyntheticPcdShot — module surface", () => {
  it("exports an async function and a RouteSyntheticPcdShotInput type", () => {
    expect(typeof routeSyntheticPcdShot).toBe("function");
    // Type-only: a value of RouteSyntheticPcdShotInput would compile here.
    const _typeOnly: RouteSyntheticPcdShotInput | undefined = undefined;
    expect(_typeOnly).toBeUndefined();
  });
});
