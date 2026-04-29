import { describe, expect, it } from "vitest";
import { MotivatorsStageOutputSchema } from "@creativeagent/schemas";
import { StubMotivatorsStageRunner } from "./stub-motivators-stage-runner.js";

const brief = {
  briefId: "brief-123",
  productDescription: "x",
  targetAudience: "y",
  platforms: ["a"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};
const ctx = {} as never;
const trends = {
  signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }],
};

describe("StubMotivatorsStageRunner", () => {
  const runner = new StubMotivatorsStageRunner();

  it("returns a length-1 motivators list", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(MotivatorsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("links each motivator to a parentTrendId from the input trends", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators[0]!.parentTrendId).toBe("trend-brief-123-1");
  });

  it("is deterministic for the same inputs", async () => {
    const a = await runner.run(brief, ctx, trends);
    const b = await runner.run(brief, ctx, trends);
    expect(a).toEqual(b);
  });
});
