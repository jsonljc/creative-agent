// SP8 — recursive freeze for arrays + plain objects. Idempotent; safe on
// already-frozen input. Used by buildPcdIdentityContext to harden SP7's
// shallow Object.freeze(context) hole (I-1 from SP7 code review).

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  const o = obj as unknown as Record<PropertyKey, unknown> | unknown[];
  if (Array.isArray(o)) {
    for (const item of o) deepFreeze(item);
  } else {
    // Symbol-keyed properties intentionally excluded — out of scope for SP8.
    for (const key of Object.keys(o)) deepFreeze(o[key]);
  }
  return Object.freeze(obj);
}
