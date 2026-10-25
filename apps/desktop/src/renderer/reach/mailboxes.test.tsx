// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { Mailboxes } from "./mailboxes";
import { aiCreator, seedReach } from "./reach-fixtures";

const t = strings.reach.mailboxes;
const sam = "sam@gratovo.example";
const lee = "lee@gratovo.example";
const ann = "ann@gratovo.example";

let bridge = stubReachBridge();

const toast = () => appStore().getState().ui.toasts.at(-1);
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};
const card = (address: string): HTMLElement => screen.getByRole("group", { name: address });
const click = async (el: HTMLElement): Promise<void> => {
  fireEvent.click(el);
  await settle();
};

beforeEach(() => {
  bridge = stubReachBridge();
  resetAppStoreForTests({ screen: "reach", tab: "mailboxes" });
});
afterEach(cleanup);

function seed(...mailboxes: ReturnType<typeof goodMailbox>[]): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab")],
    reachWith({
      mailboxes,
      drafts: [aiDraft("d1", "c1"), aiDraft("d2", "c1", { mailbox: "SAM@gratovo.example" })],
    }),
  );
}

describe("Reach > Mailboxes", () => {
  it("points to Connections when there is no mailbox", async () => {
    seed();
    render(<Mailboxes />);
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.emptyAction }));
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "settings",
      tab: "connections",
    });
  });

  it("shows a card per mailbox with its meters, rates and queued drafts", () => {
    seed(
      goodMailbox(sam, { sentToday: 12, bounceRate: 2.4, replyRate: 8 }),
      goodMailbox(lee, { warmup: { day: 9, of: 30 }, status: "warming" }),
    );
    render(<Mailboxes />);
    const one = within(card(sam));
    expect(one.getByText(t.status.good)).toBeTruthy();
    expect(one.getByText(t.sentOf(12, 30))).toBeTruthy();
    expect(one.getByText(t.warmupDone)).toBeTruthy();
    expect(one.getByText("2.4%").closest(".rc-ms")?.className).toContain("warn");
    expect(one.getByText("8%")).toBeTruthy();
    expect(one.getByText(t.queued(2))).toBeTruthy();
    expect(one.queryByText(/inbox/i)).toBeNull();
    const two = within(card(lee));
    expect(two.getByText(t.status.warming)).toBeTruthy();
    expect(two.getByText(t.warmupDay(9, 30))).toBeTruthy();
    expect(two.getByText(t.warmingHint(30))).toBeTruthy();
    expect(two.queryByText(t.queued(1))).toBeNull();
  });

  it("shows a dash and a tip for a rate with too few sends, and crit from 3%", () => {
    seed(goodMailbox(sam), goodMailbox(lee, { bounceRate: 4.2 }));
    render(<Mailboxes />);
    const dash = within(card(sam)).getAllByText(t.noRate);
    expect(dash).toHaveLength(2);
    expect(dash[0]?.closest(".rc-ms")?.getAttribute("data-tip")).toBe(t.noBounceTip);
    expect(within(card(lee)).getByText("4.2%").closest(".rc-ms")?.className).toContain("crit");
  });

  it("says which mailbox is slowed, and when it returns", () => {
    seed(
      goodMailbox(sam, { status: "slowed", bounceRate: 4.2, effectiveCap: 20 }),
      goodMailbox(lee),
    );
    render(<Mailboxes />);
    expect(screen.getByRole("note").textContent).toContain(t.rightNow([t.slowedPart("sam", 4.2)]));
    expect(within(card(sam)).getByText(t.slowedHint(30))).toBeTruthy();
    expect(within(card(sam)).getByText(t.status.slowed)).toBeTruthy();
  });

  it("steps the daily limit by 5, toasts without Undo, and holds the buttons while it saves", async () => {
    seed(goodMailbox(sam));
    render(<Mailboxes />);
    const raise = within(card(sam)).getByRole<HTMLButtonElement>("button", { name: t.raise });
    fireEvent.click(raise);
    expect(raise.disabled).toBe(true);
    expect(
      within(card(sam)).getByRole<HTMLButtonElement>("button", { name: t.lower }).disabled,
    ).toBe(true);
    await settle();
    expect(bridge.calls.filter(([c]) => c === "reach:mailbox-set")).toEqual([
      ["reach:mailbox-set", { address: sam, dailyCap: 35 }],
    ]);
    expect(toast()?.msg).toBe(t.capToast("sam", 35));
    expect(toast()?.actions).toEqual([]);
    // Main has answered, but its new numbers aren't here yet: a second click would build on 30.
    expect(raise.disabled).toBe(true);
    act(() => {
      seed(goodMailbox(sam, { dailyCap: 35 }));
    });
    await settle();
    expect(raise.disabled).toBe(false);
  });

  it("lets go of the stepper when a set fails", async () => {
    seed(goodMailbox(sam));
    stubReachBridge({ "reach:mailbox-set": { ok: false, problem: "not_found" } });
    render(<Mailboxes />);
    const raise = within(card(sam)).getByRole<HTMLButtonElement>("button", { name: t.raise });
    fireEvent.click(raise);
    expect(raise.disabled).toBe(true);
    await settle();
    expect(raise.disabled).toBe(false);
  });

  it("disables the stepper at 10 and 50 with a tip", () => {
    seed(goodMailbox(sam, { dailyCap: 10 }), goodMailbox(lee, { dailyCap: 50 }));
    render(<Mailboxes />);
    const lower = within(card(sam)).getByRole("button", { name: t.lower });
    expect(lower.hasAttribute("disabled")).toBe(true);
    expect(lower.getAttribute("data-tip")).toBe(t.atLeast(10));
    const raise = within(card(lee)).getByRole("button", { name: t.raise });
    expect(raise.hasAttribute("disabled")).toBe(true);
    expect(raise.getAttribute("data-tip")).toBe(t.atMost(50));
  });

  it("pauses and resumes", async () => {
    seed(goodMailbox(sam), goodMailbox(lee, { paused: true, status: "paused" }));
    render(<Mailboxes />);
    await click(within(card(sam)).getByRole("button", { name: t.pause }));
    expect(bridge.calls.at(-1)).toEqual(["reach:mailbox-set", { address: sam, paused: true }]);
    expect(toast()?.msg).toBe(t.pausedToast("sam"));
    expect(toast()?.sub).toBe(t.pausedSub);
    await click(within(card(lee)).getByRole("button", { name: t.resume }));
    expect(bridge.calls.at(-1)).toEqual(["reach:mailbox-set", { address: lee, paused: false }]);
    expect(toast()?.msg).toBe(t.resumedToast("lee"));
  });

  it("sends a test, and refuses one for a paused or signed-out mailbox", async () => {
    seed(
      goodMailbox(sam),
      goodMailbox(lee, { paused: true, status: "paused" }),
      goodMailbox(ann, { signedOut: true, status: "signed_out" }),
    );
    render(<Mailboxes />);
    await click(within(card(sam)).getByRole("button", { name: t.test }));
    expect(bridge.calls.at(-1)).toEqual(["reach:send-test", { address: sam }]);
    expect(toast()?.msg).toBe(t.testSent(sam));
    expect(toast()?.sub).toBe(t.testSentSub);
    const paused = within(card(lee)).getByRole("button", { name: t.test });
    expect(paused.hasAttribute("disabled")).toBe(true);
    expect(paused.getAttribute("data-tip")).toBe(t.testTipPaused);
    const out = within(card(ann));
    expect(out.getByRole("button", { name: t.test }).hasAttribute("disabled")).toBe(true);
    await click(out.getByRole("button", { name: t.signIn }));
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "settings" });
  });

  it("says why a test or a change did not work", async () => {
    bridge = stubReachBridge({
      "reach:send-test": { ok: false, problem: "busy" },
      "reach:mailbox-set": { ok: false, problem: "not_found" },
    });
    seed(goodMailbox(sam));
    render(<Mailboxes />);
    await click(within(card(sam)).getByRole("button", { name: t.test }));
    expect(toast()?.msg).toBe(t.testProblems.busy);
    await click(within(card(sam)).getByRole("button", { name: t.pause }));
    expect(toast()?.msg).toBe(t.setProblems.not_found);
  });
});
