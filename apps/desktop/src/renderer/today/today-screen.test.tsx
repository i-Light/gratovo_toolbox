// @vitest-environment happy-dom
import { todayBuckets } from "@gratovo/core/today";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGlobalKeys, useKeyListener } from "../app/global-keys";
import { undo } from "../lib/actions";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { TodayScreen } from "./today-screen";

const t = strings.today.screen;
const ui = () => appStore().getState().ui;

function Keys() {
  useGlobalKeys();
  useKeyListener();
  return null;
}

async function show() {
  const view = render(
    <>
      <Keys />
      <TodayScreen />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

const press = async (key: string, init: { ctrlKey?: boolean } = {}): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(document.body, { key, ...init });
    await Promise.resolve();
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};

const rows = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-ui="today.row"]'));
const current = (container: HTMLElement): string | null =>
  rows(container).find((r) => r.getAttribute("aria-current") === "true")?.dataset["key"] ?? null;

beforeEach(() => {
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(cleanup);

describe("the Today screen", () => {
  it("shows the head, the day band and the buckets in order with their counts", async () => {
    const { container } = await show();
    expect(container.querySelector('[data-ui="today.head"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="today.band"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="today.band.mail"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="today.band.done"]')).not.toBeNull();
    expect(screen.getByRole("region", { name: t.queue.region })).toBeTruthy();
    const buckets = Array.from(
      container.querySelectorAll<HTMLElement>('[data-ui^="today.queue.bucket."]'),
    );
    expect(buckets.length).toBeGreaterThan(1);
    const keys = buckets.map((b) => (b.dataset["ui"] ?? "").split(".").pop() ?? "");
    const ranks = keys.map((k) => todayBuckets.indexOf(k as (typeof todayBuckets)[number]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const bucket of buckets) {
      const count = bucket.querySelectorAll('[data-ui="today.row"]').length;
      expect(count).toBeGreaterThan(0);
      const head = within(bucket).getAllByRole("button")[0];
      expect(head?.textContent).toContain(String(count));
    }
    expect(screen.getByRole("img", { name: new RegExp(t.band.barLabel("")) })).toBeTruthy();
  });

  it("filters to quick wins with the chip", async () => {
    const { container } = await show();
    const all = rows(container).length;
    await click(screen.getByRole("button", { name: new RegExp(t.queue.quick) }));
    expect(ui().today.filter).toBe("quick");
    const quick = rows(container);
    expect(quick.length).toBeGreaterThan(0);
    expect(quick.length).toBeLessThan(all);
    for (const row of quick) {
      expect(within(row).getByRole("img", { name: t.queue.quickTip })).toBeTruthy();
    }
  });

  it("moves the open item with J and K, and folds a bucket", async () => {
    const { container } = await show();
    const list = rows(container);
    expect(current(container)).toBe(list[0]?.dataset["key"]);
    await press("j");
    expect(current(container)).toBe(list[1]?.dataset["key"]);
    await press("k");
    expect(current(container)).toBe(list[0]?.dataset["key"]);
    const first = container.querySelector<HTMLElement>('[data-ui^="today.queue.bucket."]');
    const head = within(first as HTMLElement).getAllByRole("button")[0] as HTMLElement;
    await click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(within(first as HTMLElement).queryAllByRole("button", { current: true })).toHaveLength(
      0,
    );
    expect(ui().today.folded).toHaveLength(1);
  });

  it("enters focus with F and leaves it with Escape", async () => {
    const { container } = await show();
    await press("f");
    expect(ui().today.focusAt).not.toBeNull();
    expect(container.querySelector('[data-ui="today.focus"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="today.head"]')).toBeNull();
    expect(container.querySelector('[data-ui="today.queue"]')).toBeNull();
    await press("Escape");
    expect(ui().today.focusAt).toBeNull();
    expect(container.querySelector('[data-ui="today.head"]')).not.toBeNull();
  });

  it("snoozes the open item from the Z menu, and Ctrl Z brings it back", async () => {
    const { container } = await show();
    const key = current(container);
    expect(key).not.toBeNull();
    await press("z");
    const menu = ui().menu;
    expect(menu?.label).toBe(t.snoozeMenu.label);
    const pick = menu?.items.find((i) => i.kind === "item" && i.label === t.snoozeMenu.tomorrow);
    expect(pick).toBeDefined();
    await act(async () => {
      if (pick?.kind === "item") {
        pick.run();
      }
      await Promise.resolve();
    });
    expect(rows(container).some((r) => r.dataset["key"] === key)).toBe(false);
    const snoozed = container.querySelector('[data-ui="today.snoozed"]');
    expect(snoozed).not.toBeNull();
    expect(appStore().getState().data.settings.day.snoozed[key ?? ""]).toBeDefined();
    await act(async () => {
      undo();
      await Promise.resolve();
    });
    expect(rows(container).some((r) => r.dataset["key"] === key)).toBe(true);
    expect(container.querySelector('[data-ui="today.snoozed"]')).toBeNull();
  });

  it("wraps up the day: tiles, then Finish the day saves the note", async () => {
    const { container } = await show();
    await click(screen.getByRole("button", { name: t.wrapUp }));
    const wrap = container.querySelector('[data-ui="today.wrap"]') as HTMLElement;
    expect(wrap).not.toBeNull();
    for (const label of [t.wrap.done, t.wrap.sent, t.wrap.open]) {
      expect(within(wrap).getByText(label)).toBeTruthy();
    }
    const note = within(wrap).getByRole<HTMLTextAreaElement>("textbox");
    await act(async () => {
      fireEvent.change(note, { target: { value: "Start with the replies" } });
      await Promise.resolve();
    });
    await click(within(wrap).getByRole("button", { name: t.wrap.finish }));
    const day = appStore().getState().data.settings.day;
    expect(day.note).toBe("Start with the replies");
    expect(day.wrappedAt).not.toBeNull();
    expect(ui().today.wrap).toBe(false);
  });

  it("shows the first-day card when there are no creators and no deals", async () => {
    appStore().bg((d) => {
      const data = d as unknown as Record<string, unknown>;
      data["creators"] = [];
      data["deals"] = [];
      data["brands"] = [];
      data["reach"] = { ...d.reach, drafts: [], threads: [], sequences: [] };
    });
    const { container } = await show();
    expect(rows(container)).toHaveLength(0);
    expect(container.querySelector('[data-ui="today.first"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(t.first.search) })).toBeTruthy();
  });
});
