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
