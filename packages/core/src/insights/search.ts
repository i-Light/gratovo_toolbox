import type { CreatorStage, RejectReason } from "../data/types";

import type { ArchiveProfile, ChannelFacts, InsightsInputs, LogFact, StageEvent } from "./inputs";
import { compareRates, median, rateOf, startOfDay, startOfWeek } from "./stats";
import { thresholds } from "./thresholds";
import type {
  GroupProfile,
  KeywordRow,
  KeywordVerdict,
  LiveGroup,
  Mistake,
  Ratio,
  ReportWindow,
  SearchReport,
  Verdict,
} from "./types";
import { liveGroups } from "./types";

/**
 * The Search tab's report (design 3.4, plan step P8a). Pure: one pass over the channels, the stage
 * events and the log, so 12,000 channels take a few milliseconds. The archive arrives as totals
 * (design rule 12) and is only read, never counted.
 */

const DAY = 86_400_000;
const WEEKS = 12;
const markets: ReadonlySet<string> = new Set(["US", "GB", "CA", "AU"]);

type Reason = RejectReason | "unknown";

/** Local calendar arithmetic, so a day with a clock change is still one day. */
function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** How far a stage is on the way to signing; -1 for a stage that is off the road. */
const stageRank: Readonly<Record<CreatorStage, number>> = {
  new: 0,
  shortlisted: 1,
  contact: 2,
  emailed: 3,
  replied: 4,
  kit: 5,
  audience: 6,
  signed: 7,
  rejected: -1,
  parked: -1,
  never: -1,
};

function rankOf(stage: CreatorStage | null): number {
  return stage === null ? 0 : stageRank[stage];
}

/** Which band of the Live view a channel sits in; null for a rejected one (it is waiting). */
export function liveGroup(c: { readonly stage: CreatorStage | null }): LiveGroup | null {
  switch (c.stage) {
    case null:
    case "new":
      return "notReviewed";
    // Shortlisted and confirmed creators both wait for their first email ("Draft emails").
    case "shortlisted":
    case "contact":
      return "shortlisted";
    case "emailed":
    case "replied":
    case "kit":
    case "audience":
      return "outreach";
    case "signed":
      return "signed";
    case "parked":
      return "parked";
    case "never":
      return "never";
    case "rejected":
      return null;
  }
}

export function isLive(c: ChannelFacts): boolean {
  return c.inCatalog && c.stage !== "rejected";
}

export function isWaiting(c: ChannelFacts): boolean {
  return c.inCatalog && c.stage === "rejected";
}

/** A shortlisted live channel whose address was found but not yet confirmed. */
export function isAddressWaiting(c: ChannelFacts): boolean {
  return isLive(c) && c.stage === "shortlisted" && c.hasAddress && c.confirmedAt === null;
}

/** Whether a live channel counts in the Trust panel's `which` number. */
export function isUnreadable(
  c: ChannelFacts,
  which: "notRead" | "retrying" | "gaveUp" | "noCountry",
): boolean {
  return isLive(c) && (which === "noCountry" ? c.country === null : c.read === which);
}

/** A waiting channel that leaves for good on the day `day` after today (0 = tomorrow). */
export function leavesOnDay(c: ChannelFacts, now: number, day: number): boolean {
  if (!isWaiting(c) || c.leavesAt === null) return false;
  const today = startOfDay(now);
  return c.leavesAt >= addDays(today, day + 1) && c.leavesAt < addDays(today, day + 2);
}

/** A rejected channel, still waiting with a date, whose fit says a person may have been wrong. */
export function isMistake(c: ChannelFacts): boolean {
  return isWaiting(c) && c.leavesAt !== null && c.fit >= thresholds.mistakeFit;
}

/** Creators brought back in the 90 days before `now`, with why they had left. */
export function secondLookReasons(
  inputs: InsightsInputs,
  now: number,
): Map<string, RejectReason | "unknown"> {
  const since90 = addDays(now, -90);
  const restores = latestByChannel(
    inputs.log,
    (l) => l.action === "restore" && l.at >= since90 && l.at <= now,
  );
  const rejectLines = new Map<string, LogFact[]>();
  for (const l of inputs.log) {
    if (l.action !== "reject") continue;
    const list = rejectLines.get(l.channelId);
    if (list) list.push(l);
    else rejectLines.set(l.channelId, [l]);
  }
  const out = new Map<string, Reason>();
  for (const [id, r] of restores) {
    let prior: LogFact | null = null;
    for (const l of rejectLines.get(id) ?? []) {
      if (l.at <= r.at && (!prior || l.at >= prior.at)) prior = l;
    }
    out.set(id, prior?.reason ?? "unknown");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Keywords

type KeywordCounts = Pick<KeywordRow, "emailed" | "replied" | "lastRun">;

/**
 * Keep, Watch, Drop or too early, and why. `others` is the reply rate of all the other keywords.
 * Too few emailed first, then worn out, then clearly worse than the others.
 */
export function keywordVerdict(
  row: KeywordCounts,
  others: Ratio,
): { readonly verdict: KeywordVerdict; readonly why: KeywordRow["why"] } {
  if (row.emailed < thresholds.minEmails) return { verdict: "early", why: "tooFew" };
  const run = row.lastRun;
  if (run) {
    const total = run.fresh + run.live + run.archived;
    if (total > 0 && (run.live + run.archived) / total > thresholds.wornOut) {
      return { verdict: "watch", why: "wornOut" };
    }
  }
  const mine: Ratio = { n: row.replied, d: row.emailed };
  if (compareRates(mine, others, thresholds.minEmails) === "clear") {
    const a = rateOf(mine);
    const b = rateOf(others);
    if (a !== null && b !== null && a < b) return { verdict: "drop", why: "noAnswers" };
  }
  return { verdict: "keep", why: null };
}

/** One row per keyword, most live channels first. */
export function keywordRows(inputs: InsightsInputs): readonly KeywordRow[] {
  interface Tally {
    live: number;
    /** Live and past a person's review: what survived the rules and the review. */
    kept: number;
    emailed: number;
    replied: number;
    signed: number;
  }
  const tallies = new Map<string, Tally>();
  for (const k of inputs.keywords) {
    tallies.set(k.keyword, { live: 0, kept: 0, emailed: 0, replied: 0, signed: 0 });
  }
  for (const c of inputs.channels) {
    const rank = rankOf(c.stage);
    const live = isLive(c);
    const kept = live && c.stage !== null && c.stage !== "new";
    for (const kw of new Set(c.keywords)) {
      const t = tallies.get(kw);
      if (!t) continue;
      if (live) t.live += 1;
      if (kept) t.kept += 1;
      if (rank >= stageRank.emailed) t.emailed += 1;
      if (rank >= stageRank.replied) t.replied += 1;
      if (rank >= stageRank.signed) t.signed += 1;
    }
  }
  let allEmailed = 0;
  let allReplied = 0;
  for (const t of tallies.values()) {
    allEmailed += t.emailed;
    allReplied += t.replied;
  }
  const rows: KeywordRow[] = [];
  for (const k of inputs.keywords) {
    const t = tallies.get(k.keyword);
    if (!t) continue;
    const others: Ratio = { n: allReplied - t.replied, d: allEmailed - t.emailed };
    const { verdict, why } = keywordVerdict(
      { emailed: t.emailed, replied: t.replied, lastRun: k.lastRun },
      others,
    );
    rows.push({
      keyword: k.keyword,
      found: k.found,
      kept: { n: t.kept, d: k.found },
      live: t.live,
      emailed: t.emailed,
      replied: t.replied,
      signed: t.signed,
      verdict,
      why,
      lastRun: k.lastRun,
    });
  }
  return rows.sort((a, b) => b.live - a.live || a.keyword.localeCompare(b.keyword));
}

// ---------------------------------------------------------------------------------------------
// Pieces

function countBy<T>(items: readonly T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of items) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function sortedCounts(m: Map<string, number>): { readonly key: string; readonly count: number }[] {
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function reasonOf(c: ChannelFacts): Reason {
  return c.rejectReason ?? "unknown";
}

function profile(group: "live" | "waiting", cs: readonly ChannelFacts[]): GroupProfile {
  const nums = (pick: (c: ChannelFacts) => number | null): number | null =>
    median(cs.map(pick).filter((x): x is number => x !== null));
  const sponsored = cs.filter((c) => c.sponsored !== null);
  const withCountry = cs.filter((c) => c.country !== null);
  return {
    group,
    medianViews: nums((c) => c.medianViews),
    uploads30: nums((c) => c.uploads30),
    subscribers: nums((c) => c.subscribers),
    sponsored:
      sponsored.length === 0
        ? null
        : { n: sponsored.filter((c) => c.sponsored === true).length, d: sponsored.length },
    inMarkets:
      withCountry.length === 0
        ? null
        : {
            n: withCountry.filter((c) => markets.has((c.country ?? "").toUpperCase())).length,
            d: withCountry.length,
          },
    addressFound:
      cs.length === 0 ? null : { n: cs.filter((c) => c.hasAddress).length, d: cs.length },
  };
}

function archiveProfile(group: "person" | "rules", p: ArchiveProfile): GroupProfile {
  return {
    group,
    medianViews: p.medianViews,
    uploads30: p.uploads30,
    subscribers: p.subscribers,
    sponsored: p.sponsored,
    inMarkets: p.inMarkets,
    addressFound: p.addressFound,
  };
}

/** The latest line of each creator, among those the test lets through. */
function latestByChannel(
  log: readonly LogFact[],
  keep: (l: LogFact) => boolean,
): Map<string, LogFact> {
  const m = new Map<string, LogFact>();
  for (const l of log) {
    if (!keep(l)) continue;
    const prev = m.get(l.channelId);
    if (!prev || l.at >= prev.at) m.set(l.channelId, l);
  }
  return m;
}

function sortedEvents(events: readonly StageEvent[]): StageEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------------------------
// The report

export function searchReport(inputs: InsightsInputs, window: ReportWindow): SearchReport {
  const now = window.now;
  const channels = inputs.channels;
  const byId = new Map<string, ChannelFacts>();
  for (const c of channels) byId.set(c.id, c);
  const live = channels.filter(isLive);
  const waiting = channels.filter(isWaiting);
  const archive = inputs.archive;

  // Weeks: the Monday each of the last 12 local weeks starts, oldest first.
  const thisMonday = startOfWeek(now);
  const mondays: number[] = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) mondays.push(addDays(thisMonday, -7 * i));
  const weekRows = new Map(inputs.weeks.map((w) => [w.at, w]));
  const weeks = mondays.map((at) => {
    const row = weekRows.get(at);
    let archived: number | null = null;
    if (archive.weekly.length > 0) {
      archived = archive.total;
      for (const w of archive.weekly) if (w.at > at) archived -= w.all;
      archived = Math.max(0, archived);
    }
    return { at, live: row?.live ?? null, waiting: row?.waiting ?? null, archive: archived };
  });

  // Live band.
  const groups = Object.fromEntries(liveGroups.map((g) => [g, 0])) as Record<LiveGroup, number>;
  for (const c of live) {
    const g = liveGroup(c);
    if (g) groups[g] += 1;
  }

  // Joined and left, by week.
  const events = sortedEvents(inputs.events);
  const joined: Set<string>[] = mondays.map(() => new Set<string>());
  const left: Set<string>[] = mondays.map(() => new Set<string>());
  const wasShortlisted = new Set<string>();
  const firstMonday = mondays[0] ?? 0;
  const weekIndex = (at: number): number => {
    for (let i = mondays.length - 1; i >= 0; i -= 1) if (at >= (mondays[i] ?? 0)) return i;
    return -1;
  };
  for (const e of events) {
    const idx = e.at >= firstMonday && e.at <= now ? weekIndex(e.at) : -1;
    if (e.stage === "shortlisted") {
      if (idx >= 0) joined[idx]?.add(e.channelId);
      wasShortlisted.add(e.channelId);
    } else if (
      (e.stage === "rejected" || e.stage === "parked" || e.stage === "never") &&
      idx >= 0 &&
      wasShortlisted.has(e.channelId)
    ) {
      left[idx]?.add(e.channelId);
    }
  }
  const weekly = mondays.map((at, i) => ({
    at,
    joined: joined[i]?.size ?? 0,
    left: left[i]?.size ?? 0,
  }));

  // Backlog.
  const since14 = addDays(now, -14);
  const notReviewed = live.filter((c) => liveGroup(c) === "notReviewed");
  let oldestAt: number | null = null;
  for (const c of notReviewed) {
    if (c.foundAt !== null && (oldestAt === null || c.foundAt < oldestAt)) oldestAt = c.foundAt;
  }
  const foundPerDay =
    channels.filter(
      (c) => c.inCatalog && c.foundAt !== null && c.foundAt >= since14 && c.foundAt <= now,
    ).length / 14;
  const reviewed14 = events.filter(
    (e) => (e.stage === "shortlisted" || e.stage === "rejected") && e.at >= since14 && e.at <= now,
  ).length;
  const reviewedPerDay = reviewed14 / 14;
  const backlogCount = notReviewed.length;
  // Days of reviewing the backlog holds at your pace (design section 4: "would take over 5 days at
  // your triage pace"); null when nothing was reviewed.
  const backlogDays = reviewedPerDay > 0 ? backlogCount / reviewedPerDay : null;
  let backlogVerdict: Verdict;
  if (reviewed14 === 0 && backlogCount < thresholds.minOther) backlogVerdict = "early";
  else if (backlogCount === 0) backlogVerdict = "good";
  else if (backlogDays === null || backlogDays > thresholds.backlogDays) backlogVerdict = "watch";
  else backlogVerdict = "good";

  // Addresses: creators shortlisted in the last 30 days.
  const since30 = addDays(now, -30);
  const shortlistedAt = new Map<string, number>();
  for (const e of events) {
    if (e.stage === "shortlisted" && e.at >= since30 && e.at <= now) {
      shortlistedAt.set(e.channelId, e.at);
    }
  }
  let found = 0;
  let confirmed = 0;
  const sources = { about: 0, video: 0, typed: 0, other: 0 };
  const confirmDays: number[] = [];
  for (const [id, at] of shortlistedAt) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.hasAddress) found += 1;
    if (c.confirmedAt !== null) {
      confirmed += 1;
      sources[c.addressSource ?? "other"] += 1;
      confirmDays.push(Math.max(0, (c.confirmedAt - at) / DAY));
    }
  }
  const addressWaiting = live.filter(isAddressWaiting).length;

  // Trust.
  const trust = {
    notRead: live.filter((c) => isUnreadable(c, "notRead")).length,
    retrying: live.filter((c) => isUnreadable(c, "retrying")).length,
    gaveUp: live.filter((c) => isUnreadable(c, "gaveUp")).length,
    noCountry: live.filter((c) => isUnreadable(c, "noCountry")).length,
  };

  // Waiting.
  const dated = waiting.filter((c) => c.leavesAt !== null);
  const today = startOfDay(now);
  const leaving = Array.from({ length: 7 }, (_, i) => {
    const from = addDays(today, i + 1);
    const to = addDays(today, i + 2);
    const count = dated.filter((c) => leavesOnDay(c, now, i)).length;
    return { at: from, to, count };
  });
  const tomorrow = leaving[0] ?? { at: 0, to: 0, count: 0 };
  const mistakeRows = dated.filter(isMistake);
  const top: Mistake[] = [...mistakeRows]
    .sort((a, b) => b.fit - a.fit || (a.leavesAt ?? 0) - (b.leavesAt ?? 0))
    .slice(0, 50)
    .map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      reason: reasonOf(c),
      fit: c.fit,
      medianViews: c.medianViews,
      leavesAt: c.leavesAt ?? 0,
    }));
  const reasons = sortedCounts(countBy(waiting, reasonOf)).map((r) => ({
    reason: r.key as Reason,
    count: r.count,
  }));
  const topReason = reasons[0]?.reason;
  const topKw = new Map<string, number>();
  if (topReason !== undefined) {
    for (const c of waiting) {
      const kw = c.keywords[0];
      if (kw !== undefined && reasonOf(c) === topReason) topKw.set(kw, (topKw.get(kw) ?? 0) + 1);
    }
  }

  // Second looks: brought back in the last 90 days, by why they had left.
  const restored = secondLookReasons(inputs, now);
  const looks = new Map<
    Reason,
    { back: number; emailed: number; replied: number; signed: number }
  >();
  for (const [id, reason] of restored) {
    const t = looks.get(reason) ?? { back: 0, emailed: 0, replied: 0, signed: 0 };
    const rank = rankOf(byId.get(id)?.stage ?? null);
    t.back += 1;
    if (rank >= stageRank.emailed) t.emailed += 1;
    if (rank >= stageRank.replied) t.replied += 1;
    if (rank >= stageRank.signed) t.signed += 1;
    looks.set(reason, t);
  }
  const secondLooks = [...looks.entries()]
    .map(([reason, t]) => ({ reason, ...t }))
    .sort((a, b) => b.back - a.back || a.reason.localeCompare(b.reason));

  // Archive: brought back in the last 30 days, and who answered since.
  const restores30 = latestByChannel(
    inputs.log,
    (l) => l.action === "restore" && l.at >= since30 && l.at <= now,
  );
  const answered = new Set<string>();
  for (const m of inputs.messages) {
    if (m.direction !== "in" || m.bounce) continue;
    const r = restores30.get(m.channelId);
    if (r && m.at > r.at) answered.add(m.channelId);
  }
  const complete = archive.weekly.filter((w) => w.at < thisMonday).slice(-WEEKS);
  const avg = (pick: (w: (typeof complete)[number]) => number): number =>
    complete.length === 0 ? 0 : complete.reduce((s, w) => s + pick(w), 0) / complete.length;

  const everything = live.length + waiting.length + archive.total;
  return {
    tab: "search",
    window,
    counts: { live: live.length, waiting: waiting.length, archive: archive.total, everything },
    weeks,
    keywords: keywordRows(inputs),
    live: {
      groups,
      joinedThisWeek: weekly[weekly.length - 1]?.joined ?? 0,
      leftThisWeek: weekly[weekly.length - 1]?.left ?? 0,
      weekly,
      backlog: {
        count: backlogCount,
        oldestAt,
        foundPerDay,
        reviewedPerDay,
        days: backlogDays,
        verdict: backlogVerdict,
      },
      addresses: {
        shortlisted: shortlistedAt.size,
        found: { n: found, d: shortlistedAt.size },
        confirmed: { n: confirmed, d: shortlistedAt.size },
        sources,
        medianDaysToConfirm: median(confirmDays),
        waiting: addressWaiting,
      },
      trust,
    },
    waiting: {
      dated: dated.length,
      undated: waiting.length - dated.length,
      leaving: leaving.map(({ at, count }) => ({ at, count })),
      mistakes: {
        total: mistakeRows.length,
        tomorrow: mistakeRows.filter(
          (c) => (c.leavesAt ?? 0) >= tomorrow.at && (c.leavesAt ?? 0) < tomorrow.to,
        ).length,
        top,
      },
      reasons,
      topReasonKeywords: sortedCounts(topKw)
        .slice(0, 3)
        .map((k) => ({ keyword: k.key, count: k.count })),
      secondLooks,
    },
    archive: {
      byRules: archive.byRules,
      byPerson: archive.byPerson,
      ruleLabels: archive.ruleLabels,
      personReasons: archive.personReasons,
      refoundThisWeek: archive.refoundThisWeek,
      broughtBack: { n: answered.size, d: restores30.size },
      growthPerWeek: avg((w) => w.all),
      growthByRulesPerWeek: avg((w) => w.byRules),
      profiles: [
        profile("live", live),
        profile("waiting", waiting),
        archiveProfile("person", archive.person),
        archiveProfile("rules", archive.rules),
      ],
    },
    everything: {
      found: everything,
      swept: archive.byRules,
      passed: everything - archive.byRules,
      rejectedWaiting: waiting.length,
      rejectedArchived: archive.byPerson,
      live: live.length,
    },
  };
}
