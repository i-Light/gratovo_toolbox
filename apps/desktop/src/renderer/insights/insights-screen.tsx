import { Btn, Empty, PageHead, Seg } from "@gratovo/ui";
import { periods } from "@gratovo/core/insights";
import type { Period } from "@gratovo/core/insights";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { screens } from "../lib/routes";
import { go, selectRoute, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import "./insights.css";

const text = strings.insights;
const panelId = "insights-panel";
const tabId = (key: string): string => `insights-tab-${key}`;

/** The words for a period. */
export function insightsPeriodLabel(period: Period): string {
  return text.periods[period];
}

/** The Insights tabs that may show. Arrow keys move between them. */
function InsightsTabs({ tab }: { readonly tab: string }) {
  const source = useApp((s) => s.data.source);
  const tabs = shownTabs("insights", source);
  if (tabs.length < 2) {
    return null;
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const here = tabs.findIndex((t) => t.key === tab);
    const to =
      event.key === "ArrowRight"
        ? (here + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (here - 1 + tabs.length) % tabs.length
          : -1;
    const next = tabs[to];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    go("insights", next.key);
    requestAnimationFrame(() => {
      document.getElementById(tabId(next.key))?.focus();
    });
  };
  return (
    <div
      className="tabs"
      data-ui="insights.tabs"
      role="tablist"
      aria-label={text.tabsLabel}
      style={{ "--hue": screens.insights.hue } as CSSProperties}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(t.key)}
          data-ui={`insights.tab.${t.key}`}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          aria-controls={panelId}
          tabIndex={tab === t.key ? 0 : -1}
          onKeyDown={move}
          onClick={() => {
            go("insights", t.key);
          }}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** What a tab shows until its report is wired in (task A11). Money has its own words. */
function Stand({ tab }: { readonly tab: string }) {
  const name = screens.insights.tabs.find((t) => t.key === tab)?.name ?? "";
  return (
    <div className="card">
      {tab === "money" ? (
        <Empty icon="dollar" title={text.moneyComes} />
      ) : (
        <Empty icon="chart" title={name}>
          {text.building}
        </Empty>
      )}
    </div>
  );
}

/** What `InsightsScreen` takes. */
export interface InsightsScreenProps {
  readonly period: Period;
  readonly onPeriod: (period: Period) => void;
  readonly onCopySummary: () => void;
  /** The tab content; left out, a stand-in shows. */
  readonly children?: ReactNode;
}

/** The Insights screen: the header with its period switch, the tabs, and the tab panel. */
export function InsightsScreen({ period, onPeriod, onCopySummary, children }: InsightsScreenProps) {
  const source = useApp((s) => s.data.source);
  const routeTab = useApp((s) => selectRoute(s).tab);
  const tab = routeTab ?? "overview";
  const tabsShown = shownTabs("insights", source);
  if (!tabsShown.some((t) => t.key === tab)) {
    return <PlaceholderScreen screen="insights" />;
  }
  return (
    <div className="page ins" data-ui="insights.page">
      <PageHead
        dataUi="insights.head"
        title={text.title}
        sub={text.sub}
        hue={screens.insights.hue}
        right={
          <div className="ins-head-tools">
            <Seg
              label={text.periodLabel}
              value={period}
              options={periods.map((p) => ({ value: p, label: text.periods[p] }))}
              onPick={(value) => {
                const picked = periods.find((p) => p === value);
                if (picked !== undefined) {
                  onPeriod(picked);
                }
              }}
            />
            <Btn kind="ghost" size="sm" icon="copy" onClick={onCopySummary}>
              {text.copySummary}
            </Btn>
          </div>
        }
      />
      <InsightsTabs tab={tab} />
      <div
        id={panelId}
        data-ui="insights.panel"
        role="tabpanel"
        {...(tabsShown.length > 1
          ? { "aria-labelledby": tabId(tab) }
          : { "aria-label": text.title })}
      >
        {children ?? <Stand tab={tab} />}
      </div>
    </div>
  );
}
