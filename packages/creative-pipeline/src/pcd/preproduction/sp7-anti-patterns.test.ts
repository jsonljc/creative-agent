import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SP7_DIR = join(import.meta.dirname);

function listSp7SourceFiles(): string[] {
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
  walk(SP7_DIR);
  return out;
}

function readCodeOnly(file: string): string {
  // Strip line comments and block comments before regex matching so doc-comments
  // describing the anti-pattern don't trip the grep.
  const src = readFileSync(file, "utf8");
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const allSources = listSp7SourceFiles();

describe("SP7 anti-pattern grep", () => {
  it("no `if (stage ===` outside preproduction-chain-error.ts", () => {
    for (const file of allSources) {
      if (file.endsWith("preproduction-chain-error.ts")) continue;
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'if (stage ==='`).not.toMatch(/if\s*\(\s*stage\s*===/);
    }
  });

  it("no `if (intent ===`, `if (effectiveTier ===`, `if (shotType ===` in any SP7 source", () => {
    for (const file of allSources) {
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'if (intent ==='`).not.toMatch(/if\s*\(\s*intent\s*===/);
      expect(code, `${file} contains 'if (effectiveTier ==='`).not.toMatch(
        /if\s*\(\s*effectiveTier\s*===/,
      );
      expect(code, `${file} contains 'if (shotType ==='`).not.toMatch(
        /if\s*\(\s*shotType\s*===/,
      );
    }
  });

  it("preproduction-chain.ts literally calls productionFanoutGate.requestSelection(", () => {
    const path = join(SP7_DIR, "preproduction-chain.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("productionFanoutGate.requestSelection(");
  });

  it("build-pcd-identity-context.ts literally calls assertConsentNotRevokedForGeneration(", () => {
    const path = join(SP7_DIR, "build-pcd-identity-context.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("assertConsentNotRevokedForGeneration(");
  });

  it("no `prisma.`, `assetRecord.update`, or `WorkTrace` token in any SP7 source", () => {
    for (const file of allSources) {
      const code = readCodeOnly(file);
      expect(code, `${file} contains 'prisma.'`).not.toMatch(/\bprisma\./);
      expect(code, `${file} contains 'assetRecord.update'`).not.toMatch(/assetRecord\.update/);
      expect(code, `${file} contains 'WorkTrace'`).not.toMatch(/\bWorkTrace\b/);
    }
  });

  it("no Switchboard parent-system imports in any SP7 source", () => {
    for (const file of allSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports ApprovalLifecycle`).not.toMatch(
        /import.*\bApprovalLifecycle\b/,
      );
      expect(src, `${file} imports ExportLifecycle`).not.toMatch(
        /import.*\bExportLifecycle\b/,
      );
      expect(src, `${file} imports core/approval`).not.toMatch(/import.*core\/approval/);
    }
  });
});

describe("SP7 forbidden imports", () => {
  it("no SP7 source imports @creativeagent/db, @prisma/client, inngest, node fs/http/https, or crypto", () => {
    const forbidden = [
      "@creativeagent/db",
      "@prisma/client",
      "inngest",
      "node:fs",
      "node:http",
      "node:https",
      "crypto",
    ];
    for (const file of allSources) {
      // The anti-pattern test itself imports node:fs to walk the tree; skip it.
      if (file.endsWith("sp7-anti-patterns.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const tok of forbidden) {
        const re = new RegExp(`from\\s+['"]${tok}['"]`);
        expect(src, `${file} imports ${tok}`).not.toMatch(re);
      }
    }
  });
});
