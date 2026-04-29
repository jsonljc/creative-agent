import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const SP6_SOURCE_FILES = [
  "approval-lifecycle-version.ts",
  "consent-revocation-version.ts",
  "invariant-violation-error.ts",
  "consent-revocation-error.ts",
  "lifecycle-readers.ts",
  "export-gate-state.ts",
  "compliance-check.ts",
  "approval-advancement.ts",
  "final-export-gate.ts",
  "meta-draft-gate.ts",
  "consent-revocation.ts",
  "consent-pre-check-generation.ts",
  "consent-pre-check-edit.ts",
];

const readSource = (file: string): string => readFileSync(join(here, file), "utf8");

const stripComments = (src: string): string =>
  src
    .split("\n")
    .map((line) => {
      const ix = line.indexOf("//");
      return ix === -1 ? line : line.slice(0, ix);
    })
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

describe("SP6 anti-pattern grep", () => {
  it("no `if (passFail ===` outside approval-advancement.ts", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      if (file === "approval-advancement.ts") continue;
      const src = stripComments(readSource(file));
      if (/if\s*\(\s*[a-zA-Z_$][\w$]*\.passFail\s*===/.test(src)) {
        offenders.push(file);
      }
      if (/if\s*\(\s*passFail\s*===/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no `if (intent ===` or `switch (intent)` dispatch in any SP6 source", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = stripComments(readSource(file));
      if (/if\s*\(\s*[a-zA-Z_$][\w$]*\.?intent\s*===/.test(src))
        offenders.push(`if-intent: ${file}`);
      if (/switch\s*\(\s*[a-zA-Z_$][\w$]*\.?intent\s*\)/.test(src))
        offenders.push(`switch-intent: ${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no direct prisma. or assetRecord.update or WorkTrace tokens in SP6 sources", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = stripComments(readSource(file));
      if (/\bprisma\./.test(src)) offenders.push(`prisma.: ${file}`);
      if (/assetRecord\.update/.test(src)) offenders.push(`assetRecord.update: ${file}`);
      if (/\bWorkTrace\b/.test(src)) offenders.push(`WorkTrace: ${file}`);
    }
    expect(offenders).toEqual([]);
  });

  it("meta-draft-gate.ts contains literal `complianceCheck.checkMetaDraftCompliance(` (real seam, not theater)", () => {
    const src = stripComments(readSource("meta-draft-gate.ts"));
    expect(src).toContain("complianceCheck.checkMetaDraftCompliance(");
  });

  it("no Switchboard-only imports in any SP6 source (core/approval, ApprovalLifecycle, ExportLifecycle)", () => {
    const offenders: string[] = [];
    for (const file of SP6_SOURCE_FILES) {
      const src = readSource(file);
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      for (const line of importLines) {
        if (/core\/approval/.test(line)) offenders.push(`core/approval in ${file}`);
        if (/ApprovalLifecycle\b/.test(line)) offenders.push(`ApprovalLifecycle in ${file}`);
        if (/ExportLifecycle\b/.test(line)) offenders.push(`ExportLifecycle in ${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("SP6 forbidden imports per source file", () => {
  const FORBIDDEN_PER_FILE = [
    "@creativeagent/db",
    "@prisma/client",
    "inngest",
    "node:fs",
    "node:http",
    "node:https",
    "crypto",
  ];

  for (const file of SP6_SOURCE_FILES) {
    it(`${file} imports none of [${FORBIDDEN_PER_FILE.join(", ")}]`, () => {
      const src = readSource(file);
      const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
      const offenders: string[] = [];
      for (const banned of FORBIDDEN_PER_FILE) {
        for (const line of importLines) {
          if (line.includes(`"${banned}"`) || line.includes(`'${banned}'`)) {
            offenders.push(`${banned} in line: ${line.trim()}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("SP5 hard-block invariant chain — end-to-end", () => {
  it("approval-advancement.ts is the sole holder of the passFail === fail refusal", () => {
    const src = stripComments(readSource("approval-advancement.ts"));
    expect(src).toMatch(/qc\.passFail\s*===\s*"fail"/);
    expect(src).toMatch(/qc_failed/);
  });

  it("approval-advancement.ts also refuses passFail === warn (SP5 binding)", () => {
    const src = stripComments(readSource("approval-advancement.ts"));
    expect(src).toMatch(/qc\.passFail\s*===\s*"warn"/);
    expect(src).toMatch(/qc_not_conclusive/);
  });
});
