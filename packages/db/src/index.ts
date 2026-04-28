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
