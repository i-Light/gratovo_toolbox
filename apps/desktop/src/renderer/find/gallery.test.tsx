// @vitest-environment happy-dom
import { emptyFindFilter, type SavedView } from "@gratovo/core/find";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiChannel, stubFindBridge, type TestRun } from "../lib/find-test-bridge";
import { patchGalleryFilter } from "../lib/find-gallery-state";
import { getPrefs, initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { Gallery } from "./gallery";
import { searchDebounceMs } from "./gallery-toolbar";

const t = strings.findGallery;

const agentLab = aiChannel("UC-agent", "Agent Lab", { country: "US", run: 2 });
const modelWeekly = aiChannel("UC-model", "Model Weekly", {
  country: "GB",
  run: 1,
  sponsors: [],
  uploads30: 2,
  medianViews: 9_000,
  subscribers: 400_000,
});
const promptGarage = aiChannel("UC-prompt", "Prompt Garage", {
  country: "US",
  run: 2,
  stage: "shortlisted",
  uploads30: 8,
});
const items = [agentLab, modelWeekly, promptGarage];

const now = Date.now();
const runs: TestRun[] = [
  {
    id: 2,
    startedAt: now - 3_600_000,
    finishedAt: now,
    status: "done",
    keywords: 5,
    found: 40,
    kept: 20,
    gold: 3,
  },
  {
    id: 1,
    startedAt: now - 9 * 86_400_000,
    finishedAt: now - 9 * 86_400_000,
    status: "done",
    keywords: 4,
    found: 10,
    kept: 8,
    gold: 1,
  },
];

/** Saved views the fake main keeps, and how it answers a save. */
let stored: SavedView[];
let setAnswer: "ok" | "too_many";

/** Lets the stub keep saved views, as main does. */
function withViews(): void {
  const bridge = (window as unknown as { gratovo: Bridge }).gratovo;
  const inner = bridge.invoke as unknown as (c: string, i: unknown) => Promise<unknown>;
  (window as unknown as { gratovo: Bridge }).gratovo = {
    ...bridge,
    invoke: ((channel: string, input: unknown) => {
      if (channel === "find:views") {
        return Promise.resolve({ ok: true, value: { views: stored } });
      }
      if (channel === "find:views-set") {
        if (setAnswer === "too_many") {
          return Promise.resolve({ ok: true, value: { ok: false, problem: "too_many" } });
        }
        stored = (input as { views: SavedView[] }).views;
        return Promise.resolve({ ok: true, value: { ok: true } });
      }
      return inner(channel, input);
    }) as unknown as Bridge["invoke"],
  };
}

async function show(
  fixture: Parameters<typeof stubFindBridge>[0] = { items, runs },
): Promise<[string, unknown][]> {
  const calls = stubFindBridge(fixture);
  withViews();
  render(<Gallery />);
  await settle();
  return calls;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const list = (): string[] =>
  within(screen.getByRole("list", { name: t.resultsLabel }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-name") ?? "");
const toasts = () => appStore().getState().ui.toasts;
const facets = () => within(screen.getByRole("complementary", { name: t.filtersLabel }));

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "find", tab: "gallery" });
  stored = [];
  setAnswer = "ok";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  initPrefs();
});

describe("the results", () => {
  it("counts the channels and lists their names", async () => {
    await show();
    expect(document.querySelector(".num")?.parentElement?.textContent).toBe(`3 ${t.channels(3)}`);
    expect(document.querySelector(".num")?.textContent).toBe("3");
    expect(list().sort()).toEqual(["Agent Lab", "Model Weekly", "Prompt Garage"]);
  });

  it("says so when nothing matches, and Clear filters brings everything back", async () => {
    await show();
    // No fixture channel is in France.
    act(() => {
      patchGalleryFilter({ countries: ["FR"] });
    });
    await settle();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint)).toBeTruthy();
    await click(screen.getByRole("button", { name: t.clearFilters }));
    expect(list()).toHaveLength(3);
    expect(getPrefs().findFilter).toEqual(emptyFindFilter);
  });

  it("shows the Show more button when there is another page, and it asks for it", async () => {
    const many = Array.from({ length: 125 }, (_, i) =>
      aiChannel(`UC-${String(i)}`, `Channel ${String(i)}`),
    );
    const calls = await show({ items: many, runs });
    expect(list()).toHaveLength(120);
    await click(screen.getByRole("button", { name: t.showMore }));
    await waitFor(() => {
      expect(list()).toHaveLength(125);
    });
    expect(screen.queryByRole("button", { name: t.showMore })).toBeNull();
    expect(calls.filter(([c]) => c === "find:query")).toHaveLength(2);
  });
});

describe("the facets", () => {
  it("lists the stages in order with their labels and counts", async () => {
    await show();
    const stage = facets().getByRole("group", { name: t.facets.stage });
    const labels = within(stage)
      .getAllByRole("button")
      .map((b) => b.querySelector(".ell")?.textContent);
    expect(labels).toEqual([
      "New find",
      "Needs contact",
      "Contact confirmed",
      "In sequence",
      "Replied",
      "Media kit in",
      "Audience checked",
      "Signed",
      "Parked",
      "Rejected",
      "Never contact",
    ]);
  });

  it("toggles the stage filter and disables an option with no channels", async () => {
    await show();
    const newFind = facets().getByRole("button", { name: /New find/ });
    expect(newFind.getAttribute("aria-pressed")).toBe("false");
    expect(
      facets()
        .getByRole("button", { name: /Signed/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    await click(newFind);
    expect(getPrefs().findFilter.stages).toEqual(["new"]);
    expect(newFind.getAttribute("aria-pressed")).toBe("true");
    expect(list().sort()).toEqual(["Agent Lab", "Model Weekly"]);
    await click(newFind);
    expect(getPrefs().findFilter.stages).toEqual([]);
  });

  it("toggles a signal, and the gold one carries its tooltip", async () => {
    await show();
    const gold = facets().getByRole("button", { name: /Gold mine/ });
    expect(gold.getAttribute("data-tip")).toBe(t.goldTip);
    await click(facets().getByRole("button", { name: /Sponsored before/ }));
    expect(getPrefs().findFilter.signals).toEqual(["sponsored"]);
    expect(list().sort()).toEqual(["Agent Lab", "Prompt Garage"]);
  });

  it("toggles a country chip, with the count shown and in the tip", async () => {
    await show();
    const us = facets().getByRole("button", { name: /^US/ });
    expect(us.querySelector(".c")?.textContent).toBe("2");
    expect(us.getAttribute("data-tip")).toBe(t.facets.countryTip("US", 2));
    await click(us);
    expect(getPrefs().findFilter.countries).toEqual(["US"]);
    expect(us.getAttribute("aria-pressed")).toBe("true");
    expect(list().sort()).toEqual(["Agent Lab", "Prompt Garage"]);
  });

  it("sets the median and uploads thresholds", async () => {
    await show();
    await click(facets().getByRole("button", { name: "25K+" }));
    expect(getPrefs().findFilter.minMedian).toBe(25_000);
    expect(list().sort()).toEqual(["Agent Lab", "Prompt Garage"]);
    await click(facets().getByRole("button", { name: "5+" }));
    expect(getPrefs().findFilter.minUploads).toBe(5);
    expect(list().sort()).toEqual(["Agent Lab", "Prompt Garage"]);
  });

  it("filters by the search that found them", async () => {
    await show();
    const found = facets().getByRole("group", { name: t.facets.runs });
    expect(within(found).getByText(t.facets.todaysSearch)).toBeTruthy();
    await click(within(found).getByText(t.facets.todaysSearch));
    expect(getPrefs().findFilter.runs).toEqual([2]);
    expect(list().sort()).toEqual(["Agent Lab", "Prompt Garage"]);
  });
});

describe("the active filters", () => {
  it("shows the hint when there are none", async () => {
    await show();
    expect(screen.getByText(t.chips.none)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.chips.clearAll })).toBeNull();
  });

  it("shows a removable chip for each filter, and Clear all", async () => {
    await show();
    await click(facets().getByRole("button", { name: /New find/ }));
    await click(facets().getByRole("button", { name: "25K+" }));
    await click(facets().getByRole("button", { name: /^US/ }));
    const chips = screen.getByRole("group", { name: t.chips.group });
    expect(within(chips).getByRole("button", { name: t.chips.remove("New find") })).toBeTruthy();
    expect(
      within(chips).getByRole("button", { name: t.chips.remove("Channel country: US") }),
    ).toBeTruthy();

    await click(within(chips).getByRole("button", { name: t.chips.remove("25K+ median") }));
    expect(getPrefs().findFilter.minMedian).toBe(0);

    await click(within(chips).getByRole("button", { name: t.chips.clearAll }));
    expect(getPrefs().findFilter).toEqual(emptyFindFilter);
    expect(screen.getByText(t.chips.none)).toBeTruthy();
  });
});

describe("the toolbar", () => {
  it("sends the search 200 ms after the last key, and the clear button empties it", async () => {
    await show();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const box = screen.getByRole("textbox", { name: t.toolbar.search });
    fireEvent.change(box, { target: { value: "mo" } });
    fireEvent.change(box, { target: { value: "model" } });
    act(() => {
      vi.advanceTimersByTime(searchDebounceMs - 1);
    });
    expect(getPrefs().findFilter.q).toBe("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getPrefs().findFilter.q).toBe("model");
    vi.useRealTimers();
    await settle();
    expect(list()).toEqual(["Model Weekly"]);

    await click(screen.getByRole("button", { name: t.toolbar.clearSearch }));
    expect(getPrefs().findFilter.q).toBe("");
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("follows a change made from outside (Clear all empties the search box)", async () => {
    await show();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const box = screen.getByRole<HTMLInputElement>("textbox", { name: t.toolbar.search });
    fireEvent.change(box, { target: { value: "model" } });
    act(() => {
      vi.advanceTimersByTime(searchDebounceMs);
    });
    vi.useRealTimers();
    await click(screen.getByRole("button", { name: t.chips.clearAll }));
    expect(box.value).toBe("");
  });

  it("keeps sort, view, size and the show toggles as device prefs", async () => {
    await show();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "median" } });
    expect(getPrefs().findSort).toBe("median");
    const sizes = screen.getByRole("group", { name: t.toolbar.size });
    await click(within(sizes).getByRole("button", { name: t.toolbar.large }));
    expect(getPrefs().findSize).toBe("l");
    const shown = screen.getByRole("group", { name: t.toolbar.show });
    const pics = within(shown).getByRole("button", { name: t.toolbar.pictures });
    expect(pics.getAttribute("aria-pressed")).toBe("true");
    await click(pics);
    expect(getPrefs().findPics).toBe(false);
    expect(pics.getAttribute("aria-pressed")).toBe("false");
    await click(within(shown).getByRole("button", { name: t.toolbar.signals }));
    expect(getPrefs().findSignals).toBe(false);
    expect(screen.getByText(t.toolbar.hint)).toBeTruthy();

    const view = screen.getByRole("group", { name: t.toolbar.view });
    await click(within(view).getByRole("button", { name: t.toolbar.table }));
    expect(getPrefs().findView).toBe("table");
    // Size and the show toggles are for the gallery only.
    expect(screen.queryByRole("group", { name: t.toolbar.size })).toBeNull();
    expect(screen.queryByRole("group", { name: t.toolbar.show })).toBeNull();
    expect(JSON.parse(localStorage.getItem("gratovo.prefs") ?? "{}")).toMatchObject({
      findSort: "median",
      findSize: "l",
      findView: "table",
      findPics: false,
    });
  });

  it("sorts the way the pick says", async () => {
    await show();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "subs" } });
    await settle();
    expect(list()[0]).toBe("Model Weekly");
  });
});

describe("saved views", () => {
  const goldUs: SavedView = {
    name: "US gold mines",
    filter: { ...emptyFindFilter, signals: ["gold"], countries: ["US"] },
  };

  it("loads the views and applies one on click, with a toast", async () => {
    stored = [goldUs];
    await show();
    await click(screen.getByRole("button", { name: "US gold mines" }));
    expect(getPrefs().findFilter).toEqual(goldUs.filter);
    expect(toasts().at(-1)?.msg).toBe(t.views.apply("US gold mines"));
  });

  it("offers Save only while a filter is on; Enter saves it under the name", async () => {
    await show();
    expect(screen.queryByRole("button", { name: t.views.save })).toBeNull();
    await click(facets().getByRole("button", { name: /^US/ }));
    await click(screen.getByRole("button", { name: t.views.save }));
    const box = screen.getByRole("textbox", { name: t.views.nameLabel });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "  US channels  " } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stored).toEqual([
      { name: "US channels", filter: { ...emptyFindFilter, countries: ["US"] } },
    ]);
    expect(toasts().at(-1)?.msg).toBe(t.views.saved);
    expect(screen.getByRole("button", { name: "US channels" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: t.views.nameLabel })).toBeNull();
  });

  it("cancels on Escape without saving", async () => {
    await show();
    await click(facets().getByRole("button", { name: /^US/ }));
    await click(screen.getByRole("button", { name: t.views.save }));
    const box = screen.getByRole("textbox", { name: t.views.nameLabel });
    fireEvent.change(box, { target: { value: "Nope" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: t.views.nameLabel })).toBeNull();
    expect(stored).toEqual([]);
  });

  it("does not save an empty name", async () => {
    await show();
    await click(facets().getByRole("button", { name: /^US/ }));
    await click(screen.getByRole("button", { name: t.views.save }));
    expect(screen.getByRole("button", { name: t.views.saveButton }).hasAttribute("disabled")).toBe(
      true,
    );
    const box = screen.getByRole("textbox", { name: t.views.nameLabel });
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();
    expect(stored).toEqual([]);
  });

  it("says so when main already holds 20 views", async () => {
    setAnswer = "too_many";
    await show();
    await click(facets().getByRole("button", { name: /^US/ }));
    await click(screen.getByRole("button", { name: t.views.save }));
    const box = screen.getByRole("textbox", { name: t.views.nameLabel });
    fireEvent.change(box, { target: { value: "One more" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toasts().at(-1)?.msg).toBe(t.views.tooMany);
    // The box stays open so the name is not lost.
    expect(screen.getByRole("textbox", { name: t.views.nameLabel })).toBeTruthy();
  });

  it("removes a view, and Undo puts it back in its place", async () => {
    const second: SavedView = {
      name: "Sponsored",
      filter: { ...emptyFindFilter, signals: ["sponsored"] },
    };
    stored = [goldUs, second];
    await show();
    await click(screen.getByRole("button", { name: t.views.remove("US gold mines") }));
    expect(stored).toEqual([second]);
    expect(screen.queryByRole("button", { name: /^US gold mines$/ })).toBeNull();
    const toast = toasts().at(-1);
    expect(toast?.msg).toBe(t.views.removed("US gold mines"));
    await act(async () => {
      toast?.actions[0]?.run();
      await Promise.resolve();
    });
    expect(stored).toEqual([goldUs, second]);
    expect(screen.getByRole("button", { name: "US gold mines" })).toBeTruthy();
  });
});

describe("worst case", () => {
  it("renders a 60-character view name, 40 countries and 50 runs without overflow", async () => {
    const longName = "A".repeat(60);
    stored = [{ name: longName, filter: { ...emptyFindFilter, countries: ["US"] } }];
    const countries = Array.from(
      { length: 40 },
      (_, i) =>
        `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) + 1)}`,
    );
    const many = countries.map((country, i) =>
      aiChannel(`UC-${String(i)}`, `Channel ${String(i)}`, { country, run: (i % 50) + 1 }),
    );
    const manyRuns: TestRun[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      startedAt: now - (i + 1) * 86_400_000,
      finishedAt: now - (i + 1) * 86_400_000,
      status: "done",
      keywords: 3,
      found: 5,
      kept: 4,
      gold: 0,
    }));
    await show({ items: many, runs: manyRuns });
    const aside = screen.getByRole("complementary", { name: t.filtersLabel });
    // The country facet lists the top 8 and no more; every run has an option.
    const country = within(aside).getByRole("group", { name: t.facets.country });
    expect(within(country).getAllByRole("button")).toHaveLength(8);
    const found = within(aside).getByRole("group", { name: t.facets.runs });
    expect(within(found).getAllByRole("button")).toHaveLength(50);
    // The long name sits in a chip that can shrink and cut with an ellipsis.
    const chip = screen.getByRole("button", { name: longName });
    expect(chip.querySelector(".ell")?.textContent).toBe(longName);
    expect(list()).toHaveLength(40);
    // Nothing in the page asks for a fixed width wider than its column.
    const wrap = document.querySelector(".gal-wrap");
    expect(wrap?.className).toBe("gal-wrap");
  });
});
