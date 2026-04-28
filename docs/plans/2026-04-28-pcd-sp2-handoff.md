---
date: 2026-04-28
tags: [switchboard, pcd, sp2, handoff]
status: ready
---

# PCD SP2 Handoff Note

**Created:** 2026-04-28 (after SP1 merged)
**For:** the next Claude session that picks up SP2

## Where SP1 left off

- **SP1 merged to `main` as `05bc4655`** (squash) on 2026-04-28 ~08:31 UTC.
- **Remote branch `feat/pcd-registry-sp1` deleted** at merge time.
- **Worktree at `~/switchboard/.claude/worktrees/pcd-registry-sp1` removed.**
- **Local checkout at `~/switchboard` is on `fix/launch-webhook-provisioning`** and was untouched throughout SP1 work.
- The dedicated SP1 dev database `switchboard_sp1` still exists on `localhost:5432`. It can be dropped (`dropdb switchboard_sp1`) any time — SP2 should use a fresh per-branch DB.
- All 10 CI checks were green at merge. The pre-existing `conversion-bus-bootstrap.test.ts` flake did not reproduce.

## What SP1 actually shipped

- Six new Zod schemas in `@switchboard/schemas/pcd-identity` (`IdentityTier`, `ProductIdentity`, `ProductImage`, `ConsentRecord`, `ProductQcResult`, `PcdIdentitySnapshot`).
- Tier extensions on existing `CreatorIdentitySchema` (`qualityTier`, `consentRecordId`, `identityAdapter` — all optional, fully back-compat).
- Five new Prisma models + tier columns on existing `CreatorIdentity` and `CreativeJob`.
- Two migrations: `20260428065707_pcd_registry_sp1` (the main schema) and `20260428082529_pcd_registry_sp1_race_fix` (added `@@unique([orgId, title])` on `ProductIdentity` plus a partial unique index on `CreatorIdentity (deploymentId) WHERE qualityTier='stock'`).
- Three new stores (`PrismaProductIdentityStore`, `PrismaConsentRecordStore`, `PrismaPcdIdentitySnapshotStore`) and tier-setter / registry-link methods on the existing `CreatorIdentity` and `CreativeJob` stores.
- Idempotent backfill Inngest function in `apps/api/src/services/cron/pcd-registry-backfill.ts` (event-triggered: `pcd/registry.backfill.requested`), wired into `apps/api/src/bootstrap/inngest.ts`.

**Zero behaviour change to live PCD execution.** The data foundation is in place; nothing reads from it yet.

## SP2 scope (per the spec)

Build `PcdTierPolicy` — the deterministic backend-enforced gate that decides whether a given `(avatarTier, productTier, shotType, outputIntent)` is allowed.

- **Lives at:** `packages/creative-pipeline/src/pcd/tier-policy.ts` (new directory).
- **Pure function, no I/O.** No Prisma, no Inngest, no provider calls. Inputs come from the registry (T9–T13 stores written in SP1); outputs are a `PcdTierDecision`.
- **Exhaustive matrix tests** at `packages/creative-pipeline/src/pcd/tier-policy.test.ts`. The required test matrix (avatarTier × productTier × shotType × outputIntent) and the required acceptance assertions are documented in the design spec.
- **No DB, no migration, no provider integration.** SP3 wires the policy into PCD job creation; SP4 routes by tier; SP5 adds QC; SP6 wires consent enforcement.

## Required reading before SP2 starts

1. `~/secondbrain/05_OUTPUTS/Plans/2026-04-27-pcd-identity-registry-design.md` — the source-of-truth design spec. Sections to re-read:
   - "Tier gating rules" (the reference policy function shape)
   - "Tier policy test matrix" (the assertions SP2 must make pass)
   - "Tier 3 mandatory routing rules" (informs SP4 — context only for SP2)
2. `~/secondbrain/05_OUTPUTS/Plans/2026-04-27-pcd-registry-sp1-plan.md` — the SP1 implementation plan, used as a TDD pattern template.
3. The merged SP1 commit on main: `05bc4655`. Skim it to confirm what's actually in main.

## Pre-SP2 kickoff checklist

Run **before** writing any SP2 code or plan:

1. **Pull main:**
   ```bash
   cd ~/switchboard
   git fetch origin
   git log origin/main --oneline -5    # confirm 05bc4655 (or later SP1-related) is present
   ```
2. **Apply the SP1 migration to your main local DB** (the shared one, NOT the disposable `switchboard_sp1`):
   ```bash
   pnpm db:migrate     # applies 20260428065707_pcd_registry_sp1 and 20260428082529_pcd_registry_sp1_race_fix
   ```
   If Prisma asks to reset, **stop and ask the user**. The race-fix migration adds a `@@unique([orgId, title])` constraint that will fail to apply if duplicate ProductIdentity rows already exist — but SP1 just landed, so no row should exist yet on a normal local DB.
3. **Verify no SP1 follow-up regressions:**
   ```bash
   pnpm typecheck    # all 18 packages
   pnpm test         # tolerate the pre-existing conversion-bus-bootstrap flake; nothing else should fail
   pnpm lint         # 0 errors expected; 45 pre-existing warnings unchanged
   ```
4. **Confirm the registry tables actually exist** in the local DB:
   ```bash
   psql -h localhost -U switchboard -d switchboard -c "\dt" | grep -E "ProductIdentity|ConsentRecord|PcdIdentitySnapshot"
   ```
5. **Create a fresh worktree off the new main:**
   ```bash
   cd ~/switchboard
   git worktree add .claude/worktrees/pcd-tier-policy-sp2 -b feat/pcd-tier-policy-sp2 origin/main
   cd .claude/worktrees/pcd-tier-policy-sp2
   pnpm install --frozen-lockfile
   ```
6. **Use a fresh per-branch DB for SP2:**
   ```bash
   createdb switchboard_sp2
   # update worktree's .env to point DATABASE_URL at switchboard_sp2
   pnpm db:migrate    # apply all migrations including SP1's
   ```
   This keeps SP2 isolated from the main DB just like SP1 did.

## Known risks / assumptions for SP2

1. **The race-fix migration assumes empty `ProductIdentity`.** If anyone has manually seeded duplicate `(orgId, title)` rows on their local DB before pulling main, the second SP1 migration will fail. Resolution: drop the dupes manually, then re-run `pnpm db:migrate`.

2. **`creatorIdentityId` on `CreativeJob` has no FK constraint.** This is intentional per the SP1 design (the resolver in SP3 owns the join via `AssetRecord.creator`). SP2 doesn't touch this, but if a code reviewer asks "why no FK?", the answer lives in the design spec under the section about CreativeJob's existing relations. It is NOT an oversight.

3. **Tier columns on `PcdIdentitySnapshot` are plain `INTEGER`, no DB CHECK constraint.** Zod validates `1|2|3` at the store boundary, but a direct DB write of e.g. `5` would slip past Prisma. SP2 may want to add a CHECK (`tier IN (1,2,3)`) as a small defensive migration, OR defer until later — no immediate harm because all writes go through the store layer.

4. **`PrismaPcdIdentitySnapshotStore.create` passes `data: input` directly.** SP2 doesn't use this store yet (SP4 does). If SP4 adds derived/computed fields to the input shape, the unfiltered passthrough will silently send unknown columns to Prisma. Worth refactoring to explicit field mapping when SP4 lands; not an SP2 concern.

5. **The backfill Inngest function is registered but never auto-runs.** It's event-triggered (`pcd/registry.backfill.requested`), not cron-scheduled. SP2 doesn't need to invoke it. If you ever want to trigger backfill against real legacy data, you'll need to fire that event manually.

6. **The repo's two `Inngest({ id: "switchboard" })` instantiations.** This came up in the SP1 code review as a concern but was scored as a false positive — every cron file in the repo (`lead-retry`, `meta-token-refresh`, `reconciliation`, `pcd-registry-backfill`) does this; it's the established pattern, and `inngestFastify` registers by function ID, not client identity. SP2 doesn't add another cron, so this won't surface again.

## SP2 design questions worth surfacing in brainstorming

(None of these need to be answered before SP2 starts, but they're worth flagging to the user up front.)

1. **Should `PcdTierPolicy` know about the `identityAdapter` slot on `CreatorIdentity`?** v1 answer: no — adapter presence doesn't change *whether* a generation is allowed, only *how* the router runs it (SP4). v2 if behaviour changes: re-evaluate.
2. **Should the policy take `outputIntent = "draft" | "preview" | "final_export" | "meta_draft"` or fewer states?** Spec lists 4. Keep all 4.
3. **Where does the policy version string live (`policyVersion: "tier-policy@1.0.0"` referenced in `PcdIdentitySnapshot`)?** SP2 should export it from `tier-policy.ts` as a const so the snapshot writer in SP4 can pin it.
4. **Should the test file use a parameterised test runner over the matrix (e.g. `it.each`), or write each assertion individually?** The spec says "exhaustive" — `it.each` is the obvious fit.

## How a future Claude session should start SP2

1. Read this handoff note in full.
2. Run the pre-SP2 kickoff checklist above.
3. Re-read the spec's "Tier gating rules" + "Tier policy test matrix" sections.
4. Brainstorm the four design questions above with the user; capture answers.
5. Write the SP2 plan to `~/secondbrain/05_OUTPUTS/Plans/2026-04-28-pcd-tier-policy-sp2-plan.md` (or whatever date matches when you start).
6. Hand off to `superpowers:subagent-driven-development` for execution.

## What is NOT SP2

- Provider routing changes → SP4
- QC gate logic → SP5
- Approval / Meta draft / consent revocation → SP6
- Identity adapter training (Path 1) → v2 of this whole effort
- UI changes → none of SP2–SP6, separate stream

If the user asks for any of these, gently push back to scope — SP2 is a single pure function and a test matrix.
