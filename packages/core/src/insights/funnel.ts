import { audienceKeys } from "../close/audience";
import { rejectReasons } from "../data/types";
import type { CreatorStage, RejectReason } from "../data/types";

import { compareRates, median, startOfWeek } from "./stats";
import { thresholds } from "./thresholds";
import { creatorSteps, positiveReadings } from "./types";
import type {
  CohortRow,
  CreatorStep,
  Difference,
  FunnelExits,
  FunnelReport,
  FunnelRow,
  NoKind,
  Ratio,
  ReportWindow,
} from "./types";
import type { InsightsInputs, MessageFact } from "./inputs";

/**
 * The creator funnel (design 3.2): how many creators reached each step, how many made it from the
 * step above, how long each step takes, who is stuck, why they left, and how each week's first
 * emails did. Pure; empty input gives zeros and nulls, never a throw.
 */

const DAY = 86_400_000;

/** The steps a creator moves through (everything after `passed`). */
type PathStep = Exclude<CreatorStep, "found" | "passed">;
const pathSteps = creatorSteps.slice(2) as readonly PathStep[];

/** How far along the stages a creator is. Off-path stages (rejected, parked, never) have none. */
const stageRank: Readonly<Partial<Record<CreatorStage, number>>> = {
  shortlisted: 1,
  contact: 2,
  emailed: 3,
  replied: 4,
  kit: 5,
  audience: 6,
  signed: 7,
};

/** The stage rank a creator needs to have passed each step. */
const stepRank: Readonly<Record<PathStep, number>> = {
  shortlisted: 1,
  confirmed: 2,
  emailed: 3,
  replied: 4,
  interested: 5,
  kit: 5,
  audience: 6,
  signed: 7,
};

const offPath: readonly CreatorStage[] = ["rejected", "parked", "never"];

function isBounce(m: MessageFact): boolean {
  return m.bounce || m.reading === "bounce";
}

/** One creator's way through the funnel: for each step reached, when (null: reached, time not known). */
export interface Creator {
  readonly id: string;
  readonly stage: CreatorStage | null;
  readonly reached: Readonly<Partial<Record<PathStep, number | null>>>;
  /** When the first non-bounce reply came in, or the replied event's time. */
  readonly replyAt: number | null;
}

function earliest(xs: readonly number[]): number | null {
  let best: number | null = null;
  for (const x of xs) if (best === null || x < best) best = x;
  return best;
}

/** Every creator the records know about, with the steps they reached and when. */
export function creatorsOf(inputs: InsightsInputs): Creator[] {
  const eventTimes = new Map<string, Map<CreatorStage, number[]>>();
  for (const e of inputs.events) {
    let byStage: Map<CreatorStage, number[]> | undefined = eventTimes.get(e.channelId);
    if (!byStage) eventTimes.set(e.channelId, (byStage = new Map<CreatorStage, number[]>()));
    const list = byStage.get(e.stage);
    if (list) list.push(e.at);
    else byStage.set(e.stage, [e.at]);
  }
  const shortlistLog = new Map<string, number[]>();
  for (const l of inputs.log) {
    if (l.action !== "shortlist") continue;
    const list = shortlistLog.get(l.channelId);
    if (list) list.push(l.at);
    else shortlistLog.set(l.channelId, [l.at]);
  }
  const messages = new Map<string, MessageFact[]>();
  for (const m of inputs.messages) {
    const list = messages.get(m.channelId);
    if (list) list.push(m);
    else messages.set(m.channelId, [m]);
  }
  const channels = new Map(inputs.channels.map((c) => [c.id, c]));
  const ids = new Set<string>([...channels.keys(), ...eventTimes.keys(), ...messages.keys()]);

  const out: Creator[] = [];
  for (const id of ids) {
    const channel = channels.get(id) ?? null;
    const stage = channel?.stage ?? null;
    const byStage = eventTimes.get(id);
    const msgs = (messages.get(id) ?? []).slice().sort((a, b) => a.at - b.at);

    let rank = stage ? (stageRank[stage] ?? 0) : 0;
    if (byStage) {
      for (const s of byStage.keys()) rank = Math.max(rank, stageRank[s] ?? 0);
    }
    const emailsOut = msgs.filter(
      (m) => m.direction === "out" && (m.kind === "first" || m.kind === "followUp"),
    );
    const repliesIn = msgs.filter((m) => m.direction === "in" && !isBounce(m));
    if (emailsOut.length > 0) rank = Math.max(rank, 3);
    if (repliesIn.length > 0) rank = Math.max(rank, 4);

    // Interested: the first reply that has a reading reads as a way forward.
    const firstRead = repliesIn.find((m) => m.reading !== null);
    const positive =
      firstRead !== undefined && firstRead.reading !== null
        ? positiveReadings.includes(firstRead.reading)
        : false;
    if (positive) rank = Math.max(rank, 4);

    const eventAt = (s: CreatorStage): number | null => earliest(byStage?.get(s) ?? []);
    const timeOf: Record<PathStep, number | null> = {
      shortlisted: eventAt("shortlisted") ?? earliest(shortlistLog.get(id) ?? []),
      confirmed: channel?.confirmedAt ?? eventAt("contact"),
      emailed: eventAt("emailed") ?? emailsOut[0]?.at ?? null,
      replied: eventAt("replied") ?? repliesIn[0]?.at ?? null,
      interested: positive && firstRead ? firstRead.at : null,
      kit: eventAt("kit"),
      audience: eventAt("audience"),
      signed: eventAt("signed"),
    };

    const reached: Partial<Record<PathStep, number | null>> = {};
    for (const step of pathSteps) {
      let has = rank >= stepRank[step];
      if (step === "confirmed" && channel?.confirmedAt != null) has = true;
      if (step === "interested") has = rank >= 5 || positive;
      if (has) reached[step] = timeOf[step];
    }
    out.push({ id, stage, reached, replyAt: repliesIn[0]?.at ?? timeOf.replied });
  }
  return out;
}

/** How many reached each step; with a cutoff, only those whose time is known and not after it. */
function countSteps(pop: readonly Creator[], cutoff: number | null): Record<PathStep, number> {
  const counts = Object.fromEntries(pathSteps.map((s) => [s, 0])) as Record<PathStep, number>;
  for (const c of pop) {
    for (const step of pathSteps) {
      if (!(step in c.reached)) continue;
      const at = c.reached[step] ?? null;
      if (cutoff !== null && (at === null || at > cutoff)) continue;
      counts[step] += 1;
    }
  }
  return counts;
}

/** Days from entering `from` to entering the next step, for those with both times known. */
function gapDays(pop: readonly Creator[], from: PathStep, to: PathStep): number | null {
  const gaps: number[] = [];
  for (const c of pop) {
    const a = c.reached[from];
    const b = c.reached[to];
    if (a == null || b == null || b < a) continue;
    gaps.push((b - a) / DAY);
  }
  return gaps.length >= thresholds.minForMedian ? median(gaps) : null;
}

function nextStep(step: PathStep): PathStep | null {
  return pathSteps[pathSteps.indexOf(step) + 1] ?? null;
}

/**
 * Whether a step counts creators stuck in it. Not the catalog steps; not `emailed`, where the
 * follow-ups do the waiting and a creator who never answers is an exit, not stuck; not `signed`,
 * the end of this funnel.
 */
function hasStuck(step: CreatorStep): step is PathStep {
  return step !== "found" && step !== "passed" && step !== "emailed" && step !== "signed";
}

/** The creators whose latest step is `step` and who have been in it longer than `limitDays`. */
function stuckList(
  pop: readonly Creator[],
  step: PathStep,
  limitDays: number,
  now: number,
): string[] {
  const ids: string[] = [];
  for (const c of pop) {
    if (c.stage !== null && offPath.includes(c.stage)) continue;
    let top: PathStep | null = null;
    for (const s of pathSteps) if (s in c.reached) top = s;
    if (top !== step) continue;
    const at = c.reached[step];
    if (at != null && now - at > limitDays * DAY) ids.push(c.id);
  }
  return ids;
}

function stuckCount(
  pop: readonly Creator[],
  step: PathStep,
  limitDays: number,
  now: number,
): number {
  return stuckList(pop, step, limitDays, now).length;
}

/** The creators behind an "everyone" row's `stuck` number; none for a step with no such number. */
export function stuckIds(inputs: InsightsInputs, step: CreatorStep): string[] {
  if (!hasStuck(step)) return [];
  const pop = creatorsOf(inputs);
  const next = nextStep(step);
  const days = next === null ? null : gapDays(pop, step, next);
  return days === null ? [] : stuckList(pop, step, thresholds.stuckFactor * days, inputs.now);
}

/** The creators who ever reached a path step (the count of an "everyone" row after `passed`). */
export function reachedIds(inputs: InsightsInputs, step: CreatorStep): string[] {
  if (step === "found" || step === "passed") return [];
  return creatorsOf(inputs)
    .filter((c) => step in c.reached)
    .map((c) => c.id);
}

function ratioOrNull(n: number, d: number): Ratio | null {
  return d > 0 ? { n, d } : null;
}

/**
 * One row per step. "everyone": all creators who ever reached it. "cohort": only creators first
 * emailed inside the period, followed forward; they all passed every step before `emailed`, so
 * those rows count the same creators. `before` is the same share as of the end of the previous
 * period (everyone so far then); a creator whose time at a step is not known is left out of it.
 */
export function creatorFunnel(
  inputs: InsightsInputs,
  window: ReportWindow,
  mode: "everyone" | "cohort",
): FunnelRow[] {
  const all = creatorsOf(inputs);
  const pop =
    mode === "everyone"
      ? all
      : all.filter((c) => {
          const at = c.reached.emailed;
          return at != null && at >= window.current.from && at < window.current.to;
        });

  const found = inputs.channels.filter((c) => c.inCatalog).length + inputs.archive.total;
  const passed = Math.max(0, found - inputs.archive.byRules);
  const counts = countSteps(pop, null);
  const then = countSteps(all, window.previous.to);

  const countOf = (step: CreatorStep): number => {
    if (step === "found") return mode === "everyone" ? found : pop.length;
    if (step === "passed") return mode === "everyone" ? passed : pop.length;
    return counts[step];
  };

  return creatorSteps.map((step, i): FunnelRow => {
    const count = countOf(step);
    const prev = i === 0 ? null : (creatorSteps[i - 1] ?? null);
    const fromPrev = prev === null ? null : ratioOrNull(count, countOf(prev));
    // The previous period's share is only known from the step events, so `passed` has none.
    const before =
      step === "found" || step === "passed" || step === "shortlisted" || prev === null
        ? null
        : prev === "found" || prev === "passed"
          ? null
          : ratioOrNull(then[step], then[prev]);

    const path = step === "found" || step === "passed" ? null : step;
    const next = path === null ? null : nextStep(path);
    const medianDays = path === null || next === null ? null : gapDays(pop, path, next);
    const stuck =
      path === null || !hasStuck(path) || medianDays === null
        ? null
        : stuckCount(pop, path, thresholds.stuckFactor * medianDays, inputs.now);
    return { step, count, fromPrev, before, medianDays, stuck, byDesign: step === "passed" };
  });
}

/** The steps `biggestDrop` may name. */
const dropSteps: ReadonlySet<CreatorStep> = new Set<CreatorStep>([
  "confirmed",
  "emailed",
  "replied",
  "interested",
  "kit",
  "audience",
  "signed",
]);

/**
 * The step a person controls where the fewest made it through: the lowest share from the step
 * above, from `confirmed` on, with at least `minOther` in the step above. The rules (`passed`) and
 * the review (`shortlisted`) drop most on purpose, so neither counts.
 */
export function biggestDrop(rows: readonly FunnelRow[]): CreatorStep | null {
  let best: CreatorStep | null = null;
  let bestRate = Infinity;
  for (const row of rows) {
    if (!dropSteps.has(row.step) || row.fromPrev === null) continue;
    if (row.fromPrev.d < thresholds.minOther) continue;
    const rate = row.fromPrev.n / row.fromPrev.d;
    if (rate < bestRate) {
      bestRate = rate;
      best = row.step;
    }
  }
  return best;
}

/**
 * Why creators left, counted over everyone so far (the window is not used: an exit is a state, not
 * an event in the period).
 *
 * - Triage: the reason in each rejected creator's newest reject line (no reason: "unknown"), plus
 *   the people's rejects already in the archive, which main counts by the same rule.
 * - Said no: each creator's newest reply that read as not now, no or manager. "Wants more money"
 *   is 0 here: a reply's reading (`ReadingKind`) folds the money situations into `rate`, which
 *   also holds a creator quoting a price, so the two cannot be told apart from the records.
 * - Audience: how many creators failed each of the four checks.
 * - No answer: emailed, never replied, and out of their sequence. Still in sequence: the same but
 *   with follow-ups still to come. Bounced: a bounce came back.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so every report function takes the window
export function funnelExits(inputs: InsightsInputs, _window?: ReportWindow): FunnelExits {
  const triage = new Map<RejectReason | "unknown", number>();
  for (const r of rejectReasons) triage.set(r, 0);
  triage.set("unknown", 0);

  const newestReject = new Map<string, { at: number; reason: RejectReason | null }>();
  for (const l of inputs.log) {
    if (l.action !== "reject") continue;
    const seen = newestReject.get(l.channelId);
    if (!seen || l.at >= seen.at) newestReject.set(l.channelId, { at: l.at, reason: l.reason });
  }
  for (const c of inputs.channels) {
    if (c.stage !== "rejected") continue;
    const line = newestReject.get(c.id);
    const reason = line ? line.reason : c.rejectReason;
    const key = reason ?? "unknown";
    triage.set(key, (triage.get(key) ?? 0) + 1);
  }
  for (const p of inputs.archive.personReasons) {
    triage.set(p.reason, (triage.get(p.reason) ?? 0) + p.count);
  }

  const noKinds: Record<NoKind, number> = { notNow: 0, notInterested: 0, manager: 0, money: 0 };
  const sequence = new Set(inputs.inSequence);
  const emailed = new Set<string>();
  const answered = new Set<string>();
  const bounced = new Set<string>();
  const newestIn = new Map<string, MessageFact>();
  for (const m of inputs.messages) {
    if (m.direction === "out") {
      if (m.kind === "first" || m.kind === "followUp") emailed.add(m.channelId);
      continue;
    }
    answered.add(m.channelId);
    if (isBounce(m)) {
      bounced.add(m.channelId);
      continue;
    }
    const seen = newestIn.get(m.channelId);
    if (m.reading !== null && (!seen || m.at >= seen.at)) newestIn.set(m.channelId, m);
  }
  for (const m of newestIn.values()) {
    if (m.reading === "notNow") noKinds.notNow += 1;
    else if (m.reading === "no") noKinds.notInterested += 1;
    else if (m.reading === "manager") noKinds.manager += 1;
  }

  const audience = audienceKeys.map((check) => ({
    check,
    count: inputs.channels.filter((c) => c.audit?.[check] === false).length,
  }));

  let noAnswer = 0;
  let stillInSequence = 0;
  for (const id of emailed) {
    if (answered.has(id)) continue;
    if (sequence.has(id)) stillInSequence += 1;
    else noAnswer += 1;
  }

  return {
    triage: [...triage].map(([reason, count]) => ({ reason, count })),
    saidNo: (Object.keys(noKinds) as NoKind[]).map((kind) => ({ kind, count: noKinds[kind] })),
    audience,
    noAnswer,
    stillInSequence,
    bounced: bounced.size,
  };
}

/** The median days between each pair of consecutive steps, shortlisted to signed. */
export function stepDays(inputs: InsightsInputs): FunnelReport["stepDays"] {
  const pop = creatorsOf(inputs);
  const out: { from: CreatorStep; to: CreatorStep; days: number | null }[] = [];
  for (const from of pathSteps) {
    const to = nextStep(from);
    if (to !== null) out.push({ from, to, days: gapDays(pop, from, to) });
  }
  return out;
}

const cohortDays = [3, 7, 14, 30] as const;

/**
 * One row per week of first emails (newest first, at most 12): the share that replied within 3, 7,
 * 14 and 30 days of their first email, null where the week is too recent to have reached that day
 * (the week's last email plus that many days). The trend asks whether the newest 4 complete weeks'
 * day-7 replies are clearly worse than the 4 weeks before; better or equal is "chance".
 */
export function cohorts(inputs: InsightsInputs): { rows: CohortRow[]; trend: Difference } {
  const weeks = new Map<number, Creator[]>();
  for (const c of creatorsOf(inputs)) {
    const at = c.reached.emailed;
    if (at == null) continue;
    const week = startOfWeek(at);
    const list = weeks.get(week);
    if (list) list.push(c);
    else weeks.set(week, [c]);
  }
  const rows: CohortRow[] = [...weeks]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 12)
    .map(([week, members]): CohortRow => {
      const by = cohortDays.map((days): Ratio | null => {
        if (inputs.now < week + (7 + days) * DAY) return null;
        let n = 0;
        for (const c of members) {
          const sent = c.reached.emailed;
          if (sent == null || c.replyAt === null || c.replyAt < sent) continue;
          if (c.replyAt - sent <= days * DAY) n += 1;
        }
        return { n, d: members.length };
      });
      return { week, emailed: members.length, by };
    });

  const complete = rows.filter((r) => r.by[1] !== null);
  const sum = (part: readonly CohortRow[]): Ratio => ({
    n: part.reduce((s, r) => s + (r.by[1]?.n ?? 0), 0),
    d: part.reduce((s, r) => s + (r.by[1]?.d ?? 0), 0),
  });
  const recent = sum(complete.slice(0, 4));
  const older = sum(complete.slice(4, 8));
  let trend = compareRates(recent, older, thresholds.minEmails);
  if (trend === "clear" && recent.n / recent.d >= older.n / older.d) trend = "chance";
  return { rows, trend };
}

/** Everything the Funnel tab shows, for the period asked for. */
export function funnelReport(inputs: InsightsInputs, window: ReportWindow): FunnelReport {
  const everyone = creatorFunnel(inputs, window, "everyone");
  const { rows, trend } = cohorts(inputs);
  return {
    tab: "funnel",
    window,
    everyone,
    cohort: creatorFunnel(inputs, window, "cohort"),
    biggestDrop: biggestDrop(everyone),
    exits: funnelExits(inputs, window),
    stepDays: stepDays(inputs),
    cohorts: rows,
    cohortTrend: trend,
  };
}
