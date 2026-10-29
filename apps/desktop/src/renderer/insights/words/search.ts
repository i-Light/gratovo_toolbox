import { startOfDay, thresholds } from "@gratovo/core/insights";
import type {
  GroupProfile,
  KeywordRow,
  Mistake,
  Point,
  SearchReport,
  SearchView,
  Verdict,
} from "@gratovo/core/insights";

import { strings } from "../../strings";

const text = strings.insights.search;
const day = 86_400_000;

/** A whole number with thousands separators. */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A share as a percentage: whole when large, one decimal below 10%. */
export function pct(value: number): string {
  const p = value * 100;
  return `${p < 10 && p > 0 ? String(Math.round(p * 10) / 10) : String(Math.round(p))}%`;
}

/** A compact count: 41K, 1.2M. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${String(Math.round(n / 100_000) / 10)}M`;
  if (n >= 1_000) return `${String(Math.round(n / 100) / 10).replace(/\.0$/, "")}K`;
  return fmt(n);
}

/** Kept per 1,000 found, or null when nothing was found. */
export function keptPer1000(row: KeywordRow): number | null {
  return row.kept.d > 0 ? (row.kept.n / row.kept.d) * 1000 : null;
}

export function formatKept(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** The words for a reject reason. */
export function reasonLabel(reason: keyof typeof text.reasons): string {
  return text.reasons[reason];
}

/**
 * The words for a tombstone's rule label. The labels are the app's tags (haramStuff, irrelevant,
 * inactive); one the map doesn't know is made readable: "tooSmall" becomes "Too small".
 */
export function ruleLabel(label: string): string {
  const known = text.ruleLabels[label];
  if (known !== undefined) return known;
  const spaced = label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (spaced === "") return text.ruleUnknown;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface Headline {
  readonly lead: string;
  /** The coloured second sentence, or null. */
  readonly accent: string | null;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);

/** Channels leaving for good in the next 7 days. */
export function leavingThisWeek(report: SearchReport): number {
  return sum(report.waiting.leaving.map((l) => l.count));
}

/** The hero headline of a view, chosen by rules from the counts. */
export function heroHeadline(view: SearchView, report: SearchReport): Headline {
  const h = text.hero;
  switch (view) {
    case "live": {
      const waiting = report.live.groups.notReviewed;
      return {
        lead: report.counts.live === 0 ? h.live.leadNone : h.live.lead(fmt(report.counts.live)),
        accent: waiting === 0 ? h.live.accentNone : h.live.accent(fmt(waiting)),
      };
    }
    case "waiting": {
      const leaving = leavingThisWeek(report);
      const m = report.waiting.mistakes.total;
      return {
        lead: leaving === 0 ? h.waiting.leadNone : h.waiting.lead(fmt(leaving)),
        accent: m === 0 ? null : m === 1 ? h.waiting.accentOne : h.waiting.accent(fmt(m)),
      };
    }
    case "archive": {
      const total = report.counts.archive;
      if (total === 0) return { lead: h.archive.leadNone, accent: null };
      return {
        lead: h.archive.lead(fmt(total)),
        accent: h.archive.accent(pct(report.archive.byRules / total)),
      };
    }
    case "everything": {
      const total = report.counts.everything;
      if (total === 0) return { lead: h.everything.none, accent: null };
      const live = report.counts.live;
      const ratio = live === 0 ? h.everything.noneLive : h.everything.oneIn(fmt(total / live));
      return { lead: h.everything.lead(fmt(total), ratio), accent: null };
    }
  }
}

/** The topmost reject reason of the waiting channels, with its share. */
function topReason(report: SearchReport) {
  const total = sum(report.waiting.reasons.map((r) => r.count));
  const top = [...report.waiting.reasons].sort((a, b) => b.count - a.count)[0];
  return top === undefined || total === 0 ? null : { ...top, total, share: top.count / total };
}

/** The pace sentence: searches add more than you review, or the other way round. */
function paceSentence(foundPerDay: number, reviewedPerDay: number): string {
  const m = text.hero.meaning;
  const diff = foundPerDay - reviewedPerDay;
  if (Math.round(diff) > 0) return m.addMore(fmt(diff));
  if (Math.round(diff) < 0) return m.reviewMore(fmt(-diff));
  return m.keepUp;
}

/** The footer sentence of a view's hero. */
export function heroMeaning(view: SearchView, report: SearchReport): string {
  const m = text.hero.meaning;
  switch (view) {
    case "live": {
      const week = m.liveWeek(fmt(report.live.joinedThisWeek), fmt(report.live.leftThisWeek));
      const b = report.live.backlog;
      return `${week} ${paceSentence(b.foundPerDay, b.reviewedPerDay)}`;
    }
    case "waiting": {
      const top = topReason(report);
      if (top === null) return m.waitingNone;
      if (top.reason === "ai" && top.share > 0.5) return m.waitingTooBroad;
      return m.waitingTopReason(text.reasonWhy[top.reason], pct(top.share));
    }
    case "archive": {
      const a = report.archive;
      if (a.growthPerWeek <= 0) return m.archiveNone;
      const rulesShare = a.growthByRulesPerWeek / a.growthPerWeek;
      return m.archiveGrowth(fmt(a.growthPerWeek), pct(Math.min(1, rulesShare)));
    }
    case "everything": {
      const e = report.everything;
      return e.found === 0 ? m.waitingNone : m.everythingRules(pct(e.swept / e.found));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Live

export function joinLeaveHeadline(report: SearchReport): string {
  const w = report.live.weekly;
  if (w.length === 0) return text.weekly.none;
  return text.weekly.headline(fmt(mean(w.map((x) => x.joined))), fmt(mean(w.map((x) => x.left))));
}

export function joinLeaveMeaning(report: SearchReport): string {
  const w = report.live.weekly;
  if (w.length === 0) return text.weekly.none;
  const net = Math.round(mean(w.map((x) => x.joined - x.left)));
  if (net > 0) return text.weekly.grows(fmt(net));
  if (net < 0) return text.weekly.shrinks(fmt(-net));
  return text.weekly.steady;
}

export function backlogHeadline(count: number): string {
  if (count === 0) return text.backlog.headlineNone;
  if (count === 1) return text.backlog.headlineOne;
  return text.backlog.headline(fmt(count));
}

export function daysLabel(days: number): string {
  return text.backlog.days(String(Math.round(days * 10) / 10));
}

/** The age of the oldest waiting channel in whole days, or null. */
export function oldestDays(oldestAt: number | null, now: number): number | null {
  return oldestAt === null ? null : Math.max(0, Math.floor((now - oldestAt) / day));
}

export function backlogMeaning(report: SearchReport): string {
  const b = report.live.backlog;
  if (b.days === null) return text.backlog.noPace;
  return `${paceSentence(b.foundPerDay, b.reviewedPerDay)} ${text.backlog.lasts(daysLabel(b.days))}`;
}

/** The finding about signings: how few keywords bring most of them. */
export function keywordHeadline(keywords: readonly KeywordRow[]): string {
  const k = text.keywords;
  if (keywords.length === 0) return k.headlineNoKeywords;
  const bySigned = [...keywords].sort((a, b) => b.signed - a.signed);
  const total = sum(keywords.map((x) => x.signed));
  if (total === 0) return k.headlineNone;
  let cum = 0;
  let count = 0;
  for (const row of bySigned) {
    cum += row.signed;
    count += 1;
    if (cum >= total * 0.8) break;
  }
  if (total >= 5 && count === 1) return k.headlineOne;
  if (total >= 5 && count === 2) return k.headlineTwo;
  return k.headlineMany(fmt(bySigned.filter((x) => x.signed > 0).length));
}

/** The footer of the scorecard: the best keywords, and the one that finds a lot and gets no answers. */
export function keywordMeaning(keywords: readonly KeywordRow[]): string {
  const k = text.keywords;
  const total = sum(keywords.map((x) => x.signed));
  const parts: string[] = [];
  const keepers = keywords
    .filter((x) => x.verdict === "keep" && x.signed > 0)
    .sort((a, b) => b.signed - a.signed)
    .slice(0, 2);
  if (keepers.length > 0 && total > 0) {
    const names = keepers.map((x) => x.keyword);
    parts.push(
      k.best(
        names.length === 2 ? k.and(names[0] ?? "", names[1] ?? "") : (names[0] ?? ""),
        fmt(sum(keepers.map((x) => x.signed))),
        fmt(total),
      ),
    );
  }
  const drop = keywords.filter((x) => x.verdict === "drop").sort((a, b) => b.found - a.found)[0];
  if (drop !== undefined) {
    parts.push(k.droppable(drop.keyword, fmt(drop.found), fmt(drop.emailed), fmt(drop.replied)));
  }
  return parts.length === 0 ? k.none : parts.join(" ");
}

export function keywordWhy(row: KeywordRow): string | null {
  const w = text.keywords.why;
  switch (row.why) {
    case "wornOut":
      return w.wornOut;
    case "noAnswers":
      return w.noAnswers;
    case "tooFew":
      return w.tooFew(fmt(row.emailed), fmt(thresholds.minEmails));
    case null:
      return null;
  }
}

export const keywordVerdictTone: Readonly<Record<KeywordRow["verdict"], Verdict>> = {
  keep: "good",
  watch: "watch",
  drop: "act",
  early: "early",
};

export function addressHeadline(report: SearchReport): string {
  const a = report.live.addresses;
  if (a.shortlisted === 0 || a.confirmed.d === 0) return text.addresses.none;
  return text.addresses.headline(pct(a.confirmed.n / a.confirmed.d));
}

export function addressSources(report: SearchReport): string {
  const s = report.live.addresses.sources;
  const total = s.about + s.video + s.typed + s.other;
  const share = (n: number): string => (total === 0 ? "0%" : pct(n / total));
  const base = text.addresses.sources(share(s.about), share(s.video), share(s.typed));
  const days = report.live.addresses.medianDaysToConfirm;
  return days === null
    ? base
    : `${base} ${text.addresses.usually(text.addresses.daysTo(String(Math.round(days * 10) / 10)))}`;
}

export function addressWaiting(count: number): string {
  if (count === 0) return text.addresses.waitsNone;
  if (count === 1) return text.addresses.waitsOne;
  return text.addresses.waits(fmt(count));
}

/** Live channels whose numbers could not be read (the missing country is its own row). */
export function unreadableTotal(trust: SearchReport["live"]["trust"]): number {
  return trust.notRead + trust.retrying + trust.gaveUp;
}

export function trustHeadline(trust: SearchReport["live"]["trust"]): string {
  const n = unreadableTotal(trust);
  if (n === 0) return text.trust.none;
  if (n === 1) return text.trust.headlineOne;
  return text.trust.headline(fmt(n));
}

// ---------------------------------------------------------------------------------------------
// To be archived

export function mistakesHeadline(total: number): string {
  if (total === 0) return text.mistakes.none;
  if (total === 1) return text.mistakes.headlineOne;
  return text.mistakes.headline(fmt(total));
}

/** "Today", "Tomorrow" or "In 3 days". */
export function leavesLabel(leavesAt: number, now: number): string {
  const d = Math.round((startOfDay(leavesAt) - startOfDay(now)) / day);
  if (d <= 0) return text.mistakes.today;
  if (d === 1) return text.mistakes.tomorrow;
  return text.mistakes.inDays(String(d));
}

export function reasonsHeadline(report: SearchReport): string {
  const top = topReason(report);
  if (top === null) return text.reasonsPanel.none;
  const why = text.reasonWhy[top.reason];
  if (top.share > 0.55) return text.reasonsPanel.headlineMost(why);
  if (top.share >= 0.45) return text.reasonsPanel.headlineHalf(why);
  return text.reasonsPanel.headlineTop(why, pct(top.share));
}

export function reasonsMeaning(report: SearchReport): string {
  const top = topReason(report);
  if (top === null) return text.reasonsPanel.none;
  const keywords = report.waiting.topReasonKeywords;
  if (top.reason === "ai" && top.share > 0.5) {
    if (keywords.length === 0) return text.reasonsPanel.tooBroadNoKeywords;
    const names = keywords.map((k) => k.keyword);
    const last = names[names.length - 1] ?? "";
    const joined =
      names.length >= 2 ? text.keywords.and(names.slice(0, -1).join(", "), last) : last;
    return text.reasonsPanel.tooBroad(
      joined,
      fmt(sum(keywords.map((k) => k.count))),
      fmt(top.count),
    );
  }
  if (keywords.length === 0) {
    return text.hero.meaning.waitingTopReason(text.reasonWhy[top.reason], pct(top.share));
  }
  return text.reasonsPanel.topKeywords(keywords.map((k) => k.keyword).join(", "));
}

type SecondLook = SearchReport["waiting"]["secondLooks"][number];

export function secondLooksHeadline(looks: readonly SecondLook[]): string {
  const s = text.second;
  const total = sum(looks.map((l) => l.back));
  if (total === 0) return s.headlineNone;
  const paying = looks.filter((l) => l.replied + l.signed > 0);
  if (paying.length === 0) return s.headlineNoPay;
  if (paying.length === looks.filter((l) => l.back > 0).length) return s.headlineAll;
  const best = [...paying].sort((a, b) => b.replied + b.signed - (a.replied + a.signed))[0];
  return s.headlineSome(best === undefined ? "" : text.reasonShort[best.reason]);
}

/** The footer: how the best reason did, and a note when over 10 were brought back for one reason. */
export function secondLooksMeaning(looks: readonly SecondLook[]): string {
  const s = text.second;
  const best = [...looks]
    .filter((l) => l.back > 0)
    .sort((a, b) => b.replied + b.signed - (a.replied + a.signed))[0];
  if (best === undefined) return s.none;
  const line = s.meaning(
    fmt(best.replied + best.signed),
    fmt(best.back),
    text.reasons[best.reason],
  );
  return best.back > 10 ? `${line} ${s.strict(text.reasonShort[best.reason])}` : line;
}

/** The ids "Bring back" may send: the listed ones, at most 50 (what `toolbox:restore` takes). */
export function restoreIds(top: readonly Mistake[]): readonly string[] {
  return top.slice(0, 50).map((m) => m.id);
}

// ---------------------------------------------------------------------------------------------
// Archive and Everything

type Week = SearchReport["weeks"][number];
type Series = "live" | "waiting" | "archive";

export function weekPoints(weeks: readonly Week[], series: Series): Point[] {
  return weeks.map((w) => ({ at: w.at, value: w[series] }));
}

/** The last known value minus the first known value of a series, or null with fewer than two. */
export function seriesChange(weeks: readonly Week[], series: Series): number | null {
  const known = weeks.map((w) => w[series]).filter((v): v is number => v !== null);
  const first = known[0];
  const last = known[known.length - 1];
  return known.length < 2 || first === undefined || last === undefined ? null : last - first;
}

export function changeText(weeks: readonly Week[], series: Series): string {
  const c = seriesChange(weeks, series);
  if (c === null) return text.weeks.unknown;
  return text.weeks.change(c > 0 ? "+" : c < 0 ? "-" : "", fmt(Math.abs(c)), String(weeks.length));
}

/** The newest known value of a series, or null. */
export function lastKnown(weeks: readonly Week[], series: Series): number | null {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const v = weeks[i]?.[series];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

export function weeksHeadline(weeks: readonly Week[]): string {
  const live = seriesChange(weeks, "live");
  const archive = seriesChange(weeks, "archive");
  if (live === null || archive === null) return text.weeks.headlineNone;
  const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "-" : ""}${fmt(Math.abs(n))}`;
  return text.weeks.headline(signed(live), signed(archive));
}

/** Share of a keyword's last run that was already known (live or archived), or null. */
export function knownShare(row: KeywordRow): number | null {
  const r = row.lastRun;
  if (r === null) return null;
  const total = r.fresh + r.live + r.archived;
  return total === 0 ? null : (r.live + r.archived) / total;
}

export function refindHeadline(keywords: readonly KeywordRow[]): string {
  const ran = keywords.filter((k) => k.lastRun !== null);
  if (ran.length === 0) return text.refind.none;
  const worn = ran.filter((k) => (knownShare(k) ?? 0) > 0.8).length;
  if (worn === 0) return text.refind.headlineFine;
  if (worn === 1) return text.refind.headlineWornOne;
  return text.refind.headlineWorn(fmt(worn));
}

export function archivedWhyHeadline(report: SearchReport): string {
  const total = report.archive.byRules + report.archive.byPerson;
  return total === 0
    ? text.whyArchived.none
    : text.whyArchived.headline(pct(report.archive.byRules / total));
}

/** The profile of a group, or null. */
export function profileOf(
  profiles: readonly GroupProfile[],
  group: GroupProfile["group"],
): GroupProfile | null {
  return profiles.find((p) => p.group === group) ?? null;
}

export function profileHeadline(profiles: readonly GroupProfile[]): string {
  const live = profileOf(profiles, "live")?.medianViews ?? null;
  const archived = [profileOf(profiles, "person"), profileOf(profiles, "rules")]
    .map((p) => p?.medianViews ?? null)
    .filter((v): v is number => v !== null);
  if (live === null || live <= 0 || archived.length === 0) return text.profile.headlineUnknown;
  const ratio = mean(archived) / live;
  if (ratio >= 0.8) return text.profile.headlineSame;
  return ratio < 0.5 ? text.profile.headlineMuchSmaller : text.profile.headlineSmaller;
}

export function profileMeaning(profiles: readonly GroupProfile[]): string {
  const headline = profileHeadline(profiles);
  if (headline === text.profile.headlineSame) return text.profile.meaningSame;
  if (headline === text.profile.headlineUnknown) return text.profile.meaningUnknown;
  return text.profile.meaningDiff;
}
