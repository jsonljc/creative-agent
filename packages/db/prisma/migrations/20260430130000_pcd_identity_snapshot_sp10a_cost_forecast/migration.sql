-- SP10A — per-asset cost forecast forensic record. Additive nullable column;
-- pre-SP10A rows remain readable. No index — range queries use JSON operators
-- on the Json column. See docs/plans/2026-04-30-pcd-cost-forecast-sp10a-design.md.

ALTER TABLE "PcdIdentitySnapshot"
ADD COLUMN "costForecastReason" JSONB;
