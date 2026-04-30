import type {
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  PreproductionHook,
  PreproductionHookType,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { HooksStageRunner } from "./hooks-stage-runner.js";

export const STUB_HOOKS_PER_MOTIVATOR = 3;
const STUB_HOOK_TYPE_ROTATION: PreproductionHookType[] = [
  "direct_camera",
  "mid_action",
  "reaction",
];

// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.
export class StubHooksStageRunner implements HooksStageRunner {
  async run(
    brief: PcdBriefInput,
    _ctx: PcdIdentityContext,
    _trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput> {
    const hooks: PreproductionHook[] = [];
    for (const motivator of motivators.motivators) {
      for (let i = 1; i <= STUB_HOOKS_PER_MOTIVATOR; i++) {
        hooks.push({
          id: `hook-${motivator.id}-${i}`,
          text: `Stub hook ${i} for ${brief.productDescription}`,
          hookType: STUB_HOOK_TYPE_ROTATION[(i - 1) % STUB_HOOK_TYPE_ROTATION.length]!,
          parentMotivatorId: motivator.id,
          parentTrendId: motivator.parentTrendId,
        });
      }
    }
    return { hooks };
  }
}
