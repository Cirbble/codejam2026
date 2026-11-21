/**
 * Null-prototype dictionaries for every place a user-controlled string is a key
 * (team names, labels, device ids, days...). "__proto__", "constructor" and friends are then plain keys.
 */
export type Dict<V> = Record<string, V>;

export function dict<V>(): Dict<V> {
  return Object.create(null);
}

/** Copy any object (e.g. fresh from JSON.parse) into a null-prototype dictionary, mapping values. */
export function toDict<V>(src: unknown, map: (v: any) => V = (v) => v): Dict<V> {
  const out = dict<V>();
  if (src && typeof src === 'object' && !Array.isArray(src)) for (const k of Object.keys(src)) out[k] = map((src as any)[k]);
  return out;
}
