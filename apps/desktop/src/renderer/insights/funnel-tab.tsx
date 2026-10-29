import { Btn, Empty, Seg } from "@gratovo/ui";
import type { Drill, FunnelReport, FunnelRow, InsightsGo } from "@gratovo/core/insights";
import { useState } from "react";

import { strings } from "../strings";
import { BarList, ShareBar } from "./charts/bars";
import { HeatTable } from "./charts/heat-table";
import { Panel } from "./panel";
import { DifferenceTag } from "./verdict";
import {
  alsoLine,
  biggestDropSentence,
  cohortCells,
  cohortHeadline,
  cohortMeaning,
  dayRows,
  daysHeadline,
  exitLists,
  exitsHeadline,
  funnelHeadline,
  funnelIsEmpty,
  longestWait,
  shareText,
  stepName,
  usualText,
} from "./words/funnel";
import { dayLabel, num, pct, ratioPct } from "./words/format";
import "./tabs.css";

const t = strings.insights.funnel;
const fmt = strings.insights.overview.fmt;

/** What `FunnelTab` takes. */
export interface FunnelTabProps {
  readonly report: FunnelReport;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
  /** Brands come with deals (P8b); until then the switch has no Brands. */
  readonly showBrands: boolean;
}

type Who = "creators" | "brands";
type View = "everyone" | "cohort";

function FunnelTable({
  rows,
  biggest,
  onDrill,
}: {
  readonly rows: readonly FunnelRow[];
  readonly biggest: FunnelReport["biggestDrop"];
  readonly onDrill: (drill: Drill) => void;
}) {
  const h = t.table.columns;
  return (
    <div className="ins-table-wrap">
      <table className="ins-funnel" aria-label={t.table.label}>
        <thead>
          <tr>
            <th scope="col">{h[0]}</th>
            <th scope="col" className="num">
              {h[1]}
            </th>
            <th scope="col">{h[2]}</th>
            <th scope="col" className="num">
              {h[3]}
            </th>
            <th scope="col" className="num">
              {h[4]}
            </th>
            <th scope="col" className="num">
              {h[5]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isBiggest = row.step === biggest;
            const tone = isBiggest ? "warn" : row.byDesign ? "series-archive" : "series-live";
            const name = stepName(row.step);
            return (
              <tr
                key={row.step}
                className={isBiggest ? "is-click is-biggest" : "is-click"}
                data-ui={`insights.funnel.row.${row.step}`}
                onClick={() => {
                  onDrill({ kind: "step", step: row.step });
                }}
              >
                <td className="step">
                  <button type="button" className="ins-step-btn" aria-label={t.table.rowOpen(name)}>
                    {name}
                    {row.byDesign ? <span className="ins-tag">{t.table.byDesign}</span> : null}
                    {isBiggest ? <span className="ins-tag warn">{t.table.biggest}</span> : null}
                  </button>
                </td>
                <td className="num">{num(row.count)}</td>
                <td className="bar">
                  {row.fromPrev === null ? (
                    <span className="ins-quiet">{t.table.start}</span>
                  ) : (
                    <div className="bar-cell">
                      <ShareBar
                        n={row.fromPrev.n}
                        d={row.fromPrev.d}
                        tone={tone}
                        ariaLabel={`${shareText(row)}, ${num(row.fromPrev.n)} of ${num(row.fromPrev.d)}`}
                      />
                      <span>{shareText(row)}</span>
                    </div>
                  )}
                </td>
                <td className="num ins-quiet">
                  {row.before === null ? fmt.dash : ratioPct(row.before)}
                </td>
                <td className="num">{usualText(row.medianDays)}</td>
                <td className="num">
                  {row.stuck === null ? (
                    <span className="ins-quiet">{fmt.dash}</span>
                  ) : row.stuck === 0 ? (
                    <span className="ins-quiet">0</span>
                  ) : (
                    <button
                      type="button"
                      className="ins-stuck"
                      aria-label={t.table.stuckOpen(num(row.stuck), name)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDrill({ kind: "stuck", step: row.step });
                      }}
                    >
                      {num(row.stuck)}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExitsPanel({ exits }: { readonly exits: FunnelReport["exits"] }) {
  const lists = exitLists(exits);
  return (
    <Panel
      dataUi="insights.funnel.exits"
      headline={exitsHeadline(exits)}
      counted={t.exits.counted}
      what={t.what.exits}
      numbers={{
        columns: t.exits.columns,
        rows: lists.flatMap((l) => l.rows.map((r) => [l.title, r.label, r.count])),
      }}
      meaning={t.exits.meaning}
    >
      <div className="ins-exits">
        {lists.map((list) => (
          <div key={list.key} data-ui={`insights.funnel.exit.${list.key}`}>
            <div className="ins-exit-head">
              <span>{list.title}</span>
              <span>{num(list.total)}</span>
            </div>
            {list.total === 0 ? (
              <p className="ins-quiet">{fmt.none}</p>
            ) : (
              <BarList
                ariaLabel={list.title}
                tone="series-neutral"
                rows={list.rows.map((r, i) => ({
                  key: r.key,
                  label: r.label,
                  value: r.count,
                  display: num(r.count),
                  ...(i === 0 && list.rows.length > 1 ? { tone: "warn" as const } : {}),
                }))}
              />
            )}
          </div>
        ))}
      </div>
      <p className="ins-also">{alsoLine(exits)}</p>
    </Panel>
  );
}

function DaysPanel({ stepDays }: { readonly stepDays: FunnelReport["stepDays"] }) {
  const rows = dayRows(stepDays);
  const longest = longestWait(stepDays);
  const longestKey = longest === null ? null : `${longest.from}-${longest.to}`;
  const known = rows.filter((r) => r.days !== null).length;
  return (
    <Panel
      dataUi="insights.funnel.days"
      headline={daysHeadline(stepDays)}
      counted={t.days.counted}
      what={t.what.days}
      numbers={{
        columns: t.days.columns,
        rows: stepDays.map((s) => [stepName(s.from), stepName(s.to), usualText(s.days)]),
      }}
      meaning={t.days.meaning}
    >
      <BarList
        ariaLabel={t.days.counted}
        rows={rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.days ?? 0,
          display: r.days === null ? t.days.unknown : usualText(r.days),
          ...(r.key === longestKey && known > 1 ? { tone: "warn" as const } : {}),
        }))}
      />
    </Panel>
  );
}

function CohortsPanel({ report }: { readonly report: FunnelReport }) {
  const [shown, setShown] = useState(false);
  const c = t.cohorts;
  return (
    <Panel
      dataUi="insights.funnel.cohorts"
      headline={cohortHeadline(report.cohortTrend)}
      counted={c.counted}
      what={t.what.cohorts}
      numbers={{
        columns: c.columns,
        rows: report.cohorts.map((r) => [
          dayLabel(r.week),
          r.emailed,
          ...r.by.map((b) =>
            b === null ? fmt.dash : `${ratioPct(b)}, ${num(b.n)} of ${num(b.d)}`,
          ),
        ]),
      }}
      meaning={
        <>
          <DifferenceTag difference={report.cohortTrend} /> {cohortMeaning(report.cohortTrend)}
        </>
      }
    >
      <Btn
        kind="ghost"
        size="sm"
        icon={shown ? "chevU" : "chevD"}
        expanded={shown}
        onClick={() => {
          setShown((v) => !v);
        }}
      >
        {shown ? c.hide : c.show}
      </Btn>
      {shown ? (
        <HeatTable
          ariaLabel={c.counted}
          cornerLabel={c.corner}
          rowLabels={report.cohorts.map((r) => c.week(dayLabel(r.week), num(r.emailed)))}
          colLabels={[3, 7, 14, 30].map((d) => c.day(String(d)))}
          cells={cohortCells(report.cohorts)}
          format={(v) => pct(v)}
        />
      ) : null}
    </Panel>
  );
}

/** The Funnel: where do creators drop out, and where are they stuck? (design 3.2). */
export function FunnelTab({ report, onDrill, showBrands }: FunnelTabProps) {
  const [who, setWho] = useState<Who>("creators");
  const [view, setView] = useState<View>("everyone");
  if (funnelIsEmpty(report)) {
    return (
      <div className="card" data-ui="insights.funnel.empty">
        <Empty icon="chart" title={t.empty.title}>
          {t.empty.body}
        </Empty>
      </div>
    );
  }
  const rows = view === "everyone" ? report.everyone : report.cohort;
  const brandsPicked = showBrands && who === "brands";
  return (
    <>
      <div className="ins-switches">
        {showBrands ? (
          <Seg
            label={t.switchLabel}
            value={who}
            options={[
              { value: "creators", label: t.creators },
              { value: "brands", label: t.brands },
            ]}
            onPick={(value) => {
              setWho(value === "brands" ? "brands" : "creators");
            }}
          />
        ) : null}
        {brandsPicked ? null : (
          <Seg
            label={t.viewLabel}
            value={view}
            options={[
              { value: "everyone", label: t.everyone },
              { value: "cohort", label: t.cohort },
            ]}
            onPick={(value) => {
              setView(value === "cohort" ? "cohort" : "everyone");
            }}
          />
        )}
      </div>
      {brandsPicked ? (
        <section className="ins-panel" data-ui="insights.funnel.brands">
          <p className="ins-note">{t.brandsComes}</p>
        </section>
      ) : (
        <>
          <Panel
            dataUi="insights.funnel.table"
            hero
            headline={funnelHeadline(rows, report.biggestDrop)}
            counted={view === "everyone" ? t.headline.counted : t.headline.countedCohort}
            what={t.what.table}
            numbers={{
              columns: t.table.columns,
              rows: rows.map((r) => [
                stepName(r.step),
                r.count,
                r.fromPrev === null ? t.table.start : shareText(r),
                r.before === null ? fmt.dash : ratioPct(r.before),
                usualText(r.medianDays),
                r.stuck ?? fmt.dash,
              ]),
            }}
            meaning={biggestDropSentence(rows, report.biggestDrop)}
          >
            <FunnelTable rows={rows} biggest={report.biggestDrop} onDrill={onDrill} />
          </Panel>
          <ExitsPanel exits={report.exits} />
          <div className="ins-two">
            <DaysPanel stepDays={report.stepDays} />
            <CohortsPanel report={report} />
          </div>
        </>
      )}
    </>
  );
}
