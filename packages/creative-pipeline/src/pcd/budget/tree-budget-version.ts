// SP10B — 14th pinned constant in the PCD slice. Sole import site is
// tree-shape-validator.ts (composer-only pinning lock — sp10b-anti-patterns
// test #1 enforces). DO NOT import this constant anywhere else; the literal
// "pcd-tree-budget@" must not appear in any other source file.
export const PCD_TREE_BUDGET_VERSION = "pcd-tree-budget@1.0.0";
