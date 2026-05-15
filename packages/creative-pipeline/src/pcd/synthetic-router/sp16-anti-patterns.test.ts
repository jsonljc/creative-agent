// SP16 anti-pattern grep tests. These guard against:
//   1. Single-source router-version pin ("pcd-synthetic-router@1.1.0"
//      appears in exactly one non-test source file:
//      synthetic-router-version.ts).
//   2. Single-source pairing-version pin ("pcd-synthetic-provider-pairing@1.1.0"
//      appears in exactly one non-test source file:
//      synthetic-provider-pairing.ts).
//   3. Router purity (no Date.now, no new Date, no Math.random, no
//      @creativeagent/db, no @prisma/client, no inngest, no node:fs|http|https,
//      no crypto). Tighter than SP10C (no clock pull at all).
//   4. No SP4-internals leakage in the pipeline-side router. Allowed SP4
//      symbols: routePcdShot, ApprovedCampaignContext, ProviderRouterStores.
//      Forbidden: PCD_PROVIDER_CAPABILITY_MATRIX, Tier3Rule, requiresFirstLastFrameAnchor,
//      requiresPerformanceTransfer, requiresEditOverRegenerate, tier3-routing-rules,
//      supportsFirstLastFrame, supportsEditExtend, supportsPerformanceTransfer,
//      capabilityRefIndex, buildSelectionRationale, tier3RulesApplied. The
//      schemas-side pcd-synthetic-router.ts is OUT of scope here because
//      PcdRoutingDecisionSchema legitimately mirrors SP4's contract.
//   5. No cross-slice token leakage in pcd/synthetic-router/ sources.
//      `creatorIdentityId` and `syntheticIdentity` are explicitly allowed
//      (SP11 concepts; SP16 takes them as input parameters).
//   6. Frozen SP1-SP15 source bodies (allowlist edits only) — keyed against 9dca008.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PCD_SYNTHETIC_PROVIDER_PAIRING } from "./synthetic-provider-pairing.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const ROUTER_DIR = path.join(REPO_ROOT, "packages/creative-pipeline/src/pcd/synthetic-router");
const ROUTER_VERSION_PATH = path.join(ROUTER_DIR, "synthetic-router-version.ts");
const PAIRING_PATH = path.join(ROUTER_DIR, "synthetic-provider-pairing.ts");
const ROUTER_PATH = path.join(ROUTER_DIR, "route-synthetic-pcd-shot.ts");

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

describe("SP16 anti-patterns", () => {
  it('PCD_SYNTHETIC_ROUTER_VERSION literal "pcd-synthetic-router@1.1.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-router@1\\.1\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      ),
    ).toBe(true);
  });

  it('PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION literal "pcd-synthetic-provider-pairing@1.1.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-provider-pairing@1\\.1\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source to contain the literal; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      ),
    ).toBe(true);
  });

  it("non-test pcd/synthetic-router sources are pure — no clock reads, no randomness, no I/O imports, no crypto", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
    for (const filePath of filesToScan) {
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

  it("no SP4-internals leakage in pcd/synthetic-router pipeline sources (allowed: routePcdShot, ApprovedCampaignContext, ProviderRouterStores)", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
    const FORBIDDEN_SP4_INTERNALS = [
      "PCD_PROVIDER_CAPABILITY_MATRIX",
      "Tier3Rule",
      "requiresFirstLastFrameAnchor",
      "requiresPerformanceTransfer",
      "requiresEditOverRegenerate",
      "tier3-routing-rules",
      "tier3RulesApplied",
      "supportsFirstLastFrame",
      "supportsEditExtend",
      "supportsPerformanceTransfer",
      "capabilityRefIndex",
      "buildSelectionRationale",
    ];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of FORBIDDEN_SP4_INTERNALS) {
        expect(src.includes(token), `${filePath} must not reference SP4 internal: ${token}`).toBe(
          false,
        );
      }
    }
  });

  it("no cross-slice tokens in pcd/synthetic-router source — SP13 / SP14 / SP15 / SP17+ / SP18+ / SP19+ / SP20+ all forbidden; creatorIdentityId + syntheticIdentity allowed", () => {
    const filesToScan = [ROUTER_VERSION_PATH, PAIRING_PATH, ROUTER_PATH];
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
    const FORBIDDEN_SP15 = ["ScriptSelectionDecision", "scriptTemplateId", "scriptText"];
    const FORBIDDEN_SP17_PLUS = [
      "PcdIdentitySnapshot",
      "provenance_widen",
      "promptHash",
      "sha256(",
    ];
    const FORBIDDEN_SP18_PLUS = ["PcdPerformanceSnapshot", "performance_snapshot"];
    const FORBIDDEN_SP19_PLUS = ["overlayWeight"];
    const FORBIDDEN_SP20_PLUS = ["face_descriptor", "qc_face"];
    for (const filePath of filesToScan) {
      const src = readFileSync(filePath, "utf8");
      for (const token of [
        ...FORBIDDEN_SP13,
        ...FORBIDDEN_SP14,
        ...FORBIDDEN_SP15,
        ...FORBIDDEN_SP17_PLUS,
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

  it("pairing matrix integrity v2 — kling + seedance rows, both covering 7 shot types × 4 intents", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(2);
    const providers = new Set(PCD_SYNTHETIC_PROVIDER_PAIRING.map((r) => r.videoProvider));
    expect(providers).toEqual(new Set(["kling", "seedance"]));
    const expectedShots = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.imageProvider).toBe("dalle");
      expect([...row.shotTypes].sort()).toEqual([...expectedShots].sort());
      expect([...row.outputIntents].sort()).toEqual(
        ["draft", "final_export", "meta_draft", "preview"].sort(),
      );
    }
  });

  it("SP1–SP15 source bodies are unchanged since the SP15 baseline (allowlist edits only)", () => {
    const SP15_BASELINE = "9dca008"; // SP15-on-main merge tip
    const allowedEdits = new Set([
      // SP16 net-new schema (Task 2)
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      "packages/schemas/src/index.ts",
      // SP16 net-new pipeline subdir
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/sp16-anti-patterns.test.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/index.ts",
      // SP16 barrel widening (Task 14)
      "packages/creative-pipeline/src/index.ts",
      // SP16 design + plan docs
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-sp16-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-sp16-plan.md",
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

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP15_BASELINE}`, {
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
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 13)
      if (file === "packages/creative-pipeline/src/pcd/provenance/sp9-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost/sp10a-anti-patterns.test.ts") continue;
      if (file === "packages/creative-pipeline/src/pcd/budget/sp10b-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/cost-budget/sp10c-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/selector/sp13-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/disclosure/sp14-anti-patterns.test.ts")
        continue;
      if (file === "packages/creative-pipeline/src/pcd/script/sp15-anti-patterns.test.ts") continue;
      // SP17 net-new migration is out of scope (necessary maintenance —
      // same precedent as prior subdir allowlists).
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP15_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});
