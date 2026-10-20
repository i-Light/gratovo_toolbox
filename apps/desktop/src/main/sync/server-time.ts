/**
 * Server timestamps as PostgREST prints them (`2026-10-20T09:15:00.123456+00:00`, or with a space
 * instead of the `T`). They are compared at microsecond precision, which `Date` cannot hold, and
 * the raw text is what gets stored as a cursor (plan D4).
 */

const pattern =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** `micros` is the part past the whole millisecond, 0 to 999. */
export function parseServerTime(
  text: string,
): { readonly ms: number; readonly micros: number } | null {
  const m = pattern.exec(text.trim());
  if (m === null) {
    return null;
  }
  const [, y, mo, d, h, mi, s, frac = "", zone = "Z"] = m;
  const fraction = frac.padEnd(6, "0");
  const ms0 = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!Number.isFinite(ms0)) {
    return null;
  }
  const check = new Date(ms0);
  if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) {
    return null;
  }
  let offsetMin = 0;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    offsetMin = (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes);
  }
  return {
    ms: ms0 - offsetMin * 60_000 + Number(fraction.slice(0, 3)),
    micros: Number(fraction.slice(3)),
  };
}

/** Unparsable text sorts before everything; two unparsable values are equal. */
export function compareServerTime(a: string, b: string): -1 | 0 | 1 {
  const pa = parseServerTime(a);
  const pb = parseServerTime(b);
  if (pa === null || pb === null) {
    return pa === pb ? 0 : pa === null ? -1 : 1;
  }
  if (pa.ms !== pb.ms) {
    return pa.ms < pb.ms ? -1 : 1;
  }
  if (pa.micros !== pb.micros) {
    return pa.micros < pb.micros ? -1 : 1;
  }
  return 0;
}

export function serverTimeMs(text: string): number | null {
  return parseServerTime(text)?.ms ?? null;
}
