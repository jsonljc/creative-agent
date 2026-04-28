# CreativeAgent

PCD (Product/Creator Definition) Identity Registry — extracted from [Switchboard](https://github.com/jsonljc/switchboard) SP1 to be built standalone, then merged back.

## Quickstart

```bash
pnpm install
cp .env.example .env       # edit DATABASE_URL
pnpm db:generate
pnpm db:migrate
pnpm test
```

## Layout

| Package | Purpose |
|---|---|
| `@creativeagent/schemas` | Zod schemas (PCD identity, creator identity, creative job) |
| `@creativeagent/db` | Prisma schema + 5 PCD stores + SP1 migrations |
| `@creativeagent/creative-pipeline` | Backfill (SP1) + tier policy (SP2) + future SP3–SP6 |

## Origin

Forked from Switchboard commit `05bc4655` (PR #283 — "feat(pcd-registry): SP1 — identity registry data foundation"). Will merge back once SP2–SP6 ship.

See `CLAUDE.md` and `docs/SWITCHBOARD-CONTEXT.md` for architectural rules and the merge-back contract.
