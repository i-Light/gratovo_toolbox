import { emailsReport } from "./emails";
import { brandReachedIds, brandStuckIds, funnelReport, reachedIds, stuckIds } from "./funnel";
import { goalReport } from "./goal";
import type { InsightsInputs } from "./inputs";
import {
  idleCreatorIds,
  lateInvoiceDeals,
  moneyReport,
  noNextDeals,
  payoutDueDeals,
  stuckDealRows,
  underFloorDeals,
} from "./money";
import { overviewReport, readyIds, repliesWaitingIds } from "./overview";
import {
  isAddressWaiting,
  isLive,
  isMistake,
  isUnreadable,
  isWaiting,
  leavesOnDay,
  liveGroup,
  reasonOf,
  searchReport,
  secondLookReasons,
} from "./search";
import { reportWindow } from "./stats";
import type { Drill, InsightsReport, Period, ReportTab } from "./types";

/**
 * One entry for main: the report of a tab for a period (`insights:read`) and the records behind a
 * number (`insights:list`). A number and its list come from the same predicates, so they agree
 * (design rule 8, plan decision A4).
 */

export function insightsReport(
  tab: ReportTab,
  inputs: InsightsInputs,
  period: Period,
): InsightsReport {
  const window = reportWindow(period, inputs.now);
  switch (tab) {
    case "overview":
      return overviewReport(inputs, window);
    case "funnel":
      return funnelReport(inputs, window);
    case "emails":
      return emailsReport(inputs, window);
    case "search":
      return searchReport(inputs, window);
    case "money":
      return moneyReport(inputs, window);
    case "goal":
      return goalReport(inputs, window);
  }
}

/** Which kind of record a drill's ids name: a brand, a deal, or (the rest) a creator. */
export function drillRecord(drill: Drill): "creator" | "brand" | "deal" {
  switch (drill.kind) {
    case "brandStep":
    case "brandStuck":
      return "brand";
    case "lateInvoices":
    case "payoutsDue":
    case "stuckDeals":
    case "underFloor":
    case "noNextDeal":
      return "deal";
    default:
      return "creator";
  }
}

/**
 * The record ids behind a number, worked out by the rules that counted it.
 *
 * - `step`: found and passed list the catalog's channels only. The archive part of those two
 *   numbers (hundreds of thousands of tombstones) opens Toolbox › Archive instead, so the list is
 *   the row's count minus the archive's part (found: `archive.total`; passed: `total - byRules`).
 *   Later steps list every creator who ever reached the step.
 * - `stuck`: the creators counted in the row's `stuck` (everyone mode).
 * - `keyword`, `live`, `leaving`, `mistakes`, `undated`, `rejected`: catalog channels, by the same
 *   predicates the Search report uses.
 * - `brandStep`, `brandStuck`: brand ids; `lateInvoices`, `payoutsDue`, `stuckDeals`, `underFloor`,
 *   `noNextDeal`: deal ids; `idleCreators`: creator ids (see `drillRecord`). The money drills list
 *   nothing for a viewer who doesn't see money.
 * - `secondLook`, `fuel`, `unconfirmed`, `repliesWaiting`, `unreadable`: as counted on their tabs.
 */
export function drillIds(drill: Drill, inputs: InsightsInputs, period: Period): string[] {
  const now = reportWindow(period, inputs.now).now;
  const channels = inputs.channels;
  switch (drill.kind) {
    case "step":
      return drill.step === "found" || drill.step === "passed"
        ? channels.filter((c) => c.inCatalog).map((c) => c.id)
        : reachedIds(inputs, drill.step);
    case "stuck":
      return stuckIds(inputs, drill.step);
    case "keyword":
      return channels
        .filter((c) => isLive(c) && c.keywords.includes(drill.keyword))
        .map((c) => c.id);
    case "live":
      return channels.filter((c) => isLive(c) && liveGroup(c) === drill.group).map((c) => c.id);
    case "leaving":
      return channels.filter((c) => leavesOnDay(c, now, drill.day)).map((c) => c.id);
    case "mistakes":
      return channels.filter(isMistake).map((c) => c.id);
    case "undated":
      return channels.filter((c) => isWaiting(c) && c.leavesAt === null).map((c) => c.id);
    case "rejected":
      return channels.filter((c) => isWaiting(c) && reasonOf(c) === drill.reason).map((c) => c.id);
    case "secondLook":
      return [...secondLookReasons(inputs, now)]
        .filter(([, reason]) => reason === drill.reason)
        .map(([id]) => id);
    case "fuel":
      return readyIds(inputs);
    case "unconfirmed":
      return channels.filter(isAddressWaiting).map((c) => c.id);
    case "repliesWaiting":
      return repliesWaitingIds(inputs);
    case "unreadable":
      return channels.filter((c) => isUnreadable(c, drill.which)).map((c) => c.id);
    case "brandStep":
      return brandReachedIds(inputs, drill.step);
    case "brandStuck":
      return brandStuckIds(inputs, drill.step);
    case "lateInvoices":
      return inputs.seesMoney ? lateInvoiceDeals(inputs).map((x) => x.deal.id) : [];
    case "payoutsDue":
      return inputs.seesMoney ? payoutDueDeals(inputs).map((d) => d.id) : [];
    case "stuckDeals":
      return stuckDealRows(inputs)
        .filter((r) => drill.step === null || r.step === drill.step)
        .map((r) => r.dealId);
    case "underFloor":
      return inputs.seesMoney ? underFloorDeals(inputs).map((x) => x.deal.id) : [];
    case "idleCreators":
      return idleCreatorIds(inputs);
    case "noNextDeal":
      return noNextDeals(inputs).map((d) => d.id);
  }
}
