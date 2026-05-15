import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COST_BUDGET_DIR = join(import.meta.dirname);
const PCD_DIR = join(COST_BUDGET_DIR, "..");

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

const costBudgetSources = listSourceFiles(COST_BUDGET_DIR);

describe("SP10C anti-pattern grep", () => {
  it("PCD_COST_BUDGET_VERSION literal lives only in cost-budget-version.ts and cost-budget-validator.ts (composer-only pinning)", () => {
    const allowed = new Set([
      join(COST_BUDGET_DIR, "cost-budget-version.ts"),
      join(COST_BUDGET_DIR, "cost-budget-validator.ts"),
    ]);
    for (const file of costBudgetSources) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_COST_BUDGET_VERSION literal`).not.toMatch(
        /"pcd-cost-budget@/,
      );
    }
    // Sanity — cost-budget-version.ts itself does contain the literal.
    expect(readFileSync(join(COST_BUDGET_DIR, "cost-budget-version.ts"), "utf8")).toContain(
      '"pcd-cost-budget@1.0.0"',
    );
  });

  it("throw-not-mutate selection — no SP10C source mutates selectedScriptIds or availableScriptIds", () => {
    for (const file of costBudgetSources) {
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

  it("throw discipline — orchestrator file DOES contain `throw new CostBudgetExceededError`", () => {
    const orchestrator = readFileSync(
      join(COST_BUDGET_DIR, "run-identity-aware-preproduction-chain-with-cost-budget.ts"),
      "utf8",
    );
    expect(orchestrator).toMatch(/throw\s+new\s+CostBudgetExceededError\(/);
  });

  it("forbidden imports — SP10C source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of costBudgetSources) {
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

  it("schema slot unchanged — PreproductionTreeBudgetSchema continues to declare `maxEstimatedUsd: z.number().positive().nullable()`", () => {
    const schemaPath = join(
      COST_BUDGET_DIR,
      "..",
      "..",
      "..",
      "..",
      "schemas",
      "src",
      "pcd-preproduction.ts",
    );
    const src = readFileSync(schemaPath, "utf8");
    expect(src, "schema must declare maxEstimatedUsd as nullable positive number").toMatch(
      /maxEstimatedUsd:\s*z\.number\(\)\.positive\(\)\.nullable\(\)/,
    );
  });

  it("SP10B invariant preserved — orchestrator file unchanged (load-bearing for SP10C structural composition)", () => {
    const sp10bOrchestrator = readFileSync(
      join(
        COST_BUDGET_DIR,
        "..",
        "budget",
        "run-identity-aware-preproduction-chain-with-budget.ts",
      ),
      "utf8",
    );
    // SP10C composes SP10B by calling it with a stripped budget. SP10B's
    // count-only assertion is what makes that composition safe. If this
    // assertion fails, someone removed SP10B's structural guard — SP10C's
    // architecture is no longer safe.
    expect(sp10bOrchestrator).toMatch(/budget\.maxEstimatedUsd\s*!==\s*null/);
    expect(sp10bOrchestrator).toMatch(/throw\s+new\s+InvariantViolationError/);
  });

  it("estimator contract immutability — coarse-cost-estimator.ts declares all required-shape fields", () => {
    const src = readFileSync(join(COST_BUDGET_DIR, "coarse-cost-estimator.ts"), "utf8");
    for (const field of [
      "briefId",
      "identityContext",
      "scriptCount",
      "estimate",
      "estimatedUsd",
      "currency",
      "lineItems",
      "estimatorVersion",
    ]) {
      expect(src, `coarse-cost-estimator.ts missing required field: ${field}`).toContain(field);
    }
  });

  it("stripMaxUsdReader invariant — SP10C orchestrator strips maxEstimatedUsd before calling SP10B", () => {
    const src = readFileSync(
      join(COST_BUDGET_DIR, "run-identity-aware-preproduction-chain-with-cost-budget.ts"),
      "utf8",
    );
    // Strip line-comments (SP5 codeOnly precedent) so doc-comments mentioning
    // `maxEstimatedUsd: null` do not trigger false positives.
    const codeOnly = src
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(
      codeOnly,
      "orchestrator code must strip maxEstimatedUsd to null before calling SP10B",
    ).toMatch(/maxEstimatedUsd:\s*null/);
  });

  it("SP1–SP10B source bodies are unchanged since the SP10B baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/schemas/src/pcd-cost-budget.ts",
      "packages/schemas/src/__tests__/pcd-cost-budget.test.ts",
      "packages/schemas/src/index.ts",
      "packages/creative-pipeline/src/index.ts",
      // SP9 + SP10A + SP10B anti-pattern tests are widened in this slice
      // to allowlist pcd/cost-budget/ — same precedent SP10B established
      // when it allowlisted pcd/budget/ in SP9 + SP10A's freeze tests.
      "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts",
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

    let sp10bSha = "";
    try {
      sp10bSha = execSync(
        'git log --grep="SP10B — tree-budget enforcement" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9/SP10A/SP10B.
      return;
    }
    if (sp10bSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp10bSha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10C net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
      // SP13 net-new selector subdir is out of scope (necessary maintenance —
      // SP10C test was written before SP13 territory existed; same precedent
      // as pcd/cost-budget/ allowlist additions in prior tests).
      if (file.startsWith("packages/creative-pipeline/src/pcd/selector/")) continue;
      if (file.startsWith("docs/")) continue;
      // SP11 net-new files are out of scope (parallel slice merged ahead of SP10C —
      // same precedent SP10B established for SP10A's pcd/cost/ allowlist).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-creator/")) continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
      if (file === "packages/schemas/src/creator-identity-synthetic.ts") continue;
      if (file === "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts") continue;
      if (file === "packages/schemas/src/creative-brief.ts") continue;
      if (file === "packages/schemas/src/__tests__/creative-brief.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts") continue;
      if (
        file === "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts"
      )
        continue;
      if (file === "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts") continue;
      if (
        file === "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-reader.test.ts"
      )
        continue;
      if (file === "packages/db/src/index.ts") continue;
      if (file === "packages/db/prisma/schema.prisma") continue;
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
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
      // SP13 widened schemas with pcd-synthetic-selector.ts. Allow as
      // out-of-scope; SP13's own freeze test is the authoritative gate.
      if (file === "packages/schemas/src/pcd-synthetic-selector.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts") continue;
      // SP15 net-new files are out of scope (necessary maintenance — SP10C test
      // was written before SP15 territory existed; same precedent as pcd/selector/
      // allowlist added by SP13).
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
      if (file === "packages/schemas/src/pcd-script-template.ts") continue;
      if (file === "packages/schemas/src/__tests__/pcd-script-template.test.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.ts") continue;
      if (file === "packages/db/src/stores/prisma-script-template-reader.test.ts") continue;
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
      // SP18 widens the db snapshot store. Allow as out-of-scope; SP18's own
      // freeze test is the authoritative gate for SP18-era changes.
      if (file === "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts") continue;
      if (file === "packages/db/src/stores/__tests__/prisma-pcd-identity-snapshot-store.test.ts")
        continue;

      expect(allowedEdits.has(file), `SP10C modified disallowed file: ${file}`).toBe(true);
    }
  });
});
