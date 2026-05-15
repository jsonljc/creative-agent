// PCD slice SP16 — Synthetic-creator provider-routing zod surface. Two schemas:
//   1. PcdRoutingDecisionSchema — net-new zod analogue of SP4's
//      TypeScript-only PcdRoutingDecision (defined inline in
//      packages/creative-pipeline/src/pcd/provider-router.ts:40-63). SP4
//      itself ships only the TS type for the union, although the inner
//      decisionReason field has long had a zod analogue
//      (PcdRoutingDecisionReasonSchema in pcd-identity.ts:185, the SP4
//      enum-typed source of truth). The schema below mirrors SP4's
//      union shape and re-uses PcdRoutingDecisionReasonSchema verbatim
//      for the success branch's decisionReason — no duplicate enum
//      definition. SP16's delegation branch needs a zod-parseable union
//      for round-tripping decisions, hence this top-level schema.
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
  PcdRoutingDecisionReasonSchema,
  PcdShotTypeSchema,
} from "./pcd-identity.js";
import { PcdTierDecisionSchema } from "./pcd-tier-policy.js";

// SP4 PcdRoutingDecision — three structural branches mirrored verbatim.
// `provider` stays as a free string — SP4 has no exported provider enum
// (rows use literals "openai_text" / "runway" / "kling" / "heygen").
// Tightening here would risk drift if SP4 adds a row. `tier3RulesApplied`
// uses PcdRoutingDecisionReasonSchema's strict enum (the SP4 source of truth).
export const PcdRoutingDecisionSchema = z.union([
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("ACCESS_POLICY"),
      accessDecision: PcdTierDecisionSchema.readonly(),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(false),
      denialKind: z.literal("NO_PROVIDER_CAPABILITY"),
      accessDecision: PcdTierDecisionSchema.readonly(),
      reason: z.literal("no provider satisfies tier3 routing rules for this shot"),
      requiredActions: z.array(z.literal("choose_safer_shot_type")).readonly(),
      candidatesEvaluated: z.number().int().min(0),
      candidatesAfterTier3Filter: z.number().int().min(0),
    })
    .readonly(),
  z
    .object({
      allowed: z.literal(true),
      accessDecision: PcdTierDecisionSchema.readonly(),
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
      decisionReason: PcdRoutingDecisionReasonSchema.readonly(),
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
      accessDecision: PcdTierDecisionSchema.readonly(),
      syntheticRouterVersion: z.string().min(1),
    })
    .readonly(),
  // Synthetic path — allowed.
  z
    .object({
      allowed: z.literal(true),
      kind: z.literal("synthetic_pairing"),
      accessDecision: PcdTierDecisionSchema.readonly(),
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
