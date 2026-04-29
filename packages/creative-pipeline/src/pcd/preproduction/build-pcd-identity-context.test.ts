import { describe, expect, it } from "vitest";
import { ConsentRevokedRefusalError } from "../consent-revocation-error.js";
import { InvariantViolationError } from "../invariant-violation-error.js";
import { PcdIdentityContextSchema, type PcdBriefInput } from "@creativeagent/schemas";
import { buildPcdIdentityContext } from "./build-pcd-identity-context.js";
import { PCD_IDENTITY_CONTEXT_VERSION } from "./identity-context-version.js";

const validBrief: PcdBriefInput = {
  briefId: "brief-1",
  productDescription: "AI lead reply assistant",
  targetAudience: "solo founders",
  platforms: ["instagram_reels", "tiktok"],
  brandVoice: null,
  references: [],
  creatorIdentityRef: "creator-1",
  productIdentityRef: "product-1",
};

function fakeStores(
  opts: {
    productQuality?: "url_imported" | "verified" | "canonical";
    creatorQuality?: "stock" | "anchored" | "soul_id";
    productNotFound?: boolean;
    creatorNotFound?: boolean;
    creatorConsentRecordId?: string | null;
    consentRevoked?: boolean;
  } = {},
) {
  const productQuality = opts.productQuality ?? "verified";
  const creatorQuality = opts.creatorQuality ?? "anchored";
  const consentRecordId = opts.creatorConsentRecordId ?? null;

  return {
    sp7ProductRegistryReader: {
      async findById(id: string) {
        if (opts.productNotFound) return null;
        if (id !== "product-1") return null;
        return {
          id: "product-1",
          qualityTier: productQuality,
          canonicalPackageText: "ACME Pro",
          heroPackshotAssetId: "asset-hero-1",
          brandPositioningText: null,
        };
      },
    },
    sp7CreatorRegistryReader: {
      async findById(id: string) {
        if (opts.creatorNotFound) return null;
        if (id !== "creator-1") return null;
        return {
          id: "creator-1",
          qualityTier: creatorQuality,
          voiceId: "voice-1",
          consentRecordId,
        };
      },
    },
    creatorIdentityReader: {
      async findById(id: string) {
        if (opts.creatorNotFound) return null;
        if (id !== "creator-1") return null;
        return { id: "creator-1", consentRecordId };
      },
    },
    consentRecordReader: {
      async findById(id: string) {
        if (id === consentRecordId && consentRecordId !== null) {
          return {
            id,
            revoked: opts.consentRevoked ?? false,
            revokedAt: opts.consentRevoked ? new Date() : null,
          };
        }
        return null;
      },
    },
  };
}

describe("buildPcdIdentityContext", () => {
  it("returns a frozen, schema-valid context for a clean brief at tier 2/2", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(PcdIdentityContextSchema.safeParse(ctx).success).toBe(true);
    expect(ctx.creatorIdentityId).toBe("creator-1");
    expect(ctx.productIdentityId).toBe("product-1");
    expect(ctx.effectiveTier).toBe(2);
    expect(ctx.productTierAtResolution).toBe(2);
    expect(ctx.creatorTierAtResolution).toBe(2);
    expect(ctx.identityContextVersion).toBe(PCD_IDENTITY_CONTEXT_VERSION);
  });

  it("propagates ZodError raw on invalid brief (does NOT wrap)", async () => {
    await expect(
      buildPcdIdentityContext({ ...validBrief, briefId: "" } as PcdBriefInput, fakeStores()),
    ).rejects.toThrow(/briefId|String must contain at least 1/i);
  });

  it("throws InvariantViolationError when product registry returns null", async () => {
    await expect(
      buildPcdIdentityContext(validBrief, fakeStores({ productNotFound: true })),
    ).rejects.toThrow(InvariantViolationError);
  });

  it("throws InvariantViolationError when creator registry returns null", async () => {
    await expect(
      buildPcdIdentityContext(validBrief, fakeStores({ creatorNotFound: true })),
    ).rejects.toThrow(InvariantViolationError);
  });

  it("propagates ConsentRevokedRefusalError when SP6 pre-check fails", async () => {
    await expect(
      buildPcdIdentityContext(
        validBrief,
        fakeStores({
          creatorConsentRecordId: "consent-1",
          consentRevoked: true,
        }),
      ),
    ).rejects.toThrow(ConsentRevokedRefusalError);
  });

  it("computes effectiveTier = min(productTier, creatorTier)", async () => {
    const ctx = await buildPcdIdentityContext(
      validBrief,
      fakeStores({ productQuality: "url_imported", creatorQuality: "soul_id" }),
    );
    expect(ctx.productTierAtResolution).toBe(1);
    expect(ctx.creatorTierAtResolution).toBe(3);
    expect(ctx.effectiveTier).toBe(1);
  });

  it("at effectiveTier=3 sets all tier3Rules flags true (with talking_head allowed)", async () => {
    const ctx = await buildPcdIdentityContext(
      validBrief,
      fakeStores({ productQuality: "canonical", creatorQuality: "soul_id" }),
    );
    expect(ctx.effectiveTier).toBe(3);
    expect(ctx.tier3Rules.firstLastFrameRequired).toBe(true);
    expect(ctx.tier3Rules.editOverRegenerateRequired).toBe(true);
    // performanceTransferRequired is conditional on talking_head being in allowedShotTypes,
    // which it is at tier 3.
    expect(ctx.tier3Rules.performanceTransferRequired).toBe(true);
  });

  it("at effectiveTier<3 sets all tier3Rules flags false", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.tier3Rules.firstLastFrameRequired).toBe(false);
    expect(ctx.tier3Rules.performanceTransferRequired).toBe(false);
    expect(ctx.tier3Rules.editOverRegenerateRequired).toBe(false);
  });

  it("populates ugcStyleConstraints with the full five-value enum list", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.ugcStyleConstraints).toEqual([
      "native_vertical",
      "creator_led",
      "no_overproduced_storyboard",
      "product_fidelity_required",
      "no_invented_product_claims",
    ]);
  });

  it("reads creative substrate (voiceId, productCanonicalText, heroPackshotAssetId)", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.voiceId).toBe("voice-1");
    expect(ctx.productCanonicalText).toBe("ACME Pro");
    expect(ctx.productHeroPackshotAssetId).toBe("asset-hero-1");
  });

  it("forwards consentRevoked=false when consent is intact", async () => {
    const ctx = await buildPcdIdentityContext(validBrief, fakeStores());
    expect(ctx.consentRevoked).toBe(false);
  });
});
