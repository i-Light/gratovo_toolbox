import type { IconName } from "@gratovo/ui";
import type { TodayBucket, TodayItem, TodayKind } from "@gratovo/core/today";

import { dayWords } from "../lib/reach-actions";
import { ago } from "../lib/format";
import { strings } from "../strings";

const text = strings.today.screen;
const dayMs = 86_400_000;

const moneyKey = /^(invoice|collect|payout):/;

/**
 * The title to list for a done or snoozed entry: the worded title, or a generic one for a money
 * step when the person does not see money.
 */
export function listedTitle(
  entry: { readonly key: string; readonly title: string; readonly bucket?: TodayBucket },
  seesMoney: boolean,
): string {
  return !seesMoney && (entry.bucket === "money" || moneyKey.test(entry.key))
    ? strings.today.titles.moneyStep
    : entry.title;
}

/** Local midnight at the start of the day `now` falls in. */
export function midnight(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type TodayFilter = "all" | "quick" | "late";

/** A deadline that passed before today (not an arrival time). */
export function isLate(item: TodayItem, now: number): boolean {
  return !item.age && item.due !== null && item.due < midnight(now);
}

export function applyFilter(
  items: readonly TodayItem[],
  filter: TodayFilter,
  now: number,
): readonly TodayItem[] {
  if (filter === "quick") {
    return items.filter((i) => i.quick);
  }
  if (filter === "late") {
    return items.filter((i) => isLate(i, now));
  }
  return items;
}

/** "Saturday 7 November", in the app's locale. */
export function longDay(now: number): string {
  const parts = new Intl.DateTimeFormat(strings.time.dateLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(new Date(now));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** The due words for a row: how long ago (arrivals), "today", "tomorrow", "N days late", or a day. Null when there is no due time. */
export function dueWords(item: TodayItem, now: number): string | null {
  if (item.due === null) {
    return null;
  }
  if (item.age) {
    return ago(item.due, now);
  }
  const start = midnight(now);
  if (item.due < start) {
    return text.queue.daysLate(Math.max(1, Math.ceil((start - item.due) / dayMs)));
  }
  if (item.due < start + dayMs) {
    return text.queue.today;
  }
  if (item.due < start + 2 * dayMs) {
    return text.queue.tomorrow;
  }
  return dayWords(item.due);
}

export const kindIcon: Readonly<Record<TodayKind, IconName>> = {
  invoice: "wallet",
  collect: "alert",
  payout: "unlock",
  deal: "box",
  nextdeal: "trend",
  reply: "reply",
  send: "send",
  followup: "clock",
  bnudge: "alarm",
  audience: "users",
  qualify: "flag",
  pitch: "pen",
  contact: "at",
  finds: "search",
};

export const bucketIcon: Readonly<Record<TodayBucket, IconName>> = {
  money: "wallet",
  deals: "box",
  replies: "reply",
  sends: "send",
  followups: "clock",
  close: "users",
  contacts: "at",
  finds: "search",
};

/** The screen hue each bucket draws in, and the opacity that tells neighbours of one hue apart. */
export const bucketHue: Readonly<Record<TodayBucket, { hue: string; opacity: number }>> = {
  money: { hue: "var(--money)", opacity: 1 },
  deals: { hue: "var(--deliver)", opacity: 1 },
  replies: { hue: "var(--reach)", opacity: 1 },
  sends: { hue: "var(--reach)", opacity: 0.7 },
  followups: { hue: "var(--reach)", opacity: 0.45 },
  close: { hue: "var(--close)", opacity: 1 },
  contacts: { hue: "var(--find)", opacity: 0.7 },
  finds: { hue: "var(--find)", opacity: 1 },
};
