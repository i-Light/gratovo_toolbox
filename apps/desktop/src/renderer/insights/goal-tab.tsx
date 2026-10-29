import { Btn, Empty, Icon } from "@gratovo/ui";
import { workingDaysPerMonth } from "@gratovo/core/insights";
import type { GoalLine, GoalReport, InsightsGo, Lever } from "@gratovo/core/insights";
import { useState } from "react";

import { strings } from "../strings";
import { BigNumber } from "./big-number";
import { ShareBar } from "./charts/bars";
import { Panel } from "./panel";
import { VerdictDot } from "./verdict";
import {
  chainHeadline,
  chainMeaning,
  leverName,
  leversHeadline,
  perDayText,
  rateLine,
  rateText,
  roomHeadline,
  roomMeaning,
  roomVerdict,
  shortByText,
  stepName,
  stepRoute,
} from "./words/goal";
import { fmt } from "./words/search";
import "./goal.css";

const text = strings.insights.goal;

/** What the goal input and the reset action send (the `insights:goal` request). */
export interface GoalPatch {
  readonly signsPerMonth?: number;
  readonly reset?: true;
}

/** What `GoalTab` takes. */
export interface GoalTabProps {
  readonly report: GoalReport;
  readonly onGoal: (patch: GoalPatch) => void;
  readonly onGo: (go: InsightsGo) => void;
}

const minSigns = 1;
const maxSigns = 100;

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
    return <span className="muted">{c.monthOnly}</span>;
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
          Math.round(l.month),
          rateLine(l),
          l.perDay === null ? "—" : perDayText(l.perDay),
          l.actualPerDay === null ? "—" : perDayText(l.actualPerDay),
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
                  <td className="num strong">{fmt(l.month)}</td>
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
          rateText(l.from),
          rateText(l.to),
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
                  <div className="muted goal-sub">{t.change(rateText(l.from), rateText(l.to))}</div>
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

/** The Goal tab: your target, the chain back to a working day, the biggest lever, and mailbox room. */
export function GoalTab({ report, onGoal, onGo }: GoalTabProps) {
  const n = report.settings.signsPerMonth;
  return (
    <div className="goal" data-ui="goal.tab">
      <Panel
        dataUi="goal.hero"
        hero
        headline={text.headline(String(n))}
        counted={text.counted(fmt(workingDaysPerMonth))}
        what={text.what}
      >
        <GoalInput
          key={n}
          value={n}
          onCommit={(signsPerMonth) => {
            onGoal({ signsPerMonth });
          }}
        />
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
