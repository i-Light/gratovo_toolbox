import { Btn, Tag } from "@gratovo/ui";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { FitChip } from "../find/fit-chip";
import { ThumbAvatar } from "../find/thumb";
import { strings } from "../strings";
import { CreatorActivity } from "./creator-activity";
import { CreatorEmails } from "./creator-emails";
import { CreatorNext } from "./creator-next";
import { CreatorNotes } from "./creator-notes";
import { CreatorOverview } from "./creator-overview";
import { channelUrl } from "./detail";
import { useCreatorItem } from "./use-creator-item";

const text = strings.creatorRecord;

const tabKeys = ["overview", "emails", "notes", "activity"] as const;
type TabKey = (typeof tabKeys)[number];

/** The header and the tab strip as grey shapes, for the moment before the channel arrives. */
function Skeleton() {
  return (
    <div className="cr-skel" role="status" aria-label={text.loading} aria-busy="true">
      <div className="head">
        <i></i>
        <span>
          <i style={{ width: "55%" }}></i>
          <i style={{ width: "35%" }}></i>
        </span>
      </div>
      <div className="tabsk">
        <i></i>
        <i></i>
        <i></i>
      </div>
    </div>
  );
}

/**
 * One body for the peek and the record page (D23): header, the one next step, then the tabs
 * Overview, Notes and Activity. `fallback` shows instead of "not in your data" when main's
 * catalog lacks the channel but the page still holds it.
 */
export function CreatorRecord({
  id,
  layout,
  tab: wanted,
  fallback,
}: {
  readonly id: string;
  readonly layout: "peek" | "page";
  /** The tab to open on; Overview when it is not one of the tabs. */
  readonly tab?: string;
  readonly fallback?: ReactNode;
}) {
  const { status, item, retry } = useCreatorItem(id);
  const [tab, setTab] = useState<TabKey>(tabKeys.find((k) => k === wanted) ?? "overview");
  const base = useId();
  if (status === "loading") {
    return <Skeleton />;
  }
  if (status === "failed") {
    return (
      <div className="col">
        <p className="hint">{text.loadFailed}</p>
        <div className="row">
          <Btn size="sm" onClick={retry}>
            {text.retry}
          </Btn>
        </div>
      </div>
    );
  }
  if (item === null) {
    return fallback !== undefined ? <>{fallback}</> : <p className="hint">{text.notFound}</p>;
  }
  const tabId = (key: TabKey): string => `${base}-tab-${key}`;
  const panelId = (key: TabKey): string => `${base}-panel-${key}`;
  const move = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const here = tabKeys.indexOf(tab);
    const to =
      event.key === "ArrowRight"
        ? (here + 1) % tabKeys.length
        : event.key === "ArrowLeft"
          ? (here - 1 + tabKeys.length) % tabKeys.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabKeys.length - 1
              : -1;
    const next = tabKeys[to];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };
  const link = channelUrl(item.id);
  return (
    <div className="cr" data-layout={layout}>
      <div className="rec-h">
        <ThumbAvatar pic={item.pic} name={item.name} alt={text.avatarAlt(item.name)} />
        <div className="t">
          <h2>{item.name}</h2>
          <div className="cr-meta">
            <span className="muted small handle">{item.handle}</span>
            {link === null ? null : (
              <a className="cr-link" href={link} target="_blank" rel="noreferrer">
                {text.openOnYouTube}
              </a>
            )}
          </div>
          <div className="cr-meta" style={{ marginTop: "6px" }}>
            <Tag>{strings.record.stages[item.stage]}</Tag>
            <FitChip fit={item.fit} />
          </div>
        </div>
      </div>
      <CreatorNext item={item} />
      <div className="tabs" role="tablist" aria-label={text.tabsLabel}>
        {tabKeys.map((key) => (
          <button
            key={key}
            id={tabId(key)}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={panelId(key)}
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={move}
            onClick={() => {
              setTab(key);
            }}
          >
            {text.tabs[key]}
          </button>
        ))}
      </div>
      <div
        id={panelId("overview")}
        role="tabpanel"
        aria-labelledby={tabId("overview")}
        className="cr-panel"
        hidden={tab !== "overview"}
      >
        <CreatorOverview item={item} />
      </div>
      <div
        id={panelId("emails")}
        role="tabpanel"
        aria-labelledby={tabId("emails")}
        className="cr-panel"
        hidden={tab !== "emails"}
      >
        {tab === "emails" ? <CreatorEmails creatorId={item.id} /> : null}
      </div>
      {/* Always mounted, so leaving the tab with unsaved text still saves it on blur. */}
      <div
        id={panelId("notes")}
        role="tabpanel"
        aria-labelledby={tabId("notes")}
        className="cr-panel"
        hidden={tab !== "notes"}
      >
        <CreatorNotes item={item} />
      </div>
      {/* The panel stays so aria-controls resolves; the list inside loads only while shown. */}
      <div
        id={panelId("activity")}
        role="tabpanel"
        aria-labelledby={tabId("activity")}
        className="cr-panel"
        hidden={tab !== "activity"}
      >
        {tab === "activity" ? <CreatorActivity id={item.id} /> : null}
      </div>
    </div>
  );
}
