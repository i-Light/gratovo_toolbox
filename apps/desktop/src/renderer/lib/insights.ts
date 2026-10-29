import type { ChannelRequest, ChannelResponse } from "@gratovo/ipc";
import type { Drill, Period, ReportTab } from "@gratovo/core/insights";
import { useCallback, useEffect, useState } from "react";

import { useCatalogTick } from "./find-catalog";
import { useApp } from "./store";

export type InsightsLoad = "loading" | "ready" | "failed";
type Report = ChannelResponse<"insights:read">;

/** How often an open Insights screen reads again by itself. */
const refreshMs = 60_000;
/** How long Hide for 7 days hides an alert. */
export const hideMs = 7 * 86_400_000;

interface Held {
  readonly report: Report | null;
  readonly failed: boolean;
}

/**
 * One Insights tab for a period. Read on mount and again when the tab or period changes, on each
 * `find:catalog`, when the newest log line changes, on `reload`, and every 60 seconds while mounted.
 * A failed read keeps the last report (`status` "failed" says so). An answer for an old tab or
 * period is dropped. The report is null until the first answer for this tab.
 */
export function useInsightsReport(
  tab: ReportTab,
  period: Period,
): {
  readonly report: Report | null;
  readonly status: InsightsLoad;
  readonly reload: () => void;
} {
  const tick = useCatalogTick();
  const newestLine = useApp((s) => s.data.log[0]?.id ?? "");
  const [beat, setBeat] = useState(0);
  const [held, setHeld] = useState<Held>({ report: null, failed: false });
  useEffect(() => {
    const timer = setInterval(() => {
      setBeat((n) => n + 1);
    }, refreshMs);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    window.gratovo.invoke("insights:read", { tab, period }).then(
      (result) => {
        if (stopped) {
          return;
        }
        setHeld((last) =>
          result.ok ? { report: result.value, failed: false } : { ...last, failed: true },
        );
      },
      () => {
        if (!stopped) {
          setHeld((last) => ({ ...last, failed: true }));
        }
      },
    );
    return () => {
      stopped = true;
    };
  }, [tab, period, tick, newestLine, beat]);
  const reload = useCallback(() => {
    setBeat((n) => n + 1);
  }, []);
  const report = held.report?.tab === tab ? held.report : null;
  const status: InsightsLoad = held.failed ? "failed" : report === null ? "loading" : "ready";
  return { report, status, reload };
}

/** One page of the records behind a number; null when the read failed. */
export async function insightsList(
  drill: Drill,
  period: Period,
  offset: number,
): Promise<ChannelResponse<"insights:list"> | null> {
  const result = await window.gratovo
    .invoke("insights:list", { drill, period, offset })
    .catch(() => null);
  return result?.ok === true ? result.value : null;
}

/** Hides an alert for 7 days. True when it was stored. */
export async function hideAlert(key: string): Promise<boolean> {
  const result = await window.gratovo
    .invoke("insights:hide", { key, until: Date.now() + hideMs })
    .catch(() => null);
  return result?.ok === true;
}

/** Changes the goal. True when it was stored. */
export async function setGoal(patch: ChannelRequest<"insights:goal">): Promise<boolean> {
  const result = await window.gratovo.invoke("insights:goal", patch).catch(() => null);
  return result?.ok === true;
}
