import type {
  CreatorScript,
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { CreatorScriptsStageRunner } from "./creator-scripts-stage-runner.js";

export const STUB_SCRIPTS_PER_HOOK = 2;

// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.
export class StubCreatorScriptsStageRunner implements CreatorScriptsStageRunner {
  async run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    _trends: TrendStageOutput,
    _motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput> {
    const scripts: CreatorScript[] = [];
    for (const hook of hooks.hooks) {
      for (let i = 1; i <= STUB_SCRIPTS_PER_HOOK; i++) {
        scripts.push({
          id: `script-${hook.id}-${i}`,
          hookText: hook.text,
          creatorAngle: `first-person operator angle ${i}`,
          visualBeats: ["show the problem", "show the product moment", "show the result"],
          productMoment: `${brief.productDescription} solving the friction`,
          cta: `Try it (variant ${i})`,
          complianceNotes: [],
          identityConstraints: {
            creatorIdentityId: identityContext.creatorIdentityId,
            productIdentityId: identityContext.productIdentityId,
            voiceId: identityContext.voiceId,
          },
          parentHookId: hook.id,
          scriptStyle: "talking_points",
          talkingPoints: [
            `Hook: ${hook.text}`,
            `Friction: stub motivator description ${i}`,
            `Outcome: ${brief.productDescription}`,
          ],
        });
      }
    }
    return { scripts };
  }
}
