// @vitest-environment happy-dom
import type { LogEntry } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clock, shortDate } from "../lib/format";
import { resetFindForTests } from "../lib/find";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { stubToolboxBridge } from "../lib/toolbox-test-bridge";
import { strings } from "../strings";
import { LogTool } from "./log-tool";

const t = strings.toolbox.log;
const hour = 3_600_000;

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const show = async (): Promise<void> => {
  render(<LogTool />);
  await settle();
};
const click = async (el: HTMLElement): Promise<void> => {
  act(() => {
    fireEvent.click(el);
  });
  await settle();
};

const me = () => appStore().getState().data.me;
const line = (n: number, at: number, who: string, over: Partial<LogEntry> = {}): LogEntry => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  at,
  who,
  text: `Change ${String(n)}`,
  ref: null,
  action: null,
  detail: null,
  ...over,
});

let noon: number;

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "toolbox", tab: "log" });
  // Noon today, so an hour earlier is still today and a day back is yesterday.
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  noon = d.getTime();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toolbox > Activity log", () => {
  it("says so when nothing was logged", async () => {
    stubToolboxBridge({ log: [] });
    await show();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint)).toBeTruthy();
  });

  it("groups lines by day with the count, and shows who and when", async () => {
    stubToolboxBridge({
      log: [
        line(1, noon, me()),
        line(2, noon - hour, "someone-else"),
        line(3, noon - 24 * hour, me()),
        line(4, noon - 5 * 24 * hour, me()),
      ],
      names: { "someone-else": "Dana Reyes" },
    });
    await show();
    const today = within(screen.getByRole("region", { name: t.today }));
    expect(today.getByText(t.changes(2))).toBeTruthy();
    expect(today.getByText(t.by(t.you, clock(noon)))).toBeTruthy();
    expect(today.getByText(t.by("Dana Reyes", clock(noon - hour)))).toBeTruthy();
    const yesterday = within(screen.getByRole("region", { name: t.yesterday }));
    expect(yesterday.getByText(t.changes(1))).toBeTruthy();
    expect(screen.getByRole("region", { name: shortDate(noon - 5 * 24 * hour) })).toBeTruthy();
  });

  it("filters by person with the chips and asks main for that person", async () => {
    const bridge = stubToolboxBridge({
      log: [
        line(1, noon, me()),
        line(2, noon - hour, "someone-else"),
        line(3, noon - 2 * hour, me()),
      ],
      names: { "someone-else": "Dana Reyes" },
    });
    await show();
    const chips = within(screen.getByRole("group", { name: t.peopleLabel }));
    expect(
      chips.getByRole("button", { name: `${t.everyone} 3` }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(chips.getByRole("button", { name: `${t.you} 2` })).toBeTruthy();
    await click(chips.getByRole("button", { name: "Dana Reyes 1" }));
    expect(bridge.calls.filter(([c]) => c === "log:page").at(-1)?.[1]).toMatchObject({
      who: "someone-else",
      before: null,
    });
    expect(screen.queryByText("Change 1")).toBeNull();
    expect(screen.getByText("Change 2")).toBeTruthy();
    expect(chips.getByRole("button", { name: "Dana Reyes 1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("pages 30 at a time, the next page starting after the last line", async () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(i + 1, noon - i * 60_000, me()));
    const bridge = stubToolboxBridge({ log: lines });
    await show();
    expect(screen.getAllByText(/^Change \d+$/)).toHaveLength(30);
    await click(screen.getByRole("button", { name: strings.toolbox.showMore }));
    expect(screen.getAllByText(/^Change \d+$/)).toHaveLength(45);
    expect(screen.queryByRole("button", { name: strings.toolbox.showMore })).toBeNull();
    const second = bridge.calls.filter(([c]) => c === "log:page").at(-1)?.[1] as {
      before: { at: number; id: string };
      limit: number;
    };
    expect(second.before).toEqual({ at: lines[29]?.at, id: lines[29]?.id });
    expect(second.limit).toBe(30);
  });

  it("opens the creator peek from a line that has a ref, and shows the creator name", async () => {
    const creator = appStore().getState().data.creators[0];
    expect(creator).toBeDefined();
    stubToolboxBridge({
      log: [line(1, noon, me(), { ref: creator?.id ?? null }), line(2, noon - hour, me())],
    });
    await show();
    const open = screen.getByText("Change 1").closest("button") as HTMLElement;
    expect(within(open).getByText(new RegExp(creator?.name ?? "x"))).toBeTruthy();
    expect(screen.getByText("Change 2").closest("button")).toBeNull();
    await click(open);
    expect(appStore().getState().ui.peek?.record).toEqual({ kind: "creator", id: creator?.id });
  });

  it("reads the first page again when the newest line changes, keeping older pages", async () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(i + 1, noon - i * 60_000, me()));
    const bridge = stubToolboxBridge({ log: lines });
    await show();
    await click(screen.getByRole("button", { name: strings.toolbox.showMore }));
    const before = bridge.calls.filter(([c]) => c === "log:page").length;
    act(() => {
      appStore().bg((data) => {
        data.log.unshift(line(99, noon + 1, me()));
      });
    });
    await settle();
    expect(bridge.calls.filter(([c]) => c === "log:page").length).toBe(before + 1);
    expect(screen.getAllByText(/^Change \d+$/)).toHaveLength(45);
  });

  it("gives the avatar the real name, not the word You", async () => {
    stubToolboxBridge({
      log: [line(1, noon, me()), line(2, noon - hour, "someone-else")],
      names: { [me()]: "Moe Khaled" },
    });
    await show();
    const mine = screen.getByText("Change 1").closest(".li") as HTMLElement;
    expect(within(mine).getByText("MK")).toBeTruthy();
    expect(within(mine).queryByText("YO")).toBeNull();
    // The text still says You.
    expect(within(mine).getByText(t.by(t.you, clock(noon)))).toBeTruthy();
    // A person with no name anywhere gets the placeholder, not a made-up one.
    const other = screen.getByText("Change 2").closest(".li") as HTMLElement;
    expect(within(other).queryByText("YO")).toBeNull();
  });

  it("uses the total main reports for Everyone", async () => {
    const bridge = stubToolboxBridge({ log: [line(1, noon, me())] });
    const invoke = window.gratovo.invoke;
    (window.gratovo as { invoke: unknown }).invoke = (channel: string, input: unknown) =>
      invoke(channel as never, input as never).then((r) =>
        channel === "log:page" && r.ok ? { ...r, value: { ...(r.value as object), total: 77 } } : r,
      );
    await show();
    expect(bridge.calls.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: `${t.everyone} 77` })).toBeTruthy();
  });

  it("moves Today to Yesterday when midnight passes", async () => {
    stubToolboxBridge({ log: [line(1, noon, me())] });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(noon);
    await show();
    expect(screen.getByRole("region", { name: t.today })).toBeTruthy();
    await act(async () => {
      vi.setSystemTime(noon + 13 * hour);
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(screen.getByRole("region", { name: t.yesterday })).toBeTruthy();
  });
});
