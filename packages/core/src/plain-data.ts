// Plain-data (JSON-shaped) helpers that behave the same in Node, browsers and Hermes,
// where structuredClone and node:util are not guaranteed.

/** Deep copy that keeps keys with undefined values, so canonical forms are unchanged. */
export function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clonePlain) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clonePlain(v)])) as T;
  return value;
}
/** Deep strict equality for plain data: same key sets (undefined values included), Object.is for leaves. */
export function samePlain(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>, keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && samePlain(x[k], y[k]));
}
