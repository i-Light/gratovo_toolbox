import { creatorsOf } from "./funnel";
import type { InsightsInputs } from "./inputs";
import { workingDays } from "./stats";
import { thresholds } from "./thresholds";
import { goalSteps } from "./types";
import type {
  GoalLine,
  GoalRate,
  GoalReport,
  GoalSettings,
  GoalStep,
  Lever,
  Ratio,
  ReportWindow,
  Verdict,
} from "./types";

/**
 * The Goal tab (design 3.6, P8a: in emails and creators). From "creators to sign a month" it works
 * back: creators who reply, first emails, channels to review, channels to find, and then what that
 * is a working day. Each step uses your own rate over the last 90 days when there are enough
 * counted, else the course figure, else a marked guess; a rate set by hand wins. Pure; empty input
 * gives lines with no pace known, never a throw.
 */

/** A month is 22 working days. */
export const workingDaysPerMonth = 22;

/** The guesses used until your own numbers are enough (marked "guess" on the screen). */
const guesses = { sign: 0.15, triage: 0.45, passed: 0.13 } as const;

/** The rate each line carries: the share that makes it to that line from the line below it. */
export type RatedStep = Exclude<GoalStep, "signed">;
export type GoalRates = Readonly<Record<RatedStep, GoalRate>>;

/** What is done now, over the last 30 days. */
export interface GoalActual {
  /** Creators who signed, and creators who replied, in the 30 days. */
  readonly signed: number;
  readonly replied: number;
  /** A working day. */
  readonly firstPerDay: number;
  readonly triagePerDay: number;
  readonly findPerDay: number;
  /** False when there is no data at all: every line is then "early". */
  readonly known: boolean;
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
// The rates

function choose(
  inputs: InsightsInputs,
  step: RatedStep,
  own: Ratio,
  fallback: { readonly value: number; readonly source: "course" | "guess" },
): GoalRate {
  const set = inputs.goal.overrides[step];
  if (set !== undefined && Number.isFinite(set) && set > 0) {
    return { value: Math.min(1, set), source: "override", count: null };
  }
  if (own.d >= thresholds.minOther && own.n > 0) {
    return { value: Math.min(1, own.n / own.d), source: "yours", count: own };
  }
  return { value: fallback.value, source: fallback.source, count: null };
}

/**
 * The rates the chain uses, keyed by the line each leads to (`replied`: signing, `firstEmails`:
 * replying, `triage`: emailed per channel reviewed, `find`: passing the rules). Yours: over the 90
 * days before `now`, when the count behind it reaches `minOther` and is not 0.
 *
 * - sign: signed ÷ creators who replied in the 90 days. Guess 0.15 (the course has no figure).
 * - reply: creators who replied ÷ creators first emailed in the 90 days. Course: the 4% floor.
 * - triage: creators emailed in the 90 days ÷ channels reviewed (shortlisted or rejected). Guess 0.45.
 * - find: passed the rules ÷ found, from the catalog and the archive totals. Guess 0.13.
 */
export function ownRates(inputs: InsightsInputs): GoalRates {
  const from = daysBefore(inputs.now, 90);
  const creators = creatorsOf(inputs);

  const replied = creators.filter((c) => {
    const at = c.reached.replied;
    return at != null && inSpan(at, from, inputs.now + 1);
  });
  const sign: Ratio = { n: replied.filter((c) => "signed" in c.reached).length, d: replied.length };

  const emailed = creators.filter((c) => {
    const at = c.reached.emailed;
    return at != null && inSpan(at, from, inputs.now + 1);
  });
  const reply: Ratio = {
    n: emailed.filter((c) => "replied" in c.reached).length,
    d: emailed.length,
  };

  const reviewed = new Set<string>();
  for (const e of inputs.events) {
    if (
      (e.stage === "shortlisted" || e.stage === "rejected") &&
      inSpan(e.at, from, inputs.now + 1)
    ) {
      reviewed.add(e.channelId);
    }
  }
  const triage: Ratio = { n: emailed.length, d: reviewed.size };

  const found = inputs.channels.filter((c) => c.inCatalog).length + inputs.archive.total;
  const passed: Ratio = { n: Math.max(0, found - inputs.archive.byRules), d: found };

  return {
    replied: choose(inputs, "replied", sign, { value: guesses.sign, source: "guess" }),
    firstEmails: choose(inputs, "firstEmails", reply, {
      value: thresholds.replyFloor,
      source: "course",
    }),
    triage: choose(inputs, "triage", triage, { value: guesses.triage, source: "guess" }),
    find: choose(inputs, "find", passed, { value: guesses.passed, source: "guess" }),
  };
}

// ---------------------------------------------------------------------------------------------
// The chain

interface Chain {
  readonly signed: number;
  readonly replied: number;
  readonly firstEmails: number;
  readonly triage: number;
  readonly find: number;
}

/** A month's work at each line, from the creators to sign down to the channels to find. */
function chainOf(signsPerMonth: number, rates: GoalRates): Chain {
  const signed = signsPerMonth;
  const replied = signed / rates.replied.value;
  const firstEmails = replied / rates.firstEmails.value;
  const triage = firstEmails / rates.triage.value;
  const find = triage / rates.find.value;
  return { signed, replied, firstEmails, triage, find };
}

const perDaySteps: readonly GoalStep[] = ["firstEmails", "triage", "find"];

function actualOf(actual: GoalActual, step: GoalStep): number {
  switch (step) {
    case "signed":
      return actual.signed;
    case "replied":
      return actual.replied;
    case "firstEmails":
      return actual.firstPerDay;
    case "triage":
      return actual.triagePerDay;
    case "find":
      return actual.findPerDay;
  }
}

interface Evaluated {
  readonly lines: GoalLine[];
  /** For a line that falls short: the share of what is needed it misses. */
  readonly shortfall: ReadonlyMap<GoalStep, number>;
}

function evaluate(settings: GoalSettings, rates: GoalRates, actual: GoalActual): Evaluated {
  const chain = chainOf(settings.signsPerMonth, rates);
  const shortfall = new Map<GoalStep, number>();
  const lines = goalSteps.map((step): GoalLine => {
    const month = chain[step];
    const perDayLine = perDaySteps.includes(step);
    const needed = perDayLine ? month / workingDaysPerMonth : month;
    const done = actualOf(actual, step);
    let verdict: Verdict;
    let shortBy: number | null = null;
    if (!actual.known) verdict = "early";
    else if (!(needed > 0) || done >= needed) verdict = "good";
    else {
      shortfall.set(step, (needed - done) / needed);
      if (perDayLine) {
        shortBy = needed - done;
        verdict = done < needed / 2 ? "act" : "watch";
      } else verdict = "watch";
    }
    return {
      step,
      month,
      rate: step === "signed" ? null : rates[step],
      perDay: perDayLine ? needed : null,
      actualPerDay: perDayLine ? done : null,
      verdict,
      shortBy,
    };
  });
  return { lines, shortfall };
}

/**
 * The five lines, top to bottom. A line counted a day (first emails, triage, find) is good when
 * what you do a working day reaches what is needed, else watch, and act under half of it; a line
 * counted a month (signed, replied) is good when the last 30 days reached it, else watch. All lines
 * are early only when there is no data at all.
 */
export function goalLines(
  settings: GoalSettings,
  rates: GoalRates,
  actual: GoalActual,
): GoalLine[] {
  return evaluate(settings, rates, actual).lines;
}

/** First emails needed a working day. */
function firstPerDayNeeded(signsPerMonth: number, rates: GoalRates): number {
  return chainOf(signsPerMonth, rates).firstEmails / workingDaysPerMonth;
}

/**
 * What one better rate would do: reply rate +1 point, sign rate +5 points, with first emails a
 * working day before and after. Biggest cut first; a rate already at 100% has no lever.
 */
export function levers(settings: GoalSettings, rates: GoalRates): Lever[] {
  const out: Lever[] = [];
  const emailsFrom = firstPerDayNeeded(settings.signsPerMonth, rates);
  const make = (kind: Lever["kind"], step: RatedStep, plus: number): void => {
    const from = rates[step].value;
    const to = Math.min(1, from + plus);
    if (!(to > from)) return;
    const better: GoalRates = { ...rates, [step]: { ...rates[step], value: to } };
    out.push({
      kind,
      from,
      to,
      emailsFrom,
      emailsTo: firstPerDayNeeded(settings.signsPerMonth, better),
    });
  };
  make("replyRate", "firstEmails", 0.01);
  make("signRate", "replied", 0.05);
  return out.sort((a, b) => b.emailsFrom - b.emailsTo - (a.emailsFrom - a.emailsTo));
}

// ---------------------------------------------------------------------------------------------
// The report

function actualFrom(inputs: InsightsInputs): GoalActual {
  const from = daysBefore(inputs.now, 30);
  const wd = Math.max(1, workingDays({ from, to: inputs.now }));
  let firsts = 0;
  for (const m of inputs.messages) {
    if (m.direction === "out" && m.kind === "first" && inSpan(m.at, from, inputs.now)) firsts += 1;
  }
  const reviews = inputs.events.filter(
    (e) => (e.stage === "shortlisted" || e.stage === "rejected") && inSpan(e.at, from, inputs.now),
  ).length;
  // Every find, as the needed line counts them: the ones in the catalog, and the ones the rules
  // swept as they were found (the archive's weekly sweeps, by the weeks that end in the span).
  const kept = inputs.channels.filter(
    (c) => c.inCatalog && c.foundAt !== null && inSpan(c.foundAt, from, inputs.now),
  ).length;
  const swept = inputs.archive.weekly
    .filter((w) => w.at >= from && w.at < inputs.now)
    .reduce((sum, w) => sum + w.byRules, 0);
  const found = kept + swept;
  let signed = 0;
  let replied = 0;
  for (const c of creatorsOf(inputs)) {
    const s = c.reached.signed;
    if (s != null && inSpan(s, from, inputs.now)) signed += 1;
    const r = c.reached.replied;
    if (r != null && inSpan(r, from, inputs.now)) replied += 1;
  }
  return {
    signed,
    replied,
    firstPerDay: firsts / wd,
    triagePerDay: reviews / wd,
    findPerDay: found / wd,
    known: inputs.messages.length + inputs.events.length + inputs.channels.length > 0,
  };
}

/**
 * The follow-ups a first email brings on average over the last 90 days (follow-ups sent ÷ first
 * emails sent); 3 when fewer than `minOther` first emails are known.
 */
function followUpsPerFirst(inputs: InsightsInputs): number {
  const from = daysBefore(inputs.now, 90);
  let firsts = 0;
  let followUps = 0;
  for (const m of inputs.messages) {
    if (m.direction !== "out" || !inSpan(m.at, from, inputs.now)) continue;
    if (m.kind === "first") firsts += 1;
    else if (m.kind === "followUp") followUps += 1;
  }
  return firsts < thresholds.minOther ? 3 : Math.min(3, followUps / firsts);
}

/** Emails the mailboxes allow a day: the daily cap, the slowdown hold when held, 0 when paused. */
export function mailboxCapacity(inputs: InsightsInputs): number {
  return inputs.mailboxes.reduce(
    (sum, box) => sum + (box.paused ? 0 : (box.heldAt ?? box.dailyCap)),
    0,
  );
}

export function goalReport(inputs: InsightsInputs, window: ReportWindow): GoalReport {
  const rates = ownRates(inputs);
  const { lines, shortfall } = evaluate(inputs.goal, rates, actualFrom(inputs));
  let shortStep: GoalStep | null = null;
  let worst = 0;
  for (const line of lines) {
    const share = shortfall.get(line.step) ?? 0;
    if (share > worst) {
      worst = share;
      shortStep = line.step;
    }
  }
  const first = lines.find((l) => l.step === "firstEmails")?.perDay ?? 0;
  return {
    tab: "goal",
    window,
    settings: inputs.goal,
    lines,
    shortStep,
    levers: levers(inputs.goal, rates),
    room: {
      needed: first * (1 + followUpsPerFirst(inputs)),
      capacity: mailboxCapacity(inputs),
    },
  };
}
