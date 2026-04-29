import { describe, expect, it } from "vitest";
import { PCD_CONSENT_REVOCATION_VERSION } from "./consent-revocation-version.js";
import {
  propagateConsentRevocation,
  type ConsentRevocationStore,
} from "./consent-revocation.js";
import { InvariantViolationError } from "./invariant-violation-error.js";
import type { ConsentRecordReader } from "./lifecycle-readers.js";

const reader = <T>(row: T) => async () => row;

class MemoryConsentRevocationStore implements ConsentRevocationStore {
  constructor(
    private byConsent: Map<string, string[]>,
    private flagged: Set<string> = new Set(),
  ) {}
  async findAssetIdsByRevokedConsent(consentRecordId: string): Promise<string[]> {
    return [...(this.byConsent.get(consentRecordId) ?? [])].sort();
  }
  async markAssetsConsentRevokedAfterGeneration(
    assetRecordIds: string[],
  ): Promise<{ newlyFlagged: string[]; alreadyFlagged: string[] }> {
    const newly: string[] = [];
    const already: string[] = [];
    for (const id of assetRecordIds) {
      if (this.flagged.has(id)) already.push(id);
      else {
        this.flagged.add(id);
        newly.push(id);
      }
    }
    return { newlyFlagged: newly.sort(), alreadyFlagged: already.sort() };
  }
}

const revokedConsent = (id: string) => ({ id, revoked: true, revokedAt: new Date("2026-04-29T00:00:00Z") });

describe("propagateConsentRevocation", () => {
  it("flags all matching assets when none yet flagged", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", ["a3", "a1", "a2"]]]));
    const result = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(result.consentRecordId).toBe("consent_1");
    expect(result.assetIdsFlagged).toEqual(["a1", "a2", "a3"]);
    expect(result.assetIdsAlreadyFlagged).toEqual([]);
    expect(result.consentRevocationVersion).toBe(PCD_CONSENT_REVOCATION_VERSION);
  });

  it("partitions newly-flagged vs already-flagged", async () => {
    const store = new MemoryConsentRevocationStore(
      new Map([["consent_1", ["a1", "a2", "a3"]]]),
      new Set(["a1", "a3"]),
    );
    const result = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(result.assetIdsFlagged).toEqual(["a2"]);
    expect(result.assetIdsAlreadyFlagged).toEqual(["a1", "a3"]);
  });

  it("is idempotent (second run flags zero, repeats already-flagged set)", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", ["a1", "a2"]]]));
    await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    const second = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(second.assetIdsFlagged).toEqual([]);
    expect(second.assetIdsAlreadyFlagged).toEqual(["a1", "a2"]);
  });

  it("returns sorted ids in both partitions", async () => {
    const store = new MemoryConsentRevocationStore(
      new Map([["consent_1", ["az", "ab", "aa"]]]),
      new Set(["az"]),
    );
    const r = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(r.assetIdsFlagged).toEqual(["aa", "ab"]);
    expect(r.assetIdsAlreadyFlagged).toEqual(["az"]);
  });

  it("empty matching set produces empty result (no error)", async () => {
    const store = new MemoryConsentRevocationStore(new Map([["consent_1", []]]));
    const r = await propagateConsentRevocation(
      { consentRecordId: "consent_1" },
      {
        consentRecordReader: { findById: reader(revokedConsent("consent_1")) } as ConsentRecordReader,
        consentRevocationStore: store,
      },
    );
    expect(r.assetIdsFlagged).toEqual([]);
    expect(r.assetIdsAlreadyFlagged).toEqual([]);
  });

  it("throws InvariantViolationError when ConsentRecord is missing", async () => {
    const store = new MemoryConsentRevocationStore(new Map());
    await expect(
      propagateConsentRevocation(
        { consentRecordId: "consent_1" },
        {
          consentRecordReader: { findById: reader(null) } as ConsentRecordReader,
          consentRevocationStore: store,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it("throws InvariantViolationError when ConsentRecord exists but revoked === false (caller misuse)", async () => {
    const store = new MemoryConsentRevocationStore(new Map());
    await expect(
      propagateConsentRevocation(
        { consentRecordId: "consent_1" },
        {
          consentRecordReader: {
            findById: reader({ id: "consent_1", revoked: false, revokedAt: null }),
          } as ConsentRecordReader,
          consentRevocationStore: store,
        },
      ),
    ).rejects.toBeInstanceOf(InvariantViolationError);
  });
});
