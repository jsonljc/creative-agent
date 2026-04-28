import {
  type IdentityTier,
  type OutputIntent,
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
  const effectiveTier = (Math.min(input.avatarTier ?? 1, input.productTier ?? 1) as IdentityTier);

  // Step 1 — Draft shortcut.
  if (input.outputIntent === "draft") {
    return { allowed: true, effectiveTier };
  }

  // Full logic wired in Task 4.
  return { allowed: true, effectiveTier };
}
