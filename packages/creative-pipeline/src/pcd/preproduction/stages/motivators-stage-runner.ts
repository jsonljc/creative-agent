import type {
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface MotivatorsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput>;
}
