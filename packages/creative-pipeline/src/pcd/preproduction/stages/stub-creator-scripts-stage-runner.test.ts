import { describe, expect, it } from "vitest";
import { CreatorScriptsStageOutputSchema } from "@creativeagent/schemas";
import {
  StubCreatorScriptsStageRunner,
  STUB_SCRIPTS_PER_HOOK,
} from "./stub-creator-scripts-stage-runner.js";

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
const trends = {
  signals: [{ id: "trend-brief-123-1", summary: "z", audienceFit: "y", evidenceRefs: [] }],
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
  ],
};
const hooks = {
  hooks: [
    {
      id: "hook-motivator-trend-brief-123-1-1-1",
      text: "h1",
      hookType: "direct_camera" as const,
      parentMotivatorId: "motivator-trend-brief-123-1-1",
      parentTrendId: "trend-brief-123-1",
    },
    {
      id: "hook-motivator-trend-brief-123-1-1-2",
      text: "h2",
      hookType: "mid_action" as const,
      parentMotivatorId: "motivator-trend-brief-123-1-1",
      parentTrendId: "trend-brief-123-1",
    },
  ],
};

describe("StubCreatorScriptsStageRunner", () => {
  const runner = new StubCreatorScriptsStageRunner();

  it("STUB_SCRIPTS_PER_HOOK is 2", () => {
    expect(STUB_SCRIPTS_PER_HOOK).toBe(2);
  });

  it("returns hooks.length × STUB_SCRIPTS_PER_HOOK scripts (= 4)", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts.length).toBe(hooks.hooks.length * STUB_SCRIPTS_PER_HOOK);
    expect(out.scripts.length).toBe(4);
  });

  it("each script's parentHookId matches a real hook id", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    const realHookIds = new Set(hooks.hooks.map((h) => h.id));
    for (const s of out.scripts) {
      expect(realHookIds.has(s.parentHookId)).toBe(true);
    }
  });

  it("script ids encode parent hook id + 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(out.scripts[0]!.id).toBe("script-hook-motivator-trend-brief-123-1-1-1-1");
    expect(out.scripts[1]!.id).toBe("script-hook-motivator-trend-brief-123-1-1-1-2");
  });

  it("uses talking_points style by default", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    for (const s of out.scripts) {
      expect(s.scriptStyle).toBe("talking_points");
      expect("spokenLines" in s).toBe(false);
    }
  });

  it("propagates identity refs from the context into identityConstraints", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    for (const s of out.scripts) {
      expect(s.identityConstraints.creatorIdentityId).toBe("creator-1");
      expect(s.identityConstraints.productIdentityId).toBe("product-1");
      expect(s.identityConstraints.voiceId).toBe(null);
    }
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends, motivators, hooks);
    expect(CreatorScriptsStageOutputSchema.safeParse(out).success).toBe(true);
  });
});
