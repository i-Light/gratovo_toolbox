// @vitest-environment happy-dom
import type { ThreadMessage } from "@gratovo/core/data";
import type { TodayItem, TodayKind } from "@gratovo/core/today";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { WorkPane } from "./work-pane";

const t = strings.today.pane;
const words = { title: "A title", sub: "", why: "Because." };

const item = (kind: TodayKind, over: Partial<TodayItem> = {}): TodayItem => ({
  key: `${kind}:c1`,
  bucket: "sends",
  kind,
  ref: { kind: "creator", id: "c1" },
  draft: null,
  due: null,
  age: false,
  minutes: 3,
  quick: false,
  owner: null,
  ...over,
});

const msg = (id: string, direction: "in" | "out", body: string): ThreadMessage =>
  ({
    id,
    direction,
    kind: null,
    followUp: null,
    subject: "Hello",
    body,
    bodyCut: false,
    at: 1,
    mailbox: null,
    address: null,
    reading: null,
  }) as unknown as ThreadMessage;

async function show(it: TodayItem) {
  const view = render(<WorkPane item={it} words={words} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function seed(draft = false): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab", { stage: "replied" })],
    reachWith({
      gemini: "ready",
      drafts: draft ? [aiDraft("d1", "c1")] : [],
      mailboxes: [goodMailbox("sam@gratovo.example")],
    }),
    "live",
  );
}

beforeEach(() => {
  stubReachBridge({
    "find:item": { item: null },
    "reach:thread": {
      ok: true,
      messages: [
        msg("m1", "out", "First note"),
        msg("m2", "in", "Second note"),
        msg("m3", "in", "Third note"),
      ],
    },
  });
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the work pane", () => {
  it("shows the header with Record and Snooze", async () => {
    seed();
    await show(item("send"));
    expect(screen.getByRole("heading", { name: words.title })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(t.record) })).toBeTruthy();
    expect(document.querySelector('[data-ui="today.snooze"]')).not.toBeNull();
  });

  it("shows the draft card for a send item", async () => {
    seed(true);
    const { container } = await show(item("send", { draft: "d1" }));
    expect(container.querySelector('[data-ui="reach.draft"]')).not.toBeNull();
  });

  it("shows the last two messages and the draft for a reply", async () => {
    seed(true);
    const { container } = await show(item("reply", { draft: "d1" }));
    expect(container.querySelector('[data-ui="record.emails.thread"]')).not.toBeNull();
    expect(screen.queryByText("First note")).toBeNull();
    expect(screen.getByText("Second note")).toBeTruthy();
    expect(screen.getByText("Third note")).toBeTruthy();
    expect(container.querySelector('[data-ui="reach.draft"]')).not.toBeNull();
  });

  it("says so when a reply has no draft, and opens the Emails tab", async () => {
    seed();
    await show(item("reply"));
    expect(screen.getByText(t.replyWriting)).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: t.openEmails }).click();
      await Promise.resolve();
    });
    expect(appStore().getState().ui.peek?.tab).toBe("emails");
  });

  it("shows the audience check for an audience item", async () => {
    seed();
    const { container } = await show(item("audience", { bucket: "close" }));
    expect(container.querySelector('[data-ui="record.audience.check"]')).not.toBeNull();
  });

  it("shows the contact block for a contact item", async () => {
    seed();
    const { container } = await show(item("contact", { bucket: "contacts" }));
    expect(container.querySelector(".ct-blk, .ct-done")).not.toBeNull();
  });

  it("shows the next step and Open the deal for a deal item", async () => {
    const deal = appStore().getState().data.deals[0];
    expect(deal).toBeDefined();
    const { container } = await show(
      item("deal", { bucket: "deals", ref: { kind: "deal", id: deal?.id ?? "" } }),
    );
    expect(container.querySelector('[data-ui="today.work.next"]')).not.toBeNull();
    await act(async () => {
      screen.getByRole("button", { name: t.openDeal }).click();
      await Promise.resolve();
    });
    expect(appStore().getState().ui.peek?.record.kind).toBe("deal");
  });

  it("shows the changed line when the creator is gone", async () => {
    seed();
    await show(item("send", { ref: { kind: "creator", id: "nobody" } }));
    expect(screen.getByText(t.changed)).toBeTruthy();
  });

  it("shows the next-one line for 4.5 s", async () => {
    vi.useFakeTimers();
    seed();
    appStore().ui((u) => {
      u.today.justDone = { title: "Old thing", at: Date.now(), step: null };
    });
    await show(item("send"));
    expect(screen.getByRole("status").textContent).toContain(t.nextOne("Old thing"));
    act(() => {
      vi.advanceTimersByTime(4600);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
