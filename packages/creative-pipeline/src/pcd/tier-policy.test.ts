import { describe, expect, it } from "vitest";
import { PCD_TIER_POLICY_VERSION, decidePcdGenerationAccess } from "./tier-policy.js";
import type { PcdShotType, PcdTierDecision } from "@creativeagent/schemas";

describe("PCD_TIER_POLICY_VERSION", () => {
  it("is locked to tier-policy@1.0.0 (SP4 snapshot writer pins this value)", () => {
    expect(PCD_TIER_POLICY_VERSION).toBe("tier-policy@1.0.0");
  });
});

describe("decidePcdGenerationAccess (smoke)", () => {
  it("is callable", () => {
    const decision = decidePcdGenerationAccess({
      shotType: "simple_ugc",
      outputIntent: "draft",
    });
    expect(decision.allowed).toBe(true);
  });
});

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

describe("PcdTierPolicy — spec-required acceptance assertions", () => {
  it("1. Tier 3 avatar + Tier 1 product cannot final_export", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 1,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBe(1);
    expect(d.requiredProductTier).toBe(2);
    expect(d.requiredActions).toContain("upgrade_product_identity");
    expect(d.requiredActions).toContain("use_lower_output_intent");
  });

  it("2. Tier 1 avatar + Tier 3 product cannot final_export", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 3,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.effectiveTier).toBe(1);
    expect(d.requiredAvatarTier).toBe(2);
    expect(d.requiredActions).toContain("upgrade_avatar_identity");
    expect(d.requiredActions).toContain("use_lower_output_intent");
  });

  it("3. Tier 2 + Tier 2 can standard final_export (non-restricted shot)", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "final_export",
    });
    expect(d).toEqual({ allowed: true, effectiveTier: 2 });
  });

  it("4. label_closeup requires productTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 2,
      shotType: "label_closeup",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredProductTier).toBe(3);

    const allowed = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 3,
      shotType: "label_closeup",
      outputIntent: "preview",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 3 });
  });

  it("5. face_closeup requires avatarTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 3,
      shotType: "face_closeup",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredAvatarTier).toBe(3);

    const allowed = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 3,
      shotType: "face_closeup",
      outputIntent: "preview",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 3 });
  });

  it("6. object_insert requires productTier=3", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 3,
      productTier: 2,
      shotType: "object_insert",
      outputIntent: "preview",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredProductTier).toBe(3);
  });

  it("7. meta_draft requires effectiveTier>=2; SP2 does NOT enforce approval/compliance (SP6 owns those)", () => {
    const blocked = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "meta_draft",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiredAvatarTier).toBe(2);

    // Tier-sufficient meta_draft passes the SP2 gate. SP6 layers approval + compliance.
    const allowed = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "meta_draft",
    });
    expect(allowed).toEqual({ allowed: true, effectiveTier: 2 });
  });

  it("8. outputIntent=draft is always allowed regardless of tier", () => {
    for (const a of [undefined, 1, 2, 3] as const) {
      for (const p of [undefined, 1, 2, 3] as const) {
        for (const shotType of ALL_SHOT_TYPES) {
          const d: PcdTierDecision = decidePcdGenerationAccess({
            avatarTier: a,
            productTier: p,
            shotType,
            outputIntent: "draft",
          });
          expect(d.allowed).toBe(true);
          expect(Object.keys(d).sort()).toEqual(["allowed", "effectiveTier"]);
        }
      }
    }
  });
});
