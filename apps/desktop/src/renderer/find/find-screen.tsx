import { type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Btn, Empty, Icon, PageHead } from "@gratovo/ui";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { useAccount } from "../lib/account";
import { useFind } from "../lib/find";
import { screens } from "../lib/routes";
import { go, selectRoute, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { Keywords } from "./keywords";
import { Contacts, useContactsCount } from "./contacts";
import { Gallery } from "./gallery";
import { LiveRun } from "./live-run";
import { Rules } from "./rules";
import { Runs } from "./runs";
import { reviewTabCount, Triage, useReview, useReviewCount } from "./triage";

const text = strings.findSearch;

/** The page's subtitle: on live data it names what is built. */
function useSub(): string | undefined {
  const source = useApp((s) => s.data.source);
  const sub = source === "example" ? screens.find.sub : strings.findTriage.liveSub;
  return sub ?? undefined;
}

/** The one panel the tabs control; its label is the selected tab. */
const panelId = "find-panel";
const tabId = (key: string): string => `find-tab-${key}`;

/**
 * The Find tabs that may show, with the Review new count. Nothing shows while there is one tab.
 * The arrow keys move between the tabs (the ARIA tabs pattern): only the selected tab is in the
 * Tab order. A mouse click hands focus to the panel, so the arrows then step through the screen.
 */
function FindTabs({ reviewCount }: { readonly reviewCount: number | null }) {
  const contactsCount = useContactsCount();
  const source = useApp((s) => s.data.source);
  const tab = useApp((s) => selectRoute(s).tab);
  const tabs = shownTabs("find", source);
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
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    const next = tabs[to];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    go("find", next.key);
    // Each tab is its own screen with its own tab list, so focus follows once the new one is there.
    requestAnimationFrame(() => {
      document.getElementById(tabId(next.key))?.focus();
    });
  };
  return (
    <div
      className="tabs find-tabs"
      data-ui="find.tabs"
      role="tablist"
      aria-label={strings.findTriage.tabsLabel}
      style={{ "--hue": screens.find.hue } as CSSProperties}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          id={tabId(t.key)}
          data-ui={`find.tab.${t.key}`}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          aria-controls={panelId}
          tabIndex={tab === t.key ? 0 : -1}
          onKeyDown={move}
          onClick={(event) => {
            go("find", t.key);
            // detail is 0 for Enter and Space, which keep focus on the tab.
            if (event.detail > 0) {
              requestAnimationFrame(() => {
                document.getElementById(panelId)?.focus({ preventScroll: true });
              });
            }
          }}
        >
          {t.name}
          {t.key === "triage" && reviewCount !== null && reviewCount > 0 ? (
            <span className="cnt">{reviewCount}</span>
          ) : null}
          {t.key === "contacts" && contactsCount !== null && contactsCount > 0 ? (
            <span className="cnt">{contactsCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The tabs on the Search tab: the Review new count needs its own small query there. */
function SearchTabs() {
  return <FindTabs reviewCount={useReviewCount()} />;
}

/** The panel the selected tab shows. */
function Panel({ children }: { readonly children: ReactNode }) {
  const tab = useApp((s) => selectRoute(s).tab);
  return (
    <div id={panelId} role="tabpanel" aria-labelledby={tabId(tab ?? "")} tabIndex={-1}>
      {children}
    </div>
  );
}

function SearchTab() {
  const { state, load, reload } = useFind();
  const account = useAccount();
  const info = screens.find;
  const sub = useSub();
  return (
    <div className="page" data-ui="find.page">
      <PageHead dataUi="find.head" title={info.name} {...(sub === undefined ? {} : { sub })} />
      <SearchTabs />
      <Panel>
        {state === null ? (
          load === "failed" ? (
            <div className="card">
              <Empty
                icon="alert"
                title={text.loadFailed}
                action={
                  <Btn size="sm" onClick={reload}>
                    {text.retry}
                  </Btn>
                }
              />
            </div>
          ) : null
        ) : (
          <>
            {account.signedIn ? null : (
              <p className="hint find-example">
                <Icon name="info" />
                {text.exampleData}
              </p>
            )}
            <div className="fd-grid">
              <Keywords state={state} />
              <div className="col">
                <LiveRun state={state} />
                <Rules rules={state.rules} />
              </div>
            </div>
            <Runs />
          </>
        )}
      </Panel>
    </div>
  );
}

function TriageTab() {
  const info = screens.find;
  const sub = useSub();
  const review = useReview();
  return (
    <div className="page" data-ui="find.page">
      <PageHead dataUi="find.head" title={info.name} {...(sub === undefined ? {} : { sub })} />
      <FindTabs reviewCount={reviewTabCount(review)} />
      <Panel>
        <Triage review={review} />
      </Panel>
    </div>
  );
}

function GalleryTab() {
  const info = screens.find;
  const sub = useSub();
  return (
    <div className="page" data-ui="find.page">
      <PageHead dataUi="find.head" title={info.name} {...(sub === undefined ? {} : { sub })} />
      <SearchTabs />
      <Panel>
        <Gallery />
      </Panel>
    </div>
  );
}

function ContactsTab() {
  const info = screens.find;
  const sub = useSub();
  return (
    <div className="page" data-ui="find.page">
      <PageHead dataUi="find.head" title={info.name} {...(sub === undefined ? {} : { sub })} />
      <SearchTabs />
      <Panel>
        <Contacts />
      </Panel>
    </div>
  );
}

/** The Find screen: Search, Review new, Gallery and Contacts. */
export function FindScreen() {
  const tab = useApp((s) => selectRoute(s).tab);
  if (tab === "search") {
    return <SearchTab />;
  }
  if (tab === "gallery") {
    return <GalleryTab />;
  }
  if (tab === "contacts") {
    return <ContactsTab />;
  }
  return tab === "triage" ? <TriageTab /> : <PlaceholderScreen screen="find" />;
}
