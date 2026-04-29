import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";

export interface CreatorScriptsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput>;
}
