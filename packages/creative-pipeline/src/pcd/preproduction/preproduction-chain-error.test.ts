import { describe, expect, it } from "vitest";
import { PreproductionChainError } from "./preproduction-chain-error.js";

describe("PreproductionChainError", () => {
  it("populates name, stage, and cause", () => {
    const cause = new Error("downstream boom");
    const err = new PreproductionChainError({ stage: "trends", cause });
    expect(err.name).toBe("PreproductionChainError");
    expect(err.stage).toBe("trends");
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new PreproductionChainError({ stage: "hooks", cause: new Error("x") });
    expect(err).toBeInstanceOf(Error);
  });

  it("PII bound: enumerable own properties expose only name + stage (no cause)", () => {
    const cause = new Error("brief secret");
    const err = new PreproductionChainError({ stage: "creator_scripts", cause });
    const ownKeys = Object.keys(err);
    // `cause` is non-enumerable so it does not leak when JSON.stringify is called
    // by Inngest/telemetry layers without explicit unwrapping.
    expect(ownKeys).toContain("stage");
    expect(ownKeys).not.toContain("cause");
  });

  it("accepts production_fanout_gate as stage", () => {
    const err = new PreproductionChainError({
      stage: "production_fanout_gate",
      cause: new Error("y"),
    });
    expect(err.stage).toBe("production_fanout_gate");
  });
});
