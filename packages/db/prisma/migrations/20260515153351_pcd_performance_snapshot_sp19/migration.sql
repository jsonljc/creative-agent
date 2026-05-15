-- SP19: PcdPerformanceSnapshot — post-completion observability per AssetRecord attempt.
-- Net-new table. Additive. onDelete RESTRICT (not CASCADE) — historical performance
-- survives accidental asset-record deletion. Test cleanup MUST delete
-- PcdPerformanceSnapshot rows BEFORE their referenced AssetRecord rows.
-- No @@index lines in v1 (assetRecordId @unique already provides the lookup index).

CREATE TABLE "PcdPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "assetRecordId" TEXT NOT NULL,
    "terminalKind" TEXT NOT NULL,
    "errorCategory" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "actualCostUsd" DOUBLE PRECISION,
    "currency" TEXT,
    "costActualReason" JSONB NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerCalled" TEXT NOT NULL,
    "performanceSnapshotVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PcdPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PcdPerformanceSnapshot_assetRecordId_key" ON "PcdPerformanceSnapshot"("assetRecordId");

ALTER TABLE "PcdPerformanceSnapshot"
    ADD CONSTRAINT "PcdPerformanceSnapshot_assetRecordId_fkey"
    FOREIGN KEY ("assetRecordId") REFERENCES "AssetRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
