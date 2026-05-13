import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BUDGET_DIR = join(import.meta.dirname);
const PCD_DIR = join(BUDGET_DIR, "..");

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

const budgetSources = listSourceFiles(BUDGET_DIR);

describe("SP10B anti-pattern grep", () => {
  it("PCD_TREE_BUDGET_VERSION literal lives only in tree-budget-version.ts and tree-shape-validator.ts (composer-only pinning)", () => {
    const allowed = new Set([
      join(BUDGET_DIR, "tree-budget-version.ts"),
      join(BUDGET_DIR, "tree-shape-validator.ts"),
    ]);
    for (const file of budgetSources) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} contains PCD_TREE_BUDGET_VERSION literal`).not.toMatch(
        /"pcd-tree-budget@/,
      );
    }
    // Sanity — tree-budget-version.ts itself does contain the literal.
    expect(readFileSync(join(BUDGET_DIR, "tree-budget-version.ts"), "utf8")).toContain(
      '"pcd-tree-budget@1.0.0"',
    );
  });

  it("throw-not-mutate selection — no SP10B source mutates selectedScriptIds or availableScriptIds", () => {
    for (const file of budgetSources) {
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

  it("throw discipline — orchestrator file DOES contain `throw new TreeBudgetExceededError`", () => {
    const orchestrator = readFileSync(
      join(BUDGET_DIR, "run-identity-aware-preproduction-chain-with-budget.ts"),
      "utf8",
    );
    expect(orchestrator).toMatch(/throw\s+new\s+TreeBudgetExceededError\(/);
  });

  it("forbidden imports — SP10B source must not import db, prisma, inngest, node:fs/http/https, crypto", () => {
    for (const file of budgetSources) {
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

  it("schema slot widening — pcd-preproduction.ts contains `maxEstimatedUsd: z.number().positive().nullable()`", () => {
    const schemaPath = join(
      BUDGET_DIR,
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

  it("maxEstimatedUsd === null invariant — orchestrator throws InvariantViolationError on non-null", () => {
    const orchestrator = readFileSync(
      join(BUDGET_DIR, "run-identity-aware-preproduction-chain-with-budget.ts"),
      "utf8",
    );
    // Both pieces must be present — the comparison and the throw.
    expect(orchestrator).toMatch(/budget\.maxEstimatedUsd\s*!==\s*null/);
    expect(orchestrator).toMatch(/throw\s+new\s+InvariantViolationError/);
  });

  it("reader contract immutability — sp10b-budget-reader.ts declares all required-shape fields", () => {
    const src = readFileSync(join(BUDGET_DIR, "sp10b-budget-reader.ts"), "utf8");
    for (const field of ["briefId", "organizationId", "resolveBudget"]) {
      expect(src, `sp10b-budget-reader.ts missing required field: ${field}`).toContain(field);
    }
  });

  it("validation priority lock — observedTreeSize is checked BEFORE budget.maxBranchFanout", () => {
    const src = readFileSync(join(BUDGET_DIR, "tree-shape-validator.ts"), "utf8");
    // Strip line-comments (SP5 codeOnly precedent) so doc-comments mentioning
    // either symbol do not trigger the assertion.
    const codeOnly = src
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    const sizeIdx = codeOnly.search(/observedTreeSize\s*>\s*budget\.maxTreeSize/);
    const fanoutIdx = codeOnly.search(/budget\.maxBranchFanout/);
    expect(sizeIdx, "observedTreeSize check must appear in source").toBeGreaterThan(-1);
    expect(fanoutIdx, "budget.maxBranchFanout reference must appear in source").toBeGreaterThan(-1);
    expect(
      sizeIdx,
      "validation priority lock — observedTreeSize > budget.maxTreeSize must come before budget.maxBranchFanout",
    ).toBeLessThan(fanoutIdx);
  });

  it("SP1–SP10A source bodies are unchanged since the SP10A baseline (allowlist edits only)", () => {
    const allowedEdits = new Set([
      "packages/creative-pipeline/src/index.ts",
      "packages/schemas/src/index.ts",
      "packages/schemas/src/pcd-preproduction.ts",
      "packages/schemas/src/__tests__/pcd-preproduction.test.ts",
      // SP10C added pcd-cost-budget schema in lock-step. Allow as out-of-scope;
      // SP10C's own freeze test is the authoritative gate.
      "packages/schemas/src/pcd-cost-budget.ts",
      "packages/schemas/src/__tests__/pcd-cost-budget.test.ts",
      // SP9 + SP10A anti-pattern tests were widened in this slice to allowlist
      // pcd/budget/ — necessary maintenance per the SP10A precedent that
      // widened the SP9 anti-pattern test to allowlist pcd/cost/.
      "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts",
      // SP11 net-new schema + db files (synthetic creator foundation)
      "packages/schemas/src/index.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      "packages/schemas/src/creative-brief.ts",
      "packages/schemas/src/__tests__/creative-brief.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-reader.test.ts",
      "packages/db/src/index.ts",
      "packages/db/prisma/schema.prisma",
    ]);

    let sp10aSha = "";
    try {
      sp10aSha = execSync(
        'git log --grep="SP10 — cost-forecast wiring" --max-count=1 --format=%H',
        { encoding: "utf8" },
      ).trim();
    } catch {
      // Shallow clones may not have history. Skip the structural assertion;
      // it is enforced locally before merge. Same accommodation as SP7/SP9/SP10A.
      return;
    }
    if (sp10aSha === "") return;

    let changed: string[] = [];
    try {
      changed = execSync(`git diff --name-only ${sp10aSha} HEAD`, { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
    } catch {
      return;
    }

    for (const file of changed) {
      // SP10B net-new files are out of scope.
      if (file.startsWith("packages/creative-pipeline/src/pcd/budget/")) continue;
      // SP10C net-new files are out of scope (necessary maintenance — same
      // precedent as pcd/budget/ allowlist added by SP10B to SP9/SP10A).
      if (file.startsWith("packages/creative-pipeline/src/pcd/cost-budget/")) continue;
      if (file.startsWith("docs/")) continue;
      // SP11 net-new subdir + migration are out of scope (same precedent as SP10B
      // allowlisting pcd/cost/ in SP9's test).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-creator/")) continue;
      if (file === "packages/creative-pipeline/src/pcd/sp11-anti-patterns.test.ts") continue;
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
      if (allowedEdits.has(file)) continue;

      expect(allowedEdits.has(file), `SP10B modified disallowed file: ${file}`).toBe(true);
    }
  });
});
