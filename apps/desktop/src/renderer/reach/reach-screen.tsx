import { Empty, PageHead } from "@gratovo/ui";
import type { CSSProperties, KeyboardEvent } from "react";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { screens } from "../lib/routes";
import { go, selectRoute, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { Board } from "./board";
import { CapSummary } from "./cap-summary";
import { GeminiBanner } from "./gemini-banner";
import { Mailboxes } from "./mailboxes";
import { Replies } from "./replies";
import { Sequences } from "./sequences";
import { subLine } from "./reach-view";

const text = strings.reach.screen;
const panelId = "reach-panel";
const tabId = (key: string): string => `reach-tab-${key}`;

/** The Reach tabs that may show; nothing shows while there is one. Arrow keys move between them. */
function ReachTabs({ tab }: { readonly tab: string }) {
  const source = useApp((s) => s.data.source);
  const tabs = shownTabs("reach", source);
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
    go("reach", next.key);
    requestAnimationFrame(() => {
      document.getElementById(tabId(next.key))?.focus();
    });
  };
  return (
    <div
      className="tabs"
      data-ui="reach.tabs"
      role="tablist"
      aria-label={text.tabsLabel}
      style={{ "--hue": screens.reach.hue } as CSSProperties}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(t.key)}
          data-ui={`reach.tab.${t.key}`}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          aria-controls={panelId}
          tabIndex={tab === t.key ? 0 : -1}
          onKeyDown={move}
          onClick={() => {
            go("reach", t.key);
          }}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** The Reach screen. 6a builds the Board; the other tabs show on example data only, as stand-ins. */
export function ReachScreen() {
  const reach = useApp((s) => s.data.reach);
  const creators = useApp((s) => s.data.creators);
  const source = useApp((s) => s.data.source);
  const routeTab = useApp((s) => selectRoute(s).tab);
  const tab = routeTab ?? "board";
  if (!shownTabs("reach", source).some((t) => t.key === tab)) {
    return <PlaceholderScreen screen="reach" />;
  }
  return (
    <div className="page" data-ui="reach.page">
      <PageHead
        dataUi="reach.head"
        title={text.title}
        sub={subLine(reach, creators)}
        right={<CapSummary />}
      />
      <ReachTabs tab={tab} />
      <GeminiBanner />
      <div id={panelId} data-ui="reach.panel" role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === "board" ? (
          <Board />
        ) : tab === "sequences" ? (
          <Sequences />
        ) : tab === "inbox" ? (
          <Replies />
        ) : tab === "mailboxes" ? (
          <Mailboxes />
        ) : (
          <div className="card">
            <Empty icon="wrench" title={screens.reach.tabs.find((t) => t.key === tab)?.name ?? ""}>
              {strings.placeholder.body}
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}
