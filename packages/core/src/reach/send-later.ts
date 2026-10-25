/**
 * Send later's times (plan step 6, D12 and D21). Pure: each takes `now` in ms and gives a time in
 * ms. "Their morning" is 09:00 in the creator's country's main time zone; the other two are in the
 * sender's own zone.
 */

/** The hour each choice sends at. */
export const sendLaterHour = 9;
/** "Their morning" is never sooner than this; a nearer 09:00 moves to the next day. */
export const sendLaterLeadMs = 15 * 60_000;

/**
 * One time zone per country: its main city's. A country missing here has no zone, and "Their
 * morning" falls back to the sender's 09:00.
 */
export const countryZones: Readonly<Record<string, string>> = {
  AE: "Asia/Dubai",
  AR: "America/Argentina/Buenos_Aires",
  AT: "Europe/Vienna",
  AU: "Australia/Sydney",
  BD: "Asia/Dhaka",
  BE: "Europe/Brussels",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CH: "Europe/Zurich",
  CL: "America/Santiago",
  CN: "Asia/Shanghai",
  CO: "America/Bogota",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EG: "Africa/Cairo",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GB: "Europe/London",
  GR: "Europe/Athens",
  HK: "Asia/Hong_Kong",
  ID: "Asia/Jakarta",
  IE: "Europe/Dublin",
  IN: "Asia/Kolkata",
  IT: "Europe/Rome",
  JP: "Asia/Tokyo",
  KE: "Africa/Nairobi",
  KR: "Asia/Seoul",
  MX: "America/Mexico_City",
  MY: "Asia/Kuala_Lumpur",
  NG: "Africa/Lagos",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  NZ: "Pacific/Auckland",
  PH: "Asia/Manila",
  PK: "Asia/Karachi",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  SA: "Asia/Riyadh",
  SE: "Europe/Stockholm",
  SG: "Asia/Singapore",
  TH: "Asia/Bangkok",
  TR: "Europe/Istanbul",
  TW: "Asia/Taipei",
  UA: "Europe/Kyiv",
  US: "America/New_York",
  VN: "Asia/Ho_Chi_Minh",
  ZA: "Africa/Johannesburg",
};

/** The zone of an ISO-2 country, or null when it is unknown. */
export function zoneOf(country: string | null): string | null {
  if (country === null) {
    return null;
  }
  const code = country.trim().toUpperCase();
  return Object.hasOwn(countryZones, code) ? (countryZones[code] ?? null) : null;
}

const day = 86_400_000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(zone, f);
  }
  return f;
}

/** The wall clock in `zone` at `at`. Throws a RangeError for a zone the runtime doesn't know. */
function wallClock(zone: string, at: number): WallClock & { readonly second: number } {
  const parts: Record<string, number> = {};
  for (const p of format(zone).formatToParts(at)) {
    if (p.type !== "literal") {
      parts[p.type] = Number(p.value);
    }
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** How far `zone` is ahead of UTC at `at`, in ms. */
function offset(zone: string, at: number): number {
  const w = wallClock(zone, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant the wall clock in `zone` shows the given time. */
function instant(zone: string, w: WallClock): number {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  // Twice: the first guess may sit across a clock change from the answer.
  const first = asUtc - offset(zone, asUtc);
  return asUtc - offset(zone, first);
}

/**
 * The next 09:00 in `zone` that is at least `sendLaterLeadMs` away. Null when the runtime doesn't
 * know the zone.
 */
export function morningIn(zone: string, now: number): number | null {
  try {
    const today = wallClock(zone, now);
    const at = instant(zone, { ...today, hour: sendLaterHour, minute: 0 });
    if (at >= now + sendLaterLeadMs) {
      return at;
    }
    const next = wallClock(zone, now + day);
    return instant(zone, { ...next, hour: sendLaterHour, minute: 0 });
  } catch {
    return null;
  }
}

/** 09:00 tomorrow, the sender's time. */
export function tomorrowAt9(now: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(sendLaterHour, 0, 0, 0);
  return d.getTime();
}

/** 09:00 next Monday, the sender's time; a week on when today is Monday. */
export function mondayAt9(now: number): number {
  const d = new Date(now);
  const ahead = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  d.setHours(sendLaterHour, 0, 0, 0);
  return d.getTime();
}

/**
 * "Their morning" for a creator: 09:00 in their zone, else the sender's next 09:00 at least
 * `sendLaterLeadMs` away. `theirs` says which one it is.
 */
export function theirMorning(
  zone: string | null,
  now: number,
): { readonly at: number; readonly theirs: boolean } {
  const at = zone === null ? null : morningIn(zone, now);
  if (at !== null) {
    return { at, theirs: true };
  }
  const d = new Date(now);
  d.setHours(sendLaterHour, 0, 0, 0);
  if (d.getTime() < now + sendLaterLeadMs) {
    return { at: tomorrowAt9(now), theirs: false };
  }
  return { at: d.getTime(), theirs: false };
}
