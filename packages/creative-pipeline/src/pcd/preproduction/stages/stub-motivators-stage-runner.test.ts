import { describe, expect, it } from "vitest";
import { MotivatorsStageOutputSchema } from "@creativeagent/schemas";
import {
  StubMotivatorsStageRunner,
  STUB_MOTIVATORS_PER_TREND,
} from "./stub-motivators-stage-runner.js";

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

describe("StubMotivatorsStageRunner", () => {
  const runner = new StubMotivatorsStageRunner();

  it("STUB_MOTIVATORS_PER_TREND is 2", () => {
    expect(STUB_MOTIVATORS_PER_TREND).toBe(2);
  });

  it("returns trends.signals.length × STUB_MOTIVATORS_PER_TREND motivators (= 4)", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators.length).toBe(trends.signals.length * STUB_MOTIVATORS_PER_TREND);
    expect(out.motivators.length).toBe(4);
  });

  it("each motivator's parentTrendId matches a real trend id", async () => {
    const out = await runner.run(brief, ctx, trends);
    const realTrendIds = new Set(trends.signals.map((s) => s.id));
    for (const m of out.motivators) {
      expect(realTrendIds.has(m.parentTrendId)).toBe(true);
    }
  });

  it("motivator ids encode parent trend id with 1-based suffix", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(out.motivators[0]!.id).toBe("motivator-trend-brief-123-1-1");
    expect(out.motivators[1]!.id).toBe("motivator-trend-brief-123-1-2");
    expect(out.motivators[2]!.id).toBe("motivator-trend-brief-123-2-1");
    expect(out.motivators[3]!.id).toBe("motivator-trend-brief-123-2-2");
  });

  it("output schema validates", async () => {
    const out = await runner.run(brief, ctx, trends);
    expect(MotivatorsStageOutputSchema.safeParse(out).success).toBe(true);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await runner.run(brief, ctx, trends);
    const b = await runner.run(brief, ctx, trends);
    expect(a).toEqual(b);
  });
});
