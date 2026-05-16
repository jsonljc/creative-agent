// SP14 anti-pattern grep tests. These guard against:
//   1. Single-source version pinning (literal "pcd-disclosure-resolver@1.0.0"
//      appears in exactly one non-test source file: disclosure-resolver-version.ts)
//   2. Single-source placeholder prefix ("[DISCLOSURE_PENDING_LEGAL_REVIEW:"
//      appears in exactly one non-test source file: disclosure-placeholder.ts)
//   3. Purity (no Date.now, no new Date except seed file's allowlisted literal,
//      no Math.random, no @creativeagent/db, no @prisma/client, no inngest,
//      no node:fs|http|https, no crypto)
//   4. No-wildcard guarantee on seed values (id, jurisdictionCode, platform,
//      treatmentClass, text — programmatic, not source grep)
//   5. No cross-slice tokens — SP13 selection-decision shape forbidden, and
//      SP15+ tokens forbidden
//   6. Frozen SP1-SP13 source bodies (allowlist edits only) — keyed against dc7b498
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DISCLOSURE_TEMPLATE_SEED } from "./disclosure-seed.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const DISCLOSURE_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/disclosure");
const VERSION_PATH = path.join(DISCLOSURE_DIR, "disclosure-resolver-version.ts");
const PLACEHOLDER_PATH = path.join(DISCLOSURE_DIR, "disclosure-placeholder.ts");
const RESOLVER_PATH = path.join(DISCLOSURE_DIR, "disclosure-resolver.ts");
const SEED_PATH = path.join(DISCLOSURE_DIR, "disclosure-seed.ts");

function grepFiles(pattern: string, scope: string): string[] {
  try {
    const out = execSync(
      `grep -rE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist '${pattern}' ${scope}`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

describe("SP14 anti-patterns", () => {
  it('PCD_DISCLOSURE_RESOLVER_VERSION literal "pcd-disclosure-resolver@1.0.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-disclosure-resolver@1\\.0\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.ts",
      ),
    ).toBe(true);
  });

  it('PLACEHOLDER_DISCLOSURE_PREFIX literal "[DISCLOSURE_PENDING_LEGAL_REVIEW:" lives in exactly one non-test source file', () => {
    const hits = grepFiles("\\[DISCLOSURE_PENDING_LEGAL_REVIEW:", "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has("packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.ts"),
    ).toBe(true);
  });

  it("non-seed disclosure sources are pure — no clock reads, no randomness, no I/O imports", () => {
    const pureSources = [VERSION_PATH, PLACEHOLDER_PATH, RESOLVER_PATH];
    for (const filePath of pureSources) {
      const src = readFileSync(filePath, "utf8");
      expect(src, `${filePath}: Date.now()`).not.toMatch(/Date\.now\(\)/);
      expect(src, `${filePath}: new Date(`).not.toMatch(/new\s+Date\(/);
      expect(src, `${filePath}: Math.random`).not.toMatch(/Math\.random\(/);
      expect(src, `${filePath}: @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${filePath}: @prisma/client`).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, `${filePath}: inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${filePath}: node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${filePath}: node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${filePath}: node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${filePath}: crypto`).not.toMatch(/from\s+["']crypto["']/);
      expect(src, `${filePath}: node:crypto`).not.toMatch(/from\s+["']node:crypto["']/);
      expect(src, `${filePath}: PrismaClient`).not.toMatch(/PrismaClient/);
    }
  });

  it("seed file allowlists exactly two new Date(...) literals — the fixed epoch + per-row clone", () => {
    const src = readFileSync(SEED_PATH, "utf8");
    const newDateOccurrences = src.match(/new\s+Date\(/g) ?? [];
    expect(newDateOccurrences.length).toBe(2);
    // The fixed epoch declaration:
    expect(src).toMatch(/new\s+Date\("2026-01-01T00:00:00Z"\)/);
    // The per-row clone from the epoch (prevents shared-reference mutation):
    expect(src).toMatch(/new\s+Date\(SEED_EPOCH\.getTime\(\)\)/);
  });

  it("seed values contain no wildcard tokens (programmatic — id / jurisdictionCode / platform / treatmentClass / text)", () => {
    const WILDCARDS = /\b(default|catch_all|wildcard|global|fallback)\b/;
    for (const r of DISCLOSURE_TEMPLATE_SEED) {
      for (const [field, value] of Object.entries({
        id: r.id,
        jurisdictionCode: r.jurisdictionCode,
        platform: r.platform,
        treatmentClass: r.treatmentClass,
        text: r.text,
      })) {
        expect(value, `wildcard token in seed ${field}: ${value}`).not.toMatch(WILDCARDS);
      }
    }
  });

  it("no cross-slice tokens in pcd/disclosure source — SP13 decision shape, SP15+ tokens both forbidden", () => {
    const filesToScan = [VERSION_PATH, PLACEHOLDER_PATH, RESOLVER_PATH, SEED_PATH];
    const FORBIDDEN_SP13 = [
      "SyntheticCreatorSelectionDecision",
      "selectedCreatorIdentityId",
      "fallbackCreatorIdentityIds",
      "creatorIdentityId",
      "selectedLicenseId",
      "selectorRank",
      "selectorVersion",
    ];
    const FORBIDDEN_SP15_PLUS = [
      "ScriptTemplate",
      "script_template",
      "PcdPerformanceSnapshot",
      "performance_snapshot",
      "metricsSnapshotVersion",
      "qc_face",
      "face_descriptor",
    ];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of [...FORBIDDEN_SP13, ...FORBIDDEN_SP15_PLUS]) {
        expect(
          src.includes(token),
          `${filePath} must not reference cross-slice token: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("SP1–SP13 source bodies are unchanged since the SP13 baseline (allowlist edits only)", () => {
    const SP13_BASELINE = "dc7b498"; // SP13-on-main merge tip
    const allowedEdits = new Set([
      // SP14 net-new schema (Task 1)
      "packages/schemas/src/pcd-disclosure-template.ts",
      "packages/schemas/src/__tests__/pcd-disclosure-template.test.ts",
      "packages/schemas/src/index.ts",
      // SP14 net-new pipeline subdir
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
      // SP14 db reader (Task 5)
      "packages/db/src/stores/prisma-disclosure-template-reader.ts",
      "packages/db/src/stores/prisma-disclosure-template-reader.test.ts",
      "packages/db/src/index.ts",
      // SP14 Prisma additions (Task 4)
      "packages/db/prisma/schema.prisma",
      "packages/db/prisma/migrations/20260514150000_pcd_disclosure_template_sp14/migration.sql",
      // SP14 barrels (Task 15)
      "packages/creative-pipeline/src/index.ts",
      // SP14 design + plan docs
      "docs/plans/2026-05-14-pcd-disclosure-registry-sp14-design.md",
      "docs/plans/2026-05-14-pcd-disclosure-registry-sp14-plan.md",
      // SP17 net-new + edits (allowlist maintenance, Task 13)
      "packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP13_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      return; // shallow clone — skip same as SP13 test does
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
      if (file.startsWith("packages/creative-pipeline/src/pcd/disclosure/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 14)
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts")
        continue;
      // SP15 net-new files are out of scope (necessary maintenance — SP14 test
      // was written before SP15 territory existed; same precedent as prior
      // SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
      if (file === "packages/schemas/src/pcd-script-template.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-script-template.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.test.ts") continue;
      if (
        file ===
        "packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql"
      )
        continue;
      // SP16 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP16 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      if (file === "packages/schemas/src/pcd-synthetic-router.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts") continue;
      // SP17 net-new migration is out of scope (necessary maintenance —
      // same precedent as prior subdir allowlists).
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      // SP18 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP18 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-routing-provenance/"))
        continue;
      if (file === "packages/schemas/src/pcd-synthetic-routing-provenance.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts")
        continue;
      // SP18 widens the db snapshot store. Allow as out-of-scope; SP18's own
      // freeze test is the authoritative gate for SP18-era changes.
      if (file === "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts") continue;
      if (file === "packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts")
        continue;
      // SP19 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP19 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/performance-snapshot/")) continue;
      if (file === "packages/schemas/src/pcd-performance-snapshot.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-performance-snapshot.test.ts") continue;
      if (file.startsWith("packages/db/src/stores/prisma-pcd-performance-snapshot-")) continue;
      if (file.startsWith("packages/db/src/stores/__tests__/prisma-pcd-performance-snapshot-"))
        continue;
      // SP20 carve-out — SP20 widened SP13 selector files + net-new performance-metrics files.
      // See docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md §2.1 Guardrail B-1.
      if (file === "packages/creative-pipeline/src/pcd/selector/selector.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/selector.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts")
        continue;
      if (file === "packages/schemas/src/pcd-synthetic-selector.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts") continue;
      if (
        file ===
        "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts"
      )
        continue;
      if (
        file ===
        "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts"
      )
        continue;
      if (file === "packages/schemas/src/pcd-creator-performance-metrics.ts") continue;
      if (file === "packages/schemas/src/pcd-creator-performance-metrics.test.ts") continue;
      if (file === "packages/schemas/src/pcd-performance-overlay-version.ts") continue;
      if (file === "packages/schemas/src/pcd-performance-overlay-version.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts")
        continue;
      if (file === "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts")
        continue;
      if (
        file === "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts"
      )
        continue;
      if (
        file ===
        "packages/db/src/stores/__tests__/prisma-pcd-creator-performance-metrics-reader.test.ts"
      )
        continue;
      // SP21 carve-out — SP21 net-new composer, ports, seed adapter, and db widen.
      // See docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-design.md.
      if (
        file ===
        "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts"
      )
        continue;
      if (
        file === "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts"
      )
        continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/index.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts") continue;
      if (
        file ===
        "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts"
      )
        continue;
      if (
        file ===
        "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts"
      )
        continue;
      if (
        file ===
        "packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts"
      )
        continue;
      if (file === "packages/db/src/stores/prisma-creator-identity-license-reader.ts") continue;
      if (
        file === "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts"
      )
        continue;

      expect(allowedEdits.has(file), `SP14 modified disallowed file: ${file}`).toBe(true);
    }
  });
});
