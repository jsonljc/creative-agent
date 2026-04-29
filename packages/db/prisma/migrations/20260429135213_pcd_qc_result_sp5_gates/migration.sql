-- SP5: add forensic gate-result columns to ProductQcResult.
-- Columns are nullable for historical compatibility (pre-SP5 / merge-back-time
-- Switchboard rows that predate this slice). SP5 evaluator treats them as
-- mandatory for any newly written QC ledger row. A future cleanup migration
-- may flip to NOT NULL once legacy rows are backfilled or archived.
--
-- gatesRan uses TEXT[] NOT NULL DEFAULT '{}' because Postgres array columns
-- can't be NULL the same way scalars are. Empty-array is the historical
-- equivalent of NULL for this column.

ALTER TABLE "ProductQcResult"
  ADD COLUMN "creatorIdentityId"        TEXT,
  ADD COLUMN "pcdIdentitySnapshotId"    TEXT,
  ADD COLUMN "faceSimilarityScore"      DOUBLE PRECISION,
  ADD COLUMN "gatesRan"                 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "gateVerdicts"             JSONB,
  ADD COLUMN "qcEvaluationVersion"      TEXT,
  ADD COLUMN "qcGateMatrixVersion"      TEXT;
