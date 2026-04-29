import type { PcdBriefInput, PcdIdentityContext, TrendStageOutput } from "@creativeagent/schemas";

// SP7 — trends stage. Real Switchboard runner is Claude-driven; this repo
// only ships the interface + a deterministic stub.
export interface TrendsStageRunner {
  run(brief: PcdBriefInput, identityContext: PcdIdentityContext): Promise<TrendStageOutput>;
}
