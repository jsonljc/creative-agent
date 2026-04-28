import {
  type IdentityTier,
  type OutputIntent,
  type PcdRequiredAction,
  type PcdShotType,
  type PcdTierDecision,
} from "@creativeagent/schemas";

export const PCD_TIER_POLICY_VERSION = "tier-policy@1.0.0";

export type DecidePcdGenerationAccessInput = {
  avatarTier?: IdentityTier;
  productTier?: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
};

export function decidePcdGenerationAccess(
  input: DecidePcdGenerationAccessInput,
): PcdTierDecision {
  const a: IdentityTier = (input.avatarTier ?? 1) as IdentityTier;
  const p: IdentityTier = (input.productTier ?? 1) as IdentityTier;
  const effectiveTier: IdentityTier = (a <= p ? a : p) as IdentityTier;

  // Step 1 — Draft shortcut. Internal-only, never publishable.
  if (input.outputIntent === "draft") {
    return { allowed: true, effectiveTier };
  }

  // Steps 2–4 — Compose total requirements.
  let requiredAvatarTier: IdentityTier = 1;
  let requiredProductTier: IdentityTier = 1;
  if (input.shotType === "face_closeup") requiredAvatarTier = 3;
  if (input.shotType === "label_closeup") requiredProductTier = 3;
  if (input.shotType === "object_insert") requiredProductTier = 3;
  if (input.outputIntent === "final_export" || input.outputIntent === "meta_draft") {
    if (requiredAvatarTier < 2) requiredAvatarTier = 2;
    if (requiredProductTier < 2) requiredProductTier = 2;
  }

  // Step 5 — Compare actuals and aggregate actions.
  const actions: PcdRequiredAction[] = [];
  if (a < requiredAvatarTier) actions.push("upgrade_avatar_identity");
  if (p < requiredProductTier) actions.push("upgrade_product_identity");
  if (
    (input.outputIntent === "final_export" || input.outputIntent === "meta_draft") &&
    effectiveTier < 2
  ) {
    if (!actions.includes("use_lower_output_intent")) {
      actions.push("use_lower_output_intent");
    }
  }

  // Step 6 — Decide.
  const passes = actions.length === 0;
  if (passes) {
    return { allowed: true, effectiveTier };
  }

  return {
    allowed: false,
    effectiveTier,
    requiredAvatarTier,
    requiredProductTier,
    reason: buildReason(requiredAvatarTier, requiredProductTier),
    requiredActions: canonicalize(actions),
  };
}

function buildReason(reqA: IdentityTier, reqP: IdentityTier): string {
  const aboveA = reqA > 1;
  const aboveP = reqP > 1;
  if (aboveA && aboveP) {
    return `generation requires avatarTier>=${reqA} and productTier>=${reqP}`;
  }
  if (aboveA) return `generation requires avatarTier>=${reqA}`;
  return `generation requires productTier>=${reqP}`;
}

const ACTION_ORDER: readonly PcdRequiredAction[] = [
  "upgrade_avatar_identity",
  "upgrade_product_identity",
  "use_lower_output_intent",
  "choose_safer_shot_type",
];

function canonicalize(actions: PcdRequiredAction[]): PcdRequiredAction[] {
  const set = new Set(actions);
  return ACTION_ORDER.filter((a) => set.has(a));
}
