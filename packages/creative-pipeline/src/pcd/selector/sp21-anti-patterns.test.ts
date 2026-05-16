// SP21 anti-pattern test. Six assertions per design §7.4 + plan Task 12.
// Keyed to SP20 squash SHA 06ba0ac as the freeze baseline.

import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const FREEZE_SHA = "06ba0ac";

const SP21_ALLOWLISTED_EDITS: ReadonlyArray<string> = [
  // Task 2 — lease reader new method + test.
  "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
  "packages/db/src/stores/__tests__/prisma-creator-identity-license-reader.test.ts",
  // Task 3 — ports + synthetic-creator barrel widen.
  "packages/creative-pipeline/src/pcd/synthetic-creator/synthetic-creator-selection-ports.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts",
  // Task 4 — seed adapter + test.
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/sp11-seed-synthetic-creator-roster-reader.test.ts",
  // Tasks 5–6 — composer + test + selector barrel widen.
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts",
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.test.ts",
  "packages/creative-pipeline/src/pcd/selector/index.ts",
  // This file.
  "packages/creative-pipeline/src/pcd/selector/sp21-anti-patterns.test.ts",
  // Plan docs.
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-design.md",
  "docs/plans/2026-05-16-pcd-sp21-synthetic-selector-composer-plan.md",
  "docs/plans/2026-05-16-pcd-sp21-task1-schema-verification.md",
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
  "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts",
);

describe("SP21 anti-patterns", () => {
  it("#1 no source-body edits beyond the SP21 allowlist (freeze vs SP20 squash 06ba0ac)", () => {
    const changed = execSync(`git diff --name-only ${FREEZE_SHA}..HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const offenders: string[] = [];
    for (const f of changed) {
      if (SP21_ALLOWLISTED_EDITS.includes(f)) continue;
      // Prior anti-pattern test allowlist edits are permitted (Task 13 may
      // modify them in a separate commit).
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
    // Strip line comments before searching so the file's header comment block
    // does not produce false positives.
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    // Bans the zero-argument `new Date()` constructor — a system-clock leak.
    // The prescribed `new Date(input.now.getTime() - …)` derivation form is
    // permitted because it carries no fresh wall-clock read.
    expect(bodyNoLineComments).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("#4 composer does not reference forbidden PCD subsystems (snapshot writer, router, QC, consent, Inngest, env)", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const bodyNoLineComments = body
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const forbidden of [
      "PcdIdentitySnapshot",
      "routePcdShot",
      "qcEvaluator",
      "consentPreCheck",
      "syntheticRouter",
      "Inngest",
      "process.env",
    ]) {
      expect(bodyNoLineComments).not.toContain(forbidden);
    }
  });

  it("#5 composer does not import from forbidden sibling dirs (provider-router, synthetic-router, qc-, consent-, snapshot writer, performance-snapshot)", () => {
    const body = readFileSync(COMPOSER_PATH, "utf8");
    const lines = body.split("\n");
    const importLines = lines.filter((line) => /^\s*import\b/.test(line));
    const forbidden = [
      /from\s+["']\.\.\/provider-router/,
      /from\s+["']\.\.\/synthetic-router\//,
      /from\s+["']\.\.\/qc-/,
      /from\s+["']\.\.\/consent-/,
      /from\s+["']\.\.\/pcd-identity-snapshot-/,
      /from\s+["']\.\.\/performance-snapshot\//,
    ];
    for (const pattern of forbidden) {
      for (const line of importLines) {
        expect(line, `forbidden import: ${line}`).not.toMatch(pattern);
      }
    }
  });

  it("#6 PCD pinned-constant census stays at 24 (no new PCD_*_VERSION export introduced since 06ba0ac)", () => {
    // SP21 introduces NO new pinned constant. This check enforces that no
    // new `pcd-*-version.ts` file appears in the schemas package since the
    // freeze baseline. The full 24-constant census also includes versions
    // declared in @creativeagent/creative-pipeline; this assertion narrowly
    // guards the schemas-package surface so SP21 cannot land a stealth
    // constant in the layer that the composer is allowed to import from.
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
});
