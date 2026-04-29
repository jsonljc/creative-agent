// SP7 — Identity-Aware Pre-Production Chain schemas.
// Source of truth: docs/plans/2026-04-29-pcd-preproduction-chain-sp7-design.md
import { z } from "zod";
import {
  IdentityTierSchema as _IdentityTierSchema,
  OutputIntentSchema as _OutputIntentSchema,
  PcdShotTypeSchema as _PcdShotTypeSchema,
} from "./pcd-identity.js";

// Stage discriminant for PreproductionChainError. Also used by anti-pattern
// grep tests to enforce that no SP7 source dispatches by stage name outside
// the error-class discriminator.
export const PreproductionChainStageEnumSchema = z.enum([
  "trends",
  "motivators",
  "hooks",
  "creator_scripts",
  "production_fanout_gate",
]);
export type PreproductionChainStage = z.infer<typeof PreproductionChainStageEnumSchema>;

// UGC creative-format constraints. Lives in PcdIdentityContext so every stage
// runner consumes the same UGC-format ground truth — prevents drift toward
// polished ad-film language.
export const UgcStyleConstraintSchema = z.enum([
  "native_vertical",                  // 9:16 selfie-style framing
  "creator_led",                      // first-person creator voice
  "no_overproduced_storyboard",       // no studio-shoot framing
  "product_fidelity_required",        // canonical text/logo faithfulness
  "no_invented_product_claims",       // no claims absent from registry
]);
export type UgcStyleConstraint = z.infer<typeof UgcStyleConstraintSchema>;
