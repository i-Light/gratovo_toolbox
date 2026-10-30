import { audienceKeys } from "../close/audience";

import {
  basketMinDeals,
  basketShare,
  basketVerdict,
  DAY,
  monthPace,
  paceVerdict,
} from "./deal-facts";
import { goalAsPaid } from "./goal";
import type { InsightsInputs } from "./inputs";
import {
  lateInvoiceDeals,
  payoutDueDeals,
  rosterRows,
  stuckDealRows,
  underFloorDeals,
} from "./money";
import { compareRates, median, rateOf } from "./stats";
import { thresholds } from "./thresholds";
import type {
  Alert,
  AlertLine,
  EmailsReport,
  FunnelReport,
  GoalReport,
  InsightsGo,
  OverviewReport,
  Ratio,
  SearchReport,
  Win,
  WinLine,
} from "./types";

/**
 * The early-warning list and What's working (design section 4). Every rule here is pure, has a
 * minimum sample so it can't cry wolf, and names the button that goes to the fix. It reads the
 * reports the tabs already built (`ReportParts`), so a number in an alert is the number on the tab.
 */

/** The reports the rules read, built once and shared with the tab. */
export interface ReportParts {
  readonly emails: EmailsReport;
  readonly search: SearchReport;
  readonly funnel: FunnelReport;
  readonly goal: GoalReport;
  /** The Overview's "ready to email" tile. */
  readonly fuel: OverviewReport["vitals"]["fuel"];
}

// ---------------------------------------------------------------------------------------------
// Keys

/** Kind plus its subject (mailbox, keyword, step, reason or check), stable while the problem lasts. */
export function alertKey(a: Alert): string {
  switch (a.kind) {
    case "mailboxBounces":
      return `${a.kind}:${a.mailbox}`;
    case "repliesFell":
      return `${a.kind}:${String(a.batch)}`;
    case "keywordWeak":
    case "keywordWornOut":
    case "reFindsArchive":
      return `${a.kind}:${a.keyword}`;
    case "stepShort":
      return `${a.kind}:${a.step}`;
    case "rejectsTooStrict":
      return `${a.kind}:${a.reason}`;
    case "auditFailing":
      return `${a.kind}:${a.check}`;
    case "invoiceLate":
    case "payoutDue":
    case "dealStuck":
    case "marginLow":
      return `${a.kind}:${a.dealId}`;
    case "basket":
      return `${a.kind}:${a.brandId}`;
    case "idleCreator":
      return `${a.kind}:${a.creatorId}`;
    case "fuelLow":
    case "repliesFalling":
    case "roomUnused":
    case "noSearch":
    case "backlogGrowing":
    case "mistakesLeaving":
    case "unreadable":
    case "behindGoal":
      return a.kind;
  }
}

// ---------------------------------------------------------------------------------------------
// Where each button goes

const route = (screen: string, tab: string | null): InsightsGo => ({ kind: "route", screen, tab });
const inInsights = (
  tab: "emails" | "search" | "money" | "goal",
  view: "live" | "waiting" | null = null,
) => ({ kind: "insights", tab, view }) satisfies InsightsGo;

function goOf(a: Alert, parts: ReportParts): InsightsGo {
  switch (a.kind) {
    case "mailboxBounces":
      return route("reach", "mailboxes");
    case "repliesFell":
    case "repliesFalling":
      return inInsights("emails");
    case "fuelLow":
      return parts.search.live.addresses.waiting > 0
        ? route("find", "contacts")
        : route("find", "search");
    case "keywordWeak":
    case "keywordWornOut":
    case "reFindsArchive":
    case "unreadable":
      return inInsights("search", "live");
    case "stepShort":
    case "roomUnused":
      return inInsights("goal");
    case "backlogGrowing":
      return route("find", "triage");
    case "mistakesLeaving":
    case "rejectsTooStrict":
      return inInsights("search", "waiting");
    case "auditFailing":
      return route("settings", "search");
    case "noSearch":
      return route("find", "search");
    case "invoiceLate":
      return { kind: "drill", drill: { kind: "lateInvoices" } };
    case "dealStuck":
      return { kind: "drill", drill: { kind: "stuckDeals", step: a.step } };
    case "marginLow":
      return { kind: "drill", drill: { kind: "underFloor" } };
    case "payoutDue":
    case "basket":
      return inInsights("money");
    case "behindGoal":
      return inInsights("goal");
    case "idleCreator":
      return route("close", null);
  }
}

// ---------------------------------------------------------------------------------------------
// The order

/**
 * Within Act now and within Watch, alerts are ordered by this list (what loses the most the
 * soonest first), then by size (the bigger problem first), then by key, so the order never moves
 * between two reads of the same data.
 */
const kindOrder: readonly Alert["kind"][] = [
  "mailboxBounces",
  "repliesFell",
  "fuelLow",
  "invoiceLate",
  "payoutDue",
  "dealStuck",
  "repliesFalling",
  "behindGoal",
  "stepShort",
  "roomUnused",
  "basket",
  "idleCreator",
  "marginLow",
  "noSearch",
  "backlogGrowing",
  "mistakesLeaving",
  "keywordWeak",
  "keywordWornOut",
  "reFindsArchive",
  "rejectsTooStrict",
  "unreadable",
  "auditFailing",
];

function share(r: Ratio): number {
  return rateOf(r) ?? 0;
}

/** How big the problem is, in the alert's own unit (only compared between alerts of one kind). */
function sizeOf(a: Alert): number {
  switch (a.kind) {
    case "mailboxBounces":
      return share(a.bounced);
    case "repliesFell":
      return share(a.usual) - share(a.rate);
    case "fuelLow":
      return -a.days;
    case "repliesFalling":
      return a.batches;
    case "roomUnused":
      return 1 - share(a.used);
    case "keywordWeak":
      return share(a.others) - share(a.replied);
    case "keywordWornOut":
      return share(a.known);
    case "stepShort":
      return a.needed > 0 ? (a.needed - a.perDay) / a.needed : 0;
    case "noSearch":
      return a.days;
    case "backlogGrowing":
      return a.days;
    case "reFindsArchive":
      return share(a.archived);
    case "mistakesLeaving":
      return a.count;
    case "rejectsTooStrict":
      return a.back;
    case "unreadable":
      return share(a.count);
    case "auditFailing":
      return share(a.failed);
    case "invoiceLate":
      return a.days;
    case "payoutDue":
      return a.amount;
    case "dealStuck":
      return a.usual > 0 ? a.days / a.usual : a.days;
    case "behindGoal":
      return a.goal > 0 ? (a.goal - a.projected) / a.goal : 0;
    case "basket":
      return a.share;
    case "idleCreator":
      return a.days ?? 0;
    case "marginLow":
      return a.floor - a.margin;
  }
}

// ---------------------------------------------------------------------------------------------
// The alerts

interface Found {
  readonly verdict: "act" | "watch";
  readonly alert: Alert;
}

function others(rows: SearchReport["keywords"], row: SearchReport["keywords"][number]): Ratio {
  let n = 0;
  let d = 0;
  for (const r of rows) {
    if (r === row) continue;
    n += r.replied;
    d += r.emailed;
  }
  return { n, d };
}

/** Every rule that fires, before hiding and ordering. */
function firing(inputs: InsightsInputs, parts: ReportParts): Found[] {
  const found: Found[] = [];
  const { emails, search, goal, fuel } = parts;
  const act = (alert: Alert): void => void found.push({ verdict: "act", alert });
  const watch = (alert: Alert): void => void found.push({ verdict: "watch", alert });

  // A mailbox bounces: over 3% of its last 7 days' sends, 20 sends or more.
  for (const box of emails.mailboxes) {
    if (
      box.bounced.d >= thresholds.bounceMin &&
      box.bounced.n / box.bounced.d > thresholds.bounceShare
    ) {
      act({ kind: "mailboxBounces", mailbox: box.address, bounced: box.bounced });
    }
  }

  // Replies fell: the newest full batch is under the floor and clearly under the older ones.
  const full = emails.batches.filter((b) => b.sent >= thresholds.batchSize);
  const last = full[0];
  if (last) {
    const rate: Ratio = { n: last.replied, d: last.sent };
    const usual: Ratio = {
      n: full.slice(1).reduce((s, b) => s + b.replied, 0),
      d: full.slice(1).reduce((s, b) => s + b.sent, 0),
    };
    const r = rateOf(rate);
    const u = rateOf(usual);
    if (
      r !== null &&
      u !== null &&
      r < thresholds.replyFloor &&
      r < u &&
      compareRates(rate, usual, thresholds.minEmails) === "clear"
    ) {
      act({ kind: "repliesFell", batch: last.index, rate, usual });
    }
  }

  // Running out of creators to email.
  if (fuel.days !== null && (fuel.verdict === "act" || fuel.verdict === "watch")) {
    const alert: Alert = {
      kind: "fuelLow",
      ready: fuel.ready,
      days: fuel.days,
      waitingConfirm: fuel.waitingConfirm,
    };
    if (fuel.verdict === "act") act(alert);
    else watch(alert);
  }

  // Replies keep falling: the newest run of full batches, each lower than the one before it.
  if (full.length >= thresholds.fallingBatches) {
    let run = 1;
    let sent = full[0]?.sent ?? 0;
    for (let i = 1; i < full.length; i += 1) {
      const newer = full[i - 1];
      const older = full[i];
      if (!newer || !older) break;
      if (!(newer.replied / newer.sent < older.replied / older.sent)) break;
      run += 1;
      sent += older.sent;
    }
    if (run >= thresholds.fallingBatches && sent >= thresholds.fallingMin) {
      watch({ kind: "repliesFalling", batches: run });
    }
  }

  // Mailbox room unused: under 60% of what the mailboxes allow, over the last 7 days.
  const used = emails.capacity;
  if (
    inputs.messages.length > 0 &&
    used.d >= thresholds.minEmails &&
    used.n / used.d < thresholds.roomUsed
  ) {
    watch({ kind: "roomUnused", used });
  }

  // Keywords.
  for (const row of search.keywords) {
    if (row.found >= thresholds.keywordMin && row.verdict === "drop" && row.why === "noAnswers") {
      watch({
        kind: "keywordWeak",
        keyword: row.keyword,
        replied: { n: row.replied, d: row.emailed },
        others: others(search.keywords, row),
      });
    }
    const run = row.lastRun;
    if (run) {
      const total = run.fresh + run.live + run.archived;
      if (total >= thresholds.minOther) {
        if ((run.live + run.archived) / total > thresholds.wornOut) {
          watch({
            kind: "keywordWornOut",
            keyword: row.keyword,
            known: { n: run.live + run.archived, d: total },
          });
        }
        if (run.archived / total > thresholds.reFindsArchive) {
          watch({
            kind: "reFindsArchive",
            keyword: row.keyword,
            archived: { n: run.archived, d: total },
          });
        }
      }
    }
  }

  // A step is short of the plan.
  for (const line of goal.lines) {
    if (line.perDay === null || line.actualPerDay === null || line.verdict === "early") continue;
    if (line.perDay > 0 && line.actualPerDay < thresholds.stepShort * line.perDay) {
      watch({
        kind: "stepShort",
        step: line.step,
        perDay: line.actualPerDay,
        needed: line.perDay,
      });
    }
  }

  // No search in a week while the fuel is under 5 days.
  const lastRun = inputs.runs.reduce((a, b) => Math.max(a, b), 0);
  if (inputs.runs.length > 0 && fuel.days !== null) {
    const days = Math.floor((inputs.now - lastRun) / DAY);
    if (days >= thresholds.noSearchDays && fuel.days < thresholds.noSearchFuel) {
      watch({ kind: "noSearch", days, fuelDays: fuel.days });
    }
  }

  // Review backlog growing: it would take over 5 days at your triage pace (one review in 14 days
  // when nothing was reviewed, and the report has no days).
  const backlog = search.live.backlog;
  if (backlog.verdict === "watch" && backlog.count >= thresholds.minOther) {
    const pace = backlog.reviewedPerDay > 0 ? backlog.reviewedPerDay : 1 / 14;
    const days = backlog.days ?? backlog.count / pace;
    if (days > thresholds.backlogDays) {
      watch({ kind: "backlogGrowing", count: backlog.count, days });
    }
  }

  // Likely mistakes leave tomorrow.
  if (search.waiting.mistakes.tomorrow > 0) {
    watch({ kind: "mistakesLeaving", count: search.waiting.mistakes.tomorrow });
  }

  // Rejects may be too strict: 10+ brought back for one reason and some later replied or signed.
  for (const look of search.waiting.secondLooks) {
    if (look.back >= thresholds.strictMin && (look.replied > 0 || look.signed > 0)) {
      watch({
        kind: "rejectsTooStrict",
        reason: look.reason,
        back: look.back,
        replied: look.replied,
      });
    }
  }

  // Many channels can't be read.
  const trust = search.live.trust;
  const unread = trust.notRead + trust.retrying + trust.gaveUp;
  const liveCount = search.counts.live;
  if (liveCount >= thresholds.minOther && unread / liveCount > thresholds.unreadableShare) {
    watch({ kind: "unreadable", count: { n: unread, d: liveCount } });
  }

  // The same audience check keeps failing.
  for (const check of audienceKeys) {
    let failed = 0;
    let checked = 0;
    for (const c of inputs.channels) {
      const result = c.audit?.[check];
      if (result === undefined || result === null) continue;
      checked += 1;
      if (!result) failed += 1;
    }
    if (checked >= thresholds.auditMin && failed / checked > 0.5) {
      watch({ kind: "auditFailing", check, failed: { n: failed, d: checked } });
    }
  }

  dealAlerts(inputs, act, watch);

  return found;
}

// ---------------------------------------------------------------------------------------------
// Deals and money (P8b)

/** The shortest median days from invoice to payment must beat the median of all by this much. */
const paysFastBy = 0.75;

/**
 * The rules that read deals; the money ones only for a viewer who sees money. Each uses the very
 * predicate the drill-down lists (`money.ts`), so an alert and its list name the same deals.
 */
function dealAlerts(
  inputs: InsightsInputs,
  act: (alert: Alert) => void,
  watch: (alert: Alert) => void,
): void {
  const { now } = inputs;

  if (inputs.seesMoney) {
    // An invoice is late: Net 30 passed. Act now over 30 days late, Watch from 1.
    for (const { deal: d, days } of lateInvoiceDeals(inputs)) {
      if (d.price === null) continue;
      const alert: Alert = { kind: "invoiceLate", dealId: d.id, days, amount: d.price };
      if (days > thresholds.invoiceAct) act(alert);
      else watch(alert);
    }

    // A payout is due: the brand has paid and the creator hasn't been.
    for (const d of payoutDueDeals(inputs)) {
      if (d.payout === null || d.invoicePaidAt === null) continue;
      watch({ kind: "payoutDue", dealId: d.id, amount: d.payout, since: d.invoicePaidAt });
    }

    // A deal under the margin floor, made in the last 90 days.
    for (const { deal: d, margin } of underFloorDeals(inputs)) {
      watch({ kind: "marginLow", dealId: d.id, margin, floor: inputs.marginFloorPct / 100 });
    }

    // Behind the monthly goal: the month's pace ends under 90% of the goal (as brand payments).
    // The very verdict the Overview's tile and the Money chart show, so they agree.
    const goal = goalAsPaid(inputs);
    const pace = monthPace(inputs);
    if (paceVerdict(pace, goal) === "watch" && goal !== null) {
      watch({ kind: "behindGoal", projected: pace.projected, goal });
    }

    // Too much in one basket: the top brand's share of the last 90 days' payments.
    const basket = basketShare(inputs, basketMinDeals);
    if (basket !== null && basketVerdict(inputs) === "watch") {
      watch({ kind: "basket", brandId: basket.brandId, share: basket.share });
    }
  }

  // A deal is stuck: more than twice the usual time at its step (the usual from at least 5 deals).
  for (const row of stuckDealRows(inputs)) {
    watch({
      kind: "dealStuck",
      dealId: row.dealId,
      step: row.step,
      days: Math.floor(row.days),
      usual: row.usual,
    });
  }

  // An idle roster creator: signed, and no deal in 60 days (counted from signing when none yet).
  for (const row of rosterRows(inputs)) {
    if (!row.idle) continue;
    const since = row.lastDealAt ?? row.signedAt;
    // With no known signing time the days are not known, and no number is made up.
    const days = since === null ? null : Math.floor((now - since) / DAY);
    watch({ kind: "idleCreator", creatorId: row.creatorId, days });
  }
}

/**
 * The early-warning list: alerts hidden for now are left out and counted; Act now comes before
 * Watch; inside each, by the order of `kindOrder`, then the bigger problem first, then by key.
 */
export function alerts(
  inputs: InsightsInputs,
  parts: ReportParts,
): { readonly lines: AlertLine[]; readonly hidden: number } {
  let hidden = 0;
  const lines: AlertLine[] = [];
  for (const f of firing(inputs, parts)) {
    const key = alertKey(f.alert);
    const until = inputs.hidden[key];
    if (until !== undefined && until > inputs.now) {
      hidden += 1;
      continue;
    }
    lines.push({ key, verdict: f.verdict, alert: f.alert, go: goOf(f.alert, parts) });
  }
  lines.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === "act" ? -1 : 1;
    const kind = kindOrder.indexOf(a.alert.kind) - kindOrder.indexOf(b.alert.kind);
    if (kind !== 0) return kind;
    const size = sizeOf(b.alert) - sizeOf(a.alert);
    if (size !== 0) return size;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return { lines, hidden };
}

// ---------------------------------------------------------------------------------------------
// Wins

/**
 * What's working, at most 3, in this order: edited emails, the best keyword, the best mailbox, a
 * follow-up that earns as much as the first email.
 *
 * - edited: the "edited or as written" split is a clear difference and edited is better.
 * - keyword: the best reply rate among keywords with enough emailed, clearly above the other
 *   keywords, with at least 1 signed.
 * - mailbox: the best reply rate of first emails among mailboxes with `minEmails` first emails and
 *   no bounce alert.
 * - followUp: the best follow-up step (1 to 3) with `minEmails` sent whose rate is within 1 point
 *   of the first email's (which also needs `minEmails`) or better.
 */
export function wins(inputs: InsightsInputs, parts: ReportParts): WinLine[] {
  const out: WinLine[] = [];
  const { emails, search } = parts;

  const edited = emails.patterns.find((p) => p.kind === "edited");
  if (edited && edited.result === "clear" && edited.best === "edited") {
    const e = edited.groups.find((g) => g.key === "edited");
    const w = edited.groups.find((g) => g.key === "asWritten");
    if (e && w) {
      out.push({
        result: "clear",
        win: { kind: "edited", edited: e.rate, asWritten: w.rate },
        go: inInsights("emails"),
      });
    }
  }

  let bestKeyword: SearchReport["keywords"][number] | null = null;
  for (const row of search.keywords) {
    if (row.emailed < thresholds.minEmails) continue;
    if (
      bestKeyword === null ||
      row.replied / row.emailed > bestKeyword.replied / bestKeyword.emailed
    ) {
      bestKeyword = row;
    }
  }
  if (bestKeyword && bestKeyword.signed >= 1) {
    const mine: Ratio = { n: bestKeyword.replied, d: bestKeyword.emailed };
    const rest = others(search.keywords, bestKeyword);
    const a = rateOf(mine);
    const b = rateOf(rest);
    if (
      a !== null &&
      b !== null &&
      a > b &&
      compareRates(mine, rest, thresholds.minEmails) === "clear"
    ) {
      out.push({
        result: "clear",
        win: {
          kind: "keyword",
          keyword: bestKeyword.keyword,
          replied: mine,
          signed: bestKeyword.signed,
        },
        go: inInsights("search", "live"),
      });
    }
  }

  let bestBox: EmailsReport["mailboxes"][number] | null = null;
  for (const box of emails.mailboxes) {
    if (box.replies.d < thresholds.minEmails || box.verdict === "act") continue;
    if (bestBox === null || box.replies.n / box.replies.d > bestBox.replies.n / bestBox.replies.d) {
      bestBox = box;
    }
  }
  if (bestBox && bestBox.replies.n > 0) {
    out.push({
      result: "good",
      win: { kind: "mailbox", mailbox: bestBox.address, replies: bestBox.replies },
      go: route("reach", "mailboxes"),
    });
  }

  const first = emails.bySteps.find((s) => s.step === 0);
  const firstRate = first && first.rate.d >= thresholds.minEmails ? rateOf(first.rate) : null;
  if (firstRate !== null) {
    let best: EmailsReport["bySteps"][number] | null = null;
    for (const s of emails.bySteps) {
      if (s.step === 0 || s.rate.d < thresholds.minEmails || s.rate.n === 0) continue;
      const rate = s.rate.n / s.rate.d;
      if (rate < firstRate - 0.01) continue;
      if (best === null || rate > best.rate.n / best.rate.d) best = s;
    }
    if (best) {
      const win: Win = { kind: "followUp", step: best.step, share: best.share, rate: best.rate };
      out.push({ result: "good", win, go: inInsights("emails") });
    }
  }

  const fast = inputs.seesMoney ? brandPaysFast(inputs) : null;
  if (fast) out.push({ result: "good", win: fast, go: inInsights("money") });

  return out.slice(0, 3);
}

/**
 * The brand that pays fastest: the shortest median days from invoice sent to paid, with at least 2
 * paid invoices, and at least 25% under the median of every paid invoice.
 */
function brandPaysFast(inputs: InsightsInputs): Win | null {
  const byBrand = new Map<string, number[]>();
  const all: number[] = [];
  for (const d of inputs.deals) {
    // Paid before sent is a wrong date: left out.
    if (d.invoiceSentAt === null || d.invoicePaidAt === null || d.invoicePaidAt < d.invoiceSentAt) {
      continue;
    }
    const days = (d.invoicePaidAt - d.invoiceSentAt) / DAY;
    all.push(days);
    const list = byBrand.get(d.brandId);
    if (list) list.push(days);
    else byBrand.set(d.brandId, [days]);
  }
  const usual = median(all);
  if (usual === null || !(usual > 0)) return null;
  let best: { brandId: string; days: number } | null = null;
  for (const [brandId, list] of byBrand) {
    if (list.length < 2) continue;
    const days = median(list);
    if (days === null) continue;
    if (best === null || days < best.days || (days === best.days && brandId < best.brandId)) {
      best = { brandId, days };
    }
  }
  if (best === null || best.days > paysFastBy * usual) return null;
  return { kind: "brandPaysFast", brandId: best.brandId, days: Math.round(best.days) };
}
