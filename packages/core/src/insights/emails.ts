import type { ChannelFacts, InsightsInputs, MessageFact } from "./inputs";
import { compareRates, median, rateOf, rateVerdict, startOfDay } from "./stats";
import { thresholds } from "./thresholds";
import { positiveReadings, readingKinds } from "./types";
import type {
  Batch,
  Diagnosis,
  EmailsReport,
  MailboxRow,
  PatternKind,
  PatternSplit,
  Ratio,
  ReadingKind,
  ReportWindow,
  Verdict,
} from "./types";

/**
 * The Emails tab (design 3.3): sends and replies, which email earns the replies, what the replies
 * say, batches of 50 with a diagnosis, mailboxes, patterns and how fast we answer. Pure; empty
 * input gives zeros and nulls, never a throw. A reply rate is replies ÷ emails sent (rule 10).
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

function isBounce(m: MessageFact): boolean {
  return m.bounce || m.reading === "bounce";
}

/** An email we sent as part of the sequence: a first email or a follow-up. */
function isSequenceEmail(m: MessageFact): boolean {
  return m.direction === "out" && (m.kind === "first" || m.kind === "followUp");
}

function isReply(m: MessageFact): boolean {
  return m.direction === "in" && !isBounce(m);
}

/** Messages grouped by creator, each list oldest first. */
function groupByChannel(
  messages: readonly MessageFact[],
  keep: (m: MessageFact) => boolean,
): Map<string, MessageFact[]> {
  const map = new Map<string, MessageFact[]>();
  for (const m of messages) {
    if (!keep(m)) continue;
    const list = map.get(m.channelId);
    if (list) list.push(m);
    else map.set(m.channelId, [m]);
  }
  for (const list of map.values()) list.sort((a, b) => a.at - b.at);
  return map;
}

/** The newest message in `list` (oldest first) that is strictly before `t`. */
function latestBefore(list: readonly MessageFact[] | undefined, t: number): MessageFact | null {
  let found: MessageFact | null = null;
  for (const m of list ?? []) {
    if (m.at >= t) break;
    found = m;
  }
  return found;
}

/** The first message in `list` (oldest first) at or after `t`, and within `within` ms if given. */
function firstAfter(
  list: readonly MessageFact[] | undefined,
  t: number,
  within: number,
): MessageFact | null {
  for (const m of list ?? []) {
    if (m.at < t) continue;
    return m.at - t <= within ? m : null;
  }
  return null;
}

function daysBefore(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

function inSpan(t: number, from: number, to: number): boolean {
  return t >= from && t < to;
}

// ---------------------------------------------------------------------------------------------
// Batches

/** The three plain rules (design 3.3 item 4). */
export function diagnose(b: Omit<Batch, "diagnosis">): Diagnosis {
  if (b.sent < thresholds.minEmails) return "early";
  if (b.bounced / b.sent > thresholds.bounceShare) return "delivery";
  if (b.replied / b.sent < thresholds.replyFloor) return "writing";
  if (b.replied >= 1 && b.positive / b.replied < 0.5) return "targeting";
  return "healthy";
}

/**
 * First emails in send order, cut into batches of 50 (the oldest is batch 1; the newest may be
 * short). Per first email: bounced when a bounce came back within 7 days, replied when the creator
 * answered (not a bounce) within 30 days, positive when that first answer reads as a way forward,
 * signed when the creator reached `signed`. Newest first, at most 12.
 */
export function batches(inputs: InsightsInputs): Batch[] {
  const firsts = inputs.messages
    .filter((m) => m.direction === "out" && m.kind === "first")
    .sort((a, b) => a.at - b.at);
  const replies = groupByChannel(inputs.messages, isReply);
  const bounces = groupByChannel(inputs.messages, (m) => m.direction === "in" && isBounce(m));
  const signed = new Set<string>();
  for (const e of inputs.events) if (e.stage === "signed") signed.add(e.channelId);
  for (const c of inputs.channels) if (c.stage === "signed") signed.add(c.id);

  const out: Batch[] = [];
  for (let start = 0; start < firsts.length; start += thresholds.batchSize) {
    const chunk = firsts.slice(start, start + thresholds.batchSize);
    let bounced = 0;
    let replied = 0;
    let positive = 0;
    let signedN = 0;
    const bounceMailboxes = new Map<string, number>();
    for (const email of chunk) {
      const bounce = firstAfter(bounces.get(email.channelId), email.at, 7 * DAY);
      if (bounce) {
        bounced += 1;
        const box = email.mailbox ?? bounce.mailbox;
        if (box !== null) bounceMailboxes.set(box, (bounceMailboxes.get(box) ?? 0) + 1);
      }
      const reply = firstAfter(replies.get(email.channelId), email.at, 30 * DAY);
      if (reply) {
        replied += 1;
        if (reply.reading !== null && positiveReadings.includes(reply.reading)) positive += 1;
      }
      if (signed.has(email.channelId)) signedN += 1;
    }
    let bounceMailbox: string | null = null;
    for (const [box, n] of bounceMailboxes) if (n * 2 > bounced) bounceMailbox = box;
    const part = {
      index: start / thresholds.batchSize + 1,
      from: chunk[0]?.at ?? 0,
      to: chunk[chunk.length - 1]?.at ?? 0,
      sent: chunk.length,
      bounced,
      replied,
      positive,
      signed: signedN,
      bounceMailbox,
    };
    out.push({ ...part, diagnosis: diagnose(part) });
  }
  return out.reverse().slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// Patterns

interface FirstEmail {
  readonly message: MessageFact;
  readonly channel: ChannelFacts | null;
  readonly replied: boolean;
}

const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function sizeBand(views: number | null): string | null {
  if (views === null) return null;
  if (views < 50_000) return "under50k";
  if (views <= 150_000) return "50kTo150k";
  return "over150k";
}

/**
 * The hour of the send in this computer's time. Creator-local time waits for a time zone on the
 * creator (none is stored yet); until then the hour bands are the sender's.
 */
function hourBand(t: number): string {
  const h = new Date(t).getHours();
  if (h >= 6 && h < 12) return "6to11";
  if (h >= 12 && h < 18) return "12to17";
  if (h >= 18) return "18to23";
  return "0to5";
}

type Grouping = (e: FirstEmail) => string | null;

/** Keep the `top` most common keys; everything else becomes `rest` (or is dropped when null). */
function topKeys(
  emails: readonly FirstEmail[],
  of: Grouping,
  top: number,
  rest: string | null,
): Grouping {
  const counts = new Map<string, number>();
  for (const e of emails) {
    const k = of(e);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keep = new Set(
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([k]) => k),
  );
  return (e) => {
    const k = of(e);
    if (k === null) return null;
    return keep.has(k) ? k : rest;
  };
}

function splitBy(
  kind: PatternKind,
  emails: readonly FirstEmail[],
  of: Grouping,
): PatternSplit | null {
  const tally = new Map<string, { n: number; d: number }>();
  for (const e of emails) {
    const key = of(e);
    if (key === null) continue;
    const cell = tally.get(key) ?? { n: 0, d: 0 };
    cell.d += 1;
    if (e.replied) cell.n += 1;
    tally.set(key, cell);
  }
  const groups = [...tally]
    .filter(([, r]) => r.d >= thresholds.minOther)
    .map(([key, r]) => ({ key, rate: { n: r.n, d: r.d } }));
  if (groups.length < 2) return null;
  let best = groups[0];
  let worst = groups[0];
  for (const g of groups) {
    const rate = rateOf(g.rate) ?? 0;
    if (best && rate > (rateOf(best.rate) ?? 0)) best = g;
    if (worst && rate < (rateOf(worst.rate) ?? 0)) worst = g;
  }
  if (!best || !worst) return null;
  const result = compareRates(best.rate, worst.rate, thresholds.minEmails);
  return { kind, groups, result, best: result === "clear" ? best.key : null };
}

function gapOf(s: PatternSplit): number {
  const rates = s.groups.map((g) => rateOf(g.rate) ?? 0);
  return Math.max(...rates) - Math.min(...rates);
}

/**
 * The reply rate of first emails (the creator replied within 30 days), split by what we know:
 * edited or as written, rewrite, size, country (top 3 and the rest), keyword (top 5), weekday and
 * send hour. Only groups with at least `minOther` emails, only splits with two such groups. Clear
 * differences first, then the biggest gap.
 */
export function patterns(inputs: InsightsInputs): PatternSplit[] {
  const channels = new Map(inputs.channels.map((c) => [c.id, c]));
  const replies = groupByChannel(inputs.messages, isReply);
  const emails: FirstEmail[] = inputs.messages
    .filter((m) => m.direction === "out" && m.kind === "first")
    .map((message) => ({
      message,
      channel: channels.get(message.channelId) ?? null,
      replied: firstAfter(replies.get(message.channelId), message.at, 30 * DAY) !== null,
    }));

  const splits = [
    splitBy("edited", emails, (e) =>
      e.message.edited === null ? null : e.message.edited ? "edited" : "asWritten",
    ),
    splitBy("rewrite", emails, (e) => e.message.rewrite ?? "none"),
    splitBy("size", emails, (e) => sizeBand(e.channel?.medianViews ?? null)),
    splitBy(
      "country",
      emails,
      topKeys(emails, (e) => e.channel?.country ?? null, 3, "others"),
    ),
    splitBy(
      "keyword",
      emails,
      topKeys(emails, (e) => e.channel?.keywords[0] ?? null, 5, null),
    ),
    splitBy("weekday", emails, (e) => weekdayKeys[new Date(e.message.at).getDay()] ?? null),
    splitBy("hour", emails, (e) => hourBand(e.message.at)),
  ].filter((s): s is PatternSplit => s !== null);

  return splits.sort((a, b) => {
    const clear = Number(b.result === "clear") - Number(a.result === "clear");
    return clear !== 0 ? clear : gapOf(b) - gapOf(a);
  });
}

// ---------------------------------------------------------------------------------------------
// The report

function dailyRows(inputs: InsightsInputs, window: ReportWindow): EmailsReport["daily"] {
  const { from, to } = window.current;
  const days = new Map<number, { sent: number; replies: number }>();
  for (const m of inputs.messages) {
    if (!inSpan(m.at, from, to)) continue;
    const sent = isSequenceEmail(m);
    if (!sent && !isReply(m)) continue;
    const key = startOfDay(m.at);
    const cell = days.get(key) ?? { sent: 0, replies: 0 };
    if (sent) cell.sent += 1;
    else cell.replies += 1;
    days.set(key, cell);
  }
  const out: { at: number; sent: number; replies: number }[] = [];
  const d = new Date(startOfDay(from));
  while (d.getTime() < to) {
    const cell = days.get(d.getTime());
    out.push({ at: d.getTime(), sent: cell?.sent ?? 0, replies: cell?.replies ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function countIn(inputs: InsightsInputs, from: number, to: number): Ratio {
  let n = 0;
  let d = 0;
  for (const m of inputs.messages) {
    if (!inSpan(m.at, from, to)) continue;
    if (isSequenceEmail(m)) d += 1;
    else if (isReply(m)) n += 1;
  }
  return { n, d };
}

/** Last 90 days: step 0 is the first email, 1 to 3 the follow-ups; a reply goes to the latest email before it. */
function bySteps(inputs: InsightsInputs): EmailsReport["bySteps"] {
  const from = daysBefore(inputs.now, 90);
  const outs = groupByChannel(inputs.messages, isSequenceEmail);
  const sent = [0, 0, 0, 0];
  const credited = [0, 0, 0, 0];
  const stepOf = (m: MessageFact): number =>
    m.kind === "first" ? 0 : Math.min(3, Math.max(1, m.followUp ?? 1));
  for (const m of inputs.messages) {
    if (!inSpan(m.at, from, inputs.now)) continue;
    if (isSequenceEmail(m)) {
      sent[stepOf(m)] = (sent[stepOf(m)] ?? 0) + 1;
    } else if (isReply(m)) {
      const email = latestBefore(outs.get(m.channelId), m.at);
      if (email) credited[stepOf(email)] = (credited[stepOf(email)] ?? 0) + 1;
    }
  }
  const total = credited.reduce((s, x) => s + x, 0);
  return sent.map((d, step) => ({
    step,
    rate: { n: credited[step] ?? 0, d },
    share: { n: credited[step] ?? 0, d: total },
  }));
}

function readingsOf(inputs: InsightsInputs): Pick<EmailsReport, "readings" | "positive"> {
  const from = daysBefore(inputs.now, 90);
  const counts = new Map<ReadingKind, number>();
  let total = 0;
  let positive = 0;
  for (const m of inputs.messages) {
    if (m.direction !== "in" || isBounce(m) || m.reading === null) continue;
    if (!inSpan(m.at, from, inputs.now)) continue;
    counts.set(m.reading, (counts.get(m.reading) ?? 0) + 1);
    total += 1;
    if (positiveReadings.includes(m.reading)) positive += 1;
  }
  return {
    readings: readingKinds
      .filter((kind) => kind !== "bounce")
      .map((kind) => ({ kind, count: counts.get(kind) ?? 0 })),
    positive: { n: positive, d: total },
  };
}

/**
 * Last 30 days: for each reply (not a bounce), the hours until our next answer to that creator.
 * One with no answer yet counts as waiting for the time since it came. "Good" when the median is
 * within a day and nobody waited over `answerHours`; "early" under 5 replies.
 */
function answerOf(inputs: InsightsInputs): EmailsReport["answer"] {
  const from = daysBefore(inputs.now, 30);
  const answers = groupByChannel(
    inputs.messages,
    (m) => m.direction === "out" && m.kind === "reply",
  );
  const hours: number[] = [];
  let overDay = 0;
  let replies = 0;
  for (const m of inputs.messages) {
    if (!isReply(m) || !inSpan(m.at, from, inputs.now)) continue;
    replies += 1;
    const answer = firstAfter(answers.get(m.channelId), m.at, Infinity);
    const waited = ((answer ? answer.at : inputs.now) - m.at) / HOUR;
    if (answer) hours.push(waited);
    if (waited > thresholds.answerHours) overDay += 1;
  }
  const medianHours = median(hours);
  let verdict: Verdict = "watch";
  if (replies < 5) verdict = "early";
  else if ((medianHours === null || medianHours <= 24) && overDay === 0) verdict = "good";
  return { medianHours, overDay, verdict };
}

function mailboxRows(inputs: InsightsInputs): MailboxRow[] {
  const from7 = daysBefore(inputs.now, 7);
  const from30 = daysBefore(inputs.now, 30);
  const outs = groupByChannel(inputs.messages, (m) => m.direction === "out");
  const replies = groupByChannel(inputs.messages, isReply);
  return inputs.mailboxes.map((box): MailboxRow => {
    let sent = 0;
    let bounces = 0;
    let firsts = 0;
    let replied = 0;
    for (const m of inputs.messages) {
      if (m.direction === "out") {
        if (m.mailbox !== box.address) continue;
        if (inSpan(m.at, from7, inputs.now)) sent += 1;
        if (m.kind === "first" && inSpan(m.at, from30, inputs.now)) {
          firsts += 1;
          if (firstAfter(replies.get(m.channelId), m.at, Infinity)) replied += 1;
        }
      } else if (isBounce(m) && inSpan(m.at, from7, inputs.now)) {
        if (latestBefore(outs.get(m.channelId), m.at)?.mailbox === box.address) bounces += 1;
      }
    }
    const room = box.paused ? 0 : (box.heldAt ?? box.dailyCap) * 7;
    let warmupDay: number | null = null;
    if (box.warmupStartedAt !== null && box.warmupDays !== null) {
      const day = Math.round((startOfDay(inputs.now) - startOfDay(box.warmupStartedAt)) / DAY) + 1;
      if (day >= 1 && day <= box.warmupDays) warmupDay = day;
    }
    let verdict: Verdict = "good";
    if (sent < thresholds.bounceMin) verdict = "early";
    else if (bounces / sent > thresholds.bounceShare) verdict = "act";
    return {
      address: box.address,
      warmupDay,
      warmupDays: box.warmupDays,
      heldAt: box.heldAt,
      sent,
      room,
      bounced: { n: bounces, d: sent },
      replies: { n: replied, d: firsts },
      verdict,
    };
  });
}

/** Everything the Emails tab shows, for the period asked for. */
export function emailsReport(inputs: InsightsInputs, window: ReportWindow): EmailsReport {
  const rate = countIn(inputs, window.current.from, window.current.to);
  const rateBefore = countIn(inputs, window.previous.from, window.previous.to);
  const mailboxes = mailboxRows(inputs);
  return {
    tab: "emails",
    window,
    daily: dailyRows(inputs, window),
    sent: rate.d,
    rate,
    rateBefore,
    rateVerdict: rateVerdict(rate, thresholds.replyFloor, thresholds.minEmails),
    bySteps: bySteps(inputs),
    ...readingsOf(inputs),
    batches: batches(inputs),
    patterns: patterns(inputs),
    answer: answerOf(inputs),
    mailboxes,
    capacity: {
      n: mailboxes.reduce((s, r) => s + r.sent, 0),
      d: mailboxes.reduce((s, r) => s + r.room, 0),
    },
  };
}
