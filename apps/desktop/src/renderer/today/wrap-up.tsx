import { dayNoteMax, tomorrowItems } from "@gratovo/core/today";
import type { DayState, DoneEntry, TodayInput, TodayItem } from "@gratovo/core/today";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { duration } from "../lib/format";
import { appStore } from "../lib/store";
import type { ItemWords } from "../lib/today";
import { moveToTomorrow, wrapUp } from "../lib/today-actions";
import { strings } from "../strings";

const text = strings.today.screen.wrap;
const listMax = 8;

const close = (): void => {
  appStore().ui((ui) => {
    ui.today.wrap = false;
  });
};

function Tile({
  label,
  value,
  sub,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
}) {
  return (
    <div className="tdy-tile">
      <small className="muted">{label}</small>
      <b className="num">{value}</b>
      {sub === undefined ? null : <small className="muted num">{sub}</small>}
    </div>
  );
}

/** Closing the day: what got done, what is still open, what comes tomorrow, and a note to yourself. */
export function WrapUp({
  items,
  words,
  input,
  day,
  doneToday,
  sent,
  capacity,
  showMoney,
}: {
  readonly items: readonly TodayItem[];
  readonly words: ReadonlyMap<string, ItemWords>;
  readonly input: TodayInput;
  readonly day: DayState;
  readonly doneToday: readonly DoneEntry[];
  readonly sent: number;
  readonly capacity: number;
  readonly showMoney: boolean;
}) {
  const [note, setNote] = useState(day.note);
  const tomorrow = tomorrowItems(input, day);
  const lines = [
    tomorrow.snoozed > 0 ? text.snoozedBack(tomorrow.snoozed) : null,
    tomorrow.followUps > 0 ? text.followUps(tomorrow.followUps) : null,
    tomorrow.dealSteps > 0 ? text.dealSteps(tomorrow.dealSteps) : null,
  ].filter((line): line is string => line !== null);
  const doneMin = doneToday.reduce((a, e) => a + e.minutes, 0);
  const openMin = items.reduce((a, i) => a + i.minutes, 0);
  const moneySteps = doneToday.filter((e) => e.bucket === "money").length;
  return (
    <section className="card tdy-wrap" data-ui="today.wrap" aria-label={text.title}>
      <div className="card-h">
        <h2>{text.title}</h2>
      </div>
      <div className="tdy-tiles">
        <Tile label={text.done} value={String(doneToday.length)} sub={duration(doneMin)} />
        <Tile label={text.sent} value={text.of(sent, capacity)} />
        {showMoney ? <Tile label={text.money} value={text.steps(moneySteps)} /> : null}
        <Tile label={text.open} value={String(items.length)} sub={duration(openMin)} />
      </div>
      <div className="col" style={{ gap: "6px" }}>
        <div className="sect-h">
          <span>{text.openList}</span>
          {items.length > 0 ? (
            <Btn
              size="sm"
              dataUi="today.wrap.moveall"
              onClick={() => {
                moveToTomorrow(
                  items.map((i) => ({ key: i.key, title: words.get(i.key)?.title ?? "" })),
                );
              }}
            >
              {text.moveAll}
            </Btn>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="muted small">{text.nothingOpen}</p>
        ) : (
          <ul className="tdy-plain">
            {items.slice(0, listMax).map((i) => (
              <li key={i.key} className="ell">
                {words.get(i.key)?.title ?? ""}
              </li>
            ))}
            {items.length > listMax ? (
              <li className="muted">{text.more(items.length - listMax)}</li>
            ) : null}
          </ul>
        )}
      </div>
      <div className="col" style={{ gap: "6px" }}>
        <div className="sect-h">
          <span>{text.tomorrow}</span>
        </div>
        {lines.length === 0 ? (
          <p className="muted small">{text.nothingScheduled}</p>
        ) : (
          <ul className="tdy-plain">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <label className="field" htmlFor="today-note">
        <span>{text.noteLabel}</span>
        <textarea
          id="today-note"
          className="ta"
          data-ui="today.note"
          rows={3}
          maxLength={dayNoteMax}
          placeholder={text.notePlaceholder}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      <div className="row" style={{ gap: "8px" }}>
        <Btn
          kind="pri"
          dataUi="today.wrap.finish"
          onClick={() => {
            wrapUp(note);
            close();
          }}
        >
          {text.finish}
        </Btn>
        <Btn onClick={close}>{text.back}</Btn>
      </div>
    </section>
  );
}
