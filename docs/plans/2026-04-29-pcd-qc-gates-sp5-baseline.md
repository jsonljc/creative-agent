# SP5 Verification Baseline

**Captured:** 2026-04-29 at Task 0 (pre-flight) on `feat/pcd-sp5-qc-gates` (parent: `origin/main` = `05ffa25`).

## Bar SP5 verifies against

| Check | Status | Notes |
|---|---|---|
| `pnpm typecheck` | ✅ green across all 5 packages | Pre-SP5 baseline. |
| `pnpm test` | ✅ 1,024 passing (941 creative-pipeline + 47 db + 36 schemas) | Pre-SP5 baseline. |
| `pnpm lint` | ⚠️ structurally broken on origin/main | ESLint is not installed in any `package.json` — the npm `lint` scripts call a binary that does not exist. Pre-existing `origin/main` tooling gap. Out of SP5 scope. |
| `pnpm exec prettier --check "packages/**/*.ts"` | ⚠️ 2 pre-existing warnings | Both on SP2-era files: `packages/creative-pipeline/src/pcd/tier-policy.ts` and `packages/creative-pipeline/src/pcd/tier-policy.test.ts`. **Confirmed NOT in SP5 diff** (`git diff --name-only origin/main...HEAD` returns only the two SP5 doc files at Task 0). |

## SP5 style invariant (what SP5 itself must hold)

- All new and modified `.ts` files SP5 introduces MUST pass `pnpm exec prettier --check` against their paths.
- The two pre-existing SP2 prettier warnings are **explicitly out of scope** for SP5 — they remain as baseline noise on `origin/main` and SP5 will not edit them.
- SP5 introduces no typecheck regression and no test regression.
- ESLint installation is **not** an SP5 deliverable. Repo-wide lint bootstrap is its own slice if/when it ships.

## Verification command for SP5-only Prettier scope

```bash
git diff --name-only origin/main...HEAD | grep -E "\.ts$" \
  | xargs --no-run-if-empty pnpm exec prettier --check
```

Empty input (no `.ts` files changed yet) → trivially pass. Once SP5 starts adding `.ts` files (Task 1+), this command verifies SP5's new files are prettier-clean without being polluted by the two SP2 warnings.

## Sources

- Decision: user response to Task 0 baseline reconciliation, 2026-04-29.
- Precedent: SP4 slice-progress memory entry — "Prettier clean on all amended files" was SP4's practical style gate.
- Repo state at capture: `origin/main` = `05ffa25 feat(pcd): SP4 — provider router + capability matrix + identity snapshot writer (#3)`.
