// SP15 anti-pattern grep tests. These guard against:
//   1. Single-source version pinning (literal "pcd-script-selector@1.0.0"
//      appears in exactly one non-test source file: script-selector-version.ts)
//   2. Single-source placeholder prefix ("[SCRIPT_PENDING_CREATIVE_REVIEW:"
//      appears in exactly one non-test source file: script-placeholder.ts)
//   3. Selector purity (no Date.now, no new Date, no Math.random, no
//      @creativeagent/db, no @prisma/client, no inngest, no node:fs|http|https,
//      no crypto). Unlike SP14, SP15's seed has no `new Date(...)` literal
//      because there are no effective-window columns.
//   4. No-wildcard guarantee on seed values — id, vibe, treatmentClass, text,
//      and every entry of compatibleCreatorIdentityIds (programmatic, not source grep)
//   5. No cross-slice tokens — SP13 selection-decision shape, SP14 decision shape,
//      SP16+/SP18+/SP19+/SP20+ tokens all forbidden. `creatorIdentityId` and
//      `selectorVersion` are explicitly allowed (SP15 has its own input field
//      and decision-struct field by those names).
//   6. Frozen SP1-SP14 source bodies (allowlist edits only) — keyed against 43cfdcd
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIPT_TEMPLATE_SEED } from "./script-seed.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const SCRIPT_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/script");
const VERSION_PATH = path.join(SCRIPT_DIR, "script-selector-version.ts");
const PLACEHOLDER_PATH = path.join(SCRIPT_DIR, "script-placeholder.ts");
const SELECTOR_PATH = path.join(SCRIPT_DIR, "script-selector.ts");
const SEED_PATH = path.join(SCRIPT_DIR, "script-seed.ts");

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

describe("SP15 anti-patterns", () => {
  it('PCD_SCRIPT_SELECTOR_VERSION literal "pcd-script-selector@1.0.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-script-selector@1\\.0\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has("packages/creative-pipeline/src/pcd/script/script-selector-version.ts"),
    ).toBe(true);
  });

  it('PLACEHOLDER_SCRIPT_PREFIX literal "[SCRIPT_PENDING_CREATIVE_REVIEW:" lives in exactly one non-test source file', () => {
    const hits = grepFiles("\\[SCRIPT_PENDING_CREATIVE_REVIEW:", "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(uniquePaths.has("packages/creative-pipeline/src/pcd/script/script-placeholder.ts")).toBe(
      true,
    );
  });

  it("non-test pcd/script sources are pure — no clock reads, no randomness, no I/O imports", () => {
    const filesToScan = [VERSION_PATH, PLACEHOLDER_PATH, SELECTOR_PATH, SEED_PATH];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      expect(src, filePath).not.toMatch(/Date\.now\(\)/);
      expect(src, filePath).not.toMatch(/new\s+Date\(/);
      expect(src, filePath).not.toMatch(/Math\.random\(/);
      expect(src, filePath).not.toMatch(/from\s+["']@creativeagent\/db["']/);
      expect(src, filePath).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, filePath).not.toMatch(/from\s+["']inngest["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:http["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:https["']/);
      expect(src, filePath).not.toMatch(/from\s+["']crypto["']/);
      expect(src, filePath).not.toMatch(/from\s+["']node:crypto["']/);
      expect(src, filePath).not.toMatch(/PrismaClient/);
    }
  });

  it("seed values contain no wildcard tokens (programmatic — id / vibe / treatmentClass / text / compatibleCreatorIdentityIds)", () => {
    const WILDCARDS = /\b(default|catch_all|wildcard|global|fallback)\b/;
    for (const r of SCRIPT_TEMPLATE_SEED) {
      for (const [field, value] of Object.entries({
        id: r.id,
        vibe: r.vibe,
        treatmentClass: r.treatmentClass,
        text: r.text,
      })) {
        expect(value, `wildcard token in seed ${field}: ${value}`).not.toMatch(WILDCARDS);
      }
      for (const cid of r.compatibleCreatorIdentityIds) {
        expect(
          cid,
          `wildcard token in seed compatibleCreatorIdentityIds entry: ${cid}`,
        ).not.toMatch(WILDCARDS);
        // Reinforces the zod refine; defense in depth at the seed value layer.
        expect(cid).not.toBe("*");
      }
    }
  });

  it("no cross-slice tokens in pcd/script source — SP13 / SP14 / SP16+ / SP18+ / SP19+ / SP20+ all forbidden; creatorIdentityId + selectorVersion allowed", () => {
    const filesToScan = [VERSION_PATH, PLACEHOLDER_PATH, SELECTOR_PATH, SEED_PATH];
    const FORBIDDEN_SP13 = [
      "SyntheticCreatorSelectionDecision",
      "selectedCreatorIdentityId",
      "fallbackCreatorIdentityIds",
      "selectorRank",
      "metricsSnapshotVersion",
      "performanceOverlayApplied",
    ];
    const FORBIDDEN_SP14 = [
      "DisclosureResolutionDecision",
      "disclosureTemplateId",
      "resolverVersion",
    ];
    const FORBIDDEN_SP16_PLUS = ["provider_routing", "RoutingDecision"];
    const FORBIDDEN_SP18_PLUS = ["PcdPerformanceSnapshot", "performance_snapshot"];
    const FORBIDDEN_SP19_PLUS = ["overlayWeight"];
    const FORBIDDEN_SP20_PLUS = ["face_descriptor", "qc_face"];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of [
        ...FORBIDDEN_SP13,
        ...FORBIDDEN_SP14,
        ...FORBIDDEN_SP16_PLUS,
        ...FORBIDDEN_SP18_PLUS,
        ...FORBIDDEN_SP19_PLUS,
        ...FORBIDDEN_SP20_PLUS,
      ]) {
        expect(
          src.includes(token),
          `${filePath} must not reference cross-slice token: ${token}`,
        ).toBe(false);
      }
    }
  });

  it("SP1–SP14 source bodies are unchanged since the SP14 baseline (allowlist edits only)", () => {
    const SP14_BASELINE = "43cfdcd"; // SP14-on-main merge tip
    const allowedEdits = new Set([
      // SP15 net-new schema (Task 1)
      "packages/schemas/src/pcd-script-template.ts",
      "packages/schemas/src/__tests__/pcd-script-template.test.ts",
      "packages/schemas/src/index.ts",
      // SP15 net-new pipeline subdir
      "packages/creative-pipeline/src/pcd/script/script-selector-version.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector-version.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.ts",
      "packages/creative-pipeline/src/pcd/script/script-placeholder.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.ts",
      "packages/creative-pipeline/src/pcd/script/script-selector.test.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.ts",
      "packages/creative-pipeline/src/pcd/script/script-seed.test.ts",
      "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/script/index.ts",
      // SP15 db reader (Task 5)
      "packages/db/src/stores/prisma-script-template-reader.ts",
      "packages/db/src/stores/prisma-script-template-reader.test.ts",
      "packages/db/src/index.ts",
      // SP15 Prisma additions (Task 4)
      "packages/db/prisma/schema.prisma",
      "packages/db/prisma/migrations/20260514160000_pcd_script_template_sp15/migration.sql",
      // SP15 barrels (Task 15)
      "packages/creative-pipeline/src/index.ts",
      // SP15 design + plan docs
      "docs/plans/2026-05-14-pcd-script-templates-sp15-design.md",
      "docs/plans/2026-05-14-pcd-script-templates-sp15-plan.md",
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
      baselineSha = execSync(`git rev-parse ${SP14_BASELINE}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      return; // shallow clone — skip
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
      if (file.startsWith("packages/creative-pipeline/src/pcd/script/")) continue;
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
      if (file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts")
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
        file ===
        "packages/creative-pipeline/src/pcd/selector/compose-synthetic-creator-selection.ts"
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
      // SP22 net-new files are out of scope (necessary maintenance — this
      // SP test was written before SP22 territory existed; same precedent
      // as prior SP allowlist additions).
      if (file.startsWith("packages/creative-pipeline/src/pcd/generation/")) continue;
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP14_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});
