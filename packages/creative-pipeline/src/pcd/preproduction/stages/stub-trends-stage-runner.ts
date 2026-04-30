import type { PcdBriefInput, PcdIdentityContext, TrendStageOutput } from "@creativeagent/schemas";
import type { TrendsStageRunner } from "./trends-stage-runner.js";

export const STUB_TRENDS_FANOUT = 2;

// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    const signals = Array.from({ length: STUB_TRENDS_FANOUT }, (_, i) => ({
      id: `trend-${brief.briefId}-${i + 1}`,
      summary: `Stub trend signal ${i + 1} for ${brief.productDescription}`,
      audienceFit: brief.targetAudience,
      evidenceRefs: [],
    }));
    return { signals };
  }
}
