// @vitest-environment happy-dom
import type { Creator } from "@gratovo/core/data";
import { emptyFacets } from "@gratovo/core/find";
import type { CatalogItem } from "@gratovo/core/find";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { aiCreator } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { kitCreator, passingKit, seedCreators } from "./close-fixtures";
import { Roster } from "./roster";

const t = strings.closeScreen.roster;

const catalogItem = (id: string, name: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name,
  handle: `@${name.toLowerCase().replace(/\s+/g, "")}`,
  pic: null,
  stage: "signed",
  emailConfirmed: true,
  email: null,
  contactName: null,
  subscribers: 210_000,
  medianViews: 48_000,
  uploads30: 6,
  country: "US",
  sponsors: [],
  emails: [],
  latestUploadAt: null,
  foundAt: null,
  run: 1,
  keyword: "ai tools",
  videos: [],
  engagement: null,
  emailedBefore: null,
  rejectReason: null,
  rejectedAt: null,
  neverReason: null,
  archiveDueAt: null,
  archivedAt: null,
  hasNumbers: true,
  uploadsRead: true,
  readFailed: false,
  ...over,
});

const fit = { score: 50, parts: [] };
const page = (items: CatalogItem[]) => ({
  version: 1,
  total: items.length,
  items: items.map((i) => ({ ...i, fit })),
  facets: emptyFacets,
});

const passing = aiCreator("c3", "Tensor Talk", { stage: "kit", kit: passingKit() });
const failing = aiCreator("c4", "Agent Weekly", {
  stage: "audience",
  kit: passingKit({ countries: [{ code: "IN", share: 60 }] }),
});
const missing = aiCreator("c5", "Model Minute", {
  stage: "kit",
  kit: passingKit({ ageBand: null }),
});
const signedOne = (id: string, name: string, rate: number | null): Creator =>
  aiCreator(id, name, {
    stage: "signed",
    kit: passingKit({
      rate,
      countries: [
        { code: "US", share: 52 },
        { code: "GB", share: 14 },
      ],
    }),
  });

beforeEach(() => {
  resetAppStoreForTests({ screen: "close", tab: "roster" });
});
afterEach(cleanup);

describe("Roster, waiting for an audience check", () => {
  it("lists kit and audience creators with the right verdicts, by name", () => {
    stubReachBridge({ "find:query": page([]) });
    seedCreators([passing, failing, missing, kitCreator(passingKit(), "replied")]);
    render(<Roster />);
    const rows = screen.getAllByText(/Tensor Talk|Agent Weekly|Model Minute/, { selector: "b" });
    expect(rows.map((r) => r.textContent)).toEqual(["Agent Weekly", "Model Minute", "Tensor Talk"]);
    const row = (name: string): HTMLElement => {
      const found = screen
        .getAllByText(name, { selector: "b" })[0]
        ?.closest<HTMLElement>("[data-ui='close.roster.kit.row']");
      if (found === null || found === undefined) throw new Error(name);
      return found;
    };
    expect(within(row("Tensor Talk")).getByText(t.verdict.pass)).toBeTruthy();
    expect(within(row("Tensor Talk")).getByText(/asks \$3,400/)).toBeTruthy();
    expect(
      within(row("Agent Weekly")).getByText(t.verdict.fail(strings.reach.board.checkNames.top)),
    ).toBeTruthy();
    expect(within(row("Model Minute")).getByText(t.verdict.missing)).toBeTruthy();
    expect(screen.getByText(t.kitsHint)).toBeTruthy();
  });

  it("opens one check at a time", () => {
    stubReachBridge({ "find:query": page([]) });
    seedCreators([passing, failing]);
    render(<Roster />);
    const toggles = screen.getAllByRole("button", { name: t.show });
    expect(toggles).toHaveLength(2);
    expect(toggles[0]?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggles[0] as HTMLElement);
    expect(screen.getAllByRole("button", { name: t.hide })).toHaveLength(1);
    expect(document.querySelectorAll("[data-ui='record.audience.check']")).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: t.show })[0] as HTMLElement);
    expect(document.querySelectorAll("[data-ui='record.audience.check']")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: t.hide })).toHaveLength(1);
  });

  it("opens the creator's peek from the name", () => {
    stubReachBridge({ "find:query": page([]) });
    seedCreators([passing]);
    render(<Roster />);
    fireEvent.click(screen.getByRole("button", { name: t.openCreator("Tensor Talk") }));
    expect(appStore().getState().ui.peek?.record.id).toBe("c3");
    expect(selectRoute(appStore().getState()).screen).toBe("close");
  });

  it("shows no card when nobody waits", () => {
    stubReachBridge({ "find:query": page([]) });
    seedCreators([signedOne("c1", "Prompt Lab", 3000)]);
    render(<Roster />);
    expect(document.querySelector("[data-ui='close.roster.kits']")).toBeNull();
  });
});

describe("Roster, signed creators", () => {
  it("merges catalog numbers by id, highest median first, and shows a dash for the unknown", async () => {
    const calls = stubReachBridge({
      "find:query": page([
        catalogItem("c1", "Prompt Lab", { medianViews: 20_000, subscribers: 100_000 }),
        catalogItem("c2", "Neural Notes", { medianViews: 90_000, subscribers: 400_000 }),
      ]),
    }).calls;
    seedCreators([
      signedOne("c1", "Prompt Lab", 2000),
      signedOne("c2", "Neural Notes", 4500),
      signedOne("c9", "Unseen Channel", null),
    ]);
    render(<Roster />);
    await act(async () => {
      await Promise.resolve();
    });
    const query = calls.find(([channel]) => channel === "find:query");
    expect(query?.[1]).toMatchObject({ sort: "median", facets: false, limit: 120 });
    expect((query?.[1] as { filter: { stages: string[] } }).filter.stages).toEqual(["signed"]);
    const table = screen.getByRole("table", { name: t.tableLabel });
    const body = within(table).getAllByRole("row").slice(1);
    expect(
      body.map((r) => within(r).getAllByRole("button")[0]?.getAttribute("aria-label")),
    ).toEqual([
      t.openCreator("Neural Notes"),
      t.openCreator("Prompt Lab"),
      t.openCreator("Unseen Channel"),
    ]);
    const first = within(body[0] as HTMLElement);
    expect(first.getByText("$4,500")).toBeTruthy();
    expect(first.getByText("90K")).toBeTruthy();
    expect(first.getByText(/400K subscribers/)).toBeTruthy();
    expect(first.getByText("US")).toBeTruthy();
    const last = within(body[2] as HTMLElement);
    expect(last.getAllByText(t.none)).toHaveLength(2);
  });

  it("opens the peek on a row click", async () => {
    stubReachBridge({ "find:query": page([catalogItem("c1", "Prompt Lab")]) });
    seedCreators([signedOne("c1", "Prompt Lab", 2000)]);
    render(<Roster />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getAllByRole("row")[1] as HTMLElement);
    expect(appStore().getState().ui.peek?.record.id).toBe("c1");
  });

  it("says nobody is signed, with the text for whether kits wait", () => {
    stubReachBridge({ "find:query": page([]) });
    seedCreators([]);
    const { unmount } = render(<Roster />);
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyNoKits)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.emptyAction }));
    expect(selectRoute(appStore().getState())).toMatchObject({ screen: "reach", tab: "board" });
    unmount();
    resetAppStoreForTests({ screen: "close", tab: "roster" });
    seedCreators([passing]);
    render(<Roster />);
    expect(screen.getByText(t.emptyWithKits)).toBeTruthy();
  });
});
