import { Empty, PageHead } from "@gratovo/ui";
import type { CSSProperties, KeyboardEvent } from "react";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { screens } from "../lib/routes";
import { go, selectRoute, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { Roster } from "./roster";
import { waitingForCheck } from "./roster-kits";

const text = strings.closeScreen;
const panelId = "close-panel";
const tabId = (key: string): string => `close-tab-${key}`;

/** The Close tabs that may show; nothing shows while there is one. Arrow keys move between them. */
function CloseTabs({ tab }: { readonly tab: string }) {
  const source = useApp((s) => s.data.source);
  const waiting = useApp((s) => s.data.creators.filter(waitingForCheck).length);
  const tabs = shownTabs("close", source);
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
    go("close", next.key);
    requestAnimationFrame(() => {
      document.getElementById(tabId(next.key))?.focus();
    });
  };
  return (
    <div
      className="tabs"
      data-ui="close.tabs"
      role="tablist"
      aria-label={text.tabsLabel}
      style={{ "--hue": screens.close.hue } as CSSProperties}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(t.key)}
          data-ui={`close.tab.${t.key}`}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          aria-controls={panelId}
          tabIndex={tab === t.key ? 0 : -1}
          onKeyDown={move}
          onClick={() => {
            go("close", t.key);
          }}
        >
          {t.name}
          {t.key === "roster" && waiting > 0 ? (
            <span className="muted num tab-count">{waiting}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The Close screen. Roster is built; the other tabs show on example data only, as stand-ins. */
export function CloseScreen() {
  const source = useApp((s) => s.data.source);
  const routeTab = useApp((s) => selectRoute(s).tab);
  const tab = routeTab ?? "roster";
  if (!shownTabs("close", source).some((t) => t.key === tab)) {
    return <PlaceholderScreen screen="close" />;
  }
  return (
    <div className="page" data-ui="close.page">
      <PageHead dataUi="close.head" title={text.title} sub={text.sub} hue={screens.close.hue} />
      <CloseTabs tab={tab} />
      <div id={panelId} data-ui="close.panel" role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === "roster" ? (
          <Roster />
        ) : (
          <div className="card">
            <Empty icon="wrench" title={screens.close.tabs.find((t) => t.key === tab)?.name ?? ""}>
              {strings.placeholder.body}
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}
