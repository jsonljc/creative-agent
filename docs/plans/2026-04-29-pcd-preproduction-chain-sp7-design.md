---
date: 2026-04-29
tags: [creativeagent, pcd, design, sp7, preproduction-chain, identity-context, production-fanout-gate, synergy]
status: active
---

# SP7 — Identity-Aware Pre-Production Chain + Single Production Gate — Design Spec

**Project:** CreativeAgent / PCD (Performance Creative Director)
**Sprint:** SP7 — first synergy slice (pre-production layer of the PCD lifecycle)
**Created:** 2026-04-29
**Status:** Design approved, pending implementation plan

## Goal

Ship the pre-production layer of PCD: a deterministic chain that takes a brief, resolves PCD identity at the head, runs identity-aware creative stages (`trends → motivators → hooks → creator scripts`) under a single human approval gate at the script→production boundary, and returns a forensic decision struct plus full chain state for downstream UGC production. SP7 is the first synergy slice — it makes the existing PCD governance layer (SP1–SP6) composable as the head of one product flow rather than a parallel concern. SP7 ships:

1. **`PcdBriefInput` schema** — the new zod input type that supersedes raw `CreativeJob` rows for PCD-aware pre-production.
2. **`PcdIdentityContext` + `buildPcdIdentityContext`** — immutable struct, version-pinned, built by wrapping SP3's `resolvePcdRegistryContext` and running SP6's `assertConsentNotRevokedForGeneration` at the head. Creative substrate (voice, canonical text, hero packshot) read from registry stores at build time so downstream stages are pure consumers.
3. **Four stage-runner interfaces** — `TrendsStageRunner`, `MotivatorsStageRunner`, `HooksStageRunner`, `CreatorScriptsStageRunner`. One concern per file. Stub implementers ship in-tree; real Claude-driven implementers come at merge-back.
4. **`runIdentityAwarePreproductionChain` composer** — pure async store-injected function. Calls builder → four stage runners in fixed order → production fanout gate. Auto-advances all four pre-production stages with no per-stage human gates. Returns `PcdPreproductionChainResult { decision, stageOutputs }`.
5. **`ProductionFanoutGate` adapter** — injected interface with default `AutoApproveOnlyScriptGate` that selects the only-script in SP7. Real merge-back implementer wraps Switchboard's Inngest `step.waitForEvent` + dashboard UI.
6. **`PcdProductionFanoutDecision` decision struct** — forensic-minimal: identity carry-through, selected vs available script IDs, three pinned versions, gate metadata (`decidedAt`, `decidedBy`), `costForecast: PcdCostForecastSchema | null` (SP7 always null; SP10 fills).
7. **`PreproductionChainError`** — wraps stage runner / gate adapter runtime failures with `stage` discriminant. Pre-stage errors (zod, `ConsentRevokedRefusalError`, `InvariantViolationError`) propagate raw.

## Scope

### In scope

- New zod schemas in `packages/schemas/src/pcd-preproduction.ts`: `PcdBriefInputSchema`, `UgcStyleConstraintSchema`, `PcdIdentityContextSchema`, `TrendSignalSchema`, `TrendStageOutputSchema`, `MotivatorSchema`, `MotivatorsStageOutputSchema`, `HookSchema`, `HooksStageOutputSchema`, `CreatorScriptSchema`, `CreatorScriptsStageOutputSchema`, `PcdProductionFanoutDecisionSchema`, `PcdPreproductionChainResultSchema`, `PcdCostForecastSchema`, `PreproductionChainStageEnumSchema`.
- New module `packages/creative-pipeline/src/pcd/preproduction/` with all SP7 source + co-located tests.
- Two new pinned version constants: `PCD_PREPRODUCTION_CHAIN_VERSION` and `PCD_IDENTITY_CONTEXT_VERSION` (sibling const files, matching SP3/SP6 precedent).
- Composer wraps SP3's `resolvePcdRegistryContext` and SP6's `assertConsentNotRevokedForGeneration`. SP1–SP6 source bodies are untouched; SP7 consumes their exports only.
- One injected `ProductionFanoutGate` adapter interface with default `AutoApproveOnlyScriptGate` (third instance of the SP6 adapter-with-default pattern after `ExportGateState` and `ComplianceCheck`).
- Four stage-runner interfaces with default in-tree stub implementers (canned-output stubs returning length-1 lists for deterministic testing).
- One injected clock seam (`stores.clock?: () => Date`) for deterministic `decidedAt`. First PCD slice with a wall-clock-stamped decision struct.
- Anti-pattern grep tests + forbidden-imports tests per existing SP discipline.
- Co-located `*.test.ts` for every non-type-only source file.

### Out of scope

- **Branching tree state.** SP7 stages always emit length-1 lists. Multi-output stages, parent/branch ID semantics beyond the forward-compat `parentXxxId` schema fields, and fanout caps are SP8 territory.
- **Per-stage tier validators.** SP7 trusts the stage runner: identity context flows in, runner is responsible. The user explicitly chose Q7=A. Validators (if needed) are a future slice.
- **Cost forecast computation.** `PcdCostForecastSchema` is shipped as a placeholder; SP7 always sets `costForecast: null`. SP10 fills it.
- **Storyboard stage.** UGC ads do not need a storyboard. The script (creator script / production recipe) is the approval object and the production instruction. Storyboard is dropped from the chain entirely.
- **Production handoff wiring.** SP7 ends at `PcdPreproductionChainResult`. Wiring the result into UGC production (SP4 router, SP5 QC, SP6 lifecycle) is merge-back work; one `// MERGE-BACK: wire UGC production handoff here` marker on the composer's return statement.
- **Real Claude-driven stage runners.** Stub implementers ship in-tree. Real prompt-driven runners are deferred to merge-back; one `// MERGE-BACK: replace stub <stage> runner with Switchboard Claude-driven runner` marker per stub class.
- **Real human-approval gate.** `AutoApproveOnlyScriptGate` ships in-tree. Real Inngest `waitForEvent` + dashboard UI are deferred to merge-back; one `// MERGE-BACK: replace AutoApproveOnlyScriptGate ...` marker.
- **Prisma migration.** SP7 is pure orchestration. Schema additions are zod-only. No migration in this slice.
- **`apps/api` wiring.** Routes, Inngest functions, `PlatformIngress` integration are merge-back.
- **`WorkTrace` emit.** Each lifecycle / stage-completion point carries a `// MERGE-BACK: emit WorkTrace here` marker. No equivalent emitter is invented in this repo (matches SP6 precedent).
- **Performance back-flow / projection** of past QC pass-rate, approval verdicts, etc. These belong to SP10 (performance ledger).
- **Cross-pipeline back-flow.** No back-flow surface from production into pre-production ships in SP7. The synergy direction is forward only at this slice.
- **Storyboard or other late-creative-stage modules.** Not added.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SP7 pre-production chain — pure store-injected composer over fixed stages    │
│                                                                               │
│   runIdentityAwarePreproductionChain(brief, stores)                          │
│     ──→ PcdBriefInputSchema.parse(brief)                  // zod validation  │
│     ──→ buildPcdIdentityContext                                              │
│           ──→ resolvePcdRegistryContext (SP3)                                │
│           ──→ assertConsentNotRevokedForGeneration (SP6)                     │
│           ──→ project tier rules + read creative substrate                   │
│           ──→ PcdIdentityContext (immutable)                                 │
│     ──→ trendsRunner.run(brief, identityContext)                             │
│     ──→ motivatorsRunner.run(brief, identityContext, trends)                 │
│     ──→ hooksRunner.run(brief, identityContext, trends, motivators)          │
│     ──→ creatorScriptsRunner.run(brief, identityContext, trends, motivators, │
│                                  hooks)                                      │
│     ──→ productionFanoutGate.requestSelection(scripts, identityContext)      │
│     ──→ PcdPreproductionChainResult { decision, stageOutputs }               │
│                                                                               │
│   Caller (merge-back: Switchboard creative-job-runner / ingress) wires the   │
│   composer behind a single Inngest function and forwards `decision` to       │
│   UGC production handoff.                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ reads
                                    ▼
                  ┌──────────────────────────────────┐
                  │ Existing SP1–SP6 surface         │
                  │   resolvePcdRegistryContext      │
                  │   assertConsentNotRevokedForGen  │
                  │   IdentityTierSchema             │
                  │   PcdShotTypeSchema              │
                  │   OutputIntentSchema             │
                  │   PCD_TIER_POLICY_VERSION (read) │
                  │   PCD_PROVIDER_CAPABILITY_VERSION│
                  │     (read)                       │
                  │   ConsentRevokedRefusalError     │
                  │   InvariantViolationError        │
                  └──────────────────────────────────┘
                                    │
                                    │ injected via stores bundle
                                    ▼
                  ┌──────────────────────────────────┐
                  │ Stage runners (four narrow types)│
                  │   TrendsStageRunner              │
                  │   MotivatorsStageRunner          │
                  │   HooksStageRunner               │
                  │   CreatorScriptsStageRunner      │
                  │                                  │
                  │ Default stubs ship here:         │
                  │   StubTrendsStageRunner          │
                  │   StubMotivatorsStageRunner      │
                  │   StubHooksStageRunner           │
                  │   StubCreatorScriptsStageRunner  │
                  │ (canned length-1 outputs)        │
                  └──────────────────────────────────┘
                                    │
                                    ▼
                  ┌──────────────────────────────────┐
                  │ ProductionFanoutGate adapter     │
                  │ Default: AutoApproveOnlyScriptGate│
                  │  (SP6 ExportGateState precedent) │
                  └──────────────────────────────────┘

Injected store bundle:
  stores.productStore                        (SP1, used by SP3 resolver)
  stores.creatorStore                        (SP1, used by SP3 resolver)
  stores.consentRecordReader                 (SP6, used by SP6 pre-check)
  stores.creatorIdentityReader               (SP6, used by SP6 pre-check)
  stores.trendsRunner                        (SP7, new)
  stores.motivatorsRunner                    (SP7, new)
  stores.hooksRunner                         (SP7, new)
  stores.creatorScriptsRunner                (SP7, new)
  stores.productionFanoutGate                (SP7, new)
  stores.clock?: () => Date                  (SP7, new; defaults to () => new Date())
```

### File layout

```
packages/creative-pipeline/src/pcd/preproduction/
  index.ts                                  # barrel re-exports
  preproduction-chain-version.ts            # PCD_PREPRODUCTION_CHAIN_VERSION
  identity-context-version.ts               # PCD_IDENTITY_CONTEXT_VERSION
  pcd-brief-input.ts                        # type re-export from schemas
  pcd-identity-context.ts                   # PcdIdentityContext type re-export
  build-pcd-identity-context.ts             # buildPcdIdentityContext function
  production-fanout-gate.ts                 # ProductionFanoutGate type + AutoApproveOnlyScriptGate
  production-fanout-decision.ts             # PcdProductionFanoutDecision type re-export
  preproduction-chain-result.ts             # PcdPreproductionChainResult type re-export
  preproduction-chain.ts                    # runIdentityAwarePreproductionChain
  preproduction-chain-error.ts              # PreproductionChainError class
  stages/
    trends-stage-runner.ts                  # TrendsStageRunner interface
    motivators-stage-runner.ts              # MotivatorsStageRunner interface
    hooks-stage-runner.ts                   # HooksStageRunner interface
    creator-scripts-stage-runner.ts         # CreatorScriptsStageRunner interface
    stub-trends-stage-runner.ts             # StubTrendsStageRunner default
    stub-motivators-stage-runner.ts         # StubMotivatorsStageRunner default
    stub-hooks-stage-runner.ts              # StubHooksStageRunner default
    stub-creator-scripts-stage-runner.ts    # StubCreatorScriptsStageRunner default
  + co-located *.test.ts for each non-type-only file
  sp7-anti-patterns.test.ts                 # cross-cutting anti-pattern grep test

packages/schemas/src/pcd-preproduction.ts
  PcdBriefInputSchema
  UgcStyleConstraintSchema
  PcdIdentityContextSchema
  TrendSignalSchema, TrendStageOutputSchema
  MotivatorSchema, MotivatorsStageOutputSchema
  HookSchema, HooksStageOutputSchema
  CreatorScriptSchema, CreatorScriptsStageOutputSchema
  PcdCostForecastSchema
  PcdProductionFanoutDecisionSchema
  PcdPreproductionChainResultSchema
  PreproductionChainStageEnumSchema
```

### Boundary discipline

- Each stage-runner interface is a **one-method interface in its own file**. No generic polymorphic `IdentityAwareStageRunner<TIn, TOut>` interface. No stage-name discriminator dispatcher. Composer holds them as named injected stores and calls them by name (`stores.trendsRunner.run(...)`, etc.).
- Each stub stage runner is a **separate file** with its own `// MERGE-BACK:` marker on the class definition. Stub outputs are deterministic and length-1; SP8 widens the stub behavior, not the interface shape.
- Composer is a **single async function** with a fixed call sequence. No chain configurability. No `if (stage ===` dispatch. The chain shape IS the deliverable.
- `PcdIdentityContext` is **immutable** at the type level (`readonly` fields throughout) and frozen at runtime via `Object.freeze` in `buildPcdIdentityContext` before return.
- Refusal at `buildPcdIdentityContext`: `ConsentRevokedRefusalError` and `InvariantViolationError` propagate raw. `PcdBriefInputSchema.safeParse` failure throws `ZodError` raw. SP7 does not wrap these.
- Refusal during stage runners or gate: thrown error caught by composer, rethrown as `PreproductionChainError({ stage, cause })`. `stage` is the `PreproductionChainStageEnumSchema` value.
- Each chain decision struct carries the version constants pinned from imports — caller cannot override.
- PII bounds: `PreproductionChainError` carries identifiers and stage names only. The `cause` field stores the original error (which may carry user data); decision payloads never echo brief content.

### Type-boundary discipline (`PcdIdentityContext` immutability)

`PcdIdentityContext` fields are all `readonly` in the zod-derived TypeScript type. `buildPcdIdentityContext` returns the result of `Object.freeze(context)` to enforce at runtime. Stage runners receive the frozen object; attempts to mutate throw in strict mode. Tests assert immutability:

```ts
it("freezes the returned identity context", async () => {
  const ctx = await buildPcdIdentityContext(brief, stores);
  expect(Object.isFrozen(ctx)).toBe(true);
});
```

This is the SP7 analog of SP6's "decision struct version pinned from imports — caller cannot override" — same intent (caller cannot mutate the audit subject), different mechanism.

## Schema additions

No Prisma migration. All schema additions are zod-only and live in a new file `packages/schemas/src/pcd-preproduction.ts`. The existing `packages/schemas/src/pcd-identity.ts` is not modified.

### `PcdBriefInputSchema`

```ts
export const PcdBriefInputSchema = z.object({
  briefId: z.string(),
  productDescription: z.string(),
  targetAudience: z.string(),
  platforms: z.array(z.string()),
  brandVoice: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  creatorIdentityRef: z.string(),    // resolves to AvatarIdentity / CreatorIdentity row
  productIdentityRef: z.string(),    // resolves to ProductIdentity row
});
export type PcdBriefInput = z.infer<typeof PcdBriefInputSchema>;
```

### `UgcStyleConstraintSchema`

```ts
export const UgcStyleConstraintSchema = z.enum([
  "native_vertical",                  // 9:16 selfie-style framing
  "creator_led",                      // first-person creator voice, not narrator voice
  "no_overproduced_storyboard",       // no studio-shoot framing, no cinematic transitions
  "product_fidelity_required",        // canonical text/logo must remain faithful to ProductIdentity
  "no_invented_product_claims",       // no claims absent from ProductIdentity / brand-approved sources
]);
export type UgcStyleConstraint = z.infer<typeof UgcStyleConstraintSchema>;
```

`buildPcdIdentityContext` populates `ugcStyleConstraints` with all five enum values by default. The list is included in `PcdIdentityContext` so every stage runner consumes the same UGC-format ground truth — preventing the failure mode where Claude drifts toward polished ad-film language instead of native UGC. Future slices (or merge-back UX) may make the list configurable per brief.

### `PcdIdentityContextSchema`

```ts
export const PcdIdentityContextSchema = z.object({
  // Identity refs
  creatorIdentityId: z.string(),
  productIdentityId: z.string(),
  consentRecordId: z.string().nullable(),

  // Tier projection (stamped at resolve-time, stable for chain duration)
  effectiveTier: IdentityTierSchema,
  productTierAtResolution: IdentityTierSchema,
  creatorTierAtResolution: IdentityTierSchema,
  allowedShotTypes: z.array(PcdShotTypeSchema),
  allowedOutputIntents: z.array(OutputIntentSchema),

  // Tier 3 rule flags (pure recompute from SP4 rules)
  tier3Rules: z.object({
    firstLastFrameRequired: z.boolean(),
    performanceTransferRequired: z.boolean(),
    editOverRegenerateRequired: z.boolean(),
  }),

  // Creative substrate ("write FOR" inputs)
  voiceId: z.string().nullable(),
  productCanonicalText: z.string(),
  productHeroPackshotAssetId: z.string().nullable(),
  brandPositioningText: z.string().nullable(),

  // UGC creative-format constraints (prevents stage runners from drifting back to polished ad-film language)
  ugcStyleConstraints: z.array(UgcStyleConstraintSchema),

  // Consent flag (forwarded for downstream stamping; SP6 pre-check already throws on revoked)
  consentRevoked: z.boolean(),

  // Version pin
  identityContextVersion: z.string(),
});
export type PcdIdentityContext = z.infer<typeof PcdIdentityContextSchema>;
```

### Stage output schemas (length-N, SP7 stubs emit length-1)

```ts
export const TrendSignalSchema = z.object({
  id: z.string(),
  summary: z.string(),
  audienceFit: z.string(),
  evidenceRefs: z.array(z.string()),
});
export const TrendStageOutputSchema = z.object({ signals: z.array(TrendSignalSchema).min(1) });

export const MotivatorSchema = z.object({
  id: z.string(),
  frictionOrDesire: z.string(),
  audienceSegment: z.string(),
  evidenceRefs: z.array(z.string()),
  parentTrendId: z.string(),
});
export const MotivatorsStageOutputSchema = z.object({ motivators: z.array(MotivatorSchema).min(1) });

export const HookTypeSchema = z.enum([
  "direct_camera",
  "mid_action",
  "reaction",
  "text_overlay_start",
]);
export const HookSchema = z.object({
  id: z.string(),
  text: z.string(),
  hookType: HookTypeSchema,
  parentMotivatorId: z.string(),
  parentTrendId: z.string(),
});
export const HooksStageOutputSchema = z.object({ hooks: z.array(HookSchema).min(1) });

export const CreatorScriptIdentityConstraintsSchema = z.object({
  creatorIdentityId: z.string(),
  productIdentityId: z.string(),
  voiceId: z.string().nullable(),
});

// Discriminated union: exactly one of spokenLines or talkingPoints
const CreatorScriptBaseShape = z.object({
  id: z.string(),
  hookText: z.string(),
  creatorAngle: z.string(),
  visualBeats: z.array(z.string()),
  productMoment: z.string(),
  cta: z.string(),
  complianceNotes: z.array(z.string()),
  identityConstraints: CreatorScriptIdentityConstraintsSchema,
  parentHookId: z.string(),
});
export const CreatorScriptSchema = z.discriminatedUnion("scriptStyle", [
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("spoken_lines"),
    spokenLines: z.array(z.string()).min(1),
  }),
  CreatorScriptBaseShape.extend({
    scriptStyle: z.literal("talking_points"),
    talkingPoints: z.array(z.string()).min(1),
  }),
]);
export const CreatorScriptsStageOutputSchema = z.object({
  scripts: z.array(CreatorScriptSchema).min(1),
});
```

### Decision + result + cost-forecast schemas

```ts
export const PreproductionChainStageEnumSchema = z.enum([
  "trends",
  "motivators",
  "hooks",
  "creator_scripts",
  "production_fanout_gate",
]);
export type PreproductionChainStage = z.infer<typeof PreproductionChainStageEnumSchema>;

export const PcdCostForecastSchema = z.object({
  estimatedUsd: z.number().nonnegative(),
  currency: z.string(),
  lineItems: z.array(
    z.object({
      label: z.string(),
      estimatedUsd: z.number().nonnegative(),
    }),
  ),
});
export type PcdCostForecast = z.infer<typeof PcdCostForecastSchema>;

export const PcdProductionFanoutDecisionSchema = z.object({
  // Forensic identity carry-through
  briefId: z.string(),
  creatorIdentityId: z.string(),
  productIdentityId: z.string(),
  consentRecordId: z.string().nullable(),
  effectiveTier: IdentityTierSchema,

  // Selection (sorted ascending for determinism)
  selectedScriptIds: z.array(z.string()).min(1),
  availableScriptIds: z.array(z.string()).min(1),

  // Pinned versions (caller cannot override)
  preproductionChainVersion: z.string(),
  identityContextVersion: z.string(),
  approvalLifecycleVersion: z.string(),

  // Gate metadata
  decidedAt: z.string().datetime(),
  decidedBy: z.string().nullable(),

  // SP10 forward-compat (always null in SP7)
  costForecast: PcdCostForecastSchema.nullable(),
});
export type PcdProductionFanoutDecision = z.infer<typeof PcdProductionFanoutDecisionSchema>;

export const PcdPreproductionChainResultSchema = z.object({
  decision: PcdProductionFanoutDecisionSchema,
  stageOutputs: z.object({
    trends: TrendStageOutputSchema,
    motivators: MotivatorsStageOutputSchema,
    hooks: HooksStageOutputSchema,
    scripts: CreatorScriptsStageOutputSchema,
  }),
});
export type PcdPreproductionChainResult = z.infer<typeof PcdPreproductionChainResultSchema>;
```

`selectedScriptIds` and `availableScriptIds` are **sorted ascending** at the gate adapter boundary. Determinism rule: any test that constructs a fanout decision sorts before assertion; the default `AutoApproveOnlyScriptGate` returns sorted arrays.

## Function contracts

### `buildPcdIdentityContext`

```ts
type BuildPcdIdentityContextStores = {
  productStore: ProductStore;                          // SP1
  creatorStore: CreatorStore;                          // SP1
  consentRecordReader: ConsentRecordReader;            // SP6
  creatorIdentityReader: CreatorIdentityReader;        // SP6
};

async function buildPcdIdentityContext(
  brief: PcdBriefInput,
  stores: BuildPcdIdentityContextStores,
): Promise<PcdIdentityContext>;
```

**Logic:**

1. `PcdBriefInputSchema.parse(brief)` — validation. Failure throws `ZodError`, propagates raw.
2. Call `resolvePcdRegistryContext({ creatorIdentityRef: brief.creatorIdentityRef, productIdentityRef: brief.productIdentityRef }, stores)` (SP3). Failure throws `InvariantViolationError`, propagates raw.
3. Call `assertConsentNotRevokedForGeneration({ creatorIdentityId: resolved.creatorIdentityId }, stores)` (SP6). Failure throws `ConsentRevokedRefusalError`, propagates raw.
4. **Project tier rules** — pure compute over `PCD_TIER_POLICY` × `PCD_PROVIDER_CAPABILITY_MATRIX`:
   - `allowedShotTypes`: filter `PcdShotTypeSchema` values where `decidePcdGenerationAccess({ avatarTier, productTier, shotType, outputIntent: "preview" }).allowed === true`.
   - `allowedOutputIntents`: filter `OutputIntentSchema` values where some shot type allowed at this tier under that intent.
   - `tier3Rules`:
     - `firstLastFrameRequired = effectiveTier === 3`
     - `performanceTransferRequired = effectiveTier === 3 && allowedShotTypes.includes("talking_head")`
     - `editOverRegenerateRequired = effectiveTier === 3`
5. **Read creative substrate** — call `productStore.findById(productIdentityId)` and `creatorStore.findById(creatorIdentityId)`. Pull `voiceId`, `productCanonicalText` (= `canonicalPackageText` on ProductIdentity), `productHeroPackshotAssetId` (= ProductImage with `viewType: "hero_front"`), and `brandPositioningText` if the field exists on the merge-back-time ProductIdentity schema; otherwise `null`. SP7 does not widen ProductIdentity — no migration. If Switchboard's ProductIdentity has not added `brandPositioningText` by merge-back, the substrate read returns `null` for that field and the schema accepts the null.
6. **Populate UGC style constraints** — set `ugcStyleConstraints` to the full enum list `["native_vertical", "creator_led", "no_overproduced_storyboard", "product_fidelity_required", "no_invented_product_claims"]`. SP7 does not parameterize this; future slices or merge-back UX may.
7. Build `PcdIdentityContext` with `identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION` pinned from import.
8. `Object.freeze(context)`.
9. `// MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.` marker at return.

### `runIdentityAwarePreproductionChain` (composer)

```ts
type PreproductionChainStores = BuildPcdIdentityContextStores & {
  trendsRunner: TrendsStageRunner;
  motivatorsRunner: MotivatorsStageRunner;
  hooksRunner: HooksStageRunner;
  creatorScriptsRunner: CreatorScriptsStageRunner;
  productionFanoutGate: ProductionFanoutGate;
  clock?: () => Date;
};

async function runIdentityAwarePreproductionChain(
  brief: PcdBriefInput,
  stores: PreproductionChainStores,
): Promise<PcdPreproductionChainResult>;
```

**Logic:**

1. `const identityContext = await buildPcdIdentityContext(brief, stores);`
   - Errors propagate raw (zod / consent / invariant).
2. `const trends = await runStageWrapped("trends", () => stores.trendsRunner.run(brief, identityContext));`
   - `// MERGE-BACK: emit WorkTrace here after trends stage returns.` after success.
3. `const motivators = await runStageWrapped("motivators", () => stores.motivatorsRunner.run(brief, identityContext, trends));`
   - `// MERGE-BACK: emit WorkTrace here after motivators stage returns.` after success.
4. `const hooks = await runStageWrapped("hooks", () => stores.hooksRunner.run(brief, identityContext, trends, motivators));`
   - `// MERGE-BACK: emit WorkTrace here after hooks stage returns.` after success.
5. `const scripts = await runStageWrapped("creator_scripts", () => stores.creatorScriptsRunner.run(brief, identityContext, trends, motivators, hooks));`
   - `// MERGE-BACK: emit WorkTrace here after creator scripts stage returns.` after success.
6. `const decision = await runStageWrapped("production_fanout_gate", () => stores.productionFanoutGate.requestSelection({ scripts: scripts.scripts, identityContext, briefId: brief.briefId, clock: stores.clock ?? (() => new Date()) }));`
   - `// MERGE-BACK: emit WorkTrace here at production fanout gate decision.` after success.
7. Return `{ decision, stageOutputs: { trends, motivators, hooks, scripts } }`.
   - `// MERGE-BACK: wire UGC production handoff here.` marker on the return statement.
   - `// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload.` near the version-pin import line.

`runStageWrapped` is an inline helper inside `preproduction-chain.ts`:

```ts
async function runStageWrapped<T>(
  stage: PreproductionChainStage,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new PreproductionChainError({ stage, cause: err });
  }
}
```

The composer **must** literally call `productionFanoutGate.requestSelection(` and `assertConsentNotRevokedForGeneration(` (transitively via `buildPcdIdentityContext`). Anti-pattern grep tests enforce both literals exist in source.

### `ProductionFanoutGate` adapter

```ts
export type RequestSelectionInput = {
  scripts: CreatorScript[];
  identityContext: PcdIdentityContext;
  briefId: string;
  clock: () => Date;
};

export interface ProductionFanoutGate {
  requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision>;
}

export class AutoApproveOnlyScriptGate implements ProductionFanoutGate {
  async requestSelection(input: RequestSelectionInput): Promise<PcdProductionFanoutDecision> {
    if (input.scripts.length !== 1) {
      throw new InvariantViolationError("AutoApproveOnlyScriptGate requires exactly one script", {
        scriptsLength: input.scripts.length,
      });
    }
    const script = input.scripts[0]!;
    const sortedIds = [script.id].slice().sort();
    return {
      briefId: input.briefId,
      creatorIdentityId: input.identityContext.creatorIdentityId,
      productIdentityId: input.identityContext.productIdentityId,
      consentRecordId: input.identityContext.consentRecordId,
      effectiveTier: input.identityContext.effectiveTier,
      selectedScriptIds: sortedIds,
      availableScriptIds: sortedIds,
      preproductionChainVersion: PCD_PREPRODUCTION_CHAIN_VERSION,
      identityContextVersion: PCD_IDENTITY_CONTEXT_VERSION,
      approvalLifecycleVersion: PCD_APPROVAL_LIFECYCLE_VERSION,
      decidedAt: input.clock().toISOString(),
      decidedBy: null,
      costForecast: null,
    };
  }
}
```

`// MERGE-BACK: replace AutoApproveOnlyScriptGate with Switchboard Inngest waitForEvent + dashboard UI.` marker on the class.

The default implementer enforces SP7's "exactly one script" world via `InvariantViolationError`. SP8 ships a different default that handles N scripts (or removes the guard) once branching widens the upstream output. Test coverage on the SP7 default is two cases: one-script returns the decision; two-or-zero scripts throws `InvariantViolationError`.

### Stage runner interfaces

Four interfaces, one per file. Each is single-method.

```ts
// stages/trends-stage-runner.ts
export interface TrendsStageRunner {
  run(brief: PcdBriefInput, identityContext: PcdIdentityContext): Promise<TrendStageOutput>;
}

// stages/motivators-stage-runner.ts
export interface MotivatorsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
  ): Promise<MotivatorsStageOutput>;
}

// stages/hooks-stage-runner.ts
export interface HooksStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
  ): Promise<HooksStageOutput>;
}

// stages/creator-scripts-stage-runner.ts
export interface CreatorScriptsStageRunner {
  run(
    brief: PcdBriefInput,
    identityContext: PcdIdentityContext,
    trends: TrendStageOutput,
    motivators: MotivatorsStageOutput,
    hooks: HooksStageOutput,
  ): Promise<CreatorScriptsStageOutput>;
}
```

### Stub stage runner implementers

Each stub is a separate file with a `// MERGE-BACK: replace stub <stage> runner with Switchboard Claude-driven runner.` marker. Stubs return deterministic length-1 outputs derived from `(brief, identityContext)` so tests are reproducible. Example shape (trends):

```ts
// stages/stub-trends-stage-runner.ts
// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.
export class StubTrendsStageRunner implements TrendsStageRunner {
  async run(brief: PcdBriefInput, _ctx: PcdIdentityContext): Promise<TrendStageOutput> {
    return {
      signals: [
        {
          id: `trend-${brief.briefId}-1`,
          summary: `Stub trend signal for ${brief.productDescription}`,
          audienceFit: brief.targetAudience,
          evidenceRefs: [],
        },
      ],
    };
  }
}
```

Stubs do not call Claude. Stubs are deterministic functions of input. Each stub has a co-located test asserting deterministic output and length-1 list.

## Injected interfaces

Already enumerated above:

- `BuildPcdIdentityContextStores`: composes SP1 (`productStore`, `creatorStore`) + SP6 (`consentRecordReader`, `creatorIdentityReader`) — all four already shipped.
- `PreproductionChainStores`: extends BuildPcdIdentityContextStores with four stage runners + production fanout gate + optional clock.

No new Prisma store or reader interfaces. SP7 reuses SP1's `ProductStore` / `CreatorStore` and SP6's reader interfaces verbatim.

## Version constants

```ts
// packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.ts
export const PCD_PREPRODUCTION_CHAIN_VERSION = "preproduction-chain@1.0.0";

// packages/creative-pipeline/src/pcd/preproduction/identity-context-version.ts
export const PCD_IDENTITY_CONTEXT_VERSION = "identity-context@1.0.0";
```

| Function / Struct | Pinned constants |
|---|---|
| `buildPcdIdentityContext` | `PCD_IDENTITY_CONTEXT_VERSION` |
| `runIdentityAwarePreproductionChain` | `PCD_PREPRODUCTION_CHAIN_VERSION` (transitively pinned via decision struct) |
| `PcdProductionFanoutDecision.preproductionChainVersion` | `PCD_PREPRODUCTION_CHAIN_VERSION` |
| `PcdProductionFanoutDecision.identityContextVersion` | `PCD_IDENTITY_CONTEXT_VERSION` |
| `PcdProductionFanoutDecision.approvalLifecycleVersion` | `PCD_APPROVAL_LIFECYCLE_VERSION` (reused from SP6) |

Ten pinned constants total in the PCD slice after SP7. Eight existed pre-SP7:
`PCD_TIER_POLICY_VERSION` (SP2), `PCD_SHOT_SPEC_VERSION` (SP3), `PCD_PROVIDER_CAPABILITY_VERSION` (SP4), `PCD_PROVIDER_ROUTER_VERSION` (SP4), `PCD_QC_EVALUATION_VERSION` (SP5), `PCD_QC_GATE_MATRIX_VERSION` (SP5), `PCD_APPROVAL_LIFECYCLE_VERSION` (SP6), `PCD_CONSENT_REVOCATION_VERSION` (SP6). SP7 adds two: `PCD_PREPRODUCTION_CHAIN_VERSION` and `PCD_IDENTITY_CONTEXT_VERSION`.

## Errors

### `PreproductionChainError`

```ts
export class PreproductionChainError extends Error {
  readonly name = "PreproductionChainError";
  readonly stage: PreproductionChainStage;
  readonly cause: unknown;

  constructor(args: { stage: PreproductionChainStage; cause: unknown }) {
    super(`Preproduction chain failed at stage ${args.stage}`);
    this.stage = args.stage;
    this.cause = args.cause;
  }
}
```

PII bounds: `stage` is an enum value, never user content. `cause` is the original error reference; downstream WorkTrace emit (merge-back) is responsible for stripping any user-content fields before persistence.

### Existing error classes (re-used, unmodified)

- `ConsentRevokedRefusalError` (SP6) — thrown by `assertConsentNotRevokedForGeneration` inside `buildPcdIdentityContext`. Propagates raw.
- `InvariantViolationError` (SP3 widened in SP6) — thrown by `resolvePcdRegistryContext`, by `AutoApproveOnlyScriptGate` on wrong script count, and by any structural-integrity check inside `buildPcdIdentityContext`. Propagates raw EXCEPT the gate-thrown one, which is wrapped (gate failures wrap by definition).

## Testing strategy

### Per-function invariant tests

Co-located `*.test.ts` for each non-type-only file. In-memory fakes for SP1 stores and SP6 readers; stub stage runners are themselves the test fakes for the chain composer.

**`build-pcd-identity-context.test.ts`:**

1. Valid brief + clean consent → returns frozen `PcdIdentityContext` with all fields populated.
2. `PcdBriefInputSchema` parse failure → throws `ZodError` raw (not wrapped).
3. SP3 resolver throws `InvariantViolationError` → propagates raw.
4. SP6 pre-check throws `ConsentRevokedRefusalError` → propagates raw.
5. Tier projection: avatar=2, product=2 → `allowedShotTypes` includes `simple_ugc`, excludes `face_closeup`.
6. Tier projection: avatar=3, product=3 → `allowedShotTypes` includes `face_closeup` and `label_closeup`.
7. Tier 3 rule flags: `effectiveTier=3` → `firstLastFrameRequired=true`, `editOverRegenerateRequired=true`.
8. Tier 3 rule flags: `effectiveTier<3` → all flags `false`.
9. `Object.isFrozen(returned)` is `true`.
10. Decision struct carries `identityContextVersion === PCD_IDENTITY_CONTEXT_VERSION`.
11. Reads creative substrate (`productCanonicalText`, `voiceId`, etc.) from injected stores.
11a. `ugcStyleConstraints` is populated with the full enum list (5 values) verbatim.

**`preproduction-chain.test.ts`:**

12. Happy path with stubs → returns `{ decision, stageOutputs }` with all stages populated.
13. Stages called in fixed order: trends, motivators, hooks, creator_scripts (assert via call-recording stubs).
14. `buildPcdIdentityContext` throws `ConsentRevokedRefusalError` → propagates raw (not wrapped).
15. `buildPcdIdentityContext` throws `InvariantViolationError` → propagates raw.
16. Trends runner throws → wrapped in `PreproductionChainError({ stage: "trends" })`. Cause preserved.
17. Motivators runner throws → wrapped with `stage: "motivators"`.
18. Hooks runner throws → wrapped with `stage: "hooks"`.
19. Creator scripts runner throws → wrapped with `stage: "creator_scripts"`.
20. Production fanout gate throws → wrapped with `stage: "production_fanout_gate"`.
21. Wrapped error preserves `cause`.
22. Decision carries `preproductionChainVersion === PCD_PREPRODUCTION_CHAIN_VERSION` and `identityContextVersion === PCD_IDENTITY_CONTEXT_VERSION`.
23. Decision carries `approvalLifecycleVersion === PCD_APPROVAL_LIFECYCLE_VERSION` (re-used from SP6).
24. Decision `decidedAt` matches injected clock output (deterministic).
25. Decision `decidedBy === null` when default `AutoApproveOnlyScriptGate` is used.
26. Decision `costForecast === null` in SP7.
27. `selectedScriptIds` and `availableScriptIds` are sorted ascending.
28. Identity context flows verbatim from `buildPcdIdentityContext` to each stage runner (assert via spy stubs comparing reference equality).

**`auto-approve-only-script-gate.test.ts`:**

29. Single-script input + injected clock → returns decision with `selectedScriptIds: [theId]`, `decidedAt: clock().toISOString()`, `decidedBy: null`, `costForecast: null`.
30. Zero scripts → throws `InvariantViolationError`.
31. Two-plus scripts → throws `InvariantViolationError`.
32. Returned `selectedScriptIds`/`availableScriptIds` are sorted ascending.
33. Decision carries all three pinned versions.

**`stub-trends-stage-runner.test.ts`** (one per stub):

34. Returns deterministic length-1 output for the same brief.
35. Output schema validates (`TrendStageOutputSchema.parse(returned)` succeeds).
36. Different `briefId` produces different output id (mechanical determinism).

(Same shape for stub-motivators-stage-runner.test.ts, stub-hooks-stage-runner.test.ts, stub-creator-scripts-stage-runner.test.ts — three additional test files, ~3 cases each.)

**`preproduction-chain-error.test.ts`:**

37. Constructor populates `name`, `stage`, `cause`.
38. `instanceof Error` is true.
39. PII test: stringifying the error reveals only `stage` (no brief content from `cause`).

### Anti-pattern grep tests (`sp7-anti-patterns.test.ts`)

Cross-cutting test, sibling to SP6's `sp6-anti-patterns.test.ts`. Strips line comments before regex matching (matches SP5/SP6 convention).

- **No `if (stage ===` outside `preproduction-chain-error.ts`.** Composer dispatch is direct method call, not switch-on-name. Anti-pattern test scans every other SP7 source file.
- **No `if (intent ===`, `if (effectiveTier ===`, `if (shotType ===`** in any SP7 source (SP4/SP5/SP6 inheritance — data-keyed structures only).
- **`preproduction-chain.ts` source contains literal `productionFanoutGate.requestSelection(`.** Guarantees the gate seam is real, not theater (SP6's `complianceCheck.checkMetaDraftCompliance(` precedent).
- **`preproduction-chain.ts` source transitively contains literal `assertConsentNotRevokedForGeneration(`** (via `buildPcdIdentityContext` import). Test scans `build-pcd-identity-context.ts` source string.
- **No `prisma.`, `assetRecord.update`, `WorkTrace`** token in any SP7 source (mutations live in stores; SP7 source is decision logic only — SP6 inheritance).
- **No `import.*ApprovalLifecycle`, `import.*ExportLifecycle`, `import.*core/approval`** in SP7 source (Switchboard parent system surfaces are stubbed locally — SP6 inheritance).

### Forbidden imports per SP7 source file

Per SP1–SP6 pattern. Each SP7 source file ships a co-located test asserting its source string does not contain any of:

- `@creativeagent/db`
- `@prisma/client`
- `inngest`
- `node:fs`, `node:http`, `node:https`
- `crypto`

Stub stage runner source files have an additional restriction: they import only from `@creativeagent/schemas` for output type schemas and from their own interface file. They must not import from `pcd/registry-resolver`, `pcd/tier-policy`, or any other SP1–SP6 file — stubs are deterministic black boxes, not richly-tied to the production stack.

### Determinism / clock injection

Every test that asserts on `decidedAt` injects a fixed clock:

```ts
const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");
const result = await runIdentityAwarePreproductionChain(brief, {
  ...stores,
  clock: fixedClock,
});
expect(result.decision.decidedAt).toBe("2026-04-29T12:00:00.000Z");
```

Default clock (no injection) is `() => new Date()` and is **not** asserted directly in tests — only its presence-as-fallback via type-system check.

### PII bounds

- `PreproductionChainError.cause` carries the original error. A test asserts `JSON.stringify(error)` does not include brief field content — the constructor's serialization is `{ name, stage }` only by default; `cause` is a non-enumerable own property OR the test asserts the explicit shape.
- `PcdIdentityContext` carries identifier strings and tier integers — no free-text user-supplied content from the brief beyond `productCanonicalText` (which is registry-owned, not brief-owned).
- `PcdProductionFanoutDecision` carries IDs + versions + timestamps. No script content. No brief content. Forensic-clean.

## SP1–SP6 invariant inheritance

| Existing invariant | SP7 enforcement |
|---|---|
| **SP3 store-injected purity** (resolver is pure, DB access via injected store interfaces) | SP7's composer + builder are pure and store-injected. No new Prisma access. |
| **SP4 declarative dispatch** (no hardcoded if/else routing) | SP7's chain shape is fixed; no dispatcher. Stage runners are named direct calls; no `switch(stage)`. |
| **SP4 version-pin discipline** (caller cannot override pinned versions) | `runIdentityAwarePreproductionChain` and `AutoApproveOnlyScriptGate` pin all three versions from imports. Tests assert. |
| **SP5 matrix-driven dispatch** (no `if (gate ===`, `if (effectiveTier ===`, `if (shotType ===` outside data-keyed switch) | SP7 anti-pattern grep extends: no `if (stage ===` outside the error class's stage discriminator. No tier-/shot-/intent-keyed dispatch in SP7 source. |
| **SP6 adapter-with-default seam** (`ExportGateState` / `ComplianceCheck` precedent) | SP7's `ProductionFanoutGate` is the third instance. Default implementer ships in-tree; real implementer is merge-back; anti-pattern test asserts the seam is genuinely called. |
| **SP6 collect-all refusal-reason discipline** | Not applicable to SP7 — the gate in SP7 either succeeds (returns a decision) or throws. Refusal-reason collection becomes meaningful at SP8 when N-script selection introduces partial-refusal semantics. |
| **SP6 forbidden-imports per source file** | Carried verbatim. Same five forbidden tokens. |
| **SP1 PII bounds** (refusal payloads carry IDs only) | SP7 decision struct carries IDs + versions + timestamps only. Stage outputs carry creative content but only flow through `stageOutputs` (caller-persistable), never through the decision struct. |

## Merge-back surface

13 markers total. Each is a literal `// MERGE-BACK:` comment line at the location specified. Merge-back to Switchboard resolves each marker by either replacing the implementation (stubs, default gates) or wiring an emitter (WorkTrace).

| # | File | Marker text | Resolution at merge-back |
|---|---|---|---|
| 1 | `build-pcd-identity-context.ts` | `// MERGE-BACK: emit WorkTrace here after PcdIdentityContext is built.` | Switchboard's WorkTrace writer fires once per build with the context as payload. |
| 2 | `preproduction-chain.ts` (after trends runner) | `// MERGE-BACK: emit WorkTrace here after trends stage returns.` | WorkTrace fires with `{ stage: "trends", output }`. |
| 3 | `preproduction-chain.ts` (after motivators runner) | `// MERGE-BACK: emit WorkTrace here after motivators stage returns.` | WorkTrace fires with `{ stage: "motivators", output }`. |
| 4 | `preproduction-chain.ts` (after hooks runner) | `// MERGE-BACK: emit WorkTrace here after hooks stage returns.` | WorkTrace fires with `{ stage: "hooks", output }`. |
| 5 | `preproduction-chain.ts` (after creator scripts runner) | `// MERGE-BACK: emit WorkTrace here after creator scripts stage returns.` | WorkTrace fires with `{ stage: "creator_scripts", output }`. |
| 6 | `production-fanout-gate.ts` (on `AutoApproveOnlyScriptGate`) | `// MERGE-BACK: replace AutoApproveOnlyScriptGate with Switchboard Inngest waitForEvent + dashboard UI.` | Default implementer is replaced by an adapter that emits a `creative-pipeline/preproduction.gate.requested` event, calls `step.waitForEvent("creative-pipeline/preproduction.gate.approved", ...)`, and constructs the decision struct from the operator's selection payload. |
| 7 | `preproduction-chain.ts` (after `productionFanoutGate.requestSelection`) | `// MERGE-BACK: emit WorkTrace here at production fanout gate decision.` | WorkTrace fires with the full decision struct as payload. |
| 8 | `preproduction-chain.ts` (return statement) | `// MERGE-BACK: wire UGC production handoff here.` | Switchboard's creative-job-runner forwards `decision` to the UGC production phase, which calls SP4 `routePcdShot` → providers → SP5 `evaluatePcdQcResult` → SP6 lifecycle gates. |
| 9 | `stub-trends-stage-runner.ts` | `// MERGE-BACK: replace stub trends runner with Switchboard Claude-driven runner.` | Switchboard's `trend-analyzer.ts` (or successor) implements `TrendsStageRunner` directly; default is replaced by injection. |
| 10 | `stub-motivators-stage-runner.ts` | `// MERGE-BACK: replace stub motivators runner with Switchboard Claude-driven runner.` | New Switchboard `motivators-stage-runner.ts` (Claude-driven) ships at merge-back; SP7 stub is retired. |
| 11 | `stub-hooks-stage-runner.ts` | `// MERGE-BACK: replace stub hooks runner with Switchboard Claude-driven runner.` | Switchboard's `hook-generator.ts` (widened to consume motivators) implements `HooksStageRunner`. |
| 12 | `stub-creator-scripts-stage-runner.ts` | `// MERGE-BACK: replace stub creator scripts runner with Switchboard Claude-driven runner.` | New Switchboard `creator-scripts-stage-runner.ts` (Claude-driven, produces UGC production recipe shape) ships at merge-back; replaces and supersedes both the old `script-writer.ts` and the UGC pipeline's `ugc-script-writer.ts`. |
| 13 | `preproduction-chain.ts` (version-pinning import line) | `// MERGE-BACK: include PCD_PREPRODUCTION_CHAIN_VERSION in WorkTrace decision payload.` | Switchboard's WorkTrace emit at marker #7 includes the pinned version verbatim in the persisted decision payload. |

### Stub-strategy summary (matches `docs/SWITCHBOARD-CONTEXT.md` discipline)

- Stub stage runners are deterministic black boxes producing canned length-1 outputs. Replaced at merge-back by Switchboard's Claude-driven runners. Marker pattern matches SP5's QC provider stub strategy.
- `AutoApproveOnlyScriptGate` is the default `ProductionFanoutGate` implementer. Replaced at merge-back by an Inngest-waitForEvent-backed implementer + dashboard UI. Marker pattern matches SP6's `AlwaysOpenExportGateState` / `AlwaysPassComplianceCheck` strategy.
- No `LegalOverrideRecord` / `WorkTrace` / `ApprovalLifecycle` / `ExportLifecycle` table or class is invented in this repo. SP7 reads existing SP1 / SP3 / SP6 surfaces and emits markers; production-side mutations are merge-back work.

### Stored row reconciliation at merge-back

- **No new tables**. SP7 ships zod schemas only. No Prisma migration.
- **No column additions**. `PcdIdentitySnapshot.consentRecordId` (SP1) and `AssetRecord.consentRevokedAfterGeneration` (SP6) are already sufficient for the eventual SP9 provenance fields (which are SP9's, not SP7's).

## Acceptance criteria

From the Phase 2 SP7 lock the user committed:

> SP7 should ship: one brief in; PCD identity resolved at brief input; immutable PcdIdentityContext / IdentityBoundBrief passed through trends → motivators → hooks → scripts; pre-production stages auto-advance with no human gates; one human gate at script → production; one selected script proceeds to one UGC production; production remains governed by SP4 router → SP5 QC → SP6 approval/export.

SP7 implementation verifies all of the above structurally:

- ✅ `PcdBriefInputSchema` ships in `packages/schemas/src/pcd-preproduction.ts`.
- ✅ `buildPcdIdentityContext` runs SP3 resolver + SP6 consent pre-check at the head of the chain. Throws `ConsentRevokedRefusalError` early if consent is revoked.
- ✅ `PcdIdentityContext` is `Object.freeze`d and flows through every stage runner with reference equality.
- ✅ `runIdentityAwarePreproductionChain` calls trends → motivators → hooks → creator-scripts in fixed order with no per-stage approval pause.
- ✅ `productionFanoutGate.requestSelection` is the single human-gate moment. Default `AutoApproveOnlyScriptGate` deterministically selects the only script.
- ✅ `PcdPreproductionChainResult.decision.selectedScriptIds.length === 1` in SP7. The selected script is referenced by ID; full content is in `stageOutputs.scripts.scripts`.
- ✅ Production handoff is a `// MERGE-BACK:` marker; the SP7 composer's contract ends at the decision return. Switchboard's downstream wiring routes `decision` through SP4 router, SP5 QC, SP6 lifecycle gates without SP7 source-body changes.
- ✅ Storyboard is dropped from the chain entirely. Creator scripts (UGC production recipes) are the approval object.
- ✅ Two new pinned version constants ship; identity context and decision struct carry them. SP6's `PCD_APPROVAL_LIFECYCLE_VERSION` is reused on the gate decision.
- ✅ Failure semantics: zod / consent / invariant errors propagate raw; stage / gate runtime errors wrap in `PreproductionChainError({ stage })`. Tests cover both classes.
- ✅ Anti-pattern grep + forbidden-imports tests enforce SP6 inheritance + SP7-specific seam-realness assertions.
- ✅ All schema additions are zod-only. No Prisma migration. No `apps/api` wiring.

## What's deliberately out of scope

- **Branching tree state.** SP7 emits length-1 lists; SP8 turns them into trees with `parent*Id` lineage actually populated to span branches. SP7 ships the `parent*Id` schema fields for forward compat, but stub outputs always populate them with the single parent's id.
- **Per-stage tier validators.** Q7=A locked: SP7 trusts the runner. Validators (post-stage deterministic checks against `PCD_TIER_POLICY` × `allowedShotTypes`) are deferred. If they ship, they'll be a new sibling matrix table in this same subdir.
- **Cost forecast computation.** `PcdCostForecastSchema` ships as a placeholder. SP7 always emits `costForecast: null`. SP10 fills it.
- **Storyboard stage.** Dropped entirely. UGC scripts (creator scripts / production recipes) carry the visual beats + product moment + CTA inline.
- **Real Claude-driven stage runners.** Stubs only in this repo. Merge-back ships real runners.
- **Real human-approval gate UX.** `AutoApproveOnlyScriptGate` is the only in-tree implementer. Merge-back ships the Inngest-waitForEvent-backed implementer + dashboard.
- **Production handoff envelope.** SP7 ends at `PcdPreproductionChainResult`. No envelope, no adapter. Caller composes.
- **Performance back-flow.** SP10 territory. SP7 is forward-flow only.
- **Creative-source provenance fields on `PcdIdentitySnapshot`.** SP9 / SP12 territory (whichever ships first). SP7 doesn't touch the snapshot.
- **`apps/api` HTTP routes, Inngest functions, `PlatformIngress` integration.** Composer only.
- **Real `WorkTrace` emit, real approval / export lifecycle wiring.** Markers only.
- **Retroactive backfill of existing PCD jobs through the new chain.** SP1 backfill stamps existing jobs at Tier 1; they don't flow through SP7's chain. New PCD jobs only.
- **`ConsentRecord` / `ProductIdentity` / `CreatorIdentity` schema widening.** Existing fields are sufficient. `brandPositioningText` may be `null` if absent on `ProductIdentity`; future widening is a separate slice.
- **SP1–SP6 source body changes.** Zero edits to `tier-policy.ts`, `registry-resolver.ts`, `provider-router.ts`, `pcd-identity-snapshot-writer.ts`, `qc-evaluator.ts`, the QC matrix, the QC predicates, the QC aggregator, the SP6 lifecycle gates, the SP6 pre-checks, or `consent-revocation.ts`. SP7 consumes their exports only.

## Non-obvious conclusions

- **SP7 is the head of the PCD lifecycle, not a separate "synergy layer."** The original prompt framed the synergy layer as a new module both pipelines depend on. After scope decomposition, SP7's work resolves cleanly inside `pcd/preproduction/` because it composes SP3 + SP6 and produces a decision struct that SP4 / SP5 / SP6 already know how to consume. There is no bidirectional dependency to invert; the dependency is one-way (SP7 → SP1–SP6) and SP7 lives where the rest of the lifecycle does. Synergy as a separate top-level concept is deferred indefinitely; if SP10's cost ledger or back-flow work ever justifies a sibling subdir, it can be a follow-up move, not a SP7 commitment.
- **Storyboard is dropped because UGC ads do not need a storyboard.** UGC ads are 1–3 shot vertical videos where the creator + script + identity context fully specifies the production. Storyboard is overkill. The creator script (production recipe) IS the approval object AND the production instruction. This is a real product call, not a refactor — it changes what Switchboard's existing `storyboard-builder.ts` is used for going forward (cinematic ads only, if at all).
- **One human gate at script→production is a pricing-driven product decision, not a UX simplification.** Pre-production tokens are cheap (Claude prompts); production tokens are expensive (Kling / Runway / HeyGen / Sora video gen). Gating at every stage wastes the human's attention; gating at the cost cliff is where the gate earns its keep. SP7 deletes per-stage 24h Inngest gates and ships exactly one gate at the script→production boundary.
- **The decision struct + stage outputs split is the difference between a forensic record and a creative artifact.** The decision says what got selected, under which identity/tier/version context, when, and by whom — that's the audit shape. The stage outputs carry the creative content (trends, motivators, hooks, scripts) — that's the working state. Merging them into one fat decision struct (rejected option C in Q12) blurs those two concerns and makes SP8's N-script world unwieldy.
- **`buildPcdIdentityContext` runs SP6's consent pre-check at the head, not at the gate.** Wasting Claude tokens on a creator whose consent is revoked (and whose generation is therefore legally blocked) is the failure mode B in Q8 was rejected for. Failing at the head saves all downstream work.
- **The composer is the spine, the gate is the cost cliff, the context is the audit subject.** SP7 ships exactly these three primitives plus the four stage-runner interfaces that connect them. Everything else (real Claude prompts, Inngest wiring, `WorkTrace` emit, dashboard UI, performance ledgers, provenance fields) is deferred. This is what makes SP7 small enough to ship in one slice while the synergy goal as a whole takes four.
- **`AutoApproveOnlyScriptGate` enforces "exactly one script" via `InvariantViolationError` on purpose.** SP7's invariant is single-script; SP8 widens. Throwing the invariant violation at the gate boundary makes the SP7-vs-SP8 contract surface visible at runtime — if SP7's stubs ever produced length-N output by mistake, the gate refuses immediately rather than silently selecting one. The guard is the bridge between SP7's single-script world and SP8's branching world.
- **`ugcStyleConstraints` is part of identity context, not stage-runner local state.** UGC creative-format ground truth (native vertical, creator-led, no overproduced storyboard, product fidelity, no invented claims) lives in `PcdIdentityContext` so every stage runner consumes the same constraint list. Putting it inside the runners would let trends/motivators/hooks/scripts drift apart on what "UGC" means — e.g., trends could surface broadcast-ad signals while scripts hold the line on creator-led format. Centralizing the constraints prevents that drift and makes the merge-back-time prompt-engineering surface explicit: every Switchboard runner reads the same field set.
