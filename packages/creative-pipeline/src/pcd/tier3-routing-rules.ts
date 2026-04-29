import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";

export type Tier3Rule = "first_last_frame_anchor" | "performance_transfer" | "edit_over_regenerate";

// MERGE-BACK: production implementer of CampaignTakeStore is owned by SP6
// ApprovalLifecycle / campaign-take persistence (Switchboard side). This SP4
// slice ships the contract only; in-tree consumers must inject either the
// SP6 production store at merge-back OR a local test fake. No in-tree
// production implementer is provided (deliberate — fake compliance was
// rejected during SP4 brainstorming). See docs/SWITCHBOARD-CONTEXT.md
// "SP4 (tier-based routing)" for the merge-back ownership note.
export type CampaignTakeStore = {
  hasApprovedTier3TakeForCampaign(input: {
    organizationId: string;
    campaignId: string;
  }): Promise<boolean>;
};

export type Tier3RoutingRuleStores = {
  campaignTakeStore: CampaignTakeStore;
};

export class Tier3RoutingViolationError extends Error {
  constructor(
    public readonly rule: Tier3Rule,
    public readonly provider: string,
  ) {
    super(
      `Tier 3 routing rule violated: ${rule} required but provider "${provider}" does not support it`,
    );
    this.name = "Tier3RoutingViolationError";
  }
}

export class Tier3RoutingMetadataMismatchError extends Error {
  constructor(
    public readonly expected: ReadonlyArray<Tier3Rule>,
    public readonly actual: ReadonlyArray<Tier3Rule>,
  ) {
    super(
      `Tier 3 routing metadata mismatch: expected rules [${expected.join(",")}] but routingDecisionReason.tier3RulesApplied was [${actual.join(",")}]`,
    );
    this.name = "Tier3RoutingMetadataMismatchError";
  }
}

const VIDEO_SHOTS: ReadonlySet<PcdShotType> = new Set<PcdShotType>([
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
]);

const PUBLISHABLE_INTENTS: ReadonlySet<OutputIntent> = new Set<OutputIntent>([
  "preview",
  "final_export",
  "meta_draft",
]);

export function requiresFirstLastFrameAnchor(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
}): boolean {
  return (
    input.effectiveTier === 3 &&
    VIDEO_SHOTS.has(input.shotType) &&
    PUBLISHABLE_INTENTS.has(input.outputIntent)
  );
}

export function requiresPerformanceTransfer(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
}): boolean {
  return input.effectiveTier === 3 && input.shotType === "talking_head";
}

export async function requiresEditOverRegenerate(
  input: {
    effectiveTier: IdentityTier;
    organizationId: string;
    campaignId: string;
  },
  stores: Tier3RoutingRuleStores,
): Promise<boolean> {
  if (input.effectiveTier !== 3) return false;
  return stores.campaignTakeStore.hasApprovedTier3TakeForCampaign({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
  });
}

export function assertTier3RoutingDecisionCompliant(input: {
  effectiveTier: IdentityTier;
  shotType: PcdShotType;
  outputIntent: OutputIntent;
  selectedCapability: PcdProviderCapability;
  tier3RulesApplied: ReadonlyArray<Tier3Rule>;
  editOverRegenerateRequired: boolean;
}): void {
  if (input.effectiveTier !== 3) return;

  // Step A — recompute the required-rule set from authoritative sources
  // (pure predicates for rules 1/2; explicit boolean for rule 3). Never
  // read tier3RulesApplied as enforcement input.
  const required: Tier3Rule[] = [];
  if (
    requiresFirstLastFrameAnchor({
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
      outputIntent: input.outputIntent,
    })
  ) {
    required.push("first_last_frame_anchor");
  }
  if (
    requiresPerformanceTransfer({
      effectiveTier: input.effectiveTier,
      shotType: input.shotType,
    })
  ) {
    required.push("performance_transfer");
  }
  if (input.editOverRegenerateRequired) {
    required.push("edit_over_regenerate");
  }

  // Step B — capability check. For each required rule, the selected
  // capability must have the matching support flag.
  for (const rule of required) {
    if (rule === "first_last_frame_anchor" && !input.selectedCapability.supportsFirstLastFrame) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (rule === "performance_transfer" && !input.selectedCapability.supportsPerformanceTransfer) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
    if (rule === "edit_over_regenerate" && !input.selectedCapability.supportsEditExtend) {
      throw new Tier3RoutingViolationError(rule, input.selectedCapability.provider);
    }
  }

  // Step C — forensic consistency. tier3RulesApplied (caller-supplied) must
  // exactly equal the recomputed required set as a set (order-independent).
  // Capability check passes, but a forensic-record mismatch is its own
  // distinct error so investigations can tell the two failure modes apart.
  const reqSet = new Set<Tier3Rule>(required);
  const actSet = new Set<Tier3Rule>(input.tier3RulesApplied);
  if (reqSet.size !== actSet.size || ![...reqSet].every((r) => actSet.has(r))) {
    throw new Tier3RoutingMetadataMismatchError(required, input.tier3RulesApplied);
  }
}
