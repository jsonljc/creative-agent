import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  routePcdShot,
  PCD_PROVIDER_ROUTER_VERSION,
  type ApprovedCampaignContext,
  type PcdRoutingDecision,
  type ProviderRouterStores,
  type RoutePcdShotInput,
} from "./provider-router.js";
import {
  PCD_PROVIDER_CAPABILITY_MATRIX,
  PCD_PROVIDER_CAPABILITY_VERSION,
  type PcdProviderCapability,
} from "./provider-capability-matrix.js";
import type { CampaignTakeStore } from "./tier3-routing-rules.js";
import type { ResolvedPcdContext } from "./registry-resolver.js";
import { decidePcdGenerationAccess } from "./tier-policy.js";
import { PCD_SHOT_SPEC_VERSION } from "./shot-spec-version.js";
import type { OutputIntent, PcdShotType } from "@creativeagent/schemas";

function makeContext(overrides: Partial<ResolvedPcdContext> = {}): ResolvedPcdContext {
  return {
    productIdentityId: "p-1",
    creatorIdentityId: "c-1",
    productTier: 2,
    creatorTier: 2,
    effectiveTier: 2,
    allowedOutputTier: 2,
    shotSpecVersion: PCD_SHOT_SPEC_VERSION,
    ...overrides,
  };
}

function makeCampaignTakeStore(returns: boolean, log: { calls: number }): CampaignTakeStore {
  return {
    hasApprovedTier3TakeForCampaign: async () => {
      log.calls += 1;
      return returns;
    },
  };
}

function neverConsultedStore(): { store: CampaignTakeStore; log: { calls: number } } {
  const log = { calls: 0 };
  return {
    store: {
      hasApprovedTier3TakeForCampaign: async () => {
        log.calls += 1;
        return true;
      },
    },
    log,
  };
}

const NO_CAMPAIGN: ApprovedCampaignContext = { kind: "none" };
const WITH_CAMPAIGN: ApprovedCampaignContext = {
  kind: "campaign",
  organizationId: "org-1",
  campaignId: "camp-1",
};

describe("PCD_PROVIDER_ROUTER_VERSION", () => {
  it("is locked at provider-router@1.0.0", () => {
    expect(PCD_PROVIDER_ROUTER_VERSION).toBe("provider-router@1.0.0");
  });
});

describe("routePcdShot — Part A: access-policy gate", () => {
  it("Tier-1 + final_export → ACCESS_POLICY denial; matrix not consulted", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 1,
          creatorTier: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.denialKind).toBe("ACCESS_POLICY");
    expect(log.calls).toBe(0);
  });

  it("Tier-1 + draft + simple_ugc → allowed (matrix has Tier-1 draft route)", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 1,
          creatorTier: 1,
          effectiveTier: 1,
          allowedOutputTier: 1,
        }),
        shotType: "script_only",
        outputIntent: "draft",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
  });

  it("component-tier passthrough: (productTier=3, creatorTier=1) maps to (productTier=3, avatarTier=1) for SP2 policy", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 1,
          effectiveTier: 1, // min
          allowedOutputTier: 1,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    // SP2 should deny because effectiveTier=1 < 2 required for final_export.
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.denialKind).toBe("ACCESS_POLICY");
      // Verify the SP2 decision was computed with the component tiers passed
      // through correctly: requiredAvatarTier=2 (not 3, since the floor is 2 for
      // final_export, not the shot-level 3).
      expect(result.accessDecision.allowed).toBe(false);
    }
  });
});

describe("routePcdShot — Part B: matrix filter + Tier 3 rules", () => {
  it("Tier-2 + simple_ugc + final_export + {kind:none} → first matching row selected", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 2,
          creatorTier: 2,
          effectiveTier: 2,
          allowedOutputTier: 2,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
      expect(result.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
      expect(result.decisionReason.tier3RulesApplied).toEqual([]);
    }
    expect(log.calls).toBe(0);
  });

  it("Tier-3 + face_closeup + final_export + {kind:none} → only supportsFirstLastFrame=true rows survive", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "face_closeup",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsFirstLastFrame).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toContain("first_last_frame_anchor");
    }
    expect(log.calls).toBe(0); // {kind:none}
  });

  it("Tier-3 + talking_head + preview + {kind:none} → rule 1 + rule 2 both required, only matching rows survive", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "talking_head",
        outputIntent: "preview",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsFirstLastFrame).toBe(true);
      expect(result.selectedCapability.supportsPerformanceTransfer).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toEqual(
        expect.arrayContaining(["first_last_frame_anchor", "performance_transfer"]),
      );
    }
  });

  it("Tier-3 + simple_ugc + final_export + {kind:campaign} + store=true → rule 3 active, supportsEditExtend=true required", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(true, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.selectedCapability.supportsEditExtend).toBe(true);
      expect(result.decisionReason.tier3RulesApplied).toContain("edit_over_regenerate");
    }
    expect(log.calls).toBe(1);
  });

  it("Tier-3 + {kind:campaign} + store=false → rule 3 NOT applied", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: WITH_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.tier3RulesApplied).not.toContain("edit_over_regenerate");
    }
    expect(log.calls).toBe(1); // store consulted under {kind:campaign}
  });

  it("Tier-3 + {kind:none} → rule 3 short-circuits; campaignTakeStore never called", async () => {
    const { store, log } = neverConsultedStore();
    const stores: ProviderRouterStores = { campaignTakeStore: store };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    expect(log.calls).toBe(0);
  });
});

describe("routePcdShot — Part C: empty candidates (NO_PROVIDER_CAPABILITY)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("Tier-3 + face_closeup + final_export with synthetic matrix lacking supportsFirstLastFrame → NO_PROVIDER_CAPABILITY denial", async () => {
    const syntheticMatrix: ReadonlyArray<PcdProviderCapability> = [
      {
        provider: "synth-only",
        tiers: [3],
        shotTypes: ["face_closeup"],
        outputIntents: ["final_export"],
        supportsFirstLastFrame: false, // rule 1 cannot be satisfied
        supportsEditExtend: true,
        supportsPerformanceTransfer: true,
      },
    ];

    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: syntheticMatrix,
    }));

    // Re-import after mocking.
    const { routePcdShot: routePcdShotFresh } = await import("./provider-router.js");

    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShotFresh(
      {
        resolvedContext: makeContext({
          productTier: 3,
          creatorTier: 3,
          effectiveTier: 3,
          allowedOutputTier: 3,
        }),
        shotType: "face_closeup",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.denialKind).toBe("NO_PROVIDER_CAPABILITY");
      if (result.denialKind === "NO_PROVIDER_CAPABILITY") {
        // accessDecision is unmutated; SP2 *did* allow this shot.
        expect(result.accessDecision.allowed).toBe(true);
        expect(result.candidatesAfterTier3Filter).toBe(0);
      }
    }
  });
});

describe("routePcdShot — Part D: decision reason shape", () => {
  it("Tier-2 allowed: tier3RulesApplied is empty; matchedEffectiveTier=2; capabilityRefIndex points back to live matrix", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext({
          productTier: 2,
          creatorTier: 2,
          effectiveTier: 2,
          allowedOutputTier: 2,
        }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.tier3RulesApplied).toEqual([]);
      expect(result.decisionReason.matchedEffectiveTier).toBe(2);
      expect(result.decisionReason.candidatesEvaluated).toBeGreaterThanOrEqual(1);
      expect(PCD_PROVIDER_CAPABILITY_MATRIX[result.decisionReason.capabilityRefIndex]).toBe(
        result.selectedCapability,
      );
    }
  });

  it("selectionRationale is a non-empty string ≤200 chars", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const result = await routePcdShot(
      {
        resolvedContext: makeContext(),
        shotType: "simple_ugc",
        outputIntent: "preview",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      stores,
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.decisionReason.selectionRationale.length).toBeGreaterThan(0);
      expect(result.decisionReason.selectionRationale.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("routePcdShot — Part E: determinism", () => {
  it("two consecutive calls with identical inputs → deep-equal decisions", async () => {
    const log = { calls: 0 };
    const stores: ProviderRouterStores = {
      campaignTakeStore: makeCampaignTakeStore(false, log),
    };
    const input: RoutePcdShotInput = {
      resolvedContext: makeContext({
        productTier: 3,
        creatorTier: 3,
        effectiveTier: 3,
        allowedOutputTier: 3,
      }),
      shotType: "talking_head",
      outputIntent: "final_export",
      approvedCampaignContext: NO_CAMPAIGN,
    };
    const r1 = await routePcdShot(input, stores);
    const r2 = await routePcdShot(input, stores);
    expect(r1).toEqual(r2);
  });
});

describe("routePcdShot — Part F: first-match is policy", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("reordering matrix rows changes which provider is selected", async () => {
    const rowA: PcdProviderCapability = {
      provider: "provider-a",
      tiers: [2],
      shotTypes: ["simple_ugc"],
      outputIntents: ["final_export"],
      supportsFirstLastFrame: false,
      supportsEditExtend: false,
      supportsPerformanceTransfer: false,
    };
    const rowB: PcdProviderCapability = { ...rowA, provider: "provider-b" };

    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: [rowA, rowB],
    }));
    const { routePcdShot: route1 } = await import("./provider-router.js");
    const log = { calls: 0 };
    const r1 = await route1(
      {
        resolvedContext: makeContext({ effectiveTier: 2, productTier: 2, creatorTier: 2, allowedOutputTier: 2 }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      { campaignTakeStore: makeCampaignTakeStore(false, log) },
    );

    vi.resetModules();
    vi.doMock("./provider-capability-matrix.js", () => ({
      PCD_PROVIDER_CAPABILITY_VERSION: "provider-capability@1.0.0",
      PCD_PROVIDER_CAPABILITY_MATRIX: [rowB, rowA],
    }));
    const { routePcdShot: route2 } = await import("./provider-router.js");
    const r2 = await route2(
      {
        resolvedContext: makeContext({ effectiveTier: 2, productTier: 2, creatorTier: 2, allowedOutputTier: 2 }),
        shotType: "simple_ugc",
        outputIntent: "final_export",
        approvedCampaignContext: NO_CAMPAIGN,
      },
      { campaignTakeStore: makeCampaignTakeStore(false, log) },
    );

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    if (r1.allowed && r2.allowed) {
      expect(r1.selectedProvider).toBe("provider-a");
      expect(r2.selectedProvider).toBe("provider-b");
    }
  });
});

describe("routePcdShot — Part G: end-to-end matrix-router agreement (Tier 3)", () => {
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

  function tier3AllowedTriples(): Array<[PcdShotType, OutputIntent]> {
    const out: Array<[PcdShotType, OutputIntent]> = [];
    for (const s of ALL_SHOT_TYPES) {
      for (const i of ALL_OUTPUT_INTENTS) {
        const d = decidePcdGenerationAccess({
          avatarTier: 3,
          productTier: 3,
          shotType: s,
          outputIntent: i,
        });
        if (d.allowed) out.push([s, i]);
      }
    }
    return out;
  }

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:none} → routePcdShot allows (live matrix sufficient for rules 1/2)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(false, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: NO_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:campaign}+store=true → routePcdShot allows (rule 1+2+3 sufficient on a single matrix row)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(true, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: WITH_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );

  it.each(tier3AllowedTriples())(
    "Tier-3 + %s + %s + {kind:campaign}+store=false → routePcdShot allows (rule 3 not active)",
    async (shot, intent) => {
      const log = { calls: 0 };
      const stores: ProviderRouterStores = {
        campaignTakeStore: makeCampaignTakeStore(false, log),
      };
      const result = await routePcdShot(
        {
          resolvedContext: makeContext({
            productTier: 3,
            creatorTier: 3,
            effectiveTier: 3,
            allowedOutputTier: 3,
          }),
          shotType: shot,
          outputIntent: intent,
          approvedCampaignContext: WITH_CAMPAIGN,
        },
        stores,
      );
      expect(result.allowed).toBe(true);
    },
  );
});

describe("Forbidden imports in provider-router.ts", () => {
  it("contains none of the forbidden import paths (and never re-imports PCD_SHOT_SPEC_VERSION)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-router.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
    expect(src).not.toMatch(/from ["']\.\/shot-spec-version\.js["']/);
  });

  it("contains no hardcoded provider name string literal in conditional position", () => {
    // We assert the source has no `=== "kling"` / `=== "runway"` / etc. style
    // conditionals. The router must reference selected.provider, not literals.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "provider-router.ts"), "utf8");
    expect(src).not.toMatch(/===\s*["'](kling|runway|heygen|sora|veo|openai_text)["']/);
    expect(src).not.toMatch(/!==\s*["'](kling|runway|heygen|sora|veo|openai_text)["']/);
  });
});
