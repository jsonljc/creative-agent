// SP22 anti-pattern test. Nine assertions per design §7.
// Keyed to SP21 squash SHA ece1347 as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "ece1347";

const SP22_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // Task 3 — composer types + barrel.
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts",
  "packages/creative-pipeline/src/pcd/generation/index.ts",
  // Tasks 4-12 — composer test file.
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.test.ts",
  // Task 8 fix — helper file extraction.
  "packages/creative-pipeline/src/pcd/generation/synthesize-synthetic-pairing-snapshot.ts",
  // Task 2 + this file.
  "packages/creative-pipeline/src/pcd/generation/sp22-anti-patterns.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp22-generation-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp22-task1-verification.md",
];

function listAllSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === "dist" ||
        ent.name === ".worktrees"
      )
        continue;
      out.push(...listAllSourceFiles(p));
    } else if (ent.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) {
      out.push(p);
    }
  }
  return out;
}

const COMPOSER_PATH = join(
  REPO_ROOT,
  "packages/creative-pipeline/src/pcd/generation/compose-generation-routing.ts",
);

describe("SP22 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP22 allowlist (freeze vs SP21 squash ece1347)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP22_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 14 sweep).
      if (/(sp\d+[a-c]?)-anti-patterns\.test\.ts$/.test(f)) continue;
      offenders.push(f);
    }
    expect(offenders, `Unallowlisted edits since ${FREEZE_SHA}: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("#2 composer does not import from @creativeagent/db", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    expect(body).not.toMatch(/from\s+["']@creativeagent\/db["']/);
  });

  it("#3 composer body contains no zero-arg `new Date()` (system-clock read); derivation from input.now is permitted", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(bodyNoLineComments).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("#4 composer does not reference forbidden identifiers", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const forbidden of [
      "Inngest",
      "process.env",
      "console.log",
      "console.info",
      "fetch(",
      "selectSyntheticCreator",
      "assertConsentNotRevokedForGeneration",
      "runIdentityAwarePreproductionChain",
    ]) {
      expect(bodyNoLineComments).not.toContain(forbidden);
    }
  });

  it("#5 composer does not import from forbidden sibling dirs", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lines = body.split("\n");
    const importLines = lines.filter((line) => /^\s*import\b/.test(line));
    const forbidden = [
      /from\s+["']\.\.\/selector\//,
      /from\s+["']\.\.\/synthetic-creator\//,
      /from\s+["']\.\.\/qc-/,
      /from\s+["']\.\.\/qc-providers/,
      /from\s+["']\.\.\/consent-/,
      /from\s+["']\.\.\/performance-snapshot\//,
      /from\s+["']\.\.\/preproduction\//,
      /from\s+["']\.\.\/cost-budget\//,
    ];
    for (const pattern of forbidden) {
      for (const line of importLines) {
        expect(line, `forbidden import: ${line}`).not.toMatch(pattern);
      }
    }
  });

  it("#6 writer-call singularity: each canonical writer is imported once + invoked at exactly one call site", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const importMatches = body.match(/import\s+\{[^}]*\}\s+from\s+["'][^"']+["']/g) ?? [];
    const allImports = importMatches.join("\n");

    // Imported exactly once.
    for (const name of [
      "writePcdIdentitySnapshotWithCostForecast",
      "writePcdIdentitySnapshotWithSyntheticRouting",
    ]) {
      const importHits = (allImports.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      expect(importHits, `${name} imported ${importHits} times`).toBe(1);
    }

    // Called exactly once each. The composer file references these names as
    // STRING LITERALS too (the `writerKind` discriminator union + each Case's
    // return literal) — those are non-call references and don't count. The
    // call-site regex matches `Name(` specifically; quoted-literal references
    // (`"Name"`) are followed by a quote, not a paren, so they cannot match.
    // Note: SP10A is invoked via `return Name(` (no `await`) inside the
    // writeGenericRoute helper; SP18 is invoked via `await Name(` in Case C.
    // The structural `\bName\s*\(` pattern covers both call shapes.
    const sp10aCallSites = (body.match(/\bwritePcdIdentitySnapshotWithCostForecast\s*\(/g) ?? [])
      .length;
    const sp18CallSites = (body.match(/\bwritePcdIdentitySnapshotWithSyntheticRouting\s*\(/g) ?? [])
      .length;
    expect(
      sp10aCallSites,
      `writePcdIdentitySnapshotWithCostForecast called ${sp10aCallSites} times`,
    ).toBe(1);
    expect(
      sp18CallSites,
      `writePcdIdentitySnapshotWithSyntheticRouting called ${sp18CallSites} times`,
    ).toBe(1);

    // Forbidden writers — not imported.
    for (const forbidden of ["writePcdIdentitySnapshotWithProvenance"]) {
      expect(allImports, `${forbidden} must not be imported`).not.toContain(forbidden);
    }
    // The SP4 bare `writePcdIdentitySnapshot` is allowed to appear as a TYPE
    // import (WritePcdIdentitySnapshotInput) but not as a value reference.
    const importLines = body.split("\n").filter((l) => /^\s*import\b/.test(l));
    const valueRefBody = body
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l) && !/^\s*\/\//.test(l))
      .join("\n");
    expect(
      valueRefBody,
      "bare writePcdIdentitySnapshot must not appear in composer body",
    ).not.toMatch(/\bwritePcdIdentitySnapshot\s*\(/);
    expect(
      importLines.some((l) => /WritePcdIdentitySnapshotInput/.test(l)),
      "composer should import WritePcdIdentitySnapshotInput as a type",
    ).toBe(true);
  });

  it("#7 router-call singularity: routePcdShot + routeSyntheticPcdShot each imported once + invoked at exactly one call site", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const importMatches = body.match(/import\s+\{[^}]*\}\s+from\s+["'][^"']+["']/g) ?? [];
    const allImports = importMatches.join("\n");

    for (const name of ["routePcdShot", "routeSyntheticPcdShot"]) {
      const importHits = (allImports.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      expect(importHits, `${name} imported ${importHits} times`).toBe(1);
    }

    const routeGenericCallSites = (body.match(/await\s+routePcdShot\s*\(/g) ?? []).length;
    const routeSyntheticCallSites = (body.match(/await\s+routeSyntheticPcdShot\s*\(/g) ?? [])
      .length;
    expect(routeGenericCallSites, `routePcdShot called ${routeGenericCallSites} times`).toBe(1);
    expect(
      routeSyntheticCallSites,
      `routeSyntheticPcdShot called ${routeSyntheticCallSites} times`,
    ).toBe(1);
  });

  it("#8 PCD pinned-constant census stays at 24 (no new PCD_*_VERSION export introduced since ece1347)", () => {
    const schemasDir = "packages/schemas/src";
    const baselineFiles = execSync(`git ls-tree -r --name-only ${FREEZE_SHA} -- ${schemasDir}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    const currentFiles = listAllSourceFiles(join(REPO_ROOT, schemasDir))
      .map((p) => relative(REPO_ROOT, p))
      .filter((p) => /pcd-[a-z0-9-]+-version\.ts$/.test(p) && !p.endsWith(".test.ts"));

    expect(currentFiles.sort()).toEqual(baselineFiles.sort());
  });

  it("#9 composer file size under 300 lines", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lineCount = body.split("\n").length;
    expect(lineCount, `composer is ${lineCount} lines`).toBeLessThan(300);
  });
});
