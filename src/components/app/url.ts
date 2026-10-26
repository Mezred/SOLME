/** Builds a URL from current search params with overrides (undefined/'' removes a key). */
export function hrefWith(base: string, current: Record<string, string | string[] | undefined>, overrides: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === "string" && v !== "") p.set(k, v);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function flatParams(sp: SearchParamsRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") out[k] = v;
  return out;
}
