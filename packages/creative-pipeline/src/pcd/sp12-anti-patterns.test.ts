// SP12 anti-pattern grep tests. These guard against:
//   1. SP13+ scope leak (no selector / disclosure / script-template / performance-snapshot
//      imports in SP12 files)
//   2. Migration shape (additive only — no DROP, FK with CASCADE, no new enum types)
//   3. License-gate purity (no @creativeagent/db, no @prisma/client, no Date.now() inside
//      the gate module)
//   4. SP1–SP11 source body changes — only the additive `licenses` back-reference on
//      CreatorIdentity is allowed
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

function grepFiles(pattern: string, scope: string): string[] {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return []; // grep exits 1 on no match
  }
}

describe("SP12 anti-patterns", () => {
  it("license-gate module does not import @creativeagent/db or @prisma/client (purity)", () => {
    const gatePath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
    );
    const src = readFileSync(gatePath, "utf8");
    expect(src).not.toMatch(/from\s+["']@creativeagent\/db["']/);
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it("license-gate module does not call Date.now() or new Date() inside the function body", () => {
    const gatePath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
    );
    const src = readFileSync(gatePath, "utf8");
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new\s+Date\(/);
  });

  it("SP12 source files do not import SP13+ modules (selector / disclosure / script / snapshot)", () => {
    const sp12Files = [
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
      "packages/db/src/stores/prisma-creator-identity-license-store.ts",
      "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
      "packages/schemas/src/creator-identity-license.ts",
    ];
    for (const rel of sp12Files) {
      const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      // SP12 invariant: no SP13+ module IMPORTS from these files. The grep is
      // import-scoped so SP21+ JSDoc references to the selector/disclosure/etc
      // components (valid documentation patterns naming the downstream consumers)
      // do not trigger this guard.
      expect(src, `${rel} must not import from selector module`).not.toMatch(
        /from\s+["'][^"']*selector[^"']*["']/i,
      );
      expect(src, `${rel} must not import from disclosure module`).not.toMatch(
        /from\s+["'][^"']*disclosure[^"']*["']/i,
      );
      expect(src, `${rel} must not import from script-template module`).not.toMatch(
        /from\s+["'][^"']*script-template[^"']*["']/i,
      );
      expect(src, `${rel} must not import from performance-snapshot module`).not.toMatch(
        /from\s+["'][^"']*performance-snapshot[^"']*["']/i,
      );
      expect(src, `${rel} must not reference SyntheticCreatorSelectionDecision`).not.toMatch(
        /SyntheticCreatorSelectionDecision/,
      );
    }
  });

  it("SP12 migration is additive — adds CreatorIdentityLicense, no drops, no new enum types", () => {
    const migrationsDir = path.join(REPO_ROOT, "packages/db/prisma/migrations");
    const list = readdirSync(migrationsDir);
    const sp12Migration = list.find((d) => /license_sp12/.test(d));
    expect(sp12Migration, "SP12 migration directory not found").toBeDefined();

    const migrationPath = path.join(migrationsDir, sp12Migration!, "migration.sql");
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE TABLE "CreatorIdentityLicense"/);
    expect(sql).toMatch(/REFERENCES "CreatorIdentity"\("id"\) ON DELETE CASCADE/);

    // Three required indexes
    expect(sql).toMatch(/CreatorIdentityLicense_creatorIdentityId_status_idx/);
    expect(sql).toMatch(/CreatorIdentityLicense_clinicId_market_treatmentClass_idx/);
    expect(sql).toMatch(/CreatorIdentityLicense_effectiveTo_idx/);

    // Strictly additive — no drops, no new enum types
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
    expect(sql).not.toMatch(/CREATE TYPE/);
  });

  it("CreatorIdentity Prisma model body adds only the `licenses` back-reference and no other SP12 fields", () => {
    const schemaPath = path.join(REPO_ROOT, "packages/db/prisma/schema.prisma");
    expect(existsSync(schemaPath)).toBe(true);
    const src = readFileSync(schemaPath, "utf8");

    const match = src.match(/model CreatorIdentity \{([\s\S]+?)(?=^model )/m);
    expect(match, "CreatorIdentity block not found in schema.prisma").toBeDefined();
    const block = match![1] ?? "";

    // SP11 column still present:
    expect(block).toMatch(/kind\s+CreatorIdentityKind\s+@default\(real\)/);
    // SP12 back-reference present:
    expect(block).toMatch(/licenses\s+CreatorIdentityLicense\[\]/);

    // SP12 has not leaked synthetic-only or license-only fields onto the
    // base CreatorIdentity model — those belong on the extension tables.
    expect(block).not.toMatch(/lockType/);
    expect(block).not.toMatch(/clinicId/);
    expect(block).not.toMatch(/effectiveFrom/);
  });

  it("no SP12 source file imports DALL-E / Kling / OpenAI APIs (no real model runners)", () => {
    const hits = grepFiles(
      "(openai\\.images|dalle\\.|fetch.*kling|fetch.*openai|kling\\.api|dalle3)",
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts packages/db/src/stores/prisma-creator-identity-license-store.ts packages/db/src/stores/prisma-creator-identity-license-reader.ts",
    );
    expect(hits).toEqual([]);
  });

  it("license gate test file does not depend on Prisma at runtime (pure-table-driven invariant)", () => {
    const testPath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts",
    );
    const src = readFileSync(testPath, "utf8");
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });
});
