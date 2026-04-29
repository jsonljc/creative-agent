import { describe, expect, it } from "vitest";
import { deepFreeze } from "./deep-freeze.js";

describe("deepFreeze", () => {
  it("returns primitives unchanged", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze("x")).toBe("x");
    expect(deepFreeze(true)).toBe(true);
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
  });

  it("freezes an empty plain object", () => {
    const o = {};
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
  });

  it("freezes an empty array", () => {
    const a: number[] = [];
    deepFreeze(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("freezes a plain object with primitives", () => {
    const o = { a: 1, b: "two" };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
  });

  it("freezes nested plain objects (depth 2)", () => {
    const o = { outer: { inner: 1 } };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.outer)).toBe(true);
  });

  it("freezes a plain object with a nested array", () => {
    const o = { items: [1, 2, 3] };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.items)).toBe(true);
  });

  it("freezes an array of plain objects", () => {
    const a = [{ x: 1 }, { x: 2 }];
    deepFreeze(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a[0])).toBe(true);
    expect(Object.isFrozen(a[1])).toBe(true);
  });

  it("freezes deeply mixed nesting (depth 4)", () => {
    const o = { a: [{ b: { c: [1, 2] } }] };
    deepFreeze(o);
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o.a)).toBe(true);
    expect(Object.isFrozen(o.a[0])).toBe(true);
    expect(Object.isFrozen(o.a[0]!.b)).toBe(true);
    expect(Object.isFrozen(o.a[0]!.b.c)).toBe(true);
  });

  it("returns already-frozen input as-is without throwing", () => {
    const o = Object.freeze({ a: 1 });
    expect(() => deepFreeze(o)).not.toThrow();
    expect(deepFreeze(o)).toBe(o);
  });

  it("is idempotent", () => {
    const o = { a: [1, 2], b: { c: 3 } };
    const once = deepFreeze(o);
    const twice = deepFreeze(once);
    expect(twice).toBe(once);
    expect(Object.isFrozen(twice)).toBe(true);
  });
});
