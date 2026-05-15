-- PCD slice SP17 — additive, nullable JSON column for the per-creator
-- Seedance direction artifact. Pre-SP17 rows return NULL on read. No FK,
-- no index. Domain code (router + DB store) normalizes undefined → null
-- at write time so the column only ever stores NULL or a structured
-- {setting, motion, energy, lighting, avoid[]} object.
ALTER TABLE "CreatorIdentitySynthetic" ADD COLUMN "seedanceDirection" JSONB;
