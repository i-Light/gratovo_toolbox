import type { IconName } from "@gratovo/ui";
import type { Store } from "@gratovo/core";

import { strings } from "../strings";
import { getPrefs, nameMax, setPref } from "./prefs";
import type { RecordRef, ScreenKey } from "./routes";
import type { NotifyKind, RowId, SectionKey } from "./settings";
import { appStore, go, selectRoute } from "./store";
import type { AppData, AppUi, MenuItem, Toast, ToastAction } from "./store";

/** How long the "Saving…" state lasts, in milliseconds. */
const savingMs = 700;
/** How long a toast stays when it does not say, in milliseconds. */
const defaultToastMs = 6500;
/** How many toasts show at once; the oldest go first. */
const maxToasts = 3;
/** How many records `recent` keeps. */
const maxRecent = 8;

/** The editable view of the business data a recipe receives (immer's draft, which the app does not import itself). */
type DataDraft = Parameters<Parameters<Store<AppData, AppUi>["bg"]>[0]>[0];
/** The editable view of the UI state. */
type UiDraft = Parameters<Parameters<Store<AppData, AppUi>["ui"]>[0]>[0];

let idCounter = 0;

/** A new id that has not been used before: "t1", "l2", and so on. */
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}${String(idCounter)}`;
}

let savingTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows "Saving…", then "Saved" 700 ms later. A new change restarts the wait. */
function markSaving(): void {
  appStore().ui((ui) => {
    ui.saving = true;
  });
  clearTimeout(savingTimer);
  savingTimer = setTimeout(() => {
    appStore().ui((ui) => {
      ui.saving = false;
      ui.savedAt = Date.now();
    });
  }, savingMs);
}

/** Shows a toast. Defaults: tone info, ms 6500 (also when ms is 0). Keeps the newest three. Returns its id. */
export function toast(t: {
  readonly msg: string;
  readonly sub?: string;
  readonly icon?: IconName;
  readonly tone?: "good" | "info";
  readonly ms?: number;
  readonly actions?: readonly ToastAction[];
}): string {
  const tone = t.tone ?? "info";
  const made: Toast = {
    id: uid("t"),
    msg: t.msg,
    ...(t.sub === undefined ? {} : { sub: t.sub }),
    icon: t.icon ?? (tone === "good" ? "check" : "info"),
    tone,
    ms: t.ms === undefined || t.ms === 0 ? defaultToastMs : t.ms,
    actions: t.actions ?? [],
  };
  appStore().ui((ui) => {
    ui.toasts = [...ui.toasts, made].slice(-maxToasts) as typeof ui.toasts; // immer drafts drop `readonly` on arrays
  });
  return made.id;
}

/** Removes a toast. */
export function dismissToast(id: string): void {
  appStore().ui((ui) => {
    ui.toasts = ui.toasts.filter((t) => t.id !== id);
  });
}

/** What `act` may show once the change is made. */
export interface ActToast {
  /** Defaults to the act's label. */
  readonly msg?: string;
  readonly sub?: string;
  /** Defaults to a check. */
  readonly icon?: IconName;
  /** Defaults to good. */
  readonly tone?: "good" | "info";
  readonly ms?: number;
  /** A button that goes somewhere; its label defaults to "View". */
  readonly go?: { readonly label?: string; readonly run: () => void };
  /** False leaves out the Undo button. */
  readonly undo?: boolean;
}

/**
 * Makes an undoable change. Runs `recipe` on the data; if it returns false nothing happens and
 * false comes back. Otherwise the change is recorded for Undo, a line is added to the activity log
 * (unless `log` is false), the save state shows "Saving…", and `toast` is shown. The toast's Undo
 * works only while this change is still the newest; after that it says newer changes came first.
 */
export function act<R>(
  label: string,
  recipe: (data: DataDraft, ui: AppUi) => R,
  options: { readonly log?: boolean; readonly toast?: ActToast } = {},
): R | false {
  const store = appStore();
  const before = store.peekUndo()?.id;
  const result = store.act(label, (data, ui) => {
    const value = recipe(data, ui);
    if (value !== false && options.log !== false) {
      data.log.unshift({ id: uid("l"), at: Date.now(), who: data.me, text: label });
    }
    return value;
  });
  if (result === false) {
    return false;
  }
  const recordedId = store.peekUndo()?.id;
  const recorded = recordedId !== undefined && recordedId !== before;
  if (recorded) {
    markSaving();
  }
  const t = options.toast;
  if (t !== undefined) {
    const actions: ToastAction[] = [];
    if (t.go !== undefined) {
      actions.push({ label: t.go.label ?? strings.actions.view, run: t.go.run });
    }
    if (t.undo !== false && recorded) {
      actions.push({
        label: strings.actions.undo,
        kbd: strings.actions.undoKbd,
        run: () => {
          if (appStore().peekUndo()?.id === recordedId) {
            undo();
          } else {
            toast({
              msg: strings.actions.newerChanges,
              sub: strings.actions.newerChangesSub,
              icon: "info",
              tone: "info",
            });
          }
        },
      });
    }
    toast({
      msg: t.msg ?? label,
      ...(t.sub === undefined ? {} : { sub: t.sub }),
      icon: t.icon ?? "check",
      tone: t.tone ?? "good",
      ...(t.ms === undefined ? {} : { ms: t.ms }),
      actions,
    });
  }
  return result;
}

/** Takes back the newest change and says so, with a Redo button; says "Nothing to undo" when there is none. */
export function undo(): void {
  const step = appStore().undo();
  if (step === undefined) {
    toast({ msg: strings.actions.nothingToUndo, icon: "info", tone: "info", ms: 2500 });
    return;
  }
  markSaving();
  toast({
    msg: strings.actions.undone,
    sub: step.label,
    icon: "undo",
    tone: "info",
    ms: 4000,
    actions: [{ label: strings.actions.redo, kbd: strings.actions.redoKbd, run: redo }],
  });
}

/** Puts back the change Undo took away. Does nothing when there is none. */
export function redo(): void {
  const step = appStore().redo();
  if (step === undefined) {
    return;
  }
  markSaving();
  toast({ msg: strings.actions.redone, sub: step.label, icon: "redo", tone: "info", ms: 3000 });
}

function addRecent(ui: UiDraft, record: RecordRef): void {
  const rest = ui.recent.filter((r) => !(r.kind === record.kind && r.id === record.id));
  ui.recent = [{ kind: record.kind, id: record.id }, ...rest].slice(0, maxRecent);
}

/** Opens a record in the side panel. `list` is the ids on screen, in order, for stepping. Adds it to `recent`. */
export function peek(record: RecordRef, list?: readonly string[]): void {
  appStore().ui((ui) => {
    ui.peek = {
      record: { kind: record.kind, id: record.id },
      list: list === undefined ? null : [...list],
    };
    addRecent(ui, record);
  });
}

/** Closes the side panel. */
export function closePeek(): void {
  appStore().ui((ui) => {
    ui.peek = null;
  });
}

/** Moves the side panel to the next (1) or previous (-1) record of its list; stays at the ends. */
export function stepPeek(by: 1 | -1): void {
  appStore().ui((ui) => {
    const p = ui.peek;
    if (p === null || p.list === null) {
      return;
    }
    const next = p.list[p.list.indexOf(p.record.id) + by];
    if (next !== undefined) {
      p.record = { kind: p.record.kind, id: next };
    }
  });
}

/** Opens a record on its own page, remembering the screen it came from. Adds it to `recent`. */
export function openRecord(record: RecordRef): void {
  const from: ScreenKey = selectRoute(appStore().getState()).screen;
  go("record", null, { record, from });
  appStore().ui((ui) => {
    addRecent(ui, record);
  });
}

/** Opens or closes the command palette. */
export function setPalette(open: boolean): void {
  appStore().ui((ui) => {
    ui.palette = open;
  });
}

/** Opens or closes the keyboard shortcut sheet. */
export function setShortcuts(open: boolean): void {
  appStore().ui((ui) => {
    ui.shortcuts = open;
  });
}

/** Opens a tray, or closes it when it is the one already open. */
export function toggleTray(tray: "jobs" | "notifications"): void {
  appStore().ui((ui) => {
    ui.tray = ui.tray === tray ? null : tray;
  });
}

/** Closes whichever tray is open. */
export function closeTray(): void {
  appStore().ui((ui) => {
    ui.tray = null;
  });
}

/** Opens a menu, named `label`, 4 px under the control it belongs to (`anchor` is that control's box). */
export function openMenu(
  anchor: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
  items: readonly MenuItem[],
  label: string,
  align: "start" | "end" = "start",
): void {
  appStore().ui((ui) => {
    ui.menu = {
      label,
      x: anchor.left,
      y: anchor.bottom + 4,
      right: anchor.right,
      top: anchor.top,
      align,
      items: [...items],
    };
  });
}

/** Closes the open menu. */
export function closeMenu(): void {
  appStore().ui((ui) => {
    ui.menu = null;
  });
}

/** Marks every notification read. Can be undone; leaves no line in the activity log. */
export function markAllRead(): void {
  act(
    strings.actions.markedRead,
    (data) => {
      for (const n of data.notifications) {
        n.read = true;
      }
    },
    { log: false },
  );
}

/**
 * Marks one notification read. Not an undoable change (it goes through `bg`), so undoing an older
 * change never marks it unread again.
 */
export function readNotification(id: string): void {
  appStore().bg((data) => {
    const n = data.notifications.find((x) => x.id === id);
    if (n !== undefined) {
      n.read = true;
    }
  });
}

/** How long a "Saved" mark stays on a setting, in milliseconds. */
const settingFlashMs = 1700;

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows "Saved" on a setting's row for 1700 ms. A new flash restarts the wait. */
export function flashSetting(id: RowId): void {
  appStore().ui((ui) => {
    ui.settingFlash = { id, at: Date.now() };
  });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    appStore().ui((ui) => {
      ui.settingFlash = null;
    });
  }, settingFlashMs);
}

/** Puts the saved `name` preference into the data (not undoable). Call once at start. */
export function loadMyName(): void {
  const name = getPrefs().name;
  appStore().bg((data) => {
    data.myName = name === "" ? null : name;
  });
}

/**
 * Sets your name: trimmed, at most 80 characters. Saved as a device preference, then copied into the
 * data. Not undoable. An empty name puts "Add your name" back. Shows "Saved" on the name row.
 */
export function setMyName(name: string): void {
  setPref("name", name.trim().slice(0, nameMax).trim());
  loadMyName();
  flashSetting("name");
}

/** Turns one kind of notification on or off for the bell. Undoable, no line in the activity log. */
export function setNotify(kind: NotifyKind, on: boolean): void {
  act(
    on
      ? strings.settings.turnedOn(strings.settings.notify[kind].noun)
      : strings.settings.turnedOff(strings.settings.notify[kind].noun),
    (data) => {
      data.settings.notify = { ...data.settings.notify, [kind]: on };
    },
    { log: false },
  );
  flashSetting("notify");
}

/** Opens a section of Settings and, when a row is named, asks the screen to scroll to it, highlight it and focus it. */
export function openSetting(section: SectionKey, row?: RowId): void {
  go("settings", section);
  appStore().ui((ui) => {
    ui.settingTarget = row ?? null;
  });
}
