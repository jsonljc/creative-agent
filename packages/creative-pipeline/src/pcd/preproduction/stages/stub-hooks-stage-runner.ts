import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { HooksStageRunner } from "./hooks-stage-runner.js";

// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.
export class StubHooksStageRunner implements HooksStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput> {
    const parentTrendId = trends.signals[0]!.id;
    const parentMotivatorId = motivators.motivators[0]!.id;
    return {
      hooks: [
        {
          id: `hook-${brief.briefId}-1`,
          text: `Stub hook for ${brief.productDescription}`,
          hookType: "direct_camera",
          parentMotivatorId,
          parentTrendId,
        },
      ],
    };
  }
}
