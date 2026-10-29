import { rateOf } from "@gratovo/core/insights";
import type {
  CohortRow,
  CreatorStep,
  Difference,
  FunnelExits,
  FunnelReport,
  FunnelRow,
  NoKind,
} from "@gratovo/core/insights";

import { strings } from "../../strings";
import { decimal, num, pct, ratioPct } from "./format";

const t = strings.insights.funnel;
const fmt = strings.insights.overview.fmt;

export function stepName(step: CreatorStep): string {
  return t.steps[step];
}

/** The share that made it from the step above, as the table shows it. */
export function shareText(row: FunnelRow): string {
  if (row.fromPrev === null) return t.table.start;
  return ratioPct(row.fromPrev);
}

/** "1.2 days", or a dash when fewer than 5 are known. */
export function usualText(days: number | null): string {
  return days === null ? fmt.dash : fmt.daysLong(decimal(days));
}

/** The name of the step above `step` in this list, or null for the first. */
export function previousName(rows: readonly FunnelRow[], step: CreatorStep): string | null {
  const i = rows.findIndex((r) => r.step === step);
  const prev = i > 0 ? rows[i - 1] : undefined;
  return prev === undefined ? null : stepName(prev.step);
}

/** The sentence under the funnel: the biggest drop a person controls, with its counts. */
export function biggestDropSentence(rows: readonly FunnelRow[], step: CreatorStep | null): string {
  const row = step === null ? undefined : rows.find((r) => r.step === step);
  const prev = step === null ? null : previousName(rows, step);
  if (step === null || row?.fromPrev == null || prev === null) return t.noDrop;
  const { n, d } = row.fromPrev;
  return t.biggestDrop(prev, stepName(step), num(d - n), num(d));
}

/**
 * The funnel headline. With a "Passed your rules" row, it says how much the rules drop on purpose;
 * then it names the biggest drop a person controls. Without either it says there is not enough yet.
 */
export function funnelHeadline(rows: readonly FunnelRow[], biggest: CreatorStep | null): string {
  const h = t.headline;
  const passed = rows.find((r) => r.step === "passed");
  const kept = passed?.fromPrev == null ? null : rateOf(passed.fromPrev);
  const prev = biggest === null ? null : previousName(rows, biggest);
  const named = biggest !== null && prev !== null;
  if (kept !== null) {
    const dropped = pct(1 - kept);
    return named ? h.rules(dropped, prev, stepName(biggest)) : h.rulesOnly(dropped);
  }
  return named ? h.drop(prev, stepName(biggest)) : h.none;
}

/** True when nobody has moved past the rules yet: the funnel has nothing to show. */
export function funnelIsEmpty(report: FunnelReport): boolean {
  return report.everyone.every((r) => r.step === "found" || r.step === "passed" || r.count === 0);
}

// ---------------------------------------------------------------------------------------------
// Why they dropped

export interface ExitList {
  readonly key: "triage" | "saidNo" | "audience";
  readonly title: string;
  readonly total: number;
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly count: number;
  }[];
}

/** The three breakdowns, each biggest first. */
export function exitLists(exits: FunnelExits): ExitList[] {
  const e = t.exits;
  const byCount = <R extends { count: number }>(rows: readonly R[]): R[] =>
    [...rows].sort((a, b) => b.count - a.count);
  const triage = byCount(exits.triage).map((r) => ({
    key: r.reason,
    label: e.reasons[r.reason],
    count: r.count,
  }));
  const saidNo = byCount(exits.saidNo).map((r) => ({
    key: r.kind,
    label: e.noKinds[r.kind],
    count: r.count,
  }));
  const audience = byCount(exits.audience).map((r) => ({
    key: r.check,
    label: e.checksTitle[r.check],
    count: r.count,
  }));
  const sum = (rows: readonly { count: number }[]): number => rows.reduce((a, r) => a + r.count, 0);
  return [
    { key: "triage", title: e.triage, total: sum(triage), rows: triage },
    { key: "saidNo", title: e.saidNo, total: sum(saidNo), rows: saidNo },
    { key: "audience", title: e.audience, total: sum(audience), rows: audience },
  ];
}

/**
 * The headline of Why they dropped, chosen by rule: the top reason for a no when people said no at
 * least as often as the audience check failed, else the top failed check, else the top triage reason.
 */
export function exitsHeadline(exits: FunnelExits): string {
  const e = t.exits;
  const [triage, saidNo, audience] = exitLists(exits);
  const topNo = saidNo?.rows[0];
  const topCheck = audience?.rows[0];
  const topReason = triage?.rows[0];
  const no = saidNo?.total ?? 0;
  const failed = audience?.total ?? 0;
  if (topNo !== undefined && no > 0 && no >= failed) {
    return e.headlineNo(e.noKindsLower[topNo.key as NoKind]);
  }
  if (topCheck !== undefined && failed > 0) {
    return e.headlineAudience(e.checks[topCheck.key as keyof typeof e.checks]);
  }
  if (topReason !== undefined && topReason.count > 0) {
    return e.headlineTriage(e.reasonsLower[topReason.key as keyof typeof e.reasonsLower]);
  }
  return e.headlineNone;
}

/** The "Also: …" line for the exits that are not a reason. */
export function alsoLine(exits: FunnelExits): string {
  return t.exits.also(num(exits.noAnswer), num(exits.stillInSequence), num(exits.bounced));
}

// ---------------------------------------------------------------------------------------------
// How long each step takes

export interface DayRow {
  readonly key: string;
  readonly label: string;
  readonly days: number | null;
}

export function dayRows(stepDays: FunnelReport["stepDays"]): DayRow[] {
  return stepDays.map((s) => ({
    key: `${s.from}-${s.to}`,
    label: t.days.arrow(stepName(s.from), stepName(s.to)),
    days: s.days,
  }));
}

/** The step pair with the longest known wait, or null when none is known. */
export function longestWait(
  stepDays: FunnelReport["stepDays"],
): FunnelReport["stepDays"][number] | null {
  let best: FunnelReport["stepDays"][number] | null = null;
  for (const s of stepDays) {
    if (s.days !== null && (best === null || (best.days ?? 0) < s.days)) best = s;
  }
  return best;
}

export function daysHeadline(stepDays: FunnelReport["stepDays"]): string {
  const best = longestWait(stepDays);
  if (best === null || best.days === null) return t.days.none;
  return t.days.headline(stepName(best.from), stepName(best.to), usualText(best.days));
}

// ---------------------------------------------------------------------------------------------
// Cohorts

export function cohortHeadline(trend: Difference): string {
  return t.cohorts.headline[trend];
}

export function cohortMeaning(trend: Difference): string {
  return t.cohorts.meaning[trend];
}

/** The heat table's cells, one row per week: the share that replied by day 3, 7, 14 and 30. */
export function cohortCells(rows: readonly CohortRow[]): (number | null)[][] {
  return rows.map((r) => r.by.map((b) => (b === null ? null : rateOf(b))));
}
