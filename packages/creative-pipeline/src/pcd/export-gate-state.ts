/**
 * SP6 merge-back seam — future Switchboard ExportLifecycle.
 *
 * The final-export gate consults this interface as the fourth orthogonal
 * state ("export gate open?") alongside tier, approval, and QC. The default
 * in-tree implementer always returns open; merge-back replaces it with an
 * adapter over Switchboard's ExportLifecycle.
 *
 * // MERGE-BACK: replace AlwaysOpenExportGateState with Switchboard
 * ExportLifecycle adapter at production wiring time.
 */

export type ExportGateOpenness = { open: true } | { open: false; reason: string };

export interface ExportGateState {
  isOpen(assetRecordId: string): Promise<ExportGateOpenness>;
}

export class AlwaysOpenExportGateState implements ExportGateState {
  async isOpen(_assetRecordId: string): Promise<ExportGateOpenness> {
    return { open: true };
  }
}
