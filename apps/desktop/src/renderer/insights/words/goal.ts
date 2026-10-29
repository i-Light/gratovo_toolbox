import type { GoalLine, GoalRate, GoalReport, GoalStep, Lever } from "@gratovo/core/insights";

import { strings } from "../../strings";
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
  if (line.rate === null || line.step === "signed") return text.chain.yourGoal;
  return `${rateText(line.rate.value)} ${text.chain.rateVerb[line.step]} · ${sourceText(line.rate)}`;
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

/** The finding about the first (biggest) lever. */
export function leversHeadline(levers: readonly Lever[]): string {
  const first = levers[0];
  if (first === undefined) return text.levers.none;
  const from = rateText(first.from);
  const to = rateText(first.to);
  const a = fmt(first.emailsFrom);
  const b = fmt(first.emailsTo);
  return first.kind === "replyRate"
    ? text.levers.headlineReply(from, to, a, b)
    : text.levers.headlineSign(from, to, a, b);
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
