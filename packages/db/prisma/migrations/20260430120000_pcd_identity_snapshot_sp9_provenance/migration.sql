-- SP9 — Creative-source provenance lineage on PcdIdentitySnapshot.
-- All six new columns nullable for historical compatibility (pre-SP9 rows
-- remain readable forever). No backfill, no FK constraints. Indexes on
-- briefId and scriptId only — leaf-to-root anchor queries operators run.
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "briefId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "trendId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "motivatorId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "hookId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "scriptId" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "lineageDecisionReason" JSONB;

CREATE INDEX "PcdIdentitySnapshot_briefId_idx" ON "PcdIdentitySnapshot"("briefId");
CREATE INDEX "PcdIdentitySnapshot_scriptId_idx" ON "PcdIdentitySnapshot"("scriptId");
