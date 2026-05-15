# SP20 Task 1 — Prisma Join Path Verification

**Date:** 2026-05-16
**Goal:** Lock the join path from `PcdPerformanceSnapshot` to `creatorIdentityId` before any
SQL is written for Task 6 (metrics reader).

---

## 1. Relevant Prisma model excerpts

### `AssetRecord` (schema.prisma:194–237)

```prisma
model AssetRecord {
  id          String            @id @default(cuid())
  jobId       String
  creatorId   String?                                      // nullable FK → CreatorIdentity
  creator     CreatorIdentity?  @relation(fields: [creatorId], references: [id])

  identitySnapshot    PcdIdentitySnapshot?
  performanceSnapshot PcdPerformanceSnapshot?
  // ...
}
```

Key facts:
- `creatorId` is `String?` (nullable). There is **no `creatorIdentityId` column** on `AssetRecord`.
- `identitySnapshot` is the back-relation to `PcdIdentitySnapshot` (1:0..1).
- `performanceSnapshot` is the back-relation to `PcdPerformanceSnapshot` (1:0..1).

### `PcdIdentitySnapshot` (schema.prisma:338–406)

```prisma
model PcdIdentitySnapshot {
  id                String      @id @default(cuid())
  assetRecordId     String      @unique
  assetRecord       AssetRecord @relation(fields: [assetRecordId], references: [id], onDelete: Cascade)

  creatorIdentityId String                               // non-null, required
  creatorIdentity   CreatorIdentity @relation(fields: [creatorIdentityId], references: [id])
  // ...
}
```

Key facts:
- `assetRecordId` is `@unique` — strict 1:1 with `AssetRecord`.
- `creatorIdentityId` is `String` (non-null, required).

### `PcdPerformanceSnapshot` (schema.prisma:419–440)

```prisma
model PcdPerformanceSnapshot {
  id            String      @id @default(cuid())
  assetRecordId String      @unique
  assetRecord   AssetRecord @relation(fields: [assetRecordId], references: [id], onDelete: Restrict)

  terminalKind  String      // "success" | "failure" | "manual_skip"
  latencyMs     Int
  actualCostUsd Float?
  attemptNumber Int
  providerCalled String
  // ...
}
```

Key facts:
- `assetRecordId` is `@unique` — strict 1:1 with `AssetRecord`.
- No `creatorIdentityId` column; must join through `AssetRecord → PcdIdentitySnapshot`.

---

## 2. Path analysis

### Path A (rejected)

Design §4.7 described Path A as:
`PcdPerformanceSnapshot → AssetRecord.creatorIdentityId` (one join).

**Path A is not viable.** `AssetRecord` does not have a `creatorIdentityId` column.
The column referenced in plan note `schema.prisma:325` is on `ProductQcResult`, not `AssetRecord`.
`AssetRecord` has `creatorId String?` (nullable FK to `CreatorIdentity`), which is not reliably
populated and does not carry the canonical PCD `creatorIdentityId` semantics used by SP13/SP18.

### Path B (chosen)

`PcdPerformanceSnapshot → AssetRecord → PcdIdentitySnapshot → creatorIdentityId`

**Path B is safe.** Both join keys are `@unique` and non-null on the snapshot side:
- `PcdPerformanceSnapshot.assetRecordId` → `AssetRecord.id` (unique, required)
- `PcdIdentitySnapshot.assetRecordId` → `AssetRecord.id` (unique, required)
- `PcdIdentitySnapshot.creatorIdentityId` → non-null String

The only gap is that a `PcdPerformanceSnapshot` row can exist for an `AssetRecord` that has no
companion `PcdIdentitySnapshot` (e.g. a pre-SP1 or non-PCD asset). The metrics reader must
`INNER JOIN` (not `LEFT JOIN`) on `PcdIdentitySnapshot` to exclude those rows — this is
intentional: we only re-rank synthetic-creator candidates that have a full PCD identity record.

---

## 3. Chosen path

**Path B** — two joins through `AssetRecord` and `PcdIdentitySnapshot`.

Justification: `AssetRecord` carries no `creatorIdentityId` column; the authoritative
`creatorIdentityId` lives on `PcdIdentitySnapshot`, which joins to `AssetRecord` via the
`@unique` `assetRecordId` key.

---

## 4. Exact SQL JOIN fragment

```sql
-- Resolve creatorIdentityId for a set of PcdPerformanceSnapshot rows
FROM "PcdPerformanceSnapshot" pps
INNER JOIN "AssetRecord"         ar  ON ar.id            = pps."assetRecordId"
INNER JOIN "PcdIdentitySnapshot" pis ON pis."assetRecordId" = ar.id
-- pis."creatorIdentityId" is now available for GROUP BY / aggregation
```

Both joins are on `@unique` indexed keys, so the two-hop cost is negligible.

---

## 5. Impact on Task 6

The metrics-reader Prisma query (Task 6) must use:

```typescript
// Prisma equivalent of the two-join path
prisma.pcdPerformanceSnapshot.findMany({
  where: { /* filtered by assetRecordId list or terminalKind */ },
  include: {
    assetRecord: {
      include: { identitySnapshot: { select: { creatorIdentityId: true } } },
    },
  },
});
```

Or a `groupBy` raw query using the SQL fragment above if Prisma's `groupBy` API is
insufficient for the aggregation shape needed by SP20.
