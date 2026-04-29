-- SP6: add consentRevokedAfterGeneration flag to AssetRecord.
-- Non-null Boolean with default false. Historical rows are well-defined
-- without backfill. propagateConsentRevocation (creative-pipeline SP6) is
-- the only writer at runtime. // MERGE-BACK: Switchboard's AssetRecord may
-- already have this column or a same-semantic one; reconcile naming there.

ALTER TABLE "AssetRecord" ADD COLUMN "consentRevokedAfterGeneration" BOOLEAN NOT NULL DEFAULT false;
