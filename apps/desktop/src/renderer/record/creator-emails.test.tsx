// @vitest-environment happy-dom
import type { Sequence } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { CreatorEmails } from "./creator-emails";

const t = strings.reach.sequences;
const day = 86_400_000;
const now = Date.now();
let bridge = stubReachBridge();

const seq = (over: Partial<Sequence> = {}): Sequence => ({
  creator: "c1",
  mailbox: "sam@gratovo.example",
  startedAt: now - day,
  steps: [{ n: 1, dueAt: now + 2 * day, state: "planned", sentAt: null }],
  stopped: null,
  parkUntil: null,
  ...over,
});

function show(sequence: Sequence | null): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab", { stage: "emailed" })],
    reachWith({ sequences: sequence === null ? [] : [sequence] }),
    "live",
  );
  render(<CreatorEmails creatorId="c1" />);
}

beforeEach(() => {
  bridge = stubReachBridge({ "reach:thread": { ok: true, messages: [] } });
  resetAppStoreForTests({ screen: "find", tab: "search" }, now);
});
afterEach(() => {
  cleanup();
});

describe("the Emails tab next step", () => {
  it("shows Stop and Park while a sequence runs", async () => {
    show(seq());
    expect(await screen.findByText(t.next.step(1, t.next.inDays(2)))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.resumeShort })).toBeNull();
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("button", { name: t.stopShort }));
    });
    expect(bridge.calls.some((c) => c[0] === "reach:sequence-stop")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: t.park }));
    expect(appStore().getState().ui.menu?.items.length).toBe(4);
  });

  it("shows Resume when you stopped it, and Wake now when parked", async () => {
    show(seq({ stopped: "you" }));
    expect(await screen.findByRole("button", { name: t.resumeShort })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.stopShort })).toBeNull();
    cleanup();
    show(seq({ parkUntil: now + 10 * day }));
    expect(await screen.findByRole("button", { name: t.wake })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.park })).toBeNull();
  });

  it("shows nothing without a sequence", () => {
    show(null);
    expect(screen.queryByRole("group", { name: t.record.label })).toBeNull();
  });
});

describe("paste a reply by hand", () => {
  const p = strings.reach.emails.paste;
  const out = {
    id: "o1",
    direction: "out",
    kind: "first",
    followUp: null,
    subject: "Hi",
    body: "Hi there",
    bodyCut: false,
    at: now - day,
    mailbox: null,
    peer: null,
    peerName: null,
    by: null,
    source: "app",
    reading: null,
  } as const;
  const showThread = (
    messages: readonly unknown[],
    answers: Record<string, unknown> = {},
  ): void => {
    bridge = stubReachBridge({ "reach:thread": { ok: true, messages }, ...answers });
    show(null);
  };
  const toasts = () => appStore().getState().ui.toasts;

  it("is offered only once the thread has an email out", async () => {
    showThread([]);
    await screen.findByText(strings.reach.emails.none);
    expect(screen.queryByRole("button", { name: p.open })).toBeNull();
    cleanup();
    showThread([out]);
    expect(await screen.findByRole("button", { name: p.open })).toBeTruthy();
  });

  it("adds the reply on Ctrl Enter, says so and loads the thread again", async () => {
    showThread([out], { "reach:paste-reply": { ok: true } });
    fireEvent.click(await screen.findByRole("button", { name: p.open }));
    const box = screen.getByRole("textbox", { name: p.label });
    expect(screen.getByText(p.hint)).toBeTruthy();
    fireEvent.change(box, { target: { value: "Sounds good, my rate is $900." } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual([
      "reach:paste-reply",
      { creatorId: "c1", text: "Sounds good, my rate is $900." },
    ]);
    expect(toasts().at(-1)?.msg).toBe(p.added("Prompt Lab"));
    expect(toasts().at(-1)?.sub).toBe(p.addedSub);
    expect(screen.queryByRole("textbox", { name: p.label })).toBeNull();
    expect(bridge.calls.filter((c) => c[0] === "reach:thread")).toHaveLength(2);
  });

  it("closes on Esc without sending", async () => {
    showThread([out]);
    fireEvent.click(await screen.findByRole("button", { name: p.open }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: p.label }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: p.label })).toBeNull();
    expect(bridge.calls.some((c) => c[0] === "reach:paste-reply")).toBe(false);
  });

  it("says plainly why a reply was refused and keeps the box open", async () => {
    showThread([out], { "reach:paste-reply": { ok: false, problem: "no_outbound" } });
    fireEvent.click(await screen.findByRole("button", { name: p.open }));
    const box = screen.getByRole("textbox", { name: p.label });
    fireEvent.change(box, { target: { value: "Hello" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add reply/ }));
      await Promise.resolve();
    });
    expect(toasts().at(-1)?.msg).toBe(p.problems.no_outbound);
    expect(screen.getByRole("textbox", { name: p.label })).toBeTruthy();
  });

  it("shows Gemini's reading under their last reply", async () => {
    const inMsg = {
      ...out,
      id: "i1",
      direction: "in",
      kind: null,
      reading: {
        replyType: "inf.gives_rate",
        label: "Gives their rate",
        summary: "They quote a rate.",
        side: "creator",
        corrected: false,
        facts: [{ key: "rate", rate: 900, saved: false }],
      },
    };
    showThread([out, inMsg]);
    expect(await screen.findByText("Rate $900")).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.reach.reading.save })).toBeTruthy();
  });
});
