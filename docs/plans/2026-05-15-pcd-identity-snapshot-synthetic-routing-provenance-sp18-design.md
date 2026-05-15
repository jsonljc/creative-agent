# PCD SP18 — Synthetic Routing Provenance on PcdIdentitySnapshot — Design Spec

**Date:** 2026-05-15
**Status:** Draft (awaiting user review)
**Authors:** Jason + Claude (solo brainstorming, 8 architectural questions resolved as a single batched recommendation per the user's "no clarifying questions" instruction)
**Predecessor slice:** SP17 (synthetic provider routing — Seedance extension, **PR #17 OPEN at design time**; SP18 plan + execution gated on PR #17 squash-merge)
**Successor slice reserved by name:** none — SP18 closes the SP17 §1 successor reservation; future slices on this surface (e.g., delegation-decision persistence, flat-numeric cost rollups, index additions on SP18 columns) are unscoped and unowned

---

## 1. Scope & Strategy

SP18 persists the SP17 synthetic-pairing success decision onto `PcdIdentitySnapshot` as forensic provenance, closing the §1 successor reservation in the SP17 design. It widens the snapshot row with 6 flat columns plus 1 nullable `Json` reason column, ships a new pure store-injected stamper, and a new top-level orchestrator that composes SP9's `stampPcdProvenance` + SP18's `stampPcdSyntheticRoutingDecision` + the SP4 invariant lock-step + a new SP18 store contract.

**Mental model (user-affirmed at design time):**

- **SP17** = decide synthetic provider route.
- **SP18** = persist/stamp successful synthetic routing provenance.
- **SP21** = composer supplies `videoProviderChoice` per shot.

SP18 must not reopen router behavior. It only persists the forensic record of a successful synthetic pairing decision.

**Locked invariant (user-stipulated, §2.1 below):** SP18 only persists **successful synthetic-pairing decisions** (`{ allowed: true, kind: "synthetic_pairing" }`). It must never stamp delegation or denial branches. Enforced at the TypeScript layer via `Extract<...>` on the input type, at the schema layer via the SP18 reason-Json's `videoProvider` discriminator, and at the runtime layer via the stamper's defense-in-depth Zod parse.

**Key inflection (SP17 → SP18):** SP17 widened the routing decision to 5 branches but persisted nothing. SP18 reaches the persistence boundary and freezes the success-branch forensic fields onto the per-asset snapshot. Composer (SP21) and runtime provider call layers remain out of scope.

**Scope guardrail (user-approved, §2.1 below):** SP18 may NOT edit SP1–SP17 source bodies. It widens via additive nullable Prisma columns + new schemas + new stamper + new orchestrator + new store contract. The existing SP4 writer, SP9 orchestrator, SP10A orchestrator, SP10B budget gate, SP10C budget enforcer, and SP17 router bodies are preserved verbatim. Anti-pattern test enforces source-freeze keyed against the SP17 squash SHA (resolved at plan-write time after PR #17 lands).

**What SP18 deliberately does NOT do:**

- **No edits to the SP17 router.** SP17 is the source of truth for the decision; SP18 reads its output. Anti-pattern test asserts `route-synthetic-pcd-shot.ts`, `synthetic-provider-pairing.ts`, `synthetic-router-version.ts`, and the SP17 reason union are unchanged since SP17's squash.
- **No delegation-branch persistence.** When `SyntheticPcdRoutingDecision.kind === "delegated_to_generic_router"`, the asset's provenance lives in SP4's `routingDecisionReason` via the SP9/SP10A path. SP18 has nothing to say about delegated assets. (Q6 user direction.)
- **No denial-branch persistence.** Denials don't produce assets. SP18 only fires when an asset is actually being written.
- **No widening of the SP4-era Zod `PcdIdentitySnapshotSchema` in `pcd-identity.ts`.** Matches SP9/SP10A precedent: Prisma model widens, SP18 ships its own forensic schemas, store contract types carry the shape. The SP4-era read schema stays narrow.
- **No flat numeric column for cost rollups.** Inherited from SP10A §0 risk #6. SP18 is observability for the routing decision, not the cost decision.
- **No indexes in v1.** Composer doesn't ship until SP21; no proven query patterns yet. (Q7 user direction.)
- **No backfill of pre-SP18 snapshots.** Pre-SP18 rows have all 7 new columns null. Forensic record: those assets predate the synthetic-routing era. (Q8 user direction.)
- **No bundling with SP10A cost.** SP18 orchestrator does NOT call `stampPcdCostForecast`. Synthetic-routing and cost are orthogonal concerns. Production callers wanting both compose at merge-back via a separate orchestrator or future slice. (Q5 user direction.)
- **No SP10B/SP10C budget gates.** SP18 is post-decision persistence; budget gates are pre-decision policy. Orthogonal.
- **No SP6 consent re-check inside the SP18 stamper.** The orchestrator's SP9 stamper composition already performs the consent re-check (SP6 invocation #2). Re-checking inside the SP18 stamper would be a third invocation with no semantic gain.
- **No real Kling / DALL-E / Seedance API call.** Provider-call layer is out of PCD scope.
- **No composer wiring** (SP21).
- **No `PcdRoutingDecisionSchema` relocation.** SP18 doesn't import it. The SP16 MERGE-BACK marker (6) is resolved as **resolved by non-action** — no SP18-driven relocation required. (Q4 user direction.)
- **No runtime invariant** asserting "all production synthetic-pairing callsites must include SP18 stamping." The bare `writePcdIdentitySnapshot` (SP4), `writePcdIdentitySnapshotWithProvenance` (SP9), and `writePcdIdentitySnapshotWithCostForecast` (SP10A) callsites all remain valid for tests, ad-hoc backfills, and pre-SP21 paths. Production runner discipline at merge-back picks the orchestrator.

---

## 2. Locked decisions

### 2.1 Scope guardrails (user-approved)

**Guardrail A — success-only persistence (user-stipulated explicit invariant):**

> SP18 only persists successful synthetic pairing decisions. It must never stamp delegation or denial branches. This is enforced by the input type (`Extract<SyntheticPcdRoutingDecision, { allowed: true; kind: "synthetic_pairing" }>`), by the SP18 reason-Json schema (`videoProvider` discriminator restricted to `"kling" | "seedance"`), and by a runtime defense-in-depth Zod parse + refine in the stamper that rejects any other branch.

**Guardrail B — no SP1–SP17 source-body edits:**

> SP18 may NOT edit SP1–SP17 source bodies. The existing SP4 writer (`pcd-identity-snapshot-writer.ts`), SP6 consent pre-checks, SP7/SP8 chain/gate, SP9 stamper + orchestrator, SP10A stamper + orchestrator, SP10B budget gate, SP10C budget enforcer, SP11 synthetic identity, SP12 license gate, SP13 selector, SP14 disclosure registry, SP15 script-template selector, SP16 router, and SP17 router widening are preserved verbatim. Anti-pattern test asserts via `git diff <sp17-squash-sha>..HEAD` on the SP1–SP17 source-body file list.

**Guardrail C — composer-only version pinning:**

> Two parts:
>
> 1. **Sole literal site.** Among **non-test source files**, the literal `"pcd-synthetic-routing-provenance@"` appears in exactly one file: `synthetic-routing-provenance-version.ts`. No stamper, store, orchestrator, schema, or non-test fixture may inline the literal. Anti-pattern test #1 enforces.
> 2. **Sole runtime import site.** Among **non-test runtime sources**, the symbol `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` is imported by exactly one file: `stamp-pcd-synthetic-routing-decision.ts`. Tests are explicitly permitted to import the constant from `synthetic-routing-provenance-version.ts` for literal-pin assertions and forensic-payload assertions; this is not a violation.
>
> Mirrors the SP9 `PCD_PROVENANCE_VERSION` lock and SP10A `PCD_COST_FORECAST_VERSION` lock with the test carve-out made explicit. The stamper imports the constant; orchestrator + store + everything else reads the version forensically off the assembled payload.

**Guardrail D — single `crypto` call site:**

> Only `stamp-pcd-synthetic-routing-decision.ts` may import `node:crypto` (or any `crypto` symbol). The router, orchestrator, store contract, and version-constant file must remain pure of `crypto`. SP17 J4 inherited: router stays pure.

### 2.2 Decisions settled in this brainstorm

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Flat columns + single decision Json.** 6 flat columns (`imageProvider`, `videoProvider`, `videoProviderChoice`, `syntheticRouterVersion`, `syntheticPairingVersion`, `promptHash`) + 1 `syntheticRoutingDecisionReason Json` discriminated on `videoProvider`. | User direction. Direction (kling or seedance) lives inside the Json; only one is relevant per row. Splitting into `klingDirection Json?` + `seedanceDirection Json?` would create permanent dead fields. Matches SP9 (5 flat IDs + lineageDecisionReason Json) and SP4 (flat provider/model + routingDecisionReason Json) precedent of flat searchable identifiers + richer reason payload. |
| Q2 | **`videoProviderChoice` persists as a separate flat column from `videoProvider`,** even though SP17 schema-locks them to equality on success. | User direction. Forensic audit preserves user-intent even when system-output always equals it today. Future fallback / degradation / override slices may relax the lock; the audit model survives intentional divergence. Negligible storage cost. |
| Q3 | **`promptHash = sha256(dallePromptLocked, utf8)` computed inside the SP18 stamper.** Sole `crypto.createHash` call site across the SP18 surface. | User direction. The router must stay pure (SP17 J4 inherited). The stamper is the correct site for: `crypto.createHash`, pinning `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION`, computing stable hashes, and assembling the forensic payload. Splitting hash-compute from version-pin across files would dilute the stamper's responsibility. |
| Q4 | **No `PcdRoutingDecisionSchema` relocation.** SP16 MERGE-BACK marker (6) is **resolved by non-action** — SP18 does not import the schema, so moving it is cosmetic. | User direction. Prevents the marker from becoming zombie debt. The schema stays at its current source-of-truth file (the router that emits it). |
| Q5 | **Wrap, don't extend SP9.** New orchestrator `writePcdIdentitySnapshotWithSyntheticRouting` composes `stampPcdProvenance` (SP9) + new `stampPcdSyntheticRoutingDecision` (SP18) + duplicates the SP4 invariant logic (now 4-way lock-step: SP4/SP9/SP10A/SP18). | User direction. SP17 extended the router because the router was being widened. SP18 is a NEW provenance layer; extending SP9's stamper would violate "no edits to SP1–SP17 source bodies." SP18 orchestrator does NOT bundle SP10A cost — synthetic-routing and cost are orthogonal concerns. |
| Q6 | **Delegation + denial branches bypass SP18 entirely.** Stamper input is typed as `Extract<SyntheticPcdRoutingDecision, { allowed: true; kind: "synthetic_pairing" }>`. Delegations go through SP4/SP9/SP10A generic-router paths. Denials don't produce assets. | User direction + Guardrail A. Keeps SP18 honest: it's the synthetic-success persistence path and nothing else. Runtime Zod refusal as defense-in-depth complement to TS narrowing. |
| Q7 | **No indexes in SP18 v1.** | User direction. `imageProvider` is universally `"dalle"` (pointless), `videoProvider` is 2-valued (low-cardinality, marginal analytics value), `promptHash` is high-cardinality but no proven query pattern (composer doesn't ship until SP21). Adding indexes now is speculative; SP10A precedent (§0 risk #6) defers to a future slice. Write-throughput cost on the SP4 hot path matters; SP18 already widens the row by 7 columns. |
| Q8 | **Additive nullable widen, no backfill.** Pre-SP18 rows have all 7 new columns null. Anti-pattern tests verify both directions: pre-SP18 Prisma reads continue (automatic since nullable); new SP18 stamper writes populate all 7 fields end-to-end. | User direction. Match SP4/SP9/SP10A/SP10B/SP10C precedent. Backfill is impossible (pre-SP18 assets predate the synthetic-routing era; either field is null or we'd invent fake values). |
| Q9 | **`PcdIdentitySnapshotSchema` in `pcd-identity.ts` is NOT widened.** New fields are typed via SP18's store contract input + new `pcd-synthetic-routing-provenance.ts` schemas. | User direction + SP9/SP10A precedent. The SP4-era read schema is already "behind" the Prisma model (SP9 added 5 flat + 1 Json; SP10A added 1 Json — neither widened the Zod read schema). Widening it now would be inconsistent with two prior slices. |

### 2.3 Naming locks (user-affirmed)

> Use the long-but-explicit naming. It describes the domain concept (provenance of the synthetic routing decision), not the entity (`synthetic-routing-snapshot` would imply a new snapshot type — incorrect) and not the implementation (`synthetic-router-provenance` would imply ties to the router itself — incorrect).

| Surface | Name |
|---|---|
| Subdir | `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/` |
| Pinned constant | `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION = "pcd-synthetic-routing-provenance@1.0.0"` (22nd pinned PCD constant) |
| Stamper | `stampPcdSyntheticRoutingDecision` |
| Orchestrator | `writePcdIdentitySnapshotWithSyntheticRouting` |
| Schema file | `packages/schemas/src/pcd-synthetic-routing-provenance.ts` |
| Store contract | `PcdSp18IdentitySnapshotStore` with method `createForShotWithSyntheticRouting` |
| Prisma adapter | `adaptPcdSp18IdentitySnapshotStore` |
| Migration | `<ts>_pcd_identity_snapshot_sp18_synthetic_routing_provenance` |
| Anti-pattern test | `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts` |
| Worktree | `.worktrees/sp18` |
| Branch | `pcd/sp18-pcd-identity-snapshot-provenance-widen` |

### 2.4 Judgment calls baked into this spec (open to push-back at the user review gate)

| # | Decision | Rationale |
|---|---|---|
| J1 | **`PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` is the 22nd pinned PCD constant.** SP18 introduces exactly one new constant. The SP17 router/pairing versions are persisted as forensic data (read off the decision), NOT pinned by SP18 from import. | Mirrors SP9 (`PCD_PROVENANCE_VERSION`) and SP10A (`PCD_COST_FORECAST_VERSION`) — each slice pins its own forensic-record-shape version, orthogonal to the upstream logic/data versions whose values it persists. |
| J2 | **Stamper's `promptHash` recipe: `createHash("sha256").update(decision.dallePromptLocked, "utf8").digest("hex")`.** 64-hex-char lowercase string. | Match the user's brief verbatim ("sha256 over UTF-8 bytes of dallePromptLocked"). Lowercase-hex is the Node `crypto` default; deterministic. No salt. |
| J3 | **Stamper accepts only the success-branch type via TypeScript `Extract<...>`, AND defense-in-depth runtime Zod parse + refine.** Belt-and-suspenders. | TS narrowing fires at compile time inside the package; runtime parse defends against external callers who might pass a runtime-shaped value through `unknown` (e.g., from a test fixture or merge-back integration that loses the TS type). Throws `ZodError` on mismatch. |
| J4 | **The SP18 stamper does NOT perform a SP6 consent re-check.** The orchestrator's SP9 stamper composition already performs the consent re-check (SP9's Step 3, "second consent check"). Re-checking inside the SP18 stamper would be a third invocation with no semantic gain. | SP9's stamper already brackets the production-time interval. SP18 is downstream of SP9 in the orchestrator step ordering; revocation between SP9 stamp and SP18 stamp is sub-millisecond. The cost of a duplicate check exceeds the marginal compliance benefit. |
| J5 | **Stamper does NOT re-validate the input decision's `dallePromptLocked` length / format.** It hashes verbatim, trusting the SP17 schema's `z.string().min(1).max(4000)` constraint upstream. | Defense-in-depth Zod parse on the WHOLE input decision via `SyntheticPcdRoutingDecisionSchema` (with a runtime success-branch refinement) implicitly re-validates `dallePromptLocked`. No separate check needed. |
| J6 | **Forensic `decidedAt` on the SP18 reason Json uses `(stores.clock?.() ?? new Date()).toISOString()`.** | Matches SP9/SP10A wall-clock-stamp convention. Distinct from the upstream router's `decisionReason.matchedShotType` etc. (which are pure data). `decidedAt` is the stamping wall-clock, not the routing wall-clock — same convention as SP9's `lineageDecisionReason.decidedAt`. |
| J7 | **`syntheticRouterVersion` and `syntheticPairingVersion` flat columns are stamped from the decision's verbatim values, NOT from re-imports of `PCD_SYNTHETIC_ROUTER_VERSION` / `PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION`.** | Forensic fidelity: the row records what the router ACTUALLY emitted at decision time, even if a later replay against a bumped router would produce a different value. If the stamper re-imported the constants, it would always re-stamp the latest router version, masking historical-replay drift. SP9 does the same with `chainVersion` (stamped from the chain output, not re-imported). |
| J8 | **Stamper output schema `PcdSp18SyntheticRoutingDecisionReasonSchema` uses `z.union`, not `z.discriminatedUnion`.** Two branches keyed on `videoProvider` literal. | Same Zod 3.x carve-out as SP13/SP14/SP15/SP16/SP17: `z.discriminatedUnion` doesn't see literal discriminators on `.readonly()`-wrapped branches. `z.union` parses by trying members in order; semantically equivalent for a 2-branch shape. |
| J9 | **No flat `syntheticRoutingProvenanceVersion` column at the SP18 layer.** The version literal is carried inside `syntheticRoutingDecisionReason.syntheticRoutingProvenanceVersion` (Json field) only. | Forensic-record version is per-record metadata, not a query axis. Operators don't filter by "rows stamped under provenance v1.0.0 vs v1.1.0"; they filter by `videoProvider` or `promptHash`. Putting the version in the Json carries it forensically; promoting to a flat column anticipates analytics needs that aren't proven. |
| J10 | **Allowlist maintenance touches 9 prior anti-pattern test files.** SP9, SP10A, SP10B, SP10C, SP13, SP14, SP15, SP16, SP17. | Continuation of the SP10A→SP16→SP17 precedent. SP17 (after PR #17 merge) becomes a prior slice that needs allowlist widening for SP18's net-new files. |
| J11 | **Pinned-PCD-constant count goes 21 → 22 with SP18 land.** | SP17 bumped two existing version literals in place; SP18 introduces one new constant. The SP18 stamper is the sole import site, mirroring SP9 + SP10A. |
| J12 | **Anti-pattern test source-freeze diff is keyed against the SP17 squash SHA** (placeholder at design time; resolved at plan-write time after PR #17 merges). | Source-freeze keyed against the most-recent shipped slice's squash, per the SP9/SP10A/SP10B/SP10C/SP13–17 precedent. |
| J13 | **Stub stores (in-memory) on the test side.** No new Prisma test fixtures beyond the existing `prisma-pcd-identity-snapshot-store.test.ts` pattern. | Match SP10A's test surface. The behavioral assertions live at the stamper + orchestrator level (pure-function tests); the store-roundtrip test verifies the new method against a mocked Prisma client. |

---

## 3. Module Surface

### 3.1 File layout

```
packages/schemas/src/
  pcd-synthetic-routing-provenance.ts          [new — SP18 forensic schemas]
  __tests__/pcd-synthetic-routing-provenance.test.ts   [new — schemas package convention]
  index.ts                                     [edit — re-export pcd-synthetic-routing-provenance]

packages/db/prisma/
  schema.prisma                                [edit — widen PcdIdentitySnapshot with 6 flat + 1 Json]
  migrations/<ts>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/
    migration.sql                              [new — additive, nullable, no FK, no index]

packages/db/src/stores/
  prisma-pcd-identity-snapshot-store.ts        [edit — add createForShotWithSyntheticRouting + adaptPcdSp18IdentitySnapshotStore]
  prisma-pcd-identity-snapshot-store.test.ts   [edit — round-trip the new method]

packages/creative-pipeline/src/pcd/synthetic-routing-provenance/   [NEW SUBDIR]
  synthetic-routing-provenance-version.ts                          [22nd pinned constant]
  pcd-sp18-identity-snapshot-store.ts                              [SP18 store contract]
  stamp-pcd-synthetic-routing-decision.ts                          [pure stamper — sole crypto + version import site]
  write-pcd-identity-snapshot-with-synthetic-routing.ts            [orchestrator — 4-way lock-step]
  index.ts                                                         [public surface barrel]
  synthetic-routing-provenance-version.test.ts                     [literal pin]
  stamp-pcd-synthetic-routing-decision.test.ts                     [stamper unit tests]
  write-pcd-identity-snapshot-with-synthetic-routing.test.ts       [orchestrator unit tests]
  sp18-anti-patterns.test.ts                                       [10 structural + behavioral assertions]

— allowlist maintenance —
packages/creative-pipeline/src/pcd/{provenance,cost,cost-budget,...}/sp{9,10a,10b,10c,13,14,15,16,17}-anti-patterns.test.ts
                                                                   [edit — extend allowlists with SP18 net-new files]

packages/creative-pipeline/src/index.ts                            [edit — re-export ./pcd/synthetic-routing-provenance/index.js]
```

Pinned-PCD-constant count goes **21 → 22** after SP18 land (J11). The SP4 Zod `PcdIdentitySnapshotSchema` in `packages/schemas/src/pcd-identity.ts` is **NOT** edited (Q9 / J in §2.2). The SP17 source bodies (`pcd-synthetic-router.ts` schema, `route-synthetic-pcd-shot.ts` body, `synthetic-provider-pairing.ts` matrix, `synthetic-router-version.ts` constant) are **NOT** edited.

### 3.2 New zod schemas — `pcd-synthetic-routing-provenance.ts`

```ts
// PCD slice SP18 — Synthetic-routing-provenance forensic record. Carries the
// SP17 synthetic-pairing-success decision's persisted form on PcdIdentitySnapshot.
// Discriminated on videoProvider for the direction-bearing Json.
//
// MERGE-BACK: net-new SP18 schema. No reconciliation needed at Switchboard
// merge (net-new on both sides). If Switchboard adds provider-specific fields
// later, this schema widens here first and merges back additively.
//
// NB: z.union (not z.discriminatedUnion) — same Zod 3.x readonly carve-out as
// SP13/SP14/SP15/SP16/SP17. z.union parses by trying members in order;
// semantically equivalent for the 2-branch shape.
import { z } from "zod";
import {
  KlingDirectionSchema,
  SeedanceDirectionSchema,    // SP17
} from "./creator-identity-synthetic.js";
import { PcdShotTypeSchema, OutputIntentSchema } from "./pcd-identity.js";

const DecisionReasonInnerSchema = z
  .object({
    matchedShotType: PcdShotTypeSchema,
    matchedOutputIntent: OutputIntentSchema,
    selectionRationale: z.string().min(1).max(200),
  })
  .readonly();

export const PcdSp18SyntheticRoutingDecisionReasonSchema = z.union([
  // Branch 1 — Kling success.
  z
    .object({
      videoProvider: z.literal("kling"),
      klingDirection: KlingDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .readonly(),

  // Branch 2 — Seedance success.
  z
    .object({
      videoProvider: z.literal("seedance"),
      seedanceDirection: SeedanceDirectionSchema,
      pairingRefIndex: z.number().int().min(0),
      decisionReason: DecisionReasonInnerSchema,
      decidedAt: z.string().datetime(),
      syntheticRoutingProvenanceVersion: z.string().min(1),
    })
    .readonly(),
]);
export type PcdSp18SyntheticRoutingDecisionReason = z.infer<
  typeof PcdSp18SyntheticRoutingDecisionReasonSchema
>;

// Persistence input — flat shape for Prisma. 6 flat fields + 1 Json reason.
// Used as the "stamper output → orchestrator carries → store consumes" shape.
//
// Cross-field invariant (user-stipulated amendment): the flat videoProvider
// MUST match the discriminator inside the Json reason. A persisted row where
// these disagree is structurally impossible (the row would record "user got
// kling but reason carries seedance direction" — a corrupt forensic record).
// Enforced at schema level via .refine(); SP18 stamper assembles both from a
// single source value, so the refine is defensive against tampering and
// against external callers parsing untrusted Json.
export const PcdSp18SyntheticRoutingProvenancePayloadSchema = z
  .object({
    imageProvider: z.literal("dalle"),                          // v1.1.0: always "dalle"
    videoProvider: z.union([z.literal("kling"), z.literal("seedance")]),
    videoProviderChoice: z.union([z.literal("kling"), z.literal("seedance")]),
    syntheticRouterVersion: z.string().min(1),                  // verbatim from decision
    syntheticPairingVersion: z.string().min(1),                 // verbatim from decision
    promptHash: z.string().regex(/^[0-9a-f]{64}$/),             // sha256 hex lowercase
    syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReasonSchema,
  })
  .refine(
    (payload) =>
      payload.videoProvider === payload.syntheticRoutingDecisionReason.videoProvider,
    {
      path: ["syntheticRoutingDecisionReason", "videoProvider"],
      message:
        "syntheticRoutingDecisionReason.videoProvider must match flat videoProvider",
    },
  );
export type PcdSp18SyntheticRoutingProvenancePayload = z.infer<
  typeof PcdSp18SyntheticRoutingProvenancePayloadSchema
>;
```

`PcdIdentitySnapshotSchema` in `pcd-identity.ts` is intentionally not widened (Q9). Consumers who need the SP18 fields read them through the SP18 schemas or via Prisma's own typing.

### 3.3 22nd pinned constant — `synthetic-routing-provenance-version.ts`

```ts
// PCD slice SP18 — 22nd pinned PCD constant. Versions the SP18 forensic-record
// shape. Distinct from PCD_SYNTHETIC_ROUTER_VERSION (router logic) and
// PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION (matrix data) — those values are
// persisted as forensic data (read off the decision), not pinned by SP18.
// Bumped independently when the SP18 forensic-record shape evolves.
//
// MERGE-BACK: Switchboard merge does not change this literal. Bumping it
// requires a coordinated provenance-replay assessment.
export const PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION =
  "pcd-synthetic-routing-provenance@1.0.0";
```

Sole import site: `stamp-pcd-synthetic-routing-decision.ts` (Guardrail C). Anti-pattern test asserts no other source contains the literal `"pcd-synthetic-routing-provenance@"`.

### 3.4 SP18 stamper — `stamp-pcd-synthetic-routing-decision.ts`

```ts
// SP18 — Pure stamper. Sole crypto-importing file across the SP18 surface
// (Guardrail D). Sole PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION import site
// (Guardrail C). Validates the input is a success-branch decision (TS at
// compile time + Zod at runtime, J3 belt-and-suspenders), computes
// promptHash, pins the version, assembles the payload.
//
// MERGE-BACK: emit WorkTrace here (synthetic routing decision stamped).
// MERGE-BACK: replace crypto.createHash with a Switchboard-provided hasher if
// the merge-back ad-optimizer team owns hash discipline (currently unowned;
// Node's built-in sha256 is the default).

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type SyntheticPcdRoutingDecision,
  SyntheticPcdRoutingDecisionSchema,
  type PcdSp18SyntheticRoutingProvenancePayload,
  PcdSp18SyntheticRoutingProvenancePayloadSchema,
} from "@creativeagent/schemas";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

// TypeScript narrowing on the success branches (Q6 / Guardrail A).
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
): Promise<PcdSp18SyntheticRoutingProvenancePayload>;
```

**Behavior:**

1. **Defense-in-depth runtime parse (J3).** Re-parse `input.syntheticDecision` through `SyntheticPcdRoutingDecisionSchema`. Then runtime-refine: `parsed.kind === "synthetic_pairing" && parsed.allowed === true`. If not, throw a `ZodError` with a descriptive issue path. This catches external callers who pass a runtime-shaped value through `unknown`.
2. **Compute `promptHash`.** `createHash("sha256").update(parsed.dallePromptLocked, "utf8").digest("hex")` → 64-hex-char lowercase string.
3. **Wall-clock stamp.** `decidedAt = (stores.clock?.() ?? new Date()).toISOString()` (J6).
4. **Assemble flat columns** from the decision verbatim (`imageProvider`, `videoProvider`, `videoProviderChoice`, `syntheticRouterVersion`, `syntheticPairingVersion = parsed.pairingVersion`, `promptHash`).
5. **Assemble Json reason** discriminated on `videoProvider`:
   - Kling success → `{ videoProvider: "kling", klingDirection, pairingRefIndex, decisionReason, decidedAt, syntheticRoutingProvenanceVersion: PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION }`
   - Seedance success → `{ videoProvider: "seedance", seedanceDirection, pairingRefIndex, decisionReason, decidedAt, syntheticRoutingProvenanceVersion: PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION }`
6. **Defense-in-depth re-parse the assembled payload** through `PcdSp18SyntheticRoutingProvenancePayloadSchema`. Catches: (a) discriminator drift (e.g., a kling-success branch accidentally carrying `seedanceDirection`), and (b) the cross-field consistency invariant — `payload.videoProvider === payload.syntheticRoutingDecisionReason.videoProvider` — via the schema's `.refine()` (§3.2 amendment). Both checks are structurally impossible on the happy path because the stamper constructs both fields from the same source value; the re-parse is defensive against tampering and against external callers parsing untrusted Json.
7. **Return** the parsed payload.

**Failures:** all `ZodError`-class. No new error types. Propagated raw — no `try`/`catch` in the stamper body.

### 3.5 SP18 store contract — `pcd-sp18-identity-snapshot-store.ts`

```ts
// SP18 — Additive store contract. Imported from SP18 only. The SP4 / SP9 /
// SP10A contracts are preserved verbatim and continue to serve their callsites.
// The Prisma adapter (adaptPcdSp18IdentitySnapshotStore in packages/db/) wires
// this contract onto the widened PcdIdentitySnapshot model.

import type {
  PcdIdentitySnapshot,
  PcdProvenanceDecisionReason,
  PcdSp18SyntheticRoutingDecisionReason,
} from "@creativeagent/schemas";

export type PcdSp18IdentitySnapshotStore = {
  createForShotWithSyntheticRouting(input: {
    // SP4 base — identity-side + provider-side
    assetRecordId: string;
    productIdentityId: string;
    productTierAtGeneration: number;
    productImageAssetIds: ReadonlyArray<string>;
    productCanonicalTextHash: string;
    productLogoAssetId: string | null;
    creatorIdentityId: string;
    avatarTierAtGeneration: number;
    avatarReferenceAssetIds: ReadonlyArray<string>;
    voiceAssetId: string | null;
    consentRecordId: string | null;
    selectedProvider: string;
    providerModelSnapshot: string;
    seedOrNoSeed: string;
    rewrittenPromptText: string | null;
    // SP4 pinned versions (orchestrator stamps from imports)
    policyVersion: string;
    providerCapabilityVersion: string;
    routerVersion: string;
    shotSpecVersion: string | null;
    routingDecisionReason: unknown;            // SP4 Json forensic
    // SP9 lineage
    briefId: string;
    trendId: string;
    motivatorId: string;
    hookId: string;
    scriptId: string;
    lineageDecisionReason: PcdProvenanceDecisionReason;
    // SP18 synthetic-routing provenance — 6 flat + 1 Json
    imageProvider: "dalle";
    videoProvider: "kling" | "seedance";
    videoProviderChoice: "kling" | "seedance";
    syntheticRouterVersion: string;
    syntheticPairingVersion: string;
    promptHash: string;
    syntheticRoutingDecisionReason: PcdSp18SyntheticRoutingDecisionReason;
    // SP10A costForecastReason intentionally absent — SP18 orchestrator does not
    // bundle cost. Adapter writes the column as NULL via Prisma's default.
  }): Promise<PcdIdentitySnapshot>;
};
```

The adapter `adaptPcdSp18IdentitySnapshotStore(prismaStore): PcdSp18IdentitySnapshotStore` lives in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts` (widened, not new file).

### 3.6 SP18 orchestrator — `write-pcd-identity-snapshot-with-synthetic-routing.ts`

```ts
// SP18 — Production callsite that bridges SP9's lineage stamp with the SP18
// synthetic-routing-decision stamp. Composes SP9's pure stamper (which itself
// does the consent re-check), composes SP18's pure stamper, runs the SP4
// invariant path (4-way lock-step with SP4 + SP9 + SP10A), then persists.
//
// The SP4 writer body, SP9 orchestrator body, and SP10A orchestrator body are
// preserved verbatim. SP18 is the NEW callsite; merge-back-time production
// runner is required to call this one when persisting a synthetic-pairing
// success decision's provenance. Delegation cases (SP4 sp4Decision.kind) and
// denial cases (no asset produced) DO NOT use this path.
//
// MERGE-BACK: pick fanoutDecisionId convention (inherited from SP9/SP10A).
// MERGE-BACK: production runner discipline — all synthetic-pairing success
//             callsites should call this orchestrator at merge-back.

export type WritePcdIdentitySnapshotWithSyntheticRoutingInput = {
  snapshot: WritePcdIdentitySnapshotInput;
  provenance: StampPcdProvenanceInput;
  syntheticRouting: StampPcdSyntheticRoutingDecisionInput;
};

export type WritePcdIdentitySnapshotWithSyntheticRoutingStores = {
  pcdSp18IdentitySnapshotStore: PcdSp18IdentitySnapshotStore;
} & StampPcdProvenanceStores
  & StampPcdSyntheticRoutingDecisionStores;

export async function writePcdIdentitySnapshotWithSyntheticRouting(
  input: WritePcdIdentitySnapshotWithSyntheticRoutingInput,
  stores: WritePcdIdentitySnapshotWithSyntheticRoutingStores,
): Promise<PcdIdentitySnapshot>;
```

**Behavior, in order:**

1. **Stamp provenance (SP9 pure compose).** Walks the chain, re-checks consent, returns `PcdSp9ProvenancePayload`. Throws `ConsentRevokedRefusalError` / `InvariantViolationError` / `ZodError`. Propagated raw; SP18 stamper NOT called on failure.
2. **Stamp synthetic routing (SP18 pure compose).** Validates the success-branch input, computes `promptHash`, pins `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION`, returns `PcdSp18SyntheticRoutingProvenancePayload`. Throws `ZodError` on bad input. Propagated raw.
3. **SP4 Tier 3 invariant** (4-way lock-step with SP4/SP9/SP10A). Same 6-arg `assertTier3RoutingDecisionCompliant({ effectiveTier, shotType, outputIntent, selectedCapability, tier3RulesApplied, editOverRegenerateRequired })` call.
4. **Defense-in-depth Zod parse** on the SP4 input subset via `PcdSp4IdentitySnapshotInputSchema.parse(...)`. Mirrors SP4/SP9/SP10A allowlist forwarding.
5. **Pin SP4 version constants from imports.** Same 4 imports: `PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`, plus `shotSpecVersion` from input. **`PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` is NOT imported here** — it lives inside the SP18 stamper and is carried via `syntheticRoutingDecisionReason.syntheticRoutingProvenanceVersion` (Guardrail C).
6. **Assemble the merged payload** (19 SP4 base + 4 SP4 versions + 1 SP4 routingDecisionReason + 5 SP9 lineage + 1 SP9 lineageDecisionReason + 6 SP18 flat + 1 SP18 Json).
7. `// MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)`
8. **Persist via `stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting(payload)`.** SP4/SP9/SP10A store paths are NOT called.

### 3.7 Prisma migration

```sql
-- SP18 — Synthetic-routing provenance on PcdIdentitySnapshot.
-- All columns nullable for historical compatibility (pre-SP18 rows return NULL).
-- No FK, no index in v1.1 — see SP18 design §2.2 Q7.
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "imageProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProviderChoice" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRouterVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticPairingVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "promptHash" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRoutingDecisionReason" JSONB;
```

```prisma
model PcdIdentitySnapshot {
  // ...existing fields preserved verbatim through SP9 + SP10A widenings...

  // SP18 — Synthetic-routing provenance. All columns nullable for historical
  // compatibility (pre-SP18 rows return NULL). Populated by the SP18
  // orchestrator (writePcdIdentitySnapshotWithSyntheticRouting) for synthetic-
  // pairing success decisions only; delegation and denial decisions do NOT
  // use this path. No flat-numeric column and no index in v1.1 — see SP18
  // design §2.2 Q7.
  imageProvider                   String?
  videoProvider                   String?
  videoProviderChoice             String?
  syntheticRouterVersion          String?
  syntheticPairingVersion         String?
  promptHash                      String?
  syntheticRoutingDecisionReason  Json?

  // ...existing indexes preserved verbatim...
}
```

Migration timestamp picked at plan-execution time after SP17 squash lands. Discipline: `<utc-yyyymmddHHMMSS>_pcd_identity_snapshot_sp18_synthetic_routing_provenance`. Plan Task 1 verifies no drift via `pnpm prisma migrate diff`.

### 3.8 Public surface — `synthetic-routing-provenance/index.ts`

```ts
export { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";
export {
  stampPcdSyntheticRoutingDecision,
  type StampPcdSyntheticRoutingDecisionInput,
  type StampPcdSyntheticRoutingDecisionStores,
  type SyntheticPairingSuccessDecision,
} from "./stamp-pcd-synthetic-routing-decision.js";
export {
  writePcdIdentitySnapshotWithSyntheticRouting,
  type WritePcdIdentitySnapshotWithSyntheticRoutingInput,
  type WritePcdIdentitySnapshotWithSyntheticRoutingStores,
} from "./write-pcd-identity-snapshot-with-synthetic-routing.js";
export type { PcdSp18IdentitySnapshotStore } from "./pcd-sp18-identity-snapshot-store.js";
```

`packages/creative-pipeline/src/index.ts` re-exports `./pcd/synthetic-routing-provenance/index.js`. `packages/schemas/src/index.ts` re-exports `./pcd-synthetic-routing-provenance.js`.

---

## 4. Algorithm Details

### 4.1 Stamper pseudocode (`stampPcdSyntheticRoutingDecision`)

```
stampPcdSyntheticRoutingDecision(input, stores):
  // Step 1 — Defense-in-depth parse (J3 belt-and-suspenders).
  decision = SyntheticPcdRoutingDecisionSchema.parse(input.syntheticDecision)
  if not (decision.kind === "synthetic_pairing" && decision.allowed === true):
    throw new ZodError([{
      code: "custom",
      path: ["syntheticDecision"],
      message: "SP18 stamper only accepts synthetic-pairing success decisions",
    }])

  // Step 2 — Compute promptHash (J2).
  promptHash = createHash("sha256")
    .update(decision.dallePromptLocked, "utf8")
    .digest("hex")

  // Step 3 — Wall-clock stamp (J6).
  decidedAt = (stores.clock?.() ?? new Date()).toISOString()

  // Step 4 — Assemble Json reason discriminated on videoProvider.
  reasonBase = {
    pairingRefIndex: decision.pairingRefIndex,
    decisionReason: decision.decisionReason,
    decidedAt,
    syntheticRoutingProvenanceVersion: PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION,
  }
  reasonJson =
    decision.videoProvider === "kling"
      ? { videoProvider: "kling", klingDirection: decision.klingDirection, ...reasonBase }
      : { videoProvider: "seedance", seedanceDirection: decision.seedanceDirection, ...reasonBase }

  // Step 5 — Assemble flat columns from the decision verbatim (J7).
  payload = {
    imageProvider: decision.imageProvider,                // literal "dalle"
    videoProvider: decision.videoProvider,
    videoProviderChoice: decision.videoProviderChoice,
    syntheticRouterVersion: decision.syntheticRouterVersion,    // verbatim
    syntheticPairingVersion: decision.pairingVersion,           // verbatim
    promptHash,
    syntheticRoutingDecisionReason: reasonJson,
  }

  // MERGE-BACK: emit WorkTrace here (synthetic routing decision stamped)

  // Step 6 — Defense-in-depth re-parse (catches discriminator drift).
  return PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(payload)
```

### 4.2 Orchestrator pseudocode (`writePcdIdentitySnapshotWithSyntheticRouting`)

```
writePcdIdentitySnapshotWithSyntheticRouting(input, stores):
  // Step 1 — SP9 lineage stamp (delegates consent re-check).
  provenance = await stampPcdProvenance(input.provenance, {
    creatorIdentityReader: stores.creatorIdentityReader,
    consentRecordReader: stores.consentRecordReader,
    clock: stores.clock,
  })

  // Step 2 — SP18 synthetic-routing stamp.
  syntheticRouting = await stampPcdSyntheticRoutingDecision(input.syntheticRouting, {
    clock: stores.clock,
  })

  // Step 3 — SP4 Tier 3 invariant (4-way lock-step).
  assertTier3RoutingDecisionCompliant({
    effectiveTier: input.snapshot.effectiveTier,
    shotType: input.snapshot.shotType,
    outputIntent: input.snapshot.outputIntent,
    selectedCapability: input.snapshot.selectedCapability,
    tier3RulesApplied: input.snapshot.routingDecisionReason.tier3RulesApplied,
    editOverRegenerateRequired: input.snapshot.editOverRegenerateRequired,
  })

  // Step 4 — Defense-in-depth Zod parse on SP4 input subset.
  parsed = PcdSp4IdentitySnapshotInputSchema.parse({ /* 18 SP4 fields */ })

  // Step 5 — Pin SP4 version constants from imports.
  // PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION is NOT imported here — it lives
  // inside the SP18 stamper and is carried via syntheticRoutingDecisionReason
  // (composer-only version pinning lock — Guardrail C).
  payload = {
    ...parsed,
    policyVersion: PCD_TIER_POLICY_VERSION,
    providerCapabilityVersion: PCD_PROVIDER_CAPABILITY_VERSION,
    routerVersion: PCD_PROVIDER_ROUTER_VERSION,
    // SP9 lineage
    ...provenance,
    // SP18 synthetic-routing provenance
    ...syntheticRouting,
  }

  // MERGE-BACK: emit WorkTrace here (orchestrator pre-persist)

  // Step 6 — Persist via SP18 store.
  return stores.pcdSp18IdentitySnapshotStore.createForShotWithSyntheticRouting(payload)
```

### 4.3 Schema-level boundary lock — success-only persistence

SP18's defense-in-depth runs at three layers:

1. **TypeScript narrowing** — `StampPcdSyntheticRoutingDecisionInput.syntheticDecision: Extract<SyntheticPcdRoutingDecision, { allowed: true; kind: "synthetic_pairing" }>`. In-package callers cannot pass a denial or delegation branch — compile error.
2. **Schema discriminator** — `PcdSp18SyntheticRoutingDecisionReasonSchema` is a `z.union` of 2 branches keyed on `videoProvider: "kling" | "seedance"`. A Json with `videoProvider: undefined`, `videoProvider: "other"`, or with a `denialKind` field cannot round-trip through this schema.
3. **Runtime parse + refine** — Step 1 of the stamper re-parses the input through `SyntheticPcdRoutingDecisionSchema` (which accepts all 5 branches) and then refines to success-only, throwing `ZodError` on any non-success input.

This three-layer lock is overkill for the in-package happy path but necessary at merge-back: Switchboard's production runner may pass through `unknown`-typed boundary data (e.g., from a deserialized Inngest event), losing the TS narrowing. The runtime parse catches that.

### 4.4 Determinism

Replay invariant for the SP18 stamper: `(syntheticDecision, stores.clock())` → byte-equal `PcdSp18SyntheticRoutingProvenancePayload` modulo `decidedAt`. With a fixed clock injection, the output is fully deterministic — no `Math.random()`, no `Date.now()`, no `crypto.randomBytes()`. `crypto.createHash` is deterministic on its input.

Same purity envelope as SP9: no I/O, no network, no Prisma, no Inngest. The only `node:crypto` symbol is `createHash` (no `randomBytes`, no `randomUUID`, no `subtle`).

---

## 5. Test Strategy

### 5.1 SP18 stamper unit tests — `stamp-pcd-synthetic-routing-decision.test.ts` (~14 tests)

| Group | Cases |
|---|---|
| Kling-success happy path | input kling-success decision → output payload's `videoProvider === "kling"`, `videoProviderChoice === "kling"`, `imageProvider === "dalle"`, `syntheticRouterVersion === decision.syntheticRouterVersion` verbatim (J7), `syntheticPairingVersion === decision.pairingVersion` verbatim, `promptHash === sha256(decision.dallePromptLocked, utf8)`, `syntheticRoutingDecisionReason.videoProvider === "kling"`, `klingDirection` deep-equal input, `decidedAt` matches injected clock, `syntheticRoutingProvenanceVersion === "pcd-synthetic-routing-provenance@1.0.0"`. |
| Seedance-success happy path | symmetric: `videoProvider === "seedance"`, reason carries `seedanceDirection` only (no `klingDirection`), all flat columns set correctly. |
| Cross-pollution rejection | input kling-success with `seedanceDirection` field manually injected → defense-in-depth re-parse in Step 6 rejects (ZodError). |
| Denial-branch rejection | input ACCESS_POLICY denial decision → ZodError, "SP18 stamper only accepts synthetic-pairing success decisions". |
| NO_DIRECTION-denial rejection | input NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial → same ZodError. |
| Delegation rejection | input delegation decision → same ZodError. |
| promptHash determinism | same `dallePromptLocked` → same `promptHash`; different `dallePromptLocked` → different `promptHash`. |
| promptHash 64-hex-char format | output matches `/^[0-9a-f]{64}$/`. |
| promptHash UTF-8 correctness | `dallePromptLocked = "café"` (4 UTF-8 bytes incl. multi-byte é) hashes correctly (compare against a known sha256 fixture). |
| Clock injection | injected `clock: () => new Date("2026-01-15T12:34:56.789Z")` → `decidedAt === "2026-01-15T12:34:56.789Z"`. |
| Wall-clock fallback | no clock injection → `decidedAt` parses as a valid ISO 8601 datetime; current-time epsilon. |
| Version pin | `syntheticRoutingProvenanceVersion === "pcd-synthetic-routing-provenance@1.0.0"` (literal pin) — confirms version is imported, not hardcoded inline. |
| pairingRefIndex passthrough | `decision.pairingRefIndex === 0` (kling) → reason carries `pairingRefIndex: 0`; `pairingRefIndex === 1` (seedance) → reason carries `pairingRefIndex: 1`. |
| `decisionReason` deep-equal | input `decisionReason` (matchedShotType + matchedOutputIntent + selectionRationale) deep-equals output reason `decisionReason`. |

### 5.2 SP18 orchestrator unit tests — `write-pcd-identity-snapshot-with-synthetic-routing.test.ts` (~10 tests)

| Group | Cases |
|---|---|
| Full happy path — kling-success | stub SP18 store + valid SP9 chain fixture + kling-success decision → store called with full payload (19 SP4 + 4 SP4 versions + 1 SP4 routingDecisionReason + 5 SP9 lineage + 1 lineageDecisionReason + 6 SP18 flat + 1 SP18 Json). |
| Full happy path — seedance-success | symmetric: seedance-success decision → SP18 Json carries `seedanceDirection`. |
| Consent revoked at provenance stamp | mock `consentRecordReader.findById` returns `{ revoked: true }` → orchestrator throws `ConsentRevokedRefusalError` from Step 1; SP18 stamper NOT called; store NOT called. (Spy assertions on SP18 stamper.) |
| Lineage walk failure | mock chain result missing scriptId → orchestrator throws `InvariantViolationError` from Step 1; SP18 stamper NOT called. |
| Tier 3 invariant violation | input snapshot with selected capability not in tier-3 matrix → orchestrator throws `Tier3RoutingViolationError` from Step 3; store NOT called. |
| Tier 3 metadata mismatch | input snapshot with `tier3RulesApplied` not matching recompute → orchestrator throws `Tier3RoutingMetadataMismatchError` from Step 3. |
| SP4 input parse failure | input snapshot with missing required field → orchestrator throws `ZodError` from Step 4. |
| SP18 stamper input failure | input synthetic-routing decision is a denial branch → orchestrator throws `ZodError` from Step 2; Tier 3 invariant NOT run; store NOT called. |
| SP4 version pin | output payload carries `policyVersion === PCD_TIER_POLICY_VERSION` (literal import); `providerCapabilityVersion === PCD_PROVIDER_CAPABILITY_VERSION`; `routerVersion === PCD_PROVIDER_ROUTER_VERSION`. |
| Step ordering | provenance stamps before synthetic-routing stamps before Tier 3 invariant before SP4 parse — verified via call-order spies on the injected stubs. |

### 5.3 Zod schema tests — `packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts` (~12 tests)

- Round-trip parse on `PcdSp18SyntheticRoutingDecisionReasonSchema` for both branches (kling success + seedance success).
- Round-trip parse on `PcdSp18SyntheticRoutingProvenancePayloadSchema` for both flat-column variants.
- Reject: kling branch carrying `seedanceDirection`; seedance branch carrying `klingDirection`; missing `videoProvider`; `videoProvider: "other"`; missing `syntheticRoutingProvenanceVersion`; missing `decidedAt`; malformed `decidedAt` (non-ISO); `promptHash` not 64-hex-char; `promptHash` uppercase; `imageProvider` other than `"dalle"`; **flat-payload's `videoProvider` mismatching the reason Json's `videoProvider`** (caught by the schema's `.refine()` — §3.2 amendment — ZodIssue path `["syntheticRoutingDecisionReason", "videoProvider"]`).
- `.readonly()` enforcement on both branches.

### 5.4 Anti-pattern tests — `sp18-anti-patterns.test.ts` (10 assertions, source-level + behavioral)

**Source-level (cheap, deterministic):**

1. **Single-source pinning of `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION`** (Guardrail C, two parts):
   - **Sole literal site:** the literal `"pcd-synthetic-routing-provenance@"` appears in exactly ONE non-test source file: `synthetic-routing-provenance-version.ts`. (Scan: walk the source tree, exclude test files, assert exactly one match.)
   - **Sole runtime import site:** among non-test runtime sources, the symbol `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` is imported by exactly ONE file: `stamp-pcd-synthetic-routing-decision.ts`. Tests may import the constant from `synthetic-routing-provenance-version.ts` for literal-pin assertions and forensic-payload assertions; the test carve-out is explicit. (Scan: walk all `.ts` files except `*.test.ts` / `__tests__/`, grep `from ".*synthetic-routing-provenance-version` and assert exactly one match.)
2. **Single `crypto` import site (Guardrail D)** — across the entire SP18 surface, `node:crypto` is imported only by `stamp-pcd-synthetic-routing-decision.ts`. Anti-pattern test greps for `from "node:crypto"` and asserts exactly one source-file match.
3. **4-way lock-step with SP4/SP9/SP10A** — `write-pcd-identity-snapshot-with-synthetic-routing.ts` imports the same four SP4 version constants (`PCD_TIER_POLICY_VERSION`, `PCD_PROVIDER_CAPABILITY_VERSION`, `PCD_PROVIDER_ROUTER_VERSION`) AND calls `assertTier3RoutingDecisionCompliant` with the same six-argument shape as `pcd-identity-snapshot-writer.ts`, `write-pcd-identity-snapshot-with-provenance.ts`, `write-pcd-identity-snapshot-with-cost-forecast.ts`. (Test reads all four files and asserts structural equivalence.) **Plan directive (watchpoint):** the implementer subagent must copy the invariant call shape verbatim from `write-pcd-identity-snapshot-with-cost-forecast.ts` (the most-recent canonical orchestrator), not creatively re-derive it. Same imported invariant symbol, same six argument names sourced from the same `input.snapshot.*` paths, same pre-persist placement (after stamps, before Zod parse). The lock-step assertion is intentionally rigid; subagents may accidentally "simplify" by extracting a helper or renaming arguments — both break the lock-step.
4. **No SP1–SP17 source body edits (Guardrail B)** — `git diff <sp17-squash-sha>..HEAD` against the SP1–SP17 source-body file list returns empty for each. (SP17 squash SHA: J12 placeholder; resolved at plan-write time after PR #17 merges.) List of frozen source bodies: SP4 writer (`pcd-identity-snapshot-writer.ts`), SP6 consent pre-checks, SP7/SP8 chain/gate, SP9 stamper (`stamp-pcd-provenance.ts`) + orchestrator (`write-pcd-identity-snapshot-with-provenance.ts`), SP10A stamper + orchestrator, SP10B budget gate, SP10C budget enforcer, SP11 synthetic identity payload + schemas, SP12 license gate, SP13 selector, SP14 disclosure registry, SP15 script-template selector, SP16 router constants (`synthetic-router-version.ts`, `synthetic-provider-pairing.ts`), SP17 widened router body (`route-synthetic-pcd-shot.ts`), SP17 widened decision union (`pcd-synthetic-router.ts`), SP17 SP11 widen (`creator-identity-synthetic.ts`).
5. **Forbidden imports (broad)** — no SP18 source imports `@creativeagent/db`, `@prisma/client`, `inngest`, `node:fs`, `node:http`, `node:https`. (Test exempts itself.)
6. **Single-source `crypto.createHash` call** — exactly one occurrence of `createHash(` across the SP18 surface, inside `stamp-pcd-synthetic-routing-decision.ts`. Anti-pattern test asserts.
7. **No mutation of input decisions** — no SP18 source contains `syntheticDecision.videoProvider =`, `syntheticDecision.dallePromptLocked =`, or similar assignment-against-input patterns.

**Behavioral (calls the real stamper / orchestrator):**

8. **No silent denial persistence (Guardrail A)** — call `stampPcdSyntheticRoutingDecision` with every denial branch + the delegation branch (parametric across all 3 non-success branches) → each throws `ZodError`. Assertion: no path returns a payload.
9. **promptHash echo** — call stamper with a kling-success decision; assert output `promptHash === createHash("sha256").update(decision.dallePromptLocked, "utf8").digest("hex")`. Compute the hash inline in the test and compare verbatim. Distinct prompts produce distinct hashes.
10. **`videoProvider === videoProviderChoice` on persisted payload** — parametric: stamp both providers, assert `payload.videoProvider === payload.videoProviderChoice` AND `payload.syntheticRoutingDecisionReason.videoProvider === payload.videoProvider`. Schema-level lock echoed through to persistence.

### 5.5 Schemas-package barrel + Prisma-store tests

- `pcd-synthetic-routing-provenance.test.ts` (~12 tests, §5.3 above): co-located in `packages/schemas/src/__tests__/`.
- `prisma-pcd-identity-snapshot-store.test.ts` (extended): +3 cases — `createForShotWithSyntheticRouting` mocked-Prisma round-trip; adapter shape match; byte-equivalent legacy `create()` / `createForShotWithProvenance()` / `createForShotWithCostForecast()` body bodies preserved.

### 5.6 Allowlist maintenance (J10)

Extend the following anti-pattern test allowlists with SP18 net-new files:
- `sp9-anti-patterns.test.ts`
- `sp10a-anti-patterns.test.ts`
- `sp10b-anti-patterns.test.ts`
- `sp10c-anti-patterns.test.ts`
- `sp13-anti-patterns.test.ts`
- `sp14-anti-patterns.test.ts`
- `sp15-anti-patterns.test.ts`
- `sp16-anti-patterns.test.ts`
- `sp17-anti-patterns.test.ts` (post-PR-#17 squash)

Net-new files added to those allowlists:
- `packages/schemas/src/pcd-synthetic-routing-provenance.ts`
- `packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts`
- `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/sp18-anti-patterns.test.ts` (+ 3 co-located unit-test files)
- `packages/db/prisma/migrations/<ts>_pcd_identity_snapshot_sp18_synthetic_routing_provenance/migration.sql`

### 5.7 Integration / cross-package

- Full `pnpm typecheck && pnpm test` across all 5 packages. Target: SP17-tip baseline + ~46 SP18 net-new tests (14 stamper + 10 orchestrator + 12 zod + 10 anti-pattern + 3 prisma store widen ≈ **49** — call it 40–55).
- Prettier check via `pnpm exec prettier --check "packages/**/*.{ts,tsx,js,json,md}"`. The two SP5-baseline warnings on `tier-policy.ts` / `tier-policy.test.ts` carry over.
- Migration drift verification: `pnpm prisma migrate diff --from-empty --to-schema-datamodel packages/db/prisma/schema.prisma --script` matches the new 7-column widen. No drift.

---

## 6. Open questions / known unknowns

- **U1: Stamper output schema's cross-field consistency (flat `videoProvider` vs Json `videoProvider`).** **Resolved at user review (amendment):** enforced at the schema level via `.refine()` on `PcdSp18SyntheticRoutingProvenancePayloadSchema` (§3.2). Reason: this is a persisted forensic payload, and the schema should reject impossible persisted shapes — not just trust the in-package stamper to assemble them correctly. Defends against external callers (merge-back integration, deserialized Json) parsing a corrupt row. The stamper still constructs both fields from the same source value (the SP17 decision's `videoProvider`), so the refine never fires on the happy path; it fires only on tampered or hand-constructed payloads.

- **U2: `promptHash` collision risk.** sha256 collision probability is negligible at any conceivable scale. No truncation. 64 hex chars stored. **Decision baked**: no collision-handling.

- **U3: Defense-in-depth Zod parse on the WHOLE decision (`SyntheticPcdRoutingDecisionSchema.parse`) is expensive.** ~2 ms per call on a complex decision. **Decision baked**: accept the cost for merge-back-safety (external callers can bypass TS narrowing through `unknown`). The cost is per-asset-write, not per-router-call — production runner volume is bounded by asset count.

- **U4: `decidedAt` clock skew across SP9 + SP18 stamps.** SP9's `lineageDecisionReason.decidedAt` and SP18's `syntheticRoutingDecisionReason.decidedAt` are stamped at separate `(stores.clock?.() ?? new Date()).toISOString()` calls within the same orchestrator invocation. They can differ by sub-millisecond. **Decision baked**: accept the drift; analytics that need a single timestamp use SP9's (lineage stamps first).

- **U5: `syntheticPairingVersion` vs `pairingVersion` naming asymmetry.** SP17 ships `pairingVersion` on the decision (no `synthetic` prefix); SP18 flat column is `syntheticPairingVersion` (with prefix, for disambiguation against `routerVersion` — SP4's generic provider-router version — which lives in the same Prisma row). **Decision baked into §3.2/§3.7**: stamp `syntheticPairingVersion = decision.pairingVersion` verbatim at the stamper. Audit trail naming: the row says `syntheticPairingVersion`, the decision says `pairingVersion`, both carry the literal `"pcd-synthetic-provider-pairing@1.1.0"`.

- **U6: Delegation-path persistence — future slice scope.** SP18 does NOT persist delegated decisions. If a future slice wants to record "this asset was delegated to the SP4 generic router from the synthetic surface," that slice widens SP4's `routingDecisionReason` to embed `delegatedFromSyntheticPath: true` (or similar). **Out of SP18 scope** per Q6 user direction.

- **U7: Multiple SP18 orchestrators at merge-back?** Production callers wanting "lineage + cost + synthetic-routing" cannot use SP18 alone (no cost) and cannot use SP10A alone (no synthetic-routing). Two paths forward at merge-back: (a) a new orchestrator that composes SP9 + SP10A stamper + SP18 stamper (5-way lock-step on the SP4 invariant); (b) Switchboard production runner picks the most-relevant orchestrator per asset (synthetic-pairing assets → SP18; delegated assets → SP10A with cost). **Out of SP18 scope** — neither is committed; merge-back team picks.

---

## 7. Merge-back to Switchboard

Strictly additive:

- **Seven new Prisma columns** (`PcdIdentitySnapshot.imageProvider`, `videoProvider`, `videoProviderChoice`, `syntheticRouterVersion`, `syntheticPairingVersion`, `promptHash`, `syntheticRoutingDecisionReason`), one migration. Already on Switchboard's `main` after merge-back (per CLAUDE.md rule 3 — never re-apply migrations).
- **One net-new schemas file** (`packages/schemas/src/pcd-synthetic-routing-provenance.ts`).
- **One net-new pinned constant** (`PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION = "pcd-synthetic-routing-provenance@1.0.0"`). Count: 21 → 22.
- **Three net-new creative-pipeline source files** under the SP18 subdir: stamper, orchestrator, store contract. Plus version-constant file and barrel.
- **One DB store edit** (`prisma-pcd-identity-snapshot-store.ts` adds `createForShotWithSyntheticRouting` + `adaptPcdSp18IdentitySnapshotStore`).
- **Allowlist maintenance** across 9 prior anti-pattern test files.
- **Sed-pass `@creativeagent/*` → `@switchboard/*`** continues mechanically.
- **No imports outside the PCD scope.**

**`// MERGE-BACK:` markers** (placed at):

1. `PcdSp18SyntheticRoutingDecisionReasonSchema` (schemas file) — "Net-new SP18 schema. No reconciliation needed at Switchboard merge."
2. `PcdSp18SyntheticRoutingProvenancePayloadSchema` (schemas file) — "Net-new SP18 persistence shape."
3. `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` (version-constant file) — "Switchboard merge does not change this literal. Bumping it requires a coordinated provenance-replay assessment."
4. `stampPcdSyntheticRoutingDecision` — "Net-new SP18 stamper. Sole crypto + version import site. Switchboard's ad-optimizer team may replace `crypto.createHash` if they own hash discipline (currently unowned)."
5. WorkTrace emit markers — two in stamper (one after Step 4 reason assembly, one after Step 6 re-parse) + one in orchestrator (pre-persist, Step 7).
6. `writePcdIdentitySnapshotWithSyntheticRouting` — "Net-new SP18 orchestrator. Production runner discipline at merge-back: synthetic-pairing success callsites should call this; delegation cases continue via SP4/SP9/SP10A; denial cases produce no asset."
7. `PcdSp18IdentitySnapshotStore` — "Net-new SP18 store contract. Prisma adapter `adaptPcdSp18IdentitySnapshotStore` lives in `packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts`."
8. `fanoutDecisionId` — inherited from SP9/SP10A. "Pick fanoutDecisionId convention (Inngest event id vs synth hash)." Same marker, same deferral.

**Architectural seams the merge-back does NOT need to rewrite:**

- The SP18 stamper + orchestrator are pure store-injected. No production wiring inside `packages/creative-pipeline/src/pcd/synthetic-routing-provenance/` changes at merge-back — only the injected stores swap (Prisma-backed via `adaptPcdSp18IdentitySnapshotStore`) and the `// MERGE-BACK:` markers get implementations.
- SP18 introduces NO circular dependency. `pcd/synthetic-routing-provenance/` imports from: `pcd/provenance/` (SP9 stamper), `pcd/` top-level (SP4 invariant, writer types), schemas barrel. Reverse direction does not exist.
- SP17 router behavior is preserved verbatim. The SP18 orchestrator reads the SP17 decision; it does not modify it.

---

## 8. Out-of-scope (explicit)

Carried forward from §1 and consolidated:

- **No edits to SP1–SP17 source bodies.** Guardrail B.
- **No widening of `PcdIdentitySnapshotSchema` in `pcd-identity.ts`.** Q9.
- **No flat numeric column or index on SP18 columns.** Q7. SP10A precedent.
- **No backfill of pre-SP18 snapshots.** Q8.
- **No SP18 bundling with SP10A cost.** Q5.
- **No SP6 consent re-check inside the SP18 stamper.** J4.
- **No delegation-branch persistence.** Q6 / Guardrail A.
- **No denial-branch persistence.** Q6 / Guardrail A.
- **No `PcdRoutingDecisionSchema` relocation.** Q4. SP16 MERGE-BACK marker (6) resolved by non-action.
- **No runtime invariant** asserting "all production synthetic-pairing callsites must include SP18 stamping." Production runner discipline at merge-back.
- **No real Kling / DALL-E / Seedance API call.**
- **No composer wiring** (SP21).
- **No Inngest function, no admin UI, no async job integration.**
- **No QC face-match wiring.** SP20's job.
- **No SP17 router edits.** SP17 is the source of truth for the decision.
- **No SP19 / SP20 scaffolding.** Reserved unscoped.

---

## 9. Implementation slicing (preview, not the plan)

The SP18 plan will be written next via `writing-plans`. Anticipated task list, TDD-paced (one test commit per task):

| # | Task | Approx tests |
|---|---|---|
| 1 | **Pre-flight gate.** Verify PR #17 is squash-merged. Capture SP17 squash SHA into the SP18 plan's source-freeze diff (J12). `git diff <sp17-squash-sha>..HEAD -- packages/db/prisma/schema.prisma` empty; baseline `pnpm typecheck && pnpm test` at SP17-tip green. Prettier clean modulo SP5 baseline. `pnpm prisma migrate status` clean. | — |
| 2 | `PcdSp18SyntheticRoutingDecisionReasonSchema` + `PcdSp18SyntheticRoutingProvenancePayloadSchema` in `pcd-synthetic-routing-provenance.ts`. Co-located schema tests covering both branches + cross-branch rejection cases. Barrel re-export. | ~10 |
| 3 | Prisma migration: 7-column widen on `PcdIdentitySnapshot`. Update `schema.prisma`. No indexes. Migration timestamp captured at the moment of authoring. | — |
| 4 | `prisma-pcd-identity-snapshot-store.ts` widen — add `createForShotWithSyntheticRouting` method to the Prisma store class + `adaptPcdSp18IdentitySnapshotStore` adapter that returns the SP18 contract. Existing SP4 / SP9 / SP10A method bodies preserved byte-equivalent. Round-trip test with a mocked Prisma client. | ~3 |
| 5 | `PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION` constant + literal-pin test. | ~1 |
| 6 | `PcdSp18IdentitySnapshotStore` contract type. (Type-only; no body. Used by the orchestrator.) | — |
| 7 | `stampPcdSyntheticRoutingDecision` body. Defense-in-depth parse, promptHash, decidedAt, payload assemble, re-parse. Unit tests covering kling-success / seedance-success happy paths, denial / delegation rejection, cross-pollution rejection, clock injection, version pin, promptHash determinism. | ~14 |
| 8 | `writePcdIdentitySnapshotWithSyntheticRouting` body. 4-way SP4 invariant lock-step. Unit tests covering full happy path (both providers), consent revocation pre-empts SP18 stamper, Tier 3 violation pre-empts persist, SP18 stamper error pre-empts Tier 3, version pin invariants, step-ordering spies. | ~10 |
| 9 | `sp18-anti-patterns.test.ts` — 10 source-level + behavioral assertions per §5.4. Includes git-diff source-freeze keyed to the SP17 squash SHA captured in Task 1. | ~10 |
| 10 | Allowlist maintenance — extend 9 prior `sp{9,10a,10b,10c,13,14,15,16,17}-anti-patterns.test.ts` allowlists with SP18 net-new files per §5.6. | — |
| 11 | Schemas + creative-pipeline barrel re-exports verified end-to-end. (May fold into Task 2 / Task 5 / Task 8 if no drift surfaces.) | — |
| 12 | Final full-repo `pnpm typecheck && pnpm test && pnpm exec prettier --check ...` sweep. Target: SP17 baseline + ~46 SP18 net-new ≈ **~2021 passing, 2 skipped unchanged** (assuming SP17 lands at ~1975). | — |

**Estimated: ~12 commits squashed to 1 PR. Worktree: `.worktrees/sp18`. Branch: `pcd/sp18-pcd-identity-snapshot-provenance-widen`. Every implementer subagent prompt opens with `pwd` + `git branch --show-current` and refuses to proceed if the path/branch doesn't match — per the SP13/SP14/SP15/SP16/SP17 subagent-wrong-worktree lesson.**

**Plan-execution prerequisite:** PR #17 must be squash-merged to `main` before Task 1 runs. The SP17 squash SHA fills the J12 placeholder. If SP18 work begins before PR #17 lands, the source-freeze diff is undefined; the plan must block.

---
