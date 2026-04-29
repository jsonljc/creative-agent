import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface HooksStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput>;
}
