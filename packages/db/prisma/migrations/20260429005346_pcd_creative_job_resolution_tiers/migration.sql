-- SP4 amendment: add stamped component-tier columns to CreativeJob.
-- Columns are nullable for historical compatibility (pre-SP4 rows that
-- predate this slice). SP4-and-later resolutions always populate both
-- fields. Backfill stamps both as 1 (Tier 1) per SP1 conservative
-- compatibility default — backfilled jobs have no component-tier evidence.
-- A future cleanup migration may flip to NOT NULL once legacy rows are
-- backfilled or archived.

ALTER TABLE "CreativeJob"
  ADD COLUMN "productTierAtResolution"  INTEGER,
  ADD COLUMN "creatorTierAtResolution"  INTEGER;
