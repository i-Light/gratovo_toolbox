import type { CSSProperties } from "react";
import { Btn, Empty, Icon, PageHead } from "@gratovo/ui";

import { PlaceholderScreen } from "../app/placeholder-screen";
import { useAccount } from "../lib/account";
import { useFind } from "../lib/find";
import { screens } from "../lib/routes";
import { go, selectRoute, useApp } from "../lib/store";
import { shownTabs } from "../lib/wired";
import { strings } from "../strings";
import { Keywords } from "./keywords";
import { LiveRun } from "./live-run";
import { Rules } from "./rules";
import { Runs } from "./runs";
import { Triage, useReviewCount } from "./triage";

const text = strings.findSearch;

/** The page's subtitle: on live data only Search and Review new are built, so it names just those. */
function useSub(): string | undefined {
  const source = useApp((s) => s.data.source);
  const sub = source === "example" ? screens.find.sub : strings.findTriage.liveSub;
  return sub ?? undefined;
}

/** The Find tabs that may show, with the Review new count. Nothing shows while there is one tab. */
function FindTabs() {
  const source = useApp((s) => s.data.source);
  const tab = useApp((s) => selectRoute(s).tab);
  const reviewCount = useReviewCount();
  const tabs = shownTabs("find", source);
  if (tabs.length < 2) {
    return null;
  }
  return (
    <div
      className="tabs find-tabs"
      role="tablist"
      aria-label={strings.findTriage.tabsLabel}
      style={{ "--hue": screens.find.hue } as CSSProperties}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          onClick={() => {
            go("find", t.key);
          }}
        >
          {t.name}
          {t.key === "triage" && reviewCount !== null && reviewCount > 0 ? (
            <span className="cnt">{reviewCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function SearchTab() {
  const { state, load, reload } = useFind();
  const account = useAccount();
  const info = screens.find;
  const sub = useSub();
  return (
    <div className="page">
      <PageHead title={info.name} {...(sub === undefined ? {} : { sub })} />
      <FindTabs />
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
    </div>
  );
}

function TriageTab() {
  const info = screens.find;
  const sub = useSub();
  return (
    <div className="page">
      <PageHead title={info.name} {...(sub === undefined ? {} : { sub })} />
      <FindTabs />
      <Triage />
    </div>
  );
}

/** The Find screen: Search and Review new are built; the other tabs wait for their steps. */
export function FindScreen() {
  const tab = useApp((s) => selectRoute(s).tab);
  if (tab === "search") {
    return <SearchTab />;
  }
  return tab === "triage" ? <TriageTab /> : <PlaceholderScreen screen="find" />;
}
