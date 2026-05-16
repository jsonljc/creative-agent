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
