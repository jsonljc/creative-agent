-- SP14 — Disclosure template registry.
-- Append-only catalogue of regulated disclosure copy keyed by
-- (jurisdictionCode, platform, treatmentClass, version). Per-tuple
-- monotonic version; supersession is implicit via effectiveTo.
-- Enum-typed columns stored as TEXT (zod owns enum value-sets; same
-- convention as SP11 + SP12). No FK constraints. No drops, no renames,
-- no backfills.

-- CreateTable
CREATE TABLE "DisclosureTemplate" (
    "id"                TEXT NOT NULL,
    "jurisdictionCode"  TEXT NOT NULL,
    "platform"          TEXT NOT NULL,
    "treatmentClass"    TEXT NOT NULL,
    "version"           INTEGER NOT NULL,
    "text"              TEXT NOT NULL,
    "effectiveFrom"     TIMESTAMP(3) NOT NULL,
    "effectiveTo"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisclosureTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisclosureTemplate_jurisdictionCode_platform_treatmentClass_idx" ON "DisclosureTemplate"("jurisdictionCode", "platform", "treatmentClass", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "DisclosureTemplate_jurisdictionCode_platform_treatmentClass_key" ON "DisclosureTemplate"("jurisdictionCode", "platform", "treatmentClass", "version");
