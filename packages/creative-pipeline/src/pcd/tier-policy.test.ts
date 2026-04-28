import { describe, expect, it } from "vitest";
import { PCD_TIER_POLICY_VERSION, decidePcdGenerationAccess } from "./tier-policy.js";
import { PcdTierDecisionSchema } from "@creativeagent/schemas";
import type { OutputIntent as OI, PcdShotType, PcdTierDecision } from "@creativeagent/schemas";

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

type AvatarTierInput = 1 | 2 | 3 | undefined;
type ProductTierInput = 1 | 2 | 3 | undefined;

const ALL_OUTPUT_INTENTS: OI[] = ["draft", "preview", "final_export", "meta_draft"];

// Test-local rule tables. DO NOT import from tier-policy.ts.
const SHOT_TYPE_REQ: Record<PcdShotType, { avatar?: 2 | 3; product?: 2 | 3 }> = {
  script_only: {},
  storyboard: {},
  simple_ugc: {},
  talking_head: {},
  product_demo: {},
  product_in_hand: {},
  face_closeup: { avatar: 3 },
  label_closeup: { product: 3 },
  object_insert: { product: 3 },
};

const INTENT_REQ: Record<OI, { effective?: 2 } | "draft_shortcut"> = {
  draft: "draft_shortcut",
  preview: {},
  final_export: { effective: 2 },
  meta_draft: { effective: 2 },
};

function expectedDecision(
  avatarTier: AvatarTierInput,
  productTier: ProductTierInput,
  shotType: PcdShotType,
  outputIntent: OI,
): PcdTierDecision {
  const a = (avatarTier ?? 1) as 1 | 2 | 3;
  const p = (productTier ?? 1) as 1 | 2 | 3;
  const effectiveTier = (a <= p ? a : p) as 1 | 2 | 3;

  if (INTENT_REQ[outputIntent] === "draft_shortcut") {
    return { allowed: true, effectiveTier };
  }

  const shot = SHOT_TYPE_REQ[shotType];
  const intent = INTENT_REQ[outputIntent] as { effective?: 2 };

  let reqA: 1 | 2 | 3 = 1;
  let reqP: 1 | 2 | 3 = 1;
  if (shot.avatar) reqA = shot.avatar;
  if (shot.product) reqP = shot.product;
  if (intent.effective === 2) {
    if (reqA < 2) reqA = 2;
    if (reqP < 2) reqP = 2;
  }

  const actions: string[] = [];
  if (a < reqA) actions.push("upgrade_avatar_identity");
  if (p < reqP) actions.push("upgrade_product_identity");
  if (
    (outputIntent === "final_export" || outputIntent === "meta_draft") &&
    effectiveTier < 2
  ) {
    actions.push("use_lower_output_intent");
  }

  if (actions.length === 0) return { allowed: true, effectiveTier };

  const reason =
    reqA > 1 && reqP > 1
      ? `generation requires avatarTier>=${reqA} and productTier>=${reqP}`
      : reqA > 1
        ? `generation requires avatarTier>=${reqA}`
        : `generation requires productTier>=${reqP}`;

  return {
    allowed: false,
    effectiveTier,
    requiredAvatarTier: reqA,
    requiredProductTier: reqP,
    reason,
    requiredActions: actions as PcdTierDecision["requiredActions"],
  };
}

const TIER_INPUTS: AvatarTierInput[] = [undefined, 1, 2, 3];

const MATRIX_ROWS: Array<{
  a: AvatarTierInput;
  p: ProductTierInput;
  s: PcdShotType;
  i: OI;
  expected: PcdTierDecision;
}> = [];
for (const a of TIER_INPUTS) {
  for (const p of TIER_INPUTS) {
    for (const s of ALL_SHOT_TYPES) {
      for (const i of ALL_OUTPUT_INTENTS) {
        MATRIX_ROWS.push({ a, p, s, i, expected: expectedDecision(a, p, s, i) });
      }
    }
  }
}

describe("PcdTierPolicy — full cross-product matrix (576 cases)", () => {
  it.each(MATRIX_ROWS)(
    "a=$a p=$p shot=$s intent=$i",
    ({ a, p, s, i, expected }) => {
      const actual = decidePcdGenerationAccess({
        avatarTier: a,
        productTier: p,
        shotType: s,
        outputIntent: i,
      });
      expect(actual).toEqual(expected);
    },
  );

  it("matrix size is exactly 576", () => {
    expect(MATRIX_ROWS.length).toBe(576);
  });
});

describe("PcdTierPolicy — contract & shape", () => {
  it("determinism smoke: two calls with the same blocked input return deeply equal results", () => {
    const input = {
      avatarTier: 1,
      productTier: 1,
      shotType: "face_closeup",
      outputIntent: "final_export",
    } as const;
    const a = decidePcdGenerationAccess(input);
    const b = decidePcdGenerationAccess(input);
    expect(a).toEqual(b);
  });

  it("determinism smoke: two calls with the same allowed input return deeply equal results", () => {
    const input = {
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "preview",
    } as const;
    const a = decidePcdGenerationAccess(input);
    const b = decidePcdGenerationAccess(input);
    expect(a).toEqual(b);
  });

  it("allowed decision shape is minimal: only allowed + effectiveTier", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 2,
      productTier: 2,
      shotType: "simple_ugc",
      outputIntent: "preview",
    });
    expect(Object.keys(d).sort()).toEqual(["allowed", "effectiveTier"]);
  });

  it("blocked decision: requiredActions are deduplicated and in canonical order", () => {
    const d = decidePcdGenerationAccess({
      avatarTier: 1,
      productTier: 1,
      shotType: "face_closeup",
      outputIntent: "final_export",
    });
    expect(d.allowed).toBe(false);
    expect(d.requiredActions).toEqual([
      "upgrade_avatar_identity",
      "upgrade_product_identity",
      "use_lower_output_intent",
    ]);
  });

  describe("reason-string rule", () => {
    it("both tiers above 1 required", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 1,
        productTier: 1,
        shotType: "face_closeup",
        outputIntent: "final_export",
      });
      expect(d.reason).toBe("generation requires avatarTier>=3 and productTier>=2");
    });

    it("only avatar required above 1", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 1,
        productTier: 3,
        shotType: "face_closeup",
        outputIntent: "preview",
      });
      expect(d.reason).toBe("generation requires avatarTier>=3");
    });

    it("only product required above 1", () => {
      const d = decidePcdGenerationAccess({
        avatarTier: 3,
        productTier: 1,
        shotType: "label_closeup",
        outputIntent: "preview",
      });
      expect(d.reason).toBe("generation requires productTier>=3");
    });
  });

  it("schema round-trip: every matrix output passes PcdTierDecisionSchema.parse", () => {
    for (const row of MATRIX_ROWS) {
      const actual = decidePcdGenerationAccess({
        avatarTier: row.a,
        productTier: row.p,
        shotType: row.s,
        outputIntent: row.i,
      });
      expect(() => PcdTierDecisionSchema.parse(actual)).not.toThrow();
    }
  });
});
