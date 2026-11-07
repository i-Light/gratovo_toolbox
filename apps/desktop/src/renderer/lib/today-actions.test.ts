// @vitest-environment happy-dom
import { snoozeOptions, type DoneEntry } from "@gratovo/core/today";
import { beforeEach, describe, expect, it } from "vitest";

import { undo } from "./actions";
import { appStore, resetAppStoreForTests } from "./store";
import {
  bringBack,
  dismissNote,
  fitDay,
  moveToTomorrow,
  recordDone,
  setDayHours,
  snooze,
  wrapUp,
} from "./today-actions";

const day = () => appStore().getState().data.settings.day;
const undoId = () => appStore().peekUndo()?.id;
const soon = () => Date.now() + 3_600_000;

beforeEach(() => {
  resetAppStoreForTests({ screen: "today", tab: null });
});

describe("snooze", () => {
  it("stores until and title, and Undo restores", () => {
    const until = soon();
    const before = day();
    snooze("reply:a", "Prompt Lab replied", until);
    expect(day().snoozed["reply:a"]).toEqual({ until, title: "Prompt Lab replied" });
    undo();
    expect(day()).toEqual(before);
  });

  it("bringBack removes it", () => {
    snooze("reply:a", "Prompt Lab replied", soon());
    bringBack("reply:a");
    expect(day().snoozed).toEqual({});
  });
});

describe("moveToTomorrow and fitDay", () => {
  const items = [
    { key: "send:a", title: "Email Neural Notes" },
    { key: "send:b", title: "Email Tensor Talk" },
  ];

  it("snoozes every item to tomorrow morning", () => {
    moveToTomorrow(items);
    const until = snoozeOptions(Date.now(), day().morning).tomorrow;
    expect(Object.keys(day().snoozed)).toEqual(["send:a", "send:b"]);
    expect(day().snoozed["send:b"]).toEqual({ until, title: "Email Tensor Talk" });
  });

  it("fitDay does the same in one undo step", () => {
    fitDay(items);
    expect(Object.keys(day().snoozed)).toHaveLength(2);
    undo();
    expect(day().snoozed).toEqual({});
  });
});

describe("the note and the hours", () => {
  it("wrapUp clips the note and stamps the time; dismissNote clears it", () => {
    wrapUp("x".repeat(600));
    expect(day().note).toHaveLength(500);
    expect(day().wrappedAt).not.toBeNull();
    dismissNote();
    expect(day().note).toBe("");
  });

  it("setDayHours changes the hours", () => {
    setDayHours(6);
    expect(day().hours).toBe(6);
  });
});

describe("recordDone", () => {
  it("adds an entry and no undo step", () => {
    const entry: DoneEntry = {
      key: "contact:a",
      title: "Confirmed a contact",
      bucket: "contacts",
      at: Date.now(),
      minutes: 5,
    };
    const before = undoId();
    recordDone(entry);
    expect(day().done[0]).toEqual(entry);
    expect(undoId()).toBe(before);
  });
});
