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
