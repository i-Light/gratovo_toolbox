// @vitest-environment happy-dom
import { formatCount } from "@gratovo/core/find";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGlobalKeys, useKeyListener } from "../app/global-keys";
import { resetFindForTests } from "../lib/find";
import { aiChannel, stubFindBridge } from "../lib/find-test-bridge";
import { setPref } from "../lib/prefs";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { Triage, useReview } from "./triage";

const t = strings.findTriage;
const reasons = strings.findActions.reasons;

/** The page's one key listener, as the app mounts it. */
function Keys() {
  useGlobalKeys();
  useKeyListener();
  return null;
}

/** Triage with the query the screen gives it. */
function ReviewNew() {
  return <Triage review={useReview()} />;
}

async function show(): Promise<void> {
  render(
    <>
      <Keys />
      <ReviewNew />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const press = async (key: string, target?: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(target ?? document.body, { key });
    await Promise.resolve();
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
  });
};

const gold = aiChannel("UC-gold", "Agent Lab", { medianViews: 60_000, subscribers: 100_000 });
const plain = aiChannel("UC-plain", "Model Weekly", {
  medianViews: 8_000,
  subscribers: 400_000,
  keyword: "llm news",
});
const third = aiChannel("UC-third", "Prompt Garage", {
  medianViews: 5_000,
  subscribers: 300_000,
  sponsors: [],
  emails: [],
});
const heading = (): string => screen.getByRole("heading", { level: 2 }).textContent;
const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "find", tab: "triage" });
  setPref("letters", "");
});
afterEach(() => {
  cleanup();
});

describe("Review new", () => {
  it("says so when nothing is new, and offers the Search tab", async () => {
    stubFindBridge();
    await show();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.goSearch }));
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "find", tab: "search" });
  });

  it("shows the first card: gold mines first, with numbers, videos, sponsors and fit", async () => {
    stubFindBridge({ items: [plain, gold] });
    await show();
    expect(heading()).toBe("Agent Lab");
    const header = document.querySelector(".tr-view .row")?.textContent ?? "";
    expect(header).toContain(`2 ${t.newWord} · 1 ${t.gold(false)} · ${t.order}`);
    expect(screen.getByText(t.position(1, 2))).toBeTruthy();
    const card = within(screen.getByRole("article"));
    expect(card.getByText("@agentlab", { exact: false }).textContent).toContain(
      t.subscribers(formatCount(100_000)),
    );
    expect(card.getByText("Build an AI agent in 20 minutes")).toBeTruthy();
    expect(card.getByText(t.viewsHidden, { exact: false })).toBeTruthy();
    expect(card.getByText(formatCount(60_000))).toBeTruthy();
    expect(card.getByText(t.goldTag)).toBeTruthy();
    expect(card.getByText("Notion AI")).toBeTruthy();
    expect(card.getByText(t.emailsFound(2))).toBeTruthy();
    expect(card.getByText(t.foundBy("ai agents"))).toBeTruthy();
    const chip = card.getByRole("button", { name: /^Fit [0-9]+$/ });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    await click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const parts = within(screen.getByRole("list", { name: t.fitDetail })).getAllByRole("listitem");
    expect(parts).toHaveLength(5);
    expect(parts[0]?.textContent).toContain("Median views 20/30");
    expect(parts[4]?.textContent).toContain("Sponsored before 15/15");
    // The list is drawn in the floating layer, outside the card that would clip it.
    expect(card.queryByRole("list", { name: t.fitDetail })).toBeNull();
    expect(screen.getByRole("list", { name: t.fitDetail }).closest("article")).toBeNull();
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: t.fitDetail })).toBeNull();
    await click(chip);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("list", { name: t.fitDetail })).toBeNull();
    expect(card.queryByText(/Emailed before/)).toBeNull();
  });

  it("shows the emailed-before guard, with who and when when known", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-g", "Tool Tester", {
          emailedBefore: { at: Date.now() - 3 * 86_400_000, who: "Sara" },
        }),
      ],
    });
    await show();
    expect(screen.getByText("Emailed before · Sara, 3 days ago")).toBeTruthy();
    expect(document.querySelector(".callout.warn")).not.toBeNull();
  });

  it("shows no-email and many-sponsor states", async () => {
    stubFindBridge({
      items: [
        aiChannel("UC-s", "Sponsor Magnet", {
          emails: [],
          sponsors: ["A1", "B2", "C3", "D4", "E5"],
        }),
      ],
    });
    await show();
    expect(screen.getByText(t.emailsNone)).toBeTruthy();
    expect(screen.getByText(t.sponsorsMore(2))).toBeTruthy();
    expect(screen.queryByText("D4")).toBeNull();
  });

  it("S shortlists, and the next card shows at once", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await press("s");
    expect(creatorOf("UC-gold")?.stage).toBe("shortlisted");
    expect(heading()).toBe("Model Weekly");
    expect(screen.getByText(t.tally(1, 0))).toBeTruthy();
    expect(screen.getByText(t.position(1, 1))).toBeTruthy();
  });

  it("R then 2 rejects with 'Too few views' and the archive days", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await press("r");
    const group = screen.getByRole("group", { name: t.rejectWhy });
    expect(within(group).getAllByRole("button")).toHaveLength(5);
    expect(
      within(group).getByRole("button", { name: new RegExp(reasons.views) }).textContent,
    ).toContain("2");
    await press("2");
    expect(creatorOf("UC-gold")?.stage).toBe("rejected");
    expect(creatorOf("UC-gold")?.rejectReason).toBe("views");
    expect(heading()).toBe("Model Weekly");
    expect(screen.queryByRole("group", { name: t.rejectWhy })).toBeNull();
    expect(screen.getByText(t.tally(0, 1))).toBeTruthy();
    // No find:state is loaded here, so the rules' default of 7 days is used.
    const toast = appStore().getState().ui.toasts.at(-1);
    expect(toast?.sub).toBe(strings.findActions.rejectSub(reasons.views));
  });

  it("1 to 5 reject at once, and Esc closes the reason row", async () => {
    stubFindBridge({ items: [gold, plain, third] });
    await show();
    await press("1");
    expect(creatorOf("UC-gold")?.rejectReason).toBe("ai");
    await press("r");
    expect(screen.getByRole("group", { name: t.rejectWhy })).toBeTruthy();
    await press("Escape");
    expect(screen.queryByRole("group", { name: t.rejectWhy })).toBeNull();
    await press("4");
    expect(creatorOf("UC-plain")?.rejectReason).toBe("audience");
    await press("5");
    expect(creatorOf("UC-third")?.rejectReason).toBe("bot");
  });

  it("works the same from the buttons", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await click(screen.getByRole("button", { name: new RegExp(`^${t.reject}`) }));
    await click(screen.getByRole("button", { name: new RegExp(reasons.posting) }));
    expect(creatorOf("UC-gold")?.stage).toBe("rejected");
    await click(screen.getByRole("button", { name: new RegExp(`^${t.shortlist}`) }));
    expect(creatorOf("UC-plain")?.stage).toBe("shortlisted");
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyTally(1, 1))).toBeTruthy();
  });

  it("ignores letters while typing and with the letters switch off, but not the arrows", async () => {
    stubFindBridge({ items: [gold, plain, third] });
    await show();
    await click(screen.getByRole("button", { name: t.more }));
    await click(screen.getByRole("button", { name: t.never }));
    const field = screen.getByRole("textbox", { name: t.neverReason });
    await press("s", field);
    expect(creatorOf("UC-gold")).toBeUndefined();
    await click(screen.getByRole("button", { name: t.neverCancel }));
    setPref("letters", "off");
    await press("s");
    await press("1");
    await press("k");
    expect(creatorOf("UC-gold")).toBeUndefined();
    expect(heading()).toBe("Agent Lab");
    await press("ArrowRight");
    expect(heading()).toBe("Model Weekly");
    await press("ArrowLeft");
    expect(heading()).toBe("Agent Lab");
  });

  it("steps with the arrows and J (next) and K (previous), stopping at both ends", async () => {
    stubFindBridge({ items: [gold, plain, third] });
    await show();
    await press("k");
    expect(heading()).toBe("Agent Lab");
    await press("ArrowRight");
    expect(heading()).toBe("Model Weekly");
    await press("j");
    expect(heading()).toBe("Prompt Garage");
    await press("j");
    expect(heading()).toBe("Prompt Garage");
    await press("k");
    expect(heading()).toBe("Model Weekly");
    await click(screen.getByRole("button", { name: new RegExp(t.next) }));
    expect(heading()).toBe("Prompt Garage");
    await click(screen.getByRole("button", { name: new RegExp(t.prev) }));
    expect(heading()).toBe("Model Weekly");
  });

  it("asks for the next page past the last loaded channel and keeps the count true", async () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      aiChannel(`UC-${String(i).padStart(2, "0")}`, `Chan ${String(i).padStart(2, "0")}`, {
        medianViews: 5_000 - i,
        subscribers: 300_000,
      }),
    );
    const calls = stubFindBridge({ items: many });
    await show();
    for (let i = 0; i < 40; i++) {
      await press("j");
    }
    expect(screen.getByText(t.position(41, 45))).toBeTruthy();
    const offsets = calls
      .filter(([c]) => c === "find:query")
      .map(([, q]) => (q as { offset: number }).offset);
    expect(offsets).toContain(40);
    expect(
      calls
        .filter(([c]) => c === "find:query")
        .every(([, q]) => (q as { facets?: boolean }).facets === false),
    ).toBe(true);
  });

  it("takes an undone shortlist off the tally", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await press("s");
    expect(screen.getByText(t.tally(1, 0))).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document, { key: "z", ctrlKey: true });
      await Promise.resolve();
    });
    expect(screen.queryByText(t.tally(1, 0))).toBeNull();
    expect(heading()).toBe("Agent Lab");
  });

  it("O opens the record", async () => {
    stubFindBridge({ items: [gold] });
    await show();
    await press("o");
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "record",
      record: { kind: "creator", id: "UC-gold" },
    });
  });

  it("Enter opens the record like O", async () => {
    stubFindBridge({ items: [gold] });
    await show();
    await press("Enter");
    expect(selectRoute(appStore().getState())).toMatchObject({
      screen: "record",
      record: { kind: "creator", id: "UC-gold" },
    });
  });

  it("Enter on a focused button activates it and leaves the record closed", async () => {
    stubFindBridge({ items: [gold] });
    await show();
    const btn = screen.getByRole("button", { name: new RegExp(`^${t.shortlist}`) });
    btn.focus();
    const down = fireEvent.keyDown(btn, { key: "Enter" });
    expect(down).toBe(true);
    expect(selectRoute(appStore().getState()).screen).not.toBe("record");
  });

  it("N opens the Never contact form and Esc closes it", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await press("n");
    expect(screen.getByRole("textbox", { name: t.neverReason })).toBeTruthy();
    await press("Escape");
    expect(screen.queryByRole("textbox", { name: t.neverReason })).toBeNull();
  });

  it("never contact asks for an optional reason and moves the channel out", async () => {
    stubFindBridge({ items: [gold, plain] });
    await show();
    await click(screen.getByRole("button", { name: t.more }));
    await click(screen.getByRole("button", { name: t.never }));
    fireEvent.change(screen.getByRole("textbox", { name: t.neverReason }), {
      target: { value: "asked us to stop" },
    });
    await click(screen.getByRole("button", { name: t.neverConfirm }));
    expect(creatorOf("UC-gold")?.stage).toBe("never");
    expect(
      appStore()
        .getState()
        .data.log.find((l) => l.action === "creator.never")?.detail,
    ).toBe("asked us to stop");
    expect(heading()).toBe("Model Weekly");
  });

  it("shows every key on its button", async () => {
    stubFindBridge({ items: [gold] });
    await show();
    const kbds = [...document.querySelectorAll(".actionbar .kbd")].map((k) => k.textContent);
    expect(kbds).toEqual(["S", "R", "←", "→", "O"]);
  });

  it("asks only for new channels, whatever run they came from", async () => {
    const calls = stubFindBridge({ items: [aiChannel("UC-r1", "Run One", { run: 1 })] });
    await show();
    const query = calls.find(([c]) => c === "find:query")?.[1] as {
      filter: { stages: string[]; runs: number[] };
    };
    expect(query.filter.stages).toEqual(["new"]);
    expect(query.filter.runs).toEqual([]);
  });

  it("takes no keys when no channel shows", async () => {
    stubFindBridge();
    await show();
    await press("s");
    expect(
      appStore()
        .getState()
        .data.log.some((l) => l.action === "creator.shortlist"),
    ).toBe(false);
  });
});

describe("The card's extra facts", () => {
  const card = () => within(screen.getByRole("article"));
  const only = async (over: Parameters<typeof aiChannel>[2]) => {
    stubFindBridge({ items: [aiChannel("UC-x", "Extra Facts", over)] });
    await show();
  };

  it("shows stars, format and trimmed average, and labels the median", async () => {
    await only({
      stars: 4,
      format: "long_form",
      trimmedAverage: 33_000,
      viewStability: "stable",
    });
    expect(screen.getByRole("img", { name: strings.creatorRecord.header.stars(4) })).toBeTruthy();
    expect(card().getByText(strings.creatorRecord.header.formats.long_form)).toBeTruthy();
    expect(card().getByText(t.trimmedAverage)).toBeTruthy();
    expect(card().getByText(formatCount(33_000))).toBeTruthy();
    expect(card().getByText(t.medianSteady)).toBeTruthy();
  });

  it("shows nothing for facts it does not have", async () => {
    await only({ stars: null, format: null, botRisk: null, trimmedAverage: null });
    expect(document.querySelector("[data-ui='find.triage.facts']")?.textContent).toBe("");
    expect(card().queryByText(t.trimmedAverage)).toBeNull();
    expect(card().getByText(t.medianViews)).toBeTruthy();
    expect(document.querySelector("[data-ui='find.triage.warn']")).toBeNull();
  });

  it("tags bot risk in the record's words, with the note beside a risky one", async () => {
    await only({ botRisk: { level: "watch", note: "Same comment on every video" } });
    expect(card().getByText(strings.creatorRecord.header.botRisk.watch)).toBeTruthy();
    expect(card().getByText("Same comment on every video")).toBeTruthy();
    expect(document.querySelector("[data-ui='find.triage.warn']")).toBeNull();
    cleanup();
    await only({ botRisk: { level: "clean", note: null } });
    expect(card().getByText(strings.creatorRecord.header.botRisk.clean)).toBeTruthy();
  });

  it("warns on a high bot risk or more than 20 uploads in 30 days", async () => {
    await only({ uploads30: 30, medianViews: 9_000 });
    const warn = document.querySelector("[data-ui='find.triage.warn']");
    expect(warn?.textContent).toContain(t.mostlyShorts(30, formatCount(9_000)));
    cleanup();
    await only({ botRisk: { level: "high", note: "Views jump overnight" } });
    const high = document.querySelector("[data-ui='find.triage.warn']");
    expect(high?.textContent).toContain("Views jump overnight");
    cleanup();
    await only({ hasNumbers: false, botRisk: { level: "high", note: null } });
    const bare = document.querySelector("[data-ui='find.triage.warn']");
    expect(bare?.textContent).toBe(t.botHigh);
  });

  it("opens a known brand beside from a sponsor chip, and leaves other sponsors plain", async () => {
    const brand = appStore().getState().data.brands[0];
    if (brand === undefined) {
      throw new Error("the example data has no brand");
    }
    await only({ sponsors: [brand.name.toUpperCase(), "Unknown Co"] });
    expect(card().getByText("Unknown Co").closest("button")).toBeNull();
    await click(card().getByRole("button", { name: brand.name.toUpperCase() }));
    expect(appStore().getState().ui.peek?.record).toEqual({ kind: "brand", id: brand.id });
  });

  it("lists the fit's parts in the fold-out", async () => {
    await only({});
    const fold = document.querySelector("[data-ui='find.triage.fit-parts']");
    expect(fold?.querySelectorAll("li").length).toBe(5);
    expect(fold?.textContent).toContain(t.fitFold);
  });
});
