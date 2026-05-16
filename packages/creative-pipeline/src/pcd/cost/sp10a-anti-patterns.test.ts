import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COST_DIR = join(import.meta.dirname);
const PCD_DIR = join(COST_DIR, "..");
const PROVENANCE_DIR = join(PCD_DIR, "provenance");

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

const costSources = listSourceFiles(COST_DIR);

describe("SP10A anti-pattern grep", () => {
  it("PCD_COST_FORECAST_VERSION literal lives only in cost-forecast-version.ts (composer-only pinning)", () => {
    const allowed = join(COST_DIR, "cost-forecast-version.ts");
    for (const file of costSources) {
      if (file === allowed) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_COST_FORECAST_VERSION literal`).not.toMatch(
        /"pcd-cost-forecast@/,
      );
    }
    // Sanity — cost-forecast-version.ts itself does contain the literal.
    expect(readFileSync(allowed, "utf8")).toContain('"pcd-cost-forecast@1.0.0"');
  });

  it("orchestrator imports the same four version constants as SP4 writer + SP9 orchestrator (3-way lock-step)", () => {
    const sp4 = readFileSync(join(PCD_DIR, "pcd-identity-snapshot-writer.ts"), "utf8");
    const sp9 = readFileSync(
      join(PROVENANCE_DIR, "write-pcd-identity-snapshot-with-provenance.ts"),
      "utf8",
    );
    const sp10 = readFileSync(
      join(COST_DIR, "write-pcd-identity-snapshot-with-cost-forecast.ts"),
      "utf8",
    );
    for (const constant of [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ]) {
      expect(sp4, `SP4 should reference ${constant}`).toContain(constant);
      expect(sp9, `SP9 orchestrator should reference ${constant}`).toContain(constant);
      expect(sp10, `SP10A orchestrator should reference ${constant}`).toContain(constant);
    }
    // All three orchestrators must call the Tier 3 invariant assertion with
    // the six-argument shape. Drift between SP4 / SP9 / SP10A logic is a
    // structural defect.
    expect(sp4).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp9).toContain("assertTier3RoutingDecisionCompliant({");
    expect(sp10).toContain("assertTier3RoutingDecisionCompliant({");
  });

  it("forecast-only invariant — no SP10A source mutates selection arrays", () => {
    for (const file of costSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} mutates selectedScriptIds`).not.toMatch(/selectedScriptIds\s*=/);
      expect(src, `${file} mutates availableScriptIds`).not.toMatch(/availableScriptIds\s*=/);
      expect(src, `${file} pushes to selectedScriptIds`).not.toMatch(
        /selectedScriptIds[\s\S]*?\.(push|splice|pop)\(/,
      );
      expect(src, `${file} pushes to availableScriptIds`).not.toMatch(
        /availableScriptIds[\s\S]*?\.(push|splice|pop)\(/,
      );
    }
  });

  it("forecast-only invariant — no SP10A source compares estimatedUsd against literals or contains budget-throw classes", () => {
    for (const file of costSources) {
      const src = readFileSync(file, "utf8");
      // Strip line-comments before matching (SP5 codeOnly precedent — comments
      // mentioning the anti-pattern do not themselves trigger).
      const codeOnly = src
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      expect(codeOnly, `${file} contains budget-style throw class`).not.toMatch(
        /throw\s+new\s+\w*(?:Budget|OverLimit|CostExceeded|CostBudget)\w*/i,
      );
      expect(codeOnly, `${file} compares estimatedUsd against a literal`).not.toMatch(
        /estimatedUsd\s*(?:<=?|>=?|==|!=)/,
      );
    }
  });

  it("forbidden imports — SP10A source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of costSources) {
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

  it("single-currency lock — pcd-cost-forecast.ts schema declares currency: z.literal('USD')", () => {
    // Schemas live outside the COST_DIR; read the schemas package file directly.
    // Path resolution: cost/ -> pcd/ -> src/ -> creative-pipeline/ -> packages/
    // (4 levels up), then into schemas/src/.
    const schemaPath = join(
      COST_DIR,
      "..",
      "..",
      "..",
      "..",
      "schemas",
      "src",
      "pcd-cost-forecast.ts",
    );
    const src = readFileSync(schemaPath, "utf8");
    expect(src, "schema must lock currency to literal 'USD'").toMatch(
      /currency:\s*z\.literal\(["']USD["']\)/,
    );
  });

  it("estimator contract — cost-estimator.ts declares all five required-shape fields", () => {
    const src = readFileSync(join(COST_DIR, "cost-estimator.ts"), "utf8");
    // Catches accidental field removal in the contract.
    for (const field of ["provider", "model", "shotType", "outputIntent", "estimatorVersion"]) {
      expect(src, `cost-estimator.ts missing required field declaration: ${field}`).toContain(
        field,
      );
    }
  });

  it("SP1–SP9 source bodies are unchanged since the SP9 baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/index.ts",
      "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts",
      "packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts",
      "packages/schemas/src/pcd-cost-forecast.ts",
      "packages/schemas/src/__tests__/pcd-cost-forecast.test.ts",
      "packages/db/prisma/schema.prisma",
      // SP9 anti-pattern test was widened in this slice to allow pcd/cost/ as
      // out-of-scope for the SP1-SP8 freeze guard. Allowlisted here.
      "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts",
      // SP11 net-new schema + db files (synthetic creator foundation)
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      "packages/schemas/src/creative-brief.ts",
      "packages/schemas/src/__tests__/creative-brief.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-reader.test.ts",
      "packages/db/src/index.ts",
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
      // SP17 net-new + edits (allowlist maintenance, Task 13)
      "packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      "packages/db/prisma/schema.prisma",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md",
    ]);

    let sp9Sha = "";
    try {
      sp9Sha = execSync(
        'git log --grep="SP9 — creative-source provenance" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9.
      return;
    }
    if (sp9Sha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp9Sha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10A net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost/")) continue;
      // SP10B net-new files are out of scope (necessary maintenance — SP10A
      // test was written before SP10B territory existed; same precedent as
      // the SP9 allowlist added by SP10A for pcd/cost/).
      if (file.startsWith("packages/creative-pipeline/src/pcd/budget/")) continue;
      // SP10C net-new files are out of scope (necessary maintenance — same
      // precedent as pcd/budget/ allowlist added by SP10B).
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
      // SP13 net-new selector subdir is out of scope (necessary maintenance —
      // SP10A test was written before SP13 territory existed; same precedent
      // as pcd/cost/, pcd/budget/, pcd/cost-budget/ allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
      // SP10B widened pcd-preproduction.ts and its schema test in lock-step
      // with the schema. Allow as out-of-scope edits; SP10B's own freeze
      // test (Task 9) is the authoritative gate for SP10B-era changes.
      if (file === "packages/schemas/src/pcd-preproduction.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-preproduction.test.ts") continue;
      // SP10C widened schemas with pcd-cost-budget.ts in lock-step. Allow as
      // out-of-scope; SP10C's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-cost-budget.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-cost-budget.test.ts") continue;
      // SP13 widened schemas with pcd-synthetic-selector.ts. Allow as
      // out-of-scope; SP13's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-synthetic-selector.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts") continue;
      // SP15 net-new files are out of scope (necessary maintenance — SP10A test
      // was written before SP15 territory existed; same precedent as pcd/selector/
      // and other additive slices).
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
      if (file === "packages/schemas/src/pcd-script-template.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-script-template.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.test.ts") continue;
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      if (file.endsWith(".prisma")) continue;
      if (file.startsWith("docs/")) continue;
      // SP11 net-new subdir is out of scope (same pattern as SP10B).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-creator/")) continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      // SP12 net-new files are out of scope (same precedent as SP11).
      if (file === "packages/creative-pipeline/src/pcd/sp12-anti-patterns.test.ts") continue;
      if (file === "packages/schemas/src/creator-identity-license.ts") continue;
      if (file === "packages/schemas/src/__tests__/creator-identity-license.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-creator-identity-license-store.ts") continue;
      if (file === "packages/db/src/stores/__tests__/prisma-creator-identity-license-store.test.ts")
        continue;
      if (file === "packages/db/src/stores/prisma-creator-identity-license-reader.ts") continue;
      if (
        file === "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts"
      )
        continue;
      if (allowedEdits.has(file)) continue;
      // SP16 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP16 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      if (file === "packages/schemas/src/pcd-synthetic-router.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts") continue;
      // SP18 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP18 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-routing-provenance/"))
        continue;
      if (file === "packages/schemas/src/pcd-synthetic-routing-provenance.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-routing-provenance.test.ts")
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
      // SP20 carve-out — SP20 net-new files (performance-overlay + metrics reader).
      // See docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md §2.1 Guardrail B-1.
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
      // SP22 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP22 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/generation/")) continue;

      expect(allowedEdits.has(file), `SP10A modified disallowed file: ${file}`).toBe(true);
    }
  });
});
