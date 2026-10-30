import { Btn, Empty, IconBtn } from "@gratovo/ui";
import { rateOf } from "@gratovo/core/insights";
import type {
  AlertLine,
  Drill,
  InsightsGo,
  OverviewReport,
  Point,
  Verdict,
  WinLine,
} from "@gratovo/core/insights";
import { useState } from "react";
import type { ReactNode } from "react";

import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { ShareBar } from "./charts/bars";
import { LineChart } from "./charts/line-chart";
import { StepLine } from "./charts/step-line";
import { Panel } from "./panel";
import { DifferenceTag, VerdictTag } from "./verdict";
import { biggestDropSentence, shownRows } from "./words/funnel";
import { noNames } from "./words/names";
import type { Names } from "./words/names";
import { num, pct, ratioPct } from "./words/format";
import {
  alertWords,
  attentionCounted,
  attentionHeadline,
  emailsTile,
  fuelTile,
  overviewIsEmpty,
  pipelineHeadline,
  replyRateTile,
  revenueLabel,
  revenueTile,
  signedTile,
  summaryRuns,
  waitingTile,
  winsCounted,
  winsHeadline,
  winWords,
} from "./words/overview";
import type { TileWords } from "./words/overview";
import "./tabs.css";

const text = strings.insights;
const t = text.overview;
const shownAlerts = 6;

/** What `OverviewTab` takes. */
export interface OverviewTabProps {
  readonly report: OverviewReport;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
  /** Hide an alert for 7 days; the host stores the key. */
  readonly onHide: (key: string) => void;
  /** Show the revenue tile in place of "Replies waiting for us": money viewers, where it is wired. */
  readonly seesMoney: boolean;
  /** Whether First deal and First payout show in the pipeline: not on live before step 9 (B8). */
  readonly showDeals: boolean;
  /** Names of brands, creators and deals, for the money alerts. */
  readonly names?: Names;
}

interface VitalProps {
  readonly dataUi: string;
  readonly label: string;
  readonly verdict: Verdict;
  readonly words: TileWords;
  readonly what: string;
  readonly trend?: readonly Point[];
  readonly action?: { readonly label: string; readonly onClick: () => void };
  /** Something small under the lines, such as a progress bar. */
  readonly extra?: ReactNode;
}

/** One of the five tiles: label, mark, the big number, its lines and a small trend. */
function Vital({ dataUi, label, verdict, words, what, trend, action, extra }: VitalProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ins-vital" role="listitem" data-ui={dataUi}>
      <div className="ins-vital-head">
        <span>{label}</span>
        <IconBtn
          icon="info"
          label={`${text.whatIsThis} ${label}`}
          pressed={open}
          dataUi={`${dataUi}.what`}
          onClick={() => {
            setOpen((v) => !v);
          }}
        />
      </div>
      <BigNumber value={words.value} {...(words.unit === undefined ? {} : { unit: words.unit })} />
      <VerdictTag verdict={verdict} />
      <div className="ins-vital-lines">
        {words.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {extra}
      {open ? <p className="ins-vital-what">{what}</p> : null}
      {trend !== undefined && trend.length > 1 ? (
        <LineChart points={trend} height={40} yTickCount={0} lastIsPartial ariaLabel={label} />
      ) : null}
      {action === undefined ? null : (
        <div>
          <Btn kind="ghost" size="sm" onClick={action.onClick}>
            {action.label}
          </Btn>
        </div>
      )}
    </div>
  );
}

function AttentionPanel({
  lines,
  hidden,
  names,
  onGo,
  onHide,
}: {
  readonly lines: readonly AlertLine[];
  readonly names: Names;
  readonly hidden: number;
  readonly onGo: (go: InsightsGo) => void;
  readonly onHide: (key: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, shownAlerts);
  const more = lines.length > shownAlerts;
  const a = t.attention;
  const footer = hidden > 0 ? a.hidden(num(hidden)) : undefined;
  return (
    <Panel
      dataUi="insights.overview.attention"
      headline={attentionHeadline(lines)}
      counted={attentionCounted(shown.length, lines.length)}
      what={t.what.attention}
      numbers={{
        columns: a.tableColumns,
        rows: lines.map((l) => {
          const w = alertWords(l.alert, names);
          return [text.verdict[l.verdict], w.title, w.evidence];
        }),
      }}
      {...(footer === undefined ? {} : { meaning: footer })}
      {...(more
        ? {
            actions: (
              <Btn
                kind="ghost"
                size="sm"
                icon={all ? "chevU" : "chevD"}
                expanded={all}
                onClick={() => {
                  setAll((v) => !v);
                }}
              >
                {all ? a.showLess : a.showAll(num(lines.length))}
              </Btn>
            ),
          }
        : {})}
    >
      {lines.length === 0 ? null : (
        <ul className="ins-lines" aria-label={a.listLabel}>
          {shown.map((line) => {
            const w = alertWords(line.alert, names);
            return (
              <li key={line.key} className="ins-line" data-ui="insights.overview.alert">
                <div className="ins-line-main">
                  <div className="ins-line-title">
                    <VerdictTag verdict={line.verdict} />
                    <span>{w.title}</span>
                  </div>
                  <p>{w.why}</p>
                  <p className="ins-line-numbers">{w.evidence}</p>
                </div>
                <div className="ins-line-side">
                  <Btn
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      onGo(line.go);
                    }}
                  >
                    {w.action}
                  </Btn>
                  <IconBtn
                    icon="clock"
                    label={a.hideLabel(w.title)}
                    dataUi="insights.overview.hide"
                    onClick={() => {
                      onHide(line.key);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function WinsPanel({
  wins,
  names,
  onGo,
}: {
  readonly wins: readonly WinLine[];
  readonly names: Names;
  readonly onGo: (go: InsightsGo) => void;
}) {
  return (
    <Panel
      dataUi="insights.overview.wins"
      headline={winsHeadline(wins)}
      counted={winsCounted(wins)}
      what={t.what.wins}
      numbers={{
        columns: t.wins.tableColumns,
        rows: wins.map((w) => {
          const words = winWords(w.win, names);
          return [words.title, words.evidence];
        }),
      }}
    >
      {wins.length === 0 ? null : (
        <ul className="ins-lines" aria-label={t.wins.listLabel}>
          {wins.map((line) => {
            const w = winWords(line.win, names);
            const go = line.go;
            return (
              <li
                key={`${line.win.kind}-${w.title}`}
                className="ins-line"
                data-ui="insights.overview.win"
              >
                <div className="ins-line-main">
                  <div className="ins-line-title">
                    {line.result === "good" ? (
                      <VerdictTag verdict="good" />
                    ) : (
                      <DifferenceTag difference={line.result} />
                    )}
                    <span>{w.title}</span>
                  </div>
                  <p className="ins-line-numbers">{w.evidence}</p>
                  <p>{w.todo}</p>
                </div>
                {go === null ? null : (
                  <div className="ins-line-side">
                    <Btn
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        onGo(go);
                      }}
                    >
                      {w.action}
                    </Btn>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** The Overview: how are we doing, and what needs me? (design 3.1). */
export function OverviewTab({
  report,
  onGo,
  onDrill,
  onHide,
  seesMoney,
  showDeals,
  names = noNames,
}: OverviewTabProps) {
  if (overviewIsEmpty(report)) {
    return (
      <div className="card" data-ui="insights.overview.empty">
        <Empty icon="chart" title={t.empty.title}>
          {t.empty.body}
        </Empty>
      </div>
    );
  }
  const v = report.vitals;
  const revenue = seesMoney ? v.revenue : null;
  const funnel: InsightsGo = { kind: "insights", tab: "funnel", view: null };
  const rows = shownRows(report.pipeline, showDeals);
  const stepNames = t.pipeline.short;
  return (
    <>
      <section
        className="ins-panel"
        data-ui="insights.overview.summary"
        aria-label={t.summary.label}
      >
        <p className="ins-summary-text">
          {summaryRuns(report.summary, names).map((run, i) =>
            run.bold === true ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>,
          )}
        </p>
        <p className="ins-counted">{text.comparedWith[report.window.period]}</p>
      </section>

      <section
        className="ins-panel ins-vitals"
        data-ui="insights.overview.vitals"
        aria-label={t.vitals.label}
      >
        <div className="ins-vital-grid" role="list">
          <Vital
            dataUi="insights.overview.vital.emails"
            label={t.vitals.emails.label}
            verdict={v.emails.verdict}
            words={emailsTile(v.emails)}
            what={t.vitals.emails.what}
            trend={v.emails.trend}
          />
          <Vital
            dataUi="insights.overview.vital.replyRate"
            label={t.vitals.replyRate.label}
            verdict={v.replyRate.verdict}
            words={replyRateTile(v.replyRate)}
            what={t.vitals.replyRate.what}
            trend={v.replyRate.trend}
          />
          <Vital
            dataUi="insights.overview.vital.signed"
            label={t.vitals.signed.label}
            verdict={v.signedPer1000.verdict}
            words={signedTile(v.signedPer1000)}
            what={t.vitals.signed.what}
          />
          <Vital
            dataUi="insights.overview.vital.fuel"
            label={t.vitals.fuel.label}
            verdict={v.fuel.verdict}
            words={fuelTile(v.fuel)}
            what={t.vitals.fuel.what}
            {...(v.fuel.ready > 0
              ? {
                  action: {
                    label: t.vitals.fuel.open(num(v.fuel.ready)),
                    onClick: () => {
                      onDrill({ kind: "fuel" });
                    },
                  },
                }
              : {})}
          />
          {revenue === null ? (
            <Vital
              dataUi="insights.overview.vital.waiting"
              label={t.vitals.waiting.label}
              verdict={v.repliesWaiting.verdict}
              words={waitingTile(v.repliesWaiting, report.window.now)}
              what={t.vitals.waiting.what}
              {...(v.repliesWaiting.count > 0
                ? {
                    action: {
                      label: t.vitals.waiting.open(num(v.repliesWaiting.count)),
                      onClick: () => {
                        onDrill({ kind: "repliesWaiting" });
                      },
                    },
                  }
                : {})}
            />
          ) : (
            <Vital
              dataUi="insights.overview.vital.revenue"
              label={revenueLabel(revenue)}
              verdict={revenue.verdict}
              words={revenueTile(revenue)}
              what={t.revenue.what}
              action={{
                label: t.revenue.open,
                onClick: () => {
                  onGo({ kind: "insights", tab: "money", view: null });
                },
              }}
              {...(revenue.goal === null
                ? {}
                : {
                    extra: (
                      <ShareBar
                        n={revenue.paid}
                        d={revenue.goal}
                        ariaLabel={revenueLabel(revenue)}
                      />
                    ),
                  })}
            />
          )}
        </div>
      </section>

      <div className="ins-two wide">
        <AttentionPanel
          lines={report.attention}
          hidden={report.hidden}
          names={names}
          onGo={onGo}
          onHide={onHide}
        />
        <WinsPanel wins={report.wins} names={names} onGo={onGo} />
      </div>

      <Panel
        dataUi="insights.overview.pipeline"
        headline={pipelineHeadline(rows)}
        counted={t.pipeline.counted}
        what={t.what.pipeline}
        numbers={{
          columns: t.pipeline.tableColumns,
          rows: rows.map((r) => [
            strings.insights.funnel.steps[r.step],
            r.count,
            r.fromPrev === null ? text.funnel.table.start : ratioPct(r.fromPrev),
            r.stuck ?? t.fmt.dash,
          ]),
        }}
        meaning={biggestDropSentence(rows, report.biggestDrop)}
        actions={
          <Btn
            kind="ghost"
            size="sm"
            icon="arrowR"
            onClick={() => {
              onGo(funnel);
            }}
          >
            {t.pipeline.open}
          </Btn>
        }
      >
        <StepLine
          ariaLabel={t.pipeline.label}
          steps={rows.map((r) => ({
            key: r.step,
            label: stepNames[r.step],
            count: num(r.count),
            ...(r.stuck !== null && r.stuck > 0
              ? { sub: t.pipeline.stuck(num(r.stuck)), subTone: "warn" as const }
              : {}),
          }))}
          shares={rows.slice(1).map((r) => {
            const share = r.fromPrev === null ? null : rateOf(r.fromPrev);
            return share === null ? null : pct(share);
          })}
          onPick={() => {
            onGo(funnel);
          }}
        />
      </Panel>
    </>
  );
}
