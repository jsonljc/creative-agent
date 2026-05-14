-- CreateTable
CREATE TABLE "ScriptTemplate" (
    "id" TEXT NOT NULL,
    "vibe" TEXT NOT NULL,
    "treatmentClass" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "compatibleCreatorIdentityIds" TEXT[],
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptTemplate_vibe_treatmentClass_status_idx" ON "ScriptTemplate"("vibe", "treatmentClass", "status");

