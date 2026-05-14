-- SP12 — Synthetic creator license / leasing table.
-- Adds the CreatorIdentityLicense table for per-clinic lease records.
-- FK references CreatorIdentity(id) with ON DELETE CASCADE (if the
-- CreatorIdentity is deleted, all its license rows go with it).
-- status, lockType, exclusivityScope, market, treatmentClass are stored
-- as TEXT — zod owns enum value-sets (same convention as SP11).
--
-- No drops, no renames, no enum creation, no data backfills. Purely additive.

-- CreateTable
CREATE TABLE "CreatorIdentityLicense" (
    "id"                TEXT NOT NULL,
    "creatorIdentityId" TEXT NOT NULL,
    "clinicId"          TEXT NOT NULL,
    "market"            TEXT NOT NULL,
    "treatmentClass"    TEXT NOT NULL,
    "lockType"          TEXT NOT NULL,
    "exclusivityScope"  TEXT NOT NULL DEFAULT 'market_treatment',
    "effectiveFrom"     TIMESTAMP(3) NOT NULL,
    "effectiveTo"       TIMESTAMP(3),
    "priorityRank"      INTEGER,
    "status"            TEXT NOT NULL DEFAULT 'active',
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorIdentityLicense_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CreatorIdentityLicense" ADD CONSTRAINT "CreatorIdentityLicense_creatorIdentityId_fkey" FOREIGN KEY ("creatorIdentityId") REFERENCES "CreatorIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CreatorIdentityLicense_creatorIdentityId_status_idx" ON "CreatorIdentityLicense"("creatorIdentityId", "status");

-- CreateIndex
CREATE INDEX "CreatorIdentityLicense_clinicId_market_treatmentClass_idx" ON "CreatorIdentityLicense"("clinicId", "market", "treatmentClass");

-- CreateIndex
CREATE INDEX "CreatorIdentityLicense_effectiveTo_idx" ON "CreatorIdentityLicense"("effectiveTo");
