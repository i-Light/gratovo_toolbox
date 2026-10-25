import { strings } from "../strings";

const { time } = strings;

/**
 * "Not read yet", with the last known figure when there is a real one (more than 0): the page
 * shows this where a channel's uploads were never read, so a 0 never passes for a fact (D45).
 */
export function unreadWords(lastKnown: string | null, failed = false): string {
  const words = failed ? strings.unread.failed : strings.unread;
  return lastKnown === null ? words.label : words.lastKnown(lastKnown);
}

/**
 * A length of time in the words the rail and plans use: "45 min", "1 h", "1 h 30 min". The input
 * is rounded to whole minutes first, so 89.5 reads as "1 h 30 min".
 */
export function duration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) {
    return time.minutes(total);
  }
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? time.hours(hours) : time.hoursMinutes(hours, rest);
}

/**
 * How long ago something happened: "just now" under 45 seconds, then minutes, hours, "yesterday"
 * and days. Both times are milliseconds; a time in the future counts as "just now".
 */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 45) {
    return time.justNow;
  }
  if (seconds < 3600) {
    return time.minutesAgo(Math.round(seconds / 60));
  }
  if (seconds < 86400) {
    return time.hoursAgo(Math.round(seconds / 3600));
  }
  const days = Math.round(seconds / 86400);
  return days === 1 ? time.yesterday : time.daysAgo(days);
}

/**
 * An amount of money in dollars: "$1,200", "\u2212$300" (a real minus sign). Whole dollars only;
 * a fraction rounds. Which roles may see money is decided where it is shown.
 */
export function money(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const text = `$${rounded.toLocaleString("en-US")}`;
  return n < 0 && rounded > 0 ? `\u2212${text}` : text;
}

/** A time of day as "09:02" (24 hours, local time). */
export function clock(ts: number): string {
  const date = new Date(ts);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** A day as "Oct 24": the shared short date, in the app's one language. */
export function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(time.dateLocale, { month: "short", day: "numeric" });
}
