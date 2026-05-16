// PCD slice SP11–SP12 — synthetic creator package barrel.
export { SP11_SYNTHETIC_CREATOR_ROSTER, SP11_ROSTER_SIZE } from "./seed.js";
export type { RosterEntry, CreatorIdentityStub } from "./seed.js";

// SP12 — pure license gate
export { licenseGate, PCD_LICENSE_GATE_VERSION } from "./license-gate.js";
export type { LicenseGateInput, LicenseGateDecision, LicenseGateReason } from "./license-gate.js";

// SP21 — port interfaces for synthetic-creator selection composer
export type {
  SyntheticCreatorRosterReader,
  SyntheticCreatorLeaseReader,
  SyntheticCreatorMetricsReader,
} from "./synthetic-creator-selection-ports.js";

export { Sp11SeedSyntheticCreatorRosterReader } from "./sp11-seed-synthetic-creator-roster-reader.js";
