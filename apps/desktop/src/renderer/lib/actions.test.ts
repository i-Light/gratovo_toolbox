// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  act,
  closeMenu,
  closePeek,
  closeTray,
  dismissToast,
  flashSetting,
  markAllRead,
  openMenu,
  openRecord,
  openSetting,
  peek,
  readNotification,
  redo,
  setMyName,
  setNotify,
  setPalette,
  setShortcuts,
  stepPeek,
  toast,
  toggleTray,
  undo,
} from "./actions";
import { exampleData } from "./example-data";
import { getPrefs, initPrefs, prefsKey } from "./prefs";
import type { Route } from "./routes";
import { appStore, resetAppStoreForTests, selectRoute } from "./store";

const today: Route = { screen: "today", tab: null };
const now = new Date(2026, 9, 19, 10, 24, 0).getTime();

const ui = () => appStore().getState().ui;
const data = () => appStore().getState().data;
/** The log lines the seed starts with; tests look only at the lines added after them. */
const seedLines = exampleData(now).log.length;
const added = () => data().log.slice(0, data().log.length - seedLines);
const unread = () => data().notifications.filter((n) => !n.read).length;

/** A recipe that changes the name, so each call is a recorded change. */
const setName =
  (name: string) =>
  (d: { myName: string | null }): void => {
    d.myName = name;
  };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  resetAppStoreForTests(today, now);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("act", () => {
  it("returns the recipe's result and adds a log line at the front", () => {
    expect(act("Renamed", (d) => (setName("Ana")(d), 7))).toBe(7);
    expect(data().myName).toBe("Ana");
    act("Renamed again", setName("Bo"));
    expect(added().map((l) => l.text)).toEqual(["Renamed again", "Renamed"]);
    expect(data().log[0]).toMatchObject({ at: now, who: "u1" });
  });

  it("gives each log line a UUID, so ids never collide with lines saved before a restart", () => {
    act("One", setName("Ana"));
    act("Two", setName("Bo"));
    const ids = added().map((l) => l.id);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it("leaves out the log line with log: false", () => {
    act("Quiet", setName("Ana"), { log: false });
    expect(added()).toEqual([]);
    expect(data().myName).toBe("Ana");
  });

  it("returns false and records nothing when the recipe does", () => {
    expect(
      act("Nope", (d) => {
        d.myName = "Ana";
        return false;
      }),
    ).toBe(false);
    expect(data().myName).toBeNull();
    expect(added()).toEqual([]);
    expect(appStore().peekUndo()).toBeUndefined();
    expect(ui().saving).toBe(false);
    expect(ui().toasts).toEqual([]);
  });

  it("marks saving, then saved 700 ms later with one restarted timer", () => {
    const before = ui().savedAt;
    act("One", setName("Ana"));
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(500);
    act("Two", setName("Bo"));
    vi.advanceTimersByTime(500);
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ui().saving).toBe(false);
    expect(ui().savedAt).toBe(now + 1000 + 200);
    expect(ui().savedAt).toBeGreaterThan(before);
  });

  it("shows a toast with the label, a check, the good tone and an Undo", () => {
    act("Renamed", setName("Ana"), { toast: {} });
    const [t] = ui().toasts;
    expect(t).toMatchObject({ msg: "Renamed", icon: "check", tone: "good", ms: 6500 });
    expect(t?.actions.map((a) => [a.label, a.kbd])).toEqual([["Undo", "Ctrl Z"]]);
  });

  it("puts the go action first, with View as its default label, and can drop Undo", () => {
    const run = vi.fn();
    act("Renamed", setName("Ana"), { toast: { go: { run }, undo: false, msg: "Done", sub: "s" } });
    const [t] = ui().toasts;
    expect(t).toMatchObject({ msg: "Done", sub: "s" });
    expect(t?.actions.map((a) => a.label)).toEqual(["View"]);
    t?.actions[0]?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it("Undo on the toast works while the change is the newest", () => {
    act("Renamed", setName("Ana"), { toast: {} });
    ui().toasts[0]?.actions[0]?.run();
    expect(data().myName).toBeNull();
    expect(ui().toasts.at(-1)?.msg).toBe("Undone");
  });

  it("Undo on the toast says newer changes came after, and changes nothing", () => {
    act("First", setName("Ana"), { toast: {} });
    const undoFirst = ui().toasts[0]?.actions[0];
    act("Second", setName("Bo"));
    undoFirst?.run();
    expect(data().myName).toBe("Bo");
    expect(ui().toasts.at(-1)).toMatchObject({
      msg: "Newer changes came after this one",
      tone: "info",
    });
  });
});

describe("undo and redo", () => {
  it("undoes with an Undone toast that offers Redo, and redo puts it back", () => {
    act("Renamed", setName("Ana"));
    undo();
    expect(data().myName).toBeNull();
    const t = ui().toasts.at(-1);
    expect(t).toMatchObject({
      msg: "Undone",
      sub: "Renamed",
      icon: "undo",
      tone: "info",
      ms: 4000,
    });
    expect(t?.actions.map((a) => [a.label, a.kbd])).toEqual([["Redo", "Ctrl Shift Z"]]);
    t?.actions[0]?.run();
    expect(data().myName).toBe("Ana");
    expect(ui().toasts.at(-1)).toMatchObject({
      msg: "Redone",
      sub: "Renamed",
      icon: "redo",
      ms: 3000,
    });
  });

  it("says Nothing to undo when there is nothing", () => {
    undo();
    expect(ui().toasts.at(-1)).toMatchObject({ msg: "Nothing to undo", icon: "info", ms: 2500 });
    expect(ui().saving).toBe(false);
  });

  it("does nothing on redo with nothing to redo", () => {
    redo();
    expect(ui().toasts).toEqual([]);
    expect(ui().saving).toBe(false);
  });

  it("marks saving on undo and redo", () => {
    act("Renamed", setName("Ana"));
    vi.advanceTimersByTime(700);
    undo();
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(700);
    redo();
    expect(ui().saving).toBe(true);
  });
});

describe("toast", () => {
  it("keeps the newest three, with unique ids", () => {
    const ids = [1, 2, 3, 4].map((n) => toast({ msg: String(n) }));
    expect(new Set(ids).size).toBe(4);
    expect(ui().toasts.map((t) => t.msg)).toEqual(["2", "3", "4"]);
  });

  it("defaults ms to 6500, also for 0, and keeps a given ms", () => {
    toast({ msg: "a" });
    toast({ msg: "b", ms: 0 });
    toast({ msg: "c", ms: 2000 });
    expect(ui().toasts.map((t) => t.ms)).toEqual([6500, 6500, 2000]);
  });

  it("dismisses one toast", () => {
    const a = toast({ msg: "a" });
    toast({ msg: "b" });
    dismissToast(a);
    expect(ui().toasts.map((t) => t.msg)).toEqual(["b"]);
  });
});

describe("peek and records", () => {
  const c = (id: string) => ({ kind: "creator", id }) as const;

  it("opens the peek and puts the record first in recent, without duplicates", () => {
    peek(c("c1"));
    peek(c("c2"));
    peek(c("c1"));
    expect(ui().peek).toEqual({ record: c("c1"), list: null });
    expect(ui().recent).toEqual([c("c1"), c("c2")]);
  });

  it("keeps at most 8 recent records", () => {
    for (let i = 1; i <= 10; i += 1) {
      peek(c(`x${String(i)}`));
    }
    expect(ui().recent).toHaveLength(8);
    expect(ui().recent[0]).toEqual(c("x10"));
    expect(ui().recent[7]).toEqual(c("x3"));
  });

  it("closes the peek", () => {
    peek(c("c1"));
    closePeek();
    expect(ui().peek).toBeNull();
  });

  it("steps through the list and stays at the ends", () => {
    peek(c("c1"), ["c1", "c2", "c3"]);
    stepPeek(-1);
    expect(ui().peek?.record.id).toBe("c1");
    stepPeek(1);
    stepPeek(1);
    expect(ui().peek?.record.id).toBe("c3");
    stepPeek(1);
    expect(ui().peek?.record.id).toBe("c3");
    expect(ui().peek?.list).toEqual(["c1", "c2", "c3"]);
  });

  it("does not step without a list or a peek", () => {
    stepPeek(1);
    expect(ui().peek).toBeNull();
    peek(c("c1"));
    stepPeek(1);
    expect(ui().peek?.record.id).toBe("c1");
  });

  it("opens a record page from the current screen and remembers it in recent", () => {
    appStore().ui((u) => {
      u.peek = { record: c("c1"), list: null };
    });
    openRecord(c("c2"));
    expect(selectRoute(appStore().getState())).toEqual({
      screen: "record",
      tab: null,
      record: c("c2"),
      from: "today",
    });
    expect(ui().peek).toBeNull();
    expect(ui().recent).toEqual([c("c2")]);
  });
});

describe("palette, sheet, trays and menus", () => {
  it("opens and closes the palette and the sheet", () => {
    setPalette(true);
    setShortcuts(true);
    expect(ui()).toMatchObject({ palette: true, shortcuts: true });
    setPalette(false);
    setShortcuts(false);
    expect(ui()).toMatchObject({ palette: false, shortcuts: false });
  });

  it("toggles a tray, switches between trays and closes it", () => {
    toggleTray("jobs");
    expect(ui().tray).toBe("jobs");
    toggleTray("notifications");
    expect(ui().tray).toBe("notifications");
    toggleTray("notifications");
    expect(ui().tray).toBeNull();
    toggleTray("jobs");
    closeTray();
    expect(ui().tray).toBeNull();
  });

  it("opens a menu 4 px under its anchor and closes it", () => {
    const items = [{ kind: "separator" }] as const;
    openMenu({ left: 10, right: 90, top: 20, bottom: 50 }, items, "Account", "end");
    expect(ui().menu).toEqual({
      label: "Account",
      x: 10,
      y: 54,
      right: 90,
      top: 20,
      align: "end",
      items,
    });
    closeMenu();
    expect(ui().menu).toBeNull();
    openMenu({ left: 1, right: 2, top: 3, bottom: 4 }, items, "Account");
    expect(ui().menu?.align).toBe("start");
  });
});

describe("notifications", () => {
  it("marks all read as one undoable change with no log line", () => {
    expect(unread()).toBe(3);
    markAllRead();
    expect(unread()).toBe(0);
    expect(added()).toEqual([]);
    undo();
    expect(unread()).toBe(3);
    expect(ui().toasts.at(-1)?.sub).toBe("Marked notifications read");
  });

  it("reads one notification without making an undo step", () => {
    readNotification("n1");
    expect(unread()).toBe(2);
    expect(appStore().peekUndo()).toBeUndefined();
    readNotification("missing");
    expect(unread()).toBe(2);
  });

  it("shows Saving… when reading one changed something, and not otherwise", () => {
    readNotification("missing");
    expect(ui().saving).toBe(false);
    readNotification("n1");
    expect(ui().saving).toBe(true);
    vi.advanceTimersByTime(700);
    expect(ui().saving).toBe(false);
  });

  it("keeps a read notification read when an older change is undone", () => {
    act("Renamed", setName("Ana"));
    readNotification("n1");
    undo();
    expect(data().myName).toBeNull();
    expect(data().notifications.find((n) => n.id === "n1")?.read).toBe(true);
  });
});

describe("setMyName", () => {
  // Your name moved from a device preference to your account (3d-1, G13): the tests that read the
  // `name` preference now read the data, which the persister writes to the database.
  it("trims, puts it in the data, flashes the name row and shows Saving…", () => {
    setMyName("  Ada Lovelace ");
    expect(data().myName).toBe("Ada Lovelace");
    expect(ui().settingFlash).toEqual({ id: "name", at: now });
    expect(ui().saving).toBe(true);
  });

  it("keeps at most 80 characters", () => {
    setMyName("x".repeat(100));
    expect(data().myName).toBe("x".repeat(80));
  });

  it("puts null back when the name is empty", () => {
    setMyName("Ada");
    setMyName("   ");
    expect(data().myName).toBeNull();
  });

  it("shows no Saving… when the name is the same", () => {
    setMyName("Ada");
    vi.advanceTimersByTime(700);
    setMyName(" Ada ");
    expect(ui().saving).toBe(false);
  });

  it("is not undoable and leaves no log line", () => {
    act("Renamed", setName("Ana"));
    setMyName("Ada");
    expect(added()).toHaveLength(1);
    undo();
    expect(data().myName).toBe("Ada");
    undo();
    expect(data().myName).toBe("Ada");
  });

  it("is not put on the page", () => {
    setMyName("Ada");
    expect(document.documentElement.getAttributeNames().join(" ")).not.toContain("name");
  });
});

describe("a name saved as a preference by an older build", () => {
  // The `name` preference and `loadMyName` are gone (G13): the name comes from the database.
  afterEach(() => {
    localStorage.clear();
    initPrefs();
  });

  it("is ignored: not in the preferences, not in the data", () => {
    localStorage.setItem(prefsKey, JSON.stringify({ name: "Maya", rail: "min" }));
    initPrefs();
    resetAppStoreForTests(today, now);
    expect(getPrefs()).not.toHaveProperty("name");
    expect(getPrefs().rail).toBe("min");
    expect(data().myName).toBeNull();
  });
});

describe("flashSetting", () => {
  it("shows for 1700 ms", () => {
    flashSetting("density");
    expect(ui().settingFlash).toEqual({ id: "density", at: now });
    vi.advanceTimersByTime(1699);
    expect(ui().settingFlash).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(ui().settingFlash).toBeNull();
  });

  it("restarts the wait when another flash comes", () => {
    flashSetting("density");
    vi.advanceTimersByTime(1000);
    flashSetting("size");
    vi.advanceTimersByTime(1000);
    expect(ui().settingFlash?.id).toBe("size");
    vi.advanceTimersByTime(700);
    expect(ui().settingFlash).toBeNull();
  });
});

describe("setNotify", () => {
  it("turns a kind off and on, with no log line, and flashes the row", () => {
    setNotify("reply", false);
    expect(data().settings.notify).toEqual({ reply: false });
    expect(added()).toEqual([]);
    expect(ui().settingFlash?.id).toBe("notify");
    setNotify("reply", true);
    expect(data().settings.notify).toEqual({ reply: true });
  });

  it("is undone with Undo, with the prototype's label", () => {
    setNotify("money", false);
    expect(appStore().peekUndo()?.label).toBe("Turned off money notifications");
    undo();
    expect(data().settings.notify).toEqual({});
    redo();
    expect(data().settings.notify).toEqual({ money: false });
    setNotify("money", true);
    expect(appStore().peekUndo()?.label).toBe("Turned on money notifications");
  });
});

describe("openSetting", () => {
  it("goes to the section and names the row to reach", () => {
    openSetting("appearance", "density");
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "settings",
      tab: "appearance",
    });
    expect(ui().settingTarget).toBe("density");
  });

  it("clears the target when no row is named", () => {
    openSetting("appearance", "density");
    openSetting("keyboard");
    expect(selectRoute(appStore().getState()).tab).toBe("keyboard");
    expect(ui().settingTarget).toBeNull();
  });
});
