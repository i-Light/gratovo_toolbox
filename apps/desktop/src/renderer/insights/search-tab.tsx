import { Btn, Empty } from "@gratovo/ui";
import { searchViews } from "@gratovo/core/insights";
import type {
  Drill,
  GroupProfile,
  InsightsGo,
  KeywordRow,
  Ratio,
  SearchReport,
  SearchView,
} from "@gratovo/core/insights";
import { useState } from "react";
import type { ReactNode } from "react";

import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { BarList, ShareBar } from "./charts/bars";
import { FlowBand } from "./charts/flow-band";
import type { FlowEdge, FlowNode } from "./charts/flow-band";
import { PairedColumns } from "./charts/paired-columns";
import { SmallMultiples } from "./charts/small-multiples";
import { Panel } from "./panel";
import { VerdictDot } from "./verdict";
import { dayLabel, weekdayLabel } from "./words/format";
import {
  addressHeadline,
  addressSources,
  addressWaiting,
  archivedWhyHeadline,
  backlogHeadline,
  backlogMeaning,
  changeText,
  compact,
  fmt,
  formatKept,
  heroHeadline,
  heroMeaning,
  joinLeaveHeadline,
  joinLeaveMeaning,
  keptPer1000,
  keywordHeadline,
  keywordMeaning,
  keywordVerdictTone,
  keywordWhy,
  knownShare,
  lastKnown,
  leavesLabel,
  mistakesHeadline,
  oldestDays,
  pct,
  profileHeadline,
  profileMeaning,
  profileOf,
  reasonsHeadline,
  reasonsMeaning,
  refindHeadline,
  restoreIds,
  ruleLabel,
  secondLooksHeadline,
  secondLooksMeaning,
  trustHeadline,
  unreadableTotal,
  weekPoints,
  weeksHeadline,
  daysLabel,
} from "./words/search";
import "./search.css";

const text = strings.insights.search;
const hero = text.hero;

/** What `SearchTab` takes. */
export interface SearchTabProps {
  readonly report: SearchReport;
  /** The view shown; the host holds it (it opens on `live`). */
  readonly view: SearchView;
  readonly onView: (view: SearchView) => void;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
  /** Brings channels back from the archive; at most 50 ids, which is what `toolbox:restore` takes. */
  readonly onRestore: (ids: readonly string[]) => void;
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// The hero: the flow band and the view switch

interface Band {
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly height: number;
}

function bandOf(
  view: SearchView,
  report: SearchReport,
  go: (screen: string, tab: string | null) => void,
  onDrill: (d: Drill) => void,
  onRestore: (ids: readonly string[]) => void,
): Band {
  switch (view) {
    case "live": {
      const g = report.live.groups;
      const live = (group: keyof typeof g): (() => void) => {
        return () => {
          onDrill({ kind: "live", group });
        };
      };
      return {
        height: 230,
        nodes: [
          {
            id: "notReviewed",
            count: g.notReviewed,
            label: hero.steps.notReviewed,
            tone: "warn",
            x: 0.1,
            y: 0.38,
            onClick: live("notReviewed"),
            action: {
              label: `${hero.actions.review} →`,
              onClick: () => {
                go("find", "triage");
              },
            },
          },
          {
            id: "shortlisted",
            count: g.shortlisted,
            label: hero.steps.shortlisted,
            tone: "series-live",
            x: 0.36,
            y: 0.38,
            onClick: live("shortlisted"),
            action: {
              label: `${hero.actions.draft} →`,
              onClick: () => {
                go("reach", "board");
              },
            },
          },
          {
            id: "outreach",
            count: g.outreach,
            label: hero.steps.outreach,
            tone: "series-live",
            x: 0.62,
            y: 0.38,
            onClick: live("outreach"),
            action: {
              label: `${hero.actions.openReach} →`,
              onClick: () => {
                go("reach", "board");
              },
            },
          },
          {
            id: "signed",
            count: g.signed,
            label: hero.steps.signed,
            tone: "good",
            x: 0.88,
            y: 0.38,
            onClick: live("signed"),
            action: {
              label: `${hero.actions.roster} →`,
              onClick: () => {
                go("close", "roster");
              },
            },
          },
        ],
        edges: [
          { from: "notReviewed", to: "shortlisted", tone: "series-neutral" },
          { from: "shortlisted", to: "outreach", tone: "series-neutral" },
          { from: "outreach", to: "signed", tone: "series-neutral" },
        ],
      };
    }
    case "waiting": {
      const w = report.waiting;
      const total = w.dated + w.undated;
      const days = w.leaving.slice(0, 7);
      const nodes: FlowNode[] = [
        {
          id: "waiting",
          count: total,
          label: hero.waitingNode,
          sub: hero.waitingSub,
          tone: "series-waiting",
          x: 0.07,
          y: 0.5,
        },
        ...days.map((d, i): FlowNode => ({
          id: `day${String(i)}`,
          count: d.count,
          label: i === 0 ? hero.tomorrow : weekdayLabel(d.at),
          tone: "series-waiting",
          x: 0.2 + i * 0.095,
          y: 0.5,
          ...(i === 0 ? { highlight: true } : {}),
          onClick: () => {
            onDrill({ kind: "leaving", day: i });
          },
        })),
        {
          id: "archived",
          count: w.dated,
          label: hero.archivedNode,
          tone: "series-archive",
          x: 0.9,
          y: 0.5,
          dashed: true,
        },
      ];
      const edges: FlowEdge[] = [
        { from: "waiting", to: "day0", tone: "series-neutral" },
        ...days.slice(1).map((_, i): FlowEdge => ({
          from: `day${String(i)}`,
          to: `day${String(i + 1)}`,
          tone: "series-neutral",
        })),
        {
          from: `day${String(Math.max(0, days.length - 1))}`,
          to: "archived",
          tone: "series-neutral",
        },
      ];
      if (w.mistakes.total > 0) {
        const ids = restoreIds(w.mistakes.top);
        nodes.push({
          id: "mistakes",
          count: w.mistakes.total,
          label: hero.mistakes,
          sub: hero.mistakesSub(fmt(w.mistakes.tomorrow)),
          tone: "good",
          x: 0.3,
          y: 0.1,
          onClick: () => {
            onDrill({ kind: "mistakes" });
          },
          action: {
            label: `${hero.actions.bringBack} →`,
            onClick: () => {
              onRestore(ids);
            },
          },
        });
        edges.push({ from: "waiting", to: "mistakes", tone: "good", curved: true });
      }
      if (w.undated > 0) {
        nodes.push({
          id: "undated",
          count: w.undated,
          label: hero.undated,
          tone: "series-neutral",
          x: 0.3,
          y: 0.72,
          dashed: true,
          onClick: () => {
            onDrill({ kind: "undated" });
          },
        });
        edges.push({
          from: "waiting",
          to: "undated",
          tone: "series-neutral",
          curved: true,
          dashed: true,
        });
      }
      return { height: 370, nodes, edges };
    }
    case "archive": {
      const a = report.archive;
      return {
        height: 280,
        nodes: [
          {
            id: "rules",
            count: a.byRules,
            label: hero.rulesNode,
            tone: "series-rules",
            x: 0.1,
            y: 0.22,
          },
          {
            id: "person",
            count: a.byPerson,
            label: hero.personNode,
            tone: "series-archive",
            x: 0.1,
            y: 0.74,
          },
          {
            id: "archive",
            count: report.counts.archive,
            label: hero.archiveNode,
            tone: "series-archive",
            x: 0.5,
            y: 0.46,
          },
          {
            id: "refound",
            count: a.refoundThisWeek,
            label: hero.refoundNode,
            sub: hero.refoundSub,
            tone: "warn",
            x: 0.88,
            y: 0.22,
          },
          {
            id: "back",
            // Brought back (d), and of those the ones who replied since (n).
            count: a.broughtBack.d,
            label: hero.backNode,
            sub: hero.backSub(fmt(a.broughtBack.n)),
            tone: "good",
            x: 0.88,
            y: 0.7,
          },
        ],
        edges: [
          { from: "rules", to: "archive", tone: "series-rules", curved: true },
          { from: "person", to: "archive", tone: "series-archive", curved: true },
          { from: "archive", to: "refound", tone: "warn", curved: true },
          { from: "archive", to: "back", tone: "good", curved: true },
        ],
      };
    }
    case "everything": {
      const e = report.everything;
      return {
        height: 310,
        nodes: [
          {
            id: "found",
            count: e.found,
            label: hero.foundNode,
            tone: "series-neutral",
            x: 0.08,
            y: 0.46,
          },
          {
            id: "swept",
            count: e.swept,
            label: hero.sweptNode,
            tone: "series-rules",
            x: 0.4,
            y: 0.16,
          },
          {
            id: "passed",
            count: e.passed,
            label: hero.passedNode,
            tone: "series-neutral",
            x: 0.4,
            y: 0.62,
          },
          {
            id: "rw",
            count: e.rejectedWaiting,
            label: hero.waitingPerson,
            tone: "series-waiting",
            x: 0.7,
            y: 0.32,
          },
          {
            id: "ra",
            count: e.rejectedArchived,
            label: hero.archivedPerson,
            tone: "series-archive",
            x: 0.92,
            y: 0.32,
          },
          { id: "live", count: e.live, label: hero.liveNode, tone: "series-live", x: 0.7, y: 0.8 },
        ],
        edges: [
          { from: "found", to: "swept", tone: "series-rules", curved: true },
          { from: "found", to: "passed", tone: "series-neutral", curved: true },
          { from: "passed", to: "rw", tone: "series-waiting", curved: true },
          { from: "rw", to: "ra", tone: "series-archive" },
          { from: "passed", to: "live", tone: "series-live", curved: true },
        ],
      };
    }
  }
}

function heroNumbers(view: SearchView, report: SearchReport) {
  const g = report.live.groups;
  const w = report.waiting;
  const rows: Record<SearchView, readonly (readonly (string | number)[])[]> = {
    live: [
      [hero.steps.notReviewed, g.notReviewed],
      [hero.steps.shortlisted, g.shortlisted],
      [hero.steps.outreach, g.outreach],
      [hero.steps.signed, g.signed],
      [hero.parkedRow, g.parked],
      [hero.neverRow, g.never],
    ],
    waiting: [
      [hero.waitingNode, w.dated + w.undated],
      ...w.leaving.map((l, i) => [i === 0 ? hero.tomorrow : weekdayLabel(l.at), l.count]),
      [hero.mistakes, w.mistakes.total],
      [hero.undated, w.undated],
    ],
    archive: [
      [hero.rulesNode, report.archive.byRules],
      [hero.personNode, report.archive.byPerson],
      [hero.refoundNode, report.archive.refoundThisWeek],
      [hero.backNode, report.archive.broughtBack.d],
    ],
    everything: [
      [hero.foundNode, report.everything.found],
      [hero.sweptNode, report.everything.swept],
      [hero.passedNode, report.everything.passed],
      [hero.waitingPerson, report.everything.rejectedWaiting],
      [hero.archivedPerson, report.everything.rejectedArchived],
      [hero.liveNode, report.everything.live],
    ],
  };
  return { columns: hero.numbersColumns, rows: rows[view] };
}

function ViewSwitch({
  report,
  view,
  onView,
}: {
  readonly report: SearchReport;
  readonly view: SearchView;
  readonly onView: (v: SearchView) => void;
}) {
  return (
    <div className="srch-views" role="group" aria-label={text.viewsLabel} data-ui="search.views">
      <p className="srch-views-head">{text.viewsHeading}</p>
      {searchViews.map((v) => (
        <button
          key={v}
          type="button"
          className="srch-view"
          data-view={v}
          aria-pressed={view === v}
          data-ui={`search.view.${v}`}
          onClick={() => {
            onView(v);
          }}
        >
          <i className={`srch-dot ${v}`} aria-hidden="true" />
          <span className="srch-view-text">
            <b>{text.views[v].name}</b>
            <small>{text.views[v].question}</small>
          </span>
          <span className="srch-view-count num">{fmt(report.counts[v])}</span>
        </button>
      ))}
    </div>
  );
}

function Hero({ report, view, onView, onGo, onDrill, onRestore }: SearchTabProps) {
  const go = (screen: string, tab: string | null): void => {
    onGo({ kind: "route", screen, tab });
  };
  const head = heroHeadline(view, report);
  const band = bandOf(view, report, go, onDrill, onRestore);
  const g = report.live.groups;
  const action =
    view === "live" ? (
      <Btn
        kind="ghost"
        size="sm"
        onClick={() => {
          go("find", "gallery");
        }}
      >
        {hero.actions.openLive}
      </Btn>
    ) : view === "waiting" || view === "archive" ? (
      <Btn
        kind="ghost"
        size="sm"
        onClick={() => {
          go("toolbox", "archive");
        }}
      >
        {view === "waiting" ? hero.actions.openArchive : hero.actions.searchArchive}
      </Btn>
    ) : undefined;
  return (
    <Panel
      dataUi={`search.hero.${view}`}
      hero
      headline={
        <>
          {head.lead}
          {head.accent === null ? null : (
            <>
              {" "}
              <span className={`srch-accent ${view}`}>{head.accent}</span>
            </>
          )}
        </>
      }
      counted={hero.counted[view]}
      numbers={heroNumbers(view, report)}
      what={hero.what[view]}
      meaning={heroMeaning(view, report)}
      actions={action}
    >
      <div className="srch-hero">
        <div className="srch-hero-band">
          <FlowBand
            nodes={band.nodes}
            edges={band.edges}
            height={band.height}
            ariaLabel={hero.bandLabel[view]}
          />
          {view === "live" ? (
            <p className="srch-aside">
              {hero.setAside}{" "}
              <button
                type="button"
                className="srch-link"
                onClick={() => {
                  onDrill({ kind: "live", group: "parked" });
                }}
              >
                {hero.parked(fmt(g.parked))}
              </button>
              {" · "}
              <button
                type="button"
                className="srch-link"
                onClick={() => {
                  onDrill({ kind: "live", group: "never" });
                }}
              >
                {hero.never(fmt(g.never))}
              </button>
            </p>
          ) : null}
        </div>
        <ViewSwitch report={report} view={view} onView={onView} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Live panels

function JoinLeave({ report }: { readonly report: SearchReport }) {
  const w = report.live.weekly;
  const t = text.weekly;
  return (
    <Panel
      dataUi="search.live.weekly"
      headline={joinLeaveHeadline(report)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: w.map((x) => [dayLabel(x.at), x.joined, x.left]),
      }}
      meaning={joinLeaveMeaning(report)}
    >
      {w.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <PairedColumns
          rows={w.map((x) => ({
            key: String(x.at),
            label: dayLabel(x.at),
            a: x.joined,
            b: x.left,
          }))}
          legend={{
            a: { label: t.joined, tone: "series-live" },
            b: { label: t.left, tone: "series-neutral" },
          }}
          height={190}
          labelEvery={3}
          ariaLabel={t.aria}
        />
      )}
    </Panel>
  );
}

function Backlog({
  report,
  onGo,
}: {
  readonly report: SearchReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const b = report.live.backlog;
  const t = text.backlog;
  const age = oldestDays(b.oldestAt, report.window.now);
  const top = Math.max(b.foundPerDay, b.reviewedPerDay);
  return (
    <Panel
      dataUi="search.live.backlog"
      headline={backlogHeadline(b.count)}
      counted={t.counted}
      verdict={b.verdict}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: [
          [t.backlog, b.count],
          [t.oldestRow, age ?? "—"],
          [t.found, Math.round(b.foundPerDay)],
          [t.reviewed, Math.round(b.reviewedPerDay)],
        ],
      }}
      meaning={backlogMeaning(report)}
      actions={
        b.count > 0 ? (
          <Btn
            kind="pri"
            size="sm"
            onClick={() => {
              onGo({ kind: "route", screen: "find", tab: "triage" });
            }}
          >
            {t.review}
          </Btn>
        ) : undefined
      }
    >
      <div className="srch-backlog">
        <div className="srch-backlog-big">
          <BigNumber value={fmt(b.count)} size="lg" />
          {age === null ? null : <span className="muted">{t.oldest(daysLabel(age))}</span>}
        </div>
        <BarList
          max={top}
          rows={[
            {
              key: "found",
              label: t.found,
              value: b.foundPerDay,
              display: fmt(b.foundPerDay),
              tone: "series-live",
            },
            {
              key: "reviewed",
              label: t.reviewed,
              value: b.reviewedPerDay,
              display: fmt(b.reviewedPerDay),
              tone: "series-neutral",
            },
          ]}
        />
      </div>
    </Panel>
  );
}

function KeywordScorecard({
  keywords,
  onDrill,
  dataUi,
}: {
  readonly keywords: readonly KeywordRow[];
  readonly onDrill: (d: Drill) => void;
  readonly dataUi: string;
}) {
  const [all, setAll] = useState(false);
  const t = text.keywords;
  const shown = all ? keywords : keywords.slice(0, 6);
  const maxKept = Math.max(0, ...shown.map((k) => keptPer1000(k) ?? 0));
  return (
    <Panel
      dataUi={dataUi}
      headline={keywordHeadline(keywords)}
      counted={
        all || keywords.length <= 6
          ? t.countedAll(fmt(keywords.length))
          : t.counted(fmt(shown.length), fmt(keywords.length))
      }
      what={t.what}
      numbers={{
        columns: [
          t.columns.keyword,
          t.columns.found,
          t.columns.kept,
          t.columns.live,
          t.columns.emailed,
          t.columns.replied,
          t.columns.signed,
          t.columns.verdict,
        ],
        rows: keywords.map((k) => {
          const kept = keptPer1000(k);
          return [
            k.keyword,
            k.found,
            kept === null ? t.notKnown : formatKept(kept),
            k.live,
            k.emailed,
            k.replied,
            k.signed,
            t.verdict[k.verdict],
          ];
        }),
      }}
      meaning={keywordMeaning(keywords)}
      actions={
        keywords.length > 6 ? (
          <Btn
            kind="ghost"
            size="sm"
            expanded={all}
            onClick={() => {
              setAll((v) => !v);
            }}
          >
            {all ? t.fewer : t.all(fmt(keywords.length))}
          </Btn>
        ) : undefined
      }
    >
      {keywords.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <div className="ins-table-wrap">
          <table className="ins-table srch-kw" aria-label={t.aria}>
            <thead>
              <tr>
                <th scope="col">{t.columns.keyword}</th>
                <th scope="col" className="num">
                  {t.columns.found}
                </th>
                <th scope="col">{t.columns.kept}</th>
                <th scope="col" className="num">
                  {t.columns.live}
                </th>
                <th scope="col" className="num">
                  {t.columns.emailed}
                </th>
                <th scope="col" className="num">
                  {t.columns.replied}
                </th>
                <th scope="col" className="num">
                  {t.columns.signed}
                </th>
                <th scope="col">{t.columns.verdict}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((k) => {
                const kept = keptPer1000(k);
                const why = keywordWhy(k);
                return (
                  <tr key={k.keyword} data-keyword={k.keyword}>
                    <td>
                      <button
                        type="button"
                        className="srch-link strong"
                        aria-label={t.keywordLabel(k.keyword)}
                        onClick={() => {
                          onDrill({ kind: "keyword", keyword: k.keyword });
                        }}
                      >
                        {k.keyword}
                      </button>
                    </td>
                    <td className="num">{fmt(k.found)}</td>
                    <td>
                      {kept === null ? (
                        <span className="muted">{t.notKnown}</span>
                      ) : (
                        <span className="srch-kept">
                          <ShareBar
                            n={kept}
                            d={maxKept}
                            tone="series-live"
                            ariaLabel={t.keptAria(formatKept(kept))}
                          />
                          <span className="num">{formatKept(kept)}</span>
                        </span>
                      )}
                    </td>
                    <td className="num">{fmt(k.live)}</td>
                    <td className="num">{fmt(k.emailed)}</td>
                    <td className="num">{fmt(k.replied)}</td>
                    <td className="num strong">{fmt(k.signed)}</td>
                    <td>
                      <VerdictDot verdict={keywordVerdictTone[k.verdict]} />
                      {why === null ? null : <div className="srch-why muted">{why}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ratioShare(r: Ratio): number {
  return r.d > 0 ? r.n / r.d : 0;
}

function Addresses({
  report,
  onGo,
}: {
  readonly report: SearchReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const a = report.live.addresses;
  const t = text.addresses;
  const withCount = (r: Ratio): string => t.withCount(pct(ratioShare(r)), fmt(r.n), fmt(r.d));
  return (
    <Panel
      dataUi="search.live.addresses"
      headline={addressHeadline(report)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: [
          [t.found, pct(ratioShare(a.found)), a.found.n],
          [t.confirmed, pct(ratioShare(a.confirmed)), a.confirmed.n],
        ],
      }}
      meaning={addressWaiting(a.waiting)}
      actions={
        a.waiting > 0 ? (
          <Btn
            kind="ghost"
            size="sm"
            onClick={() => {
              onGo({ kind: "route", screen: "find", tab: "contacts" });
            }}
          >
            {t.confirm(fmt(a.waiting))}
          </Btn>
        ) : undefined
      }
    >
      {a.shortlisted === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <>
          <BarList
            max={1}
            tone="series-live"
            rows={[
              {
                key: "found",
                label: t.found,
                value: ratioShare(a.found),
                display: withCount(a.found),
              },
              {
                key: "confirmed",
                label: t.confirmed,
                value: ratioShare(a.confirmed),
                display: withCount(a.confirmed),
              },
            ]}
          />
          <p className="srch-note">{addressSources(report)}</p>
        </>
      )}
    </Panel>
  );
}

function Trust({
  report,
  onDrill,
}: {
  readonly report: SearchReport;
  readonly onDrill: (d: Drill) => void;
}) {
  const tr = report.live.trust;
  const t = text.trust;
  const rows = [
    { which: "notRead", label: t.rows.notRead, count: tr.notRead },
    { which: "retrying", label: t.rows.retrying, count: tr.retrying },
    { which: "gaveUp", label: t.rows.gaveUp, count: tr.gaveUp },
    { which: "noCountry", label: t.rows.noCountry, count: tr.noCountry },
  ] as const;
  return (
    <Panel
      dataUi="search.live.trust"
      headline={trustHeadline(tr)}
      counted={t.counted}
      what={t.what}
      numbers={{ columns: t.columns, rows: rows.map((r) => [r.label, r.count]) }}
      meaning={unreadableTotal(tr) === 0 ? t.fine : t.gaveUp(fmt(tr.gaveUp))}
    >
      <ul className="srch-trust">
        {rows.map((r) => (
          <li key={r.which}>
            <button
              type="button"
              className="srch-trust-row"
              aria-label={t.open(r.label)}
              onClick={() => {
                onDrill({ kind: "unreadable", which: r.which });
              }}
            >
              <span>{r.label}</span>
              <b className="num">{fmt(r.count)}</b>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// To be archived panels

function Mistakes({
  report,
  onDrill,
  onRestore,
}: {
  readonly report: SearchReport;
  readonly onDrill: (d: Drill) => void;
  readonly onRestore: (ids: readonly string[]) => void;
}) {
  const m = report.waiting.mistakes;
  const t = text.mistakes;
  const ids = restoreIds(m.top);
  const shown = m.top.slice(0, 5);
  const now = report.window.now;
  return (
    <Panel
      dataUi="search.waiting.mistakes"
      headline={mistakesHeadline(m.total)}
      counted={t.counted}
      {...(m.tomorrow > 0 ? { verdict: "watch" as const } : {})}
      what={t.what}
      numbers={{
        columns: t.numbersColumns,
        rows: m.top.map((x) => [
          x.name,
          text.reasons[x.reason],
          x.fit,
          x.medianViews === null ? t.viewsUnknown : x.medianViews,
          leavesLabel(x.leavesAt, now),
        ]),
      }}
      meaning={
        m.total === 0
          ? t.none
          : `${t.showing(fmt(shown.length), fmt(m.total))}${m.tomorrow > 0 ? ` ${t.tomorrowLeave(fmt(m.tomorrow))}` : ""}`
      }
      actions={
        m.total > 0 ? (
          <>
            <Btn
              kind="ghost"
              size="sm"
              onClick={() => {
                onDrill({ kind: "mistakes" });
              }}
            >
              {t.openAll(fmt(m.total))}
            </Btn>
            <Btn
              kind="pri"
              size="sm"
              onClick={() => {
                onRestore(ids);
              }}
            >
              {ids.length === m.total ? t.bringAll(fmt(m.total)) : t.bringTop(fmt(ids.length))}
            </Btn>
          </>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <table className="ins-table srch-mistakes" aria-label={t.listLabel}>
          <thead>
            <tr>
              <th scope="col">{t.columns.channel}</th>
              <th scope="col">{t.columns.fit}</th>
              <th scope="col" className="num">
                {t.columns.views}
              </th>
              <th scope="col" className="num">
                {t.columns.leaves}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => {
              const leaves = leavesLabel(x.leavesAt, now);
              return (
                <tr key={x.id}>
                  <td>
                    <b className="strong">{x.name}</b>
                    <div className="muted srch-why">
                      {strings.insights.search.rejectedFor(lowerFirst(text.reasons[x.reason]))}
                    </div>
                  </td>
                  <td>
                    <span className="srch-kept">
                      <ShareBar n={x.fit} d={100} tone="good" ariaLabel={t.fitLabel(fmt(x.fit))} />
                      <span className="num">{fmt(x.fit)}</span>
                    </span>
                  </td>
                  <td className="num">
                    {x.medianViews === null ? (
                      <span className="muted">{t.viewsUnknown}</span>
                    ) : (
                      compact(x.medianViews)
                    )}
                  </td>
                  <td
                    className={
                      leaves === t.tomorrow || leaves === t.today ? "num srch-soon" : "num"
                    }
                  >
                    {leaves}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Reasons({ report }: { readonly report: SearchReport }) {
  const reasons = [...report.waiting.reasons].sort((a, b) => b.count - a.count);
  const total = reasons.reduce((s, r) => s + r.count, 0);
  const t = text.reasonsPanel;
  return (
    <Panel
      dataUi="search.waiting.reasons"
      headline={reasonsHeadline(report)}
      counted={t.counted(fmt(total))}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: reasons.map((r) => [text.reasons[r.reason], r.count]),
      }}
      meaning={reasonsMeaning(report)}
    >
      {reasons.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <BarList
          ariaLabel={t.aria}
          tone="series-waiting"
          rows={reasons.map((r) => ({
            key: r.reason,
            label: text.reasons[r.reason],
            value: r.count,
            display: fmt(r.count),
          }))}
        />
      )}
    </Panel>
  );
}

function SecondLooks({
  report,
  onDrill,
}: {
  readonly report: SearchReport;
  readonly onDrill: (d: Drill) => void;
}) {
  const looks = report.waiting.secondLooks;
  const t = text.second;
  return (
    <Panel
      dataUi="search.waiting.second"
      headline={secondLooksHeadline(looks)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.numbersColumns,
        rows: looks.map((l) => [text.reasons[l.reason], l.back, l.emailed, l.replied, l.signed]),
      }}
      meaning={secondLooksMeaning(looks)}
    >
      {looks.length === 0 ? (
        <p className="muted">{t.headlineNone}</p>
      ) : (
        <table className="ins-table">
          <thead>
            <tr>
              <th scope="col">{t.columns.left}</th>
              <th scope="col" className="num">
                {t.columns.back}
              </th>
              <th scope="col" className="num">
                {t.columns.emailed}
              </th>
              <th scope="col" className="num">
                {t.columns.replied}
              </th>
              <th scope="col" className="num">
                {t.columns.signed}
              </th>
            </tr>
          </thead>
          <tbody>
            {looks.map((l) => (
              <tr key={l.reason}>
                <td>
                  <button
                    type="button"
                    className="srch-link strong"
                    aria-label={t.open(text.reasons[l.reason])}
                    onClick={() => {
                      onDrill({ kind: "secondLook", reason: l.reason });
                    }}
                  >
                    {text.reasons[l.reason]}
                  </button>
                </td>
                <td className="num">{fmt(l.back)}</td>
                <td className={l.emailed === 0 ? "num muted" : "num"}>{fmt(l.emailed)}</td>
                <td className={l.replied === 0 ? "num muted" : "num"}>{fmt(l.replied)}</td>
                <td className={l.signed === 0 ? "num muted" : "num"}>{fmt(l.signed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Archive panels (also used by Everything)

function ArchiveSearch({ onGo }: { readonly onGo: (go: InsightsGo) => void }) {
  const [query, setQuery] = useState("");
  const t = text.archiveSearch;
  return (
    <Panel
      dataUi="search.archive.search"
      headline={t.headline}
      counted={t.counted}
      what={t.what}
      meaning={t.meaning}
    >
      <form
        className="srch-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          // Toolbox › Archive keeps its search text in its own state; a route cannot carry it.
          onGo({ kind: "route", screen: "toolbox", tab: "archive" });
        }}
      >
        <input
          type="search"
          className="srch-input"
          aria-label={t.label}
          placeholder={t.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <button type="submit" className="btn pri sm">
          {t.go}
        </button>
      </form>
    </Panel>
  );
}

function WeeksPanel({
  report,
  dataUi,
}: {
  readonly report: SearchReport;
  readonly dataUi: string;
}) {
  const weeks = report.weeks;
  const t = text.weeks;
  const first = weeks[0]?.at;
  const last = weeks[weeks.length - 1]?.at;
  const xLabels =
    first === undefined || last === undefined || first === last
      ? undefined
      : [
          { at: first, label: dayLabel(first) },
          { at: last, label: dayLabel(last) },
        ];
  const series = [
    { key: "live", tone: "series-live" },
    { key: "waiting", tone: "series-waiting" },
    { key: "archive", tone: "series-archive" },
  ] as const;
  return (
    <Panel
      dataUi={dataUi}
      headline={weeksHeadline(weeks)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: weeks.map((w) => [dayLabel(w.at), w.live ?? "—", w.waiting ?? "—", w.archive ?? "—"]),
      }}
      meaning={`${t.meaning} ${t.ownScale}`}
    >
      <SmallMultiples
        items={series.map((s) => {
          const value = lastKnown(weeks, s.key);
          return {
            key: s.key,
            title: t.titles[s.key],
            value: value === null ? "—" : fmt(value),
            change: changeText(weeks, s.key),
            points: weekPoints(weeks, s.key),
            tone: s.tone,
            ...(xLabels === undefined ? {} : { xLabels }),
            ariaLabel: t.aria(t.titles[s.key]),
          };
        })}
      />
    </Panel>
  );
}

function StackShare({ row }: { readonly row: KeywordRow }) {
  const r = row.lastRun;
  if (r === null) return null;
  const total = r.fresh + r.live + r.archived;
  if (total === 0) return null;
  const t = text.refind;
  const label = t.shares(pct(r.fresh / total), pct(r.live / total), pct(r.archived / total));
  return (
    <span className="srch-stack" role="img" aria-label={t.aria(row.keyword, label)}>
      <i
        style={{ width: `${String((r.fresh / total) * 100)}%`, background: "var(--series-live)" }}
      />
      <i
        style={{ width: `${String((r.live / total) * 100)}%`, background: "var(--series-neutral)" }}
      />
      <i
        style={{
          width: `${String((r.archived / total) * 100)}%`,
          background: "var(--series-archive)",
        }}
      />
    </span>
  );
}

function Refind({
  report,
  onGo,
}: {
  readonly report: SearchReport;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const t = text.refind;
  const rows = report.keywords
    .filter((k) => k.lastRun !== null)
    .sort((a, b) => (knownShare(b) ?? 0) - (knownShare(a) ?? 0))
    .slice(0, 8);
  return (
    <Panel
      dataUi="search.archive.refind"
      headline={refindHeadline(report.keywords)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: rows.map((k) => [
          k.keyword,
          k.lastRun?.fresh ?? 0,
          k.lastRun?.live ?? 0,
          k.lastRun?.archived ?? 0,
        ]),
      }}
      meaning={t.meaning}
      actions={
        <Btn
          kind="ghost"
          size="sm"
          onClick={() => {
            onGo({ kind: "route", screen: "find", tab: "search" });
          }}
        >
          {t.ideas}
        </Btn>
      }
    >
      {rows.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <ul className="srch-refind">
          {rows.map((k) => {
            const r = k.lastRun;
            const total = r === null ? 0 : r.fresh + r.live + r.archived;
            return (
              <li key={k.keyword}>
                <span className="strong">{k.keyword}</span>
                <StackShare row={k} />
                <span className="muted num">
                  {r === null || total === 0 ? "" : `${pct(r.archived / total)} ${t.archived}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function WhyArchived({ report }: { readonly report: SearchReport }) {
  const a = report.archive;
  const t = text.whyArchived;
  const rules = [...a.ruleLabels].sort((x, y) => y.count - x.count);
  const person = [...a.personReasons].sort((x, y) => y.count - x.count);
  return (
    <Panel
      dataUi="search.archive.why"
      headline={archivedWhyHeadline(report)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: [
          ...rules.map((r): (string | number)[] => [t.rules, ruleLabel(r.label), r.count]),
          ...person.map((r): (string | number)[] => [t.person, text.reasons[r.reason], r.count]),
        ],
      }}
      meaning={t.meaning(fmt(a.byRules), fmt(a.byPerson))}
    >
      {rules.length === 0 && person.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <div className="srch-two">
          <div>
            <h3 className="srch-sub">{t.rules}</h3>
            <BarList
              ariaLabel={t.aria.rules}
              tone="series-rules"
              rows={rules.map((r) => ({
                key: r.label,
                label: ruleLabel(r.label),
                value: r.count,
                display: fmt(r.count),
              }))}
            />
          </div>
          <div>
            <h3 className="srch-sub">{t.person}</h3>
            <BarList
              ariaLabel={t.aria.person}
              tone="series-archive"
              rows={person.map((r) => ({
                key: r.reason,
                label: text.reasons[r.reason],
                value: r.count,
                display: fmt(r.count),
              }))}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function profileCell(p: GroupProfile | null, row: keyof typeof text.profile.rows): string {
  const t = text.profile;
  if (p === null) return t.notKnown;
  switch (row) {
    case "medianViews":
      return p.medianViews === null ? t.notKnown : compact(p.medianViews);
    case "uploads30":
      return p.uploads30 === null ? t.notKnown : fmt(p.uploads30);
    case "subscribers":
      return p.subscribers === null ? t.notKnown : compact(p.subscribers);
    case "sponsored":
    case "inMarkets":
    case "addressFound": {
      const r = p[row];
      return r === null || r.d === 0 ? t.notKnown : t.share(pct(r.n / r.d), fmt(r.n), fmt(r.d));
    }
  }
}

function Profile({
  profiles,
  dataUi,
}: {
  readonly profiles: readonly GroupProfile[];
  readonly dataUi: string;
}) {
  const t = text.profile;
  const groups = ["live", "waiting", "person", "rules"] as const;
  const rowKeys = Object.keys(t.rows) as (keyof typeof t.rows)[];
  return (
    <Panel
      dataUi={dataUi}
      headline={profileHeadline(profiles)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: [
          t.columns.measure,
          t.columns.live,
          t.columns.waiting,
          t.columns.person,
          t.columns.rules,
        ],
        rows: rowKeys.map((k) => [
          t.rows[k],
          ...groups.map((g) => profileCell(profileOf(profiles, g), k)),
        ]),
      }}
      meaning={profileMeaning(profiles)}
    >
      <div className="ins-table-wrap">
        <table className="ins-table srch-profile">
          <thead>
            <tr>
              <th scope="col">{t.columns.measure}</th>
              {groups.map((g) => (
                <th key={g} scope="col" className="num">
                  {t.columns[g]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((k) => (
              <tr key={k}>
                <th scope="row">{t.rows[k]}</th>
                {groups.map((g) => {
                  const cell = profileCell(profileOf(profiles, g), k);
                  return (
                    <td key={g} className={cell === t.notKnown ? "num muted" : "num"}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// The tab

/** The Search tab: the hero (flow band and view switch), then the panels of the chosen view. */
export function SearchTab(props: SearchTabProps) {
  const { report, view, onGo, onDrill, onRestore } = props;
  if (report.counts.everything === 0) {
    return (
      <div className="srch" data-ui="search.tab" data-view={view}>
        <div className="card">
          <Empty icon="chart" title={text.emptyTitle}>
            {text.emptyBody}
          </Empty>
        </div>
      </div>
    );
  }
  let panels: ReactNode;
  switch (view) {
    case "live":
      panels = (
        <>
          <div className="srch-pair">
            <JoinLeave report={report} />
            <Backlog report={report} onGo={onGo} />
          </div>
          <KeywordScorecard
            keywords={report.keywords}
            onDrill={onDrill}
            dataUi="search.live.keywords"
          />
          <div className="srch-pair">
            <Addresses report={report} onGo={onGo} />
            <Trust report={report} onDrill={onDrill} />
          </div>
        </>
      );
      break;
    case "waiting":
      panels = (
        <>
          <Mistakes report={report} onDrill={onDrill} onRestore={onRestore} />
          <div className="srch-pair">
            <Reasons report={report} />
            <SecondLooks report={report} onDrill={onDrill} />
          </div>
        </>
      );
      break;
    case "archive":
      panels = (
        <>
          <ArchiveSearch onGo={onGo} />
          <WeeksPanel report={report} dataUi="search.archive.weeks" />
          <Refind report={report} onGo={onGo} />
          <WhyArchived report={report} />
          <Profile profiles={report.archive.profiles} dataUi="search.archive.profile" />
        </>
      );
      break;
    case "everything":
      panels = (
        <>
          <WeeksPanel report={report} dataUi="search.everything.weeks" />
          <KeywordScorecard
            keywords={report.keywords}
            onDrill={onDrill}
            dataUi="search.everything.keywords"
          />
          <Profile profiles={report.archive.profiles} dataUi="search.everything.profile" />
        </>
      );
      break;
  }
  return (
    <div className="srch" data-ui="search.tab" data-view={view}>
      <Hero {...props} />
      {panels}
    </div>
  );
}
