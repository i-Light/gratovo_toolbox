import { avatarColor, Avatar, Btn, cx, Empty, Icon, IconBtn, Seg } from "@gratovo/ui";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { openMenu, peek } from "../lib/actions";
import { shortDate } from "../lib/format";
import { parkItems, resumeSequence, stopSequence, wakeCreator } from "../lib/reach-actions";
import { go, useApp } from "../lib/store";
import type { MenuItem } from "../lib/store";
import { useNow } from "../lib/use-now";
import { strings } from "../strings";
import { dayDiff, nextWords, sequenceEvents, sequenceRows, timelineDays } from "./reach-view";
import type { SeqRow } from "./reach-view";

const text = strings.reach.sequences;
const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"] as const;
type Show = "all" | "running" | "stopped";

/** The row's menu: Open, Stop or Resume, Park until, Wake now. */
function rowMenu(event: MouseEvent<HTMLElement>, row: SeqRow, ids: readonly string[]): void {
  const box = event.currentTarget.getBoundingClientRect();
  const id = row.creator.id;
  const { sequence, state } = row;
  const byYou = sequence.stopped === "you";
  const items: MenuItem[] = [
    {
      kind: "item",
      label: text.open,
      icon: "eye",
      run: () => {
        peek({ kind: "creator", id }, ids, { tab: "emails" });
      },
    },
  ];
  const actions: MenuItem[] = [];
  if (state === "parked") {
    actions.push({
      kind: "item",
      label: text.wake,
      icon: "alarm",
      run: () => {
        void wakeCreator(id);
      },
    });
  } else {
    if (byYou) {
      actions.push({
        kind: "item",
        label: text.resume,
        icon: "play",
        run: () => {
          void resumeSequence(id);
        },
      });
    } else if (sequence.stopped === null && state !== "finished") {
      actions.push({
        kind: "item",
        label: text.stop,
        icon: "pause",
        danger: true,
        run: () => {
          void stopSequence(id);
        },
      });
    }
    // Park pauses a running sequence; a stopped one is resumed first (review of 6c, finding 5).
    if (sequence.stopped === null && state !== "finished") {
      actions.push(...parkItems(id));
    }
  }
  if (actions.length > 0) {
    items.push({ kind: "separator" }, ...actions);
  }
  openMenu(box, items, text.menu, "end");
}

const isMonday = (ts: number): boolean => new Date(ts).getDay() === 1;

/**
 * Reach › Sequences (D22; prototype reach.js Sequences): one row per creator with a sequence, one
 * column per day, 14 days back to 14 days ahead.
 */
export function Sequences() {
  const creators = useApp((s) => s.data.creators);
  const sequences = useApp((s) => s.data.reach.sequences);
  const threads = useApp((s) => s.data.reach.threads);
  const peeked = useApp((s) => s.ui.peek?.record.id ?? null);
  const now = useNow();
  const [show, setShow] = useState<Show>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => sequenceRows(creators, sequences, threads, now),
    [creators, sequences, threads, now],
  );
  const running = rows.filter((r) => r.running).length;
  const shown = rows.filter((r) =>
    show === "running" ? r.running : show === "stopped" ? !r.running : true,
  );
  const ids = shown.map((r) => r.creator.id);
  const days = timelineDays(now);
  const todayCol = days.findIndex((d) => dayDiff(d, now) === 0);
  const weeks: { ts: number; n: number }[] = [];
  for (const ts of days) {
    const last = weeks.at(-1);
    if (last === undefined || isMonday(ts)) {
      weeks.push({ ts, n: 1 });
    } else {
      last.n += 1;
    }
  }
  const hasRows = shown.length > 0;
  // Open with today in view, as the prototype does.
  useEffect(() => {
    const el = scroller.current;
    const today = el?.querySelector<HTMLElement>(".sq-day.now");
    const label = el?.querySelector<HTMLElement>(".sq-l");
    if (el && today && label && el.scrollWidth > el.clientWidth + 2) {
      el.scrollLeft = Math.max(0, today.offsetLeft - label.offsetWidth - today.offsetWidth * 4);
    }
  }, [hasRows]);
  const dueToday = rows.filter(
    (r) => r.running && r.next !== null && dayDiff(r.next.dueAt, now) <= 0,
  ).length;
  return (
    <div className="col" data-ui="reach.sequences">
      <div className="row wrap">
        <Seg
          label={text.show}
          value={show}
          onPick={(v) => {
            setShow(v as Show);
          }}
          options={[
            { value: "all", label: text.all(rows.length) },
            { value: "running", label: text.running(running) },
            { value: "stopped", label: text.stopped(rows.length - running) },
          ]}
        />
        <span className="sp"></span>
        <span className="small ink2">
          {dueToday > 0
            ? text.dueToday(dueToday)
            : running > 0
              ? text.noneDue
              : text.nothingRunning}
        </span>
      </div>
      {hasRows ? (
        <>
          <div className="sq" data-ui="reach.sequences.table" ref={scroller}>
            <div className="sq-in" role="table" aria-label={text.table}>
              <div className="sq-r sq-hd sq-wkrow" role="presentation">
                <div className="sq-l"></div>
                {weeks.map((w) => (
                  <div
                    key={w.ts}
                    className={cx("sq-wk", isMonday(w.ts) && "mon")}
                    style={{ gridColumn: `span ${String(w.n)}` }}
                  >
                    {w.n >= 3 ? text.weekOf(shortDate(w.ts)) : ""}
                  </div>
                ))}
                <div className="sq-x"></div>
              </div>
              <div className="sq-r sq-hd" role="row">
                <div className="sq-l" role="columnheader">
                  {text.creator}
                </div>
                {days.map((ts, k) => {
                  const dow = new Date(ts).getDay();
                  return (
                    <div
                      key={ts}
                      role="columnheader"
                      className={cx(
                        "sq-c sq-day",
                        isMonday(ts) && "mon",
                        (dow === 0 || dow === 6) && "we",
                        k === todayCol && "now",
                      )}
                      aria-current={k === todayCol ? "date" : undefined}
                      data-tip={`${k === todayCol ? `${text.today}, ` : ""}${shortDate(ts)}`}
                    >
                      {weekdayLetters[dow]}
                      <b>{new Date(ts).getDate()}</b>
                    </div>
                  );
                })}
                <div className="sq-x" role="columnheader">
                  {text.nextStep}
                </div>
              </div>
              <div className="sq-body" role="rowgroup">
                {shown.map((row) => {
                  const events = sequenceEvents(row, now);
                  const next = nextWords(row, now);
                  const { creator } = row;
                  const open = (): void => {
                    peek({ kind: "creator", id: creator.id }, ids, { tab: "emails" });
                  };
                  return (
                    // The name button is the keyboard way in; a click on the row is the mouse's.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                    <div
                      key={creator.id}
                      className="sq-r"
                      data-ui="reach.sequences.row"
                      role="row"
                      aria-selected={peeked === creator.id}
                      onClick={open}
                    >
                      <button
                        type="button"
                        className="sq-l"
                        data-tip={creator.name}
                        onClick={(event) => {
                          event.stopPropagation();
                          open();
                        }}
                      >
                        <Avatar
                          name={creator.name}
                          color={avatarColor(creator.handle)}
                          size="s"
                          decorative
                        />
                        <b>{creator.name}</b>
                      </button>
                      {days.map((ts, k) => {
                        const dots = events.days[k] ?? [];
                        const inLine =
                          events.lo < events.hi && k >= Math.max(events.lo, 0) && k <= events.hi;
                        const line = !inLine
                          ? null
                          : k === events.lo
                            ? "ln ls"
                            : k === events.hi
                              ? "ln le"
                              : "ln";
                        return (
                          <div
                            key={ts}
                            role="cell"
                            className={cx(
                              "sq-c",
                              isMonday(ts) && "mon",
                              k === todayCol && "now",
                              k > todayCol && "fut",
                              line,
                              dots.length > 1 && "two",
                            )}
                            data-tip={
                              dots.length > 0 ? dots.map((d) => d.text).join(" · ") : undefined
                            }
                          >
                            {dots.map((dot) => (
                              <span
                                key={dot.text}
                                className={`sq-d ${dot.type}`}
                                role="img"
                                aria-label={dot.text}
                              >
                                {dot.type === "skip" ? <Icon name="x" /> : null}
                              </span>
                            ))}
                          </div>
                        );
                      })}
                      <div className="sq-x" role="cell">
                        <span className={cx("nx", next.due && "due")} data-tip={next.text}>
                          <Icon name={next.icon} />
                          <span>{next.text}</span>
                        </span>
                        <IconBtn
                          icon="more"
                          label={text.moreFor(creator.name)}
                          onClick={(event) => {
                            event.stopPropagation();
                            rowMenu(event, row, ids);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div
            className="sq-leg"
            data-ui="reach.sequences.legend"
            role="group"
            aria-label={text.legend.label}
          >
            <span>
              <i className="sq-d sent"></i>
              {text.legend.sent}
            </span>
            <span>
              <i className="sq-d due"></i>
              {text.legend.due}
            </span>
            <span>
              <i className="sq-d plan"></i>
              {text.legend.planned}
            </span>
            <span>
              <i className="sq-d skip">
                <Icon name="x" />
              </i>
              {text.legend.skipped}
            </span>
            <span>
              <i className="sq-d reply"></i>
              {text.legend.reply}
            </span>
            <span>
              <i className="sw"></i>
              {text.legend.today}
            </span>
            <span>
              <i className="dash"></i>
              {text.legend.later}
            </span>
          </div>
        </>
      ) : (
        <div className="card">
          {rows.length > 0 ? (
            <Empty
              icon="clock"
              title={text.noMatchTitle}
              action={
                <Btn
                  size="sm"
                  onClick={() => {
                    setShow("all");
                  }}
                >
                  {text.showAll}
                </Btn>
              }
            >
              {text.noMatchHint}
            </Empty>
          ) : (
            <Empty
              icon="clock"
              title={text.emptyTitle}
              action={
                <Btn
                  kind="pri"
                  icon="send"
                  onClick={() => {
                    go("reach", "board");
                  }}
                >
                  {text.emptyAction}
                </Btn>
              }
            >
              {text.emptyHint}
            </Empty>
          )}
        </div>
      )}
    </div>
  );
}
