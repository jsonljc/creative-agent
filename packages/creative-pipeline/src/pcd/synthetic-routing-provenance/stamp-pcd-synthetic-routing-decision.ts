// SP18 — Pure stamper. Sole crypto-importing file across the SP18 surface
// (Guardrail D). Sole runtime import site for
// PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION (Guardrail C). Validates the input
// is a success-branch decision (TS at compile time + Zod at runtime — J3
// belt-and-suspenders), computes promptHash, pins the version, assembles the
// payload, defense-in-depth-re-parses the assembled payload.
//
// MERGE-BACK: emit WorkTrace here (synthetic routing decision stamped) — two
// emit points marked below.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type PcdSp18SyntheticRoutingProvenancePayload,
  PcdSp18SyntheticRoutingProvenancePayloadSchema,
  type SyntheticPcdRoutingDecision,
  SyntheticPcdRoutingDecisionSchema,
} from "@creativeagent/schemas";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

/**
 * Success-branch narrowing — Q6 / Guardrail A. The stamper accepts ONLY a
 * synthetic-pairing success decision. Delegation + denial branches fail at
 * compile time inside the package, and at runtime via the Step 1 refine.
 */
export type SyntheticPairingSuccessDecision = Extract<
  SyntheticPcdRoutingDecision,
  { allowed: true; kind: "synthetic_pairing" }
>;

export type StampPcdSyntheticRoutingDecisionInput = {
  syntheticDecision: SyntheticPairingSuccessDecision;
};

export type StampPcdSyntheticRoutingDecisionStores = {
  clock?: () => Date;
};

export async function stampPcdSyntheticRoutingDecision(
  input: StampPcdSyntheticRoutingDecisionInput,
  stores: StampPcdSyntheticRoutingDecisionStores,
): Promise<PcdSp18SyntheticRoutingProvenancePayload> {
  // Step 1 — Defense-in-depth runtime parse (J3 belt-and-suspenders).
  // Re-parse through the full 5-branch SyntheticPcdRoutingDecisionSchema and
  // then runtime-refine to the success branch. Catches external callers who
  // pass a runtime-shaped value through `unknown`.
  const decision = SyntheticPcdRoutingDecisionSchema.parse(input.syntheticDecision);
  if (!(decision.kind === "synthetic_pairing" && decision.allowed === true)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["syntheticDecision"],
        message: "SP18 stamper only accepts synthetic-pairing success decisions",
      },
    ]);
  }

  // Step 2 — Compute promptHash (J2). sha256 over UTF-8 bytes of
  // dallePromptLocked, lowercase hex, 64 chars.
  const promptHash = createHash("sha256").update(decision.dallePromptLocked, "utf8").digest("hex");

  // Step 3 — Wall-clock stamp (J6). Same convention as SP9/SP10A.
  const decidedAt = (stores.clock?.() ?? new Date()).toISOString();

  // Step 4 — Assemble the Json reason discriminated on videoProvider.
  // Build via narrow if/else so TypeScript narrowing keeps the direction
  // fields type-correct on each branch.
  const reasonBase = {
    pairingRefIndex: decision.pairingRefIndex,
    decisionReason: decision.decisionReason,
    decidedAt,
    syntheticRoutingProvenanceVersion: PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION,
  } as const;

  const syntheticRoutingDecisionReason =
    decision.videoProvider === "kling"
      ? {
          videoProvider: "kling" as const,
          klingDirection: decision.klingDirection,
          ...reasonBase,
        }
      : {
          videoProvider: "seedance" as const,
          seedanceDirection: decision.seedanceDirection,
          ...reasonBase,
        };

  // MERGE-BACK: emit WorkTrace here (Json reason assembled)

  // Step 5 — Assemble the flat-column payload from the decision verbatim (J7).
  // syntheticRouterVersion + syntheticPairingVersion are stamped from the
  // decision's emitted values, NOT from re-imports — forensic fidelity for
  // historical-replay drift.
  const payload = {
    imageProvider: decision.imageProvider,
    videoProvider: decision.videoProvider,
    videoProviderChoice: decision.videoProviderChoice,
    syntheticRouterVersion: decision.syntheticRouterVersion,
    syntheticPairingVersion: decision.pairingVersion,
    promptHash,
    syntheticRoutingDecisionReason,
  };

  // Step 6 — Defense-in-depth re-parse. Catches discriminator drift AND the
  // cross-field consistency invariant (payload.videoProvider must equal
  // syntheticRoutingDecisionReason.videoProvider) via the schema's .refine().
  // Both checks are structurally impossible on the happy path (stamper
  // constructs both from the same source value); the re-parse defends
  // against tampering.
  const validated = PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(payload);

  // MERGE-BACK: emit WorkTrace here (synthetic-routing payload validated)

  return validated;
}
