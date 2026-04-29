import type {
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { MotivatorsStageRunner } from "./motivators-stage-runner.js";

// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.
export class StubMotivatorsStageRunner implements MotivatorsStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput> {
    const parentTrendId = trends.signals[0]!.id;
    return {
      motivators: [
        {
          id: `motivator-${brief.briefId}-1`,
          frictionOrDesire: `Stub motivator linked to ${parentTrendId}`,
          audienceSegment: brief.targetAudience,
          evidenceRefs: [],
          parentTrendId,
        },
      ],
    };
  }
}
