import type {
  CreatorScriptsStageOutput,
  HooksStageOutput,
  MotivatorsStageOutput,
  PcdBriefInput,
  PcdIdentityContext,
  TrendStageOutput,
} from "@creativeagent/schemas";
import type { CreatorScriptsStageRunner } from "./creator-scripts-stage-runner.js";

// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.
export class StubCreatorScriptsStageRunner implements CreatorScriptsStageRunner {
  async run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    _trends: TrendStageOutput,
    _motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput> {
    const hook = hooks.hooks[0]!;
    return {
      scripts: [
        {
          id: `script-${brief.briefId}-1`,
          hookText: hook.text,
          creatorAngle: "first-person operator explaining the friction",
          visualBeats: ["show the problem", "show the product moment", "show the result"],
          productMoment: `${brief.productDescription} solving the friction`,
          cta: "Try it",
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
            `Friction: stub motivator description`,
            `Outcome: ${brief.productDescription}`,
          ],
        },
      ],
    };
  }
}
