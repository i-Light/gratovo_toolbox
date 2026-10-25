// @vitest-environment happy-dom
import type { OutreachDraft, ThreadMessage } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installPersistence } from "../lib/persist";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { CreatorEmails } from "./creator-emails";
import { DraftCard } from "./draft-card";
import { typeDelayMs } from "./use-draft-text";

const t = strings.reach;
const c = t.card;
const now = new Date(2026, 9, 24, 10, 0, 0).getTime();
const sam = "sam@gratovo.example";
const lee = "lee@gratovo.example";
const priceGate = { key: "price", kind: "price", text: "The email names a price." } as const;

let bridge = stubReachBridge();
let uninstall: () => void = () => undefined;

function setup(drafts: OutreachDraft[], gemini: "ready" | "off" = "ready", creator = {}): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab", creator)],
    reachWith({
      gemini,
      drafts,
      mailboxes: [goodMailbox(sam), goodMailbox(lee, { leftToday: 20 })],
    }),
  );
}

const draftOf = (id: string) =>
  appStore()
    .getState()
    .data.reach.drafts.find((d) => d.id === id);
const send = (): HTMLButtonElement => {
  const button = document.querySelector('[data-ui="reach.draft.send"] button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("no Send button");
  }
  return button;
};
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  bridge = stubReachBridge({ "find:item": { item: null } });
  resetAppStoreForTests({ screen: "reach", tab: "board" }, now);
  uninstall = installPersistence(((channel: string, input: unknown) =>
    window.gratovo.invoke(channel as "data:write", input as never)) as never);
});
afterEach(async () => {
  cleanup();
  await settle();
  uninstall();
  vi.useRealTimers();
});

describe("the draft card", () => {
  it("shows the header, the To and From lines, and the text", () => {
    setup([aiDraft("d1", "c1", { edited: true, createdAt: now })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(c.drafted("just now") + " · " + c.edited)).toBeTruthy();
    expect(screen.getByText("hello@promptlab.example")).toBeTruthy();
    expect(screen.getByText(c.confirmed)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: c.sendFrom })).toBeTruthy();
    expect(screen.getByText(c.leftToday(28))).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: c.subject }).value).toBe(
      "Your agents video",
    );
  });

  it("holds Send while a gate is open and frees it when the gate is confirmed", async () => {
    setup([
      aiDraft("d1", "c1", {
        proposal: {
          status: "needs_human",
          why: "They cover AI agents.",
          rules: [],
          findings: [],
          gates: [priceGate],
          situation: null,
          model: null,
        },
      }),
    ]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(priceGate.text)).toBeTruthy();
    expect(send().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.gateConfirm }));
      await Promise.resolve();
    });
    expect(screen.queryByText(priceGate.text)).toBeNull();
    expect(send().disabled).toBe(false);
  });

  it("clears the unconfirmed gate when its address is confirmed", async () => {
    setup([aiDraft("d1", "c1")], "ready", { emailConfirmed: false });
    render(<DraftCard draftId="d1" />);
    await settle();
    expect(screen.getByText(t.gates.unconfirmed)).toBeTruthy();
    expect(screen.getByText(c.notConfirmed)).toBeTruthy();
    expect(send().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.addressConfirm }));
      await Promise.resolve();
    });
    expect(screen.queryByText(t.gates.unconfirmed)).toBeNull();
    expect(send().disabled).toBe(false);
  });

  it("offers another mailbox when this one is full, and moves the draft to it", async () => {
    seedReach(
      [aiCreator("c1", "Prompt Lab")],
      reachWith({
        gemini: "ready",
        drafts: [aiDraft("d1", "c1")],
        mailboxes: [goodMailbox(sam, { leftToday: 0, sentToday: 30 }), goodMailbox(lee)],
      }),
    );
    render(<DraftCard draftId="d1" />);
    expect(send().disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.sendInstead(lee) }));
      await Promise.resolve();
    });
    expect(draftOf("d1")?.mailbox).toBe(lee);
    expect(send().disabled).toBe(false);
  });

  it("sends on Ctrl+Enter from inside the card, and only then", () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: c.body }), { key: "Enter" });
    expect(draftOf("d1")?.state).toBe("ready");
    fireEvent.keyDown(screen.getByRole("textbox", { name: c.body }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(draftOf("d1")?.state).toBe("approved");
    expect(screen.getByText(c.sendingIn(10))).toBeTruthy();
  });

  it("takes the email back with Undo during the hold", () => {
    setup([aiDraft("d1", "c1", { state: "approved", sendAt: now + 6_000 })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(c.sendingIn(6))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: c.undo }));
    expect(draftOf("d1")?.state).toBe("ready");
  });

  it("writes typed text 600 ms after the last key, and on blur", async () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    const body = screen.getByRole("textbox", { name: c.body });
    fireEvent.focus(body);
    fireEvent.change(body, { target: { value: "Hi, new text" } });
    act(() => {
      vi.advanceTimersByTime(typeDelayMs - 1);
    });
    expect(bridge.writes).toHaveLength(0);
    fireEvent.change(body, { target: { value: "Hi, newer text" } });
    act(() => {
      vi.advanceTimersByTime(typeDelayMs - 1);
    });
    expect(bridge.writes).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bridge.writes).toEqual([
      [{ kind: "draft.text", id: "d1", subject: "Your agents video", body: "Hi, newer text" }],
    ]);
    fireEvent.change(body, { target: { value: "Hi, last" } });
    await act(async () => {
      fireEvent.blur(body);
      await Promise.resolve();
    });
    expect(bridge.writes).toHaveLength(2);
    expect(draftOf("d1")?.edited).toBe(true);
  });

  it("keeps what is typed when the server text changes under a focused field", () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    const body = screen.getByRole<HTMLTextAreaElement>("textbox", { name: c.body });
    fireEvent.focus(body);
    fireEvent.change(body, { target: { value: "mine" } });
    act(() => {
      seedReach(
        [aiCreator("c1", "Prompt Lab")],
        reachWith({
          ...appStore().getState().data.reach,
          drafts: [aiDraft("d1", "c1", { body: "from the server" })],
        }),
      );
    });
    expect(body.value).toBe("mine");
    fireEvent.blur(body);
  });

  it("disables the rewrite chips with a tip when Gemini is off, and rewrites when it is ready", async () => {
    setup([aiDraft("d1", "c1")], "off");
    render(<DraftCard draftId="d1" />);
    const shorter = screen.getByRole("button", { name: c.rewriteChips.shorter });
    expect((shorter as HTMLButtonElement).disabled).toBe(true);
    expect(shorter.getAttribute("data-tip")).toBe(c.rewriteOff);
    cleanup();
    setup([aiDraft("d1", "c1")], "ready");
    render(<DraftCard draftId="d1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.rewriteChips.warmer }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:rewrite", { draftId: "d1", how: "warmer" }]);
  });

  it("shimmers the body and blocks Send while it is being rewritten", () => {
    setup([aiDraft("d1", "c1", { rewriting: "shorter" })]);
    const { container } = render(<DraftCard draftId="d1" />);
    expect(container.querySelector(".draft.rewriting")).not.toBeNull();
    expect(send().disabled).toBe(true);
  });

  it("shows a skeleton while Gemini writes, with the reason when it waits", () => {
    setup([aiDraft("d1", "c1", { state: "drafting", proposal: null, problem: "bridge_off" })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(c.drafting)).toBeTruthy();
    expect(screen.getByText(c.draftingWaits.bridge_off)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: c.body })).toBeNull();
  });

  it("shows a failed draft's problem with Try again", async () => {
    setup([aiDraft("d1", "c1", { state: "failed", problem: "engine_failed" })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(t.problems.engine_failed)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.tryAgain }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:retry", { draftId: "d1" }]);
  });

  it("asks what happened to a maybe-sent email, and confirms before sending it as new", async () => {
    setup([aiDraft("d1", "c1", { state: "failed", problem: "maybe_sent" })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(t.problems.maybe_sent)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.wasSent }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:mark-sent", { draftId: "d1" }]);
    fireEvent.click(screen.getByRole("button", { name: c.sendAsNew }));
    expect(bridge.calls.some(([channel]) => channel === "reach:send-new")).toBe(false);
    expect(screen.getByText(new RegExp(c.sendAsNewSure))).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: c.sendAsNewYes }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:send-new", { draftId: "d1" }]);
  });

  it("shows why a ready draft came back", () => {
    setup([aiDraft("d1", "c1", { problem: "not_sent_closed" })]);
    render(<DraftCard draftId="d1" />);
    expect(screen.getByText(t.problems.not_sent_closed)).toBeTruthy();
    expect(send().disabled).toBe(false);
  });

  it("skips the draft", () => {
    setup([aiDraft("d1", "c1")]);
    render(<DraftCard draftId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: c.skip }));
    expect(draftOf("d1")?.state).toBe("skipped");
  });
});

describe("the Emails tab", () => {
  const message = (id: string, direction: "in" | "out", at: number): ThreadMessage => ({
    id,
    direction,
    kind: direction === "out" ? "first" : null,
    followUp: null,
    subject: "Your agents video",
    body: `Message ${id}`,
    bodyCut: false,
    at,
    mailbox: sam,
    peer: "hello@promptlab.example",
    peerName: null,
    by: null,
    source: "app",
    reading: null,
  });

  it("loads the thread, folds the oldest, and lists the open draft", async () => {
    bridge = stubReachBridge({
      "find:item": { item: null },
      "reach:thread": {
        ok: true,
        messages: [
          message("m1", "out", now - 5 * 86_400_000),
          message("m2", "in", now - 4 * 86_400_000),
          message("m3", "out", now - 3 * 86_400_000),
          message("m4", "in", now - 2 * 86_400_000),
        ],
      },
    });
    setup([aiDraft("d1", "c1", { kind: "reply" })], "ready", { stage: "replied" });
    render(<CreatorEmails creatorId="c1" />);
    await settle();
    expect(screen.getByText("Message m4")).toBeTruthy();
    expect(screen.queryByText("Message m1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.emails.earlier(1) }));
    expect(screen.getByText("Message m1")).toBeTruthy();
    expect(screen.getByRole("group", { name: c.label(t.kinds.reply) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.emails.draftFirst })).toBeNull();
  });

  it("says there are no emails yet, and offers the first draft at Contact", async () => {
    bridge = stubReachBridge({
      "find:item": { item: null },
      "reach:thread": { ok: true, messages: [] },
    });
    setup([]);
    render(<CreatorEmails creatorId="c1" />);
    await settle();
    expect(screen.getByText(t.emails.none)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.emails.draftFirst }));
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual(["reach:draft-now", { creatorId: "c1" }]);
  });
});
