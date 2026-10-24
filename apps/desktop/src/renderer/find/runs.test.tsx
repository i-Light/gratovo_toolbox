// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyFindFilter } from "@gratovo/core/find";

import { getPrefs } from "../lib/prefs";
import { aiChannel, stubFindBridge, type TestRun } from "../lib/find-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { Runs } from "./runs";
import { Triage, useReview } from "./triage";

const t = strings.findRuns;

const today = new Date();
today.setHours(14, 5, 0, 0);
const older = new Date(2026, 9, 12, 9, 30).getTime();
const run = (id: number, startedAt: number, over: Partial<TestRun> = {}): TestRun => ({
  id,
  startedAt,
  finishedAt: startedAt + 600_000,
  status: "done",
  keywords: 12,
  found: 340,
  kept: 41,
  gold: 3,
  ...over,
});

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "search" });
});
afterEach(cleanup);

/** Triage with the query the screen gives it. */
function ReviewNew() {
  return <Triage review={useReview()} />;
}

async function show(): Promise<void> {
  render(
    <>
      <Runs />
      <ReviewNew />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the Runs table", () => {
  it("says so when there are no searches yet", async () => {
    stubFindBridge();
    await show();
    expect(screen.getByText(t.empty)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists each run with its counts and a status tag", async () => {
    stubFindBridge({
      runs: [
        run(3, today.getTime(), { status: "running", gold: 0 }),
        run(2, older, { status: "interrupted", keywords: 5, found: 1200, kept: 80, gold: 7 }),
        run(1, older - 86_400_000, { status: "pending" }),
        // A search the person paused: a pause, not a failure.
        run(0, older - 2 * 86_400_000, { status: "stopped" }),
      ],
    });
    await show();
    const rows = within(screen.getByRole("table", { name: t.listLabel })).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rows[1]?.textContent).toContain(t.today("14:05"));
    expect(rows[1]?.textContent).toContain(t.status.running);
    expect(rows[2]?.textContent).toContain("Oct 12");
    expect(rows[2]?.textContent).toContain(t.status.stopped);
    const cells = within(rows[2] as HTMLElement)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(1, 5)).toEqual(["5", "1200", "80", "7"]);
    expect(rows[3]?.textContent).toContain(t.status.notStarted);
    expect(rows[4]?.textContent).toContain(t.status.paused);
    expect(rows[4]?.textContent).not.toContain(t.status.stopped);
  });

  it("opens Review new for the newest run, and the gallery filtered to an older one", async () => {
    stubFindBridge({
      items: [aiChannel("UC-a", "Agent Lab")],
      runs: [run(3, today.getTime()), run(2, older)],
    });
    await show();
    const buttons = screen.getAllByRole("button", { name: /^Review results of the search of / });
    await act(async () => {
      fireEvent.click(buttons[1] as HTMLElement);
      await Promise.resolve();
    });
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "find", tab: "gallery" });
    expect(getPrefs().findFilter).toEqual({ ...emptyFindFilter, runs: [2] });
    await act(async () => {
      fireEvent.click(buttons[0] as HTMLElement);
      await Promise.resolve();
    });
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "find", tab: "triage" });
  });
});
