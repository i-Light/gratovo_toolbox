import type { GoalLine, GoalRate, GoalReport, GoalStep, Lever } from "@gratovo/core/insights";

import { money } from "../../lib/format";
import { strings } from "../../strings";
import { decimal } from "./format";
import { fmt } from "./search";

const text = strings.insights.goal;

/** A share as a percentage with one decimal when it has one: 4.9%, 17%. */
export function rateText(value: number): string {
  return `${String(Math.round(value * 1000) / 10)}%`;
}

/** A number of work a day: one decimal below 10, whole above. */
export function perDayText(n: number): string {
  return n < 10 ? String(Math.round(n * 10) / 10) : fmt(n);
}

export function stepName(step: GoalStep): string {
  return text.chain.steps[step];
}

/** Where a rate came from, with its count when it is the person's own. */
export function sourceText(rate: GoalRate): string {
  const s = text.chain.source;
  switch (rate.source) {
    case "yours":
      return rate.count === null ? s.yoursNoCount : s.yours(fmt(rate.count.n), fmt(rate.count.d));
    case "course":
      return s.course;
    case "guess":
      return s.guess;
    case "override":
      return s.override;
  }
}

/** "17% sign · yours, 16 of 96" for a line that has a rate; the top line has none. */
export function rateLine(line: GoalLine): string {
  const c = text.chain;
  if (line.rate === null) return c.yourGoal;
  const value = line.rate.value;
  const source = sourceText(line.rate);
  switch (line.step) {
    case "bookings":
      return `${c.marginRate(rateText(value))} · ${source}`;
    case "deals":
      return `${c.dealRate(money(value))} · ${source}`;
    case "pitches":
      return `${c.winRate(rateText(value))} · ${source}`;
    case "signed":
      return `${value > 0 && value < 1 ? c.perDealRate(decimal(1 / value)) : c.perDealRateMore(decimal(value))} · ${source}`;
    case "replied":
    case "firstEmails":
    case "triage":
    case "find":
      return `${rateText(value)} ${c.rateVerb[line.step]} · ${source}`;
    case "revenue":
      return c.yourGoal;
  }
}

/** A line's amount a month: dollars for the money lines, else a count. */
export function monthText(line: GoalLine): string {
  return line.step === "revenue" || line.step === "bookings" ? money(line.month) : fmt(line.month);
}

/** The finding about the chain, chosen by rules. */
export function chainHeadline(report: GoalReport): string {
  const c = text.chain;
  if (report.lines.length > 0 && report.lines.every((l) => l.verdict === "early")) {
    return c.headlineEarly;
  }
  if (report.shortStep === null) return c.headlineNone;
  const line = report.lines.find((l) => l.step === report.shortStep);
  const name = stepName(report.shortStep);
  return line?.shortBy == null || line.shortBy <= 0
    ? c.headlineShortMonth(name)
    : c.headlineShort(name, perDayText(line.shortBy));
}

export function chainMeaning(report: GoalReport): string {
  const c = text.chain;
  if (report.lines.length > 0 && report.lines.every((l) => l.verdict === "early")) {
    return c.meaningEarly;
  }
  return report.shortStep === null ? c.meaningNone : c.meaning(stepName(report.shortStep));
}

export function shortByText(line: GoalLine): string | null {
  return line.shortBy === null || line.shortBy <= 0
    ? null
    : text.chain.shortBy(perDayText(line.shortBy));
}

export function leverName(lever: Lever): string {
  return text.levers[lever.kind];
}

/** A lever's before and after: dollars for the deal size, else a share. */
export function leverValue(lever: Lever, value: number): string {
  return lever.kind === "dealSize" ? money(value) : rateText(value);
}

/** The finding about the first (biggest) lever. */
export function leversHeadline(levers: readonly Lever[]): string {
  const first = levers[0];
  if (first === undefined) return text.levers.none;
  const from = leverValue(first, first.from);
  const to = leverValue(first, first.to);
  const a = fmt(first.emailsFrom);
  const b = fmt(first.emailsTo);
  switch (first.kind) {
    case "replyRate":
      return text.levers.headlineReply(from, to, a, b);
    case "signRate":
      return text.levers.headlineSign(from, to, a, b);
    case "dealSize":
      return text.levers.headlineDealSize(from, to, a, b);
    case "closeRate":
      return text.levers.headlineCloseRate(from, to);
  }
}

/** The room the mailboxes have, or the shortfall. */
export function roomHeadline(room: GoalReport["room"]): string {
  if (room.capacity <= 0) return text.room.headlineNone;
  const spare = room.capacity - room.needed;
  return spare >= 0 ? text.room.headlineRoom(fmt(spare)) : text.room.headlineShort(fmt(-spare));
}

export function roomMeaning(room: GoalReport["room"]): string {
  if (room.capacity <= 0) return text.room.meaningNone;
  return room.capacity >= room.needed ? text.room.meaningRoom : text.room.meaningShort;
}

/** On track when the room covers the need with a tenth to spare, Watch when tight, Act now when short. */
export function roomVerdict(room: GoalReport["room"]): "good" | "watch" | "act" {
  if (room.capacity < room.needed || room.capacity <= 0) return "act";
  return room.needed > room.capacity * 0.9 ? "watch" : "good";
}

/** Where the action under the chain goes, for the step falling short. */
export function stepRoute(step: GoalStep): { screen: string; tab: string | null } {
  switch (step) {
    case "revenue":
    case "bookings":
    case "deals":
      return { screen: "deliver", tab: "money" };
    case "pitches":
      return { screen: "close", tab: "brands" };
    case "signed":
      return { screen: "close", tab: "roster" };
    case "replied":
      return { screen: "reach", tab: "inbox" };
    case "firstEmails":
      return { screen: "reach", tab: "board" };
    case "triage":
      return { screen: "find", tab: "triage" };
    case "find":
      return { screen: "find", tab: "search" };
  }
}

/** What the last 30 days did on a money line, for the "A day" column; null for other lines. */
export function monthDoneText(line: GoalLine): string | null {
  if (line.actualMonth === null) return null;
  const c = text.chain;
  return line.step === "deals"
    ? c.countDone(fmt(line.actualMonth))
    : c.moneyDone(money(line.actualMonth));
}
