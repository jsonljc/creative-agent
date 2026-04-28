# Switchboard Context for CreativeAgent

This repo will eventually merge back into Switchboard (`~/switchboard`, GitHub `jsonljc/switchboard`). Code written here must honor Switchboard's invariants, conventions, and integration surface so the merge-back is mechanical, not architectural.

**Source of truth for the parent system:** Switchboard `main` branch. SP1 was merged at commit `05bc4655` (PR #283).

## Switchboard at a glance

> Governed operating system for revenue actions. TypeScript monorepo (pnpm + Turborepo). Multi-channel chat orchestration, agent governance, workflow execution.

It is **not** a creative tool — PCD is one vertical inside a much larger platform that also handles sales pipelines, ad optimization, CRM, calendars, escalations, and marketplaces.

## Core invariants (Switchboard-wide — ours to honor)

These are quoted from Switchboard's `CLAUDE.md` and `docs/DOCTRINE.md`:

1. **Mutating actions enter through `PlatformIngress.submit()`.** PCD job creation is a mutating action. SP3 will eventually wire `PcdTierPolicy` into the ingress path; until then, our policy is a pure function with no side effects.
2. **`WorkTrace` is canonical persistence.** Anything we mutate in production must produce a WorkTrace entry. In this repo we don't have WorkTrace — when SP3+ adds anything that would write one, leave a `// MERGE-BACK: emit WorkTrace here` comment instead of inventing a local equivalent.
3. **Approval is lifecycle state, not a route-owned side effect.** SP6 will add Meta draft + consent revocation gates; these must integrate with Switchboard's `ApprovalLifecycle` model when merged back. Don't roll our own approval here.
4. **Tools are audited, idempotent product surfaces.** The backfill function we ported is already idempotent (event-triggered, find-or-create). Keep this property in any new code.
5. **Human escalation is first-class architecture.** If a tier policy decision could plausibly require human review (e.g. Tier-3 with no consent record), surface that as a return value from the policy function — don't auto-route, don't fail silently.
6. **No mutating bypass paths.** Every PCD generation path goes through the same gate. No "internal" or "system" actor exemption.

## Switchboard package layers (relevant slice)

```
schemas              ← @creativeagent/schemas merges into here
sdk, cartridge-sdk   ← not in scope for PCD
creative-pipeline    ← @creativeagent/creative-pipeline merges into here
ad-optimizer         ← not in scope
core                 ← we don't touch this; SP3+ may need to call into it
db                   ← @creativeagent/db merges into here
apps/api             ← Inngest functions register here; SP1 backfill already wired
apps/dashboard       ← UI work is a separate stream — not our concern
apps/chat            ← not in scope
apps/mcp-server      ← not in scope
```

When merging back, **package names rename** (`@creativeagent/X` → `@switchboard/X`) and files land in identical relative paths.

## Integration surface — what each SP needs from Switchboard

### SP2 (PcdTierPolicy)

**Standalone in this repo.** Pure function, no I/O. Inputs: avatar tier, product tier, shot type, output intent. Output: `PcdTierDecision`.

Nothing to stub — entire SP2 lives in `packages/creative-pipeline/src/pcd/tier-policy.ts` with matrix tests.

### SP3 (wire policy into job creation)

**Will need from Switchboard at merge:**
- `CreativeJobStore.create()` call site in `packages/creative-pipeline/src/runners/` (Switchboard's existing creative job runner)
- Resolver pattern that joins `AssetRecord.creator` (per design spec)

**Stub strategy here:** define a local `CreativeJobIngressContract` interface that captures only what the policy gate needs. SP3 implementation calls the contract; merge-back swaps in Switchboard's real ingress.

### SP4 (tier-based routing)

**Will need:**
- Switchboard's `ProviderRegistry` (`packages/core/src/providers/...`) — Sora, Veo, Runway, Kling, HeyGen profiles
- Capability descriptors

**Stub strategy:** local `ProviderProfile` type with the minimum fields the router reads. Mark any Switchboard-only fields as `// MERGE-BACK: replace with Switchboard ProviderProfile`.
- **CampaignTakeStore is an SP4-declared orchestration dependency; production implementation is reserved for SP6 ApprovalLifecycle/campaign-take ownership at merge-back.**
- **`PcdIdentitySnapshotStore.createForShot` (creative-pipeline) vs `PrismaPcdIdentitySnapshotStore.create` (db): method names diverge intentionally for semantic clarity. At merge-back, wire via a thin adapter `{ createForShot: (i) => prismaStore.create(i) }` rather than renaming either side.**

### SP5 (QC gate)

**Will need:**
- `AssetRecord` writes (already in our schema — same shape as Switchboard's)
- QC providers (likely external APIs, not Switchboard internals)

Mostly self-contained.

### SP6 (consent + Meta draft + revocation)

**Will need:**
- Switchboard's `ApprovalLifecycle` model (lives at `packages/core/src/approval/`)
- WorkTrace emit
- Notification fan-out via three-channel system

**Stub strategy:** local `ApprovalRequest` interface. SP6 is the slice with the most merge-back surface — write it last and write it knowing it will get rewritten against the real contracts.

## Conventions inherited from Switchboard

These are already enforced in `CLAUDE.md` but listed here for the merge-back checklist:

- ESM, `.js` relative import extensions
- No `any`, no `console.log`
- Conventional Commits
- Co-located `*.test.ts`
- Prettier: semi, double quotes, 2 spaces, trailing commas, 100 cols
- Migration in same commit as schema change
- 400-line soft / 600-line hard file size limits

## Do not invent

If you're tempted to build something that already exists in Switchboard:

- Auth, sessions, NextAuth → don't. We have no UI here.
- Encryption / credentials → there's a real encryption layer in Switchboard's `packages/db/src/crypto/`. Don't re-implement.
- Inngest client setup → use the established pattern (`new Inngest({ id: "switchboard" })` — yes, keep that ID literal so merge-back doesn't have to relabel).
- Audit log writers → wait for `WorkTrace` at merge-back.

## Where to look in Switchboard when stuck

- `~/switchboard/CLAUDE.md` — invariants, layer rules, lint rules
- `~/switchboard/docs/DOCTRINE.md` — architectural rules
- `~/switchboard/docs/ARCHITECTURE.md` — deep architecture
- `~/switchboard/.agent/RESOLVER.md` — agent operating layer for the parent project
- `~/switchboard/packages/schemas/src/index.ts` — full schema barrel (what types we'd inherit)
- `~/switchboard/packages/db/prisma/schema.prisma` — full Prisma schema, including all the models we trimmed away

You can `git show 05bc4655:<path>` from inside `~/switchboard` to read any SP1-state file without checking out a branch.
