// @vitest-environment happy-dom
import type { FindState } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeys, useKeyListener } from "../app/global-keys";
import * as actions from "../lib/actions";
import { strings } from "../strings";
import { Keywords } from "./keywords";

const t = strings.findSearch.ideas;

const state: FindState = {
  queue: [
    { keyword: "ai agents", state: "done", found: 10, kept: 3 },
    { keyword: "claude code tutorial", state: "queued", found: 0, kept: 0 },
  ],
  at: 1,
  rules: {} as FindState["rules"],
  run: { state: "paused", found: 0, kept: 0, swept: 0, error: null },
  log: [],
  kept: [],
};

let calls: [string, unknown][];
let ideasAnswer: unknown;
let resolveIdeas: ((v: unknown) => void) | null;

function Page() {
  useGlobalKeys();
  useKeyListener();
  return <Keywords state={state} />;
}

beforeEach(() => {
  calls = [];
  resolveIdeas = null;
  ideasAnswer = { ok: true, value: { ok: false, problem: "bridge_off" } };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: ((channel: string, input: unknown) => {
      calls.push([channel, input]);
      if (channel === "find:ideas") {
        return new Promise((resolve) => {
          resolveIdeas = () => {
            resolve(ideasAnswer);
          };
        });
      }
      return Promise.resolve({ ok: true, value: { added: 2, skipped: 0 } });
    }) as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};
/** Opens the panel and answers the request. */
async function open(answer: unknown): Promise<void> {
  ideasAnswer = { ok: true, value: answer };
  render(<Page />);
  await click(screen.getByRole("button", { name: t.suggest }));
  await act(async () => {
    resolveIdeas?.(null);
    await Promise.resolve();
  });
}
const ready = {
  ok: true,
  keywords: ["claude code tutorial", "n8n ai automation", "local llm setup"],
  dropped: 0,
};

describe("keyword ideas", () => {
  it("shows the busy line, then the chips, asking for 8", async () => {
    render(<Page />);
    await click(screen.getByRole("button", { name: t.suggest }));
    expect(screen.getByText(t.busy)).toBeTruthy();
    expect(calls).toContainEqual(["find:ideas", { count: 8 }]);
    ideasAnswer = { ok: true, value: ready };
    await act(async () => {
      resolveIdeas?.(null);
      await Promise.resolve();
    });
    expect(screen.getByText(t.title)).toBeTruthy();
    expect(screen.queryByText(t.busy)).toBeNull();
  });

  it("disables a chip already in the list and adds only the picked ones", async () => {
    await open(ready);
    const dup = screen.getByRole("button", { name: "claude code tutorial" });
    expect((dup as HTMLButtonElement).disabled).toBe(true);
    expect(dup.getAttribute("data-tip")).toBe(t.already);
    expect(screen.getByRole("button", { name: t.addSelected(2) })).toBeTruthy();
    await click(screen.getByRole("button", { name: "local llm setup" }));
    await click(screen.getByRole("button", { name: t.addSelected(1) }));
    expect(calls).toContainEqual(["find:add", { keywords: ["n8n ai automation"] }]);
    expect(screen.queryByText(t.title)).toBeNull();
  });

  it("notes how many were already in the list", async () => {
    await open({ ...ready, dropped: 3 });
    expect(screen.getByText(t.dropped(3))).toBeTruthy();
  });

  it("bridge_off says so and opens Connections", async () => {
    const spy = vi.spyOn(actions, "openSetting").mockImplementation(() => undefined);
    await open({ ok: false, problem: "bridge_off" });
    expect(screen.getByText(t.bridgeOff)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.openConnections }));
    expect(spy).toHaveBeenCalledWith("connections");
  });

  it("busy says Gemini is already working", async () => {
    await open({ ok: false, problem: "busy" });
    expect(screen.getByText(t.working)).toBeTruthy();
  });

  it("failed offers Try again, which asks once more", async () => {
    await open({ ok: false, problem: "failed" });
    expect(screen.getByText(t.failed)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.tryAgain }));
    expect(calls.filter(([c]) => c === "find:ideas")).toHaveLength(2);
  });

  it("asks only once while a request is out", async () => {
    render(<Page />);
    const button = screen.getByRole("button", { name: t.suggest });
    await click(button);
    await click(button);
    await click(button);
    expect(calls.filter(([c]) => c === "find:ideas")).toHaveLength(1);
  });

  it("Esc closes the panel, but not while typing in the paste box", async () => {
    await open(ready);
    const box = screen.getByRole("textbox", { name: strings.findSearch.keywords.inputLabel });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape" });
      await Promise.resolve();
    });
    expect(screen.getByText(t.title)).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
      await Promise.resolve();
    });
    expect(screen.queryByText(t.title)).toBeNull();
    await flush();
  });

  it("sends focus back to the Suggest button on Close", async () => {
    await open(ready);
    await click(screen.getByRole("button", { name: t.close }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t.suggest }));
  });
});
