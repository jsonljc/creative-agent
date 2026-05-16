// SP20 anti-pattern test. Six assertions per design §6.4. Keyed to SP19
// squash SHA 1d22d61 as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "1d22d61";

const SP20_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // SP13 carve-out (Guardrail B-1).
  "packages/schemas/src/pcd-synthetic-selector.ts",
  "packages/schemas/src/__tests__/pcd-synthetic-selector.test.ts",
  "packages/creative-pipeline/src/pcd/selector/selector.ts",
  "packages/creative-pipeline/src/pcd/selector/selector.test.ts",
  // Barrel widen (Guardrail I).
  "packages/schemas/src/index.ts",
  // SP20-new files (design §3.1).
  "packages/schemas/src/pcd-performance-overlay-version.ts",
  "packages/schemas/src/pcd-performance-overlay-version.test.ts",
  "packages/schemas/src/pcd-creator-performance-metrics.ts",
  "packages/schemas/src/pcd-creator-performance-metrics.test.ts",
  "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts",
  "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.test.ts",
  "packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts",
  "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
  "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.test.ts",
  "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
  "packages/db/src/stores/__tests__/prisma-pcd-creator-performance-metrics-reader.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-design.md",
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-plan.md",
  "docs/plans/2026-05-16-pcd-performance-overlay-rerank-sp20-task1-findings.md",
  // SP21 net-new files (composer, ports, seed adapter, db widen, plan docs).
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md",
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts",
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts",
  "packages/creative-pipeline/src/pcd/selector/index.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts",
  "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts",
  "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
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

function isTest(p: string): boolean {
  return p.endsWith(".test.ts") || p.endsWith(".test.tsx");
}

function isFixture(p: string): boolean {
  return p.endsWith(".fixture.ts");
}

describe("SP20 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP20 allowlist (freeze vs SP19 squash 1d22d61)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP20_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 12 may
      // modify them in a separate commit).
      if (/(sp\d+[a-c]?)-anti-patterns\.test\.ts$/.test(f)) continue;
      offenders.push(f);
    }
    expect(offenders, `Unallowlisted edits since ${FREEZE_SHA}: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it('#2 sole literal site for "pcd-performance-overlay@" — exactly one non-test source file in the schemas package', () => {
    const files = listAllSourceFiles(join(REPO_ROOT, "packages"));
    const hits: string[] = [];
    for (const f of files) {
      if (isTest(f) || isFixture(f)) continue;
      const body = readFileSync(f, "utf8");
      if (body.includes("pcd-performance-overlay@")) hits.push(relative(REPO_ROOT, f));
    }
    expect(hits).toEqual(["packages/schemas/src/pcd-performance-overlay-version.ts"]);
  });

  it("#3 bounded runtime importer allowlist for PCD_PERFORMANCE_OVERLAY_VERSION — exactly the two DB readers", () => {
    const files = listAllSourceFiles(join(REPO_ROOT, "packages"));
    const importers: string[] = [];
    for (const f of files) {
      if (isTest(f) || isFixture(f)) continue;
      if (f.endsWith("pcd-performance-overlay-version.ts")) continue; // declaring file
      const body = readFileSync(f, "utf8");
      // Strip single-line comments before searching so comment-only references
      // in pcd-creator-performance-metrics.ts / pcd-synthetic-selector.ts /
      // selector.ts do not count as real usages.
      const bodyNoComments = body
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      if (/PCD_PERFORMANCE_OVERLAY_VERSION/.test(bodyNoComments))
        importers.push(relative(REPO_ROOT, f));
    }
    expect(importers.sort()).toEqual([
      "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
      "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
    ]);
    expect(importers).not.toContain("packages/creative-pipeline/src/pcd/selector/selector.ts");
  });

  it("#4 no `crypto` imports in SP20 surface files", () => {
    const sp20Files = [
      "packages/schemas/src/pcd-performance-overlay-version.ts",
      "packages/schemas/src/pcd-creator-performance-metrics.ts",
      "packages/creative-pipeline/src/pcd/selector/build-creator-performance-metrics.fixture.ts",
      "packages/creative-pipeline/src/pcd/selector/sp20-anti-patterns.test.ts",
      "packages/db/src/stores/in-memory-pcd-creator-performance-metrics-reader.ts",
      "packages/db/src/stores/prisma-pcd-creator-performance-metrics-reader.ts",
    ];
    for (const f of sp20Files) {
      const body = readFileSync(join(REPO_ROOT, f), "utf8");
      expect(body).not.toMatch(/from\s+["']node:crypto["']/);
      expect(body).not.toMatch(/from\s+["']crypto["']/);
      expect(body).not.toMatch(/\bcreateHash\b/);
      expect(body).not.toMatch(/\brandomUUID\b/);
    }
  });

  it("#5 no SP20-dated Prisma migration (verify against pre-SP20 baseline at SHA 1d22d61)", () => {
    const migrationsDir = "packages/db/prisma/migrations";
    const baseline = execSync(`git ls-tree -r --name-only ${FREEZE_SHA} -- ${migrationsDir}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const baselineDirs = new Set<string>();
    for (const path of baseline) {
      const m = path.match(/^packages\/db\/prisma\/migrations\/([^/]+)\//);
      if (m) baselineDirs.add(m[1]!);
    }
    const current = readdirSync(join(REPO_ROOT, migrationsDir)).filter((e) =>
      statSync(join(REPO_ROOT, migrationsDir, e)).isDirectory(),
    );
    const added = current.filter((d) => !baselineDirs.has(d));
    expect(added, `SP20 must add no migrations; found: ${added.join(", ")}`).toEqual([]);
  });

  it("#6 selector.ts contains no aggregation symbols", () => {
    const body = readFileSync(
      join(REPO_ROOT, "packages/creative-pipeline/src/pcd/selector/selector.ts"),
      "utf8",
    );
    expect(body).not.toMatch(/\.reduce\(/);
    expect(body).not.toMatch(/\bpercentile\b/i);
    expect(body).not.toMatch(/\bmedian\b/i);
    expect(body).not.toMatch(/\bquantile\b/i);
    // .sort is permitted (used by `[...allowedCandidates].sort(...)`).
  });
});
