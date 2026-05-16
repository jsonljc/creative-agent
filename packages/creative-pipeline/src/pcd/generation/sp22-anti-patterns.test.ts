// SP22 anti-pattern test. Assertions per design §7 + plan Task 13.
// Keyed to SP21 squash SHA ece1347 as the freeze baseline.

import { describe, it, expect } from "vitest";

describe("SP22 anti-patterns", () => {
  it("placeholder — filled in at Task 13", () => {
    // Intentionally red until Task 13 lands the real assertions.
    expect(true).toBe(false);
  });
});
