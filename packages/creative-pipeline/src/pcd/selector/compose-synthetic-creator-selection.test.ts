import { describe, expect, it, vi } from "vitest";
import {
  PCD_PERFORMANCE_OVERLAY_VERSION,
  type CreativeBrief,
  type CreatorIdentityLicensePayload,
  type CreatorPerformanceMetrics,
} from "@creativeagent/schemas";
import { SP11_SYNTHETIC_CREATOR_ROSTER } from "../synthetic-creator/seed.js";
import type {
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
  SyntheticCreatorRosterReader,
} from "../synthetic-creator/synthetic-creator-selection-ports.js";
import { composeSyntheticCreatorSelection } from "./compose-synthetic-creator-selection.js";

function buildBrief(overrides: Partial<CreativeBrief> = {}): CreativeBrief {
  // Field shape mirrors the canonical brief used in
  // packages/creative-pipeline/src/pcd/selector/selector.test.ts
  // (`briefForCheryl`). If `CreativeBrief` gains additional required fields
  // in the future, mirror them from that same file.
  //
  // Match the first SP11 SG/med_spa entry so the happy path produces a
  // non-empty compatible set without depending on every seed dimension.
  const cheryl = SP11_SYNTHETIC_CREATOR_ROSTER.find(
    (e) => e.creatorIdentity.id === "cid_synth_cheryl_sg_01",
  )!;
  return {
    briefId: "brief_sp21_happy",
    clinicId: "clinic_sp21_happy",
    treatmentClass: cheryl.synthetic.treatmentClass,
    market: cheryl.synthetic.market,
    jurisdictionCode: "SG",
    platform: "tiktok",
    targetVibe: cheryl.synthetic.vibe,
    targetEthnicityFamily: cheryl.synthetic.ethnicityFamily,
    targetAgeBand: cheryl.synthetic.ageBand,
    pricePositioning: cheryl.synthetic.pricePositioning,
    hardConstraints: [],
    ...overrides,
  };
}

function buildLease(
  creatorIdentityId: string,
  overrides: Partial<CreatorIdentityLicensePayload> = {},
): CreatorIdentityLicensePayload {
  return {
    id: `lic_${creatorIdentityId}`,
    creatorIdentityId,
    clinicId: "clinic_sp21_happy",
    market: "SG",
    treatmentClass: "med_spa",
    lockType: "priority_access",
    exclusivityScope: "clinic",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
    priorityRank: 1,
    status: "active",
    ...overrides,
  };
}

function buildMetrics(
  creatorIdentityId: string,
  sampleSize: number,
  successRate: number,
  windowStart: Date,
  windowEnd: Date,
): CreatorPerformanceMetrics {
  const successCount = Math.round(sampleSize * successRate);
  return {
    creatorIdentityId,
    sampleSize,
    successCount,
    failureCount: sampleSize - successCount,
    manualSkipCount: 0,
    successRate,
    medianLatencyMs: 4200,
    windowStart,
    windowEnd,
    metricsVersion: PCD_PERFORMANCE_OVERLAY_VERSION,
  };
}

describe("composeSyntheticCreatorSelection — happy path", () => {
  it("calls all three readers, threads result into the selector, returns an allowed decision", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();

    // SP11 seed already filtered down to the compatible roster shape — use it.
    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi
        .fn()
        .mockResolvedValue(
          SP11_SYNTHETIC_CREATOR_ROSTER.filter(
            (e) =>
              e.synthetic.status === "active" &&
              e.synthetic.market === brief.market &&
              e.synthetic.treatmentClass === brief.treatmentClass,
          ),
        ),
    };

    // One lease per candidate so the license gate passes for each.
    const leases = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    ).map((e) => buildLease(e.creatorIdentity.id));

    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };

    const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = now;
    const metricsMap = new Map<string, CreatorPerformanceMetrics>();
    for (const lease of leases) {
      metricsMap.set(
        lease.creatorIdentityId,
        buildMetrics(lease.creatorIdentityId, 10, 0.7, windowStart, windowEnd),
      );
    }
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockResolvedValue(metricsMap),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(rosterReader.listActiveCompatibleRoster).toHaveBeenCalledOnce();
    expect(leaseReader.findActiveLeasesForBriefScope).toHaveBeenCalledOnce();
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledOnce();

    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      expect(decision.performanceOverlayApplied).toBe(true);
      expect(decision.metricsSnapshotVersion).toBe(PCD_PERFORMANCE_OVERLAY_VERSION);
      expect(decision.briefId).toBe(brief.briefId);
    }
  });
});

describe("composeSyntheticCreatorSelection — empty roster short-circuit", () => {
  it("does not call lease or metrics readers when roster is empty; selector returns no_compatible_candidates", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_empty_roster" });

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue([]),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn(),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(rosterReader.listActiveCompatibleRoster).toHaveBeenCalledOnce();
    expect(leaseReader.findActiveLeasesForBriefScope).not.toHaveBeenCalled();
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();

    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("no_compatible_candidates");
      expect(decision.briefId).toBe("brief_sp21_empty_roster");
    }
  });
});

describe("composeSyntheticCreatorSelection — empty leases", () => {
  it("calls metrics reader; selector returns all_blocked_by_license", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_empty_leases" });

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue([]),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi
        .fn()
        .mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(leaseReader.findActiveLeasesForBriefScope).toHaveBeenCalledOnce();
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledOnce();

    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) {
      expect(decision.reason).toBe("all_blocked_by_license");
    }
  });
});

describe("composeSyntheticCreatorSelection — empty metrics (cold start)", () => {
  it("passes empty performanceHistory Map to selector; performanceOverlayApplied=true; metricsSnapshotVersion=null when map is empty", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief({ briefId: "brief_sp21_cold_metrics" });

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi
        .fn()
        .mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    const decision = await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    expect(decision.allowed).toBe(true);
    if (decision.allowed === true) {
      // performanceOverlayApplied tracks "did the composer supply a map?"
      // — yes, even though the map is empty. (Selector's resolveMetricsVersion
      // returns null on an empty map per its reader contract.)
      expect(decision.performanceOverlayApplied).toBe(true);
      expect(decision.metricsSnapshotVersion).toBeNull();
    }
  });
});

describe("composeSyntheticCreatorSelection — reader-throw propagation", () => {
  it("rethrows when rosterReader fails; lease + metrics readers not called", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("roster boom");

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockRejectedValue(bang),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn(),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
    expect(leaseReader.findActiveLeasesForBriefScope).not.toHaveBeenCalled();
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();
  });

  it("rethrows when leaseReader fails; metrics reader not called", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("lease boom");

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockRejectedValue(bang),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn(),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
    expect(metricsReader.findMetricsForCreators).not.toHaveBeenCalled();
  });

  it("rethrows when metricsReader fails", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const bang = new Error("metrics boom");

    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi.fn().mockRejectedValue(bang),
    };

    await expect(
      composeSyntheticCreatorSelection(
        { brief, now },
        { rosterReader, leaseReader, metricsReader },
      ),
    ).rejects.toBe(bang);
  });
});

describe("composeSyntheticCreatorSelection — metrics window + ids contract", () => {
  it("calls metrics reader with window.since = input.now - 30 days and ids matching the roster", async () => {
    const now = new Date("2026-05-16T12:00:00.000Z");
    const brief = buildBrief();
    const compatibleRoster = SP11_SYNTHETIC_CREATOR_ROSTER.filter(
      (e) =>
        e.synthetic.status === "active" &&
        e.synthetic.market === brief.market &&
        e.synthetic.treatmentClass === brief.treatmentClass,
    );
    const leases = compatibleRoster.map((e) => buildLease(e.creatorIdentity.id));

    const rosterReader: SyntheticCreatorRosterReader = {
      listActiveCompatibleRoster: vi.fn().mockResolvedValue(compatibleRoster),
    };
    const leaseReader: SyntheticCreatorLeaseReader = {
      findActiveLeasesForBriefScope: vi.fn().mockResolvedValue(leases),
    };
    const metricsReader: SyntheticCreatorMetricsReader = {
      findMetricsForCreators: vi
        .fn()
        .mockResolvedValue(new Map<string, CreatorPerformanceMetrics>()),
    };

    await composeSyntheticCreatorSelection(
      { brief, now },
      { rosterReader, leaseReader, metricsReader },
    );

    const expectedSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(metricsReader.findMetricsForCreators).toHaveBeenCalledWith({
      creatorIdentityIds: compatibleRoster.map((e) => e.creatorIdentity.id),
      window: { since: expectedSince },
    });
  });
});
