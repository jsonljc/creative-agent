// SP20 — sole literal site for the performance-overlay pinned constant
// (24th PCD pinned constant).
//
// Guardrail C-1 (design §2.1): lives in the schemas package so that
//   @creativeagent/db can depend on it without reaching into
//   @creativeagent/creative-pipeline internals. Both packages legally
//   depend on @creativeagent/schemas; neither can legally depend on the
//   other's internals.
//
// Guardrail C-2 (design §2.1): this file is the only non-test source
// file in the entire monorepo that contains the literal
// "pcd-performance-overlay@". Anti-pattern test #2 enforces.
//
// Guardrail C-3 (design §2.1): exactly two non-test runtime sources
// import this symbol — the Prisma and in-memory CreatorPerformanceMetrics
// readers under packages/db/src/stores/. The SP13 selector does NOT
// import it; the selector reads metrics.metricsVersion through from the
// supplied performanceHistory map. Anti-pattern test #3 enforces.
//
// MERGE-BACK: stays at @creativeagent/* package locality; rename pass at merge.

export const PCD_PERFORMANCE_OVERLAY_VERSION = "pcd-performance-overlay@1.0.0";
