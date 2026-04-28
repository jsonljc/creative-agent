# CreativeAgent — Claude Code Instructions

PCD (Product/Creator Definition) Identity Registry. **Extracted from Switchboard SP1 to be built standalone, then merged back to Switchboard once SP2–SP6 ship.**

For Switchboard architectural context (what we're going to merge back into): `docs/SWITCHBOARD-CONTEXT.md`. **Read it before any architectural decision.**

## Mission

Build SP2–SP6 of the PCD vertical here, in isolation, with the same conventions as Switchboard so the eventual merge-back is mechanical:

| Slice | What | Status |
|---|---|---|
| SP1 | Identity registry data foundation (schemas, Prisma models, stores, backfill) | ✅ Extracted from Switchboard `05bc4655` |
| SP2 | `PcdTierPolicy` — pure deterministic gate | ⏳ Next up |
| SP3 | Wire policy into PCD job creation | — |
| SP4 | Tier-based provider routing | — |
| SP5 | QC gate logic | — |
| SP6 | Consent enforcement + Meta draft + revocation | — |

## Codebase Map

```
packages/schemas/            — Zod schemas for PCD identity registry (zod-only deps)
packages/db/                 — Prisma schema + 5 PCD stores + 2 SP1 migrations
packages/creative-pipeline/  — PCD logic: registry-backfill (SP1), tier-policy (SP2+)
docs/plans/                  — Original SP1 plan, design spec, SP2 handoff
docs/SWITCHBOARD-CONTEXT.md  — How this code plugs back into Switchboard
```

## Dependency Layers

```
Layer 1: schemas             → zod only
Layer 2: db                  → schemas + @prisma/client
Layer 3: creative-pipeline   → schemas + db + inngest
```

No circular deps. Mirrors the relevant slice of Switchboard's layer rules so merge-back is a flat copy.

## Build / Test / Lint

```bash
pnpm install
pnpm db:generate                        # Prisma client
pnpm db:migrate                         # Apply SP1 migrations
pnpm typecheck && pnpm test && pnpm lint
```

## Code Basics — match Switchboard exactly so merge-back is mechanical

- ESM only, `.js` extensions in relative imports
- Unused vars prefixed with `_`
- No `console.log` — use `console.warn` / `console.error`
- No `any` — use `unknown` and narrow
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width
- Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- Co-located tests (`*.test.ts`) for every new module
- Schema changes require a Prisma migration in the same commit
- File size: split proactively past 400 lines

## Merge-back rules

When this work merges back to Switchboard:

1. Package names will change `@creativeagent/*` → `@switchboard/*`. Use a single sed pass.
2. `packages/schemas/src/*` files merge into Switchboard's existing `packages/schemas/src/`. The PCD-specific files (`pcd-identity.ts`, etc.) are net-new; `creator-identity.ts` and `creative-job.ts` should reconcile against Switchboard's versions (Switchboard's are likely a superset by then).
3. Migrations in `packages/db/prisma/migrations/` are already on Switchboard `main` — DO NOT re-apply at merge-back. Just don't add a duplicate.
4. New SP2+ stores and pipeline files merge into the corresponding Switchboard packages.
5. Do not import anything from outside the PCD scope. If you find yourself reaching for Switchboard-only types (e.g. `WorkTrace`, `PlatformIngress`, governance types), define a local minimal contract here and let Switchboard supply the real one at merge time.

## What is NOT in scope

No chat, dashboard, governance core, MCP server, ad optimizer, or marketplace code. This repo is the PCD vertical only. If a feature would require any of those, document the contract you'd need from Switchboard in `docs/SWITCHBOARD-CONTEXT.md` and stub it locally.
