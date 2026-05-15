-- SP18 — Synthetic-routing provenance on PcdIdentitySnapshot.
-- All columns nullable for historical compatibility (pre-SP18 rows return NULL).
-- No FK, no index in v1 — see SP18 design §2.2 Q7.
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "imageProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProvider" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "videoProviderChoice" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRouterVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticPairingVersion" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "promptHash" TEXT;
ALTER TABLE "PcdIdentitySnapshot" ADD COLUMN "syntheticRoutingDecisionReason" JSONB;
