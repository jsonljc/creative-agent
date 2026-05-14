// SP10C — 15th pinned constant in the PCD slice. Sole import site is
// cost-budget-validator.ts (composer-only pinning lock — sp10c-anti-patterns
// test #1 enforces). DO NOT import this constant anywhere else; the literal
// "pcd-cost-budget@" must not appear in any other source file.
export const PCD_COST_BUDGET_VERSION = "pcd-cost-budget@1.0.0";
