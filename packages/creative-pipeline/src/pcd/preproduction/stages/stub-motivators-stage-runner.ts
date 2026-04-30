import type {
  Motivator,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { MotivatorsStageRunner } from "./motivators-stage-runner.js";

export const STUB_MOTIVATORS_PER_TREND = 2;

// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.
export class StubMotivatorsStageRunner implements MotivatorsStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput> {
    const motivators: Motivator[] = [];
    for (const trend of trends.signals) {
      for (let i = 1; i <= STUB_MOTIVATORS_PER_TREND; i++) {
        motivators.push({
          id: `motivator-${trend.id}-${i}`,
          frictionOrDesire: `Stub motivator ${i} linked to ${trend.id}`,
          audienceSegment: brief.targetAudience,
          evidenceRefs: [],
          parentTrendId: trend.id,
        });
      }
    }
    return { motivators };
  }
}
