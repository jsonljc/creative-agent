import { describe, expect, it } from "vitest";
import { HooksStageOutputSchema } from "@creativeagent/schemas";
import { StubHooksStageRunner, STUB_HOOKS_PER_MOTIVATOR } from "./stub-hooks-stage-runner.js";

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
  signals: [
    { id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] },
    { id: "trend-brief-123-2", summary: "z", audienceFit: "y", evidenceRefs: [] },
  ],
};
const motivators = {
  motivators: [
    {
      id: "motivator-trend-brief-123-1-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "motivator-trend-brief-123-1-2",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "motivator-trend-brief-123-2-1",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-2",
    },
    {
      id: "motivator-trend-brief-123-2-2",
      frictionOrDesire: "f",
      audienceSegment: "y",
      evidenceRefs: [],
      parentTrendId: "trend-brief-123-2",
    },
  ],
};

describe("StubHooksStageRunner", () => {
  const runner = new StubHooksStageRunner();

  it("STUB_HOOKS_PER_MOTIVATOR is 3", () => {
    expect(STUB_HOOKS_PER_MOTIVATOR).toBe(3);
  });

  it("returns motivators.length × STUB_HOOKS_PER_MOTIVATOR hooks (= 12)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks.length).toBe(motivators.motivators.length * STUB_HOOKS_PER_MOTIVATOR);
    expect(out.hooks.length).toBe(12);
  });

  it("each hook's parentMotivatorId matches a real motivator id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    const realMotivatorIds = new Set(motivators.motivators.map((m) => m.id));
    for (const h of out.hooks) {
      expect(realMotivatorIds.has(h.parentMotivatorId)).toBe(true);
    }
  });

  it("each hook's parentTrendId matches its parent motivator's parentTrendId (transitive lineage)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    const motivatorById = new Map(motivators.motivators.map((m) => [m.id, m]));
    for (const h of out.hooks) {
      const parent = motivatorById.get(h.parentMotivatorId)!;
      expect(h.parentTrendId).toBe(parent.parentTrendId);
    }
  });

  it("hook ids encode parent motivator id + 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.id).toBe("hook-motivator-trend-brief-123-1-1-1");
    expect(out.hooks[1]!.id).toBe("hook-motivator-trend-brief-123-1-1-2");
    expect(out.hooks[2]!.id).toBe("hook-motivator-trend-brief-123-1-1-3");
  });

  it("hook types rotate across direct_camera, mid_action, reaction within one motivator's children", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(out.hooks[0]!.hookType).toBe("direct_camera");
    expect(out.hooks[1]!.hookType).toBe("mid_action");
    expect(out.hooks[2]!.hookType).toBe("reaction");
    expect(out.hooks[3]!.hookType).toBe("direct_camera");
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators);
    expect(HooksStageOutputSchema.safeParse(out).success).toBe(true);
  });
});
