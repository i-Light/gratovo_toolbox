import {
  daysBefore,
  dealsMade,
  dealsPaid,
  inSpan,
  netOf,
  pitchedIn,
  pitchOutcomes,
  sum,
} from "./deal-facts";
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
export type RatedStep = "replied" | "firstEmails" | "triage" | "find";
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
  /** The money lines (P8b), over the last 30 days; 0 when not given. */
  readonly revenue?: number;
  readonly bookings?: number;
  readonly deals?: number;
  /** Brands that reached "pitched", a working day. */
  readonly pitchesPerDay?: number;
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
// The money rates (P8b)

/** The four rates of the money lines, each as a `GoalRate` (the value is dollars for `dealSize`). */
export interface MoneyRates {
  /** Net ÷ paid, 0 to 1: leads from revenue to bookings (override key `bookings`). */
  readonly margin: GoalRate;
  /** The average price of a deal, in dollars: leads to deals (override key `deals`). */
  readonly dealSize: GoalRate;
  /** Deals made ÷ brands pitched, 0 to 1: leads to pitches (override key `pitches`). */
  readonly closeRate: GoalRate;
  /** New creators signed per deal made: leads to creators to sign (override key `signed`). */
  readonly signsPerDeal: GoalRate;
}

function chooseMoney(
  inputs: InsightsInputs,
  step: GoalStep,
  own: Ratio,
  enough: number,
  fallback: { readonly value: number; readonly source: "course" | "guess" },
  cap: number,
  /** False for a rate in dollars: the overrides are 0 to 1 rates and are never read as dollars. */
  overridable = true,
): GoalRate {
  const set = overridable ? inputs.goal.overrides[step] : undefined;
  if (set !== undefined && Number.isFinite(set) && set > 0) {
    return { value: Math.min(cap, set), source: "override", count: null };
  }
  if (enough >= thresholds.minOther && own.n > 0 && own.d > 0) {
    return { value: Math.min(cap, own.n / own.d), source: "yours", count: own };
  }
  return { value: fallback.value, source: fallback.source, count: null };
}

/**
 * The money rates, over the 90 days before `now`, each when its count reaches `minOther`:
 *
 * - margin: net ÷ price of the deals brands paid. Course `courseMargin`.
 * - dealSize: the average price of deals made. Course `courseDealSize`. Never overridden: the
 *   overrides are 0 to 1 rates, and this one is dollars.
 * - closeRate: of the brands that reached "pitched", the share that went on to win (`pitchOutcomes`).
 *   Course `courseCloseRate`.
 * - signsPerDeal: creators who reached signed ÷ deals made. A guess, `guessSignsPerDeal`.
 */
export function moneyRates(inputs: InsightsInputs): MoneyRates {
  const from = daysBefore(inputs.now, 90);
  const to = inputs.now + 1;
  const paid = dealsPaid(inputs, from, to).filter((d) => d.price !== null && d.payout !== null);
  const made = dealsMade(inputs, from, to);
  const priced = made.filter((d) => d.price !== null);
  const pitches = pitchOutcomes(inputs, from, to);
  const signed = creatorsOf(inputs).filter((c) => {
    const at = c.reached.signed;
    return at != null && inSpan(at, from, to);
  }).length;
  return {
    margin: chooseMoney(
      inputs,
      "bookings",
      { n: sum(paid.map(netOf)), d: sum(paid.map((d) => d.price)) },
      paid.length,
      { value: thresholds.courseMargin, source: "course" },
      1,
    ),
    dealSize: chooseMoney(
      inputs,
      "deals",
      { n: sum(priced.map((d) => d.price)), d: priced.length },
      priced.length,
      { value: thresholds.courseDealSize, source: "course" },
      Infinity,
      false,
    ),
    closeRate: chooseMoney(
      inputs,
      "pitches",
      { n: pitches.won, d: pitches.pitched },
      pitches.pitched,
      { value: thresholds.courseCloseRate, source: "course" },
      1,
    ),
    signsPerDeal: chooseMoney(
      inputs,
      "signed",
      { n: signed, d: made.length },
      made.length,
      { value: thresholds.guessSignsPerDeal, source: "guess" },
      Infinity,
    ),
  };
}

/** The money goal when it is on: the net a month and the rates behind it; null otherwise. */
export interface MoneyPlan {
  readonly net: number;
  readonly rates: MoneyRates;
}

export function moneyPlan(inputs: InsightsInputs): MoneyPlan | null {
  const net = inputs.goal.revenuePerMonth;
  if (!inputs.seesMoney || net === null || !(net > 0)) return null;
  return { net, rates: moneyRates(inputs) };
}

/** The net goal over the margin, to the nearest $100: a goal is a target, not a sum to the dollar. */
function asPaid(net: number, margin: number): number {
  return Math.round(net / margin / 100) * 100;
}

/** The goal as brand payments: the net goal over the usual margin; null without a money goal. */
export function goalAsPaid(inputs: InsightsInputs): number | null {
  const plan = moneyPlan(inputs);
  return plan ? asPaid(plan.net, plan.rates.margin.value) : null;
}

// ---------------------------------------------------------------------------------------------
// The chain

type Chain = Readonly<Record<GoalStep, number>>;

/** Creators to sign from the deals: deals × signs per deal, rounded up (floating noise ignored). */
function signsFrom(deals: number, signsPerDeal: number): number {
  return Math.ceil(deals * signsPerDeal - 1e-9);
}

/**
 * A month's work at each line, from the top down. With a money plan the chain starts at net
 * revenue and the creators to sign are worked out from it; without, it starts at
 * `signsPerMonth` and the money lines are 0 (and not shown).
 */
function chainOf(signsPerMonth: number, rates: GoalRates, money: MoneyPlan | null): Chain {
  let revenue = 0;
  let bookings = 0;
  let deals = 0;
  let pitches = 0;
  let signed = signsPerMonth;
  if (money) {
    revenue = money.net;
    bookings = asPaid(revenue, money.rates.margin.value);
    deals = bookings / money.rates.dealSize.value;
    pitches = deals / money.rates.closeRate.value;
    signed = signsFrom(deals, money.rates.signsPerDeal.value);
  }
  const replied = signed / rates.replied.value;
  const firstEmails = replied / rates.firstEmails.value;
  const triage = firstEmails / rates.triage.value;
  const find = triage / rates.find.value;
  return { revenue, bookings, deals, pitches, signed, replied, firstEmails, triage, find };
}

const perDaySteps: readonly GoalStep[] = ["pitches", "firstEmails", "triage", "find"];
const moneySteps: readonly GoalStep[] = ["revenue", "bookings", "deals", "pitches"];
/** Lines that only follow from the others a month later: they never name "the step falling short". */
const laggingSteps: readonly GoalStep[] = ["revenue", "bookings", "deals"];

function actualOf(actual: GoalActual, step: GoalStep): number {
  switch (step) {
    case "revenue":
      return actual.revenue ?? 0;
    case "bookings":
      return actual.bookings ?? 0;
    case "deals":
      return actual.deals ?? 0;
    case "pitches":
      return actual.pitchesPerDay ?? 0;
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

/** The rate each line leads with, from the line above (null for the top line). */
function rateOfLine(step: GoalStep, rates: GoalRates, money: MoneyPlan | null): GoalRate | null {
  if (money) {
    if (step === "revenue") return null;
    if (step === "bookings") return money.rates.margin;
    if (step === "deals") return money.rates.dealSize;
    if (step === "pitches") return money.rates.closeRate;
    if (step === "signed") return money.rates.signsPerDeal;
  }
  return step === "signed" || moneySteps.includes(step) ? null : rates[step as RatedStep];
}

function evaluate(
  settings: GoalSettings,
  rates: GoalRates,
  actual: GoalActual,
  money: MoneyPlan | null,
): Evaluated {
  const chain = chainOf(settings.signsPerMonth, rates, money);
  const shortfall = new Map<GoalStep, number>();
  const steps = money ? goalSteps : goalSteps.filter((s) => !moneySteps.includes(s));
  const lines = steps.map((step): GoalLine => {
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
      rate: rateOfLine(step, rates, money),
      perDay: perDayLine ? needed : null,
      actualPerDay: perDayLine ? done : null,
      // A deal paid out for more than it cost nothing: what was kept never reads below 0.
      actualMonth: money && laggingSteps.includes(step) ? Math.max(0, done) : null,
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
  money: MoneyPlan | null = null,
): GoalLine[] {
  return evaluate(settings, rates, actual, money).lines;
}

/** First emails needed a working day. */
function firstPerDayNeeded(
  signsPerMonth: number,
  rates: GoalRates,
  money: MoneyPlan | null,
): number {
  return chainOf(signsPerMonth, rates, money).firstEmails / workingDaysPerMonth;
}

/**
 * What one better rate would do: reply rate +1 point, sign rate +5 points, with first emails a
 * working day before and after. Biggest cut first; a rate already at 100% has no lever.
 */
export function levers(
  settings: GoalSettings,
  rates: GoalRates,
  money: MoneyPlan | null = null,
): Lever[] {
  const out: Lever[] = [];
  const emailsFrom = firstPerDayNeeded(settings.signsPerMonth, rates, money);
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
      emailsTo: firstPerDayNeeded(settings.signsPerMonth, better, money),
    });
  };
  make("replyRate", "firstEmails", 0.01);
  make("signRate", "replied", 0.05);
  if (money) {
    // Deal size +$500 (fewer deals for the same revenue) and close rate +5 points (fewer pitches).
    // Close rate leaves the creators to sign as they are, so its cut in first emails is 0.
    const withRates = (over: Partial<MoneyRates>): MoneyPlan => ({
      ...money,
      rates: { ...money.rates, ...over },
    });
    const size = money.rates.dealSize;
    const bigger = size.value + 500;
    out.push({
      kind: "dealSize",
      from: size.value,
      to: bigger,
      emailsFrom,
      emailsTo: firstPerDayNeeded(
        settings.signsPerMonth,
        rates,
        withRates({ dealSize: { ...size, value: bigger } }),
      ),
    });
    // No close-rate lever: a better close rate cuts brand pitches, never the first emails a
    // lever is measured in, so it could only ever show "no change".
  }
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
  const paid = dealsPaid(inputs, from, inputs.now);
  const made = dealsMade(inputs, from, inputs.now);
  return {
    signed,
    replied,
    revenue: sum(paid.map(netOf)),
    bookings: sum(made.map((d) => d.price)),
    deals: made.length,
    pitchesPerDay: pitchedIn(inputs, from, inputs.now) / wd,
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

/**
 * The goal as the viewer may see it: without money, no revenue goal and none of the money rates
 * set by hand (B3).
 */
function settingsFor(inputs: InsightsInputs): GoalSettings {
  if (inputs.seesMoney) return inputs.goal;
  const overrides = Object.fromEntries(
    Object.entries(inputs.goal.overrides).filter(
      ([step]) => !moneySteps.includes(step as GoalStep),
    ),
  );
  return { ...inputs.goal, revenuePerMonth: null, overrides };
}

export function goalReport(inputs: InsightsInputs, window: ReportWindow): GoalReport {
  const rates = ownRates(inputs);
  const money = moneyPlan(inputs);
  const { lines, shortfall } = evaluate(inputs.goal, rates, actualFrom(inputs), money);
  let shortStep: GoalStep | null = null;
  let worst = 0;
  for (const line of lines) {
    if (laggingSteps.includes(line.step)) continue;
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
    settings: settingsFor(inputs),
    lines,
    shortStep,
    levers: levers(inputs.goal, rates, money),
    room: {
      needed: first * (1 + followUpsPerFirst(inputs)),
      capacity: mailboxCapacity(inputs),
    },
  };
}
