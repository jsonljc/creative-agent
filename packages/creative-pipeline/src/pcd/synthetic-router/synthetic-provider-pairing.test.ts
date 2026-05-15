import { describe, expect, it } from "vitest";
import {
  PCD_SYNTHETIC_PROVIDER_PAIRING,
  PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION,
  type SyntheticProviderPairing,
} from "./synthetic-provider-pairing.js";

describe("PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION", () => {
  it('is the literal "pcd-synthetic-provider-pairing@1.0.0"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING_VERSION).toBe("pcd-synthetic-provider-pairing@1.0.0");
  });
});

describe("PCD_SYNTHETIC_PROVIDER_PAIRING — v1 matrix", () => {
  it("has exactly one row", () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING.length).toBe(1);
  });

  it('row 0 imageProvider === "dalle"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].imageProvider).toBe("dalle");
  });

  it('row 0 videoProvider === "kling"', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].videoProvider).toBe("kling");
  });

  it("row 0 shotTypes is exactly the seven video-modality shot types", () => {
    const expected = [
      "simple_ugc",
      "talking_head",
      "product_demo",
      "product_in_hand",
      "face_closeup",
      "label_closeup",
      "object_insert",
    ];
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes].sort()).toEqual([...expected].sort());
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.length).toBe(expected.length);
  });

  it("row 0 outputIntents is exactly the four standard output intents", () => {
    const expected = ["draft", "preview", "final_export", "meta_draft"];
    expect([...PCD_SYNTHETIC_PROVIDER_PAIRING[0].outputIntents].sort()).toEqual(
      [...expected].sort(),
    );
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].outputIntents.length).toBe(expected.length);
  });

  it('row 0 shotTypes does NOT include "script_only" (delegation reachability lock)', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.includes("script_only" as never)).toBe(
      false,
    );
  });

  it('row 0 shotTypes does NOT include "storyboard" (delegation reachability lock)', () => {
    expect(PCD_SYNTHETIC_PROVIDER_PAIRING[0].shotTypes.includes("storyboard" as never)).toBe(false);
  });

  it("matrix entries are typed as SyntheticProviderPairing (compile-time + runtime check on shape keys)", () => {
    const row: SyntheticProviderPairing = PCD_SYNTHETIC_PROVIDER_PAIRING[0];
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(["imageProvider", "outputIntents", "shotTypes", "videoProvider"]);
  });
});
