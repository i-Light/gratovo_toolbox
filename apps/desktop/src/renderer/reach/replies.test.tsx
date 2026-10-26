// @vitest-environment happy-dom
import type { ReplyReading, ThreadSummary } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiDraft, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { aiCreator, seedReach } from "./reach-fixtures";
import { Replies } from "./replies";

const t = strings.reach.replies;
const hour = 3_600_000;
const now = Date.now();

const reading = (label: string, replyType: string): ReplyReading => ({
  replyType,
  label,
  summary: "Summary.",
  side: "creator",
  corrected: false,
  facts: [],
});
const thread = (
  creator: string,
  ago: number,
  over: Partial<ThreadSummary> = {},
  r: ReplyReading | null = null,
  bounce = false,
): ThreadSummary => ({
  creator,
  count: 2,
  lastOutAt: now - ago - hour,
  lastIn: {
    id: `m-${creator}`,
    at: now - ago,
    reading: r,
    preview: `Hello from ${creator}`,
    bounce,
  },
  answered: false,
  ...over,
});
const creators = [
  aiCreator("c1", "Prompt Lab", { stage: "replied" }),
  aiCreator("c2", "Neural Notes", { stage: "replied" }),
  aiCreator("c3", "Code with Kai", { stage: "replied" }),
  aiCreator("c4", "Tensor Talk", { stage: "emailed" }),
  aiCreator("c5", "The AI Desk", { stage: "emailed" }),
];
const threads = [
  thread("c1", hour, {}, reading("Interested · wants details", "inf.interested_vague")),
  thread("c2", 2 * hour, {}, reading("Not now", "inf.later")),
  thread("c3", 3 * hour),
  thread("c4", 4 * hour, { answered: true }),
  thread("c5", 5 * hour, {}, null, true),
];
const drafts = [
  aiDraft("d1", "c1", { kind: "reply", replyTo: "m-c1" }),
  aiDraft("d3", "c3", { kind: "reply", state: "drafting", proposal: null }),
];
let bridge = stubReachBridge();
const options = (): HTMLElement[] => within(screen.getByRole("listbox")).getAllByRole("option");
const toasts = () => appStore().getState().ui.toasts;

beforeEach(() => {
  bridge = stubReachBridge({ "reach:thread": { ok: true, messages: [] } });
  resetAppStoreForTests({ screen: "reach", tab: "inbox" }, now);
  seedReach(creators, reachWith({ threads, drafts }), "live");
});
afterEach(() => {
  cleanup();
});

describe("the Replies list", () => {
  it("lists each reply newest first with its tag, first line and state", () => {
    render(<Replies />);
    const rows = options();
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual([
      "Prompt Lab",
      "Neural Notes",
      "Code with Kai",
      "Tensor Talk",
      "The AI Desk",
    ]);
    const states = rows.map((r) => r.querySelector(".rt small")?.textContent);
    expect(states).toEqual([
      t.state.draft,
      t.state.your_move,
      t.state.writing,
      t.state.answered,
      t.state.bounced,
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Interested")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Hello from c1")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Not now")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText(t.noReading)).toBeTruthy();
    expect(rows[0]?.querySelector(".tag.good")).toBeTruthy();
    expect(rows[1]?.querySelector(".tag.warn")).toBeTruthy();
    expect(rows[4]?.querySelector(".tag.crit")).toBeTruthy();
  });

  it("selects the first by default and the one clicked", async () => {
    render(<Replies />);
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      fireEvent.click(options()[1] as HTMLElement);
      await Promise.resolve();
    });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("false");
    expect(bridge.calls.filter((c) => c[0] === "reach:thread").at(-1)).toEqual([
      "reach:thread",
      { creatorId: "c2" },
    ]);
  });

  it("moves the selection with J, K and the arrow keys", async () => {
    render(<Replies />);
    const { keyStack } = await import("../lib/keys");
    const send = async (key: string): Promise<void> => {
      await act(async () => {
        keyStack.dispatch(new KeyboardEvent("keydown", { key }), {
          typing: false,
          lettersOff: false,
        });
        await Promise.resolve();
      });
    };
    await send("j");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    await send("ArrowDown");
    expect(options()[2]?.getAttribute("aria-selected")).toBe("true");
    await send("k");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    await send("ArrowUp");
    await send("ArrowUp");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("opens the answer draft card beside the thread", async () => {
    render(<Replies />);
    expect(await screen.findByLabelText(strings.reach.card.label("Reply"))).toBeTruthy();
  });

  it("shows an empty state", () => {
    seedReach(creators, reachWith({}), "live");
    render(<Replies />);
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Check now", () => {
  const check = async (answer: unknown): Promise<void> => {
    bridge = stubReachBridge({
      "reach:thread": { ok: true, messages: [] },
      "reach:check-replies": answer,
    });
    render(<Replies />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.checkNow }));
      await Promise.resolve();
    });
  };

  it("says when there is nothing new", async () => {
    await check({ ok: true, stored: 0 });
    expect(toasts().at(-1)?.msg).toBe(t.toasts.none);
  });

  it("counts new replies", async () => {
    await check({ ok: true, stored: 3 });
    expect(toasts().at(-1)?.msg).toBe("3 new replies");
  });

  it("says what went wrong, in plain words", async () => {
    await check({ ok: false, problem: "example" });
    expect(toasts().at(-1)?.msg).toBe("Example data has no mailbox to check.");
  });
});
