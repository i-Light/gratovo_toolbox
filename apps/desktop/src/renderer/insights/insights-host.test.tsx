// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adoptServerData } from "../lib/persist";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { InsightsHost } from "./insights-host";
import { fullAlerts, overviewReport } from "./test-reports";
import { goalReport, searchReport } from "./test-reports-search";
import { summaryDocument } from "./words/summary";

const t = strings.insights;

let calls: [string, unknown][] = [];
const row = (n: number) => ({
  id: `UC-${String(n)}`,
  name: `Creator ${String(n)}`,
  handle: null,
  note: null,
});

function bridge(): void {
  calls = [];
  const invoke = (channel: string, input: unknown) => {
    calls.push([channel, input]);
    const q = input as { tab?: string; offset?: number };
    switch (channel) {
      case "insights:read":
        return Promise.resolve({
          ok: true,
          value:
            q.tab === "overview"
              ? overviewReport
              : q.tab === "search"
                ? searchReport()
                : goalReport(),
        });
      case "insights:list": {
        const offset = q.offset ?? 0;
        const rows = Array.from({ length: offset === 0 ? 100 : 20 }, (_, i) => row(offset + i));
        return Promise.resolve({ ok: true, value: { rows, total: 120 } });
      }
      case "insights:hide":
        return Promise.resolve({ ok: true, value: { hidden: {} } });
      case "insights:goal":
        return Promise.resolve({ ok: true, value: { signsPerMonth: 6, overrides: {} } });
      default:
        return Promise.resolve({ ok: false, reason: "test" });
    }
  };
  (window as unknown as { gratovo: unknown }).gratovo = { invoke, on: () => () => undefined };
}

function reads(): { tab: string; period: string; deals: boolean }[] {
  return calls
    .filter(([c]) => c === "insights:read")
    .map(([, i]) => i as { tab: string; period: string; deals: boolean });
}

function seed(tab: string): void {
  resetAppStoreForTests({ screen: "insights", tab });
  adoptServerData((d) => {
    d.source = "example";
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  bridge();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Insights host on live data", () => {
  it("asks for no deals in every read and list, until deals are wired", async () => {
    resetAppStoreForTests({ screen: "insights", tab: "overview" });
    adoptServerData((d) => {
      d.source = "live";
    });
    render(<InsightsHost />);
    await settle();
    expect(reads()).toEqual([{ tab: "overview", period: "30d", deals: false }]);
    fireEvent.click(screen.getByRole("button", { name: t.overview.vitals.fuel.open("58") }));
    await settle();
    expect(calls.at(-1)).toEqual([
      "insights:list",
      { drill: { kind: "fuel" }, period: "30d", offset: 0, deals: false },
    ]);
  });
});

describe("the Insights host", () => {
  it("reads the route's tab for the period, and again when the period changes", async () => {
    seed("overview");
    render(<InsightsHost />);
    expect(screen.getByRole("status").textContent).toBe(t.reading);
    await settle();
    expect(reads()).toEqual([{ tab: "overview", period: "30d", deals: true }]);
    expect(screen.getByLabelText(t.overview.summary.label)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.periods["7d"] }));
    await settle();
    expect(reads().at(-1)).toEqual({ tab: "overview", period: "7d", deals: true });
  });

  it("shows a plain error with Try again when the first read fails", async () => {
    seed("overview");
    (window as unknown as { gratovo: { invoke: unknown } }).gratovo.invoke = () =>
      Promise.resolve({ ok: false, reason: "test" });
    render(<InsightsHost />);
    await settle();
    expect(screen.getByText(t.readFailed)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.tryAgain })).toBeTruthy();
  });

  it("opens the drill sheet from a number and loads more", async () => {
    seed("overview");
    render(<InsightsHost />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: t.overview.vitals.fuel.open("58") }));
    await settle();
    const sheet = screen.getByRole("dialog", { name: t.drill.names.fuel });
    expect(within(sheet).getAllByRole("button", { name: /^Open Creator/ })).toHaveLength(100);
    expect(calls.at(-1)).toEqual([
      "insights:list",
      { drill: { kind: "fuel" }, period: "30d", offset: 0, deals: true },
    ]);
    fireEvent.click(within(sheet).getByRole("button", { name: t.drill.more }));
    await settle();
    expect(calls.at(-1)).toEqual([
      "insights:list",
      { drill: { kind: "fuel" }, period: "30d", offset: 100, deals: true },
    ]);
    expect(within(sheet).getAllByRole("button", { name: /^Open Creator/ })).toHaveLength(120);
    fireEvent.click(within(sheet).getByRole("button", { name: /^Open Creator 3$/ }));
    expect(appStore().getState().ui.peek?.record).toEqual({ kind: "creator", id: "UC-3" });
    expect(screen.queryByRole("dialog", { name: t.drill.names.fuel })).toBeNull();
  });

  it("hides an alert for 7 days and reads again", async () => {
    seed("overview");
    render(<InsightsHost />);
    await settle();
    const before = reads().length;
    const title = "outreach3@gratovo.co is bouncing";
    const now = Date.now();
    fireEvent.click(screen.getByRole("button", { name: t.overview.attention.hideLabel(title) }));
    await settle();
    const hide = calls.find(([c]) => c === "insights:hide");
    expect(hide?.[1]).toMatchObject({ key: fullAlerts[0]?.key });
    const until = (hide?.[1] as { until: number }).until;
    expect(until - now).toBeGreaterThanOrEqual(7 * 86_400_000);
    expect(until - now).toBeLessThan(7 * 86_400_000 + 60_000);
    expect(reads().length).toBeGreaterThan(before);
  });

  it("commits the goal and reads again", async () => {
    seed("goal");
    render(<InsightsHost />);
    await settle();
    const input = screen.getByLabelText(new RegExp(t.goal.inputLabel));
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(calls.find(([c]) => c === "insights:goal")?.[1]).toEqual({ signsPerMonth: 6 });
    expect(reads().filter((r) => r.tab === "goal").length).toBeGreaterThan(1);
  });

  it("copies the Overview summary", async () => {
    seed("search");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<InsightsHost />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: t.copySummary }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(summaryDocument(overviewReport, "30d"));
    });
    expect(reads()).toContainEqual({ tab: "overview", period: "30d", deals: true });
  });
});
