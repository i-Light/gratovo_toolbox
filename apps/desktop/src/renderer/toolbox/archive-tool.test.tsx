// @vitest-environment happy-dom
import type { ArchivedChannel } from "@gratovo/core/find";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFindForTests } from "../lib/find";
import { stubToolboxBridge, toolboxItem } from "../lib/toolbox-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { ArchiveTool } from "./archive-tool";

const t = strings.toolbox.archive;
const r = strings.toolbox.restore;
const day = 86_400_000;

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
async function show(): Promise<void> {
  render(<ArchiveTool />);
  await settle();
}
const click = async (el: HTMLElement): Promise<void> => {
  act(() => {
    fireEvent.click(el);
  });
  await settle();
};
const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await settle();
};
const toast = () => appStore().getState().ui.toasts.at(-1);
const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);

const tomb = (n: number, over: Partial<ArchivedChannel> = {}): ArchivedChannel => ({
  id: `UC${String(n).padStart(22, "0")}`,
  handle: `@aitools${String(n)}`,
  name: null,
  label: "rejected",
  archivedAt: Date.UTC(2026, 9, 1),
  subscribers: 120_000,
  stage: null,
  country: null,
  medianViews: null,
  uploads30: null,
  latestUploadAt: null,
  videos: null,
  keywords: [],
  ...over,
});

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "toolbox", tab: "archive" });
});
afterEach(cleanup);

describe("Toolbox › Archive", () => {
  it("asks main for the sweep when it opens", async () => {
    const bridge = stubToolboxBridge();
    await show();
    expect(bridge.calls.filter(([c]) => c === "toolbox:sweep")).toHaveLength(1);
  });

  it("says so when nothing waits", async () => {
    stubToolboxBridge();
    await show();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint(7))).toBeTruthy();
    expect(screen.getByText(t.forGoodEmpty)).toBeTruthy();
  });

  it("lists the countdown soonest first, with the days in words and a warning at one day", async () => {
    stubToolboxBridge({
      archive: [
        toolboxItem("UC-over", "Late Late", Date.now() - day),
        toolboxItem("UC-one", "Agent Lab", Date.now() + 0.5 * day),
        toolboxItem("UC-four", "Prompt Garage", Date.now() + 3.5 * day, { rejectReason: "ai" }),
        toolboxItem("UC-none", "Old Reject", null, { rejectReason: null, rejectedAt: null }),
      ],
    });
    await show();
    expect(screen.getByText(t.hint(7))).toBeTruthy();
    const names = screen.getAllByRole("button", {
      name: /^(Late Late|Agent Lab|Prompt Garage|Old Reject)/,
    });
    expect(names.map((n) => n.querySelector("b")?.textContent)).toEqual([
      "Late Late",
      "Agent Lab",
      "Prompt Garage",
      "Old Reject",
    ]);
    const row = (name: string) => within(screen.getByText(name).closest("button") as HTMLElement);
    expect(row("Late Late").getByText(t.today)).toBeTruthy();
    expect(row("Agent Lab").getByText(t.inDays(1))).toBeTruthy();
    expect(row("Prompt Garage").getByText(t.inDays(4))).toBeTruthy();
    expect(row("Old Reject").getByText(t.noDate)).toBeTruthy();
    // The reason in words, or "Rejected"; the meter warns at one day or less.
    expect(row("Prompt Garage").getByText(/Not about AI tools/)).toBeTruthy();
    expect(row("Old Reject").getByText(new RegExp(t.reasonUnknown))).toBeTruthy();
    expect(row("Agent Lab").getByRole("meter").className).toContain("warn");
    expect(row("Prompt Garage").getByRole("meter").className).not.toContain("warn");
    expect(row("Old Reject").queryByRole("meter")).toBeNull();
  });

  it("brings a channel back with the act, and the row leaves at once", async () => {
    stubToolboxBridge({ archive: [toolboxItem("UC-lab", "Agent Lab", Date.now() + 3 * day)] });
    await show();
    await click(screen.getByRole("button", { name: t.bringBackLabel("Agent Lab") }));
    expect(creatorOf("UC-lab")).toMatchObject({ stage: "new", rejectedAt: null });
    expect(screen.queryByText("Agent Lab")).toBeNull();
    expect(toast()?.msg).toBe(strings.findActions.broughtBack("Agent Lab"));
  });

  it("opens the peek over the list from a row", async () => {
    stubToolboxBridge({
      archive: [
        toolboxItem("UC-lab", "Agent Lab", Date.now() + 3 * day),
        toolboxItem("UC-gar", "Prompt Garage", Date.now() + 4 * day),
      ],
    });
    await show();
    await click(screen.getByText("Agent Lab").closest("button") as HTMLElement);
    expect(appStore().getState().ui.peek).toEqual({
      record: { kind: "creator", id: "UC-lab" },
      list: ["UC-lab", "UC-gar"],
    });
  });

  it("pages the countdown list with Show more", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      toolboxItem(`UC-${String(i)}`, `Channel ${String(i)}`, Date.now() + (i + 1) * day),
    );
    const bridge = stubToolboxBridge({ archive: many });
    await show();
    expect(screen.getAllByRole("button", { name: /^Bring back/ })).toHaveLength(120);
    await click(screen.getByRole("button", { name: strings.toolbox.showMore }));
    expect(screen.getAllByRole("button", { name: /^Bring back/ })).toHaveLength(130);
    expect(
      bridge.calls.filter(
        ([c, i]) => c === "toolbox:list" && (i as { offset: number }).offset === 120,
      ),
    ).toHaveLength(1);
  });
});

describe("Toolbox › Archived for good", () => {
  it("shows each tombstone with its words and 50 a page", async () => {
    const rows = [
      tomb(1, { name: "Agent Lab" }),
      tomb(2, { label: "inactive", subscribers: null }),
      ...Array.from({ length: 58 }, (_, i) => tomb(i + 3)),
    ];
    const bridge = stubToolboxBridge({ archived: rows });
    await show();
    const section = within(screen.getByRole("region", { name: t.forGoodTitle }));
    expect(section.getAllByRole("button", { name: /^Bring back/ })).toHaveLength(50);
    expect(section.getByText("Agent Lab")).toBeTruthy();
    expect(section.getByText(/@aitools1 · Rejected/)).toBeTruthy();
    expect(section.getByText(/^inactive · archived/)).toBeTruthy();
    await click(section.getByRole("button", { name: strings.toolbox.showMore }));
    expect(section.getAllByRole("button", { name: /^Bring back/ })).toHaveLength(60);
    expect(section.queryByRole("button", { name: strings.toolbox.showMore })).toBeNull();
    expect(
      bridge.calls
        .filter(([c]) => c === "toolbox:archived")
        .map(([, i]) => (i as { offset: number }).offset),
    ).toContain(50);
  });

  it("shows what the tombstone kept, and not known for the rest", async () => {
    const rows = [
      tomb(1, {
        name: "Agent Lab",
        country: "US",
        medianViews: 41_000,
        uploads30: 6,
        keywords: [
          { keyword: "ai agents", at: 1 },
          { keyword: "llm tools", at: 2 },
          { keyword: "prompt tips", at: 3 },
          { keyword: "rag", at: 4 },
          { keyword: "mcp", at: 5 },
        ],
      }),
      tomb(2),
    ];
    stubToolboxBridge({ archived: rows });
    await show();
    const section = within(screen.getByRole("region", { name: t.forGoodTitle }));
    expect(
      section.getByText(
        /Country: US · Subscribers: 120K · Median views: 41K · Uploads in 30 days: 6 · Found by: ai agents, llm tools, prompt tips \+2 more/,
      ),
    ).toBeTruthy();
    expect(
      section.getByText(
        "Country: not known · Subscribers: 120K · Median views: not known · Uploads in 30 days: not known · Found by: not known",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText(t.searchLabel).getAttribute("placeholder")).toMatch(
      /name or handle/i,
    );
  });

  it("searches after a short wait", async () => {
    const bridge = stubToolboxBridge({ archived: [tomb(1, { handle: "@claudecoach" }), tomb(2)] });
    await show();
    fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: "coach" } });
    await settle();
    // Not asked yet.
    expect(
      bridge.calls.some(([c, i]) => c === "toolbox:archived" && (i as { q: string }).q === "coach"),
    ).toBe(false);
    await wait(320);
    expect(
      bridge.calls.some(([c, i]) => c === "toolbox:archived" && (i as { q: string }).q === "coach"),
    ).toBe(true);
    expect(screen.getByText(/@claudecoach/)).toBeTruthy();
    expect(screen.queryByText(/@aitools2/)).toBeNull();
    fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: "nobody" } });
    await wait(320);
    expect(screen.getByText(t.noMatch)).toBeTruthy();
  });

  it("restores on live data and says its numbers are read again", async () => {
    const bridge = stubToolboxBridge({
      archived: [tomb(1, { name: "Agent Lab" })],
      restore: { ok: true, restored: 1, refetch: true },
    });
    await show();
    await click(screen.getByRole("button", { name: t.bringBackLabel("Agent Lab") }));
    expect(bridge.calls.find(([c]) => c === "toolbox:restore")?.[1]).toEqual({ ids: [tomb(1).id] });
    expect(toast()).toMatchObject({ msg: r.comingBack("Agent Lab"), sub: r.comingBackSub });
    expect(screen.queryByText("Agent Lab")).toBeNull();
  });

  it("restores on example data with the words for a later search", async () => {
    stubToolboxBridge({ archived: [tomb(1)], restore: { ok: true, restored: 1, refetch: false } });
    await show();
    await click(screen.getByRole("button", { name: /^Bring back/ }));
    expect(toast()?.msg).toBe(r.returnsLater);
  });

  it("says to wait while a search runs, and keeps the row", async () => {
    stubToolboxBridge({ archived: [tomb(1)], restore: { ok: false, problem: "busy" } });
    await show();
    await click(screen.getByRole("button", { name: /^Bring back/ }));
    expect(toast()?.msg).toBe(r.busy);
    expect(screen.getAllByRole("button", { name: /^Bring back/ })).toHaveLength(1);
  });

  it("uses the app's words when the pipeline is missing", async () => {
    stubToolboxBridge({ archived: [tomb(1)], restore: { ok: false, problem: "no_python" } });
    await show();
    await click(screen.getByRole("button", { name: /^Bring back/ }));
    expect(toast()?.msg).toBe(strings.findSearch.startProblems.no_python);
  });

  it("runs the Bring back act after the restore worked, its toast saying how it went", async () => {
    const detail = toolboxItem("UC-rej", "Agent Lab", null);
    const id = "UC".concat("r".repeat(22));
    const bridge = stubToolboxBridge({
      archived: [tomb(1, { id, name: "Agent Lab", stage: "rejected" })],
      detail: { ...detail, id },
    });
    await show();
    await click(screen.getByRole("button", { name: t.bringBackLabel("Agent Lab") }));
    expect(bridge.calls.findIndex(([c]) => c === "toolbox:restore")).toBeGreaterThan(-1);
    expect(creatorOf(id)).toMatchObject({ stage: "new" });
    // One toast: the act's (it carries Undo), its second line saying how the restore went.
    const toasts = appStore().getState().ui.toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      msg: strings.findActions.broughtBack("Agent Lab"),
      sub: r.returnsLater,
    });
    expect(toasts[0]?.actions.map((a) => a.label)).toContain(strings.actions.undo);
  });

  it("puts the refetch words in the act's toast on live data", async () => {
    const detail = toolboxItem("UC-rej", "Agent Lab", null);
    const id = "UC".concat("r".repeat(22));
    stubToolboxBridge({
      archived: [tomb(1, { id, name: "Agent Lab", stage: "rejected" })],
      detail: { ...detail, id },
      restore: { ok: true, restored: 1, refetch: true },
    });
    await show();
    await click(screen.getByRole("button", { name: t.bringBackLabel("Agent Lab") }));
    expect(
      appStore()
        .getState()
        .ui.toasts.map((x) => x.sub),
    ).toEqual([r.comingBackSub]);
  });

  it.each([
    ["busy", r.busy],
    ["failed", r.failed],
    ["no_python", strings.findSearch.startProblems.no_python],
  ])("a %s restore leaves the stage alone and shows one problem toast", async (problem, words) => {
    const detail = toolboxItem("UC-rej", "Agent Lab", null);
    const id = "UC".concat("r".repeat(22));
    stubToolboxBridge({
      archived: [tomb(1, { id, name: "Agent Lab", stage: "rejected" })],
      detail: { ...detail, id },
      restore: { ok: false, problem },
    });
    await show();
    await click(screen.getByRole("button", { name: t.bringBackLabel("Agent Lab") }));
    expect(creatorOf(id)?.stage).not.toBe("new");
    expect(
      appStore()
        .getState()
        .ui.toasts.map((x) => x.msg),
    ).toEqual([words]);
  });

  it("offers no Bring back for a tombstone whose id is not a channel id", async () => {
    stubToolboxBridge({
      archived: [tomb(1, { id: "UC-short", name: "Odd One" }), tomb(2, { name: "Agent Lab" })],
    });
    await show();
    const section = within(screen.getByRole("region", { name: t.forGoodTitle }));
    expect(section.getByText("Odd One")).toBeTruthy();
    expect(section.queryByRole("button", { name: t.bringBackLabel("Odd One") })).toBeNull();
    expect(section.getByRole("button", { name: t.bringBackLabel("Agent Lab") })).toBeTruthy();
  });
});
