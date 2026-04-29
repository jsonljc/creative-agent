import { describe, expect, it } from "vitest";
import { CreatorScriptsStageOutputSchema } from "@creativeagent/schemas";
import { StubCreatorScriptsStageRunner } from "./stub-creator-scripts-stage-runner.js";

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
const ctx = {
  creatorIdentityId: "creator-1",
  productIdentityId: "product-1",
  voiceId: null,
} as never;
const trends = { signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }] };
const motivators = {
  motivators: [
    { id: "motivator-brief-123-1", frictionOrDesire: "f", audienceSegment: "y", evidenceRefs: [], parentTrendId: "trend-brief-123-1" },
  ],
};
const hooks = {
  hooks: [
    {
      id: "hook-brief-123-1",
      text: "h",
      hookType: "direct_camera" as const,
      parentMotivatorId: "motivator-brief-123-1",
      parentTrendId: "trend-brief-123-1",
    },
  ],
};

describe("StubCreatorScriptsStageRunner", () => {
  const runner = new StubCreatorScriptsStageRunner();

  it("returns a length-1 scripts list", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts.length).toBe(1);
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(CreatorScriptsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("uses talking_points style by default (no spokenLines field)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    const script = out.scripts[0]!;
    expect(script.scriptStyle).toBe("talking_points");
    expect("spokenLines" in script).toBe(false);
  });

  it("links script.parentHookId to the input hook id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.parentHookId).toBe("hook-brief-123-1");
  });

  it("propagates identity refs from the context into identityConstraints", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.identityConstraints.creatorIdentityId).toBe("creator-1");
    expect(out.scripts[0]!.identityConstraints.productIdentityId).toBe("product-1");
    expect(out.scripts[0]!.identityConstraints.voiceId).toBe(null);
  });
});
