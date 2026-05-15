import { describe, expect, it } from "vitest";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
} from "./synthetic-provider-pairing.js";

describe("PCD_SYNTHETIC_PROVIDER_PAIRING (SP17 v2 — kling + seedance)", () => {
  it("has exactly two rows", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(2);
  });

  it("row 0 is the kling pairing", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].imageProvider).toBe("dalle");
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].videoProvider).toBe("kling");
  });

  it("row 1 is the seedance pairing", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[1].imageProvider).toBe("dalle");
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[1].videoProvider).toBe("seedance");
  });

  it("both rows cover the seven video shot types (set equality)", () => {
    const expected = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect([...row.shotTypes].sort()).toEqual([...expected].sort());
    }
  });

  it("both rows cover the four standard output intents (set equality)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect([...row.outputIntents].sort()).toEqual(
        ["draft", "final_export", "meta_draft", "preview"].sort(),
      );
    }
  });

  it("script_only is NOT in either row's shotTypes (delegation reachability)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.shotTypes).not.toContain("script_only");
    }
  });

  it("storyboard is NOT in either row's shotTypes (delegation reachability)", () => {
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(row.shotTypes).not.toContain("storyboard");
    }
  });

  it("matrix's videoProvider set is exactly {kling, seedance}", () => {
    const providers = new Set(PCD_SYNTHETIC_PROVIDER_PAIRING.map((r) => r.videoProvider));
    expect(providers).toEqual(new Set(["kling", "seedance"]));
  });

  it("rows are distinct objects (no shared reference)", () => {
    expect(Object.is(PCD_SYNTHETIC_PROVIDER_PAIRING[0], PCD_SYNTHETIC_PROVIDER_PAIRING[1])).toBe(
      false,
    );
  });

  it("no third row exists (no accidental scaffolding for future modalities)", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[2]).toBeUndefined();
  });

  it("every row has exactly the SyntheticProviderPairing key set (no extra/missing fields)", () => {
    const expectedKeys = ["imageProvider", "outputIntents", "shotTypes", "videoProvider"];
    for (const row of PCD_SYNTHETIC_PROVIDER_PAIRING) {
      expect(Object.keys(row).sort()).toEqual([...expectedKeys].sort());
    }
  });

  it('PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION is the literal "pcd-synthetic-provider-pairing@1.1.0"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION).toBe("pcd-synthetic-provider-pairing@1.1.0");
  });
});
