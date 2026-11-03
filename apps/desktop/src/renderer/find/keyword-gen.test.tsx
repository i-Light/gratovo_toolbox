// @vitest-environment happy-dom
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { KeywordGen } from "./keyword-gen";

const t = strings.findSearch.generate;

let calls: [string, unknown][];
let suggest: unknown;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  suggest = { ok: true, terms: ["Windsurf", "Cursor"] };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: ((channel: string, input: unknown) => {
      calls.push([channel, input]);
      if (channel === "find:lists") {
        return Promise.resolve({
          ok: true,
          value: { tools: ["Cursor", "Claude Code"], angles: ["tutorial", "review"] },
        });
      }
      if (channel === "find:generate") {
        const tools = (input as { tools: string[] }).tools.length;
        return Promise.resolve({
          ok: true,
          value: {
            ok: true,
            fresh: tools * 2,
            repeats: 1,
            overCap: 0,
            sample: ["Cursor tutorial"],
          },
        });
      }
      if (channel === "find:suggest-terms") {
        return Promise.resolve({ ok: true, value: suggest });
      }
      return Promise.resolve({ ok: true, value: { ok: true } });
    }) as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};
const open = async (): Promise<void> => {
  render(<KeywordGen />);
  await click(screen.getByRole("button", { name: t.open }));
  await settle();
};
const generates = () => calls.filter(([c]) => c === "find:generate");

describe("KeywordGen", () => {
  it("shows the count 300 ms after the ticks change", async () => {
    await open();
    await settle(300);
    expect(screen.getByText(t.count(4, 1, 0))).toBeTruthy();
    expect(generates()[0]?.[1]).toMatchObject({ add: false });
    await click(screen.getByRole("button", { name: t.tickLabel("Cursor") }));
    expect(generates()).toHaveLength(1);
    await settle(299);
    expect(generates()).toHaveLength(1);
    await settle(1);
    expect(generates()).toHaveLength(2);
    expect(generates()[1]?.[1]).toEqual({
      tools: ["Claude Code"],
      angles: ["tutorial", "review"],
      add: false,
    });
    expect(screen.getByText(t.count(2, 1, 0))).toBeTruthy();
  });

  it("adds the ticked lists with add: true", async () => {
    await open();
    await settle(300);
    await click(screen.getByRole("button", { name: t.tickLabel("review") }));
    await settle(300);
    await click(screen.getByRole("button", { name: t.add(4) }));
    expect(generates().at(-1)?.[1]).toEqual({
      tools: ["Cursor", "Claude Code"],
      angles: ["tutorial"],
      add: true,
    });
    expect(screen.getByText(t.added(4))).toBeTruthy();
  });

  it("saves the lists when a term is added or removed", async () => {
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: t.newTool }), {
      target: { value: "Windsurf" },
    });
    await click(screen.getAllByRole("button", { name: t.addTerm })[0] as HTMLElement);
    expect(calls.find(([c]) => c === "find:lists-set")?.[1]).toEqual({
      tools: ["Cursor", "Claude Code", "Windsurf"],
      angles: ["tutorial", "review"],
    });
    await click(screen.getByRole("button", { name: t.remove("tutorial") }));
    expect(calls.filter(([c]) => c === "find:lists-set").at(-1)?.[1]).toEqual({
      tools: ["Cursor", "Claude Code", "Windsurf"],
      angles: ["review"],
    });
  });

  it("adds a suggestion only after it is ticked", async () => {
    await open();
    await click(screen.getByRole("button", { name: t.suggestTools }));
    await settle();
    // "Cursor" is already in the list, so only Windsurf is offered.
    expect(screen.queryByRole("button", { name: "Cursor", pressed: false })).toBeNull();
    const addChosen = screen.getByRole("button", { name: t.addChosen(0) });
    expect((addChosen as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some(([c]) => c === "find:lists-set")).toBe(false);
    await click(screen.getByRole("button", { name: "Windsurf" }));
    await click(screen.getByRole("button", { name: t.addChosen(1) }));
    expect(calls.find(([c]) => c === "find:lists-set")?.[1]).toEqual({
      tools: ["Cursor", "Claude Code", "Windsurf"],
      angles: ["tutorial", "review"],
    });
  });

  it("says plainly when the Gemini bridge is off", async () => {
    suggest = { ok: false, problem: "bridge_off" };
    await open();
    await click(screen.getByRole("button", { name: t.suggestAngles }));
    await settle();
    expect(screen.getByText(t.bridgeOff)).toBeTruthy();
  });

  it("says so when the add-on did not confirm thinking", async () => {
    suggest = { ok: false, problem: "thinking_not_set" };
    await open();
    await click(screen.getByRole("button", { name: t.suggestAngles }));
    await settle();
    expect(screen.getByText(t.thinkingNotSet)).toBeTruthy();
  });
});
