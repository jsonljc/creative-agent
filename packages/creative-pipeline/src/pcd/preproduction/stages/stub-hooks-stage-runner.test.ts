import { describe, expect, it } from "vitest";
import { HooksStageOutputSchema } from "@creativeagent/schemas";
import { StubHooksStageRunner } from "./stub-hooks-stage-runner.js";

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
const motivators = {
  motivators: [
    {
      id: "motivator-brief-123-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
  ],
};

describe("StubHooksStageRunner", () => {
  const runner = new StubHooksStageRunner();

  it("returns a length-1 hooks list", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(HooksStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("links each hook to parentMotivatorId AND parentTrendId", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.parentMotivatorId).toBe("motivator-brief-123-1");
    expect(out.hooks[0]!.parentTrendId).toBe("trend-brief-123-1");
  });

  it("uses a default hookType from the four-value enum", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(["direct_camera", "mid_action", "reaction", "text_overlay_start"]).toContain(
      out.hooks[0]!.hookType,
    );
  });
});
