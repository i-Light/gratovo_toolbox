import { Btn, Empty, Icon } from "@gratovo/ui";
import { workingDaysPerMonth } from "@gratovo/core/insights";
import type { GoalLine, GoalReport, GoalStep, InsightsGo, Lever } from "@gratovo/core/insights";
import { useState } from "react";

import { money } from "../lib/format";
import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { ShareBar } from "./charts/bars";
import { Panel } from "./panel";
import { VerdictDot } from "./verdict";
import {
  chainHeadline,
  chainMeaning,
  leverName,
  leverValue,
  leversHeadline,
  monthText,
  monthDoneText,
  perDayText,
  rateLine,
  rateText,
  roomHeadline,
  roomMeaning,
  roomVerdict,
  shortByText,
  sourceText,
  stepName,
  stepRoute,
} from "./words/goal";
import { fmt } from "./words/search";
import "./goal.css";

const text = strings.insights.goal;

/** What the goal input and the reset action send (the `insights:goal` request). */
export interface GoalPatch {
  readonly signsPerMonth?: number;
  /** Net revenue a month; null clears the money goal (money viewers only). */
  readonly revenuePerMonth?: number | null;
  readonly reset?: true;
}

/** What `GoalTab` takes. */
export interface GoalTabProps {
  readonly report: GoalReport;
  readonly onGoal: (patch: GoalPatch) => void;
  readonly onGo: (go: InsightsGo) => void;
  /** Show the money goal and the money lines: money viewers, where they are wired. */
  readonly showMoney?: boolean;
}

const minSigns = 1;
const maxSigns = 100;
const minRevenue = 100;
const maxRevenue = 10_000_000;

/** The net revenue goal: whole dollars a month, commits on Enter and on leaving; empty clears it. */
function MoneyGoalInput({
  value,
  onCommit,
}: {
  readonly value: number | null;
  readonly onCommit: (n: number | null) => void;
}) {
  const m = text.money;
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= minRevenue && n <= maxRevenue) {
      if (n !== value) onCommit(n);
      setDraft(String(n));
    } else {
      setDraft(value === null ? "" : String(value));
    }
  };
  return (
    <label className="goal-field">
      <span>{m.inputLabel}</span>
      <input
        type="number"
        inputMode="numeric"
        min={minRevenue}
        max={maxRevenue}
        step={1}
        className="goal-input"
        data-ui="goal.revenue"
        placeholder={m.placeholder}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      <small className="muted">{m.inputHelp}</small>
    </label>
  );
}

/** A figure the plan worked out, shown next to the goal: the usual deal price or margin. */
function Derived({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="goal-field goal-derived">
      <span>{label}</span>
      <b className="goal-value">{value}</b>
    </div>
  );
}

/** The creators-a-month input: commits on Enter and on leaving the field. */
function GoalInput({
  value,
  onCommit,
}: {
  readonly value: number;
  readonly onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isInteger(n) && n >= minSigns && n <= maxSigns) {
      if (n !== value) onCommit(n);
      setDraft(String(n));
    } else {
      setDraft(String(value));
    }
  };
  return (
    <label className="goal-field">
      <span>{text.inputLabel}</span>
      <input
        type="number"
        inputMode="numeric"
        min={minSigns}
        max={maxSigns}
        step={1}
        className="goal-input"
        data-ui="goal.signs"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      <small className="muted">{text.inputHelp}</small>
    </label>
  );
}

function LineVerdict({ line }: { readonly line: GoalLine }) {
  const short = shortByText(line);
  if (short === null) return <VerdictDot verdict={line.verdict} />;
  return (
    <span className={`ins-verdict dot ${line.verdict}`} data-verdict={line.verdict}>
      <i aria-hidden="true" />
      {short}
    </span>
  );
}

function DayCell({ line }: { readonly line: GoalLine }) {
  const c = text.chain;
  if (line.perDay === null || line.actualPerDay === null) {
    const done = monthDoneText(line);
    return <span className="muted">{done ?? c.monthOnly}</span>;
  }
  const needed = line.perDay;
  const done = line.actualPerDay;
  const track = Math.max(needed, done) * 1.3 || 1;
  const tone = line.verdict === "act" ? "crit" : line.verdict === "watch" ? "warn" : "series-live";
  return (
    <span className="goal-day">
      <ShareBar
        n={done}
        d={track}
        tone={tone}
        neededAt={needed / track}
        neededLabel={perDayText(needed)}
        ariaLabel={c.barLabel(perDayText(done), perDayText(needed))}
      />
      <span className="num">{c.dayOf(perDayText(done), perDayText(needed))}</span>
    </span>
  );
}

function Chain({
  report,
  onGoal,
  onGo,
}: {
  readonly report: GoalReport;
  readonly onGoal: (patch: GoalPatch) => void;
  readonly onGo: (go: InsightsGo) => void;
}) {
  const c = text.chain;
  const lines = report.lines;
  const short = report.shortStep;
  const route = short === null ? null : stepRoute(short);
  return (
    <Panel
      dataUi="goal.chain"
      headline={chainHeadline(report)}
      counted={c.counted}
      what={c.what}
      numbers={{
        columns: c.numbersColumns,
        rows: lines.map((l) => [
          stepName(l.step),
          monthText(l),
          rateLine(l),
          l.perDay === null ? "—" : perDayText(l.perDay),
          l.actualPerDay === null ? (monthDoneText(l) ?? "—") : perDayText(l.actualPerDay),
          shortByText(l) ?? strings.insights.verdict[l.verdict],
        ]),
      }}
      meaning={chainMeaning(report)}
      actions={
        <>
          <Btn
            kind="ghost"
            size="sm"
            onClick={() => {
              onGoal({ reset: true });
            }}
          >
            {c.reset}
          </Btn>
          {short === null || route === null ? null : (
            <Btn
              kind="pri"
              size="sm"
              onClick={() => {
                onGo({ kind: "route", screen: route.screen, tab: route.tab });
              }}
            >
              {c.open[short]}
            </Btn>
          )}
        </>
      }
    >
      {lines.length === 0 ? (
        <Empty icon="chart" title={text.emptyTitle}>
          {text.emptyBody}
        </Empty>
      ) : (
        <div className="ins-table-wrap">
          <table className="ins-table goal-chain" aria-label={c.aria}>
            <thead>
              <tr>
                <th scope="col">{c.columns.step}</th>
                <th scope="col" className="num">
                  {c.columns.month}
                </th>
                <th scope="col">{c.columns.rate}</th>
                <th scope="col">{c.columns.day}</th>
                <th scope="col">{c.columns.verdict}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.step} data-step={l.step}>
                  <th scope="row">{stepName(l.step)}</th>
                  <td className="num strong">{monthText(l)}</td>
                  <td>{rateLine(l)}</td>
                  <td>
                    <DayCell line={l} />
                  </td>
                  <td>
                    <LineVerdict line={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Levers({ levers }: { readonly levers: readonly Lever[] }) {
  const t = text.levers;
  return (
    <Panel
      dataUi="goal.levers"
      headline={leversHeadline(levers)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.numbersColumns,
        rows: levers.map((l) => [
          leverName(l),
          leverValue(l, l.from),
          leverValue(l, l.to),
          Math.round(l.emailsFrom),
          Math.round(l.emailsTo),
        ]),
      }}
      meaning={t.meaning}
    >
      {levers.length === 0 ? (
        <p className="muted">{t.none}</p>
      ) : (
        <table className="ins-table goal-levers">
          <thead>
            <tr>
              <th scope="col">{t.columns.lever}</th>
              <th scope="col" className="num">
                {t.columns.emails}
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {levers.map((l, i) => (
              <tr key={l.kind}>
                <td>
                  <b className="strong">{leverName(l)}</b>
                  <div className="muted goal-sub">
                    {t.change(leverValue(l, l.from), leverValue(l, l.to))}
                  </div>
                </td>
                <td className="num">{t.change(fmt(l.emailsFrom), fmt(l.emailsTo))}</td>
                <td>
                  {i === 0 ? (
                    <span className="ins-verdict good">
                      <Icon name="checkc" size={14} />
                      {t.biggest}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Room({ room }: { readonly room: GoalReport["room"] }) {
  const t = text.room;
  return (
    <Panel
      dataUi="goal.room"
      headline={roomHeadline(room)}
      counted={t.counted}
      verdict={roomVerdict(room)}
      what={t.what}
      numbers={{
        columns: t.columns,
        rows: [
          [t.neededRow, Math.round(room.needed)],
          [t.capacityRow, Math.round(room.capacity)],
        ],
      }}
      meaning={roomMeaning(room)}
    >
      <div className="goal-room">
        <BigNumber value={fmt(room.needed)} unit={t.unit(fmt(room.capacity))} size="lg" />
        <ShareBar
          n={room.needed}
          d={Math.max(room.capacity, room.needed, 1)}
          tone="series-neutral"
          ariaLabel={t.barLabel(fmt(room.needed), fmt(room.capacity))}
        />
      </div>
    </Panel>
  );
}

const moneySteps: readonly GoalStep[] = ["revenue", "bookings", "deals", "pitches"];

/** The report without its money lines and money levers, for the chain and levers to show. */
function withoutMoney(report: GoalReport): GoalReport {
  const short = report.shortStep;
  return {
    ...report,
    lines: report.lines.filter((l) => !moneySteps.includes(l.step)),
    levers: report.levers.filter((l) => l.kind !== "dealSize" && l.kind !== "closeRate"),
    shortStep: short !== null && moneySteps.includes(short) ? null : short,
  };
}

/** The Goal tab: your target, the chain back to a working day, the biggest lever, and mailbox room. */
export function GoalTab({ report: full, onGoal, onGo, showMoney = false }: GoalTabProps) {
  // Money stays hidden unless shown: a viewer without money, or live before deals are wired.
  const report = showMoney ? full : withoutMoney(full);
  const n = report.settings.signsPerMonth;
  const revenue = showMoney ? report.settings.revenuePerMonth : null;
  const margin = report.lines.find((l) => l.step === "bookings")?.rate;
  const price = report.lines.find((l) => l.step === "deals")?.rate;
  return (
    <div className="goal" data-ui="goal.tab">
      <Panel
        dataUi="goal.hero"
        hero
        headline={revenue === null ? text.headline(String(n)) : text.money.headline(money(revenue))}
        counted={text.counted(fmt(workingDaysPerMonth))}
        what={text.what}
      >
        <div className="goal-fields">
          {showMoney ? (
            <MoneyGoalInput
              key={`r${String(revenue)}`}
              value={revenue}
              onCommit={(revenuePerMonth) => {
                onGoal({ revenuePerMonth });
              }}
            />
          ) : null}
          {revenue !== null && price != null ? (
            <Derived
              label={`${text.money.dealLabel} · ${sourceText(price)}`}
              value={money(price.value)}
            />
          ) : null}
          {revenue !== null && margin != null ? (
            <Derived
              label={`${text.money.marginLabel} · ${sourceText(margin)}`}
              value={rateText(margin.value)}
            />
          ) : null}
          <GoalInput
            key={n}
            value={n}
            onCommit={(signsPerMonth) => {
              onGoal({ signsPerMonth });
            }}
          />
        </div>
      </Panel>
      <Chain report={report} onGoal={onGoal} onGo={onGo} />
      <div className="goal-pair">
        <Levers levers={report.levers} />
        <Room room={report.room} />
      </div>
      <p className="goal-note muted">{text.moneyNote}</p>
    </div>
  );
}
