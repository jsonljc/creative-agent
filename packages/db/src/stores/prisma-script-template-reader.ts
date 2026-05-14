// PCD slice SP15 — reader-only by design. Writer interface deliberately
// deferred. Future authoring CLI/admin tool should ship explicit
// createScriptVersion(payload) and retireScript(id) operations — NOT
// a generic upsert. Generic upsert is the wrong semantics for vetted
// creative copy: it normalises overwriting reviewed rows.
//
// Returns ALL rows for (vibe, treatmentClass) — any status, any compat
// list. Pure selector owns the full filter chain (status='active' +
// compatibleCreatorIdentityIds CONTAINS creatorIdentityId).
import type { PrismaClient } from "@prisma/client";
import {
  type ScriptTemplatePayload,
  ScriptTemplatePayloadSchema,
  type TreatmentClass,
  type Vibe,
} from "@creativeagent/schemas";

export interface ScriptTemplateReader {
  listByVibeAndTreatment(input: {
    vibe: Vibe;
    treatmentClass: TreatmentClass;
  }): Promise<readonly ScriptTemplatePayload[]>;
}

export class PrismaScriptTemplateReader implements ScriptTemplateReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listByVibeAndTreatment(input: {
    vibe: Vibe;
    treatmentClass: TreatmentClass;
  }): Promise<readonly ScriptTemplatePayload[]> {
    const rows = await this.prisma.scriptTemplate.findMany({
      where: { vibe: input.vibe, treatmentClass: input.treatmentClass },
    });
    return rows.map((r) =>
      ScriptTemplatePayloadSchema.parse({
        id: r.id,
        vibe: r.vibe,
        treatmentClass: r.treatmentClass,
        text: r.text,
        compatibleCreatorIdentityIds: r.compatibleCreatorIdentityIds,
        version: r.version,
        status: r.status,
      }),
    );
  }
}
