import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  writePcdIdentitySnapshot,
  type PcdIdentitySnapshotStore,
  type PcdIdentitySnapshotWriterStores,
  type WritePcdIdentitySnapshotInput,
} from "./pcd-identity-snapshot-writer.js";
import { PCD_TIER_POLICY_VERSION } from "./tier-policy.js";
import { PCD_PROVIDER_CAPABILITY_VERSION } from "./provider-capability-matrix.js";
import { PCD_PROVIDER_ROUTER_VERSION } from "./provider-router.js";
import {
  Tier3RoutingMetadataMismatchError,
  Tier3RoutingViolationError,
} from "./tier3-routing-rules.js";
import type { PcdIdentitySnapshot, PcdRoutingDecisionReason } from "@creativeagent/schemas";
import type { PcdProviderCapability } from "./provider-capability-matrix.js";

type RecordedCall = Parameters<PcdIdentitySnapshotStore["createForShot"]>[0];

function makeFakeStore(): {
  store: PcdIdentitySnapshotStore;
  calls: RecordedCall[];
  returnValue: () => PcdIdentitySnapshot;
} {
  const calls: RecordedCall[] = [];
  const store: PcdIdentitySnapshotStore = {
    createForShot: async (input) => {
      calls.push(input);
      return {
        id: "snap-1",
        createdAt: new Date("2026-04-28T00:00:00Z"),
        ...input,
      } as unknown as PcdIdentitySnapshot;
    },
  };
  return {
    store,
    calls,
    returnValue: () =>
      ({ id: "snap-1", createdAt: new Date(), ...calls[0] }) as unknown as PcdIdentitySnapshot,
  };
}

function makeStores(s: PcdIdentitySnapshotStore): PcdIdentitySnapshotWriterStores {
  return { pcdIdentitySnapshotStore: s };
}

const CAP_ALL: PcdProviderCapability = {
  provider: "test-all",
  tiers: [1, 2, 3],
  shotTypes: ["simple_ugc", "talking_head", "face_closeup"],
  outputIntents: ["draft", "preview", "final_export", "meta_draft"],
  supportsFirstLastFrame: true,
  supportsEditExtend: true,
  supportsPerformanceTransfer: true,
};

function makeReason(overrides: Partial<PcdRoutingDecisionReason> = {}): PcdRoutingDecisionReason {
  return {
    capabilityRefIndex: 0,
    matchedShotType: "simple_ugc",
    matchedEffectiveTier: 2,
    matchedOutputIntent: "final_export",
    tier3RulesApplied: [],
    candidatesEvaluated: 1,
    candidatesAfterTier3Filter: 1,
    selectionRationale: "test",
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<WritePcdIdentitySnapshotInput> = {},
): WritePcdIdentitySnapshotInput {
  return {
    assetRecordId: "asset-1",
    productIdentityId: "p-1",
    productTierAtGeneration: 2,
    productImageAssetIds: ["img-1"],
    productCanonicalTextHash: "hash",
    productLogoAssetId: null,
    creatorIdentityId: "c-1",
    avatarTierAtGeneration: 2,
    avatarReferenceAssetIds: ["ref-1"],
    voiceAssetId: null,
    consentRecordId: null,
    selectedProvider: "test-all",
    providerModelSnapshot: "test-all-v1",
    seedOrNoSeed: "no-seed",
    rewrittenPromptText: null,
    shotSpecVersion: "shot-spec@0.5.0", // intentionally not the current value
    routerVersion: "ignored", // caller cannot force; writer pins from import
    routingDecisionReason: makeReason(),
    effectiveTier: 2,
    shotType: "simple_ugc",
    outputIntent: "final_export",
    selectedCapability: CAP_ALL,
    editOverRegenerateRequired: false,
    ...overrides,
  };
}

describe("writePcdIdentitySnapshot — Part A: version pinning", () => {
  it("policyVersion comes from PCD_TIER_POLICY_VERSION import (caller cannot override)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        // Caller tries to spread a bogus policyVersion onto the input.
        ...({ policyVersion: "tier-policy@bogus" } as unknown as Partial<WritePcdIdentitySnapshotInput>),
      }),
      makeStores(store),
    );
    expect(calls[0]?.policyVersion).toBe(PCD_TIER_POLICY_VERSION);
  });

  it("providerCapabilityVersion comes from import", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(calls[0]?.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
  });

  it("routerVersion comes from import (caller-supplied input.routerVersion is ignored)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({ routerVersion: "provider-router@bogus" }),
      makeStores(store),
    );
    expect(calls[0]?.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
  });

  it("shotSpecVersion mirrors input.shotSpecVersion exactly (carries SP3 stamp forward)", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({ shotSpecVersion: "shot-spec@0.5.0" }),
      makeStores(store),
    );
    expect(calls[0]?.shotSpecVersion).toBe("shot-spec@0.5.0");
  });
});

describe("writePcdIdentitySnapshot — Part B: Tier 3 second-line-of-defense", () => {
  it("Tier 1 input → no Tier 3 assertion; persists", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        effectiveTier: 1,
        productTierAtGeneration: 1,
        avatarTierAtGeneration: 1,
        routingDecisionReason: makeReason({ matchedEffectiveTier: 1 }),
      }),
      makeStores(store),
    );
    expect(calls.length).toBe(1);
  });

  it("Tier 3 + compliant capability and matching tier3RulesApplied → persists", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(
      makeInput({
        effectiveTier: 3,
        shotType: "simple_ugc",
        outputIntent: "final_export",
        productTierAtGeneration: 3,
        avatarTierAtGeneration: 3,
        selectedCapability: CAP_ALL,
        editOverRegenerateRequired: false,
        routingDecisionReason: makeReason({
          matchedEffectiveTier: 3,
          tier3RulesApplied: ["first_last_frame_anchor"],
        }),
      }),
      makeStores(store),
    );
    expect(calls.length).toBe(1);
  });

  it("Tier 3 + rule 1 required + capability missing supportsFirstLastFrame → throws Tier3RoutingViolationError; createForShot never called", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsFirstLastFrame: false },
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("Tier 3 + rule 2 required (talking_head) + capability missing supportsPerformanceTransfer → throws", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "talking_head",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsPerformanceTransfer: false },
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedShotType: "talking_head",
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor", "performance_transfer"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("Tier 3 + rule 3 required + capability missing supportsEditExtend → throws", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsEditExtend: false },
          editOverRegenerateRequired: true,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: ["first_last_frame_anchor", "edit_over_regenerate"],
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("BYPASS CLOSURE: editOverRegenerateRequired=true + tier3RulesApplied=[] + supportsEditExtend=false → throws Tier3RoutingViolationError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: { ...CAP_ALL, supportsEditExtend: false },
          editOverRegenerateRequired: true,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: [], // caller suppresses forensic record
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingViolationError);
    expect(calls.length).toBe(0);
  });

  it("FORENSIC MISMATCH: capability OK but tier3RulesApplied diverges from recompute → throws Tier3RoutingMetadataMismatchError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          effectiveTier: 3,
          shotType: "simple_ugc",
          outputIntent: "final_export",
          productTierAtGeneration: 3,
          avatarTierAtGeneration: 3,
          selectedCapability: CAP_ALL,
          editOverRegenerateRequired: false,
          routingDecisionReason: makeReason({
            matchedEffectiveTier: 3,
            tier3RulesApplied: [], // recompute requires rule 1
          }),
        }),
        makeStores(store),
      ),
    ).rejects.toBeInstanceOf(Tier3RoutingMetadataMismatchError);
    expect(calls.length).toBe(0);
  });
});

describe("writePcdIdentitySnapshot — Part C: input validation", () => {
  it("missing routingDecisionReason → ZodError; createForShot not called", async () => {
    const { store, calls } = makeFakeStore();
    const bad = makeInput();
    delete (bad as Partial<WritePcdIdentitySnapshotInput>).routingDecisionReason;
    await expect(writePcdIdentitySnapshot(bad, makeStores(store))).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  it("selectionRationale > 200 chars → ZodError", async () => {
    const { store, calls } = makeFakeStore();
    await expect(
      writePcdIdentitySnapshot(
        makeInput({
          routingDecisionReason: makeReason({ selectionRationale: "x".repeat(201) }),
        }),
        makeStores(store),
      ),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});

describe("writePcdIdentitySnapshot — Part D: persistence shape", () => {
  it("happy path: createForShot called once with all SP4 forensic fields populated non-null", async () => {
    const { store, calls } = makeFakeStore();
    await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(calls.length).toBe(1);
    const c = calls[0];
    expect(c).toBeDefined();
    if (!c) return;
    expect(c.shotSpecVersion).not.toBeNull();
    expect(c.routerVersion).toBe(PCD_PROVIDER_ROUTER_VERSION);
    expect(c.routingDecisionReason).not.toBeNull();
    expect(c.policyVersion).toBe(PCD_TIER_POLICY_VERSION);
    expect(c.providerCapabilityVersion).toBe(PCD_PROVIDER_CAPABILITY_VERSION);
    expect(c.selectedProvider).toBe("test-all");
  });

  it("returns the fake store's response without transformation", async () => {
    const { store, calls } = makeFakeStore();
    const out = await writePcdIdentitySnapshot(makeInput(), makeStores(store));
    expect(out.assetRecordId).toBe(calls[0]?.assetRecordId);
    expect(out.id).toBe("snap-1");
  });
});

describe("Forbidden imports in pcd-identity-snapshot-writer.ts", () => {
  it("contains none of the forbidden import paths and never imports PCD_SHOT_SPEC_VERSION", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "pcd-identity-snapshot-writer.ts"), "utf8");
    expect(src).not.toMatch(/@creativeagent\/db/);
    expect(src).not.toMatch(/@prisma\/client/);
    expect(src).not.toMatch(/from ["']inngest["']/);
    expect(src).not.toMatch(/node:fs/);
    expect(src).not.toMatch(/from ["']http["']/);
    expect(src).not.toMatch(/from ["']https["']/);
    expect(src).not.toMatch(/from ["']\.\/shot-spec-version\.js["']/);
    expect(src).not.toMatch(/PCD_SHOT_SPEC_VERSION/);
  });
});
