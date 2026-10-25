// @vitest-environment happy-dom
import type { Sequence, ThreadSummary } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayWords } from "../lib/reach-actions";
import { goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { aiCreator, seedReach } from "./reach-fixtures";
import { ReachScreen } from "./reach-screen";

const t = strings.reach.sequences;
const day = 86_400_000;
const now = Date.now();
const sam = "sam@gratovo.example";

const seq = (creator: string, over: Partial<Sequence> = {}): Sequence => ({
  creator,
  mailbox: sam,
  startedAt: now - 3 * day,
  steps: [
    { n: 1, dueAt: now, state: "planned", sentAt: null },
    { n: 2, dueAt: now + 4 * day, state: "planned", sentAt: null },
    { n: 3, dueAt: now + 11 * day, state: "planned", sentAt: null },
  ],
  stopped: null,
  parkUntil: null,
  ...over,
});

const creators = [
  aiCreator("c1", "Prompt Lab", { stage: "emailed" }),
  aiCreator("c2", "Neural Notes", { stage: "emailed" }),
  aiCreator("c3", "Code with Kai", { stage: "parked" }),
  aiCreator("c4", "Tensor Talk", { stage: "emailed" }),
  aiCreator("c5", "The AI Desk", { stage: "replied" }),
];
const reply: ThreadSummary = {
  creator: "c5",
  count: 3,
  lastOutAt: now - 3 * day,
  lastIn: { id: "m", at: now - day, reading: null, preview: "Hi", bounce: false },
  answered: false,
};
const sequences = [
  seq("c1"),
  seq("c2", {
    steps: [
      { n: 1, dueAt: now - 2 * day, state: "sent", sentAt: now - 2 * day },
      { n: 2, dueAt: now + 2 * day, state: "planned", sentAt: null },
      { n: 3, dueAt: now + 9 * day, state: "skipped", sentAt: null },
    ],
  }),
  seq("c3", { parkUntil: now + 20 * day }),
  seq("c4", { stopped: "you" }),
  seq("c5", { stopped: "replied" }),
];

let bridge = stubReachBridge();
const row = (name: string): HTMLElement =>
  screen.getByRole("button", { name }).closest<HTMLElement>("[role=row]") as HTMLElement;
const toasts = () => appStore().getState().ui.toasts;
const menu = () => appStore().getState().ui.menu;
const labels = (): string[] =>
  (menu()?.items ?? [])
    .map((i) => ("label" in i ? i.label : i.kind))
    .filter((l) => l !== "separator");

beforeEach(() => {
  bridge = stubReachBridge();
  resetAppStoreForTests({ screen: "reach", tab: "sequences" }, now);
  seedReach(
    creators,
    reachWith({ mailboxes: [goodMailbox(sam)], sequences, threads: [reply] }),
    "live",
  );
});
afterEach(() => {
  cleanup();
});

describe("Reach > Sequences", () => {
  it("shows a row per creator with the next step in words", () => {
    render(<ReachScreen />);
    expect(screen.getByRole("table", { name: t.table })).toBeTruthy();
    const next = (name: string) => row(name).querySelector(".nx span")?.textContent;
    expect(next("Prompt Lab")).toBe(t.next.step(1, t.next.dueToday));
    expect(next("Neural Notes")).toBe(t.next.step(2, t.next.inDays(2)));
    expect(next("Code with Kai")).toBe(t.next.parked(dayWords(now + 20 * day)));
    expect(next("Tensor Talk")).toBe(t.next.you);
    expect(next("The AI Desk")).toBe(t.next.replied);
  });

  it("names every dot", () => {
    render(<ReachScreen />);
    const dots = (name: string) =>
      within(row(name))
        .getAllByRole("img")
        .map((d) => d.className);
    expect(dots("Neural Notes")).toEqual(["sq-d sent", "sq-d sent", "sq-d plan", "sq-d skip"]);
    expect(dots("Prompt Lab")).toEqual(["sq-d sent", "sq-d due", "sq-d plan", "sq-d plan"]);
    expect(dots("The AI Desk").some((c) => c.includes("reply"))).toBe(true);
    expect(
      within(row("Prompt Lab")).getByRole("img", { name: /^Follow-up 1 is due today/ }),
    ).toBeTruthy();
  });

  it("counts and filters, and says what is due", () => {
    render(<ReachScreen />);
    expect(screen.getByRole("button", { name: t.all(5) })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.running(2) })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.stopped(3) })).toBeTruthy();
    expect(screen.getByText(t.dueToday(1))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.stopped(3) }));
    expect(screen.queryByRole("button", { name: "Prompt Lab" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tensor Talk" })).toBeTruthy();
  });

  it("shows the empty state, and says nothing is running", () => {
    seedReach(creators, reachWith({ sequences: [] }), "live");
    render(<ReachScreen />);
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.nothingRunning)).toBeTruthy();
  });

  it("opens the creator on the Emails tab from a row", () => {
    render(<ReachScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Prompt Lab" }));
    expect(appStore().getState().ui.peek?.record.id).toBe("c1");
    expect(appStore().getState().ui.peek?.tab).toBe("emails");
  });

  it("offers each state its own menu", () => {
    render(<ReachScreen />);
    const open = (name: string) => {
      fireEvent.click(within(row(name)).getByRole("button", { name: t.moreFor(name) }));
      return labels();
    };
    const park = Object.values(t.parkChoices);
    expect(open("Prompt Lab")).toEqual([t.open, t.stop, t.parkHead, ...park]);
    // Stopped by you: Resume, and no Park (main refuses Park on a stopped sequence).
    expect(open("Tensor Talk")).toEqual([t.open, t.resume]);
    expect(open("Code with Kai")).toEqual([t.open, t.wake]);
    expect(open("The AI Desk")).toEqual([t.open]);
  });

  it("runs Stop, Park and Wake through main, with an Undo that runs the opposite", async () => {
    render(<ReachScreen />);
    const pick = async (name: string, item: string) => {
      fireEvent.click(within(row(name)).getByRole("button", { name: t.moreFor(name) }));
      const found = menu()?.items.find((i) => "label" in i && i.label === item);
      await act(async () => {
        await Promise.resolve();
        if (found !== undefined && "run" in found) {
          found.run();
        }
      });
    };
    const undo = async () => {
      await act(async () => {
        await Promise.resolve();
        toasts().at(-1)?.actions[0]?.run();
      });
    };
    await pick("Prompt Lab", t.stop);
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-stop", { creatorId: "c1" }]);
    expect(toasts().at(-1)?.msg).toBe(t.toasts.stopped("Prompt Lab"));
    await undo();
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-resume", { creatorId: "c1" }]);
    await pick("Tensor Talk", t.resume);
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-resume", { creatorId: "c4" }]);
    await undo();
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-stop", { creatorId: "c4" }]);
    // A sequence you stopped offers no Park: main would refuse it. Resume it first.
    fireEvent.click(
      within(row("Tensor Talk")).getByRole("button", { name: t.moreFor("Tensor Talk") }),
    );
    expect(menu()?.items.some((i) => "label" in i && i.label === t.parkChoices.month1)).toBe(false);
    await pick("Prompt Lab", t.parkChoices.month1);
    expect(bridge.calls.at(-1)?.[0]).toBe("reach:park");
    expect(toasts().at(-1)?.msg).toContain("Prompt Lab");
    await undo();
    expect(bridge.calls.at(-1)).toEqual(["reach:wake", { creatorId: "c1" }]);
    await pick("Code with Kai", t.wake);
    expect(bridge.calls.at(-1)).toEqual(["reach:wake", { creatorId: "c3" }]);
    await undo();
    expect(bridge.calls.at(-1)?.[0]).toBe("reach:park");
  });

  it("says plainly when main refuses", async () => {
    bridge = stubReachBridge({ "reach:sequence-stop": { ok: false, problem: "wrong_state" } });
    render(<ReachScreen />);
    fireEvent.click(
      within(row("Prompt Lab")).getByRole("button", { name: t.moreFor("Prompt Lab") }),
    );
    const stop = menu()?.items.find((i) => "label" in i && i.label === t.stop);
    await act(async () => {
      await Promise.resolve();
      if (stop !== undefined && "run" in stop) {
        stop.run();
      }
    });
    expect(toasts().at(-1)?.msg).toBe(t.problems.wrong_state);
    expect(toasts().at(-1)?.actions).toEqual([]);
  });
});
