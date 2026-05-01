// PCD — Product/Creator Definition primitives
// SP1: registry-backfill (Inngest function)
// SP2: tier-policy (pure deterministic gate)
// SP3: registry-resolver (per-job identity context resolver) + shot-spec-version constant
export * from "./pcd/registry-backfill.js";
export { decidePcdGenerationAccess, PCD_TIER_POLICY_VERSION } from "./pcd/tier-policy.js";
export type { DecidePcdGenerationAccessInput } from "./pcd/tier-policy.js";
export {
  resolvePcdRegistryContext,
  type PcdResolvableJob,
  type RegistryResolverStores,
  type ResolvedPcdContext,
} from "./pcd/registry-resolver.js";
export { PCD_SHOT_SPEC_VERSION } from "./pcd/shot-spec-version.js";

// SP4: provider routing + identity snapshot writer
export {
  PCD_PROVIDER_CAPABILITY_VERSION,
  PCD_PROVIDER_CAPABILITY_MATRIX,
  type PcdProviderCapability,
} from "./pcd/provider-capability-matrix.js";

export {
  PCD_PROVIDER_ROUTER_VERSION,
  routePcdShot,
  type ApprovedCampaignContext,
  type PcdRoutingDecision,
  type ProviderRouterStores,
  type RoutePcdShotInput,
} from "./pcd/provider-router.js";

export {
  writePcdIdentitySnapshot,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotStoreInput,
  type PcdIdentitySnapshotWriterStores,
  type WritePcdIdentitySnapshotInput,
} from "./pcd/pcd-identity-snapshot-writer.js";

export {
  Tier3RoutingMetadataMismatchError,
  Tier3RoutingViolationError,
  assertTier3RoutingDecisionCompliant,
  requiresEditOverRegenerate,
  requiresFirstLastFrameAnchor,
  requiresPerformanceTransfer,
  type CampaignTakeStore,
  type Tier3Rule,
  type Tier3RoutingRuleStores,
} from "./pcd/tier3-routing-rules.js";

// SP5: QC gates
export { PCD_QC_EVALUATION_VERSION } from "./pcd/qc-evaluation-version.js";

export {
  PCD_QC_GATE_MATRIX,
  PCD_QC_GATE_MATRIX_VERSION,
  getPcdQcGateApplicability,
} from "./pcd/qc-gate-matrix.js";

export type {
  SimilarityProvider,
  OcrProvider,
  GeometryProvider,
  PcdQcProviders,
} from "./pcd/qc-providers.js";

export {
  runFaceSimilarityGate,
  FACE_SIMILARITY_THRESHOLD,
  type FaceSimilarityGateInput,
} from "./pcd/qc-face-similarity.js";

export {
  runLogoSimilarityGate,
  LOGO_SIMILARITY_THRESHOLD,
  type LogoSimilarityGateInput,
} from "./pcd/qc-logo-similarity.js";

export {
  runOcrPackageTextGate,
  OCR_EDIT_DISTANCE_THRESHOLD,
  type OcrPackageTextGateInput,
} from "./pcd/qc-ocr-match.js";

export {
  runGeometryScaleGate,
  GEOMETRY_SCORE_THRESHOLD,
  SCALE_CONFIDENCE_THRESHOLD,
  type GeometryScaleGateInput,
} from "./pcd/qc-geometry.js";

export { applyPcdQcGateMode, aggregatePcdQcGateVerdicts } from "./pcd/qc-aggregator.js";

export {
  evaluatePcdQcResult,
  type EvaluatePcdQcResultInput,
  type EvaluatePcdQcResultStores,
  type PcdQcLedgerStore,
} from "./pcd/qc-evaluator.js";

// SP7: preproduction chain schemas (re-exported so consumers import from one place)
export {
  PcdProductionFanoutDecisionSchema,
  type PcdProductionFanoutDecision,
} from "@creativeagent/schemas";

// SP7: identity-aware pre-production chain + single production gate
export * from "./pcd/preproduction/index.js";

// SP9: creative-source provenance
export * from "./pcd/provenance/index.js";

// SP10A — cost forecast
export * from "./pcd/cost/index.js";

// SP6: lifecycle gates — approval / final-export / meta-draft / consent
export { PCD_APPROVAL_LIFECYCLE_VERSION } from "./pcd/approval-lifecycle-version.js";
export { PCD_CONSENT_REVOCATION_VERSION } from "./pcd/consent-revocation-version.js";

export { InvariantViolationError } from "./pcd/invariant-violation-error.js";
export { ConsentRevokedRefusalError } from "./pcd/consent-revocation-error.js";

export type {
  AssetRecordReader,
  ProductQcResultReader,
  PcdIdentitySnapshotReader,
  ConsentRecordReader,
  CreativeJobReader,
  CreatorIdentityReader,
} from "./pcd/lifecycle-readers.js";

export {
  AlwaysOpenExportGateState,
  type ExportGateOpenness,
  type ExportGateState,
} from "./pcd/export-gate-state.js";

export {
  AlwaysPassComplianceCheck,
  type ComplianceCheck,
  type ComplianceCheckInput,
  type ComplianceCheckResult,
} from "./pcd/compliance-check.js";

export {
  decidePcdApprovalAdvancement,
  type DecidePcdApprovalAdvancementInput,
  type DecidePcdApprovalAdvancementStores,
} from "./pcd/approval-advancement.js";

export {
  decidePcdFinalExportGate,
  type DecidePcdFinalExportGateInput,
  type DecidePcdFinalExportGateStores,
} from "./pcd/final-export-gate.js";

export {
  decidePcdMetaDraftGate,
  type DecidePcdMetaDraftGateInput,
  type DecidePcdMetaDraftGateStores,
} from "./pcd/meta-draft-gate.js";

export {
  propagateConsentRevocation,
  type ConsentRevocationStore,
  type PropagateConsentRevocationInput,
  type PropagateConsentRevocationStores,
} from "./pcd/consent-revocation.js";

export {
  assertConsentNotRevokedForGeneration,
  type AssertConsentNotRevokedForGenerationInput,
  type AssertConsentNotRevokedForGenerationStores,
} from "./pcd/consent-pre-check-generation.js";

export {
  assertConsentNotRevokedForEdit,
  type AssertConsentNotRevokedForEditInput,
  type AssertConsentNotRevokedForEditStores,
} from "./pcd/consent-pre-check-edit.js";
