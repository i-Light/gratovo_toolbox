import {
  dayNoteMax,
  doneMax,
  pruneDay,
  snoozeOptions,
  type DayState,
  type DoneEntry,
} from "@gratovo/core/today";

import { strings } from "../strings";
import { act } from "./actions";
import { whenWords } from "./reach-actions";
import { appStore } from "./store";

const t = strings.todayActions;
/** The longest title kept with a snoozed or done item. */
const titleMax = 200;

type Writable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

interface Item {
  readonly key: string;
  readonly title: string;
}

const clip = (title: string): string => title.slice(0, titleMax);

/** The draft type wants a mutable list; the day is replaced whole, never edited in place. */
const writable = (day: DayState): Writable<DayState> => day as Writable<DayState>;

const dayNow = (): DayState => appStore().getState().data.settings.day;

/** `day` with `items` snoozed until `until`, pruned at `now`. */
function withSnoozed(day: DayState, items: readonly Item[], until: number): DayState {
  const snoozed = { ...day.snoozed };
  for (const { key, title } of items) {
    snoozed[key] = { until, title: clip(title) };
  }
  return pruneDay({ ...day, snoozed }, Date.now());
}

/** Snoozes one item until `until`. Undo brings it back. */
export function snooze(key: string, title: string, until: number): void {
  act(
    t.snooze,
    (data) => {
      data.settings.day = writable(withSnoozed(data.settings.day, [{ key, title }], until));
    },
    { log: false, toast: { msg: t.snoozed(title, whenWords(until)), icon: "clock" } },
  );
}

/** Takes an item off the snoozed list so it shows today again. */
export function bringBack(key: string): void {
  act(
    t.bringBack,
    (data) => {
      const entry = data.settings.day.snoozed[key];
      if (entry === undefined) {
        return false;
      }
      data.settings.day = {
        ...data.settings.day,
        snoozed: Object.fromEntries(
          Object.entries(data.settings.day.snoozed).filter(([k]) => k !== key),
        ),
      };
      return true;
    },
    {
      log: false,
      toast: { msg: t.broughtBack(dayNow().snoozed[key]?.title ?? ""), icon: "check" },
    },
  );
}

function pushToTomorrow(label: string, msg: (n: number) => string, items: readonly Item[]): void {
  if (items.length === 0) {
    return;
  }
  act(
    label,
    (data) => {
      const until = snoozeOptions(Date.now(), data.settings.day.morning).tomorrow;
      data.settings.day = writable(withSnoozed(data.settings.day, items, until));
    },
    { log: false, toast: { msg: msg(items.length), icon: "clock" } },
  );
}

/** Moves items to tomorrow morning. Undo puts them back. */
export function moveToTomorrow(items: readonly Item[]): void {
  pushToTomorrow(t.moveToTomorrow, t.movedToTomorrow, items);
}

/** Moves what does not fit the day's hours to tomorrow morning. */
export function fitDay(items: readonly Item[]): void {
  pushToTomorrow(t.moveToTomorrow, t.fitDay, items);
}

/** Saves the wrap-up note, clipped, with the time it was written. */
export function wrapUp(note: string): void {
  act(
    t.wrapUp,
    (data) => {
      data.settings.day = {
        ...data.settings.day,
        note: note.trim().slice(0, dayNoteMax),
        wrappedAt: Date.now(),
      };
    },
    { log: false },
  );
}

/** Clears the note. */
export function dismissNote(): void {
  act(
    t.dismissNote,
    (data) => {
      data.settings.day = { ...data.settings.day, note: "" };
    },
    { log: false },
  );
}

export function setDayHours(hours: DayState["hours"]): void {
  act(
    t.dayHours,
    (data) => {
      data.settings.day = { ...data.settings.day, hours };
    },
    { log: false },
  );
}

export function setMorning(morning: DayState["morning"]): void {
  act(
    t.morning,
    (data) => {
      data.settings.day = { ...data.settings.day, morning };
    },
    { log: false },
  );
}

/**
 * Adds a finished item to today's done list (newest first, one entry per key). Not undoable, no
 * log line, no toast: `bg` changes the data without a history entry; the persister saves it.
 */
export function recordDone(entry: DoneEntry): void {
  appStore().bg((data) => {
    const rest = data.settings.day.done.filter((e) => e.key !== entry.key);
    data.settings.day = {
      ...data.settings.day,
      done: [{ ...entry, title: clip(entry.title) }, ...rest].slice(0, doneMax),
    };
  });
}

/** Drops an item from the done list (it is open again). Not undoable. */
export function forgetDone(key: string): void {
  appStore().bg((data) => {
    if (data.settings.day.done.some((e) => e.key === key)) {
      data.settings.day = {
        ...data.settings.day,
        done: data.settings.day.done.filter((e) => e.key !== key),
      };
    }
  });
}
