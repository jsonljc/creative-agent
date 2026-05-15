// SP17 anti-pattern grep tests. These guard against:
//   1. No parallel V2 router symbol (routeSyntheticPcdShotV2 / file v2). SP17
//      is canonical-router extension, not wrapping.
//   2. No V2 router file (route-synthetic-pcd-shot-v2.ts).
//   3. Single-source pairing-version pin ("pcd-synthetic-provider-pairing@1.1.0"
//      appears in exactly one non-test source file).
//   4. Single-source router-version pin ("pcd-synthetic-router@1.1.0" appears
//      in exactly one non-test source file).
//   5. Behavioral: no silent fallback. seedance-choice + null seedanceDirection
//      → NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER denial, never a kling success.
//   6. Behavioral: verbatim seedanceDirection on seedance-success.
//   7. Frozen SP1–SP16 source bodies (allowlist edits only) — keyed against
//      04f14b1 (SP16-on-main merge tip). Convention carried from SP14/15/16.
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CreatorIdentitySyntheticPayload } from "@creativeagent/schemas";
import { routeSyntheticPcdShot, type RouteSyntheticPcdShotInput } from "./route-synthetic-pcd-shot.js";
import type { ProviderRouterStores } from "../provider-router.js";
import type { ResolvedPcdContext } from "../registry-resolver.js";
import { PCD_SHOT_SPEC_VERSION } from "../shot-spec-version.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");

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

describe("SP17 anti-patterns", () => {
  // --- Source-level assertions ---

  it("no parallel V2 router symbol anywhere in pipeline package", () => {
    const hits = grepFiles("routeSyntheticPcdShotV2", "packages/creative-pipeline/src").filter(
      (line) => !line.includes("sp17-anti-patterns.test.ts"),
    );
    expect(hits, `unexpected V2 router symbol references: ${hits.join("\n")}`).toEqual([]);
  });

  it("no V2 router file exists", () => {
    const hits = grepFiles("route-synthetic-pcd-shot-v2", "packages/creative-pipeline/src").filter(
      (line) => !line.includes("sp17-anti-patterns.test.ts"),
    );
    expect(hits).toEqual([]);
  });

  it('PCD_SYNTHETIC_ROUTER_VERSION literal "pcd-synthetic-router@1.1.0" lives in exactly one non-test source file', () => {
    const hits = grepFiles('"pcd-synthetic-router@1\\.1\\.0"', "packages/");
    const sourceHits = hits.filter((line) => !line.includes(".test.ts"));
    const uniquePaths = new Set(sourceHits.map((line) => line.split(":")[0]));
    expect(
      uniquePaths.size,
      `expected exactly one non-test source; got: ${[...uniquePaths].join(", ")}`,
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
      `expected exactly one non-test source; got: ${[...uniquePaths].join(", ")}`,
    ).toBe(1);
    expect(
      uniquePaths.has(
        "packages/creative-pipeline/src/pcd/synthetic-router/synthetic-provider-pairing.ts",
      ),
    ).toBe(true);
  });

  // --- Behavioral assertions ---

  it("no silent fallback: seedance choice + null seedanceDirection → NO_DIRECTION_AUTHORED, never kling success", async () => {
    const baseInput = makeBaseRouterInput();
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: null },
      },
      makeStores(),
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false && decision.kind === "synthetic_pairing") {
      expect(decision.denialKind).toBe("NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER");
      if (decision.denialKind === "NO_DIRECTION_AUTHORED_FOR_VIDEO_PROVIDER") {
        expect(decision.videoProviderChoice).toBe("seedance");
      }
    } else {
      throw new Error("unexpected decision shape on seedance + null direction");
    }
    // Never a kling success on a seedance choice.
    if (decision.allowed === true && decision.kind === "synthetic_pairing") {
      throw new Error("router silently fell back to a success branch on null seedance direction");
    }
  });

  it("verbatim seedanceDirection on seedance-success — byte-equality", async () => {
    const seedanceDir = {
      setting: "Unique-Setting-XYZ",
      motion: "Unique-Motion-XYZ",
      energy: "Unique-Energy-XYZ",
      lighting: "Unique-Lighting-XYZ",
      avoid: ["Unique-Avoid-XYZ"],
    };
    const baseInput = makeBaseRouterInput();
    const decision = await routeSyntheticPcdShot(
      {
        ...baseInput,
        videoProviderChoice: "seedance",
        syntheticIdentity: { ...baseInput.syntheticIdentity, seedanceDirection: seedanceDir },
      },
      makeStores(),
    );
    expect(decision.allowed).toBe(true);
    if (
      decision.allowed === true &&
      decision.kind === "synthetic_pairing" &&
      decision.videoProvider === "seedance"
    ) {
      expect(decision.seedanceDirection).toEqual(seedanceDir);
    } else {
      throw new Error("expected seedance-success branch");
    }
  });

  // --- Frozen-source-body assertion (convention from SP14/15/16) ---

  it("SP1–SP16 source bodies are unchanged since the SP16 baseline (allowlist edits only)", () => {
    const SP16_BASELINE = "04f14b1"; // SP16-on-main merge tip
    const allowedEdits = new Set<string>([
      // SP17 net-new files
      "packages/creative-pipeline/src/pcd/synthetic-router/sp17-anti-patterns.test.ts",
      // SP17 SP11 widen
      "packages/schemas/src/creator-identity-synthetic.ts",
      "packages/schemas/src/__tests__/creator-identity-synthetic.test.ts",
      // SP17 schemas widen (5-branch union)
      "packages/schemas/src/pcd-synthetic-router.ts",
      "packages/schemas/src/__tests__/pcd-synthetic-router.test.ts",
      // SP17 DB
      "packages/db/prisma/schema.prisma",
      "packages/db/src/stores/prisma-creator-identity-synthetic-store.ts",
      "packages/db/src/stores/prisma-creator-identity-synthetic-reader.ts",
      "packages/db/src/stores/__tests__/prisma-creator-identity-synthetic-store.test.ts",
      // SP17 design + plan docs
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-design.md",
      "docs/plans/2026-05-15-pcd-synthetic-provider-routing-seedance-sp17-plan.md",
    ]);

    let baselineSha = "";
    try {
      baselineSha = execSync(`git rev-parse ${SP16_BASELINE}`, {
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
      // SP17 freely edits its own subdir (router source + tests).
      if (file.startsWith("packages/creative-pipeline/src/pcd/synthetic-router/")) continue;
      // SP17 Prisma migration directories.
      if (file.startsWith("packages/db/prisma/migrations/")) continue;
      // docs.
      if (file.startsWith("docs/")) continue;
      // Allowlist additions to prior SP anti-pattern tests (Task 13).
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
      expect(
        allowedEdits.has(file),
        `unexpected file changed since ${SP16_BASELINE}: ${file}`,
      ).toBe(true);
    }
  });
});

// --- Fixture helpers ---

function makeBaseRouterInput(): RouteSyntheticPcdShotInput {
  const resolvedContext: ResolvedPcdContext = {
    productIdentityId: "pi_sp17_antipattern",
    creatorIdentityId: "ci_sp17_antipattern",
    productTierAtResolution: 3,
    creatorTierAtResolution: 3,
    effectiveTier: 3,
    allowedOutputTier: 3,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
  };
  const syntheticIdentity: CreatorIdentitySyntheticPayload = {
    creatorIdentityId: "ci_sp17_antipattern",
    treatmentClass: "med_spa",
    vibe: "quiet_confidence",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_30s_plus",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Oval",
      skinTone: "Fair",
      eyeShape: "Hooded",
      hair: "Brunette",
      ageRead: "36",
      buildNote: "Slim",
    },
    dallePromptLocked: "Test DALL-E prompt for SP17 anti-pattern fixture",
    klingDirection: {
      setting: "Room",
      motion: "Turn",
      energy: "Composed",
      lighting: "Warm",
      avoid: ["Filter"],
    },
    seedanceDirection: null,
    voiceCaptionStyle: {
      voice: "Calm",
      captionStyle: "lower",
      sampleHook: "ok",
      sampleCta: "book",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  };
  return {
    resolvedContext,
    syntheticIdentity,
    shotType: "simple_ugc",
    outputIntent: "draft",
    videoProviderChoice: "kling",
    approvedCampaignContext: { kind: "none" },
  };
}

function makeStores(): ProviderRouterStores {
  return {
    campaignTakeStore: {
      hasApprovedTier3TakeForCampaign: async () => false,
    },
  };
}
