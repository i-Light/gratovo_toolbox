import { overBudget, plannedMinutes, todayBuckets } from "@gratovo/core/today";
import type { DayState, DoneEntry, TodayItem } from "@gratovo/core/today";
import { Btn, Icon, Tag } from "@gratovo/ui";

import { duration } from "../lib/format";
import type { ItemWords } from "../lib/today";
import { fitDay } from "../lib/today-actions";
import { useApp } from "../lib/store";
import { capacity } from "../reach/reach-view";
import { strings } from "../strings";
import { bucketHue } from "./today-view";

const text = strings.today.screen.band;
const names = strings.today.screen.buckets;
const status = strings.reach.mailboxes.status;
const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);

interface Seg {
  readonly key: string;
  readonly name: string;
  readonly min: number;
  readonly color: string;
  readonly opacity: number;
}

const tone = { warming: "info", slowed: "warn", paused: "line", signed_out: "crit" } as const;

function Sending() {
  const mailboxes = useApp((s) => s.data.reach.mailboxes);
  const cap = capacity(mailboxes);
  return (
    <div className="card tight" data-ui="today.band.mail">
      <div className="card-h">
        <h3>{text.sending}</h3>
        <small className="muted num">{text.sendsLeft(cap.left)}</small>
      </div>
      {mailboxes.length === 0 ? (
        <p className="muted small">{text.noMailbox}</p>
      ) : (
        <ul className="tdy-mail">
          {mailboxes.map((m) => {
            const share =
              m.effectiveCap === 0 ? 0 : Math.min(100, (100 * m.sentToday) / m.effectiveCap);
            const meterTone = share >= 100 ? "crit" : share >= 80 ? "warn" : "";
            const address = m.address.split("@")[0] ?? m.address;
            return (
              <li key={m.address}>
                <span className="ell tdy-addr" title={m.address}>
                  {address}
                </span>
                <span
                  className={`meter ${meterTone}`}
                  role="meter"
                  aria-label={text.meter(m.address)}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(m.effectiveCap, 1)}
                  aria-valuenow={Math.min(m.sentToday, m.effectiveCap)}
                >
                  <i style={{ width: `${String(share)}%` }}></i>
                </span>
                <span className="num muted tdy-sent">
                  {text.sentOf(m.sentToday, m.effectiveCap)}
                </span>
                {m.status === "good" ? null : <Tag tone={tone[m.status]}>{status[m.status]}</Tag>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The day at a glance: the hours against the work, the mailboxes' sends and what is done. */
export function DayBand({
  items,
  words,
  day,
  doneToday,
}: {
  readonly items: readonly TodayItem[];
  readonly words: ReadonlyMap<string, ItemWords>;
  readonly day: DayState;
  readonly doneToday: readonly DoneEntry[];
}) {
  const budget = day.hours * 60;
  const planned = plannedMinutes(items);
  const doneMin = sum(doneToday.map((e) => e.minutes));
  const free = Math.max(0, budget - planned - doneMin);
  const used = planned + doneMin;
  const segs: Seg[] = [];
  for (const bucket of todayBuckets) {
    const min = sum(items.filter((i) => i.bucket === bucket).map((i) => i.minutes));
    if (min > 0) {
      segs.push({
        key: bucket,
        name: names[bucket],
        min,
        color: bucketHue[bucket].hue,
        opacity: bucketHue[bucket].opacity,
      });
    }
  }
  if (doneMin > 0) {
    segs.push({ key: "done", name: text.done, min: doneMin, color: "var(--good)", opacity: 1 });
  }
  if (free > 0) {
    segs.push({ key: "free", name: text.free, min: free, color: "var(--line-2)", opacity: 0.6 });
  }
  const total = Math.max(budget, used);
  const keys = used > budget ? overBudget(items, budget, doneMin) : [];
  const label = text.barLabel(segs.map((s) => text.barPart(s.name, duration(s.min))).join(", "));
  const newest = doneToday[0];
  return (
    <div className="tdy-band" data-ui="today.band">
      <div className="card tight">
        <div className="card-h">
          <h3>{text.hours(day.hours)}</h3>
          {keys.length > 0 ? (
            <Btn
              size="sm"
              icon="moveup"
              tip={text.fitTip}
              dataUi="today.band.fit"
              onClick={() => {
                fitDay(keys.map((key) => ({ key, title: words.get(key)?.title ?? "" })));
              }}
            >
              {text.fit(day.hours)}
            </Btn>
          ) : null}
        </div>
        <p className="small ink2 num">
          {text.line(duration(planned), duration(doneMin), duration(free))}
        </p>
        <div className="tdy-bar" role="img" aria-label={label}>
          {segs.map((s) => (
            <i
              key={s.key}
              style={{
                width: `${String((100 * s.min) / total)}%`,
                background: s.color,
                opacity: s.opacity,
              }}
            />
          ))}
        </div>
        <ul className="tdy-legend" aria-hidden="true">
          {segs.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color, opacity: s.opacity }} />
              {s.name}
              <span className="num muted">{duration(s.min)}</span>
            </li>
          ))}
        </ul>
      </div>
      <Sending />
      <div className="card tight" data-ui="today.band.done">
        <div className="card-h">
          <h3>{text.doneToday}</h3>
          <small className="muted num">{text.doneCount(doneToday.length)}</small>
        </div>
        {newest === undefined ? (
          <p className="muted small">{text.nothingYet}</p>
        ) : (
          <div className="col" style={{ gap: "4px" }}>
            <span className="tdy-newest">
              <Icon name="checkc" size={14} />
              <span className="ell">{newest.title}</span>
            </span>
            <small className="muted">{text.undoHint}</small>
          </div>
        )}
      </div>
    </div>
  );
}
