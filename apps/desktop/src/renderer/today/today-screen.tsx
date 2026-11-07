import { plannedMinutes } from "@gratovo/core/today";
import { Btn, Empty, Icon, PageHead } from "@gratovo/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { peek } from "../lib/actions";
import { duration } from "../lib/format";
import { useKeys } from "../lib/keys";
import { appStore, useApp } from "../lib/store";
import { itemWords, startFocus, startWrap, useTodayState } from "../lib/today";
import type { ItemWords } from "../lib/today";
import { dismissNote } from "../lib/today-actions";
import { isPartShown } from "../lib/wired";
import { strings } from "../strings";
import { DayBand } from "./day-band";
import { FirstDay } from "./first-day";
import { FocusBar, leaveFocus } from "./focus-bar";
import { Queue } from "./queue";
import { snoozeMenu } from "./snooze-menu";
import { applyFilter, isLate, longDay, midnight } from "./today-view";
import "./today.css";
import { WorkPane } from "./work-pane";
import { WrapUp } from "./wrap-up";

const text = strings.today.screen;

/** The Today screen: what needs you, in order, with the day's hours, the mailboxes and what is done. */
export function TodayScreen() {
  const { items, input, now } = useTodayState();
  const data = useApp((s) => s.data);
  const ui = useApp((s) => s.ui.today);
  const day = data.settings.day;
  const start = midnight(now);
  const doneToday = useMemo(() => day.done.filter((e) => e.at >= start), [day.done, start]);
  const words = useMemo(() => {
    const map = new Map<string, ItemWords>();
    for (const item of items) {
      map.set(item.key, itemWords(item, data, { newFinds: input.newFinds, now }));
    }
    return map;
  }, [items, data, input.newFinds, now]);
  const visible = useMemo(() => applyFilter(items, ui.filter, now), [items, ui.filter, now]);

  // The open item: the one picked, else the one at the old place in the list.
  const [index, setIndex] = useState(0);
  const prevKeys = useRef<ReadonlySet<string>>(new Set());
  const titles = useRef(new Map<string, string>());
  const picked = visible.findIndex((i) => i.key === ui.sel);
  if (picked >= 0 && picked !== index) {
    setIndex(picked);
  }
  const fallback = visible[Math.min(index, visible.length - 1)];
  const item = picked >= 0 ? visible[picked] : fallback;

  useEffect(() => {
    for (const [key, w] of words) {
      titles.current.set(key, w.title);
    }
    if (picked < 0 && (item?.key ?? null) !== ui.sel) {
      const gone =
        ui.sel !== null &&
        prevKeys.current.has(ui.sel) &&
        !items.some((i) => i.key === ui.sel) &&
        !Object.hasOwn(input.snoozed, ui.sel);
      const was = ui.sel;
      appStore().ui((u) => {
        u.today.sel = item?.key ?? null;
        if (gone && item !== undefined && was !== null) {
          u.today.justDone = { title: titles.current.get(was) ?? "", at: Date.now() };
        }
      });
    }
    prevKeys.current = new Set(items.map((i) => i.key));
  }, [picked, item, items, words, input.snoozed, ui.sel]);

  const focusAt = ui.focusAt;
  const focus = focusAt !== null;
  const move = (by: 1 | -1): boolean => {
    if (item?.kind === "finds" || visible.length === 0) {
      return false;
    }
    const next =
      visible[
        Math.min(
          visible.length - 1,
          Math.max(0, (item === undefined ? 0 : visible.indexOf(item)) + by),
        )
      ];
    if (next !== undefined) {
      appStore().ui((u) => {
        u.today.sel = next.key;
      });
    }
    return true;
  };
  useKeys({
    j: () => move(1),
    arrowdown: () => move(1),
    k: () => move(-1),
    arrowup: () => move(-1),
    f: () => {
      if (focus) {
        leaveFocus();
      } else {
        startFocus();
      }
    },
    escape: () => {
      if (!focus) {
        return false;
      }
      leaveFocus();
      return true;
    },
    z: () => {
      if (item === undefined) {
        return false;
      }
      snoozeMenu(item, words.get(item.key)?.title ?? "");
      return true;
    },
    o: () => {
      if (item?.ref == null) {
        return false;
      }
      peek(item.ref);
      return true;
    },
  });

  const planned = plannedMinutes(items);
  const late = items.filter((i) => isLate(i, now)).length;
  const sub = items.length === 0 ? text.subNone : text.sub(items.length, duration(planned), late);
  const noteShown = day.note !== "" && day.wrappedAt !== null && day.wrappedAt < start;
  const firstDay = data.creators.length === 0 && data.deals.length === 0;
  const mailboxes = data.reach.mailboxes;
  const showMoney = data.seesMoney && isPartShown("today.deals", data.source);

  const pane = ui.wrap ? (
    <WrapUp
      items={items}
      words={words}
      input={input}
      day={day}
      doneToday={doneToday}
      sent={mailboxes.reduce((a, m) => a + m.sentToday, 0)}
      capacity={mailboxes.reduce((a, m) => a + m.effectiveCap, 0)}
      showMoney={showMoney}
    />
  ) : item !== undefined ? (
    <WorkPane item={item} words={words.get(item.key) ?? { title: "", sub: "", why: "" }} />
  ) : firstDay ? (
    <FirstDay />
  ) : (
    <div className="card" data-ui="today.clear">
      <Empty
        icon="checkc"
        title={text.clear.title}
        action={
          <Btn kind="pri" onClick={startWrap}>
            {text.clear.wrapUp}
          </Btn>
        }
      >
        {text.clear.hint}
      </Empty>
    </div>
  );

  return (
    <section className="page" data-ui="today">
      {focusAt !== null ? (
        <FocusBar
          position={item === undefined ? 0 : visible.indexOf(item) + 1}
          total={visible.length}
          doneSince={doneToday.filter((e) => e.at >= focusAt).length}
          minutesLeft={planned}
          focusAt={focusAt}
          now={now}
        />
      ) : (
        <>
          <PageHead
            dataUi="today.head"
            title={text.title(longDay(now))}
            sub={sub}
            right={
              <div className="row" style={{ gap: "8px" }}>
                <Btn icon="moon" dataUi="today.wrapbtn" onClick={startWrap}>
                  {text.wrapUp}
                </Btn>
                <Btn kind="pri" icon="play" kbd="F" dataUi="today.focusbtn" onClick={startFocus}>
                  {text.startFocus}
                </Btn>
              </div>
            }
          />
          {noteShown ? (
            <div className="callout" data-ui="today.notecard">
              <Icon name="note" />
              <div className="col grow" style={{ gap: "2px" }}>
                <b>{text.noteFromYesterday}</b>
                <span>{day.note}</span>
              </div>
              <Btn size="sm" onClick={dismissNote}>
                {text.dismissNote}
              </Btn>
            </div>
          ) : null}
          <DayBand items={items} words={words} day={day} doneToday={doneToday} />
        </>
      )}
      <div className={focus ? "tdy-focus" : "tdy-split"}>
        {focus ? null : (
          <Queue
            items={items}
            visible={visible}
            words={words}
            sel={item?.key ?? null}
            filter={ui.filter}
            folded={ui.folded}
            day={day}
            doneToday={doneToday}
            now={now}
          />
        )}
        <div className="tdy-main">{pane}</div>
      </div>
    </section>
  );
}
