import { describe, expect, it } from "vitest";
import { TrendStageOutputSchema } from "@creativeagent/schemas";
import { StubTrendsStageRunner, STUB_TRENDS_FANOUT } from "./stub-trends-stage-runner.js";

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

  it("STUB_TRENDS_FANOUT is 2", () => {
    expect(STUB_TRENDS_FANOUT).toBe(2);
  });

  it(`returns STUB_TRENDS_FANOUT (=${STUB_TRENDS_FANOUT}) signals`, async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals.length).toBe(STUB_TRENDS_FANOUT);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx);
    expect(TrendStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("encodes briefId in each trend signal id with a 1-based suffix", async () => {
    const out = await runner.run(brief, ctx);
    expect(out.signals[0]!.id).toBe("trend-brief-123-1");
    expect(out.signals[1]!.id).toBe("trend-brief-123-2");
  });

  it("is deterministic for the same briefId", async () => {
    const a = await runner.run(brief, ctx);
    const b = await runner.run(brief, ctx);
    expect(a).toEqual(b);
  });
});
