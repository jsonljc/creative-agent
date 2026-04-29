import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PcdQcGateMode, PcdQcGateVerdict } from "@creativeagent/schemas";
import { aggregatePcdQcGateVerdicts, applyPcdQcGateMode } from "./qc-aggregator.js";

const v = (partial: Partial<PcdQcGateVerdict>): PcdQcGateVerdict => ({
  gate: "face_similarity",
  status: "pass",
  reason: "default",
  ...partial,
});

describe("applyPcdQcGateMode", () => {
  it("block mode + pass → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "pass" }), "block");
    expect(out.status).toBe("pass");
  });

  it("block mode + warn → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "warn" }), "block");
    expect(out.status).toBe("warn");
  });

  it("block mode + fail → unchanged (no downgrade)", () => {
    const out = applyPcdQcGateMode(v({ status: "fail", reason: "below threshold" }), "block");
    expect(out.status).toBe("fail");
    expect(out.reason).toBe("below threshold");
  });

  it("block mode + skipped → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "skipped" }), "block");
    expect(out.status).toBe("skipped");
  });

  it("warn_only mode + fail → warn, reason suffixed", () => {
    const out = applyPcdQcGateMode(v({ status: "fail", reason: "below threshold" }), "warn_only");
    expect(out.status).toBe("warn");
    expect(out.reason).toBe("below threshold (warn-only for this tier)");
  });

  it("warn_only mode + pass → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "pass" }), "warn_only");
    expect(out.status).toBe("pass");
  });

  it("warn_only mode + warn → unchanged", () => {
    const out = applyPcdQcGateMode(v({ status: "warn" }), "warn_only");
    expect(out.status).toBe("warn");
  });

  it("warn_only mode + skipped → unchanged (skipped never lowered)", () => {
    const out = applyPcdQcGateMode(v({ status: "skipped" }), "warn_only");
    expect(out.status).toBe("skipped");
  });
});

describe("aggregatePcdQcGateVerdicts", () => {
  it("empty array → warn (skipped/unevaluated never aggregates to pass)", () => {
    const r = aggregatePcdQcGateVerdicts([]);
    expect(r.aggregateStatus).toBe("warn");
    expect(r.gates).toEqual([]);
  });

  it("all skipped → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "skipped" }),
      v({ gate: "logo_similarity", status: "skipped" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("mix of pass + skipped → pass", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "skipped" }),
    ]);
    expect(r.aggregateStatus).toBe("pass");
  });

  it("mix of pass + warn → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "warn" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("mix of pass + fail → fail", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "fail" }),
    ]);
    expect(r.aggregateStatus).toBe("fail");
  });

  it("all fail → fail", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "fail" }),
      v({ gate: "logo_similarity", status: "fail" }),
    ]);
    expect(r.aggregateStatus).toBe("fail");
  });

  it("all warn → warn", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "warn" }),
      v({ gate: "logo_similarity", status: "warn" }),
    ]);
    expect(r.aggregateStatus).toBe("warn");
  });

  it("all pass → pass", () => {
    const r = aggregatePcdQcGateVerdicts([
      v({ status: "pass" }),
      v({ gate: "logo_similarity", status: "pass" }),
    ]);
    expect(r.aggregateStatus).toBe("pass");
  });
});

describe("qc-aggregator — forbidden imports", () => {
  it("source file does not import db/prisma/inngest/node:fs/http/https", () => {
    const src = readFileSync(new URL("./qc-aggregator.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']http["']/);
    expect(src).not.toMatch(/from\s+["']https["']/);
  });
});
