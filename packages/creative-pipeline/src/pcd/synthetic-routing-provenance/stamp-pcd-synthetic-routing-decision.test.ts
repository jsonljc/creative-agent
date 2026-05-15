import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SyntheticPcdRoutingDecision } from "@creativeagent/schemas";
import { stampPcdSyntheticRoutingDecision } from "./stamp-pcd-synthetic-routing-decision.js";
import { PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION } from "./synthetic-routing-provenance-version.js";

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

describe("stampPcdSyntheticRoutingDecision — kling success", () => {
  it("returns flat columns verbatim from the decision", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    expect(payload.imageProvider).toBe("dalle");
    expect(payload.videoProvider).toBe("kling");
    expect(payload.videoProviderChoice).toBe("kling");
    expect(payload.syntheticRouterVersion).toBe("pcd-synthetic-router@1.1.0");
    expect(payload.syntheticPairingVersion).toBe("pcd-synthetic-provider-pairing@1.1.0");
  });

  it("computes promptHash = sha256(dallePromptLocked, utf8)", async () => {
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

  it("assembles Json reason with kling direction and no seedance leakage", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const reason = payload.syntheticRoutingDecisionReason;
    expect(reason.videoProvider).toBe("kling");
    if (reason.videoProvider === "kling") {
      expect(reason.klingDirection).toEqual(klingDirection);
    }
    expect((reason as { seedanceDirection?: unknown }).seedanceDirection).toBeUndefined();
    expect(reason.pairingRefIndex).toBe(0);
    expect(reason.decisionReason).toEqual(innerReason);
    expect(reason.decidedAt).toBe("2026-05-16T08:00:00.000Z");
    expect(reason.syntheticRoutingProvenanceVersion).toBe(PCD_SYNTHETIC_ROUTING_PROVENANCE_VERSION);
  });
});

describe("stampPcdSyntheticRoutingDecision — seedance success", () => {
  it("returns flat columns verbatim from the decision", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: seedanceSuccess },
      { clock: fixedClock },
    );
    expect(payload.videoProvider).toBe("seedance");
    expect(payload.videoProviderChoice).toBe("seedance");
  });

  it("assembles Json reason with seedance direction and no kling leakage", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: seedanceSuccess },
      { clock: fixedClock },
    );
    const reason = payload.syntheticRoutingDecisionReason;
    expect(reason.videoProvider).toBe("seedance");
    if (reason.videoProvider === "seedance") {
      expect(reason.seedanceDirection).toEqual(seedanceDirection);
    }
    expect((reason as { klingDirection?: unknown }).klingDirection).toBeUndefined();
    expect(reason.pairingRefIndex).toBe(1);
  });
});

describe("stampPcdSyntheticRoutingDecision — defense-in-depth (Guardrail A)", () => {
  it("rejects ACCESS_POLICY denial branch", async () => {
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

  it("rejects NO_DIRECTION_AUTHORED denial branch", async () => {
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

  it("rejects delegation branch", async () => {
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
});

describe("stampPcdSyntheticRoutingDecision — clock injection + wall-clock fallback", () => {
  it("uses the injected clock when provided", async () => {
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: () => new Date("2026-12-31T23:59:59.999Z") },
    );
    expect(payload.syntheticRoutingDecisionReason.decidedAt).toBe("2026-12-31T23:59:59.999Z");
  });

  it("falls back to new Date() when no clock injected", async () => {
    const before = Date.now();
    const payload = await stampPcdSyntheticRoutingDecision({ syntheticDecision: klingSuccess }, {});
    const after = Date.now();
    const stamped = Date.parse(payload.syntheticRoutingDecisionReason.decidedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);
  });
});

describe("stampPcdSyntheticRoutingDecision — promptHash properties", () => {
  it("produces identical hashes for identical inputs", async () => {
    const a = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const b = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    expect(a.promptHash).toBe(b.promptHash);
  });

  it("produces different hashes for different inputs", async () => {
    const variant: SyntheticPcdRoutingDecision = {
      ...klingSuccess,
      dallePromptLocked: klingSuccess.dallePromptLocked + " plus an extra word",
    };
    const a = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: klingSuccess },
      { clock: fixedClock },
    );
    const b = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: variant },
      { clock: fixedClock },
    );
    expect(a.promptHash).not.toBe(b.promptHash);
  });

  it("hashes UTF-8 bytes correctly for non-ASCII input", async () => {
    const variant: SyntheticPcdRoutingDecision = {
      ...klingSuccess,
      dallePromptLocked: "café",
    };
    const payload = await stampPcdSyntheticRoutingDecision(
      { syntheticDecision: variant },
      { clock: fixedClock },
    );
    const expected = createHash("sha256").update("café", "utf8").digest("hex");
    expect(payload.promptHash).toBe(expected);
  });
});
