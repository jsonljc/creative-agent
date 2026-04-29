/**
 * Six narrow read-only store reader interfaces consumed by SP6 lifecycle
 * gates. Each returns only the fields the gates require — no full row shape,
 * no PII echoes. Concrete Prisma adapters live in packages/db/src/stores/.
 *
 * SP6 gates assemble store bundles from these interfaces (e.g. the
 * final-export gate takes a 5-field store bundle: AssetRecordReader,
 * ProductQcResultReader, PcdIdentitySnapshotReader, ConsentRecordReader,
 * CreativeJobReader, ExportGateState).
 */

export interface AssetRecordReader {
  findById(assetRecordId: string): Promise<{
    id: string;
    jobId: string;
    creatorId: string | null;
    approvalState: string;
  } | null>;
}

export interface ProductQcResultReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    passFail: "pass" | "fail" | "warn";
  } | null>;
}

export interface PcdIdentitySnapshotReader {
  findByAssetRecordId(assetRecordId: string): Promise<{
    assetRecordId: string;
    creatorIdentityId: string;
    consentRecordId: string | null;
  } | null>;
}

export interface ConsentRecordReader {
  findById(consentRecordId: string): Promise<{
    id: string;
    revoked: boolean;
    revokedAt: Date | null;
  } | null>;
}

export interface CreativeJobReader {
  findById(jobId: string): Promise<{
    id: string;
    effectiveTier: number | null;
  } | null>;
}

export interface CreatorIdentityReader {
  findById(creatorIdentityId: string): Promise<{
    id: string;
    consentRecordId: string | null;
  } | null>;
}
