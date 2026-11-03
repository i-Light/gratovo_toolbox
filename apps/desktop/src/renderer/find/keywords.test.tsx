// @vitest-environment happy-dom
import type { FindState, QueueRow } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { strings } from "../strings";
import { Keywords } from "./keywords";

const t = strings.findSearch.keywords;
const total = 2500;

const row = (index: number, over: Partial<QueueRow> = {}): QueueRow => ({
  index,
  keyword: `keyword ${String(index)}`,
  state: index < 1000 ? "done" : "queued",
  found: 4,
  kept: 1,
  failures: 0,
  tool: null,
  angle: null,
  rank: null,
  ...over,
});
const stateOf = (version: number): FindState =>
  ({
    queue: { total, queued: 1500, running: 0, done: 1000, failed: 0, version, current: [] },
    at: 1000,
    rules: {} as FindState["rules"],
    run: { state: "paused", found: 0, kept: 0, swept: 0, error: null, wait: null },
    log: [],
    kept: [],
  }) satisfies FindState;

let calls: [string, unknown][];
/** What find:remove answers; the other edits answer ok. */
let removeAnswer: unknown;

beforeEach(() => {
  calls = [];
  removeAnswer = { ok: true };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: ((channel: string, input: unknown) => {
      calls.push([channel, input]);
      if (channel === "find:keywords") {
        const { offset, limit } = input as { offset: number; limit: number };
        const rows = Array.from({ length: Math.min(limit, total - offset) }, (_, i) =>
          row(offset + i, offset === 0 && i === 0 ? { tool: "Cursor", angle: "tutorial" } : {}),
        );
        if (offset === 0) {
          rows[1] = row(1, { state: "queued", rank: "up" });
        }
        return Promise.resolve({ ok: true, value: { total, offset, rows } });
      }
      if (channel === "find:count-weak") {
        return Promise.resolve({ ok: true, value: { count: 0 } });
      }
      if (channel === "find:remove") {
        return Promise.resolve({ ok: true, value: removeAnswer });
      }
      return Promise.resolve({ ok: true, value: { ok: true } });
    }) as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
});
afterEach(cleanup);

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
    await Promise.resolve();
  });
};
const keywordCalls = (): unknown[] =>
  calls.filter(([c]) => c === "find:keywords").map(([, i]) => i);

describe("the keyword list", () => {
  it("shows 100 rows, the pager text, the tool and angle and a rank hint", async () => {
    render(<Keywords state={stateOf(1)} />);
    await flush();
    const list = screen.getByRole("list", { name: t.listLabel });
    expect(within(list).getAllByRole("listitem")).toHaveLength(100);
    expect(screen.getByText(t.pageRange(1, 100, total))).toBeTruthy();
    expect(screen.getByText("1–100 of 2,500")).toBeTruthy();
    expect(screen.getByText("Cursor · tutorial")).toBeTruthy();
    expect(screen.getByText(t.rankUp).getAttribute("data-tip")).toBe(t.rankUpTip);
  });

  it("Next asks for offset 100, Previous goes back", async () => {
    render(<Keywords state={stateOf(1)} />);
    await flush();
    await click(screen.getByRole("button", { name: t.nextPage }));
    expect(keywordCalls()).toContainEqual({ offset: 100, limit: 100, filter: "all" });
    expect(screen.getByText("101–200 of 2,500")).toBeTruthy();
    await click(screen.getByRole("button", { name: t.prevPage }));
    expect(screen.getByText("1–100 of 2,500")).toBeTruthy();
  });

  it("a filter changes the request and starts at the first page", async () => {
    render(<Keywords state={stateOf(1)} />);
    await flush();
    await click(screen.getByRole("button", { name: t.nextPage }));
    await click(screen.getByRole("button", { name: t.filters.failed }));
    expect(keywordCalls().at(-1)).toEqual({ offset: 0, limit: 100, filter: "failed" });
  });

  it("Go to next keyword opens the page holding it", async () => {
    render(<Keywords state={stateOf(1)} />);
    await flush();
    await click(screen.getByRole("button", { name: t.goNext }));
    expect(keywordCalls().at(-1)).toEqual({ offset: 1000, limit: 100, filter: "all" });
  });

  it("asks again when the queue version changes", async () => {
    const view = render(<Keywords state={stateOf(1)} />);
    await flush();
    const before = keywordCalls().length;
    view.rerender(<Keywords state={stateOf(1)} />);
    await flush();
    expect(keywordCalls()).toHaveLength(before);
    view.rerender(<Keywords state={stateOf(2)} />);
    await flush();
    expect(keywordCalls()).toHaveLength(before + 1);
  });

  it("offers Retry on a done row and calls find:retry with its index and keyword", async () => {
    render(<Keywords state={stateOf(1)} />);
    await flush();
    await click(screen.getByRole("button", { name: t.retryLabel("keyword 3") }));
    expect(calls).toContainEqual(["find:retry", { index: 3, keyword: "keyword 3" }]);
  });

  it("reads its rows again, with no note, when main says the page was stale", async () => {
    removeAnswer = { ok: false, problem: "stale" };
    render(<Keywords state={stateOf(1)} />);
    await flush();
    const before = keywordCalls().length;
    await click(screen.getByRole("button", { name: t.removeLabel("keyword 5") }));
    await flush();
    expect(calls).toContainEqual(["find:remove", { index: 5, keyword: "keyword 5" }]);
    expect(keywordCalls()).toHaveLength(before + 1);
    expect(screen.queryByText(t.editRunning)).toBeNull();
    expect(screen.queryByText(t.editFailed)).toBeNull();
  });

  it("asks for the weak count once as a run starts and once as it ends, not per keyword", async () => {
    const weakCalls = (): number => calls.filter(([c]) => c === "find:count-weak").length;
    const running = (version: number): FindState => ({
      ...stateOf(version),
      run: { ...stateOf(version).run, state: "running" },
    });
    const view = render(<Keywords state={stateOf(1)} />);
    await flush();
    expect(weakCalls()).toBe(1);
    view.rerender(<Keywords state={running(2)} />);
    await flush();
    for (let v = 3; v < 8; v += 1) {
      view.rerender(<Keywords state={running(v)} />);
      await flush();
    }
    expect(weakCalls()).toBe(2);
    view.rerender(<Keywords state={stateOf(8)} />);
    await flush();
    expect(weakCalls()).toBe(3);
  });
});
