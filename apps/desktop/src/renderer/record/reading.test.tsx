// @vitest-environment happy-dom
import type { ReplyReading, ThreadSummary } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetSituationsForTests } from "../lib/reach-actions";
import { aiDraft, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { Reading } from "./reading";

const t = strings.reach.reading;
const now = Date.now();

const reading = (over: Partial<ReplyReading> = {}): ReplyReading => ({
  replyType: "inf.gives_rate",
  label: "Gives their rate",
  summary: "They quote $1,200 and say most viewers are in the US.",
  side: "creator",
  corrected: false,
  facts: [
    { key: "rate", rate: 1200, saved: false },
    {
      key: "countries",
      countries: [
        { code: "US", share: 45 },
        { code: "UK", share: 20 },
      ],
      saved: false,
    },
    { key: "age", band: "25-34", saved: true },
  ],
  ...over,
});
const summary = (r: ReplyReading | null): ThreadSummary => ({
  creator: "c1",
  count: 2,
  lastOutAt: now - 1000,
  lastIn: { id: "m1", at: now, reading: r, preview: "Hi", bounce: false },
  answered: false,
});
const situations = [
  { id: "inf.gives_rate", label: "Gives their rate", side: "influencer" },
  { id: "inf.later", label: "Not now, maybe later", side: "influencer" },
  { id: "brand.wants_demo", label: "Wants a demo", side: "brand" },
  { id: "any.bounce", label: "The email bounced", side: "any" },
];
let bridge = stubReachBridge();
const menuLabels = (): string[] =>
  (appStore().getState().ui.menu?.items ?? []).flatMap((i) => ("label" in i ? [i.label] : []));

function show(r: ReplyReading | null, drafts = reachWith({}).drafts): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab", { stage: "replied" })],
    reachWith({ threads: [summary(r)], drafts }),
    "live",
  );
  render(<Reading creatorId="c1" message={{ id: "m1", reading: r }} />);
}

beforeEach(() => {
  resetSituationsForTests();
  bridge = stubReachBridge({ "reach:situations": { ok: true, situations } });
  resetAppStoreForTests({ screen: "reach", tab: "inbox" }, now);
});
afterEach(() => {
  cleanup();
});

describe("the reading block", () => {
  it("shows the label, the summary and a chip per fact", () => {
    show(reading());
    expect(screen.getByText("Gives their rate")).toBeTruthy();
    expect(screen.getByText(t.label)).toBeTruthy();
    expect(screen.getByText(/They quote \$1,200/)).toBeTruthy();
    expect(screen.getByText("Rate $1,200")).toBeTruthy();
    expect(screen.getByText("US 45% · UK 20%")).toBeTruthy();
    expect(screen.getByText("Age 25-34")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: t.save })).toHaveLength(2);
    expect(screen.getByRole("button", { name: t.saved }).hasAttribute("disabled")).toBe(true);
  });

  it("writes reply.fact on Save to record and shows Saved", async () => {
    show(reading());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: t.save })[0] as HTMLElement);
      await Promise.resolve();
    });
    expect(bridge.writes).toEqual([[{ kind: "reply.fact", messageId: "m1", key: "rate" }]]);
    expect(screen.getAllByRole("button", { name: t.saved })).toHaveLength(2);
    expect(appStore().getState().ui.toasts.at(-1)?.msg).toBe(t.savedAct("rate", "Prompt Lab"));
  });

  it("marks a corrected reading", () => {
    show(reading({ corrected: true }));
    expect(screen.getByText(t.corrected)).toBeTruthy();
  });

  it("opens That's not it with the side's situations and any, and reclassifies", async () => {
    show(reading());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.notIt }));
      await Promise.resolve();
    });
    expect(menuLabels()).toEqual(["Gives their rate", "Not now, maybe later", "The email bounced"]);
    expect(bridge.calls.filter((c) => c[0] === "reach:situations")).toHaveLength(1);
    const later = appStore()
      .getState()
      .ui.menu?.items.find((i) => i.kind === "item" && i.label === "Not now, maybe later");
    await act(async () => {
      if (later?.kind === "item") {
        later.run();
      }
      await Promise.resolve();
    });
    expect(bridge.calls).toContainEqual([
      "reach:reclassify",
      { messageId: "m1", replyType: "inf.later" },
    ]);
    expect(appStore().getState().ui.toasts.at(-1)?.msg).toBe(t.reread("Not now, maybe later"));
  });

  it("shows the brand side's situations for a brand reading", async () => {
    show(reading({ side: "brand" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.notIt }));
      await Promise.resolve();
    });
    expect(menuLabels()).toEqual(["Wants a demo", "The email bounced"]);
  });

  it("shows a line while the answer is being written, else nothing", () => {
    show(null, [aiDraft("d1", "c1", { kind: "reply", state: "drafting", proposal: null })]);
    expect(screen.getByText(t.reading)).toBeTruthy();
    cleanup();
    show(null);
    expect(screen.queryByText(t.reading)).toBeNull();
    expect(screen.queryByRole("button", { name: t.notIt })).toBeNull();
  });
});
