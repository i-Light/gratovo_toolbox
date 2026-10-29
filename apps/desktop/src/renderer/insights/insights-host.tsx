import { reportTabs } from "@gratovo/core/insights";
import type {
  Drill,
  DrillRow,
  InsightsGo,
  Period,
  ReportTab,
  SearchView,
} from "@gratovo/core/insights";
import { Btn, Empty } from "@gratovo/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { peek } from "../lib/actions";
import { bringBack } from "../lib/find-actions";
import { hideAlert, insightsList, setGoal, useInsightsReport } from "../lib/insights";
import { screens } from "../lib/routes";
import type { ScreenKey } from "../lib/routes";
import { appStore, go, selectRoute, useApp } from "../lib/store";
import { toast } from "../lib/toast";
import { firstShownTab, isRouteShown } from "../lib/wired";
import { strings } from "../strings";
import { copyText } from "./csv";
import { DrillSheet } from "./drill-sheet";
import { EmailsTab } from "./emails-tab";
import { FunnelTab } from "./funnel-tab";
import { GoalTab } from "./goal-tab";
import { InsightsScreen } from "./insights-screen";
import { OverviewTab } from "./overview-tab";
import { SearchTab } from "./search-tab";
import { drillTitle } from "./words/drill";
import { summaryDocument } from "./words/summary";

const text = strings.insights;

function isReportTab(tab: string): tab is ReportTab {
  return reportTabs.some((t) => t === tab);
}

function isScreen(key: string): key is ScreenKey {
  return Object.hasOwn(screens, key);
}

interface DrillState {
  readonly drill: Drill;
  readonly rows: readonly DrillRow[];
  readonly total: number;
}

/** Brings the listed rejected channels back to Review new, one undoable act each. */
async function restoreMistakes(ids: readonly string[]): Promise<void> {
  const found = await Promise.all(
    ids.map((id) =>
      window.gratovo.invoke("find:item", { id }).then(
        (r) => (r.ok ? (r.value.item ?? null) : null),
        () => null,
      ),
    ),
  );
  let done = 0;
  for (const item of found) {
    if (item !== null && bringBack(item)) {
      done += 1;
    }
  }
  if (done === 0 && ids.length > 0) {
    toast({ msg: text.restoreFailed, icon: "alert" });
  }
}

/** One tab's report, read and wired to the screen's actions. */
function Reader({
  tab,
  period,
  view,
  onView,
  onGo,
  onDrill,
}: {
  readonly tab: ReportTab;
  readonly period: Period;
  readonly view: SearchView;
  readonly onView: (view: SearchView) => void;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
}) {
  const { report, status, reload } = useInsightsReport(tab, period);
  const seesMoney = useApp((s) => s.data.seesMoney);
  if (report === null) {
    return status === "failed" ? (
      <div className="card" data-ui="insights.failed">
        <Empty icon="alert" title={text.readFailed}>
          <Btn size="sm" onClick={reload}>
            {text.tryAgain}
          </Btn>
        </Empty>
      </div>
    ) : (
      <p className="muted" data-ui="insights.loading" role="status">
        {text.reading}
      </p>
    );
  }
  switch (report.tab) {
    case "overview":
      return (
        <OverviewTab
          report={report}
          onGo={onGo}
          onDrill={onDrill}
          seesMoney={seesMoney}
          onHide={(key) => {
            void hideAlert(key).then(reload);
          }}
        />
      );
    case "funnel":
      return <FunnelTab report={report} onGo={onGo} onDrill={onDrill} showBrands={false} />;
    case "emails":
      return <EmailsTab report={report} onGo={onGo} />;
    case "search":
      return (
        <SearchTab
          report={report}
          view={view}
          onView={onView}
          onGo={onGo}
          onDrill={onDrill}
          onRestore={(ids) => {
            void restoreMistakes(ids).then(reload);
          }}
        />
      );
    case "goal":
      return (
        <GoalTab
          report={report}
          onGo={onGo}
          onGoal={(patch) => {
            void setGoal(patch).then(reload);
          }}
        />
      );
  }
}

/**
 * Holds the Insights screen's state: the period, the Search view and the open drill sheet. The tab
 * comes from the route; the report is read by `useInsightsReport`.
 */
export function InsightsHost() {
  const source = useApp((s) => s.data.source);
  const routeTab = useApp((s) => selectRoute(s).tab);
  const tab = routeTab ?? firstShownTab("insights", source) ?? "overview";
  const [period, setPeriod] = useState<Period>("30d");
  const [view, setView] = useState<SearchView>("live");
  const [sheet, setSheet] = useState<DrillState | null>(null);
  const pendingView = useRef<SearchView | null>(null);
  const drillToken = useRef(0);

  // Entering Search opens on Live, or on the view a button asked for. A tab change closes the sheet.
  useEffect(() => {
    if (tab === "search") {
      setView(pendingView.current ?? "live");
    }
    pendingView.current = null;
    drillToken.current += 1;
    setSheet(null);
  }, [tab]);

  const openDrill = useCallback(
    (drill: Drill) => {
      drillToken.current += 1;
      const token = drillToken.current;
      void insightsList(drill, period, 0).then((page) => {
        if (token === drillToken.current) {
          setSheet({ drill, rows: page?.rows ?? [], total: page?.total ?? 0 });
        }
      });
    },
    [period],
  );

  const onGo = useCallback(
    (to: InsightsGo) => {
      if (to.kind === "drill") {
        openDrill(to.drill);
      } else if (to.kind === "insights") {
        if (to.tab === "search" && to.view !== null) {
          if (tab === "search") {
            setView(to.view);
          } else {
            pendingView.current = to.view;
          }
        }
        go("insights", to.tab);
      } else if (
        isScreen(to.screen) &&
        isRouteShown({ screen: to.screen, tab: to.tab }, appStore().getState().data.source)
      ) {
        go(to.screen, to.tab);
      }
    },
    [openDrill, tab],
  );

  const loadMore = (): void => {
    if (sheet === null) {
      return;
    }
    const token = drillToken.current;
    void insightsList(sheet.drill, period, sheet.rows.length).then((page) => {
      if (page !== null && token === drillToken.current) {
        setSheet((s) =>
          s === null ? s : { ...s, rows: [...s.rows, ...page.rows], total: page.total },
        );
      }
    });
  };

  const copySummary = (): void => {
    void window.gratovo.invoke("insights:read", { tab: "overview", period }).then(
      (result) => {
        if (result.ok && result.value.tab === "overview") {
          void copyText(summaryDocument(result.value, period), text.summaryCopied);
        }
      },
      () => undefined,
    );
  };

  return (
    <>
      <InsightsScreen period={period} onPeriod={setPeriod} onCopySummary={copySummary}>
        {isReportTab(tab) ? (
          <Reader
            tab={tab}
            period={period}
            view={view}
            onView={setView}
            onGo={onGo}
            onDrill={openDrill}
          />
        ) : undefined}
      </InsightsScreen>
      {sheet === null ? null : (
        <DrillSheet
          title={drillTitle(sheet.drill)}
          rows={sheet.rows}
          total={sheet.total}
          onMore={loadMore}
          onOpen={(id) => {
            peek(
              { kind: "creator", id },
              sheet.rows.map((r) => r.id),
            );
            setSheet(null);
          }}
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
    </>
  );
}
