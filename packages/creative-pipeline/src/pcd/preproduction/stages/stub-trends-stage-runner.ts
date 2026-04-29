import type { PcdBriefInput, PcdIdentityContext, TrendStageOutput } from "@creativeagent/schemas";
import type { TrendsStageRunner } from "./trends-stage-runner.js";

// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    return {
      signals: [
        {
          id: `trend-${brief.briefId}-1`,
          summary: `Stub trend signal for ${brief.productDescription}`,
          audienceFit: brief.targetAudience,
          evidenceRefs: [],
        },
      ],
    };
  }
}
