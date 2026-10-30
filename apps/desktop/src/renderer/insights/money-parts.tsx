import { Btn } from "@gratovo/ui";
import type { Drill, InsightsGo, MoneyReport, Verdict } from "@gratovo/core/insights";
import type { ReactNode } from "react";

import { money } from "../lib/format";
import type { RecordRef } from "../lib/routes";
import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { BarList } from "./charts/bars";
import { MonthBars } from "./charts/month-bars";
import { Panel } from "./panel";
import { moneyShort, monthName, monthShort, num, pct } from "./words/format";
import {
  basketHeadline,
  basketSentence,
  goalLabel,
  lateTotals,
  marginHeadline,
  owedHeadline,
  payDaysSentence,
  payoutWords,
  revenueHeadline,
  revenueSummary,
  sizeHeadline,
  sizeSentence,
} from "./words/money";
import type { Names } from "./words/names";
import "./money.css";

const t = strings.insights.money;
const fmt = strings.insights.overview.fmt;

/** What every Money panel takes. */
export interface MoneyPartProps {
  readonly report: MoneyReport;
  readonly names: Names;
  readonly onGo: (go: InsightsGo) => void;
  readonly onDrill: (drill: Drill) => void;
  readonly onOpen: (record: RecordRef) => void;
}

const toDeliverMoney: InsightsGo = { kind: "route", screen: "deliver", tab: "money" };

/** A dot and a word, in the watch colour, for a short warning inside a panel. */
function WatchNote({ children }: { readonly children: ReactNode }) {
  return (
    <span className="ins-verdict dot watch">
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** A button that looks like a line of text and opens a record. */
function RecordLine({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className="money-row" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function RevenuePanel({ report }: Pick<MoneyPartProps, "report">) {
  const rev = t.revenue;
  const goal = goalLabel(report);
  const bars = report.months.map((m) => ({
    key: String(m.month),
    label: monthShort(m.month),
    value: m.paid,
    display: moneyShort(m.paid),
    projected: m.projected,
  }));
  return (
    <Panel
      dataUi="insights.money.revenue"
      hero
      headline={revenueHeadline(report)}
      counted={rev.counted}
      what={t.what.revenue}
      numbers={{
        columns: rev.columns,
        rows: report.months.map((m) => [
          monthName(m.month),
          money(m.paid),
          money(m.net),
          m.projected === null ? fmt.dash : money(m.projected),
        ]),
      }}
      meaning={revenueSummary(report).map((run, i) =>
        run.bold === true ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>,
      )}
    >
      <MonthBars
        bars={bars}
        height={220}
        goal={
          report.goalPaid === null || goal === null ? null : { value: report.goalPaid, label: goal }
        }
        yFormat={moneyShort}
        ariaLabel={rev.label}
        barLabel={(b) =>
          rev.barLabel(
            monthName(Number(b.key)),
            money(b.value),
            b.key === bars[bars.length - 1]?.key,
          )
        }
      />
    </Panel>
  );
}

export function OwedPanel({ report, names, onDrill, onOpen }: MoneyPartProps) {
  const o = t.owed;
  const tones = { notDue: "series-live", late30: "warn", late60: "crit", over60: "crit" } as const;
  const { late } = lateTotals(report);
  const lateCount = report.owed.buckets
    .filter((b) => b.bucket !== "notDue")
    .reduce((a, b) => a + b.count, 0);
  return (
    <Panel
      dataUi="insights.money.owed"
      headline={owedHeadline(report)}
      counted={o.counted}
      verdict={report.owed.verdict}
      what={t.what.owed}
      numbers={{
        columns: o.columns,
        rows: report.owed.buckets.map((b) => [o.buckets[b.bucket], b.count, money(b.amount)]),
      }}
      meaning={payDaysSentence(report, names)}
      {...(late > 0
        ? {
            actions: (
              <Btn
                kind="ghost"
                size="sm"
                icon="arrowR"
                onClick={() => {
                  onDrill({ kind: "lateInvoices" });
                }}
              >
                {o.open(num(lateCount))}
              </Btn>
            ),
          }
        : {})}
    >
      <BarList
        ariaLabel={o.label}
        rows={report.owed.buckets.map((b) => ({
          key: b.bucket,
          label: o.buckets[b.bucket],
          value: b.amount,
          display: money(b.amount),
          tone: tones[b.bucket],
        }))}
      />
      {report.owed.late.length === 0 ? null : (
        <ul className="money-rows" aria-label={o.listLabel}>
          {report.owed.late.map((l) => {
            const deal = names.deal(l.dealId);
            return (
              <li key={l.dealId} data-ui="insights.money.late">
                <RecordLine
                  label={o.rowOpen(deal)}
                  onClick={() => {
                    onOpen({ kind: "deal", id: l.dealId });
                  }}
                >
                  <span>{o.row(deal, fmt.daysLong(num(l.daysLate)))}</span>
                  <span className="money-amount">{money(l.amount)}</span>
                </RecordLine>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function PayoutsPanel({ report, names, onGo, onDrill }: MoneyPartProps) {
  const p = t.payouts;
  const words = payoutWords(report, names);
  const due = report.payouts.due.length;
  return (
    <Panel
      dataUi="insights.money.payouts"
      headline={words.headline}
      counted={p.counted}
      what={t.what.payouts}
      numbers={{
        columns: p.columns,
        rows: [
          [p.dueNow, money(report.payouts.dueTotal), due],
          [p.locked, money(report.payouts.locked), report.payouts.lockedCount],
        ],
      }}
      meaning={p.meaning}
      actions={
        <>
          {due > 1 ? (
            <Btn
              kind="ghost"
              size="sm"
              onClick={() => {
                onDrill({ kind: "payoutsDue" });
              }}
            >
              {p.open(num(due))}
            </Btn>
          ) : null}
          {due === 0 ? null : (
            <Btn
              kind="pri"
              size="sm"
              onClick={() => {
                onGo(toDeliverMoney);
              }}
            >
              {words.creator === null ? p.payMany : p.pay(words.creator)}
            </Btn>
          )}
        </>
      }
    >
      <div className="money-stats" role="group" aria-label={p.label}>
        <div className="money-stat">
          <span className="money-stat-label">{p.dueNow}</span>
          <BigNumber value={money(report.payouts.dueTotal)} />
          <span className="muted">{words.context}</span>
        </div>
        <div className="money-stat">
          <span className="money-stat-label">{p.locked}</span>
          <BigNumber value={money(report.payouts.locked)} />
          <span className="muted">{p.lockedContext(num(report.payouts.lockedCount))}</span>
        </div>
      </div>
    </Panel>
  );
}

function verdictOf(v: Verdict): Verdict | undefined {
  return v === "early" ? undefined : v;
}

export function MarginPanel({ report, names, onDrill, onOpen }: MoneyPartProps) {
  const m = t.margin;
  const under = report.margin.under;
  return (
    <Panel
      dataUi="insights.money.margin"
      headline={marginHeadline(report)}
      counted={m.counted(pct(report.margin.floor))}
      what={t.what.margin}
      numbers={{
        columns: m.columns,
        rows: under.map((u) => [names.deal(u.dealId), pct(u.margin)]),
      }}
      {...(under.length > 0
        ? {
            actions: (
              <Btn
                kind="ghost"
                size="sm"
                onClick={() => {
                  onDrill({ kind: "underFloor" });
                }}
              >
                {m.open(num(under.length))}
              </Btn>
            ),
          }
        : {})}
    >
      {report.margin.average === null ? null : under.length === 0 ? (
        <p className="muted">{m.noneUnder}</p>
      ) : (
        <>
          <WatchNote>{m.under(num(under.length))}</WatchNote>
          <ul className="money-rows" aria-label={m.under(num(under.length))}>
            {under.slice(0, 3).map((u) => (
              <li key={u.dealId}>
                <RecordLine
                  label={t.owed.rowOpen(names.deal(u.dealId))}
                  onClick={() => {
                    onOpen({ kind: "deal", id: u.dealId });
                  }}
                >
                  {m.row(names.deal(u.dealId), pct(u.margin))}
                </RecordLine>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function SizePanel({ report }: Pick<MoneyPartProps, "report">) {
  const s = t.size;
  const avg = report.dealSize.average;
  return (
    <Panel
      dataUi="insights.money.size"
      headline={sizeHeadline(report)}
      counted={s.counted}
      what={t.what.size}
      numbers={{
        columns: s.columns,
        rows: report.dealSize.trend.map((p) => [
          monthName(p.at),
          p.value === null ? fmt.dash : money(p.value),
        ]),
      }}
    >
      {avg === null ? null : (
        <>
          <BigNumber value={money(avg)} size="lg" />
          <p className="money-sentence">{sizeSentence(report)}</p>
        </>
      )}
    </Panel>
  );
}

export function BasketPanel({ report, names, onOpen }: MoneyPartProps) {
  const b = t.basket;
  const brand = report.basket.brand;
  const creator = report.basket.creator;
  const tag = verdictOf(report.basket.verdict);
  return (
    <Panel
      dataUi="insights.money.basket"
      headline={basketHeadline(report)}
      counted={b.counted}
      {...(tag === undefined || brand === null ? {} : { verdict: tag })}
      what={t.what.basket}
      numbers={{
        columns: b.columns,
        rows: [
          ...(brand === null
            ? []
            : [[b.brandRow, `${names.brand(brand.id)}, ${pct(brand.share)}`]]),
          ...(creator === null
            ? []
            : [[b.creatorRow, `${names.creator(creator.id)}, ${pct(creator.share)}`]]),
        ],
      }}
      {...(brand === null
        ? {}
        : {
            actions: (
              <Btn
                kind="ghost"
                size="sm"
                onClick={() => {
                  onOpen({ kind: "brand", id: brand.id });
                }}
              >
                {b.open(names.brand(brand.id))}
              </Btn>
            ),
          })}
    >
      {brand === null ? null : <p className="money-sentence">{basketSentence(report, names)}</p>}
    </Panel>
  );
}
