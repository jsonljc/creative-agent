// PCD slice SP12 — read surface for CreatorIdentityLicense.
// Pure read methods. The active-window query here is what the SP12 license
// gate caller uses to seed the gate's snapshot input — the gate itself
// performs no I/O (see packages/creative-pipeline/src/pcd/synthetic-creator/
// license-gate.ts).
import type { PrismaClient } from "@prisma/client";
import {
  CreatorIdentityLicensePayloadSchema,
  type CreatorIdentityLicensePayload,
  type Market,
  type TreatmentClass,
} from "@creativeagent/schemas";

export class PrismaCreatorIdentityLicenseReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CreatorIdentityLicensePayload | null> {
    const row = await this.prisma.creatorIdentityLicense.findUnique({ where: { id } });
    if (!row) return null;
    return this.parse(row);
  }

  /**
   * Returns all leases on (creatorIdentityId, market, treatmentClass) that are
   * currently active: status='active' AND effectiveFrom <= now AND
   * (effectiveTo is null OR effectiveTo > now). The result is the snapshot the
   * pure license-gate consumes — caller passes it in via gate input.
   */
  async findActiveByCreatorAndScope(
    creatorIdentityId: string,
    market: Market,
    treatmentClass: TreatmentClass,
    now: Date,
  ): Promise<CreatorIdentityLicensePayload[]> {
    const rows = await this.prisma.creatorIdentityLicense.findMany({
      where: {
        creatorIdentityId,
        market,
        treatmentClass,
        status: "active",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
    });
    return rows.map((r) => this.parse(r));
  }

  /**
   * Returns ALL leases on (creatorIdentityId, market, treatmentClass) regardless
   * of status or window. Used for diagnostics, admin audit, and lifecycle
   * operations (e.g. expiring stale rows). Not consumed by the gate.
   */
  async findAllByCreatorAndScope(
    creatorIdentityId: string,
    market: Market,
    treatmentClass: TreatmentClass,
  ): Promise<CreatorIdentityLicensePayload[]> {
    const rows = await this.prisma.creatorIdentityLicense.findMany({
      where: { creatorIdentityId, market, treatmentClass },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    });
    return rows.map((r) => this.parse(r));
  }

  private parse(row: {
    id: string;
    creatorIdentityId: string;
    clinicId: string;
    market: string;
    treatmentClass: string;
    lockType: string;
    exclusivityScope: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    priorityRank: number | null;
    status: string;
  }): CreatorIdentityLicensePayload {
    return CreatorIdentityLicensePayloadSchema.parse({
      id: row.id,
      creatorIdentityId: row.creatorIdentityId,
      clinicId: row.clinicId,
      market: row.market,
      treatmentClass: row.treatmentClass,
      lockType: row.lockType,
      exclusivityScope: row.exclusivityScope,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      priorityRank: row.priorityRank,
      status: row.status,
    });
  }
}
