// @vitest-environment happy-dom
import type { CatalogItem } from "@gratovo/core/find";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiChannel, stubFindBridge } from "../lib/find-test-bridge";
import {
  patchGalleryFilter,
  setGallerySize,
  setGalleryShow,
  setGalleryView,
} from "../lib/find-gallery-state";
import { keyStack } from "../lib/keys";
import { getPrefs, initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { Gallery } from "./gallery";

const t = strings.findGallery;

/* Fit decides the order: more median views first, so the names read in this order. */
const agentLab = aiChannel("UC-agent", "Agent Lab", { medianViews: 60_000 });
const modelWeekly = aiChannel("UC-model", "Model Weekly", {
  medianViews: 50_000,
  subscribers: 400_000,
  sponsors: [],
  uploads30: 25,
  country: "GB",
  engagement: 4.2,
});
const promptGarage = aiChannel("UC-prompt", "Prompt Garage", {
  medianViews: 40_000,
  stage: "shortlisted",
});
const tokenTalk = aiChannel("UC-token", "Token Talk", {
  medianViews: 30_000,
  sponsors: ["A", "B", "C", "D"],
});
const ragDaily = aiChannel("UC-rag", "RAG Daily", { medianViews: 20_000 });
const oldSpam = aiChannel("UC-spam", "Old Spam Bots", { stage: "rejected", rejectReason: "ai" });
const items = [agentLab, modelWeekly, promptGarage, tokenTalk, ragDaily, oldSpam];

const idOf = (name: string): string => items.find((i) => i.name === name)?.id ?? "?";
const creator = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);
const peeked = () => appStore().getState().ui.peek;

async function show(list: readonly CatalogItem[] = items): Promise<void> {
  stubFindBridge({ items: list });
  render(<Gallery />);
  await settle();
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const click = async (el: HTMLElement, init: MouseEventInit = {}): Promise<void> => {
  await act(async () => {
    fireEvent.click(el, init);
    await Promise.resolve();
  });
};

const card = (name: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`.gcard[data-name="${name}"]`);
  if (found === null) throw new Error(`no card ${name}`);
  return found;
};
const names = (): string[] =>
  [...document.querySelectorAll(".gcard")].map((c) => c.getAttribute("data-name") ?? "");
const selectBtn = (name: string): HTMLElement =>
  within(card(name)).getByRole("button", { name: new RegExp(`^(Select|Unselect) ${name}$`) });
const picked = (): string[] =>
  names().filter((n) => card(n).getAttribute("data-selected") === "true");

function press(
  key: string,
  init: Partial<KeyboardEvent> = {},
  target: EventTarget | null = null,
): void {
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target,
    preventDefault: () => undefined,
    ...init,
  };
  act(() => {
    keyStack.dispatch(event as unknown as KeyboardEvent, { typing: false, lettersOff: false });
  });
}

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "find", tab: "gallery" });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  initPrefs();
});

describe("cards", () => {
  it("opens the peek with the loaded order", async () => {
    await show();
    await click(screen.getByRole("button", { name: t.card.open("Model Weekly") }));
    expect(peeked()?.record).toEqual({ kind: "creator", id: idOf("Model Weekly") });
    expect(peeked()?.list).toEqual(names().map(idOf));
  });

  it("selects with its own button and does not open the peek", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    expect(peeked()).toBeNull();
    expect(selectBtn("Agent Lab").getAttribute("aria-pressed")).toBe("true");
    expect(selectBtn("Agent Lab").getAttribute("aria-label")).toBe(t.card.unselect("Agent Lab"));
    await click(selectBtn("Agent Lab"));
    expect(picked()).toEqual([]);
  });

  it("selects a range with Shift and toggles with Ctrl or Cmd", async () => {
    await show();
    const order = names();
    await click(selectBtn(order[0] ?? ""));
    await click(selectBtn(order[3] ?? ""), { shiftKey: true });
    expect(picked()).toEqual(order.slice(0, 4));
    await click(screen.getByRole("button", { name: t.card.open(order[1] ?? "") }), {
      ctrlKey: true,
    });
    expect(picked()).toEqual([order[0], order[2], order[3]]);
    await click(screen.getByRole("button", { name: t.card.open(order[1] ?? "") }), {
      metaKey: true,
    });
    expect(picked()).toHaveLength(4);
    expect(peeked()).toBeNull();
  });

  it("flips through the last 3 videos as the pointer crosses the picture", async () => {
    await show();
    const c = card("Agent Lab");
    const wrap = c.querySelector<HTMLElement>(".thumbwrap");
    if (wrap === null) throw new Error("no picture");
    wrap.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100);
    expect(c.querySelector(".gtitle")?.textContent).toContain(`${t.card.latest}Build an AI agent`);
    fireEvent.mouseMove(c, { clientX: 150, clientY: 50 });
    expect(c.querySelector(".gtitle")?.textContent).toContain(
      `${t.card.videoN(2)}Claude Code vs Cursor`,
    );
    expect(c.querySelectorAll(".scrub i.on")).toHaveLength(1);
    fireEvent.mouseMove(c, { clientX: 290, clientY: 50 });
    expect(c.querySelector(".gtitle")?.textContent).toContain(t.card.videoN(3));
    fireEvent.mouseLeave(c);
    expect(c.querySelector(".gtitle")?.textContent).toContain(t.card.latest);
  });

  it("shows gold, two sponsors and a count, and the email state", async () => {
    await show([
      {
        ...tokenTalk,
        medianViews: 80_000,
        subscribers: 100_000,
        emailConfirmed: true,
        email: "a@b.ai",
      },
    ]);
    const sig = card("Token Talk").querySelector(".gsig");
    expect(sig?.textContent).toContain(t.card.gold);
    expect(sig?.textContent).toContain("A");
    expect(sig?.textContent).toContain(t.card.sponsorsMore(2));
    expect(sig?.textContent).not.toContain("C");
    expect(sig?.textContent).toContain(t.card.confirmed);
  });

  it("obeys the show toggles and the card size", async () => {
    await show();
    expect(card("Agent Lab").querySelector(".thumbwrap")).not.toBeNull();
    expect(card("Agent Lab").querySelector(".gtitle")).not.toBeNull();
    act(() => {
      setGalleryShow("pics", false);
      setGalleryShow("latest", false);
      setGalleryShow("signals", false);
      setGallerySize("l");
    });
    expect(card("Agent Lab").querySelector(".thumbwrap")).toBeNull();
    expect(card("Agent Lab").querySelector(".gtitle")).toBeNull();
    expect(card("Agent Lab").querySelector(".gsig")).toBeNull();
    // Without the picture the stage tag moves next to the name.
    expect(card("Agent Lab").textContent).toContain(strings.record.stages.new);
    expect(document.querySelector<HTMLElement>(".gal")?.style.getPropertyValue("--card-w")).toBe(
      "330px",
    );
    act(() => {
      setGallerySize("s");
    });
    expect(document.querySelector<HTMLElement>(".gal")?.style.getPropertyValue("--card-w")).toBe(
      "210px",
    );
    expect(getPrefs().findSize).toBe("s");
  });

  it("says Not read yet on a card whose uploads were never read, never 0", async () => {
    const unread = aiChannel("UC-unread", "Deferred Digest", {
      medianViews: 0,
      uploads30: 0,
      uploadsRead: false,
    });
    const carried = aiChannel("UC-carried", "Restored Rewind", {
      medianViews: 12_000,
      uploadsRead: false,
    });
    await show([agentLab, unread, carried]);
    const gone = within(card("Deferred Digest"));
    expect(gone.getByText(strings.unread.label)).toBeTruthy();
    expect(card("Deferred Digest").textContent).not.toContain(t.card.in30);
    expect(card("Restored Rewind").textContent).toContain(strings.unread.lastKnown("12K median"));
    expect(card("Agent Lab").textContent).not.toContain(strings.unread.label);
  });

  it("says Not read yet in the table's median and latest columns", async () => {
    const unread = aiChannel("UC-unread", "Deferred Digest", {
      medianViews: 0,
      uploadsRead: false,
    });
    await show([agentLab, unread]);
    act(() => {
      setGalleryView("table");
    });
    const row = screen.getByText("Deferred Digest").closest("tr");
    expect(row?.textContent.match(/Not read yet/g)).toHaveLength(2);
  });

  it("says No numbers yet, never 0, for a creator nothing was ever measured for", async () => {
    const bare = aiChannel("UC-bare", "Roster Only", {
      medianViews: 0,
      uploads30: 0,
      hasNumbers: false,
      uploadsRead: false,
    });
    await show([agentLab, bare]);
    expect(card("Roster Only").textContent).toContain(strings.unread.noNumbers);
    expect(card("Roster Only").textContent).not.toContain(t.card.median);
    act(() => {
      setGalleryView("table");
    });
    const row = screen.getByText("Roster Only").closest("tr");
    expect(row?.textContent).not.toContain(strings.unread.label);
  });

  it("dims rejected channels", async () => {
    stubFindBridge({ items });
    patchGalleryFilter({ stages: ["rejected", "new"] });
    render(<Gallery />);
    await settle();
    expect(card("Old Spam Bots").classList.contains("dim")).toBe(true);
    expect(card("Agent Lab").classList.contains("dim")).toBe(false);
  });
});

describe("selection keys", () => {
  it("Ctrl A selects every loaded channel and Esc clears", async () => {
    await show();
    press("a", { ctrlKey: true });
    expect(picked()).toHaveLength(names().length);
    expect(document.querySelector(".gal")?.className).toContain("selecting");
    press("escape");
    expect(picked()).toEqual([]);
  });

  it("never reaches through an open peek", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    await click(
      within(card("Model Weekly")).getByRole("button", { name: t.card.open("Model Weekly") }),
    );
    expect(peeked()).not.toBeNull();
    press("a", { ctrlKey: true });
    expect(picked()).toEqual(["Agent Lab"]);
    press("escape");
    expect(picked()).toEqual(["Agent Lab"]);
  });

  it("ignores both while typing", async () => {
    await show();
    const field = screen.getByLabelText(t.toolbar.search);
    press("a", { ctrlKey: true }, field);
    expect(picked()).toEqual([]);
    await click(selectBtn("Agent Lab"));
    press("escape", {}, field);
    expect(picked()).toEqual(["Agent Lab"]);
  });

  it("the count line selects the shown and clears", async () => {
    await show();
    await click(screen.getByRole("button", { name: t.selectShown(names().length) }));
    expect(picked()).toHaveLength(names().length);
    await click(screen.getByRole("button", { name: t.clearSelection }));
    expect(picked()).toEqual([]);
  });

  it("drops channels that are no longer loaded", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    await click(selectBtn("Model Weekly"));
    expect(screen.getByText(t.bulk.selected(2))).toBeTruthy();
    act(() => {
      patchGalleryFilter({ countries: ["GB"] });
    });
    await settle();
    expect(names()).toEqual(["Model Weekly"]);
    expect(screen.getByText(t.bulk.selected(1))).toBeTruthy();
  });
});

describe("the table", () => {
  it("shows the columns, sorts by header, and opens a row", async () => {
    await show();
    act(() => {
      setGalleryView("table");
    });
    const table = screen.getByRole("table", { name: t.table.label });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(10);
    expect(table.textContent).not.toContain("Has it");
    await click(within(table).getByRole("button", { name: t.table.sortBy(t.table.subs) }));
    expect(getPrefs().findSort).toBe("subs");
    await settle();
    await click(
      within(screen.getByRole("table")).getByRole("button", {
        name: strings.findGallery.card.open("Agent Lab"),
      }),
    );
    expect(peeked()?.record.id).toBe(idOf("Agent Lab"));
    expect(peeked()?.list).toHaveLength(5);
  });

  it("selects a range with Shift-click on rows and with the checkboxes", async () => {
    await show();
    act(() => {
      setGalleryView("table");
    });
    const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
    await click(within(rows()[0] as HTMLElement).getByRole("checkbox"));
    await click(rows()[2] as HTMLElement, { shiftKey: true });
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(3);
    expect(peeked()).toBeNull();
    // A plain row click opens the peek.
    await click(rows()[4] as HTMLElement);
    expect(peeked()).not.toBeNull();
  });
});

describe("the bulk bar", () => {
  it("shortlists only the new and rejected ones, says how many, and clears", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    await click(selectBtn("Prompt Garage"));
    const bar = screen.getByRole("toolbar", { name: t.bulk.label });
    await click(within(bar).getByRole("button", { name: t.bulk.shortlistN(1) }));
    expect(creator(idOf("Agent Lab"))?.stage).toBe("shortlisted");
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(picked()).toEqual([]);
  });

  it("disables Shortlist when nothing selected can be shortlisted", async () => {
    await show();
    await click(selectBtn("Prompt Garage"));
    const bar = screen.getByRole("toolbar", { name: t.bulk.label });
    const btn = within(bar).getByRole("button", { name: t.bulk.shortlist });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("data-tip")).toBe(t.bulk.shortlistNone);
  });

  it("rejects with the chosen reason", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    await click(selectBtn("Model Weekly"));
    const bar = screen.getByRole("toolbar", { name: t.bulk.label });
    fireEvent.change(within(bar).getByLabelText(t.bulk.rejectReason), {
      target: { value: "views" },
    });
    await click(within(bar).getByRole("button", { name: t.bulk.reject }));
    expect(creator(idOf("Agent Lab"))?.rejectReason).toBe("views");
    expect(creator(idOf("Model Weekly"))?.stage).toBe("rejected");
    expect(picked()).toEqual([]);
  });

  it("Compare needs 2 to 4", async () => {
    await show();
    await click(selectBtn("Agent Lab"));
    const compare = () => screen.getByRole<HTMLButtonElement>("button", { name: t.bulk.compare });
    expect(compare().disabled).toBe(true);
    expect(compare().getAttribute("data-tip")).toBe(t.bulk.compareFew);
    await click(selectBtn("Model Weekly"));
    expect(compare().disabled).toBe(false);
    for (const n of ["Prompt Garage", "Token Talk", "RAG Daily"]) await click(selectBtn(n));
    expect(compare().disabled).toBe(true);
    expect(compare().getAttribute("data-tip")).toBe(t.bulk.compareMany);
  });
});

describe("compare", () => {
  async function open(...picks: string[]): Promise<HTMLElement> {
    await show();
    for (const n of picks) await click(selectBtn(n));
    await click(screen.getByRole("button", { name: t.bulk.compare }));
    return screen.getByRole("region", { name: t.compare.title(picks.length) });
  }
  const row = (region: HTMLElement, label: string): HTMLElement => {
    const lbl = within(region).getByText(label, { selector: ".lbl" });
    return lbl.parentElement as HTMLElement;
  };

  it("marks the best value in each row", async () => {
    const region = await open("Agent Lab", "Model Weekly");
    // Agent Lab has the higher median, Model Weekly the higher subscriber count.
    expect(row(region, t.compare.median).querySelector(".best")?.textContent).toBe("60K");
    expect(row(region, t.compare.subscribers).querySelector(".best")?.textContent).toBe("400K");
    expect(row(region, t.compare.country).querySelector(".best")).toBeNull();
  });

  it("does not count Shorts as best and says Not known for engagement", async () => {
    const region = await open("Agent Lab", "Model Weekly");
    const uploads = row(region, t.compare.uploads);
    expect(uploads.textContent).toContain(`25${t.compare.shorts}`);
    expect(uploads.querySelector(".best")?.textContent).toBe("6");
    const engagement = row(region, t.compare.engagement);
    expect(engagement.textContent).toContain(t.compare.engagementUnknown);
    expect(engagement.querySelector(".best")?.textContent).toBe("4.2%");
    expect(row(region, t.compare.sponsors).textContent).toContain("Notion AI, Descript");
  });

  it("offers Shortlist for new channels, Open for all, and closes", async () => {
    const region = await open("Agent Lab", "Prompt Garage");
    expect(within(region).getAllByRole("button", { name: /^Shortlist / })).toHaveLength(1);
    await click(within(region).getByRole("button", { name: `${t.compare.shortlist} Agent Lab` }));
    expect(creator(idOf("Agent Lab"))?.stage).toBe("shortlisted");
    await click(within(region).getByRole("button", { name: `${t.compare.open} Prompt Garage` }));
    expect(peeked()?.record.id).toBe(idOf("Prompt Garage"));
    await click(within(region).getByRole("button", { name: t.compare.close }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("closes when the selection leaves 2 to 4", async () => {
    await open("Agent Lab", "Model Weekly");
    await click(selectBtn("Agent Lab"));
    expect(screen.queryByRole("region")).toBeNull();
    await click(selectBtn("Agent Lab"));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("closes on Esc together with the selection", async () => {
    await open("Agent Lab", "Model Weekly");
    press("escape");
    expect(screen.queryByRole("region")).toBeNull();
    expect(picked()).toEqual([]);
  });
});

describe("the worst case", () => {
  const long = "Extremely Long Channel Name About Artificial Intelligence ".repeat(3).slice(0, 120);
  const awful = aiChannel("UC-awful", long, {
    subscribers: null,
    medianViews: 0,
    uploads30: 0,
    sponsors: Array.from({ length: 25 }, (_, i) => `Sponsor AI ${String(i + 1)}`),
    videos: [],
    country: null,
    latestUploadAt: null,
    foundAt: null,
    emailedBefore: { at: null, who: null },
  });
  const plain = aiChannel("UC-plain", "Plain Tools");

  it("draws a card and a table row with no broken text", async () => {
    await show([awful, plain]);
    const c = card(long);
    expect(c.textContent).not.toMatch(/NaN|undefined|null/);
    expect(c.querySelectorAll(".gsig .tag").length).toBeLessThanOrEqual(5);
    expect(c.textContent).toContain(t.card.sponsorsMore(23));
    expect(c.querySelector(".scrub")).toBeNull();
    expect(c.querySelector(".gtitle")).toBeNull();
    act(() => {
      setGalleryView("table");
    });
    expect(screen.getByRole("table").textContent).not.toMatch(/NaN|undefined|null/);
  });

  it("compares it without breaking", async () => {
    await show([awful, plain]);
    await click(selectBtn(long));
    await click(selectBtn("Plain Tools"));
    await click(screen.getByRole("button", { name: t.bulk.compare }));
    const region = screen.getByRole("region", { name: t.compare.title(2) });
    expect(region.textContent).toContain(t.compare.hidden);
    expect(region.textContent).not.toMatch(/NaN|undefined/);
    expect(region.querySelector(".cmp-scroll")).not.toBeNull();
  });
});
