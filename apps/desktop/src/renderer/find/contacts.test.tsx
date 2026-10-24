// @vitest-environment happy-dom
import { formatCount } from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { undo } from "../lib/actions";
import { emailJobId } from "../lib/email-jobs";
import { resetFindForTests } from "../lib/find";
import { aiChannel, stubFindBridge } from "../lib/find-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { Contacts } from "./contacts";

const t = strings.findContacts;
const b = t.block;

async function show(): Promise<void> {
  render(<Contacts />);
  await act(async () => {
    await Promise.resolve();
  });
}
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};
const type = async (el: HTMLElement, value: string): Promise<void> => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    await Promise.resolve();
  });
};
const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);
const lines = () =>
  appStore()
    .getState()
    .data.log.filter((l) => l.ref !== null);
const toast = () => appStore().getState().ui.toasts.at(-1);
const card = (name: string) => within(screen.getByRole("article", { name }));

const short = { stage: "shortlisted" } as const;
const sure = aiChannel("UC-sure", "Agent Lab", short);
const sure2 = aiChannel("UC-sure2", "Prompt Garage", short);
const unsure = aiChannel("UC-unsure", "Model Weekly", {
  ...short,
  emails: [
    { email: "hi@modelweekly.com", source: "video", videos: 1, business: false, confidence: 0.6 },
  ],
});
const none = aiChannel("UC-none", "Quiet Channel", { ...short, emails: [] });

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "find", tab: "contacts" });
});
afterEach(cleanup);

describe("Find › Contacts", () => {
  it("says so when nobody is waiting, and goes to Review new", async () => {
    stubFindBridge({ items: [aiChannel("UC-new", "Fresh One")] });
    await show();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.goReview }));
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "find", tab: "triage" });
  });

  it("lists the shortlisted channels with their numbers and address words", async () => {
    stubFindBridge({ items: [sure, unsure, aiChannel("UC-new", "Fresh One")] });
    await show();
    expect(screen.getByText(t.header(2))).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Fresh One" })).toBeNull();
    const lab = card("Agent Lab");
    expect(lab.getByText(new RegExp(t.subscribers(formatCount(120_000))))).toBeTruthy();
    expect(lab.getByText(b.found(2))).toBeTruthy();
    expect(lab.getByText("biz@agentlab.ai")).toBeTruthy();
    expect(lab.getByText(b.aboutPage)).toBeTruthy();
    expect(lab.getByText(b.videos(3))).toBeTruthy();
    expect(lab.getByText(b.sure(0.95))).toBeTruthy();
    // Only the About address with a business word carries the tag.
    expect(lab.getAllByText(b.business)).toHaveLength(1);
    expect(card("Model Weekly").getByText(b.videos(1))).toBeTruthy();
  });

  it("words an About address that videos repeat", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-x", "Mixed Source", {
          ...short,
          emails: [
            { email: "a@mixed.ai", source: "about", videos: 2, business: false, confidence: 0.9 },
          ],
        }),
      ],
    });
    await show();
    expect(screen.getByText(b.aboutAndVideos(2))).toBeTruthy();
  });

  it("picks the most sure address, and confirms another one with a name", async () => {
    stubFindBridge({ items: [sure] });
    await show();
    const radios = screen.getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    await click(radios[1] as HTMLElement);
    await type(screen.getByLabelText(b.nameLabel), "Sam");
    await click(screen.getAllByRole("button", { name: b.confirm })[0] as HTMLElement);
    expect(creatorOf("UC-sure")).toMatchObject({
      stage: "contact",
      email: "agentlab@gmail.com",
      emailConfirmed: true,
      contactName: "Sam",
      contactSource: "video",
      contactConfidence: 0.75,
    });
    expect(lines()).toHaveLength(1);
    expect(toast()?.msg).toBe(t.confirmed("Agent Lab"));
    // The confirmed channel leaves the list; Undo brings it back as it was.
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    await act(async () => {
      undo();
      await Promise.resolve();
    });
    expect(creatorOf("UC-sure")).toMatchObject({ stage: "shortlisted", email: null });
    expect(lines()).toHaveLength(0);
    expect(screen.getByRole("article", { name: "Agent Lab" })).toBeTruthy();
  });

  it("checks a typed address before it can be confirmed", async () => {
    stubFindBridge({ items: [none] });
    await show();
    expect(screen.getByText(b.none)).toBeTruthy();
    const input = screen.getByLabelText(b.typeAnother);
    // No address found: the name field and the typed address are all there is.
    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: b.typeConfirm });
    expect(confirm.disabled).toBe(true);
    await type(input, "not an address");
    // Nothing is said while typing; leaving the field says it.
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toBe(b.typeBad);
    expect(confirm.disabled).toBe(true);
    await type(input, `${"a".repeat(250)}@b.co`);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toBe(b.typeLong(254));
    expect(confirm.disabled).toBe(true);
    await type(input, "  hello@quiet.ai ");
    expect(screen.queryByRole("alert")).toBeNull();
    await click(confirm);
    expect(creatorOf("UC-none")).toMatchObject({
      email: "hello@quiet.ai",
      contactSource: "typed",
      contactConfidence: null,
      stage: "contact",
    });
  });

  it("Confirm all 90%+ confirms the best of the sure ones only, in one act", async () => {
    stubFindBridge({ items: [sure, sure2, unsure, none] });
    await show();
    const all = screen.getByRole("button", { name: t.confirmAll(2) });
    expect(all.getAttribute("data-tip")).toBe("biz@agentlab.ai, biz@promptgarage.ai");
    await click(all);
    expect(creatorOf("UC-sure")).toMatchObject({ stage: "contact", contactName: null });
    expect(creatorOf("UC-sure2")?.stage).toBe("contact");
    expect(creatorOf("UC-unsure")).toBeUndefined();
    expect(lines()).toHaveLength(2);
    expect(toast()?.msg).toBe(t.confirmedMany(2));
    expect(screen.getByText(t.header(2))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm all/ })).toBeNull();
    await act(async () => {
      undo();
      await Promise.resolve();
    });
    expect(creatorOf("UC-sure")?.stage).toBe("shortlisted");
    expect(creatorOf("UC-sure2")?.stage).toBe("shortlisted");
  });

  it("shows no Confirm all when no best address is 90% sure", async () => {
    stubFindBridge({ items: [unsure] });
    await show();
    expect(screen.queryByRole("button", { name: /Confirm all/ })).toBeNull();
  });

  it("changes a confirmed address", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-done", "Done Deal", {
          stage: "shortlisted",
          email: "old@done.ai",
          emailConfirmed: true,
          contactName: "Kim",
        }),
      ],
    });
    await show();
    expect(screen.getByText("old@done.ai")).toBeTruthy();
    expect(screen.getByText(b.by("Kim"))).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    await click(screen.getByRole("button", { name: b.change }));
    expect(screen.getByLabelText<HTMLInputElement>(b.nameLabel).value).toBe("Kim");
    await click(screen.getAllByRole("radio")[0] as HTMLElement);
    await click(screen.getAllByRole("button", { name: b.confirm })[0] as HTMLElement);
    expect(creatorOf("UC-done")).toMatchObject({ email: "biz@donedeal.ai", contactName: "Kim" });
  });

  it("holds up to ten 254-character addresses and an 80-character name", async () => {
    const long = (i: number): string => `${String(i)}${"a".repeat(247)}@ex.ai`;
    const emails = Array.from({ length: 10 }, (_, i) => ({
      email: long(i),
      source: "video" as const,
      videos: 1,
      business: false,
      confidence: 0.6,
    }));
    stubFindBridge({ items: [aiChannel("UC-w", "N".repeat(120), { ...short, emails })] });
    await show();
    expect(screen.getAllByRole("radio")).toHaveLength(10);
    const name = screen.getByLabelText<HTMLInputElement>(b.nameLabel);
    expect(name.maxLength).toBe(80);
    await type(name, "n".repeat(80));
    await click(screen.getAllByRole("button", { name: b.confirm })[0] as HTMLElement);
    expect(creatorOf("UC-w")?.contactName).toHaveLength(80);
    expect(creatorOf("UC-w")?.email).toHaveLength(254);
  });
  it("pages 130 shortlisted channels: 120, then Show more adds the rest", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      aiChannel(`UC-m${String(i)}`, `Channel ${String(i)}`, short),
    );
    stubFindBridge({ items: many });
    await show();
    expect(screen.getAllByRole("article")).toHaveLength(120);
    expect(screen.getByText(t.loadedOf(120, 130))).toBeTruthy();
    await click(screen.getByRole("button", { name: t.showMore }));
    expect(screen.getAllByRole("article")).toHaveLength(130);
    expect(screen.queryByRole("button", { name: t.showMore })).toBeNull();
  });

  it("Confirm all leaves an address a person already confirmed alone", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-kept", "Kept Name", {
          ...short,
          email: "mine@kept.ai",
          emailConfirmed: true,
          contactName: "Kim",
        }),
        sure,
      ],
    });
    await show();
    await click(screen.getByRole("button", { name: t.confirmAll(1) }));
    expect(creatorOf("UC-kept")).toBeUndefined();
    expect(creatorOf("UC-sure")?.stage).toBe("contact");
  });

  it("puts channels with nothing found last, and says a lookup is on while it runs", async () => {
    stubFindBridge({ items: [none, sure, unsure] });
    appStore().ui((ui) => {
      ui.jobs = [
        { id: emailJobId, kind: "contacts", label: "x", progress: 0, total: 1, done: false },
      ];
    });
    await show();
    const names = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    expect(names[2]).toBe("Quiet Channel");
    expect(card("Quiet Channel").getByText(b.looking)).toBeTruthy();
    expect(card("Quiet Channel").queryByText(b.none)).toBeNull();
    await act(async () => {
      appStore().ui((ui) => {
        ui.jobs = [];
      });
      await Promise.resolve();
    });
    expect(card("Quiet Channel").getByText(b.none)).toBeTruthy();
  });

  it("lists at most five addresses in the Confirm all tooltip", async () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      aiChannel(`UC-s${String(i)}`, `Sure ${String(i)}`, short),
    );
    stubFindBridge({ items: seven });
    await show();
    const tip = screen.getByRole("button", { name: t.confirmAll(7) }).getAttribute("data-tip");
    expect(tip?.split(", ")).toHaveLength(6);
    expect(tip?.endsWith(t.andMore(2))).toBe(true);
  });

  it("moves focus to the next card after Confirm", async () => {
    stubFindBridge({ items: [sure, unsure] });
    await show();
    const [first, second] = screen.getAllByRole("article") as [HTMLElement, HTMLElement];
    await click(within(first).getAllByRole("button", { name: b.confirm })[0] as HTMLElement);
    expect(second.contains(document.activeElement)).toBe(true);
  });

  it("moves focus to the previous card when the last one is confirmed", async () => {
    stubFindBridge({ items: [sure, unsure] });
    await show();
    const [first, second] = screen.getAllByRole("article") as [HTMLElement, HTMLElement];
    await click(within(second).getAllByRole("button", { name: b.confirm })[0] as HTMLElement);
    expect(first.contains(document.activeElement)).toBe(true);
  });

  it("focuses the header after Confirm all and the empty card when none is left", async () => {
    stubFindBridge({ items: [sure, sure2] });
    await show();
    await click(screen.getByRole("button", { name: t.confirmAll(2) }));
    expect(document.activeElement?.textContent).toContain(t.emptyTitle);
  });

  it("keeps the Confirm button after Change on a confirmed typed address", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-ty", "Typed One", { ...short, email: "typed@one.ai", emailConfirmed: true }),
      ],
    });
    await show();
    await click(screen.getByRole("button", { name: b.change }));
    expect(screen.getByRole("button", { name: b.confirm })).toBeTruthy();
  });

  it("shows a failed Show more as a retry", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      aiChannel(`UC-m${String(i)}`, `Channel ${String(i)}`, short),
    );
    stubFindBridge({ items: many });
    await show();
    const bridge = (window as unknown as { gratovo: Bridge }).gratovo;
    const real = bridge.invoke.bind(bridge);
    (window as unknown as { gratovo: Bridge }).gratovo = {
      ...bridge,
      invoke: (c: string, i: unknown) =>
        c === "find:query" && (i as { offset: number }).offset > 0
          ? Promise.resolve({ ok: false, reason: "test" })
          : real(c as never, i as never),
    };
    await click(screen.getByRole("button", { name: t.showMore }));
    expect(screen.getByRole("button", { name: t.moreFailed })).toBeTruthy();
  });
});
