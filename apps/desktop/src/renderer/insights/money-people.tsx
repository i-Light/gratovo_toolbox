import { useState } from "react";
import { Btn } from "@gratovo/ui";
import { thresholds } from "@gratovo/core/insights";
import type { InsightsGo } from "@gratovo/core/insights";
import { DEAL_FLOW } from "@gratovo/core";

import { money } from "../lib/format";
import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { BarList, ShareBar } from "./charts/bars";
import type { MoneyPartProps } from "./money-parts";
import { Panel } from "./panel";
import { decimal, num, pct } from "./words/format";
import {
  dealStepName,
  lastDealText,
  repeatHeadline,
  repeatSentence,
  rosterHeadline,
  rosterMeaning,
  stepsHeadline,
  stepsMeaning,
} from "./words/money";
import "./money.css";

const t = strings.insights.money;
const fmt = strings.insights.overview.fmt;

const toPitch: InsightsGo = { kind: "route", screen: "close", tab: "pitch" };
const toDealBoard: InsightsGo = { kind: "route", screen: "deliver", tab: "board" };
/** The bar for views at 30 days runs to 140% of the creator's usual, so a normal 100% is not full. */
const viewsTrack = 1.4;
/** The roster shows its top earners and every idle creator; the rest wait behind Show all. */
const rosterTop = 10;

export function RosterPanel({ report, names, onGo, onOpen }: MoneyPartProps) {
  const r = t.roster;
  const rows = report.roster;
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.filter((row, i) => i < rosterTop || row.idle);
  const more = shown.length < rows.length || all;
  return (
    <Panel
      dataUi="insights.money.roster"
      headline={rosterHeadline(report, names)}
      counted={r.counted(num(thresholds.idleDays))}
      what={t.what.roster}
      numbers={{
        columns: [...r.columns],
        rows: rows.map((row) => [
          names.creator(row.creatorId),
          row.deals,
          row.deals === 0 ? fmt.dash : money(row.revenue),
          lastDealText(row),
          row.delivered === null ? fmt.dash : pct(row.delivered),
        ]),
      }}
      meaning={rosterMeaning(report, names)}
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
                {all ? r.showLess : r.showAll(num(rows.length))}
              </Btn>
            ),
          }
        : {})}
    >
      {rows.length === 0 ? null : (
        <div className="ins-table-wrap">
          <table className="ins-table money-roster" aria-label={r.label}>
            <thead>
              <tr>
                <th scope="col">{r.columns[0]}</th>
                <th scope="col" className="num">
                  {r.columns[1]}
                </th>
                <th scope="col" className="num">
                  {r.columns[2]}
                </th>
                <th scope="col" className="num">
                  {r.columns[3]}
                </th>
                <th scope="col">{r.columns[4]}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const name = names.creator(row.creatorId);
                const low = row.delivered !== null && row.delivered < 0.8;
                return (
                  <tr key={row.creatorId} data-ui="insights.money.creator">
                    <th scope="row">
                      <button
                        type="button"
                        className="money-link"
                        aria-label={r.open(name)}
                        onClick={() => {
                          onOpen({ kind: "creator", id: row.creatorId });
                        }}
                      >
                        {name}
                      </button>
                    </th>
                    <td className="num">{num(row.deals)}</td>
                    <td className="num strong">
                      {row.deals === 0 ? fmt.dash : money(row.revenue)}
                    </td>
                    <td className="num">{lastDealText(row)}</td>
                    <td>
                      {row.delivered === null ? (
                        <span className="muted">{fmt.dash}</span>
                      ) : (
                        <span className="money-views">
                          <ShareBar
                            n={row.delivered}
                            d={viewsTrack}
                            tone={low ? "warn" : "series-live"}
                            ariaLabel={r.deliveredLabel(pct(row.delivered))}
                          />
                          <span className="num">{pct(row.delivered)}</span>
                        </span>
                      )}
                    </td>
                    <td className="money-end">
                      {row.idle ? (
                        <div className="money-end-box">
                          <span className="ins-verdict dot watch">
                            <i aria-hidden="true" />
                            {r.idle}
                          </span>
                          <Btn
                            size="sm"
                            label={r.pitchLabel(name)}
                            onClick={() => {
                              onGo(toPitch);
                            }}
                          >
                            {r.pitch}
                          </Btn>
                        </div>
                      ) : null}
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

export function StepsPanel({ report, onDrill }: Pick<MoneyPartProps, "report" | "onDrill">) {
  const s = t.steps;
  const stuckAt = new Set(report.stuckDeals.map((d) => d.step));
  const stuck = report.stuckDeals.length;
  return (
    <Panel
      dataUi="insights.money.steps"
      headline={stepsHeadline(report)}
      counted={s.counted}
      what={t.what.steps}
      numbers={{
        columns: s.columns,
        rows: report.steps.map((x) => [
          dealStepName(x.step),
          x.medianDays === null ? fmt.dash : decimal(x.medianDays),
          x.stuck,
        ]),
      }}
      meaning={stepsMeaning(report)}
      {...(stuck > 0
        ? {
            actions: (
              <Btn
                kind="ghost"
                size="sm"
                onClick={() => {
                  onDrill({ kind: "stuckDeals", step: null });
                }}
              >
                {s.open(num(stuck))}
              </Btn>
            ),
          }
        : {})}
    >
      <BarList
        ariaLabel={s.label}
        rows={report.steps.map((x) => ({
          key: String(x.step),
          label: DEAL_FLOW[x.step]?.name ?? fmt.dash,
          value: x.medianDays ?? 0,
          display: x.medianDays === null ? fmt.dash : fmt.daysShort(decimal(x.medianDays)),
          ...(stuckAt.has(x.step) ? { tone: "warn" as const } : {}),
          ...(x.stuck > 0
            ? {
                onClick: () => {
                  onDrill({ kind: "stuckDeals", step: x.step });
                },
              }
            : {}),
        }))}
      />
    </Panel>
  );
}

export function RepeatPanel({ report, names, onGo, onDrill }: MoneyPartProps) {
  const p = t.repeat;
  const { n, d } = report.repeat.came;
  const noNext = report.repeat.noNext.length;
  return (
    <Panel
      dataUi="insights.money.repeat"
      headline={repeatHeadline(report)}
      counted={p.counted}
      what={t.what.repeat}
      numbers={{
        columns: p.columns,
        rows: [
          [p.withDeal, d],
          [p.cameBack, n],
        ],
      }}
      actions={
        <>
          {noNext > 1 ? (
            <Btn
              kind="ghost"
              size="sm"
              onClick={() => {
                onDrill({ kind: "noNextDeal" });
              }}
            >
              {p.open(num(noNext))}
            </Btn>
          ) : null}
          <Btn
            size="sm"
            onClick={() => {
              onGo(toDealBoard);
            }}
          >
            {p.propose}
          </Btn>
        </>
      }
    >
      {d === 0 ? null : (
        <>
          <BigNumber value={pct(n / d)} size="lg" />
          <p className="money-sentence">{repeatSentence(report, names)}</p>
        </>
      )}
    </Panel>
  );
}
