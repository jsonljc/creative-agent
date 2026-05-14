// SP10A — pinned version constant for per-asset cost-forecast forensics.
// 13th pinned constant in the PCD slice. Caller cannot override; pinned by
// stamp-pcd-cost-forecast.ts from import. Bumped independently of
// PCD_PROVENANCE_VERSION so cost-shape evolution is decoupled from
// lineage-shape evolution.
export const PCD_COST_FORECAST_VERSION = "pcd-cost-forecast@1.0.0";
