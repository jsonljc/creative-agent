import { z } from "zod";
import {
  type PcdPreproductionChainResult,
  type PcdSp9ProvenancePayload,
} from "@creativeagent/schemas";
import {
  assertConsentNotRevokedForGeneration,
  type AssertConsentNotRevokedForGenerationStores,
} from "../consent-pre-check-generation.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PCD_PREPRODUCTION_CHAIN_VERSION } from "../preproduction/preproduction-chain-version.js";
import { PCD_PROVENANCE_VERSION } from "./provenance-version.js";

/**
 * SP9 — Pure store-injected stamper. Walks the SP7/SP8 chain output to derive
 * the leaf-to-root lineage for the selected script, re-checks consent (defense
 * against revocation between gate decision and per-asset persistence), and
 * returns a payload for the SP4 writer's persistence path.
 *
 * Two consent-check invocations bracket the production-time interval by design:
 *   1. SP7 entry (existing): assertConsentNotRevokedForGeneration before the chain runs.
 *   2. SP9 stamp (this call): same check before each per-asset snapshot is written.
 *
 * Symmetric with SP6's assertConsentNotRevokedForEdit pattern.
 */
export type StampPcdProvenanceInput = {
  briefId: string;
  creatorIdentityId: string;
  scriptId: string;
  chainResult: PcdPreproductionChainResult;
  fanoutDecisionId: string;
};

const StampPcdProvenanceInputSchema = z.object({
  briefId: z.string().min(1),
  creatorIdentityId: z.string().min(1),
  scriptId: z.string().min(1),
  // chainResult is structurally validated by SP7's PcdPreproductionChainResultSchema upstream;
  // a second parse here would duplicate work and bloat the test surface. We treat it as
  // pre-validated and only walk it. If a caller passes corrupt structure, the lineage
  // walk throws InvariantViolationError, which is the intended forensic mode.
  chainResult: z.unknown(),
  fanoutDecisionId: z.string().min(1),
});

export type StampPcdProvenanceStores = AssertConsentNotRevokedForGenerationStores & {
  clock?: () => Date;
};

export async function stampPcdProvenance(
  input: StampPcdProvenanceInput,
  stores: StampPcdProvenanceStores,
): Promise<PcdSp9ProvenancePayload> {
  // Step 1 — defense-in-depth zod parse on string ids.
  StampPcdProvenanceInputSchema.parse(input);

  // Step 2 — lineage walk (leaf to root). Throws InvariantViolationError on
  // any missing parent rung. The walk is the second-line forensic guard;
  // upstream stage runners' parent-id correctness is the first.
  const { chainResult, scriptId } = input;
  const script = chainResult.stageOutputs.scripts.scripts.find((s) => s.id === scriptId);
  if (script === undefined) {
    throw new InvariantViolationError("provenance script id not in chain output", {
      scriptId,
      missingAt: "scripts",
    });
  }
  const hook = chainResult.stageOutputs.hooks.hooks.find((h) => h.id === script.parentHookId);
  if (hook === undefined) {
    throw new InvariantViolationError("provenance hook ancestor not in chain output", {
      scriptId,
      parentHookId: script.parentHookId,
      missingAt: "hooks",
    });
  }
  const motivator = chainResult.stageOutputs.motivators.motivators.find(
    (m) => m.id === hook.parentMotivatorId,
  );
  if (motivator === undefined) {
    throw new InvariantViolationError("provenance motivator ancestor not in chain output", {
      scriptId,
      parentMotivatorId: hook.parentMotivatorId,
      missingAt: "motivators",
    });
  }
  const trend = chainResult.stageOutputs.trends.signals.find(
    (t) => t.id === motivator.parentTrendId,
  );
  if (trend === undefined) {
    throw new InvariantViolationError("provenance trend ancestor not in chain output", {
      scriptId,
      parentTrendId: motivator.parentTrendId,
      missingAt: "trends",
    });
  }

  // MERGE-BACK: emit WorkTrace here (lineage walk completed)

  // Step 3 — second consent check (defense against revocation between
  // gate decision and per-asset stamp). Symmetric with SP6's pre-check.
  // Throws ConsentRevokedRefusalError or InvariantViolationError on failure.
  await assertConsentNotRevokedForGeneration(
    { creatorIdentityId: input.creatorIdentityId },
    {
      creatorIdentityReader: stores.creatorIdentityReader,
      consentRecordReader: stores.consentRecordReader,
    },
  );

  // MERGE-BACK: emit WorkTrace here (consent re-check passed)

  // Step 4 — assemble the payload, pinning versions from imports.
  const decidedAt = (stores.clock?.() ?? new Date()).toISOString();
  const payload: PcdSp9ProvenancePayload = {
    briefId: input.briefId,
    trendId: trend.id,
    motivatorId: motivator.id,
    hookId: hook.id,
    scriptId: script.id,
    lineageDecisionReason: {
      decidedAt,
      fanoutDecisionId: input.fanoutDecisionId,
      chainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
      provenanceVersion: PCD_PROVENANCE_VERSION,
    },
  };

  // MERGE-BACK: emit WorkTrace here (provenance payload assembled)

  return payload;
}
