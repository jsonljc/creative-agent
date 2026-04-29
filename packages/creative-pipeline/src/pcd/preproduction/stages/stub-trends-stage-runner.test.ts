import { describe, expect, it } from "vitest";
import { TrendStageOutputSchema } from "@creativeagent/schemas";
import { StubTrendsStageRunner } from "./stub-trends-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "AI lead reply",
  targetAudience: "founders",
  platforms: ["instagram_reels"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {} as never; // stub does not read from context

describe("StubTrendsStageRunner", () => {
  const runner = new StubTrendsStageRunner();

  it("returns a length-1 trend signal list", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx);
    expect(TrendStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("is deterministic for the same briefId", async () => {
    const a = await runner.run(brief, ctx);
    const b = await runner.run(brief, ctx);
    expect(a).toEqual(b);
  });

  it("encodes briefId in the trend signal id", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals[0]!.id).toContain("brief-123");
  });
});
