// @vitest-environment happy-dom
import type { FindState } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { emptyFacets, fitOf } from "@gratovo/core/find";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAccountViewForTests, setAccountView } from "../lib/account";
import { resetFindForTests } from "../lib/find";
import { aiChannel } from "../lib/find-test-bridge";
import { exampleData } from "../lib/example-data";
import { appStore, initAppStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { FindScreen } from "./find-screen";
import { resetReviewRunForTests } from "./triage";

const t = strings.findSearch;

const rules: FindState["rules"] = {
  countries: ["US", "GB"],
  perKeyword: 200,
  sortBy: "upload_date",
  resultsType: "video",
  autoClean: {
    enabled: true,
    minSubscribers: 50_000,
    maxSubscribers: 2_000_000,
    belowMin: "sweep",
    aboveMax: "delay",
    label: "inactive",
  },
  minMedianViews: null,
  minUploads30: null,
  archiveDays: 7,
};

type Queue = FindState["queue"];
const kw = (
  keyword: string,
  state: Queue[number]["state"],
  found = 0,
  kept = 0,
): Queue[number] => ({
  keyword,
  state,
  found,
  kept,
});

function makeState(over: Partial<FindState> = {}): FindState {
  return {
    queue: [
      kw("ai video editor", "done", 40, 10),
      kw("claude code tips", "queued"),
      kw("ai news today", "queued"),
    ],
    at: 1,
    rules,
    run: { state: "paused", found: 40, kept: 10, swept: 12, error: null },
    log: [],
    kept: [],
    ...over,
  };
}
const withRun = (
  state: FindState["run"]["state"],
  extra: Partial<FindState["run"]> = {},
  over: Partial<FindState> = {},
): FindState =>
  makeState({ run: { state, found: 40, kept: 10, swept: 12, error: null, ...extra }, ...over });

const runningState = (): FindState =>
  withRun("running", {}, { queue: [kw("ai agents", "running"), kw("llm news", "queued")], at: 0 });

type Invoke = (channel: string, input: unknown) => Promise<unknown>;
let calls: [string, unknown][];
let listener: ((state: FindState) => void) | null;
let answers: Record<string, unknown>;

function install(invoke: Invoke): void {
  listener = null;
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: ((name: string, fn: (state: FindState) => void) => {
      if (name !== "find:changed") {
        return () => undefined;
      }
      listener = fn;
      return () => {
        listener = null;
      };
    }) as unknown as Bridge["on"],
  };
}

function setup(state: FindState, answer: Record<string, unknown> = {}): void {
  calls = [];
  answers = {
    "find:state": { ok: true, value: state },
    "find:query": { ok: true, value: { version: 0, total: 0, items: [], facets: emptyFacets } },
    "find:runs": { ok: true, value: { runs: [] } },
    ...answer,
  };
  install((channel, input) => {
    calls.push([channel, input]);
    return Promise.resolve(answers[channel] ?? { ok: true, value: { ok: true } });
  });
}

async function show(): Promise<void> {
  render(<FindScreen />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "find", tab: "search" });
  setAccountView({ signedIn: true, email: "me@example.com" });
});
afterEach(() => {
  cleanup();
  resetAccountViewForTests();
});

const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};
const push = (state: FindState): void => {
  act(() => {
    listener?.(state);
  });
};
const headingText = (): string =>
  screen.getByRole("heading", {
    level: 3,
    name: /Searching|Finished|Not started|Paused|Stopped|Stopping/,
  }).textContent;

describe("the run headline and button, by state", () => {
  const cases: readonly [string, () => FindState, string, string | null][] = [
    ["running", runningState, "Searching “ai agents”", t.live.pause],
    [
      "done",
      () => withRun("done", {}, { queue: [kw("a", "done", 1, 1), kw("b", "done")], at: 2 }),
      t.live.done,
      null,
    ],
    [
      "ready",
      () => withRun("ready", {}, { queue: [kw("a", "queued"), kw("b", "queued")], at: 0 }),
      t.live.ready(2),
      t.live.start,
    ],
    ["paused", () => withRun("paused"), t.live.paused(2), t.live.resume(2)],
    ["failed", () => withRun("failed", { error: "quota" }), t.live.failed(2), t.live.retry(2)],
    ["stopping", () => withRun("stopping"), t.live.stopping, t.live.pause],
    // After a restart the run is "ready" again; the queue says how far it got.
    [
      "ready after a finished run",
      () => withRun("ready", {}, { queue: [kw("a", "done", 1, 1), kw("b", "done")], at: 2 }),
      t.live.done,
      null,
    ],
    ["ready after a paused run", () => withRun("ready"), t.live.paused(2), t.live.resume(2)],
    [
      "done, with a keyword added since",
      () => withRun("done", {}, { queue: [kw("a", "done", 1, 1), kw("b", "queued")], at: 1 }),
      t.live.ready(1),
      t.live.start,
    ],
  ];
  it.each(cases)("%s", async (_name, state, headline, button) => {
    setup(state());
    await show();
    expect(headingText()).toBe(headline);
    if (button === null) {
      expect(
        screen.queryByRole("button", { name: /Pause|Start the search|Resume|Try again/ }),
      ).toBeNull();
    } else {
      expect(screen.getByRole("button", { name: button })).toBeTruthy();
    }
  });

  it("shows no button when every keyword is done", async () => {
    setup(withRun("ready", {}, { queue: [kw("a", "done", 1, 1)], at: 1 }));
    await show();
    expect(screen.queryByRole("button", { name: t.live.start })).toBeNull();
  });

  it("shows the tallies and the progress", async () => {
    setup(makeState());
    await show();
    const live = screen.getByRole("region", { name: /Paused/ });
    expect(within(live).getByText("40")).toBeTruthy();
    expect(within(live).getByText("12")).toBeTruthy();
    expect(within(live).getByText("1/3")).toBeTruthy();
    expect(within(live).getByRole("meter").getAttribute("aria-valuenow")).toBe("1");
  });
});

describe("start and pause", () => {
  it("calls find:start and find:stop", async () => {
    setup(withRun("paused"));
    await show();
    await click(screen.getByRole("button", { name: t.live.resume(2) }));
    expect(calls).toContainEqual(["find:start", {}]);
    push(runningState());
    await click(screen.getByRole("button", { name: t.live.pause }));
    expect(calls).toContainEqual(["find:stop", {}]);
    expect(screen.getByText(t.live.pauseHint)).toBeTruthy();
  });

  it.each(["no_keywords", "running", "no_youtube_key", "no_python"] as const)(
    "says why find:start refused: %s",
    async (problem) => {
      setup(withRun("ready", {}, { at: 0 }), {
        "find:start": { ok: true, value: { ok: false, problem } },
      });
      await show();
      await click(screen.getByRole("button", { name: t.live.start }));
      expect(screen.getByText(t.startProblems[problem])).toBeTruthy();
    },
  );
});

describe("the error callouts", () => {
  it.each(["no_youtube_key", "quota", "blocked", "network", "crash"] as const)(
    "%s",
    async (error) => {
      setup(withRun("failed", { error }));
      await show();
      expect(screen.getByRole("alert").textContent).toBe(t.errors[error]);
    },
  );
  it("shows none when the run did not fail", async () => {
    setup(makeState());
    await show();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the log", () => {
  it("is a polite log region with the empty text", async () => {
    setup(makeState());
    await show();
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.textContent).toBe(t.live.logEmpty);
  });
  it("lists each line with its time and follows find:changed", async () => {
    const at = new Date(2026, 9, 21, 9, 2).getTime();
    setup(makeState({ log: [{ at, level: "info", text: "Started keyword 2" }] }));
    await show();
    expect(screen.getByRole("log").textContent).toContain("09:02 Started keyword 2");
    push(
      makeState({
        log: [
          { at, level: "info", text: "Started keyword 2" },
          { at, level: "warn", text: "Slow answer" },
        ],
      }),
    );
    expect(screen.getByRole("log").textContent).toContain("Slow answer");
  });
});

describe("keywords", () => {
  it("shows the count and a row per state", async () => {
    setup(
      makeState({
        queue: [
          kw("one", "done", 40, 10),
          kw("two", "running"),
          kw("three", "queued"),
          kw("four", "queued"),
          kw("five", "failed"),
        ],
        at: 2,
      }),
    );
    await show();
    expect(screen.getByText("5 · 1 done")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: t.keywords.listLabel })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain("40 found · 10 kept");
    expect(items[1]?.textContent).toContain("searching");
    expect(items[2]?.textContent).toContain("next up");
    expect(items[3]?.textContent).toContain("queued");
    expect(items[4]?.textContent).toContain("failed");
  });

  it("offers Start here only on a queued row that is not next, and nothing while running", async () => {
    setup(makeState({ queue: [kw("three", "queued"), kw("four", "queued")], at: 0 }));
    await show();
    expect(screen.getAllByRole("button", { name: /^Start here at/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove three" })).toBeTruthy();
    push(runningState());
    expect(screen.queryByRole("button", { name: /^Start here/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("calls find:start-at and find:remove with the row's index", async () => {
    setup(makeState({ at: 0, queue: [kw("three", "queued"), kw("four", "queued")] }));
    await show();
    await click(screen.getByRole("button", { name: "Start here at four" }));
    expect(calls).toContainEqual(["find:start-at", { index: 1 }]);
    await click(screen.getByRole("button", { name: "Remove four" }));
    expect(calls).toContainEqual(["find:remove", { index: 1 }]);
  });

  it("says to pause first when main refuses an edit", async () => {
    setup(makeState({ at: 0 }), {
      "find:remove": { ok: true, value: { ok: false, problem: "running" } },
    });
    await show();
    await click(screen.getByRole("button", { name: "Remove ai video editor" }));
    expect(screen.getByText(t.keywords.editRunning)).toBeTruthy();
  });

  it("adds pasted keywords split on lines and commas, and says how many were added and skipped", async () => {
    setup(makeState(), { "find:add": { ok: true, value: { added: 2, skipped: 1 } } });
    await show();
    const box = screen.getByRole("textbox", { name: t.keywords.inputLabel });
    const add = screen.getByRole("button", { name: t.keywords.add });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(t.keywords.hintEmpty)).toBeTruthy();
    fireEvent.change(box, { target: { value: "ai agents\nllm news, ai agents\n\n" } });
    expect(screen.getByText("3 keywords ready to add")).toBeTruthy();
    await click(add);
    expect(calls).toContainEqual([
      "find:add",
      { keywords: ["ai agents", "llm news", "ai agents"] },
    ]);
    expect(screen.getByText("Added 2 keywords. 1 skipped (already in the list).")).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("refuses a keyword over 200 characters before calling main", async () => {
    setup(makeState());
    await show();
    fireEvent.change(screen.getByRole("textbox", { name: t.keywords.inputLabel }), {
      target: { value: "a".repeat(201) },
    });
    await click(screen.getByRole("button", { name: t.keywords.add }));
    expect(screen.getByText(t.keywords.tooLong)).toBeTruthy();
    expect(calls.some(([c]) => c === "find:add")).toBe(false);
  });

  it("keeps the text when the add fails", async () => {
    setup(makeState(), { "find:add": { ok: false, reason: "x" } });
    await show();
    const box = screen.getByRole("textbox", { name: t.keywords.inputLabel });
    fireEvent.change(box, { target: { value: "ai agents" } });
    await click(screen.getByRole("button", { name: t.keywords.add }));
    expect(screen.getByText(t.keywords.addFailed)).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("ai agents");
  });
});

describe("rules", () => {
  it("shows the countries, the count and the auto-clean band", async () => {
    setup(makeState());
    await show();
    const card = screen.getByRole("region", { name: t.rules.title });
    expect(card.textContent).toContain("US · GB");
    expect(card.textContent).toContain("200 channels per keyword");
    expect(card.textContent).toContain("Archive under 50K subscribers");
    expect(card.textContent).toContain("Leave over 2M for later");
  });
  it("shows the median, uploads and archive days", async () => {
    setup(makeState({ rules: { ...rules, minMedianViews: 50_000, minUploads30: 4 } }));
    await show();
    const card = screen.getByRole("region", { name: t.rules.title });
    expect(card.textContent).toContain("Keep: 50K+ median views");
    expect(card.textContent).toContain("Keep: 4+ uploads in 30 days");
    expect(card.textContent).toContain("Rejects archived after 7 days");
  });
  it("shows the two minimums as any when they are off", async () => {
    setup(makeState());
    await show();
    expect(screen.getByText(t.rules.medianAny)).toBeTruthy();
    expect(screen.getByText(t.rules.uploadsAny)).toBeTruthy();
  });
  it("opens Settings › Search rules from Edit rules", async () => {
    setup(makeState());
    await show();
    await click(screen.getByRole("button", { name: t.rules.editRules }));
    expect(selectRoute(appStore().getState())).toEqual({ screen: "settings", tab: "search" });
  });
  it("says auto-clean is off", async () => {
    setup(makeState({ rules: { ...rules, autoClean: { ...rules.autoClean, enabled: false } } }));
    await show();
    expect(screen.getByText(t.rules.cleanOff)).toBeTruthy();
  });
});

describe("the tabs", () => {
  const one = aiChannel("UC-1", "Agent Lab");
  const onTriage = {
    "find:query": {
      ok: true,
      value: { version: 1, total: 7, items: [{ ...one, fit: fitOf(one) }], facets: emptyFacets },
    },
  };
  const names = (): string[] => screen.getAllByRole("tab").map((el) => el.textContent);

  it("shows only Search and Review new on live data, with the count", async () => {
    initAppStore({ ...exampleData(Date.now()), source: "live" }, { screen: "find", tab: "search" });
    setup(makeState(), onTriage);
    await show();
    expect(names()).toEqual([
      strings.screens.find.tabs.search,
      `${strings.screens.find.tabs.triage}7`,
    ]);
    expect(screen.getByText(strings.findTriage.liveSub)).toBeTruthy();
    await click(screen.getByRole("tab", { name: new RegExp(strings.screens.find.tabs.triage) }));
    expect(selectRoute(appStore().getState()).tab).toBe("triage");
  });

  it("shows all four tabs on example data", async () => {
    setup(makeState(), onTriage);
    await show();
    expect(names()).toHaveLength(4);
    expect(screen.getByText(strings.screens.find.sub as string)).toBeTruthy();
  });
});

describe("loading and example data", () => {
  it("shows the example-data hint only when nobody is signed in", async () => {
    setAccountView({ signedIn: false, email: null });
    setup(makeState());
    await show();
    expect(screen.getByText(t.exampleData)).toBeTruthy();
  });
  it("shows no hint when signed in", async () => {
    setup(makeState());
    await show();
    expect(screen.queryByText(t.exampleData)).toBeNull();
  });
  it("offers a retry when the state can't be read", async () => {
    setup(makeState(), { "find:state": { ok: false, reason: "x" } });
    await show();
    expect(screen.getByText(t.loadFailed)).toBeTruthy();
    answers["find:state"] = { ok: true, value: makeState() };
    await click(screen.getByRole("button", { name: t.retry }));
    expect(screen.getByRole("region", { name: t.rules.title })).toBeTruthy();
  });
  it("does not let an older answer replace a newer event", async () => {
    const pending: ((value: unknown) => void)[] = [];
    install(() => new Promise((resolve) => pending.push(resolve)));
    render(<FindScreen />);
    push(withRun("failed", { error: "quota" }));
    await act(async () => {
      pending[0]?.({ ok: true, value: withRun("paused") });
      await Promise.resolve();
    });
    expect(headingText()).toBe(t.live.failed(2));
  });
});

describe("break-ui: worst case data", () => {
  it("renders Review new for a channel with the worst data", async () => {
    resetReviewRunForTests();
    resetAppStoreForTests({ screen: "find", tab: "triage" });
    const worst = aiChannel("UC-worst", "N".repeat(120), {
      handle: `@${"h".repeat(119)}`,
      subscribers: null,
      medianViews: 0,
      uploads30: 0,
      country: null,
      latestUploadAt: null,
      keyword: "k".repeat(200),
      videos: [],
      sponsors: Array.from({ length: 25 }, (_, i) => `Sponsor ${"S".repeat(40)} ${String(i)}`),
      foundEmails: 0,
      emailedBefore: { at: null, who: null },
    });
    setup(makeState(), {
      "find:query": {
        ok: true,
        value: {
          version: 1,
          total: 1,
          items: [{ ...worst, fit: fitOf(worst) }],
          facets: emptyFacets,
        },
      },
    });
    render(<FindScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("N".repeat(120));
    expect(screen.getByText(strings.findTriage.sponsorsMore(22))).toBeTruthy();
    expect(screen.getByText(strings.findTriage.subscribersHidden, { exact: false })).toBeTruthy();
    expect(screen.getByText(strings.findTriage.noVideos)).toBeTruthy();
    expect(screen.getByText(strings.findTriage.emailedBefore(null, null))).toBeTruthy();
    expect(screen.queryByText(strings.findTriage.goldTag)).toBeNull();
  });
  it("renders 500 long keywords, a full log and long channel names", async () => {
    const queue = Array.from({ length: 500 }, (_, i) =>
      kw(
        `${String(i)} ${"ai ".repeat(70)}`.slice(0, 200),
        i < 100 ? "done" : "queued",
        i < 100 ? 1_000_000 : 0,
      ),
    );
    const log = Array.from({ length: 200 }, (_, i) => ({
      at: 1_700_000_000_000 + i,
      level: "info" as const,
      text: "u".repeat(500),
    }));
    const kept = Array.from({ length: 100 }, (_, i) => ({
      channelId: `UC${String(i)}`,
      name: "N".repeat(200),
      handle: `@${"h".repeat(199)}`,
      subscribers: 100_000_000,
      medianViews: 0,
      country: "US",
      keyword: "k".repeat(200),
    }));
    setup(
      withRun(
        "paused",
        { found: 1_000_000, kept: 1_000_000, swept: 1_000_000 },
        { queue, at: 100, log, kept },
      ),
    );
    await show();
    expect(screen.getAllByRole("listitem").length).toBe(500);
    expect(screen.getByText("100/500")).toBeTruthy();
    expect(screen.getAllByText("1,000,000").length).toBe(3);
  });
  it("handles an empty queue", async () => {
    setup(
      makeState({
        queue: [],
        at: 0,
        run: { state: "ready", found: 0, kept: 0, swept: 0, error: null },
      }),
    );
    await show();
    expect(screen.getByText(t.keywords.empty)).toBeTruthy();
    expect(headingText()).toBe(t.live.ready(0));
    await click(screen.getByRole("button", { name: t.live.start }));
  });
});
