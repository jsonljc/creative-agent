# SP21 Task 1 — CreatorIdentityLicense Schema Verification

**Date:** 2026-05-16
**Task:** Verify Prisma columns for the new `findActiveByClinicAndScope` method before implementation (Task 2).

---

## 1. Quoted Excerpt: `model CreatorIdentityLicense`

From `packages/db/prisma/schema.prisma` lines 166–192:

```prisma
model CreatorIdentityLicense {
  id                  String          @id @default(cuid())
  creatorIdentityId   String
  creatorIdentity     CreatorIdentity @relation(fields: [creatorIdentityId], references: [id], onDelete: Cascade)

  clinicId            String

  market              String
  treatmentClass      String

  lockType            String
  exclusivityScope    String          @default("market_treatment")

  effectiveFrom       DateTime
  effectiveTo         DateTime?

  priorityRank        Int?

  status              String          @default("active")

  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  @@index([creatorIdentityId, status])
  @@index([clinicId, market, treatmentClass])
  @@index([effectiveTo])
}
```

---

## 2. Confirmation Table: Required Columns for `findActiveByClinicAndScope`

| Column              | Prisma Type  | Nullability                           | Purpose in Query                                                 |
| ------------------- | ------------ | ------------------------------------- | ---------------------------------------------------------------- |
| `id`                | `String @id` | Required                              | Record primary key (included for completeness)                   |
| `creatorIdentityId` | `String`     | Required                              | Via relation; differentiation from `findActiveByCreatorAndScope` |
| `clinicId`          | `String`     | Required                              | **GROUP COLUMN** — filters leases by clinic                      |
| `market`            | `String`     | Required                              | **FILTER COLUMN** — clinic scope                                 |
| `treatmentClass`    | `String`     | Required                              | **FILTER COLUMN** — clinic scope                                 |
| `lockType`          | `String`     | Required                              | Present for completeness; not used in active-window query        |
| `exclusivityScope`  | `String`     | Required (default "market_treatment") | Present for completeness; not used in active-window query        |
| `effectiveFrom`     | `DateTime`   | Required                              | **ACTIVE-WINDOW FILTER** — `lte: now`                            |
| `effectiveTo`       | `DateTime?`  | Nullable                              | **ACTIVE-WINDOW FILTER** — null OR `gt: now`                     |
| `priorityRank`      | `Int?`       | Nullable                              | Present for completeness; not used in active-window query        |
| `status`            | `String`     | Required (default "active")           | **ACTIVE-WINDOW FILTER** — equality "active"                     |

**Finding:** All 11 columns exist with the expected types and nullability. No discrepancies.

---

## 3. Canonical Active-Window Predicate

**Source:** `packages/db/src/stores/prisma-creator-identity-license-reader.ts`, method `findActiveByCreatorAndScope` (lines 29–46).

The existing method's predicate is:

```ts
status: "active",
effectiveFrom: { lte: now },
OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
```

**Verification:** This predicate is the canonical one for active-window filtering in the PCD license registry. It is used by the pure license-gate module (SP12) and will be reused identically in the new `findActiveByClinicAndScope` method.

---

## 4. New Method's Prisma `where` Clause (Task 2 Contract)

The new method `findActiveByClinicAndScope({ clinicId, market, treatmentClass, now })` will use this query contract:

```ts
where: {
  clinicId,
  market,
  treatmentClass,
  status: "active",
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
}
```

**Divergence from existing method:** Only the grouping column changes:

- `findActiveByCreatorAndScope`: groups on `creatorIdentityId`
- `findActiveByClinicAndScope`: groups on `clinicId` (new)

All other filter logic remains identical, ensuring consistency across the registry's query surface.

---

## Summary

- All schema columns verified.
- Active-window predicate confirmed as canonical.
- Query contract locked for Task 2 implementation.
