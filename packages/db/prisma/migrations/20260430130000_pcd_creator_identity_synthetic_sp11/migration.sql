-- SP11 — Synthetic creator roster support.
-- Adds the CreatorIdentityKind discriminator enum and the CreatorIdentitySynthetic
-- extension table. The kind column defaults to "real" so ALL existing rows are
-- valid without a backfill. Synthetic rows pair one-to-one with the new table via
-- a FK with ON DELETE CASCADE (if the CreatorIdentity is deleted, the profile goes
-- with it).
--
-- No drops, no renames, no data backfills. Purely additive.

-- CreateEnum
CREATE TYPE "CreatorIdentityKind" AS ENUM ('real', 'synthetic');

-- AlterTable: add kind discriminator to CreatorIdentity
ALTER TABLE "CreatorIdentity" ADD COLUMN "kind" "CreatorIdentityKind" NOT NULL DEFAULT 'real';

-- CreateTable
CREATE TABLE "CreatorIdentitySynthetic" (
    "creatorIdentityId"        TEXT NOT NULL,
    "treatmentClass"           TEXT NOT NULL,
    "vibe"                     TEXT NOT NULL,
    "market"                   TEXT NOT NULL,
    "ethnicityFamily"          TEXT NOT NULL,
    "ageBand"                  TEXT NOT NULL,
    "pricePositioning"         TEXT NOT NULL,
    "physicalDescriptors"      JSONB NOT NULL,
    "dallePromptLocked"        TEXT NOT NULL,
    "klingDirection"           JSONB NOT NULL,
    "voiceCaptionStyle"        JSONB NOT NULL,
    "mutuallyExclusiveWithIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status"                   TEXT NOT NULL DEFAULT 'active',
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorIdentitySynthetic_pkey" PRIMARY KEY ("creatorIdentityId")
);

-- AddForeignKey
ALTER TABLE "CreatorIdentitySynthetic" ADD CONSTRAINT "CreatorIdentitySynthetic_creatorIdentityId_fkey"
    FOREIGN KEY ("creatorIdentityId") REFERENCES "CreatorIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CreatorIdentitySynthetic_treatmentClass_market_idx" ON "CreatorIdentitySynthetic"("treatmentClass", "market");

-- CreateIndex
CREATE INDEX "CreatorIdentitySynthetic_vibe_idx" ON "CreatorIdentitySynthetic"("vibe");

-- CreateIndex
CREATE INDEX "CreatorIdentitySynthetic_status_idx" ON "CreatorIdentitySynthetic"("status");
