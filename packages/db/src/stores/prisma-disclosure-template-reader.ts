// PCD slice SP14 — read surface for DisclosureTemplate.
//
// MERGE-BACK: Reader-only by design. Writer interface deliberately deferred.
// Future legal-authoring CLI/admin tool should ship explicit
// createTemplateVersion(payload) and supersedeTemplateVersion(id, supersededAt)
// operations — NOT a generic upsert. Generic upsert is the wrong semantics
// for regulated copy: it normalises overwriting legal-approved rows.
//
// The pure resolver (packages/creative-pipeline/src/pcd/disclosure/
// disclosure-resolver.ts) consumes the snapshot this reader returns;
// the resolver itself performs no I/O.
import type { PrismaClient } from "@prisma/client";
import {
  DisclosureTemplatePayloadSchema,
  type DisclosureTemplatePayload,
  type JurisdictionCode,
  type Platform,
  type TreatmentClass,
} from "@creativeagent/schemas";

export class PrismaDisclosureTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listByTuple(input: {
    jurisdictionCode: JurisdictionCode;
    platform: Platform;
    treatmentClass: TreatmentClass;
  }): Promise<readonly DisclosureTemplatePayload[]> {
    const rows = await this.prisma.disclosureTemplate.findMany({
      where: {
        jurisdictionCode: input.jurisdictionCode,
        platform: input.platform,
        treatmentClass: input.treatmentClass,
      },
    });
    return rows.map((r) => this.parse(r));
  }

  private parse(row: {
    id: string;
    jurisdictionCode: string;
    platform: string;
    treatmentClass: string;
    version: number;
    text: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }): DisclosureTemplatePayload {
    return DisclosureTemplatePayloadSchema.parse({
      id: row.id,
      jurisdictionCode: row.jurisdictionCode,
      platform: row.platform,
      treatmentClass: row.treatmentClass,
      version: row.version,
      text: row.text,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    });
  }
}
