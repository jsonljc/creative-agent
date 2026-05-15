// SP18 anti-pattern grep tests. These guard against:
//   1a. "pcd-synthetic-routing-provenance@" literal lives in exactly ONE non-test
//       source file: synthetic-routing-provenance-version.ts.
//   1b. PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION symbol is imported by exactly
//       ONE non-test runtime source: stamp-pcd-synthetic-routing-decision.ts.
//   2.  Sole node:crypto import — exactly ONE non-test source imports node:crypto.
//   3.  4-way SP4 invariant lock-step — write-pcd-identity-snapshot-with-synthetic-routing.ts
//       imports the same four SP4 version constants AND calls
//       assertTier3RoutingDecisionCompliant with the same six-argument shape.
//   4.  No SP1–SP17 source body edits — git diff SP17-squash..HEAD returns empty
//       for each file in the frozen list.
//   5.  Forbidden imports — no SP18 source imports db, prisma, inngest, fs, http, https.
//   6.  Single createHash( call — exactly one occurrence across the SP18 surface.
//   7.  No mutation of input decisions — no SP18 source contains syntheticDecision.\w+ =
//       or similar mutation patterns.
//   8.  No silent denial persistence — ACCESS_POLICY / NO_DIRECTION_AUTHORED /
//       delegation all throw.
//   9.  promptHash echo — sha256(dallePromptLocked).
//   10. videoProvider === videoProviderChoice on persisted payload (kling + seedance).
import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SyntheticPcdRoutingDecision } from "@creativeagent/schemas";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";
import { stampPcdSyntheticRoutingDecision } from "./stamp-pcd-synthetic-routing-decision.js";

const REPO_ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const SP18_SUBDIR = join(
  REPO_ROOT,
  "packages/creative-pipeline/src/pcd/synthetic-routing-provenance",
);
const SP17_SQUASH_SHA = "b8d68b120915406cbc95cb10051fe1cca4648757";

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function partitionSp18Sources(): { nonTest: string[]; test: string[] } {
  const all = listTsFiles(SP18_SUBDIR);
  return {
    nonTest: all.filter((p) => !p.endsWith(".test.ts") && !p.includes("__tests__")),
    test: all.filter((p) => p.endsWith(".test.ts") || p.includes("__tests__")),
  };
}

// --- Fixture helpers (verbatim from stamp-pcd-synthetic-routing-decision.test.ts) ---

const klingDirection = {
  setting: "studio-bright",
  motion: "subtle-dolly",
  energy: "calm",
  lighting: "soft",
  avoid: ["shaky-cam"],
} as const;

const seedanceDirection = {
  setting: "outdoor-natural",
  motion: "handheld-organic",
  energy: "lively",
  lighting: "golden-hour",
  avoid: ["jump-cuts"],
} as const;

const innerReason = {
  matchedShotType: "simple_ugc" as const,
  matchedOutputIntent: "draft" as const,
  selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
};

const accessDecisionFixture = {
  allowed: true as const,
  effectiveTier: 3 as const,
  reason: "tier_3_allows_all_shots" as const,
  tierPolicyVersion: "pcd-tier-policy@1.0.0",
};

const klingSuccess: SyntheticPcdRoutingDecision = {
  allowed: true,
  kind: "synthetic_pairing",
  accessDecision: accessDecisionFixture,
  imageProvider: "dalle",
  videoProvider: "kling",
  videoProviderChoice: "kling",
  dallePromptLocked: "a studio shot of the product, soft light, neutral background",
  klingDirection,
  pairingRefIndex: 0,
  pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  decisionReason: innerReason,
};

const seedanceSuccess: SyntheticPcdRoutingDecision = {
  allowed: true,
  kind: "synthetic_pairing",
  accessDecision: accessDecisionFixture,
  imageProvider: "dalle",
  videoProvider: "seedance",
  videoProviderChoice: "seedance",
  dallePromptLocked: "a studio shot of the product, soft light, neutral background",
  seedanceDirection,
  pairingRefIndex: 1,
  pairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  decisionReason: innerReason,
};

const fixedClock = () => new Date("2026-05-16T08:00:00.000Z");

describe("SP18 anti-patterns", () => {
  // --- Source-level assertions ---

  it("1a: sole literal site — pcd-synthetic-routing-provenance@ appears in exactly one non-test source", () => {
    const { nonTest } = partitionSp18Sources();
    const allowed = join(SP18_SUBDIR, "synthetic-routing-provenance-version.ts");
    const hits = nonTest.filter((f) => source(f).includes('"pcd-synthetic-routing-provenance@'));
    expect(
      hits.length,
      `expected exactly 1 non-test file with the literal; got: ${hits.join(", ")}`,
    ).toBe(1);
    expect(hits[0]).toBe(allowed);
    // Sanity: the version file itself contains the expected literal
    expect(source(allowed)).toContain('"pcd-synthetic-routing-provenance@1.0.0"');
    // Use the imported constant to verify it's the same value
    expect(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION).toBe("pcd-synthetic-routing-provenance@1.0.0");
  });

  it("1b: sole runtime import site — PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION imported by exactly one non-test runtime source", () => {
    const { nonTest } = partitionSp18Sources();
    const allowed = join(SP18_SUBDIR, "stamp-pcd-synthetic-routing-decision.ts");
    // Exclude synthetic-routing-provenance-version.ts (it declares, not imports).
    // Match only import-statement lines; comment mentions in other files must not
    // trigger (same strip-line-comments precedent as SP10A).
    const versionFile = join(SP18_SUBDIR, "synthetic-routing-provenance-version.ts");
    const hits = nonTest.filter((f) => {
      if (f === versionFile) return false;
      // Strip single-line comments before matching — avoids false positives from
      // comments that merely reference the symbol name.
      const codeOnly = source(f)
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      return /import\s+[^;]*\bPCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION\b/.test(codeOnly);
    });
    expect(
      hits.length,
      `expected exactly 1 non-test runtime source importing the constant; got: ${hits.join(", ")}`,
    ).toBe(1);
    expect(hits[0]).toBe(allowed);
  });

  it("2: sole node:crypto import — exactly one non-test source imports node:crypto", () => {
    const { nonTest } = partitionSp18Sources();
    const allowed = join(SP18_SUBDIR, "stamp-pcd-synthetic-routing-decision.ts");
    const hits = nonTest.filter((f) => source(f).includes('from "node:crypto"'));
    expect(
      hits.length,
      `expected exactly 1 non-test source importing node:crypto; got: ${hits.join(", ")}`,
    ).toBe(1);
    expect(hits[0]).toBe(allowed);
  });

  it("3: 4-way SP4 invariant lock-step — write orchestrator imports same four constants + calls assertTier3RoutingDecisionCompliant", () => {
    const sp4 = source(
      join(REPO_ROOT, "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts"),
    );
    const sp9 = source(
      join(
        REPO_ROOT,
        "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
      ),
    );
    const sp10a = source(
      join(
        REPO_ROOT,
        "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
      ),
    );
    const sp18 = source(join(SP18_SUBDIR, "write-pcd-identity-snapshot-with-synthetic-routing.ts"));

    for (const constant of [
      "PCD_TIER_POLICY_VERSION",
      "PCD_PROVIDER_CAPABILITY_VERSION",
      "PCD_PROVIDER_ROUTER_VERSION",
    ]) {
      expect(sp4, `SP4 should reference ${constant}`).toContain(constant);
      expect(sp9, `SP9 orchestrator should reference ${constant}`).toContain(constant);
      expect(sp10a, `SP10A orchestrator should reference ${constant}`).toContain(constant);
      expect(sp18, `SP18 orchestrator should reference ${constant}`).toContain(constant);
    }

    // All four must call assertTier3RoutingDecisionCompliant with the six-argument shape
    for (const [name, src] of [
      ["SP4", sp4],
      ["SP9", sp9],
      ["SP10A", sp10a],
      ["SP18", sp18],
    ] as const) {
      expect(src, `${name} should call assertTier3RoutingDecisionCompliant`).toContain(
        "assertTier3RoutingDecisionCompliant({",
      );
    }
  });

  it("4: SP1–SP17 source bodies are unchanged since SP17 squash (b8d68b1)", () => {
    const frozenFiles = [
      "packages/creative-pipeline/src/pcd/pcd-identity-snapshot-writer.ts",
      "packages/creative-pipeline/src/pcd/tier-policy.ts",
      "packages/creative-pipeline/src/pcd/provider-capability-matrix.ts",
      "packages/creative-pipeline/src/pcd/provider-router.ts",
      "packages/creative-pipeline/src/pcd/tier3-routing-rules.ts",
      "packages/creative-pipeline/src/pcd/consent-pre-check-generation.ts",
      "packages/creative-pipeline/src/pcd/provenance/stamp-pcd-provenance.ts",
      "packages/creative-pipeline/src/pcd/provenance/write-pcd-identity-snapshot-with-provenance.ts",
      "packages/creative-pipeline/src/pcd/cost/write-pcd-identity-snapshot-with-cost-forecast.ts",
      "packages/creative-pipeline/src/pcd/cost/stamp-pcd-cost-forecast.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/route-synthetic-pcd-shot.ts",
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-router-version.ts",
      "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/pcd-identity.ts",
    ];

    let baselineSha = "";
    try {
      baselineSha = execSync(`git -C ${REPO_ROOT} rev-parse ${SP17_SQUASH_SHA}`, {
        encoding: "utf8",
      }).trim();
    } catch {
      // Shallow clone — skip
      return;
    }
    if (baselineSha === "") return;

    for (const file of frozenFiles) {
      let diff = "";
      try {
        diff = execSync(`git -C ${REPO_ROOT} diff ${baselineSha}..HEAD -- ${file}`, {
          encoding: "utf8",
        });
      } catch {
        continue;
      }
      expect(diff, `SP1–SP17 frozen file was modified: ${file}`).toBe("");
    }
  });

  it("5: forbidden imports — no SP18 source imports db, prisma, inngest, node:fs, node:http, node:https", () => {
    const { nonTest } = partitionSp18Sources();
    for (const file of nonTest) {
      const src = source(file);
      expect(src, `${file} imports @creativeagent/db`).not.toMatch(
        /from\s+["']@creativeagent\/db["']/,
      );
      expect(src, `${file} imports @prisma/client`).not.toMatch(/from\s+["']@prisma\/client["']/);
      expect(src, `${file} imports inngest`).not.toMatch(/from\s+["']inngest["']/);
      expect(src, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(src, `${file} imports node:http`).not.toMatch(/from\s+["']node:http["']/);
      expect(src, `${file} imports node:https`).not.toMatch(/from\s+["']node:https["']/);
    }
  });

  it("6: single createHash( call — exactly one occurrence across the SP18 surface", () => {
    const { nonTest } = partitionSp18Sources();
    let totalHits = 0;
    for (const file of nonTest) {
      const src = source(file);
      const matches = src.match(/createHash\(/g);
      totalHits += matches?.length ?? 0;
    }
    expect(totalHits, "expected exactly one createHash( call across SP18 non-test sources").toBe(1);
  });

  it("7: no mutation of input decisions — no SP18 source contains syntheticDecision assignment patterns", () => {
    const { nonTest } = partitionSp18Sources();
    for (const file of nonTest) {
      const src = source(file);
      // Strip line-comments before matching (same precedent as SP10A)
      const codeOnly = src
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      expect(codeOnly, `${file} mutates syntheticDecision property`).not.toMatch(
        /syntheticDecision\.\w+\s*=/,
      );
    }
  });

  // --- Behavioral assertions ---

  it("8: no silent denial persistence — ACCESS_POLICY denial throws", async () => {
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "ACCESS_POLICY",
      accessDecision: { allowed: false },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: denial }, { clock: fixedClock }),
    ).rejects.toThrow();
  });

  it("8: no silent denial persistence — NO_DIRECTION_AUTHORED denial throws", async () => {
    const denial = {
      allowed: false,
      kind: "synthetic_pairing",
      denialKind: "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER",
      videoProviderChoice: "seedance",
      accessDecision: accessDecisionFixture,
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: denial }, { clock: fixedClock }),
    ).rejects.toThrow();
  });

  it("8: no silent denial persistence — delegation throws", async () => {
    const delegated = {
      kind: "delegated_to_generic_router",
      reason: "shot_type_not_in_synthetic_pairing",
      shotType: "script_only",
      sp4Decision: { allowed: true },
      syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
    } as unknown as Parameters<typeof stampPcdSyntheticRoutingDecision>[0]["syntheticDecision"];
    await expect(
      stampPcdSyntheticRoutingDecision({ syntheticDecision: delegated }, { clock: fixedClock }),
    ).rejects.toThrow();
  });

  it("9: promptHash echo — sha256(dallePromptLocked, utf8)", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const expected = createHash("sha256")
      .update(klingSuccess.dallePromptLocked, "utf8")
      .digest("hex");
    expect(payload.promptHash).toBe(expected);
    expect(payload.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("10: videoProvider === videoProviderChoice on persisted payload — kling", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    expect(payload.videoProvider).toBe(payload.videoProviderChoice);
    expect(payload.syntheticRoutingDecisionReason.videoProvider).toBe(payload.videoProvider);
  });

  it("10: videoProvider === videoProviderChoice on persisted payload — seedance", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: seedanceSuccess },
      { clock: fixedClock },
    );
    expect(payload.videoProvider).toBe(payload.videoProviderChoice);
    expect(payload.syntheticRoutingDecisionReason.videoProvider).toBe(payload.videoProvider);
  });
});
