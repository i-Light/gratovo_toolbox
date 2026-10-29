import { positiveReadings, rateOf, thresholds } from "@gratovo/core/insights";
import type {
  Batch,
  EmailsReport,
  MailboxRow,
  PatternKind,
  PatternSplit,
  ReadingKind,
  Ratio,
} from "@gratovo/core/insights";

import { strings } from "../../strings";
import { decimal, num, pct, plural, ratioPct, ratioText } from "./format";

const t = strings.insights.emails;
const nouns = strings.insights.overview.nouns;
const dayMs = 86_400_000;

// ---------------------------------------------------------------------------------------------
// The hero

/** The number of days in the period, as the hero names it. */
export function periodDays(report: EmailsReport): number {
  return Math.max(1, Math.round((report.window.current.to - report.window.current.from) / dayMs));
}

/** "726 emails in 30 days brought 35 replies, 4.8%." */
export function heroHeadline(report: EmailsReport): string {
  return t.hero.headline(
    plural(report.sent, nouns.email),
    plural(periodDays(report), nouns.day),
    plural(report.rate.n, nouns.reply),
    ratioPct(report.rate),
  );
}

/** The footer sentence: above or below the floor (or too early), then the period before. */
export function heroMeaning(report: EmailsReport): string {
  const m = t.hero.meaning;
  const lead =
    report.rateVerdict === "early"
      ? m.early(num(report.rate.d), num(thresholds.minEmails))
      : (rateOf(report.rate) ?? 0) >= thresholds.replyFloor
        ? m.above
        : m.below;
  return report.rateBefore.d > 0 ? `${lead}${m.before(ratioText(report.rateBefore))}` : lead;
}

/** The empty state: no email was ever sent in the period. */
export function emailsIsEmpty(report: EmailsReport): boolean {
  return report.sent === 0 && report.daily.every((d) => d.sent === 0 && d.replies === 0);
}

// ---------------------------------------------------------------------------------------------
// Which email gets the replies

export function stepLabel(step: number): string {
  return step === 0 ? t.steps.first : t.steps.followUp(num(step));
}

/**
 * The headline: follow-ups' share of all replies when it is over half; otherwise the first email's.
 * Without any replies it says so.
 */
export function stepsHeadline(bySteps: EmailsReport["bySteps"]): string {
  const total = bySteps[0]?.share.d ?? 0;
  if (total === 0) return t.steps.headlineNone;
  const followUps = bySteps.filter((s) => s.step > 0).reduce((a, s) => a + s.share.n, 0);
  if (followUps * 2 > total) return t.steps.headlineMost;
  return t.steps.headlineFirst(pct((bySteps[0]?.share.n ?? 0) / total));
}

/** The footer: the best follow-up if it matches the first email, else that follow-ups are weaker. */
export function stepsMeaning(bySteps: EmailsReport["bySteps"]): string {
  const first = bySteps[0];
  const firstRate = first === undefined ? null : rateOf(first.rate);
  if (firstRate === null || (first?.share.d ?? 0) === 0) return t.steps.meaning.none;
  const equal = bySteps
    .filter((s) => s.step > 0 && s.rate.d >= thresholds.minOther)
    .filter((s) => (rateOf(s.rate) ?? 0) >= firstRate)
    .sort((a, b) => (rateOf(b.rate) ?? 0) - (rateOf(a.rate) ?? 0))[0];
  return equal === undefined ? t.steps.meaning.lower : t.steps.meaning.equal(num(equal.step));
}

// ---------------------------------------------------------------------------------------------
// What the replies say

export function readingLabel(kind: ReadingKind): string {
  return t.readings.kinds[kind];
}

export function isPositive(kind: ReadingKind): boolean {
  return positiveReadings.includes(kind);
}

export function readingsHeadline(positive: Ratio): string {
  return positive.d === 0 ? t.readings.headlineNone : t.readings.headline(ratioPct(positive));
}

/** The footer: how many have a manager when any do, else what a way forward means. */
export function readingsMeaning(readings: EmailsReport["readings"]): string {
  const managers = readings.find((r) => r.kind === "manager")?.count ?? 0;
  return managers > 0 ? t.readings.meaning.manager(num(managers)) : t.readings.meaning.plain;
}

// ---------------------------------------------------------------------------------------------
// Batches of 50

function problemWords(batch: Batch): string | null {
  switch (batch.diagnosis) {
    case "delivery":
      return t.batches.problems.delivery;
    case "writing":
      return t.batches.problems.writing;
    case "targeting":
      return t.batches.problems.targeting;
    default:
      return null;
  }
}

/**
 * The batches headline: the newest two batches with a problem ("Batch #22 has a delivery problem,
 * batch #21 a writing problem."). With none, healthy if any batch is healthy, else too early.
 */
export function batchesHeadline(batches: readonly Batch[]): string {
  const b = t.batches;
  if (batches.length === 0) return b.headlineNone;
  const problems = batches
    .map((batch) => ({ batch, words: problemWords(batch) }))
    .filter((p): p is { batch: Batch; words: string } => p.words !== null);
  const [one, two] = problems;
  if (one !== undefined && two !== undefined) {
    return b.headlineTwo(num(one.batch.index), one.words, num(two.batch.index), two.words);
  }
  if (one !== undefined) return b.headlineOne(num(one.batch.index), one.words);
  return batches.some((x) => x.diagnosis === "healthy") ? b.headlineHealthy : b.headlineEarly;
}

/** The diagnosis sentence of one batch. */
export function diagnosisText(batch: Batch): string {
  const d = t.batches.diagnosis;
  switch (batch.diagnosis) {
    case "early":
      return d.early(num(batch.sent), num(thresholds.batchSize));
    case "delivery":
      return d.delivery(num(batch.bounced), batch.bounceMailbox);
    case "writing":
      return d.writing;
    case "targeting":
      return d.targeting;
    case "healthy":
      return d.healthy;
  }
}

/** The mark of a batch: the verdict it counts as (a problem in delivery is "Act now"). */
export function diagnosisVerdict(batch: Batch): "good" | "watch" | "act" | "early" {
  switch (batch.diagnosis) {
    case "early":
      return "early";
    case "delivery":
      return "act";
    case "writing":
    case "targeting":
      return "watch";
    case "healthy":
      return "good";
  }
}

/** The footer: a named mailbox when bounces come from one, else the order to fix things in. */
export function batchesMeaning(batches: readonly Batch[]): string {
  const bad = batches.find((x) => x.diagnosis === "delivery" && x.bounceMailbox !== null);
  return bad === undefined || bad.bounceMailbox === null
    ? t.batches.meaning.plain
    : t.batches.meaning.mailbox(num(bad.index), bad.bounceMailbox);
}

// ---------------------------------------------------------------------------------------------
// What helps replies

/** A group's words: "Edited", "Under 50K views", "Tuesday"; a country, keyword or unknown key as is. */
export function groupLabel(kind: PatternKind, key: string): string {
  const known = t.patterns.groups[key];
  if (known !== undefined) return known;
  return kind === "country" ? key.toUpperCase() : key;
}

/** The clear splits, clearest first (the report already sorts them). */
export function clearSplits(patterns: readonly PatternSplit[]): PatternSplit[] {
  return patterns.filter((p) => p.result === "clear" && p.best !== null);
}

export function patternsHeadline(patterns: readonly PatternSplit[]): string {
  const p = t.patterns;
  const [a, b] = clearSplits(patterns);
  if (a === undefined) return p.headlineNone;
  if (b === undefined) return p.headlineOne(p.names[a.kind]);
  return p.headlineTwo(p.names[a.kind], p.names[b.kind].toLowerCase());
}

/** "Try this: …" for a clear split, or null when it is not clear. */
export function tryThis(split: PatternSplit): string | null {
  if (split.result !== "clear" || split.best === null) return null;
  const p = t.patterns.tryThis;
  const best = groupLabel(split.kind, split.best);
  const plainBest = best.toLowerCase();
  const sentence =
    split.kind === "edited"
      ? split.best === "edited"
        ? p.editedYes
        : p.editedNo
      : split.kind === "rewrite"
        ? p.rewrite(best)
        : split.kind === "size"
          ? p.size(best)
          : split.kind === "country"
            ? p.country(best)
            : split.kind === "keyword"
              ? p.keyword(split.best)
              : split.kind === "weekday"
                ? p.weekday(best)
                : p.hour(plainBest);
  return `${p.lead}${sentence}`;
}

/** The footer: the first clear split's "Try this", else that thin splits are left out. */
export function patternsMeaning(patterns: readonly PatternSplit[]): string {
  const [first] = clearSplits(patterns);
  return (first === undefined ? null : tryThis(first)) ?? t.patterns.meaningNone;
}

// ---------------------------------------------------------------------------------------------
// How fast we answer

/** "5.2" under 10 hours, a whole number from there. */
export function hoursText(hours: number): string {
  return hours < 10 ? decimal(hours) : num(hours);
}

export function answerHeadline(answer: EmailsReport["answer"]): string {
  return answer.medianHours === null
    ? t.answer.headlineNone
    : t.answer.headline(strings.insights.overview.fmt.hoursLong(hoursText(answer.medianHours)));
}

// ---------------------------------------------------------------------------------------------
// Mailboxes

/** A mailbox bounces when it passes the course's share on enough sends. */
export function isBouncing(row: MailboxRow): boolean {
  return (
    row.bounced.d >= thresholds.bounceMin && row.bounced.n / row.bounced.d > thresholds.bounceShare
  );
}

/** The sub-line under a mailbox: its warm-up day, or the limit it is held at. */
export function mailboxNote(row: MailboxRow): string | null {
  if (row.warmupDay !== null && row.warmupDays !== null) {
    return t.mailboxes.warmup(num(row.warmupDay), num(row.warmupDays));
  }
  return row.heldAt === null ? null : t.mailboxes.held(num(row.heldAt));
}

/**
 * The mailboxes headline: the first mailbox marked "Act now" or "Watch", named as bouncing when its
 * bounces pass the share, else "needs a look"; always with the share of room used.
 */
export function mailboxesHeadline(report: EmailsReport): string {
  const m = t.mailboxes;
  if (report.mailboxes.every((x) => x.sent === 0) || report.capacity.d === 0) return m.headlineNone;
  const used = ratioPct(report.capacity);
  const sick =
    report.mailboxes.find((x) => x.verdict === "act") ??
    report.mailboxes.find((x) => x.verdict === "watch");
  if (sick === undefined) return m.headlineRoom(used);
  return isBouncing(sick)
    ? m.headlineBouncing(sick.address, used)
    : m.headlineLook(sick.address, used);
}

/** The footer: the mailbox with the most room, and about how many more a day it can take. */
export function mailboxesMeaning(rows: readonly MailboxRow[]): string {
  const m = t.mailboxes;
  let best: MailboxRow | null = null;
  for (const r of rows) {
    if (best === null || r.room - r.sent > best.room - best.sent) best = r;
  }
  if (best === null) return m.meaningFull;
  const perDay = Math.floor((best.room - best.sent) / 7);
  return perDay > 0 ? m.meaningRoom(best.address, num(perDay)) : m.meaningFull;
}
