// SP6 — pinned by decidePcdApprovalAdvancement, decidePcdFinalExportGate,
// decidePcdMetaDraftGate. Caller cannot override; the gate functions import
// this constant and stamp it on every decision struct they emit.
export const PCD_APPROVAL_LIFECYCLE_VERSION = "approval-lifecycle@1.0.0";
