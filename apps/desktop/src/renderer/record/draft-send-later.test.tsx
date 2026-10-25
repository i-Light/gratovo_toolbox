// @vitest-environment happy-dom
import type { OutreachDraft } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installPersistence } from "../lib/persist";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { DraftCard } from "./draft-card";

const later = strings.reach.later;
// Saturday 24 Oct 2026, 10:00.
const now = new Date(2026, 9, 24, 10, 0, 0).getTime();
const sam = "sam@gratovo.example";

let uninstall: () => void = () => undefined;

function setup(drafts: OutreachDraft[], creator = {}, zones: Record<string, string> = {}): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab", creator)],
    reachWith({ gemini: "ready", drafts, mailboxes: [goodMailbox(sam)], zones }),
  );
}

const draftOf = (id: string) =>
  appStore()
    .getState()
    .data.reach.drafts.find((d) => d.id === id);
const menu = () => appStore().getState().ui.menu;
const items = () => (menu()?.items ?? []).flatMap((i) => (i.kind === "item" ? [i] : []));
const arrow = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: later.menu });
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  stubReachBridge({ "find:item": { item: null } });
  resetAppStoreForTests({ screen: "reach", tab: "board" }, now);
  uninstall = installPersistence(((channel: string, input: unknown) =>
    window.gratovo.invoke(channel as "data:write", input as never)) as never);
});
afterEach(async () => {
  cleanup();
  await settle();
  uninstall();
  vi.useRealTimers();
});

describe("Send later", () => {
  it("opens a menu with their morning, tomorrow and Monday, and the day of each", () => {
    setup([aiDraft("d1", "c1")], {}, { c1: "Europe/London" });
    render(<DraftCard draftId="d1" />);
    fireEvent.click(arrow());
    expect(menu()?.label).toBe(later.menu);
    expect(items().map((i) => i.label)).toEqual([later.theirMorning, later.tomorrow, later.monday]);
    expect(items()[0]?.hint).toMatch(/09:00 their time$/);
    expect(items()[1]?.hint).toBe("Sun 25 Oct");
    expect(items()[2]?.hint).toBe("Mon 26 Oct");
  });

  it("says 09:00 your time when the creator's zone is not known", () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    fireEvent.click(arrow());
    expect(items()[0]?.hint).toMatch(/09:00 your time$/);
  });

  it("is disabled by a gate, with a tip", () => {
    setup([aiDraft("d1", "c1")], { emailConfirmed: false });
    render(<DraftCard draftId="d1" />);
    expect(arrow().disabled).toBe(true);
    expect(arrow().getAttribute("data-tip")).toBe(later.menuBlocked);
  });

  it("schedules the draft through an act, and Undo puts it back to ready", () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    fireEvent.click(arrow());
    act(() => {
      items()[1]?.run();
    });
    expect(draftOf("d1")?.state).toBe("scheduled");
    expect(draftOf("d1")?.sendAt).toBe(new Date(2026, 9, 25, 9, 0, 0).getTime());
    expect(
      screen.getByText(later.scheduledFor("Sun 25 Oct, 09:00") + later.fromBox(sam)),
    ).toBeTruthy();
    const toast = appStore().getState().ui.toasts.at(-1);
    expect(toast?.msg).toBe(later.toast("Sun 25 Oct, 09:00"));
    expect(toast?.actions.map((a) => a.label)).toEqual([strings.actions.undo]);
    act(() => {
      toast?.actions[0]?.run();
    });
    expect(draftOf("d1")?.state).toBe("ready");
    expect(draftOf("d1")?.sendAt).toBeNull();
  });

  it("cancels a scheduled draft from the card", () => {
    setup([aiDraft("d1", "c1", { state: "scheduled", sendAt: now + 86_400_000 })]);
    render(<DraftCard draftId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: later.cancel }));
    expect(draftOf("d1")?.state).toBe("ready");
  });
});
