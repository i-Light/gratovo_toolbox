// @vitest-environment happy-dom
import { emptyReach } from "@gratovo/core/data";
import type { OutreachDraft, ThreadSummary } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { aiCreator, seedReach } from "./reach-fixtures";
import { ReachScreen } from "./reach-screen";

const t = strings.reach;
const now = Date.now();
const sam = "sam@gratovo.example";

const thread = (creator: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  creator,
  count: 2,
  lastOutAt: now - 86_400_000,
  lastIn: null,
  answered: false,
  ...over,
});

const creators = [
  aiCreator("c1", "Prompt Lab"),
  aiCreator("c2", "Neural Notes"),
  aiCreator("c3", "Code with Kai", { stage: "emailed" }),
  aiCreator("c4", "Tensor Talk", { stage: "replied" }),
];

function seed(source: "example" | "live" = "example", over: Partial<OutreachDraft> = {}): void {
  seedReach(
    creators,
    reachWith({
      gemini: "ready",
      mailboxes: [goodMailbox(sam)],
      drafts: [
        aiDraft("d2", "c2", { createdAt: now - 3_600_000, ...over }),
        aiDraft("d4", "c4", {
          kind: "reply",
          subject: "Re: sponsorship",
          createdAt: now - 60_000,
        }),
      ],
      threads: [
        thread("c4", {
          lastIn: {
            id: "m1",
            at: now - 7_200_000,
            reading: null,
            preview: "Sounds good, send the rate card",
            bounce: false,
          },
        }),
      ],
      sequences: [
        {
          creator: "c3",
          mailbox: sam,
          startedAt: now - 3 * 86_400_000,
          steps: [
            { n: 1, dueAt: now + 4 * 86_400_000, state: "planned", sentAt: null },
            { n: 2, dueAt: now + 11 * 86_400_000, state: "planned", sentAt: null },
          ],
          stopped: null,
          parkUntil: null,
        },
      ],
    }),
    source,
  );
}

const lane = (name: string): HTMLElement =>
  screen.getByRole("region", { name: strings.reach.board.lanes[name as "todraft"].name });

let bridge = stubReachBridge();
beforeEach(() => {
  bridge = stubReachBridge({ "gemini:start": { state: "starting" } });
  resetAppStoreForTests({ screen: "reach", tab: "board" }, now);
  seed();
});
afterEach(() => {
  cleanup();
});

describe("the board", () => {
  it("puts each creator in their lane with the lane's words and button", () => {
    render(<ReachScreen />);
    for (const key of ["todraft", "waiting", "seq", "replied", "kit", "signed"] as const) {
      expect(lane(key)).toBeTruthy();
    }
    const todraft = within(lane("todraft"));
    expect(todraft.getByText("Prompt Lab")).toBeTruthy();
    expect(todraft.getByText(t.board.sub.todraft)).toBeTruthy();
    expect(todraft.getByRole("button", { name: t.board.draftIt })).toBeTruthy();
    const waiting = within(lane("waiting"));
    expect(waiting.getByText("Neural Notes")).toBeTruthy();
    expect(waiting.getByText(`${t.kinds.first} · ${t.board.sub.readyToSend}`)).toBeTruthy();
    expect(waiting.getByRole("button", { name: t.board.review })).toBeTruthy();
    expect(within(lane("seq")).getByText("Code with Kai")).toBeTruthy();
    expect(within(lane("seq")).getByText(/next is follow-up 1 of 3/)).toBeTruthy();
    const replied = within(lane("replied"));
    expect(replied.getByText("Sounds good, send the rate card")).toBeTruthy();
    expect(replied.getByRole("button", { name: t.board.answer })).toBeTruthy();
    expect(within(lane("kit")).getByText(t.board.empty.kit.title)).toBeTruthy();
  });

  it("says what is waiting in the sub line, and shows the sends left", () => {
    render(<ReachScreen />);
    expect(
      screen.getByText(`${t.screen.emailsToApprove(1)} and ${t.screen.repliesToAnswer(1)}.`, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.getByText(t.cap.used(2, 30, 1))).toBeTruthy();
    // The Mailboxes tab is not shown on live data, so the summary is text, not a button.
  });

  it("shows a gate on the card: the alert and its short words", () => {
    seedReach(
      creators.map((c) => (c.id === "c2" ? { ...c, emailConfirmed: false } : c)),
      appStore().getState().data.reach,
    );
    render(<ReachScreen />);
    expect(
      within(lane("waiting")).getByText(`${t.kinds.first} · ${t.gatesShort.unconfirmed}`),
    ).toBeTruthy();
  });

  it("opens the peek on the Emails tab, stepping through the lane", () => {
    seedReach(
      [...creators, aiCreator("c5", "The AI Desk")],
      reachWith({
        ...appStore().getState().data.reach,
        drafts: [
          ...appStore().getState().data.reach.drafts,
          aiDraft("d5", "c5", { createdAt: now }),
        ],
      }),
    );
    render(<ReachScreen />);
    fireEvent.click(within(lane("waiting")).getByText("Neural Notes"));
    const peek = appStore().getState().ui.peek;
    expect(peek?.record).toEqual({ kind: "creator", id: "c2" });
    expect(peek?.tab).toBe("emails");
    expect(peek?.list).toEqual(["c2", "c5"]);
  });

  it("opens the peek from the lane's button, and from Enter on the card", () => {
    render(<ReachScreen />);
    fireEvent.click(within(lane("waiting")).getByRole("button", { name: t.board.review }));
    expect(appStore().getState().ui.peek?.tab).toBe("emails");
    appStore().ui((ui) => {
      ui.peek = null;
    });
    const card = within(lane("replied")).getByText("Tensor Talk").closest(".kcard");
    expect(card).not.toBeNull();
    fireEvent.keyDown(card as HTMLElement, { key: "Enter" });
    expect(appStore().getState().ui.peek?.record.id).toBe("c4");
  });

  it("opens the full record on O", () => {
    render(<ReachScreen />);
    const card = within(lane("replied")).getByText("Tensor Talk").closest(".kcard");
    fireEvent.keyDown(card as HTMLElement, { key: "o" });
    const route = selectRoute(appStore().getState());
    expect(route.screen).toBe("record");
    expect(route.record).toEqual({ kind: "creator", id: "c4" });
  });

  it("asks for a draft with Draft it, without opening the peek", async () => {
    render(<ReachScreen />);
    await act(async () => {
      fireEvent.click(within(lane("todraft")).getByRole("button", { name: t.board.draftIt }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:draft-now", { creatorId: "c1" }]);
    expect(appStore().getState().ui.peek).toBeNull();
  });

  it("shows 'Gemini is writing…' while a first email is being drafted", () => {
    seedReach(
      creators,
      reachWith({
        ...appStore().getState().data.reach,
        drafts: [aiDraft("d1", "c1", { state: "drafting", proposal: null })],
      }),
    );
    render(<ReachScreen />);
    const button = within(lane("todraft")).getByRole("button", { name: t.board.writing });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the banner", () => {
  it("starts Gemini from the off banner", async () => {
    seedReach(creators, reachWith({ ...emptyReach, gemini: "off" }));
    render(<ReachScreen />);
    expect(screen.getByText(t.banner.off)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.banner.start }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["gemini:start", {}]);
  });

  it("names the time Gemini is paused until, and is quiet when Gemini is ready", () => {
    seedReach(
      creators,
      reachWith({
        ...emptyReach,
        gemini: "paused",
        geminiPausedUntil: new Date(2026, 9, 24, 14, 5).getTime(),
      }),
    );
    render(<ReachScreen />);
    expect(screen.getByText(t.banner.paused("14:05"))).toBeTruthy();
    cleanup();
    seedReach(creators, reachWith({ ...emptyReach, gemini: "ready" }));
    render(<ReachScreen />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the live gate", () => {
  it("shows the Board, Sequences, Replies and Mailboxes: four lanes and four tabs", () => {
    seed("live");
    render(<ReachScreen />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      strings.screens.reach.tabs.board,
      strings.screens.reach.tabs.sequences,
      strings.screens.reach.tabs.inbox,
      strings.screens.reach.tabs.mailboxes,
    ]);
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(screen.queryByRole("region", { name: t.board.lanes.kit.name })).toBeNull();
    // The Mailboxes tab is wired: the capacity summary is a button to it.
    expect(screen.getByRole("button", { name: new RegExp(t.cap.left) })).toBeTruthy();
  });

  it("shows every tab on example data", () => {
    render(<ReachScreen />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("button", { name: new RegExp(t.cap.left) })).toBeTruthy();
  });
});
