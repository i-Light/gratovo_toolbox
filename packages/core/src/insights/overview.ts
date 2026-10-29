import { alerts, wins } from "./alerts";
import type { ReportParts } from "./alerts";
import { emailsReport } from "./emails";
import { biggestDrop, creatorFunnel, creatorsOf, funnelReport } from "./funnel";
import { goalReport } from "./goal";
import type { InsightsInputs, MessageFact } from "./inputs";
import { searchReport } from "./search";
import { compareRates, rateVerdict, startOfDay, startOfWeek, workingDays } from "./stats";
import { thresholds } from "./thresholds";
import type {
  AlertLine,
  OverviewReport,
  Point,
  Ratio,
  ReportWindow,
  SearchReport,
  SummaryPart,
  Verdict,
} from "./types";

/**
 * The Overview (design 3.1): the few sentences, five vital signs, what needs attention, what's
 * working and the pipeline at a glance. Built from the other tabs' reports, so a number here is the
 * number on its tab. Pure; empty input gives early verdicts and nulls, never a throw.
 */

function addDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function isBounce(m: MessageFact): boolean {
  return m.bounce || m.reading === "bounce";
}

function isSequenceEmail(m: MessageFact): boolean {
  return m.direction === "out" && (m.kind === "first" || m.kind === "followUp");
}

function inSpan(t: number, from: number, to: number): boolean {
  return t >= from && t < to;
}

// ---------------------------------------------------------------------------------------------
// Fuel and replies waiting (exported so a number and the list behind it share one rule)

/**
 * Creators ready to email: live creators at stage `contact`, or shortlisted with a confirmed
 * address, who have not been emailed yet.
 */
export function readyIds(inputs: InsightsInputs): string[] {
  const emailed = new Set<string>();
  for (const m of inputs.messages) if (isSequenceEmail(m)) emailed.add(m.channelId);
  return inputs.channels
    .filter(
      (c) =>
        (c.stage === "contact" || (c.stage === "shortlisted" && c.confirmedAt !== null)) &&
        !emailed.has(c.id),
    )
    .map((c) => c.id);
}

/**
 * Creators whose newest message is a reply from them (not a bounce): nothing of ours came after
 * it. With when each reply came.
 */
export function repliesWaitingList(
  inputs: InsightsInputs,
): { readonly id: string; readonly at: number }[] {
  const newest = new Map<string, MessageFact>();
  for (const m of inputs.messages) {
    const seen = newest.get(m.channelId);
    if (!seen || m.at >= seen.at) newest.set(m.channelId, m);
  }
  const setAside = new Set(
    inputs.channels
      .filter((c) => c.stage === "rejected" || c.stage === "parked" || c.stage === "never")
      .map((c) => c.id),
  );
  const out: { id: string; at: number }[] = [];
  for (const [id, m] of newest) {
    // An auto-reply (out of office) or a plain no waits for nothing, and nor does a creator set
    // aside (rejected, parked or never contact).
    if (m.direction !== "in" || isBounce(m) || setAside.has(id)) continue;
    if (m.reading === "auto" || m.reading === "no") continue;
    out.push({ id, at: m.at });
  }
  return out;
}

export function repliesWaitingIds(inputs: InsightsInputs): string[] {
  return repliesWaitingList(inputs).map((r) => r.id);
}

function fuelOf(inputs: InsightsInputs, search: SearchReport): OverviewReport["vitals"]["fuel"] {
  const ready = readyIds(inputs).length;
  const from = addDays(inputs.now, -14);
  const firsts = inputs.messages.filter(
    (m) => m.direction === "out" && m.kind === "first" && inSpan(m.at, from, inputs.now),
  ).length;
  const firstPerDay = firsts / Math.max(1, workingDays({ from, to: inputs.now }));
  const days = firstPerDay > 0 ? ready / firstPerDay : null;
  let verdict: Verdict;
  if (firstPerDay === 0 && ready === 0) verdict = "early";
  else if (days !== null && days < thresholds.fuelAct) verdict = "act";
  else if (days !== null && days < thresholds.fuelWatch) verdict = "watch";
  else verdict = "good";
  return {
    ready,
    firstPerDay,
    days,
    waitingConfirm: search.live.addresses.waiting,
    verdict,
  };
}

// ---------------------------------------------------------------------------------------------
// Trends

/** Emails sent each of the last 14 days, oldest first (today so far last). */
function sendTrend(inputs: InsightsInputs): Point[] {
  const today = startOfDay(inputs.now);
  const counts = new Map<number, number>();
  for (const m of inputs.messages) {
    if (!isSequenceEmail(m)) continue;
    const day = startOfDay(m.at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: Point[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const at = addDays(today, -i);
    out.push({ at, value: counts.get(at) ?? 0 });
  }
  return out;
}

/** The reply rate of emails each of the last 8 weeks, oldest first; null in a week with no sends. */
function replyTrend(inputs: InsightsInputs): Point[] {
  const thisMonday = startOfWeek(inputs.now);
  const weeks = new Map<number, { n: number; d: number }>();
  for (const m of inputs.messages) {
    const sent = isSequenceEmail(m);
    if (!sent && !(m.direction === "in" && !isBounce(m))) continue;
    const week = startOfWeek(m.at);
    const cell = weeks.get(week) ?? { n: 0, d: 0 };
    if (sent) cell.d += 1;
    else cell.n += 1;
    weeks.set(week, cell);
  }
  const out: Point[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    const at = addDays(thisMonday, -7 * i);
    const cell = weeks.get(at);
    out.push({ at, value: cell && cell.d > 0 ? cell.n / cell.d : null });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The report

/**
 * Everything the Overview shows, for the period asked for. `shared` lets a caller that already built
 * some of the tabs' reports pass them in instead of working them out again.
 */
export function overviewReport(
  inputs: InsightsInputs,
  window: ReportWindow,
  shared: Partial<Pick<ReportParts, "emails" | "search" | "funnel" | "goal">> = {},
): OverviewReport {
  const emails = shared.emails ?? emailsReport(inputs, window);
  const search = shared.search ?? searchReport(inputs, window);
  const funnel = shared.funnel ?? funnelReport(inputs, window);
  const goal = shared.goal ?? goalReport(inputs, window);
  const fuel = fuelOf(inputs, search);
  const parts: ReportParts = { emails, search, funnel, goal, fuel };

  // Emails.
  const { from, to } = window.current;
  const firstEmails = inputs.messages.filter(
    (m) => m.direction === "out" && m.kind === "first" && inSpan(m.at, from, to),
  ).length;
  const firstPerDay = firstEmails / window.workingDays;
  const goalPerDay =
    inputs.goal.signsPerMonth > 0
      ? (goal.lines.find((l) => l.step === "firstEmails")?.perDay ?? null)
      : null;
  let emailsVerdict: Verdict;
  if (goalPerDay === null || emails.sent === 0) emailsVerdict = "early";
  else emailsVerdict = firstPerDay >= goalPerDay ? "good" : "watch";

  // Reply rate (rule 10: replies ÷ emails sent).
  const replyDifference = compareRates(emails.rate, emails.rateBefore, thresholds.minEmails);

  // Signed per 1,000 emails.
  const creators = creatorsOf(inputs);
  const signedIn = (a: number, b: number): number =>
    creators.filter((c) => {
      const at = c.reached.signed;
      return at != null && inSpan(at, a, b);
    }).length;
  const signedNow: Ratio = { n: signedIn(from, to), d: emails.sent };
  const from90 = addDays(window.now, -90);
  const ninety: Ratio = {
    n: signedIn(from90, window.now),
    d: inputs.messages.filter((m) => isSequenceEmail(m) && inSpan(m.at, from90, window.now)).length,
  };
  let signedVerdict: Verdict;
  if (signedNow.d < 500) signedVerdict = "early";
  else
    signedVerdict =
      (signedNow.n / signedNow.d) * 1000 >= thresholds.signedPer1000 ? "good" : "watch";

  // Replies waiting for us.
  const waiting = repliesWaitingList(inputs);
  const oldestAt = waiting.reduce<number | null>(
    (best, r) => (best === null || r.at < best ? r.at : best),
    null,
  );
  const overdue = waiting.some((r) => inputs.now - r.at > thresholds.answerHours * 3_600_000);

  // The lists.
  const { lines, hidden } = alerts(inputs, parts);
  const everyone = creatorFunnel(inputs, window, "everyone");

  const urgent: AlertLine[] = lines.filter((l) => l.verdict === "act");
  const summary: SummaryPart[] = [
    {
      kind: "sent",
      sent: emails.sent,
      change: emails.sent - emails.rateBefore.d,
      onPace: emailsVerdict === "good" ? true : emailsVerdict === "watch" ? false : null,
    },
    { kind: "replies", replied: emails.rate.n, rate: emails.rate, signed: signedNow.n },
    urgent.length > 0 ? { kind: "needs", alerts: urgent } : { kind: "quiet" },
  ];

  return {
    tab: "overview",
    window,
    summary,
    vitals: {
      emails: {
        sent: emails.sent,
        before: emails.rateBefore.d,
        firstEmails,
        firstPerDay,
        neededPerDay: goalPerDay,
        verdict: emailsVerdict,
        trend: sendTrend(inputs),
      },
      replyRate: {
        now: emails.rate,
        before: emails.rateBefore,
        difference: replyDifference,
        verdict: rateVerdict(emails.rate, thresholds.replyFloor, thresholds.minEmails),
        trend: replyTrend(inputs),
      },
      signedPer1000: { now: signedNow, ninety, verdict: signedVerdict },
      fuel,
      repliesWaiting: {
        count: waiting.length,
        oldestAt,
        verdict: overdue ? "watch" : "good",
      },
    },
    attention: lines,
    hidden,
    wins: wins(inputs, parts),
    pipeline: everyone,
    biggestDrop: biggestDrop(everyone),
  };
}
