import type {
  IdentityTier,
  OutputIntent,
  PcdRoutingDecisionReason,
  PcdShotType,
  PcdTierDecision,
} from "@creativeagent/schemas";
import type { ResolvedPcdContext } from "./registry-resolver.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import {
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type CampaignTakeStore,
  type Tier3Rule,
} from "./tier3-routing-rules.js";

export const PCD_PROVIDER_ROUTER_VERSION = "provider-router@1.0.0";

export type ApprovedCampaignContext =
  | { kind: "campaign"; organizationId: string; campaignId: string }
  | { kind: "none" };

export type ProviderRouterStores = {
  campaignTakeStore: CampaignTakeStore;
};

export type RoutePcdShotInput = {
  resolvedContext: ResolvedPcdContext;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  approvedCampaignContext: ApprovedCampaignContext;
};

export type PcdRoutingDecision =
  | {
      allowed: false;
      denialKind: "ACCESS_POLICY";
      accessDecision: PcdTierDecision;
    }
  | {
      allowed: false;
      denialKind: "NO_PROVIDER_CAPABILITY";
      accessDecision: PcdTierDecision;
      reason: "no provider satisfies tier3 routing rules for this shot";
      requiredActions: ReadonlyArray<"choose_safer_shot_type">;
      candidatesEvaluated: number;
      candidatesAfterTier3Filter: number;
    }
  | {
      allowed: true;
      accessDecision: PcdTierDecision;
      selectedCapability: PcdProviderCapability;
      selectedProvider: string;
      providerCapabilityVersion: typeof PCD_PROVIDER_CAPABILITY_VERSION;
      routerVersion: typeof PCD_PROVIDER_ROUTER_VERSION;
      decisionReason: PcdRoutingDecisionReason;
    };

function buildSelectionRationale(
  effectiveTier: IdentityTier,
  shotType: PcdShotType,
  outputIntent: OutputIntent,
  selectedProvider: string,
  rulesApplied: ReadonlyArray<Tier3Rule>,
): string {
  const rulesPart =
    rulesApplied.length === 0 ? "no tier3 rules" : `tier3 rules [${rulesApplied.join(",")}]`;
  const out = `tier=${effectiveTier} shot=${shotType} intent=${outputIntent} → ${selectedProvider} (${rulesPart})`;
  return out.length > 200 ? out.slice(0, 200) : out;
}

export async function routePcdShot(
  input: RoutePcdShotInput,
  stores: ProviderRouterStores,
): Promise<PcdRoutingDecision> {
  const { resolvedContext, shotType, outputIntent, approvedCampaignContext } = input;

  // Step 1 — Tier policy gate.
  const accessDecision = decidePcdGenerationAccess({
    avatarTier: resolvedContext.creatorTier,
    productTier: resolvedContext.productTier,
    shotType,
    outputIntent,
  });
  if (!accessDecision.allowed) {
    return { allowed: false, denialKind: "ACCESS_POLICY", accessDecision };
  }

  // Step 2 — Matrix candidate set.
  let candidates = PCD_PROVIDER_CAPABILITY_MATRIX.filter(
    (c) =>
      c.tiers.includes(resolvedContext.effectiveTier) &&
      c.shotTypes.includes(shotType) &&
      c.outputIntents.includes(outputIntent),
  );
  const candidatesEvaluated = candidates.length;

  // Step 3 — Tier 3 rule application.
  const tier3RulesApplied: Tier3Rule[] = [];
  if (resolvedContext.effectiveTier === 3) {
    if (
      requiresFirstLastFrameAnchor({
        effectiveTier: resolvedContext.effectiveTier,
        shotType,
        outputIntent,
      })
    ) {
      candidates = candidates.filter((c) => c.supportsFirstLastFrame);
      tier3RulesApplied.push("first_last_frame_anchor");
    }
    if (
      requiresPerformanceTransfer({
        effectiveTier: resolvedContext.effectiveTier,
        shotType,
      })
    ) {
      candidates = candidates.filter((c) => c.supportsPerformanceTransfer);
      tier3RulesApplied.push("performance_transfer");
    }
    if (approvedCampaignContext.kind === "campaign") {
      const editOverRegenerateRequired = await requiresEditOverRegenerate(
        {
          effectiveTier: resolvedContext.effectiveTier,
          organizationId: approvedCampaignContext.organizationId,
          campaignId: approvedCampaignContext.campaignId,
        },
        stores,
      );
      if (editOverRegenerateRequired) {
        candidates = candidates.filter((c) => c.supportsEditExtend);
        tier3RulesApplied.push("edit_over_regenerate");
      }
    }
  }
  const candidatesAfterTier3Filter = candidates.length;

  // Step 4 — Selection or empty-candidates denial.
  const selected = candidates[0];
  if (selected === undefined) {
    return {
      allowed: false,
      denialKind: "NO_PROVIDER_CAPABILITY",
      accessDecision,
      reason: "no provider satisfies tier3 routing rules for this shot",
      requiredActions: ["choose_safer_shot_type"],
      candidatesEvaluated,
      candidatesAfterTier3Filter,
    };
  }

  // Step 5 — Build allowed decision.
  return {
    allowed: true,
    accessDecision,
    selectedCapability: selected,
    selectedProvider: selected.provider,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    decisionReason: {
      capabilityRefIndex: PCD_PROVIDER_CAPABILITY_MATRIX.indexOf(selected),
      matchedShotType: shotType,
      matchedEffectiveTier: resolvedContext.effectiveTier,
      matchedOutputIntent: outputIntent,
      tier3RulesApplied,
      candidatesEvaluated,
      candidatesAfterTier3Filter,
      selectionRationale: buildSelectionRationale(
        resolvedContext.effectiveTier,
        shotType,
        outputIntent,
        selected.provider,
        tier3RulesApplied,
      ),
    },
  };
}
