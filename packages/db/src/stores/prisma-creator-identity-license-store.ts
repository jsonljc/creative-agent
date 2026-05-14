// PCD slice SP12 — write surface for CreatorIdentityLicense.
// Validates input via the SP12 zod schema before any DB write.
// Upsert semantics on (id) — caller controls the lease id (cuid generated
// elsewhere, e.g. from an admin UI or a fixtures runner).
//
// `withDefaultLeaseWindow` is the convenience helper for callers that
// don't supply effectiveTo: it applies the v1 30-day default per design
// spec §3.3 / §12 open question #7. Explicit `effectiveTo: null`
// (indefinite lease) is preserved.
//
// MERGE-BACK: clinicId is a plain String here. Switchboard's Clinic model
// will replace it with a true FK at merge-back.
import type { PrismaDbClient } from "../prisma-db.js";
import {
  CreatorIdentityLicensePayloadSchema,
  LeaseStatusSchema,
  type CreatorIdentityLicensePayload,
  type LeaseStatus,
} from "@creativeagent/schemas";

const DEFAULT_LEASE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type LicenseInputWithOptionalWindow = Omit<CreatorIdentityLicensePayload, "effectiveTo"> & {
  effectiveTo?: Date | null;
};

export function withDefaultLeaseWindow(
  input: LicenseInputWithOptionalWindow,
): CreatorIdentityLicensePayload {
  const effectiveTo =
    input.effectiveTo === undefined
      ? new Date(input.effectiveFrom.getTime() + DEFAULT_LEASE_WINDOW_MS)
      : input.effectiveTo;
  return { ...input, effectiveTo };
}

export class PrismaCreatorIdentityLicenseStore {
  constructor(private readonly prisma: PrismaDbClient) {}

  async create(input: CreatorIdentityLicensePayload): Promise<void> {
    const payload = CreatorIdentityLicensePayloadSchema.parse(input);

    const data = {
      creatorIdentityId: payload.creatorIdentityId,
      clinicId: payload.clinicId,
      market: payload.market,
      treatmentClass: payload.treatmentClass,
      lockType: payload.lockType,
      exclusivityScope: payload.exclusivityScope,
      effectiveFrom: payload.effectiveFrom,
      effectiveTo: payload.effectiveTo,
      priorityRank: payload.priorityRank,
      status: payload.status,
    };

    await this.prisma.creatorIdentityLicense.upsert({
      where: { id: payload.id },
      create: { id: payload.id, ...data },
      update: data,
    });
  }

  async updateStatus(id: string, status: LeaseStatus): Promise<void> {
    const parsedStatus = LeaseStatusSchema.parse(status);
    await this.prisma.creatorIdentityLicense.update({
      where: { id },
      data: { status: parsedStatus },
    });
  }
}
