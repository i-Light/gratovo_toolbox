import { thresholds } from "@gratovo/core/insights";
import type {
  Alert,
  AlertLine,
  CreatorStep,
  Difference,
  FunnelRow,
  OverviewReport,
  SummaryPart,
  Win,
  WinLine,
} from "@gratovo/core/insights";

import { strings } from "../../strings";
import { decimal, num, plural, ratioPct, ratioText } from "./format";

const t = strings.insights.overview;
const reasons = strings.insights.funnel.exits;

/** A piece of a sentence; bold pieces carry the finding. */
export interface Run {
  readonly text: string;
  readonly bold?: boolean;
}

const plain = (text: string): Run => ({ text });
const bold = (text: string): Run => ({ text, bold: true });

// ---------------------------------------------------------------------------------------------
// Alerts

/** The words of one alert: title, why it matters, the evidence in numbers, and its button. */
export interface AlertWords {
  readonly title: string;
  readonly why: string;
  readonly evidence: string;
  readonly action: string;
}

export function alertWords(alert: Alert): AlertWords {
  const a = t.alerts;
  switch (alert.kind) {
    case "mailboxBounces":
      return {
        title: a.mailboxBounces.title(alert.mailbox),
        why: a.mailboxBounces.why,
        evidence: a.mailboxBounces.evidence(ratioText(alert.bounced)),
        action: a.mailboxBounces.action,
      };
    case "repliesFell":
      return {
        title: a.repliesFell.title(num(alert.batch)),
        why: a.repliesFell.why,
        evidence: a.repliesFell.evidence(ratioText(alert.rate), ratioText(alert.usual)),
        action: a.repliesFell.action,
      };
    case "fuelLow":
      return {
        title: a.fuelLow.title,
        why: a.fuelLow.why,
        evidence: a.fuelLow.evidence(
          num(alert.ready),
          t.fmt.daysLong(decimal(alert.days)),
          num(alert.waitingConfirm),
        ),
        action: a.fuelLow.action,
      };
    case "repliesFalling":
      return {
        title: a.repliesFalling.title(num(alert.batches)),
        why: a.repliesFalling.why,
        evidence: a.repliesFalling.evidence(num(alert.batches)),
        action: a.repliesFalling.action,
      };
    case "roomUnused":
      return {
        title: a.roomUnused.title,
        why: a.roomUnused.why,
        evidence: a.roomUnused.evidence(ratioText(alert.used)),
        action: a.roomUnused.action,
      };
    case "keywordWeak":
      return {
        title: a.keywordWeak.title(alert.keyword),
        why: a.keywordWeak.why,
        evidence: a.keywordWeak.evidence(ratioText(alert.replied), ratioText(alert.others)),
        action: a.keywordWeak.action,
      };
    case "keywordWornOut":
      return {
        title: a.keywordWornOut.title(alert.keyword),
        why: a.keywordWornOut.why,
        evidence: a.keywordWornOut.evidence(ratioText(alert.known)),
        action: a.keywordWornOut.action,
      };
    case "stepShort":
      return {
        title: a.stepShort.title(a.stepShort.steps[alert.step]),
        why: a.stepShort.why,
        evidence: a.stepShort.evidence(decimal(alert.perDay), decimal(alert.needed)),
        action: a.stepShort.action,
      };
    case "noSearch":
      return {
        title: a.noSearch.title(t.fmt.daysLong(num(alert.days))),
        why: a.noSearch.why,
        evidence: a.noSearch.evidence(
          t.fmt.daysLong(num(alert.days)),
          t.fmt.daysLong(decimal(alert.fuelDays)),
        ),
        action: a.noSearch.action,
      };
    case "backlogGrowing":
      return {
        title: a.backlogGrowing.title,
        why: a.backlogGrowing.why,
        evidence: a.backlogGrowing.evidence(num(alert.count), t.fmt.daysLong(decimal(alert.days))),
        action: a.backlogGrowing.action,
      };
    case "reFindsArchive":
      return {
        title: a.reFindsArchive.title(alert.keyword),
        why: a.reFindsArchive.why,
        evidence: a.reFindsArchive.evidence(ratioText(alert.archived)),
        action: a.reFindsArchive.action,
      };
    case "mistakesLeaving":
      return {
        title: a.mistakesLeaving.title(num(alert.count)),
        why: a.mistakesLeaving.why,
        evidence: a.mistakesLeaving.evidence,
        action: a.mistakesLeaving.action,
      };
    case "rejectsTooStrict":
      return {
        title: a.rejectsTooStrict.title(reasons.reasonsLower[alert.reason]),
        why: a.rejectsTooStrict.why,
        evidence: a.rejectsTooStrict.evidence(num(alert.back), num(alert.replied)),
        action: a.rejectsTooStrict.action,
      };
    case "unreadable":
      return {
        title: a.unreadable.title,
        why: a.unreadable.why,
        evidence: a.unreadable.evidence(ratioText(alert.count)),
        action: a.unreadable.action,
      };
    case "auditFailing":
      return {
        title: a.auditFailing.title(reasons.checks[alert.check]),
        why: a.auditFailing.why,
        evidence: a.auditFailing.evidence(ratioText(alert.failed)),
        action: a.auditFailing.action,
      };
  }
}

/** The words of one win: title, the numbers, what to do more of, and its button. */
export interface WinWords {
  readonly title: string;
  readonly evidence: string;
  readonly todo: string;
  readonly action: string;
}

export function winWords(win: Win): WinWords {
  const w = t.wins;
  switch (win.kind) {
    case "edited":
      return {
        title: w.edited.title,
        evidence: w.edited.evidence(ratioText(win.edited), ratioText(win.asWritten)),
        todo: w.edited.todo,
        action: w.edited.action,
      };
    case "keyword":
      return {
        title: w.keyword.title(win.keyword),
        evidence: w.keyword.evidence(ratioText(win.replied), num(win.signed)),
        todo: w.keyword.todo,
        action: w.keyword.action,
      };
    case "mailbox":
      return {
        title: w.mailbox.title(win.mailbox),
        evidence: w.mailbox.evidence(ratioText(win.replies)),
        todo: w.mailbox.todo,
        action: w.mailbox.action,
      };
    case "followUp":
      return {
        title: w.followUp.title(num(win.step)),
        evidence: w.followUp.evidence(ratioPct(win.share), ratioText(win.rate)),
        todo: w.followUp.todo,
        action: w.followUp.action,
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Headlines, chosen by rule from the numbers (design rule 1)

/**
 * The Needs attention headline. Any "Act now" line: "N things need you now", then the watch count.
 * Only "Watch" lines: "N things are worth watching". None: "Nothing needs you right now."
 */
export function attentionHeadline(lines: readonly AlertLine[]): string {
  const a = t.attention;
  const act = lines.filter((l) => l.verdict === "act").length;
  const watch = lines.length - act;
  if (act === 0 && watch === 0) return a.headlineNone;
  if (act === 0) return watch === 1 ? a.headlineWatchOnlyOne : a.headlineWatchOnlyMany(num(watch));
  const first = act === 1 ? a.headlineActOne : a.headlineActMany(num(act));
  if (watch === 0) return `${first}.`;
  return `${first}, ${watch === 1 ? a.headlineWatchOne : a.headlineWatchMany(num(watch))}.`;
}

/** The line under the Needs attention headline. */
export function attentionCounted(shown: number, total: number): string {
  return total === 0
    ? t.attention.headlineNoneCounted
    : t.attention.counted(num(shown), num(total));
}

/** The What's working headline: how many wins there are. */
export function winsHeadline(wins: readonly WinLine[]): string {
  if (wins.length === 0) return t.wins.headlineNone;
  return wins.length === 1 ? t.wins.headlineOne : t.wins.headlineMany(num(wins.length));
}

export function winsCounted(wins: readonly WinLine[]): string {
  return wins.length === 0 ? t.wins.headlineNoneCounted : t.wins.counted;
}

/** The summary hero as sentence pieces, one part after another. */
export function summaryRuns(parts: readonly SummaryPart[]): Run[] {
  const s = t.summary;
  const out: Run[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(plain(" "));
    switch (part.kind) {
      case "sent": {
        out.push(plain(s.sentLead), bold(plural(part.sent, t.nouns.email)));
        const change = Math.abs(part.change);
        out.push(
          plain(
            part.change > 0
              ? s.sentMore(num(change))
              : part.change < 0
                ? s.sentFewer(num(change))
                : s.sentSame,
          ),
        );
        if (part.onPace !== null) {
          out.push(
            plain(s.paceLead),
            bold(part.onPace ? s.paceOn : s.paceBehind),
            plain(s.paceTail),
          );
        }
        out.push(plain(s.sentEnd));
        break;
      }
      case "replies":
        out.push(
          bold(plural(part.replied, t.nouns.reply)),
          plain(s.repliesTail(ratioText(part.rate))),
          plain(part.signed > 0 ? s.signedSome(num(part.signed)) : s.signedNone),
        );
        break;
      case "needs": {
        const act = part.alerts.filter((l) => l.verdict === "act");
        const lines = act.length > 0 ? act : part.alerts;
        const count = lines.length;
        const lead =
          act.length > 0
            ? count === 1
              ? s.needsOne
              : s.needsMany(num(count))
            : count === 1
              ? s.watchOne
              : s.watchMany(num(count));
        const titles = lines.slice(0, 2).map((l) => alertWords(l.alert).title);
        const more = count > 2 ? s.needsMore(num(count - 2)) : "";
        out.push(bold(lead), plain(`${s.needsJoin}${titles.join(s.needsAnd)}${more}.`));
        break;
      }
      case "quiet":
        out.push(plain(s.quiet));
        break;
    }
  });
  return out;
}

/** The summary as plain text, for Copy summary. */
export function summaryText(parts: readonly SummaryPart[]): string {
  return summaryRuns(parts)
    .map((r) => r.text)
    .join("");
}

// ---------------------------------------------------------------------------------------------
// The five tiles

type Vitals = OverviewReport["vitals"];

function changeWords(now: number, before: number): string {
  const c = t.vitals.change;
  const diff = Math.abs(now - before);
  return now > before ? c.more(num(diff)) : now < before ? c.fewer(num(diff)) : c.same;
}

/** What a tile shows: the big value, an optional unit, and its lines of detail. */
export interface TileWords {
  readonly value: string;
  readonly unit?: string;
  readonly lines: readonly string[];
}

export function emailsTile(v: Vitals["emails"]): TileWords {
  const goal = v.neededPerDay === null ? "" : t.vitals.emails.goal(decimal(v.neededPerDay));
  return {
    value: num(v.sent),
    lines: [
      `${t.vitals.emails.detail(num(v.firstEmails), decimal(v.firstPerDay))}${goal}`,
      changeWords(v.sent, v.before),
    ],
  };
}

const differenceTail: Readonly<Record<Difference, string>> = {
  clear: t.vitals.replyRate.clear,
  chance: t.vitals.replyRate.chance,
  early: t.vitals.replyRate.early,
};

export function replyRateTile(v: Vitals["replyRate"]): TileWords {
  const r = t.vitals.replyRate;
  const share = v.now.d > 0 ? v.now.n / v.now.d : null;
  const floor = share === null ? "" : share >= thresholds.replyFloor ? r.above : r.below;
  const before =
    v.before.d === 0
      ? r.noBefore
      : `${r.before(ratioText(v.before))}${differenceTail[v.difference]}`;
  return {
    value: ratioPct(v.now),
    lines: [`${r.detail(ratioText(v.now))}${floor}`, before],
  };
}

export function signedTile(v: Vitals["signedPer1000"]): TileWords {
  const s = t.vitals.signed;
  const lines: string[] = [
    v.verdict === "early"
      ? s.tooEarly(num(v.now.d), num(thresholds.minEmails))
      : s.detail(num(v.now.n), num(v.now.d)),
    s.ninety(num(v.ninety.n), num(v.ninety.d)),
    s.course,
  ];
  return {
    value: v.now.d === 0 ? t.fmt.dash : decimal((v.now.n / v.now.d) * 1000),
    lines,
  };
}

export function fuelTile(v: Vitals["fuel"]): TileWords {
  const f = t.vitals.fuel;
  const lines = [f.detail(num(v.ready), decimal(v.firstPerDay))];
  if (v.waitingConfirm > 0) lines.push(f.waiting(num(v.waitingConfirm)));
  if (v.verdict === "act") lines.push(f.act);
  else if (v.verdict === "watch") lines.push(f.watch);
  return {
    value: v.days === null ? t.fmt.dash : decimal(v.days),
    ...(v.days === null ? {} : { unit: f.unit }),
    lines,
  };
}

export function waitingTile(v: Vitals["repliesWaiting"], now: number): TileWords {
  const w = t.vitals.waiting;
  if (v.count === 0 || v.oldestAt === null) {
    return { value: num(v.count), lines: [w.none] };
  }
  const days = Math.max(0, Math.floor((now - v.oldestAt) / 86_400_000));
  return { value: num(v.count), lines: [w.oldest(plural(days, t.nouns.day))] };
}

// ---------------------------------------------------------------------------------------------
// The pipeline at a glance

/** The pipeline headline: the furthest step anyone reached. */
export function pipelineHeadline(rows: readonly FunnelRow[]): string {
  const found = rows.find((r) => r.step === "found")?.count ?? 0;
  const far = [...rows].reverse().find((r) => r.step !== "found" && r.count > 0);
  if (far === undefined) return t.pipeline.headlineOnly(num(found));
  const phrase = t.pipeline.phrases[far.step as Exclude<CreatorStep, "found">];
  return t.pipeline.headline(num(found), phrase(num(far.count)));
}

/** True when there is nothing yet to report on: no emails, and nobody past the rules. */
export function overviewIsEmpty(report: OverviewReport): boolean {
  return (
    report.vitals.emails.sent === 0 &&
    report.pipeline.every((r) => r.step === "found" || r.step === "passed" || r.count === 0)
  );
}
