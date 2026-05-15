// SP19 anti-pattern test — 10 structural + behavioral assertions.
//
// Source-freeze keyed against SP18 followup SHA 544816a. SP19 must not edit
// SP1–SP18 source bodies (Guardrail B). The freeze diff is asserted via
// `git diff` against the file list below.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

const PIPELINE_PCD_SRC = join(REPO_ROOT, "packages/creative-pipeline/src/pcd");
const SP19_SUBDIR = join(PIPELINE_PCD_SRC, "performance-snapshot");
const SCHEMAS_SRC = join(REPO_ROOT, "packages/schemas/src");
const DB_STORES = join(REPO_ROOT, "packages/db/src/stores");

const SP19_PIPELINE_FILES = [
  "performance-snapshot-version.ts",
  "performance-snapshot-version.test.ts",
  "pcd-sp19-performance-snapshot-store.ts",
  "stamp-pcd-performance-snapshot.ts",
  "stamp-pcd-performance-snapshot.test.ts",
  "write-pcd-performance-snapshot.ts",
  "write-pcd-performance-snapshot.test.ts",
  "index.ts",
  "sp19-anti-patterns.test.ts",
];

const SP19_SCHEMAS_FILES = [
  "pcd-performance-snapshot.ts",
  "__tests__/pcd-performance-snapshot.test.ts",
];

const SP19_DB_FILES = [
  "prisma-pcd-performance-snapshot-store.ts",
  "prisma-pcd-performance-snapshot-reader.ts",
  "__tests__/prisma-pcd-performance-snapshot-store.test.ts",
  "__tests__/prisma-pcd-performance-snapshot-reader.test.ts",
];

// Frozen file list: every non-test PCD-relevant .ts file committed at SHA 544816a.
// Regenerated via:
//   git ls-tree -r --name-only 544816a -- \
//     packages/schemas/src packages/creative-pipeline/src/pcd packages/db/src/stores \
//     | grep -E "\.ts$" | grep -v "\.test\.ts$" | grep -v "__tests__" \
//     | grep -v "^packages/schemas/src/index.ts$" \
//     | grep -v "^packages/creative-pipeline/src/index.ts$" \
//     | sort
// `packages/schemas/src/index.ts` is excluded (barrel widened by Task 2 of SP19).
// `packages/creative-pipeline/src/index.ts` is excluded (barrel re-export added by Task 11 of SP19).
// Source-freeze diff against this list must be EMPTY at HEAD.
const FROZEN_FILES = [
  "packages/creative-pipeline/src/pcd/approval-advancement.ts",
  "packages/creative-pipeline/src/pcd/approval-lifecycle-version.ts",
  "packages/creative-pipeline/src/pcd/budget/index.ts",
  "packages/creative-pipeline/src/pcd/budget/run-identity-aware-preproduction-chain-with-budget.ts",
  "packages/creative-pipeline/src/pcd/budget/sp10b-budget-reader.ts",
  "packages/creative-pipeline/src/pcd/budget/static-default-budget-reader.ts",
  "packages/creative-pipeline/src/pcd/budget/tree-budget-exceeded-error.ts",
  "packages/creative-pipeline/src/pcd/budget/tree-budget-version.ts",
  "packages/creative-pipeline/src/pcd/budget/tree-shape-validator.ts",
  "packages/creative-pipeline/src/pcd/compliance-check.ts",
  "packages/creative-pipeline/src/pcd/consent-pre-check-edit.ts",
  "packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts",
  "packages/creative-pipeline/src/pcd/consent-revocation-error.ts",
  "packages/creative-pipeline/src/pcd/consent-revocation-version.ts",
  "packages/creative-pipeline/src/pcd/consent-revocation.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/coarse-cost-estimator.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/cost-budget-exceeded-error.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/cost-budget-validator.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/cost-budget-version.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/index.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/run-identity-aware-preproduction-chain-with-cost-budget.ts",
  "packages/creative-pipeline/src/pcd/cost-budget/stub-coarse-cost-estimator.ts",
  "packages/creative-pipeline/src/pcd/cost/cost-estimator.ts",
  "packages/creative-pipeline/src/pcd/cost/cost-forecast-version.ts",
  "packages/creative-pipeline/src/pcd/cost/index.ts",
  "packages/creative-pipeline/src/pcd/cost/pcd-sp10-identity-snapshot-store.ts",
  "packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts",
  "packages/creative-pipeline/src/pcd/cost/stub-cost-estimator.ts",
  "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
  "packages/creative-pipeline/src/pcd/disclosure/disclosure-placeholder.ts",
  "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver-version.ts",
  "packages/creative-pipeline/src/pcd/disclosure/disclosure-resolver.ts",
  "packages/creative-pipeline/src/pcd/disclosure/disclosure-seed.ts",
  "packages/creative-pipeline/src/pcd/disclosure/index.ts",
  "packages/creative-pipeline/src/pcd/export-gate-state.ts",
  "packages/creative-pipeline/src/pcd/final-export-gate.ts",
  "packages/creative-pipeline/src/pcd/invariant-violation-error.ts",
  "packages/creative-pipeline/src/pcd/lifecycle-readers.ts",
  "packages/creative-pipeline/src/pcd/meta-draft-gate.ts",
  "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts",
  "packages/creative-pipeline/src/pcd/preproduction/build-pcd-identity-context.ts",
  "packages/creative-pipeline/src/pcd/preproduction/deep-freeze.ts",
  "packages/creative-pipeline/src/pcd/preproduction/identity-context-version.ts",
  "packages/creative-pipeline/src/pcd/preproduction/index.ts",
  "packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-error.ts",
  "packages/creative-pipeline/src/pcd/preproduction/preproduction-chain-version.ts",
  "packages/creative-pipeline/src/pcd/preproduction/preproduction-chain.ts",
  "packages/creative-pipeline/src/pcd/preproduction/preproduction-fanout-version.ts",
  "packages/creative-pipeline/src/pcd/preproduction/production-fanout-gate.ts",
  "packages/creative-pipeline/src/pcd/preproduction/sp7-readers.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/creator-scripts-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/hooks-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/motivators-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/stub-creator-scripts-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/stub-hooks-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/stub-motivators-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/stub-trends-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/preproduction/stages/trends-stage-runner.ts",
  "packages/creative-pipeline/src/pcd/provenance/index.ts",
  "packages/creative-pipeline/src/pcd/provenance/pcd-sp9-identity-snapshot-store.ts",
  "packages/creative-pipeline/src/pcd/provenance/provenance-version.ts",
  "packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts",
  "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
  "packages/creative-pipeline/src/pcd/provider-capability-matrix.ts",
  "packages/creative-pipeline/src/pcd/provider-router.ts",
  "packages/creative-pipeline/src/pcd/qc-aggregator.ts",
  "packages/creative-pipeline/src/pcd/qc-evaluation-version.ts",
  "packages/creative-pipeline/src/pcd/qc-evaluator.ts",
  "packages/creative-pipeline/src/pcd/qc-face-similarity.ts",
  "packages/creative-pipeline/src/pcd/qc-gate-matrix.ts",
  "packages/creative-pipeline/src/pcd/qc-geometry.ts",
  "packages/creative-pipeline/src/pcd/qc-logo-similarity.ts",
  "packages/creative-pipeline/src/pcd/qc-ocr-match.ts",
  "packages/creative-pipeline/src/pcd/qc-providers.ts",
  "packages/creative-pipeline/src/pcd/registry-backfill.ts",
  "packages/creative-pipeline/src/pcd/registry-resolver.ts",
  "packages/creative-pipeline/src/pcd/script/index.ts",
  "packages/creative-pipeline/src/pcd/script/script-placeholder.ts",
  "packages/creative-pipeline/src/pcd/script/script-seed.ts",
  "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
  "packages/creative-pipeline/src/pcd/script/script-selector.ts",
  "packages/creative-pipeline/src/pcd/selector/index.ts",
  "packages/creative-pipeline/src/pcd/selector/selector-version.ts",
  "packages/creative-pipeline/src/pcd/selector/selector.ts",
  "packages/creative-pipeline/src/pcd/shot-spec-version.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/index.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/license-gate.ts",
  "packages/creative-pipeline/src/pcd/synthetic-creator/seed.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/index.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
  "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/index.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/pcd-sp18-identity-snapshot-store.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/stamp-pcd-synthetic-routing-decision.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/synthetic-routing-provenance-version.ts",
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance/write-pcd-identity-snapshot-with-synthetic-routing.ts",
  "packages/creative-pipeline/src/pcd/tier-policy.ts",
  "packages/creative-pipeline/src/pcd/tier3-routing-rules.ts",
  "packages/db/src/stores/prisma-asset-record-reader.ts",
  "packages/db/src/stores/prisma-consent-record-reader.ts",
  "packages/db/src/stores/prisma-consent-record-store.ts",
  "packages/db/src/stores/prisma-consent-revocation-store.ts",
  "packages/db/src/stores/prisma-creative-job-reader.ts",
  "packages/db/src/stores/prisma-creative-job-store.ts",
  "packages/db/src/stores/prisma-creator-identity-license-reader.ts",
  "packages/db/src/stores/prisma-creator-identity-license-store.ts",
  "packages/db/src/stores/prisma-creator-identity-reader.ts",
  "packages/db/src/stores/prisma-creator-identity-store.ts",
  "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
  "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
  "packages/db/src/stores/prisma-disclosure-template-reader.ts",
  "packages/db/src/stores/prisma-pcd-identity-snapshot-reader.ts",
  "packages/db/src/stores/prisma-pcd-identity-snapshot-store.ts",
  "packages/db/src/stores/prisma-pcd-qc-result-store.ts",
  "packages/db/src/stores/prisma-product-identity-store.ts",
  "packages/db/src/stores/prisma-product-qc-result-reader.ts",
  "packages/db/src/stores/prisma-script-template-reader.ts",
  "packages/schemas/src/creative-brief.ts",
  "packages/schemas/src/creative-job.ts",
  "packages/schemas/src/creator-identity-license.ts",
  "packages/schemas/src/creator-identity-synthetic.ts",
  "packages/schemas/src/creator-identity.ts",
  "packages/schemas/src/pcd-cost-budget.ts",
  "packages/schemas/src/pcd-cost-forecast.ts",
  "packages/schemas/src/pcd-disclosure-template.ts",
  "packages/schemas/src/pcd-identity.ts",
  "packages/schemas/src/pcd-preproduction.ts",
  "packages/schemas/src/pcd-provenance.ts",
  "packages/schemas/src/pcd-script-template.ts",
  "packages/schemas/src/pcd-synthetic-router.ts",
  "packages/schemas/src/pcd-synthetic-routing-provenance.ts",
  "packages/schemas/src/pcd-synthetic-selector.ts",
  "packages/schemas/src/pcd-tier-policy.ts",
];

function readSp19SourceText(): string {
  let acc = "";
  for (const f of SP19_PIPELINE_FILES) {
    if (!f.endsWith(".ts")) continue;
    if (f.endsWith(".test.ts")) continue;
    acc += "\n" + readFileSync(join(SP19_SUBDIR, f), "utf8");
  }
  for (const f of SP19_SCHEMAS_FILES) {
    if (f.startsWith("__tests__")) continue;
    acc += "\n" + readFileSync(join(SCHEMAS_SRC, f), "utf8");
  }
  for (const f of SP19_DB_FILES) {
    if (f.startsWith("__tests__")) continue;
    acc += "\n" + readFileSync(join(DB_STORES, f), "utf8");
  }
  return acc;
}

describe("SP19 anti-patterns", () => {
  it("#1 — sole literal site for pcd-performance-snapshot@", () => {
    const out = execSync(
      `grep -rl 'pcd-performance-snapshot@' packages --include='*.ts' --exclude='*.test.ts'`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((p) => p.length > 0);
    expect(out).toEqual([
      "packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts",
    ]);
  });

  it("#2 — sole runtime import site for PCD_PERFORMANCE_SNAPSHOT_VERSION", () => {
    const out = execSync(
      `grep -rl 'PCD_PERFORMANCE_SNAPSHOT_VERSION' packages --include='*.ts' --exclude='*.test.ts'`,
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter((p) => p.length > 0);
    expect(new Set(out)).toEqual(
      new Set([
        "packages/creative-pipeline/src/pcd/performance-snapshot/performance-snapshot-version.ts",
        "packages/creative-pipeline/src/pcd/performance-snapshot/stamp-pcd-performance-snapshot.ts",
        "packages/creative-pipeline/src/pcd/performance-snapshot/index.ts",
      ]),
    );
  });

  it("#3 — no crypto import anywhere in SP19 source", () => {
    const text = readSp19SourceText();
    expect(text).not.toMatch(/from\s+["']node:crypto["']/);
    expect(text).not.toMatch(/require\(["']node:crypto["']\)/);
    expect(text).not.toMatch(/\bcrypto\.createHash\b/);
  });

  it("#4 — no @prisma/client or @creativeagent/db import in the SP19 pipeline subdir", () => {
    for (const f of SP19_PIPELINE_FILES) {
      if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
      const text = readFileSync(join(SP19_SUBDIR, f), "utf8");
      expect(text, `file ${f} must not import @prisma/client`).not.toMatch(
        /from\s+["']@prisma\/client["']/,
      );
      expect(text, `file ${f} must not import @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
    }
  });

  it("#5 — PcdIdentitySnapshot + ProductQcResult database columns unchanged; AssetRecord adds opposite-relation only", () => {
    const schema = readFileSync(join(REPO_ROOT, "packages/db/prisma/schema.prisma"), "utf8");

    expect(schema).toMatch(/syntheticRoutingDecisionReason\s+Json\?/);
    expect(schema).toMatch(/videoProviderChoice\s+String\?/);
    expect(schema).toMatch(/promptHash\s+String\?/);

    expect(schema).toMatch(/identityDriftScore\s+Float\?/);
    expect(schema).toMatch(/consentRevokedAfterGeneration\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/identitySnapshot\s+PcdIdentitySnapshot\?/);
    expect(schema).toMatch(/performanceSnapshot\s+PcdPerformanceSnapshot\?/);

    expect(schema).toMatch(/qcEvaluationVersion\s+String\?/);
    expect(schema).toMatch(/qcGateMatrixVersion\s+String\?/);
    expect(schema).toMatch(/gateVerdicts\s+Json\?/);

    const migDir = execSync(
      "ls packages/db/prisma/migrations | grep pcd_performance_snapshot_sp19",
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    const migSql = readFileSync(
      join(REPO_ROOT, "packages/db/prisma/migrations", migDir, "migration.sql"),
      "utf8",
    );
    expect(migSql).not.toMatch(/ALTER\s+TABLE\s+"?AssetRecord"?/i);
  });

  it("#6 — PcdIdentitySnapshotSchema in pcd-identity.ts unchanged (no SP19 widen)", () => {
    const text = readFileSync(join(SCHEMAS_SRC, "pcd-identity.ts"), "utf8");
    expect(text).not.toMatch(/performanceSnapshotVersion/);
    expect(text).not.toMatch(/actualCostUsd/);
    expect(text).not.toMatch(/terminalKind/);
  });

  it("#7 — SP13 metricsSnapshotVersion stays z.null() (SP20's job to widen)", () => {
    const text = readFileSync(join(SCHEMAS_SRC, "pcd-synthetic-selector.ts"), "utf8");
    expect(text).toMatch(/metricsSnapshotVersion:\s*z\.null\(\)/);
    expect(text).not.toMatch(/metricsSnapshotVersion:\s*z\.string\(\)/);
  });

  it("#8 — SP1-SP18 source-body freeze (diff against 544816a is empty)", () => {
    const fileArgs = FROZEN_FILES.map((f) => `"${f}"`).join(" ");
    const diff = execSync(`git diff 544816a -- ${fileArgs}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(diff.trim(), "SP1-SP18 source bodies must be unchanged from 544816a").toBe("");
  });

  it("#9 — stamper purity: no Date.now(), no Math.random(), no inngest, no node:fs|http|https|crypto", () => {
    const text = readFileSync(join(SP19_SUBDIR, "stamp-pcd-performance-snapshot.ts"), "utf8");
    expect(text).not.toMatch(/Date\.now\(\)/);
    expect(text).not.toMatch(/Math\.random\(\)/);
    expect(text).not.toMatch(/from\s+["']inngest["']/);
    expect(text).not.toMatch(/from\s+["']node:(fs|http|https|crypto)["']/);
    expect(text).not.toMatch(/from\s+["']@prisma\/client["']/);
  });

  it("#10 — writer composes the stamper (positive assertion)", () => {
    const text = readFileSync(join(SP19_SUBDIR, "write-pcd-performance-snapshot.ts"), "utf8");
    expect(text).toMatch(/import\s+\{[^}]*\bstampPcdPerformanceSnapshot\b[^}]*\}/);
    expect(text).toMatch(/\bstampPcdPerformanceSnapshot\s*\(/);
    expect(text).toMatch(/\.createForAssetRecord\s*\(/);
  });
});
