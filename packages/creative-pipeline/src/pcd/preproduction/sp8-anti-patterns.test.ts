import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PREPRODUCTION_DIR = join(import.meta.dirname);

function listSourceFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".test.ts")) continue;
      if (!full.endsWith(".ts")) continue;
      out.push(full);
    }
  }
  walk(PREPRODUCTION_DIR);
  return out;
}

const allSources = listSourceFiles();

describe("SP8 anti-pattern grep", () => {
  it("no PCD_*_VERSION literal in production-fanout-gate.ts (composer-only pinning)", () => {
    const path = join(PREPRODUCTION_DIR, "production-fanout-gate.ts");
    const src = readFileSync(path, "utf8");
    expect(src).not.toMatch(/PCD_PREPRODUCTION_CHAIN_VERSION/);
    expect(src).not.toMatch(/PCD_IDENTITY_CONTEXT_VERSION/);
    expect(src).not.toMatch(/PCD_APPROVAL_LIFECYCLE_VERSION/);
    expect(src).not.toMatch(/PCD_PREPRODUCTION_FANOUT_VERSION/);
  });

  it("composer references all four pinned-version constants", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("PCD_PREPRODUCTION_CHAIN_VERSION");
    expect(src).toContain("PCD_IDENTITY_CONTEXT_VERSION");
    expect(src).toContain("PCD_APPROVAL_LIFECYCLE_VERSION");
    expect(src).toContain("PCD_PREPRODUCTION_FANOUT_VERSION");
  });

  it("composer literally calls ProductionFanoutGateOperatorDecisionSchema.parse(", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("ProductionFanoutGateOperatorDecisionSchema.parse(");
  });

  it("AutoApproveOnlyScriptGate is fully removed from preproduction sources", () => {
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} still references AutoApproveOnlyScriptGate`).not.toMatch(
        /AutoApproveOnlyScriptGate/,
      );
    }
  });

  it("composer body asserts the subset invariant (selectedScriptIds ⊆ availableScriptIds)", () => {
    const path = join(PREPRODUCTION_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("gate selected unknown script id");
  });
});
