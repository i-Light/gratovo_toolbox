import type { DataSource } from "@gratovo/core/data";
import { insightsHiddenMax } from "@gratovo/ipc";
import type { CatalogItem } from "@gratovo/core/find";
import {
  brandStuckRows,
  drillIds,
  drillRecord,
  insightsReport,
  lateInvoiceDeals,
  payoutDueDeals,
  rosterRows,
  stuckDealRows,
  thresholds,
  underFloorDeals,
} from "@gratovo/core/insights";
import type {
  ChannelFacts,
  Drill,
  DrillNote,
  DrillRow,
  GoalSettings,
  GoalStep,
  HiddenAlerts,
  InsightsInputs,
  InsightsReport,
  Period,
  ReportTab,
} from "@gratovo/core/insights";

import {
  goalFrom,
  goalSettingName,
  hiddenFrom,
  hiddenSettingName,
} from "../data/repositories/insights";

import { readInputs } from "./inputs";

/**
 * The Insights service (plan step P8a, A3, A4, A10): one read per tab, the records behind a
 * number, and the two settings the screen writes (hidden alerts, the goal). Reads go through the
 * open data source and `pipeline.db`; nothing here sends anything or leaves the computer.
 */

/** The most rows one `insights:list` page carries. */
export const drillPageMax = 100;

/** A change to the goal: what is present is set; an override of `null` goes back to your own rate. */
export interface GoalPatch {
  readonly signsPerMonth?: number;
  /** Net revenue a month in dollars; null clears the money goal. */
  readonly revenuePerMonth?: number | null;
  readonly overrides?: Readonly<Partial<Record<GoalStep, number | null>>>;
  /** Back to the default goal (4 a month, no overrides), before the rest applies. */
  readonly reset?: true;
}

export interface InsightsServiceDeps {
  /** The open source; null when none is open (the service then refuses). */
  readonly source: () => DataSource | null;
  /** `pipeline.db` in the open data folder; null with none. */
  readonly pipelineDbPath: () => string | null;
  /** The Find catalog's rows. */
  readonly catalog: () => Promise<readonly CatalogItem[]>;
  readonly archiveDays: () => number;
  readonly now: () => number;
}

export interface InsightsService {
  /** `deals` false reads as if there were no deals or money (live, until step 9). */
  read(tab: ReportTab, period: Period, deals: boolean): Promise<InsightsReport>;
  list(
    drill: Drill,
    period: Period,
    offset: number,
    deals: boolean,
  ): Promise<{ rows: DrillRow[]; total: number }>;
  hide(key: string, until: number | null): { hidden: HiddenAlerts };
  goal(patch: GoalPatch): GoalSettings;
}

/** The note on a row: a waiting channel's reject reason, a live channel's fit. */
function noteOf(c: ChannelFacts, drill: Drill): DrillNote | null {
  if (drill.kind === "secondLook") {
    return { kind: "reason", reason: drill.reason };
  }
  if (c.stage === "rejected") {
    return { kind: "reason", reason: c.rejectReason ?? "unknown" };
  }
  return c.inCatalog ? { kind: "fit", fit: c.fit } : null;
}

const DAY = 86_400_000;

/** The notes of a deal or brand drill, by record id; the rules are the ones that counted them. */
function notesOf(drill: Drill, all: InsightsInputs): Map<string, DrillNote> {
  const out = new Map<string, DrillNote>();
  switch (drill.kind) {
    case "brandStuck":
      for (const r of brandStuckRows(all, drill.step)) {
        out.set(r.id, { kind: "days", days: Math.floor(r.days) });
      }
      break;
    case "lateInvoices":
      for (const x of lateInvoiceDeals(all)) {
        out.set(x.deal.id, { kind: "money", amount: x.deal.price ?? 0, days: x.days });
      }
      break;
    case "payoutsDue":
      for (const d of payoutDueDeals(all)) {
        out.set(d.id, {
          kind: "money",
          amount: d.payout ?? 0,
          days:
            d.invoicePaidAt === null
              ? null
              : Math.max(0, Math.floor((all.now - d.invoicePaidAt) / DAY)),
        });
      }
      break;
    case "underFloor":
      for (const x of underFloorDeals(all))
        out.set(x.deal.id, { kind: "margin", margin: x.margin });
      break;
    case "stuckDeals":
      for (const r of stuckDealRows(all)) {
        out.set(r.dealId, { kind: "days", days: Math.floor(r.days) });
      }
      break;
    case "idleCreators":
      for (const r of rosterRows(all)) {
        const since = r.lastDealAt ?? r.signedAt;
        if (r.idle && since !== null) {
          out.set(r.creatorId, { kind: "days", days: Math.floor((all.now - since) / DAY) });
        }
      }
      break;
    default:
      break;
  }
  return out;
}

export function createInsightsService(deps: InsightsServiceDeps): InsightsService {
  function open(): DataSource {
    const source = deps.source();
    if (source === null) {
      throw new Error("No data is open: the account is signed out or waiting for access.");
    }
    return source;
  }

  async function inputs(deals: boolean) {
    const source = open();
    const path = deps.pipelineDbPath();
    return readInputs({
      source,
      // With no data folder there is no file: the reader treats a missing path as empty.
      pipelineDbPath: path ?? "",
      catalog: await deps.catalog(),
      archiveDays: deps.archiveDays(),
      now: deps.now(),
      deals,
    });
  }

  return {
    async read(tab, period, deals) {
      const all = await inputs(deals);
      // Money stays with those who see money (B3), and waits for deals on live (B8): the screen
      // hides the tab in both cases, so this is a guard.
      if (tab === "money" && (!deals || !all.seesMoney)) {
        throw new Error("Money is not available to this account.");
      }
      return insightsReport(tab, all, period);
    },
    async list(drill, period, offset, deals) {
      const all = await inputs(deals);
      const ids = drillIds(drill, all, period);
      const record = drillRecord(drill);
      const notes = notesOf(drill, all);
      const slice = ids.slice(offset, offset + drillPageMax);
      let rows: DrillRow[];
      if (record === "brand") {
        const brands = new Map(all.brands.map((b) => [b.id, b]));
        rows = slice.map((id) => {
          const b = brands.get(id);
          return {
            id,
            record,
            name: b?.name ?? id,
            handle: null,
            note: notes.get(id) ?? (b === undefined ? { kind: "gone" } : null),
          };
        });
      } else if (record === "deal") {
        const deals = new Map(all.deals.map((d) => [d.id, d]));
        const brands = new Map(all.brands.map((b) => [b.id, b.name]));
        const creators = new Map(all.channels.map((c) => [c.id, c.name]));
        rows = slice.map((id) => {
          const d = deals.get(id);
          if (d === undefined)
            return { id, record, name: id, handle: null, note: { kind: "gone" } };
          const name = `${brands.get(d.brandId) ?? d.brandId} × ${creators.get(d.creatorId) ?? d.creatorId}`;
          return { id, record, name, handle: null, note: notes.get(id) ?? null };
        });
      } else {
        const byId = new Map(all.channels.map((c) => [c.id, c]));
        // Every counted id gets a row, so the pages add up to the total. A creator the funnel
        // knows only from its history (its record was removed) is listed by id, as gone.
        rows = slice.map((id) => {
          const c = byId.get(id);
          return c === undefined
            ? { id, name: id, handle: null, note: { kind: "gone" } }
            : { id, name: c.name, handle: c.handle, note: notes.get(id) ?? noteOf(c, drill) };
        });
      }
      return { rows, total: ids.length };
    },
    hide(key, until) {
      const source = open();
      const now = deps.now();
      const hidden: Record<string, number> = {};
      // What has run out is dropped as the setting is written.
      for (const [k, t] of Object.entries(hiddenFrom(source.readSetting(hiddenSettingName)))) {
        if (t > now && k !== key) {
          hidden[k] = t;
        }
      }
      if (until !== null && until > now) {
        hidden[key] = until;
      }
      // Past the most the answer may carry, the ones that end soonest go first.
      const kept = Object.fromEntries(
        Object.entries(hidden)
          .sort((a, b) => b[1] - a[1])
          .slice(0, insightsHiddenMax),
      );
      source.writeSetting(hiddenSettingName, kept);
      return { hidden: kept };
    },
    goal(patch) {
      const source = open();
      // The money goal stays with money viewers (B3): the field is hidden for others, so this is a guard.
      if (patch.revenuePerMonth !== undefined && !source.insights.readLocal().seesMoney) {
        throw new Error("The money goal is not available to this account.");
      }
      const current =
        patch.reset === true
          ? { signsPerMonth: thresholds.signsPerMonth, revenuePerMonth: null, overrides: {} }
          : goalFrom(source.readSetting(goalSettingName));
      const overrides = new Map(Object.entries(current.overrides) as [GoalStep, number][]);
      for (const [step, rate] of Object.entries(patch.overrides ?? {}) as [
        GoalStep,
        number | null | undefined,
      ][]) {
        if (rate === null) {
          overrides.delete(step);
        } else if (rate !== undefined) {
          overrides.set(step, rate);
        }
      }
      const next: GoalSettings = {
        signsPerMonth: patch.signsPerMonth ?? current.signsPerMonth,
        revenuePerMonth:
          patch.revenuePerMonth === undefined ? current.revenuePerMonth : patch.revenuePerMonth,
        overrides: Object.fromEntries(overrides),
      };
      source.writeSetting(goalSettingName, next);
      return next;
    },
  };
}
