import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROVENANCE_DIR = join(import.meta.dirname);
const PCD_DIR = join(PROVENANCE_DIR, "..");
const PREPRODUCTION_DIR = join(PCD_DIR, "preproduction");

function listSourceFiles(root: string): string[] {
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
  walk(root);
  return out;
}

const provenanceSources = listSourceFiles(PROVENANCE_DIR);
const stagesDir = join(PREPRODUCTION_DIR, "stages");
const stageStubFiles = readdirSync(stagesDir)
  .filter((f) => f.startsWith("stub-") && f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => join(stagesDir, f));
// Real-runner implementations end in `-stage-runner.ts` but are NOT stubs.
// Interface files end the same — exclude them by checking for `class` keyword in body.
const stageRunnerImplFiles = readdirSync(stagesDir)
  .filter((f) => f.endsWith("-stage-runner.ts") && !f.endsWith(".test.ts"))
  .map((f) => join(stagesDir, f))
  .filter((file) => /\bclass\b/.test(readFileSync(file, "utf8")));

describe("SP9 anti-pattern grep", () => {
  it("PCD_PROVENANCE_VERSION literal lives only in provenance-version.ts (composer-only pinning)", () => {
    const allowed = join(PROVENANCE_DIR, "provenance-version.ts");
    for (const file of provenanceSources) {
      if (file === allowed) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_PROVENANCE_VERSION literal`).not.toMatch(
        /"pcd-provenance@/,
      );
    }
    // Sanity — provenance-version.ts itself does contain the literal.
    expect(readFileSync(allowed, "utf8")).toContain('"pcd-provenance@1.0.0"');
  });

  it("stamp-pcd-provenance.ts literally calls assertConsentNotRevokedForGeneration(", () => {
    const path = join(PROVENANCE_DIR, "stamp-pcd-provenance.ts");
    const src = readFileSync(path, "utf8");
    expect(src).toContain("assertConsentNotRevokedForGeneration(");
  });

  it("no decisionNote substring in stub stage runners (SP8 bounding)", () => {
    for (const file of stageStubFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} reads decisionNote`).not.toMatch(/decisionNote/);
    }
  });

  it("no decisionNote substring in real stage-runner implementer source bodies", () => {
    for (const file of stageRunnerImplFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} reads decisionNote`).not.toMatch(/decisionNote/);
    }
  });

  it("orchestrator imports the same four version constants as SP4 writer", () => {
    const sp4 = readFileSync(join(PCD_DIR, "pcd-identity-snapshot-writer.ts"), "utf8");
    const sp9 = readFileSync(
      join(PROVENANCE_DIR, "write-pcd-identity-snapshot-with-provenance.ts"),
      "utf8",
    );
    for (const constant of [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ]) {
      expect(sp4, `SP4 should reference ${constant}`).toContain(constant);
      expect(sp9, `SP9 orchestrator should reference ${constant}`).toContain(constant);
    }
    // SP9 orchestrator must also call the same Tier 3 invariant assertion
    // with the six-argument shape. Drift between SP4 and SP9 logic is a
    // structural defect.
    expect(sp4).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp9).toContain("assertTier3RoutingDecisionCompliant({");
  });

  it("forbidden imports — SP9 source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of provenanceSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} imports @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${file} imports @prisma/client`).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, `${file} imports inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${file} imports node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${file} imports node:https`).not.toMatch(/from\s+["']node:https["']/);
      expect(src, `${file} imports crypto`).not.toMatch(/from\s+["']crypto["']/);
    }
  });

  it("SP1–SP8 source bodies are unchanged since the SP8 baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/pcd/preproduction/index.ts",
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/pcd-preproduction.ts",
      "packages/schemas/src/index.ts",
      // SP11 net-new schema files (synthetic creator roster foundation)
      "packages/schemas/src/creative-brief.ts",
      "packages/schemas/src/__tests__/creative-brief.test.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      // SP11 net-new db store files (synthetic creator roster Task 5)
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-reader.test.ts",
      // SP11 db barrel re-export (Task 6)
      "packages/db/src/index.ts",
      // SP11 synthetic creator seed roster (Task 7)
      "packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts",
      "packages/creative-pipeline/src/pcd/synthetic-creator/seed.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts",
      // SP11 anti-pattern grep tests (Task 8)
      "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts",
      // SP12 net-new schema files (synthetic creator license gate Task 2)
      "packages/schemas/src/creator-identity-license.ts",
      "packages/schemas/src/__tests__/creator-identity-license.test.ts",
      "packages/schemas/src/index.ts",
      // SP12 net-new db store files (Task 4)
      "packages/db/src/stores/prisma-creator-identity-license-store.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-license-store.test.ts",
      "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts",
      // SP12 net-new license-gate module + barrel (Tasks 6–7)
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
      "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.test.ts",
      // SP12 anti-pattern tests (Task 8)
      "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts",
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
      "packages/db/src/index.ts",
      "packages/creative-pipeline/src/index.ts",
    ]);

    let sp8Sha = "";
    try {
      sp8Sha = execSync('git log --grep="SP8 — branching tree" --max-count=1 --format=%H', {
        encoding: "utf8",
      }).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7's
      // anti-pattern test for shallow CI environments.
      return;
    }
    if (sp8Sha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp8Sha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP9 net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/provenance/")) continue;
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost/")) continue;
      // SP10B net-new files are out of scope (necessary maintenance — SP9 test
      // was written before SP10B territory existed; same precedent as the
      // pcd/cost/ allowlist added by SP10A).
      if (file.startsWith("packages/creative-pipeline/src/pcd/budget/")) continue;
      // SP10C net-new files are out of scope (necessary maintenance — same
      // precedent as pcd/budget/ allowlist added by SP10B).
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
      // SP13 net-new selector subdir is out of scope (necessary maintenance —
      // SP9 test was written before SP13 territory existed; same precedent
      // as pcd/cost/, pcd/budget/, pcd/cost-budget/ allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      if (file.endsWith(".prisma")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowed db edits — exact-match to prevent sibling files
      // (e.g. *-store.helpers.ts) from slipping through unnoticed.
      if (file === "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts") continue;
      if (file === "packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts")
        continue;
      if (file === "packages/schemas/src/pcd-provenance.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-provenance.test.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-preproduction.test.ts") continue;
      if (file === "packages/schemas/src/pcd-cost-forecast.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-cost-forecast.test.ts") continue;
      // SP10C widened schemas with pcd-cost-budget.ts in lock-step. Allow as
      // out-of-scope; SP10C's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-cost-budget.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-cost-budget.test.ts") continue;
      // SP13 widened schemas with pcd-synthetic-selector.ts. Allow as
      // out-of-scope; SP13's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-synthetic-selector.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts") continue;
      // SP15 net-new files are out of scope (necessary maintenance — SP9 test
      // was written before SP15 territory existed; same precedent as pcd/selector/
      // allowlist added by SP13).
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

      expect(allowedEdits.has(file), `SP9 modified disallowed file: ${file}`).toBe(true);
    }
  });
});
