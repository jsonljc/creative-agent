// SP13 anti-pattern grep tests. These guard against:
//   1. Single-source version pinning (the literal "pcd-selector@1.0.0"
//      appears in exactly one non-test source file: selector-version.ts;
//      selector.ts must import PCD_SELECTOR_VERSION, not repeat the literal)
//   2. Purity (no Date.now, no new Date, no Math.random, no @creativeagent/db,
//      no @prisma/client, no inngest, no node:fs|http|https, no crypto)
//   3. Compatible-set filter coverage (all six brief fields are compared
//      with === plus status === "active")
//   4. Gate-call discipline (selector source contains the licenseGate( call)
//   5. No SP14+ scope leak (no DisclosureTemplate / ScriptTemplate /
//      PcdPerformanceSnapshot tokens in SP13 source)
//   6. Frozen SP1-SP12 source bodies (allowlist edits only)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SELECTOR_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/selector");
const VERSION_PATH = path.join(SELECTOR_DIR, "selector-version.ts");
const SELECTOR_PATH = path.join(SELECTOR_DIR, "selector.ts");

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

describe("SP13 anti-patterns", () => {
  it("PCD_SELECTOR_VERSION literal `pcd-selector@1.0.0` lives in exactly one non-test source file", () => {
    const hits = grepFiles('"pcd-selector@1\\.0\\.0"', "packages/");
    // Tolerate test-file references; restrict to non-test sources.
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    // Each hit is "path:line"; collapse to unique paths.
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(uniquePaths.has("packages/creative-pipeline/src/pcd/selector/selector-version.ts")).toBe(
      true,
    );
  });

  it("selector.ts imports PCD_SELECTOR_VERSION from selector-version.ts and uses the constant (never repeats the literal)", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    // Positive: must import the constant.
    expect(src).toMatch(
      /import\s*\{\s*PCD_SELECTOR_VERSION\s*\}\s*from\s+["']\.\/selector-version\.js["']/,
    );
    // Positive: must reference the constant by name in returned decisions.
    expect(src).toMatch(/selectorVersion:\s*PCD_SELECTOR_VERSION/);
    // Negative: must NOT contain the literal version string. The single
    // source of truth is selector-version.ts.
    expect(src).not.toMatch(/"pcd-selector@/);
  });

  it("selector module is pure — no clock reads, no randomness, no I/O imports", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/new\s+Date\(/);
    expect(src).not.toMatch(/Math\.random\(/);
    expect(src).not.toMatch(/from\s+["']@creativeagent\/db["']/);
    expect(src).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(src).not.toMatch(/from\s+["']inngest["']/);
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']node:http["']/);
    expect(src).not.toMatch(/from\s+["']node:https["']/);
    expect(src).not.toMatch(/from\s+["']crypto["']/);
    expect(src).not.toMatch(/from\s+["']node:crypto["']/);
    expect(src).not.toMatch(/PrismaClient/);
  });

  it('compatible-set filter exercises all six brief target fields plus status === "active"', () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src, "must compare brief.treatmentClass").toMatch(
      /s\.treatmentClass\s*===\s*brief\.treatmentClass/,
    );
    expect(src, "must compare brief.market").toMatch(/s\.market\s*===\s*brief\.market/);
    expect(src, "must compare brief.targetVibe").toMatch(/s\.vibe\s*===\s*brief\.targetVibe/);
    expect(src, "must compare brief.targetEthnicityFamily").toMatch(
      /s\.ethnicityFamily\s*===\s*brief\.targetEthnicityFamily/,
    );
    expect(src, "must compare brief.targetAgeBand").toMatch(
      /s\.ageBand\s*===\s*brief\.targetAgeBand/,
    );
    expect(src, "must compare brief.pricePositioning").toMatch(
      /s\.pricePositioning\s*===\s*brief\.pricePositioning/,
    );
    expect(src, 'must check status === "active"').toMatch(/s\.status\s*===\s*["']active["']/);
  });

  it("selector body invokes SP12 licenseGate (composes the black box, does not re-implement)", () => {
    const src = readFileSync(SELECTOR_PATH, "utf8");
    expect(src).toMatch(/licenseGate\s*\(/);
    // Also assert the import line, so accidental renames are caught.
    expect(src).toMatch(/from\s+["']\.\.\/synthetic-creator\/license-gate\.js["']/);
  });

  it("no SP14+ scope leak — selector source does not reference disclosure / script-template / performance-snapshot tokens", () => {
    for (const filePath of [SELECTOR_PATH, VERSION_PATH]) {
      const src = readFileSync(filePath, "utf8");
      expect(src, `${filePath} must not reference disclosure`).not.toMatch(
        /DisclosureTemplate|disclosure-template|DisclosureResolver/,
      );
      expect(src, `${filePath} must not reference script-template`).not.toMatch(
        /ScriptTemplate|script-template/,
      );
      expect(src, `${filePath} must not reference performance snapshots`).not.toMatch(
        /PcdPerformanceSnapshot|performance-snapshot/,
      );
    }
    // Selector schema is allowed to declare `metricsSnapshotVersion` as a reserved field name,
    // but must not import any SP18 token.
    const schemaPath = path.join(REPO_ROOT, "packages/schemas/src/pcd-synthetic-selector.ts");
    const schemaSrc = readFileSync(schemaPath, "utf8");
    expect(schemaSrc).not.toMatch(/PcdPerformanceSnapshot/);
    expect(schemaSrc).not.toMatch(/ScriptTemplate/);
    expect(schemaSrc).not.toMatch(/DisclosureTemplate/);
  });

  it("SP1–SP12 source bodies are unchanged since the SP12 baseline (allowlist edits only)", () => {
    const SP12_BASELINE = "2f085ba"; // SP10C-on-main merge tip (also has SP11 + SP12)
    const allowedEdits = new Set([
      // SP13 net-new schema files (Task 1)
      "packages/schemas/src/pcd-synthetic-selector.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts",
      "packages/schemas/src/index.ts",
      // SP13 net-new selector subdir (Tasks 2–9)
      "packages/creative-pipeline/src/pcd/selector/selector-version.ts",
      "packages/creative-pipeline/src/pcd/selector/selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/selector/selector.ts",
      "packages/creative-pipeline/src/pcd/selector/selector.test.ts",
      "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/selector/index.ts",
      // SP13 barrel re-export (Task 12)
      "packages/creative-pipeline/src/index.ts",
      // SP14 net-new files (additive maintenance)
      "packages/schemas/src/pcd-disclosure-template.ts",
      "packages/schemas/src/__tests__/pcd-disclosure-template.test.ts",
      "packages/db/src/stores/prisma-disclosure-template-reader.ts",
      "packages/db/src/stores/prisma-disclosure-template-reader.test.ts",
      "packages/db/prisma/schema.prisma",
      "packages/db/prisma/migrations/20260514150000_pcd_disclosure_template_sp14/migration.sql",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.test.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.test.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver.test.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-seed.ts",
      "packages/creative-pipeline/src/pcd/disclosure/disclosure-seed.test.ts",
      "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/disclosure/index.ts",
      // SP15 net-new files (additive maintenance)
      "packages/schemas/src/pcd-script-template.ts",
      "packages/schemas/src/__tests__/pcd-script-template.test.ts",
      "packages/db/src/stores/prisma-script-template-reader.ts",
      "packages/db/src/stores/prisma-script-template-reader.test.ts",
      "packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.test.ts",
      "packages/db/src/index.ts",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP12_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // same accommodation as SP9–SP12 anti-pattern tests.
      return;
    }
    if (baselineSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${baselineSha} HEAD`, {
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP13 net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
      // SP15 net-new script subdir is out of scope (necessary maintenance — SP13
      // test was written before SP15 territory existed; same precedent as
      // pcd/selector/ allowlist).
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 11) are
      // necessary maintenance — exact-match allowlisted via the Set above
      // is not enough since those edits are append-only allowlist lines.
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts")
        continue;

      expect(allowedEdits.has(file), `SP13 modified disallowed file: ${file}`).toBe(true);
    }
  });
});
