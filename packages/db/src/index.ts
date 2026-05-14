import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export { PrismaClient };
export type { Prisma } from "@prisma/client";
export type { PrismaDbClient } from "./prisma-db.js";
export { isRootPrismaClient } from "./prisma-db.js";

export { PrismaProductIdentityStore } from "./stores/prisma-product-identity-store.js";
export type {
  CreateProductIdentityInput,
  AddProductImageInput,
} from "./stores/prisma-product-identity-store.js";
export { PrismaConsentRecordStore } from "./stores/prisma-consent-record-store.js";
export type { CreateConsentRecordInput } from "./stores/prisma-consent-record-store.js";
export { PrismaPcdIdentitySnapshotStore } from "./stores/prisma-pcd-identity-snapshot-store.js";
export type { CreatePcdIdentitySnapshotInput } from "./stores/prisma-pcd-identity-snapshot-store.js";
export { PrismaCreatorIdentityStore } from "./stores/prisma-creator-identity-store.js";
export { PrismaCreativeJobStore } from "./stores/prisma-creative-job-store.js";

// SP6: lifecycle store + reader adapters
export { PrismaConsentRevocationStore } from "./stores/prisma-consent-revocation-store.js";
export { PrismaAssetRecordReader } from "./stores/prisma-asset-record-reader.js";
export { PrismaProductQcResultReader } from "./stores/prisma-product-qc-result-reader.js";
export { PrismaPcdIdentitySnapshotReader } from "./stores/prisma-pcd-identity-snapshot-reader.js";
export { PrismaConsentRecordReader } from "./stores/prisma-consent-record-reader.js";
export { PrismaCreativeJobReader } from "./stores/prisma-creative-job-reader.js";
export { PrismaCreatorIdentityReader } from "./stores/prisma-creator-identity-reader.js";

// SP11 — synthetic creator foundation
export { PrismaCreatorIdentitySyntheticStore } from "./stores/prisma-creator-identity-synthetic-store.js";
export { PrismaCreatorIdentitySyntheticReader } from "./stores/prisma-creator-identity-synthetic-reader.js";

// SP12 — synthetic creator license + leasing
export {
  PrismaCreatorIdentityLicenseStore,
  withDefaultLeaseWindow,
  type LicenseInputWithOptionalWindow,
} from "./stores/prisma-creator-identity-license-store.js";
export { PrismaCreatorIdentityLicenseReader } from "./stores/prisma-creator-identity-license-reader.js";
