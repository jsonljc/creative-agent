import { describe, expect, it } from "vitest";
import {
  PcdSp18SyntheticRoutingDecisionReasonSchema,
  PcdSp18SyntheticRoutingProvenancePayloadSchema,
} from "../pcd-synthetic-routing-provenance.js";

const klingDirectionFixture = {
  setting: "studio-bright",
  motion: "subtle-dolly",
  energy: "calm",
  lighting: "soft",
  avoid: ["shaky-cam"],
} as const;

const seedanceDirectionFixture = {
  setting: "outdoor-natural",
  motion: "handheld-organic",
  energy: "lively",
  lighting: "golden-hour",
  avoid: ["jump-cuts"],
} as const;

const innerDecisionReasonFixture = {
  matchedShotType: "simple_ugc",
  matchedOutputIntent: "draft",
  selectionRationale: "synthetic-pairing tier=3 shot=simple_ugc intent=draft → dalle+kling",
} as const;

const decidedAt = "2026-05-16T08:00:00.000Z";
const provenanceVersion = "pcd-synthetic-routing-provenance@1.0.0";
const promptHash = "a".repeat(64);

const klingReason = {
  videoProvider: "kling" as const,
  klingDirection: klingDirectionFixture,
  pairingRefIndex: 0,
  decisionReason: innerDecisionReasonFixture,
  decidedAt,
  syntheticRoutingProvenanceVersion: provenanceVersion,
};

const seedanceReason = {
  videoProvider: "seedance" as const,
  seedanceDirection: seedanceDirectionFixture,
  pairingRefIndex: 1,
  decisionReason: innerDecisionReasonFixture,
  decidedAt,
  syntheticRoutingProvenanceVersion: provenanceVersion,
};

const klingPayload = {
  imageProvider: "dalle" as const,
  videoProvider: "kling" as const,
  videoProviderChoice: "kling" as const,
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  promptHash,
  syntheticRoutingDecisionReason: klingReason,
};

const seedancePayload = {
  imageProvider: "dalle" as const,
  videoProvider: "seedance" as const,
  videoProviderChoice: "seedance" as const,
  syntheticRouterVersion: "pcd-synthetic-router@1.1.0",
  syntheticPairingVersion: "pcd-synthetic-provider-pairing@1.1.0",
  promptHash,
  syntheticRoutingDecisionReason: seedanceReason,
};

describe("PcdSp18SyntheticRoutingDecisionReasonSchema", () => {
  it("round-trips a kling-success reason", () => {
    expect(PcdSp18SyntheticRoutingDecisionReasonSchema.parse(klingReason)).toEqual(klingReason);
  });

  it("round-trips a seedance-success reason", () => {
    expect(PcdSp18SyntheticRoutingDecisionReasonSchema.parse(seedanceReason)).toEqual(
      seedanceReason,
    );
  });

  it("rejects kling reason carrying seedanceDirection", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        seedanceDirection: seedanceDirectionFixture,
      }),
    ).toThrow();
  });

  it("rejects seedance reason carrying klingDirection", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...seedanceReason,
        klingDirection: klingDirectionFixture,
      }),
    ).toThrow();
  });

  it("rejects missing videoProvider", () => {
    const { videoProvider: _vp, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects videoProvider: 'other'", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        videoProvider: "other",
      }),
    ).toThrow();
  });

  it("rejects missing syntheticRoutingProvenanceVersion", () => {
    const { syntheticRoutingProvenanceVersion: _v, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects missing decidedAt", () => {
    const { decidedAt: _d, ...rest } = klingReason;
    expect(() => PcdSp18SyntheticRoutingDecisionReasonSchema.parse(rest)).toThrow();
  });

  it("rejects non-ISO decidedAt", () => {
    expect(() =>
      PcdSp18SyntheticRoutingDecisionReasonSchema.parse({
        ...klingReason,
        decidedAt: "2026-05-16 08:00:00",
      }),
    ).toThrow();
  });
});

describe("PcdSp18SyntheticRoutingProvenancePayloadSchema", () => {
  it("round-trips a kling payload", () => {
    expect(PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(klingPayload)).toEqual(
      klingPayload,
    );
  });

  it("round-trips a seedance payload", () => {
    expect(PcdSp18SyntheticRoutingProvenancePayloadSchema.parse(seedancePayload)).toEqual(
      seedancePayload,
    );
  });

  it("rejects payload with imageProvider other than 'dalle'", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        imageProvider: "other",
      }),
    ).toThrow();
  });

  it("rejects payload with promptHash not 64-hex-char", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        promptHash: "tooshort",
      }),
    ).toThrow();
  });

  it("rejects payload with uppercase promptHash", () => {
    expect(() =>
      PcdSp18SyntheticRoutingProvenancePayloadSchema.parse({
        ...klingPayload,
        promptHash: "A".repeat(64),
      }),
    ).toThrow();
  });

  it("rejects payload where flat videoProvider mismatches reason videoProvider (cross-field refine)", () => {
    const corrupt = { ...klingPayload, videoProvider: "seedance" as const };
    const result = PcdSp18SyntheticRoutingProvenancePayloadSchema.safeParse(corrupt);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "syntheticRoutingDecisionReason",
        "videoProvider",
      ]);
    }
  });
});
