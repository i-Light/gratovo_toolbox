// @vitest-environment happy-dom
import type { FindState, WritingRules } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFindForTests } from "../lib/find";
import { initPrefs } from "../lib/prefs";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { SettingsScreen } from "./settings-screen";

const text = strings.settings;
const st = text.searchRules;
const wt = text.writingRules;

const baseRules: FindState["rules"] = {
  countries: ["US", "GB"],
  perKeyword: 200,
  sortBy: "upload_date",
  resultsType: "video",
  autoClean: {
    enabled: true,
    minSubscribers: 50_000,
    maxSubscribers: 2_000_000,
    belowMin: "sweep",
    aboveMax: "delay",
    label: "inactive",
  },
  minMedianViews: 50_000,
  minUploads30: null,
  archiveDays: 7,
};

const findState = (rules: FindState["rules"] = baseRules): FindState => ({
  queue: [],
  at: 0,
  rules,
  run: { state: "ready", found: 0, kept: 0, swept: 0, error: null },
  log: [],
  kept: [],
});

type Invoke = (channel: string, input: unknown) => Promise<unknown>;
let calls: [string, unknown][];

function install(answers: Record<string, unknown>): void {
  calls = [];
  const invoke: Invoke = (channel, input) => {
    calls.push([channel, input]);
    return Promise.resolve(answers[channel] ?? { ok: true, value: {} });
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
}

async function show(tab: "search" | "writing"): Promise<void> {
  resetAppStoreForTests({ screen: "settings", tab });
  render(<SettingsScreen />);
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
const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
};
const button = (name: string): HTMLElement => screen.getByRole("button", { name });

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetFindForTests();
});
afterEach(cleanup);

describe("Settings › Search rules", () => {
  it("shows the rules as tags, with null as off", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    const pane = document.getElementById("set-rulesMedian");
    expect(pane?.textContent).toContain("Keep: 50K+ median views");
    expect(document.getElementById("set-rulesUploads")?.textContent).toContain(st.uploadsAny);
    expect(document.getElementById("set-rulesCountries")?.textContent).toContain("US · GB");
    expect(document.getElementById("set-rulesPerKeyword")?.textContent).toContain(
      "200 channels per keyword",
    );
    expect(document.getElementById("set-rulesArchive")?.textContent).toContain(
      "Rejects archived after 7 days",
    );
    expect(document.getElementById("set-rulesBand")?.textContent).toContain(
      "Archive under 50K subscribers",
    );
    expect(document.querySelector('[data-ui="settings.search.median"]')).not.toBeNull();
    expect(screen.getByText(text.sections.search.note, { exact: false })).toBeTruthy();
  });

  it("says median views are any when the rule is off", async () => {
    install({
      "find:state": { ok: true, value: findState({ ...baseRules, minMedianViews: null }) },
    });
    await show("search");
    expect(screen.getByText(st.medianAny)).toBeTruthy();
  });

  it("edits and saves the exact rules, empty meaning off", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    await click(button(st.edit));
    type(text.rows.rulesMedian.label, "");
    type(text.rows.rulesUploads.label, "4");
    type(text.rows.rulesPerKeyword.label, "100");
    type(text.rows.rulesArchive.label, "14");
    await click(button("IN"));
    await click(button("GB"));
    await click(button(st.save));
    const saved = calls.find(([channel]) => channel === "rules:set");
    expect(saved?.[1]).toEqual({
      rules: {
        ...baseRules,
        countries: ["US", "IN"],
        perKeyword: 100,
        minMedianViews: null,
        minUploads30: 4,
        archiveDays: 14,
      },
    });
    const toasts = appStore().getState().ui.toasts;
    expect(toasts.some((t) => t.msg === st.savedToast && t.sub === st.savedSub)).toBe(true);
    // Back to the tags.
    expect(screen.queryByRole("button", { name: st.save })).toBeNull();
  });

  it("keeps a country the picker doesn't list", async () => {
    install({
      "find:state": { ok: true, value: findState({ ...baseRules, countries: ["US", "SG"] }) },
    });
    await show("search");
    await click(button(st.edit));
    expect(button("SG").getAttribute("aria-pressed")).toBe("true");
  });

  it("refuses archive days out of range, in plain words", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    await click(button(st.edit));
    type(text.rows.rulesArchive.label, "91");
    expect(screen.getByText(st.errArchive)).toBeTruthy();
    expect(button(st.save).hasAttribute("disabled")).toBe(true);
    type(text.rows.rulesArchive.label, "0");
    expect(screen.getByText(st.errArchive)).toBeTruthy();
    type(text.rows.rulesArchive.label, "30");
    expect(screen.queryByText(st.errArchive)).toBeNull();
    expect(button(st.save).hasAttribute("disabled")).toBe(false);
  });

  it("refuses a minimum above the maximum subscribers", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    await click(button(st.edit));
    fireEvent.change(screen.getByLabelText(st.minSubscribers), { target: { value: "3000000" } });
    expect(screen.getByText(st.errBandOrder)).toBeTruthy();
    expect(button(st.save).hasAttribute("disabled")).toBe(true);
    expect(calls.some(([channel]) => channel === "rules:set")).toBe(false);
  });

  it("refuses a median that is not a number", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    await click(button(st.edit));
    type(text.rows.rulesMedian.label, "lots");
    expect(screen.getByText(st.errNumber)).toBeTruthy();
  });

  it("cancels without saving", async () => {
    install({ "find:state": { ok: true, value: findState() } });
    await show("search");
    await click(button(st.edit));
    type(text.rows.rulesArchive.label, "30");
    await click(button(st.cancel));
    expect(calls.some(([channel]) => channel === "rules:set")).toBe(false);
    expect(screen.getByText(st.archiveAfter(7))).toBeTruthy();
  });

  it("stays in edit mode and says so when saving fails", async () => {
    install({
      "find:state": { ok: true, value: findState() },
      "rules:set": { ok: false, reason: "test" },
    });
    await show("search");
    await click(button(st.edit));
    await click(button(st.save));
    expect(screen.getByText(st.saveFailed)).toBeTruthy();
    expect(button(st.save)).toBeTruthy();
  });
});

const rule = (
  id: string,
  area: string,
  title: string,
  text2: string,
  level: WritingRules["rules"][number]["level"] = "must",
): WritingRules["rules"][number] => ({ id, area, stage: "qualify", title, rule: text2, level });

const writing: WritingRules = {
  found: true,
  rules: [
    rule("BRD-PITCH-02", "brand", "Pitch small", "Pitch one or two signed creators."),
    rule("INF-NOTNOW-01", "influencer", "Not now", "Answer short and warm.", "should"),
    rule("FND-TONE-01", "foundations", "Tone", "Write like a person."),
    rule("ZZZ-ODD-01", "contract_terms", "Odd one", "Something else."),
  ],
};

describe("Settings › Writing rules", () => {
  it("groups the rules by area, with the level and the id", async () => {
    install({ "writing:rules": { ok: true, value: writing } });
    await show("writing");
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["Foundations", "Creators", "Brands", "Contract Terms"]);
    const brands = screen.getByRole("region", { name: wt.groupLabel("Brands") });
    expect(within(brands).getByText("BRD-PITCH-02")).toBeTruthy();
    expect(within(brands).getByText("Pitch small")).toBeTruthy();
    expect(within(brands).getByText("must")).toBeTruthy();
    expect(screen.getByText("should")).toBeTruthy();
    expect(screen.getByText(text.sections.writing.note, { exact: false })).toBeTruthy();
  });

  it("filters by id, ignoring case", async () => {
    install({ "writing:rules": { ok: true, value: writing } });
    await show("writing");
    fireEvent.change(screen.getByRole("searchbox", { name: wt.searchLabel }), {
      target: { value: "inf-not" },
    });
    expect(screen.getByText("INF-NOTNOW-01")).toBeTruthy();
    expect(screen.queryByText("BRD-PITCH-02")).toBeNull();
    expect(screen.queryByRole("heading", { level: 4, name: "Brands" })).toBeNull();
  });

  it("filters by words", async () => {
    install({ "writing:rules": { ok: true, value: writing } });
    await show("writing");
    fireEvent.change(screen.getByRole("searchbox", { name: wt.searchLabel }), {
      target: { value: "SIGNED creators" },
    });
    expect(screen.getByText("BRD-PITCH-02")).toBeTruthy();
    expect(screen.queryByText("FND-TONE-01")).toBeNull();
  });

  it("says no rule matches", async () => {
    install({ "writing:rules": { ok: true, value: writing } });
    await show("writing");
    fireEvent.change(screen.getByRole("searchbox", { name: wt.searchLabel }), {
      target: { value: "zebra" },
    });
    expect(screen.getByText(wt.noMatch)).toBeTruthy();
    expect(screen.getByText(wt.noMatchHint)).toBeTruthy();
  });

  it("says the rules weren't found when the files are missing", async () => {
    install({ "writing:rules": { ok: true, value: { found: false, rules: [] } } });
    await show("writing");
    expect(screen.getByText(wt.notFound)).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
