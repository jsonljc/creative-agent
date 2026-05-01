// SP11 anti-pattern grep tests. These guard against:
//   1. SP12+ scope leak (no license / disclosure / selector imports in SP11 files)
//   2. Migration shape (additive only — no DROP)
//   3. Real model runners showing up in SP11 (DALL-E / Kling calls forbidden)
//   4. Synthetic seed prompt drift (locked text bodies hash to known values)
//   5. CreatorIdentity Prisma model body contains only the additive kind column
//      and no SP11 synthetic-only fields
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "./synthetic-creator/seed.js";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

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

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

describe("SP11 anti-patterns", () => {
  it("seed file does not import SP12+ modules (license/disclosure/selector/snapshot/script-template)", () => {
    const seedPath = path.join(
      REPO_ROOT,
      "packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts",
    );
    const seedSrc = readFileSync(seedPath, "utf8");
    expect(seedSrc).not.toMatch(/license/i);
    expect(seedSrc).not.toMatch(/disclosure/i);
    expect(seedSrc).not.toMatch(/selector/i);
    expect(seedSrc).not.toMatch(/performance-snapshot/i);
    expect(seedSrc).not.toMatch(/script-template/i);
  });

  it("CreatorIdentity migration adds kind column without dropping anything", () => {
    const migrationsDir = path.join(REPO_ROOT, "packages/db/prisma/migrations");
    const list = execSync(`ls ${migrationsDir}`, { encoding: "utf8" }).trim().split("\n");
    const sp11Migration = list.find((d) => /synthetic_sp11/.test(d));
    expect(sp11Migration).toBeDefined();

    const migrationPath = path.join(migrationsDir, sp11Migration!, "migration.sql");
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/CREATE TYPE "CreatorIdentityKind"/);
    expect(sql).toMatch(/ADD COLUMN\s+"kind"/);
    expect(sql).toMatch(/CREATE TABLE "CreatorIdentitySynthetic"/);
    expect(sql).not.toMatch(/DROP TABLE/);
    expect(sql).not.toMatch(/DROP COLUMN/);
  });

  it("no SP11 source file calls DALL-E or Kling APIs", () => {
    const hits = grepFiles(
      "(openai\\.images|dalle\\.|fetch.*kling|fetch.*openai|kling\\.api|dalle3)",
      "packages/creative-pipeline/src/pcd/synthetic-creator",
    );
    // The seed file legitimately contains the literal strings "DALL-E" and
    // "Kling" inside data fields and prompts, so we don't grep for those.
    // We only flag actual API/SDK call patterns.
    expect(hits).toEqual([]);
  });

  it("seed dallePromptLocked strings hash to expected values (drift sentinel)", () => {
    // Update these hashes ONLY when intentionally revising a character's
    // locked prompt. A green diff in this test means a prompt mutated
    // without an update to the sentinel — likely silent drift.
    const expected: Record<string, string> = {
      cid_synth_cheryl_sg_01: "4a6b6fb7cbaff69e",
      cid_synth_vivienne_sg_02: "e535a66a4aef6a51",
      cid_synth_felicia_my_03: "b962e14a4ea47a73",
      cid_synth_amanda_my_04: "9fd67f30b299aeb2",
      cid_synth_nana_th_05: "95fa627f6978dabb",
      cid_synth_bianca_sg_06: "4d23e71c6b31bf55",
      cid_synth_hana_my_07: "b4d6cf3c3b145b2b",
      cid_synth_chloe_hk_08: "c74c81409cc5cc7c",
      cid_synth_elaine_sg_09: "d18bb356463e2917",
      cid_synth_bua_th_10: "d1b431f1ec500807",
    };

    for (const [id, expectedHash] of Object.entries(expected)) {
      const entry = SP11_SYNTHETIC_CREATOR_ROSTER.find((c) => c.synthetic.creatorIdentityId === id);
      expect(entry, `roster entry not found: ${id}`).toBeDefined();
      const actual = hashOf(entry!.synthetic.dallePromptLocked);
      expect(actual, `prompt drift on ${id}`).toBe(expectedHash);
    }
  });

  it("CreatorIdentity Prisma model body contains the additive kind column and no SP11 synthetic-only fields", () => {
    const schemaPath = path.join(REPO_ROOT, "packages/db/prisma/schema.prisma");
    expect(existsSync(schemaPath)).toBe(true);
    const src = readFileSync(schemaPath, "utf8");

    // Find the CreatorIdentity block (between "model CreatorIdentity {" and the next "model " or end-of-file)
    const match = src.match(/model CreatorIdentity \{([\s\S]+?)(?=^model |\z)/m);
    expect(match, "CreatorIdentity block not found in schema.prisma").toBeDefined();
    const block = match![1] ?? "";

    // The kind column must be present with the additive default.
    expect(block).toMatch(/kind\s+CreatorIdentityKind\s+@default\(real\)/);

    // Synthetic-only fields belong on CreatorIdentitySynthetic, not on CreatorIdentity.
    expect(block).not.toMatch(/dallePromptLocked/);
    expect(block).not.toMatch(/treatmentClass\s+String/);
    expect(block).not.toMatch(/klingDirection/);
    expect(block).not.toMatch(/voiceCaptionStyle/);
  });
});
