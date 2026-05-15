// PCD slice SP16 — Synthetic-creator provider-routing zod surface. Two
// schemas:
//   1. PcdRoutingDecisionSchema — net-new zod analogue of SP4's
//      TypeScript-only PcdRoutingDecision (defined inline in
//      packages/creative-pipeline/src/pcd/provider-router.ts). SP4 ships
//      the TS type but no zod schema; SP16's delegation branch needs a
//      zod-parseable union for round-tripping decisions. The structure
//      here is the authoritative parse contract; the SP4 TS type is a
//      structural subset.
//   2. SyntheticPcdRoutingDecisionSchema — SP16's own three-branch
//      decision union: synthetic-pairing allowed, synthetic-pairing
//      denied (ACCESS_POLICY), and delegated_to_generic_router (carries
//      the embedded SP4 decision wholesale).
//
// MERGE-BACK: At Switchboard integration time, SP4's TS type and the
// PcdRoutingDecisionSchema below must be kept in sync. SP17 will be the
// first slice to persist PcdRoutingDecision, at which point SP17 owns
// the source-of-truth move (likely into pcd-provenance.ts or a net-new
// pcd-provider-router.ts). For now SP16 owns this schema. The drift
// between SP4's TS type and this zod schema is mitigated by real-call
// drift tests in route-synthetic-pcd-shot.test.ts (Task 11).
//
// Decision struct is zod-only in SP16. Persistence is SP17's
// responsibility (SP9 provenance widen) — SP17 will add imageProvider,
// videoProvider, syntheticRouterVersion, pairingVersion, and
// sha256(dallePromptLocked) to PcdIdentitySnapshot per umbrella §5
// line 263. Whether SP17 also persists klingDirection verbatim, or
// hashes it, is SP17's decision.
import { z } from "zod";
import { KlingDirectionSchema } from "./creator-identity-synthetic.js";
import {
  IdentityTierSchema,
  OutputIntentSchema,
  PcdShotTypeSchema,
} from "./pcd-identity.js";
import { PcdTierDecisionSchema } from "./pcd-tier-policy.js";

// SP4 PcdRoutingDecision — three structural branches mirrored verbatim.
// `provider` stays as a free string — SP4 has no exported provider enum
// (rows use literals "openai_text" / "runway" / "kling" / "heygen").
// Tightening here would risk drift if SP4 adds a row. Same rationale for
// `tier3RulesApplied` (free string array — SP4 owns the literal set).
export const PcdRoutingDecisionSchema = z.union([
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema,
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("NO_PROVIDER_CAPABILITY"),
      accessDecision: PcdTierDecisionSchema,
      reason: z.literal("no provider satisfies tier3 routing rules for this shot"),
      requiredActions: z.array(z.literal("choose_safer_shot_type")).readonly(),
      candidatesEvaluated: z.number().int().min(0),
      candidatesAfterTier3Filter: z.number().int().min(0),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(true),
      accessDecision: PcdTierDecisionSchema,
      selectedCapability: z
        .object({
          provider: z.string().min(1),
          tiers: z.array(IdentityTierSchema).readonly(),
          shotTypes: z.array(PcdShotTypeSchema).readonly(),
          outputIntents: z.array(OutputIntentSchema).readonly(),
          supportsFirstLastFrame: z.boolean(),
          supportsEditExtend: z.boolean(),
          supportsPerformanceTransfer: z.boolean(),
        })
        .readonly(),
      selectedProvider: z.string().min(1),
      providerCapabilityVersion: z.string().min(1),
      routerVersion: z.string().min(1),
      decisionReason: z
        .object({
          capabilityRefIndex: z.number().int().min(0),
          matchedShotType: PcdShotTypeSchema,
          matchedEffectiveTier: IdentityTierSchema,
          matchedOutputIntent: OutputIntentSchema,
          tier3RulesApplied: z.array(z.string().min(1)).readonly(),
          candidatesEvaluated: z.number().int().min(0),
          candidatesAfterTier3Filter: z.number().int().min(0),
          selectionRationale: z.string().min(1).max(200),
        })
        .readonly(),
    })
    .readonly(),
]);
export type PcdRoutingDecisionParsed = z.infer<typeof PcdRoutingDecisionSchema>;

// NB: `z.union` not `z.discriminatedUnion`. Same NB carve-out as SP13 /
// SP14 / SP15 — Zod 3.x's discriminatedUnion factory does not see literal
// discriminators on branches wrapped in `.readonly()`. `z.union` parses
// by trying members in order; semantically equivalent for our three-
// branch decision shape.
export const SyntheticPcdRoutingDecisionSchema = z.union([
  // Synthetic path — tier policy denied.
  z
    .object({
      allowed: z.literal(false),
      kind: z.literal("synthetic_pairing"),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema,
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),
  // Synthetic path — allowed.
  z
    .object({
      allowed: z.literal(true),
      kind: z.literal("synthetic_pairing"),
      accessDecision: PcdTierDecisionSchema,
      imageProvider: z.literal("dalle"),
      videoProvider: z.literal("kling"),
      dallePromptLocked: z.string().min(1).max(4000),
      klingDirection: KlingDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      pairingVersion: z.string().min(1),
      syntheticRouterVersion: z.string().min(1),
      decisionReason: z
        .object({
          matchedShotType: PcdShotTypeSchema,
          matchedOutputIntent: OutputIntentSchema,
          selectionRationale: z.string().min(1).max(200),
        })
        .readonly(),
    })
    .readonly(),
  // Delegation path — out-of-pairing shot type, SP4 ran.
  z
    .object({
      kind: z.literal("delegated_to_generic_router"),
      reason: z.literal("shot_type_not_in_synthetic_pairing"),
      shotType: PcdShotTypeSchema,
      sp4Decision: PcdRoutingDecisionSchema,
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),
]);
export type SyntheticPcdRoutingDecision = z.infer<typeof SyntheticPcdRoutingDecisionSchema>;
