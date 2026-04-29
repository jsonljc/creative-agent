-- SP4: add forensic version-pinning columns to PcdIdentitySnapshot.
-- Columns are nullable for historical compatibility (pre-SP4 / merge-back-time
-- Switchboard rows that predate this slice). SP4 writer treats them as
-- mandatory for any newly written snapshot. A future cleanup migration may
-- flip to NOT NULL once legacy rows are backfilled or archived.

ALTER TABLE "PcdIdentitySnapshot"
  ADD COLUMN "shotSpecVersion"        TEXT,
  ADD COLUMN "routerVersion"          TEXT,
  ADD COLUMN "routingDecisionReason"  JSONB;
