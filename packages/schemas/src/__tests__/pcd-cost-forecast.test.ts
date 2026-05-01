import { describe, expect, it } from "vitest";
import {
  PcdSp10CostLineItemSchema,
  PcdSp10CostForecastReasonSchema,
} from "../pcd-cost-forecast.js";

describe("PcdSp10CostLineItemSchema", () => {
  it("parses a valid line item", () => {
    const parsed = PcdSp10CostLineItemSchema.parse({
      label: "video-generation",
      estimatedUsd: 0.42,
    });
    expect(parsed.label).toBe("video-generation");
    expect(parsed.estimatedUsd).toBe(0.42);
  });

  it("rejects empty label", () => {
    expect(() => PcdSp10CostLineItemSchema.parse({ label: "", estimatedUsd: 0.42 })).toThrow();
  });

  it("rejects negative estimatedUsd", () => {
    expect(() => PcdSp10CostLineItemSchema.parse({ label: "x", estimatedUsd: -0.01 })).toThrow();
  });

  it("accepts zero estimatedUsd", () => {
    expect(() => PcdSp10CostLineItemSchema.parse({ label: "free", estimatedUsd: 0 })).not.toThrow();
  });
});

describe("PcdSp10CostForecastReasonSchema", () => {
  const valid = {
    estimatedUsd: 1.23,
    currency: "USD" as const,
    lineItems: [{ label: "x", estimatedUsd: 1.23 }],
    costForecastVersion: "pcd-cost-forecast@1.0.0",
    estimatorVersion: "stub-cost-estimator@1.0.0",
    estimatedAt: "2026-04-30T12:00:00.000Z",
  };

  it("parses a valid forecast reason", () => {
    const parsed = PcdSp10CostForecastReasonSchema.parse(valid);
    expect(parsed.currency).toBe("USD");
    expect(parsed.lineItems).toHaveLength(1);
  });

  it("locks currency to literal 'USD'", () => {
    expect(() => PcdSp10CostForecastReasonSchema.parse({ ...valid, currency: "EUR" })).toThrow();
  });

  it("rejects empty costForecastVersion", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, costForecastVersion: "" }),
    ).toThrow();
  });

  it("rejects empty estimatorVersion", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatorVersion: "" }),
    ).toThrow();
  });

  it("rejects non-datetime estimatedAt", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatedAt: "not-a-date" }),
    ).toThrow();
  });

  it("rejects negative estimatedUsd", () => {
    expect(() =>
      PcdSp10CostForecastReasonSchema.parse({ ...valid, estimatedUsd: -0.01 }),
    ).toThrow();
  });

  it("accepts empty lineItems array", () => {
    expect(() => PcdSp10CostForecastReasonSchema.parse({ ...valid, lineItems: [] })).not.toThrow();
  });
});
