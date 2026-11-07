import { todayBuckets } from "@gratovo/core/today";
import type { DayState, DoneEntry, TodayBucket, TodayItem } from "@gratovo/core/today";
import { Btn, Icon } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { undo } from "../lib/actions";
import { duration } from "../lib/format";
import { whenWords } from "../lib/reach-actions";
import { appStore } from "../lib/store";
import type { ItemWords } from "../lib/today";
import { bringBack } from "../lib/today-actions";
import { strings } from "../strings";
import { bucketHue, bucketIcon, dueWords, isLate, kindIcon } from "./today-view";
import type { TodayFilter } from "./today-view";

const text = strings.today.screen.queue;
const names = strings.today.screen.buckets;
const filters: readonly TodayFilter[] = ["all", "quick", "late"];

const select = (key: string): void => {
  appStore().ui((ui) => {
    ui.today.sel = key;
  });
};

const setFilter = (filter: TodayFilter): void => {
  appStore().ui((ui) => {
    ui.today.filter = filter;
  });
};

const toggleBucket = (bucket: TodayBucket): void => {
  appStore().ui((ui) => {
    ui.today.folded = ui.today.folded.includes(bucket)
      ? ui.today.folded.filter((b) => b !== bucket)
      : [...ui.today.folded, bucket];
  });
};

function Row({
  item,
  words,
  selected,
  now,
}: {
  readonly item: TodayItem;
  readonly words: ItemWords | undefined;
  readonly selected: boolean;
  readonly now: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (selected && el !== null && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);
  const due = dueWords(item, now);
  const late = isLate(item, now);
  return (
    <button
      ref={ref}
      type="button"
      className="li tdy-row"
      data-ui="today.row"
      data-key={item.key}
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        select(item.key);
      }}
    >
      <span className="tdy-ico">
        <Icon name={kindIcon[item.kind]} size={15} />
      </span>
      <span className="lt">
        <b>{words?.title ?? ""}</b>
        <small>{words?.sub ?? ""}</small>
      </span>
      {item.quick ? (
        <span className="tdy-bolt" data-tip={text.quickTip} role="img" aria-label={text.quickTip}>
          <Icon name="bolt" size={13} />
        </span>
      ) : null}
      <span className={late ? "tdy-due late num" : "tdy-due num"}>
        {due ?? text.min(item.minutes)}
      </span>
    </button>
  );
}

function Group({
  name,
  count,
  open,
  onToggle,
  icon,
  dataUi,
  hue,
  minutes,
  children,
}: {
  readonly name: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly icon: IconName;
  readonly dataUi: string;
  readonly hue: string;
  readonly minutes?: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="bucket" data-ui={dataUi} style={{ "--hue": hue } as CSSProperties}>
      <button type="button" className="bucket-h" aria-expanded={open} onClick={onToggle}>
        <span className="bi">
          <Icon name={icon} />
        </span>
        <span>{name}</span>
        <span className="num muted">{count}</span>
        <span className="m num">{minutes === undefined ? "" : duration(minutes)}</span>
        <Icon name="minus" size={12} className={open ? "tdy-fold" : "tdy-fold shut"} />
      </button>
      {open ? children : null}
    </div>
  );
}

/** The list of what needs you: chips, buckets that fold, then Snoozed and Done today. */
export function Queue({
  items,
  visible,
  words,
  sel,
  filter,
  folded,
  day,
  doneToday,
  now,
}: {
  readonly items: readonly TodayItem[];
  readonly visible: readonly TodayItem[];
  readonly words: ReadonlyMap<string, ItemWords>;
  readonly sel: string | null;
  readonly filter: TodayFilter;
  readonly folded: readonly TodayBucket[];
  readonly day: DayState;
  readonly doneToday: readonly DoneEntry[];
  readonly now: number;
}) {
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const counts: Record<TodayFilter, number> = {
    all: items.length,
    quick: items.filter((i) => i.quick).length,
    late: items.filter((i) => isLate(i, now)).length,
  };
  const snoozed = Object.entries(day.snoozed)
    .filter(([, e]) => e.until > now)
    .sort((a, b) => a[1].until - b[1].until);
  return (
    <div className="tdy-queue" data-ui="today.queue" role="region" aria-label={text.region}>
      <div className="row tdy-chips" role="group" aria-label={text.filters}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className="chip"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
            }}
          >
            {text[f]} <span className="c num">{counts[f]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 && filter !== "all" ? (
        <p className="muted small tdy-none">{text.none}</p>
      ) : null}
      {todayBuckets.map((bucket) => {
        const list = visible.filter((i) => i.bucket === bucket);
        if (list.length === 0) {
          return null;
        }
        return (
          <Group
            key={bucket}
            name={names[bucket]}
            count={list.length}
            minutes={list.reduce((a, i) => a + i.minutes, 0)}
            open={!folded.includes(bucket)}
            onToggle={() => {
              toggleBucket(bucket);
            }}
            icon={bucketIcon[bucket]}
            dataUi={`today.queue.bucket.${bucket}`}
            hue={bucketHue[bucket].hue}
          >
            {list.map((item) => (
              <Row
                key={item.key}
                item={item}
                words={words.get(item.key)}
                selected={sel === item.key}
                now={now}
              />
            ))}
          </Group>
        );
      })}
      {snoozed.length === 0 ? null : (
        <Group
          name={text.snoozed}
          count={snoozed.length}
          open={snoozedOpen}
          onToggle={() => {
            setSnoozedOpen(!snoozedOpen);
          }}
          icon="clock"
          dataUi="today.snoozed"
          hue="var(--muted)"
        >
          {snoozed.map(([key, entry]) => (
            <div key={key} className="li tdy-aside" data-key={key}>
              <span className="lt">
                <b>{entry.title}</b>
                <small>{text.back(whenWords(entry.until))}</small>
              </span>
              <Btn
                size="sm"
                onClick={() => {
                  bringBack(key);
                }}
              >
                {text.bringBack}
              </Btn>
            </div>
          ))}
        </Group>
      )}
      {doneToday.length === 0 ? null : (
        <Group
          name={text.doneGroup}
          count={doneToday.length}
          open={doneOpen}
          onToggle={() => {
            setDoneOpen(!doneOpen);
          }}
          icon="checkc"
          dataUi="today.done"
          hue="var(--good)"
        >
          {doneToday.map((entry, i) => (
            <div key={entry.key} className="li done tdy-aside" data-key={entry.key}>
              <span className="lt">
                <b>{entry.title}</b>
                <small>{duration(entry.minutes)}</small>
              </span>
              {i === 0 ? (
                <Btn size="sm" icon="undo" onClick={undo}>
                  {text.undo}
                </Btn>
              ) : null}
            </div>
          ))}
        </Group>
      )}
    </div>
  );
}
