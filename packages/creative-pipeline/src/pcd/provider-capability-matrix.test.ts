import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import type { IdentityTier, OutputIntent, PcdShotType } from "@creativeagent/schemas";

const ALL_SHOT_TYPES: PcdShotType[] = [
  "script_only",
  "storyboard",
  "simple_ugc",
  "talking_head",
  "product_demo",
  "product_in_hand",
  "face_closeup",
  "label_closeup",
  "object_insert",
];

const ALL_OUTPUT_INTENTS: OutputIntent[] = ["draft", "preview", "final_export", "meta_draft"];
const ALL_TIERS: IdentityTier[] = [1, 2, 3];

describe("PCD_PROVIDER_CAPABILITY_VERSION", () => {
  it("is locked at provider-capability@1.0.0", () => {
    expect(PCD_PROVIDER_CAPABILITY_VERSION).toBe("provider-capability@1.0.0");
  });
});

describe("PCD_PROVIDER_CAPABILITY_MATRIX shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(PCD_PROVIDER_CAPABILITY_MATRIX)).toBe(true);
    expect(PCD_PROVIDER_CAPABILITY_MATRIX.length).toBeGreaterThan(0);
  });

  it.each(PCD_PROVIDER_CAPABILITY_MATRIX.map((row, idx) => [idx, row]))(
    "row %i has all required fields with correct types",
    (_idx, row) => {
      const r = row as PcdProviderCapability;
      expect(typeof r.provider).toBe("string");
      expect(r.provider.length).toBeGreaterThan(0);
      expect(Array.isArray(r.tiers)).toBe(true);
      expect(r.tiers.length).toBeGreaterThan(0);
      expect(Array.isArray(r.shotTypes)).toBe(true);
      expect(r.shotTypes.length).toBeGreaterThan(0);
      expect(Array.isArray(r.outputIntents)).toBe(true);
      expect(r.outputIntents.length).toBeGreaterThan(0);
      expect(typeof r.supportsFirstLastFrame).toBe("boolean");
      expect(typeof r.supportsEditExtend).toBe("boolean");
      expect(typeof r.supportsPerformanceTransfer).toBe("boolean");
    },
  );
});

describe("Matrix coverage against SP2 allowed-set", () => {
  it("for every (tier, shotType, outputIntent) allowed by SP2, at least one matrix row matches", () => {
    const gaps: string[] = [];
    for (const tier of ALL_TIERS) {
      for (const shot of ALL_SHOT_TYPES) {
        for (const intent of ALL_OUTPUT_INTENTS) {
          const decision = decidePcdGenerationAccess({
            avatarTier: tier,
            productTier: tier,
            shotType: shot,
            outputIntent: intent,
          });
          if (!decision.allowed) continue;
          const matches = PCD_PROVIDER_CAPABILITY_MATRIX.filter(
            (c) =>
              c.tiers.includes(tier) &&
              c.shotTypes.includes(shot) &&
              c.outputIntents.includes(intent),
          );
          if (matches.length === 0) {
            gaps.push(`(tier=${tier}, shot=${shot}, intent=${intent})`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("Tier 3 capability sufficiency (rule combinations on a single row)", () => {
  // Helpers replicate the Tier 3 rule predicates to avoid coupling this test
  // to the rules module under test. Hand-listed; matches SP4 design.
  const VIDEO_SHOTS: ReadonlyArray<PcdShotType> = [
    "simple_ugc",
    "talking_head",
    "product_demo",
    "product_in_hand",
    "face_closeup",
    "label_closeup",
    "object_insert",
  ];
  const PUBLISHABLE_INTENTS: ReadonlyArray<OutputIntent> = [
    "preview",
    "final_export",
    "meta_draft",
  ];
  const requiresFLF = (shot: PcdShotType, intent: OutputIntent): boolean =>
    VIDEO_SHOTS.includes(shot) && PUBLISHABLE_INTENTS.includes(intent);
  const requiresPT = (shot: PcdShotType): boolean => shot === "talking_head";

  it("for every Tier-3-allowed (shot, intent), the matrix has a row satisfying all simultaneously-required Tier 3 rules", () => {
    const gaps: string[] = [];
    for (const shot of ALL_SHOT_TYPES) {
      for (const intent of ALL_OUTPUT_INTENTS) {
        const decision = decidePcdGenerationAccess({
          avatarTier: 3,
          productTier: 3,
          shotType: shot,
          outputIntent: intent,
        });
        if (!decision.allowed) continue;

        const needsFLF = requiresFLF(shot, intent);
        const needsPT = requiresPT(shot);

        // Without rule 3 (campaignTakeStore=false): rules 1 + 2 must coexist.
        const baselineMatch = PCD_PROVIDER_CAPABILITY_MATRIX.find(
          (c) =>
            c.tiers.includes(3) &&
            c.shotTypes.includes(shot) &&
            c.outputIntents.includes(intent) &&
            (!needsFLF || c.supportsFirstLastFrame) &&
            (!needsPT || c.supportsPerformanceTransfer),
        );
        if (!baselineMatch) {
          gaps.push(`baseline (shot=${shot}, intent=${intent})`);
        }

        // With rule 3 active (campaignTakeStore=true): rules 1 + 2 + 3 must
        // all coexist on a single row.
        const rule3Match = PCD_PROVIDER_CAPABILITY_MATRIX.find(
          (c) =>
            c.tiers.includes(3) &&
            c.shotTypes.includes(shot) &&
            c.outputIntents.includes(intent) &&
            (!needsFLF || c.supportsFirstLastFrame) &&
            (!needsPT || c.supportsPerformanceTransfer) &&
            c.supportsEditExtend,
        );
        if (!rule3Match) {
          gaps.push(`rule3 (shot=${shot}, intent=${intent})`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

describe("Forbidden imports in provider-capability-matrix.ts", () => {
  it("contains none of the forbidden import paths", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-capability-matrix.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
  });
});
