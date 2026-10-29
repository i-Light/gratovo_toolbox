import type { DataSource } from "@gratovo/core/data";
import { insightsHiddenMax } from "@gratovo/ipc";
import type { CatalogItem } from "@gratovo/core/find";
import { drillIds, insightsReport, thresholds } from "@gratovo/core/insights";
import type {
  ChannelFacts,
  Drill,
  DrillNote,
  DrillRow,
  GoalSettings,
  GoalStep,
  HiddenAlerts,
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
  read(tab: ReportTab, period: Period): Promise<InsightsReport>;
  list(drill: Drill, period: Period, offset: number): Promise<{ rows: DrillRow[]; total: number }>;
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

export function createInsightsService(deps: InsightsServiceDeps): InsightsService {
  function open(): DataSource {
    const source = deps.source();
    if (source === null) {
      throw new Error("No data is open: the account is signed out or waiting for access.");
    }
    return source;
  }

  async function inputs() {
    const source = open();
    const path = deps.pipelineDbPath();
    return readInputs({
      source,
      // With no data folder there is no file: the reader treats a missing path as empty.
      pipelineDbPath: path ?? "",
      catalog: await deps.catalog(),
      archiveDays: deps.archiveDays(),
      now: deps.now(),
    });
  }

  return {
    async read(tab, period) {
      return insightsReport(tab, await inputs(), period);
    },
    async list(drill, period, offset) {
      const all = await inputs();
      const ids = drillIds(drill, all, period);
      const byId = new Map(all.channels.map((c) => [c.id, c]));
      // Every counted id gets a row, so the pages add up to the total. A creator the funnel knows
      // only from its history (its record was removed) is listed by id, as gone.
      const rows: DrillRow[] = ids.slice(offset, offset + drillPageMax).map((id) => {
        const c = byId.get(id);
        return c === undefined
          ? { id, name: id, handle: null, note: { kind: "gone" } }
          : { id, name: c.name, handle: c.handle, note: noteOf(c, drill) };
      });
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
      const current =
        patch.reset === true
          ? { signsPerMonth: thresholds.signsPerMonth, overrides: {} }
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
        overrides: Object.fromEntries(overrides),
      };
      source.writeSetting(goalSettingName, next);
      return next;
    },
  };
}
