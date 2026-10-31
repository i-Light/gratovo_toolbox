import {
  createContext,
  useContext,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const OpenTab = createContext<(key: string) => void>(() => undefined);

/** Opens one of the record's tabs from inside a panel (the Overview's "Open the Emails tab"). */
export function useOpenTab(): (key: string) => void {
  return useContext(OpenTab);
}

/** One tab of a record: what it is called and what it shows. */
export interface RecordTab {
  readonly key: string;
  readonly label: string;
  /** A number shown after the label, such as how many deals. */
  readonly count?: number;
  /** Stays mounted while another tab shows, so a box that saves on blur still saves. */
  readonly keepMounted?: boolean;
  readonly render: () => ReactNode;
}

/**
 * What the three records share (D23): the header, an optional steps strip and next step, the tab
 * strip with its keys (arrows, Home, End; one tab in the Tab order) and the panels. A panel renders
 * only while its tab shows, unless the tab is `keepMounted`. `tab` is the tab to open on; the first
 * tab when it is not one of them. If the shown tab goes away (a gated tab), the first one shows.
 */
export function RecordShell({
  dataUi,
  layout,
  face,
  name,
  nameExtra,
  sub,
  tags,
  steps,
  next,
  tabsLabel,
  tabs,
  tab: wanted,
}: {
  readonly dataUi: string;
  readonly layout: "peek" | "page";
  readonly face: ReactNode;
  readonly name: string;
  /** Shown beside the name, such as the stars. */
  readonly nameExtra?: ReactNode;
  readonly sub?: ReactNode;
  readonly tags?: ReactNode;
  readonly steps?: ReactNode;
  readonly next?: ReactNode;
  readonly tabsLabel: string;
  readonly tabs: readonly RecordTab[];
  readonly tab?: string;
}) {
  const [chosen, setChosen] = useState<string | undefined>(wanted);
  const base = useId();
  const first = tabs[0]?.key;
  const tab = tabs.some((t) => t.key === chosen)
    ? chosen
    : tabs.some((t) => t.key === wanted)
      ? wanted
      : first;
  const tabId = (key: string): string => `${base}-tab-${key}`;
  const panelId = (key: string): string => `${base}-panel-${key}`;
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
    const target = tabs[to];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setChosen(target.key);
    document.getElementById(tabId(target.key))?.focus();
  };
  return (
    <OpenTab.Provider value={setChosen}>
      <div className="cr" data-layout={layout} data-ui={dataUi}>
        <div className="rec-h" data-ui="record.header">
          {face}
          <div className="t">
            {nameExtra === undefined ? (
              <h2>{name}</h2>
            ) : (
              <div className="row wrap">
                <h2>{name}</h2>
                {nameExtra}
              </div>
            )}
            {sub === undefined ? null : <div className="cr-meta">{sub}</div>}
            {tags === undefined ? null : (
              <div className="cr-meta" style={{ marginTop: "6px" }}>
                {tags}
              </div>
            )}
          </div>
        </div>
        {steps}
        {next}
        <div className="tabs" data-ui="record.tabs" role="tablist" aria-label={tabsLabel}>
          {tabs.map((t) => (
            <button
              key={t.key}
              id={tabId(t.key)}
              data-ui={`record.tab.${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={panelId(t.key)}
              tabIndex={tab === t.key ? 0 : -1}
              onKeyDown={move}
              onClick={() => {
                setChosen(t.key);
              }}
            >
              {t.label}
              {t.count === undefined || t.count === 0 ? null : (
                <span className="cr-count"> {t.count}</span>
              )}
            </button>
          ))}
        </div>
        {tabs.map((t) => (
          <div
            key={t.key}
            id={panelId(t.key)}
            data-ui={`record.panel.${t.key}`}
            role="tabpanel"
            aria-labelledby={tabId(t.key)}
            className="cr-panel"
            hidden={tab !== t.key}
          >
            {t.keepMounted === true || tab === t.key ? t.render() : null}
          </div>
        ))}
      </div>
    </OpenTab.Provider>
  );
}
