// @vitest-environment happy-dom
import { DEAL_FLOW } from "@gratovo/core";
import { bareBrand, bareDeal, exampleFrame, type Brand, type Deal } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toAppData } from "../lib/frame";
import { appStore, initAppStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { RecordBody } from "../overlays/record-summary";
import { strings } from "../strings";
import { BrandRecord } from "./brand-record";
import { DealRecord } from "./deal-record";

const b = strings.brandRecord;
const d = strings.dealRecord;

type Call = [string, unknown];
let calls: Call[] = [];

function bridge(writeOk = true): void {
  calls = [];
  const invoke = (channel: string, input: unknown) => {
    calls.push([channel, input]);
    if (channel === "log:for") return Promise.resolve({ ok: true, value: { lines: [] } });
    if (channel === "data:write") {
      return Promise.resolve(writeOk ? { ok: true, value: {} } : { ok: false });
    }
    return Promise.resolve({ ok: false, reason: "test" });
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: () => () => undefined,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}
const click = async (el: HTMLElement): Promise<void> => {
  fireEvent.click(el);
  await settle();
};
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

function brand(over: Partial<Brand> = {}): Brand {
  return {
    ...bareBrand({ id: "br1", name: "Codewell", sells: "AI code editor", status: "negotiating" }),
    country: "US",
    headcount: 120,
    recommendedTitle: "Head of Partnerships",
    paidSpenderVerified: true,
    pastCampaignHook: "Sponsored three AI coding channels in March",
    budget: { low: 2000, high: 5000 },
    budgetKnown: true,
    contacts: ["A", "B", "C", "D", "E"].map((n) => ({
      name: `Buyer ${n}`,
      role: "Partnerships",
      email: `${n.toLowerCase()}@codewell.test`,
    })),
    since: Date.UTC(2026, 8, 3),
    pitched: { at: Date.UTC(2026, 9, 1), creators: ["cr1"], mode: "cold" },
    seen: ["cr1"],
    notes: "",
    ...over,
  };
}

function deal(over: Partial<Deal> = {}): Deal {
  return {
    ...bareDeal({ id: "dl1", brand: "br1", creator: "cr1", step: 1, price: 4000 }),
    payout: 3000,
    checks: [true, true, false, false],
    deliverable: "60 second integration",
    terms: "Net 30",
    model: "brokered",
    placement: "First third",
    notes: "",
    ...over,
  };
}

function setup(
  over: { brands?: Brand[]; deals?: Deal[]; seesMoney?: boolean; source?: "example" | "live" } = {},
): void {
  const frame = exampleFrame(Date.now());
  const first = frame.creators[0];
  if (first === undefined) throw new Error("no example creator");
  initAppStore(
    toAppData({
      ...frame,
      source: over.source ?? "example",
      seesMoney: over.seesMoney ?? true,
      creators: [{ ...first, id: "cr1", name: "Agent Lab" }],
      brands: over.brands ?? [brand()],
      deals: over.deals ?? [deal()],
    }),
    { screen: "find", tab: "triage" },
  );
}

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "triage" });
  bridge();
});
afterEach(cleanup);

describe("the brand record", () => {
  it("has the five tabs, the brand steps with the current one marked, and the status", async () => {
    setup();
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Codewell");
    expect(screen.getAllByRole("tab").map((el) => el.textContent.replace(/\s\d+$/, ""))).toEqual(
      Object.values(b.tabs),
    );
    const steps = screen.getByRole("list", { name: b.stepsLabel });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(5);
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe(
      strings.record.brandStatus.negotiating,
    );
    expect(screen.getAllByText(strings.record.brandStatus.negotiating).length).toBeGreaterThan(0);
  });

  it("shows no steps for a lost brand, only its tag", async () => {
    setup({ brands: [brand({ status: "lost" })] });
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    expect(screen.queryByRole("list", { name: b.stepsLabel })).toBeNull();
    expect(screen.getByText(strings.record.brandStatus.lost)).toBeTruthy();
  });

  it("shows the facts on Overview, the budget only to a viewer who sees money", async () => {
    setup();
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    expect(screen.getByText(b.overview.people(120))).toBeTruthy();
    expect(screen.getByText("Head of Partnerships")).toBeTruthy();
    expect(screen.getByText(b.overview.paidYes)).toBeTruthy();
    expect(screen.getByText("Sponsored three AI coding channels in March")).toBeTruthy();
    expect(screen.getByText(b.overview.budgetRange("$2,000", "$5,000"))).toBeTruthy();
    cleanup();
    setup({ seesMoney: false });
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    expect(screen.queryByText(b.overview.budget)).toBeNull();
    expect(document.body.textContent).not.toContain("$2,000");
  });

  it("the creators it was seen sponsoring open their record", async () => {
    setup();
    render(<BrandRecord id="br1" layout="page" />);
    await settle();
    const links = screen.getAllByRole("button", { name: "Agent Lab" });
    expect(links.length).toBe(2);
    await click(links[0] as HTMLElement);
    expect(selectRoute(appStore().getState()).record).toEqual({ kind: "creator", id: "cr1" });
  });

  it("Contacts lists at most four buyers", async () => {
    setup();
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.contacts));
    const list = screen.getByRole("list", { name: b.contacts.label });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).queryByText("Buyer E")).toBeNull();
    expect(within(list).getByText("a@codewell.test")).toBeTruthy();
  });

  it("Deals lists the brand's deals and opens one; live has no Deals tab", async () => {
    setup();
    render(<BrandRecord id="br1" layout="page" />);
    await settle();
    expect(tab(b.tabs.deals).textContent).toContain("1");
    await click(tab(b.tabs.deals));
    await click(screen.getByRole("button", { name: /Open the deal/ }));
    expect(selectRoute(appStore().getState()).record).toEqual({ kind: "deal", id: "dl1" });
    cleanup();
    setup({ source: "live" });
    render(<BrandRecord id="br1" layout="page" />);
    await settle();
    expect(screen.queryByRole("tab", { name: /^Deals/ })).toBeNull();
  });

  it("Notes save on blur through brand.notes, with the text they started from", async () => {
    setup({ brands: [brand({ notes: "first" })] });
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.notes));
    const box = screen.getByLabelText(b.notesLabel);
    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.blur(box);
    await settle();
    const write = calls.find(([c]) => c === "data:write");
    expect(write?.[1]).toEqual({
      writes: [{ kind: "brand.notes", id: "br1", notes: "second", base: "first" }],
    });
    expect(screen.getByText(strings.creatorRecord.notesSaved)).toBeTruthy();
  });

  it("a saved note is still there when the record is closed and reopened", async () => {
    setup({ brands: [brand({ notes: "first" })] });
    const first = render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.notes));
    const box = screen.getByLabelText(b.notesLabel);
    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.blur(box);
    await settle();
    first.unmount();
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.notes));
    expect(screen.getByLabelText<HTMLTextAreaElement>(b.notesLabel).value).toBe("second");
  });

  it("Notes are read only when the stored note was cut", async () => {
    setup({ brands: [brand({ notes: "x".repeat(10), notesCut: true })] });
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.notes));
    expect(screen.getByLabelText<HTMLTextAreaElement>(b.notesLabel).readOnly).toBe(true);
  });

  it("Activity asks the log for the brand", async () => {
    setup();
    render(<BrandRecord id="br1" layout="peek" />);
    await settle();
    await click(tab(b.tabs.activity));
    expect(calls.some(([c, i]) => c === "log:for" && (i as { ref: string }).ref === "br1")).toBe(
      true,
    );
    expect(screen.getByText(b.activityNone)).toBeTruthy();
  });

  it("says so for a brand that is not there", () => {
    setup();
    render(<BrandRecord id="nope" layout="peek" />);
    expect(screen.getByText(strings.record.notFound)).toBeTruthy();
  });
});

describe("the deal record", () => {
  it("names the first tab Steps for a viewer without money", async () => {
    setup({ seesMoney: false });
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    expect(screen.getAllByRole("tab")[0]?.textContent).toBe(d.tabs.steps);
  });

  it("has the three tabs and the ten steps with the current one marked", async () => {
    setup();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Codewell × Agent Lab");
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual([
      d.tabs.stepsAndMoney,
      d.tabs.notes,
      d.tabs.activity,
    ]);
    const strip = screen.getByRole("list", { name: d.stepsLabel });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(10);
    expect(strip.querySelector('[aria-current="step"]')?.textContent).toBe(DEAL_FLOW[1]?.name);
  });

  it("lists every step with its checklist ticked or not", async () => {
    setup();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    const flow = screen.getByRole("list", { name: d.stepsHeading });
    const items = flow.querySelectorAll(".cr-checks li");
    const total = DEAL_FLOW.reduce((n, s) => n + s.items.length, 0);
    expect(items).toHaveLength(total);
    // The first step is behind the deal: all done. The current one has two of four ticked.
    const first = DEAL_FLOW[0]?.items.length ?? 0;
    const doneNow = [...items].filter((li) => li.classList.contains("done")).length;
    expect(doneNow).toBe(first + 2);
    const said = [...flow.querySelectorAll(".cr-checks .sr")].filter(
      (el) => el.textContent === d.itemDone,
    );
    expect(said).toHaveLength(first + 2);
  });

  it("shows the dates, terms, model and placement", async () => {
    setup({
      deals: [deal({ goLiveAt: Date.UTC(2026, 10, 12), creatorDeadline: Date.UTC(2026, 10, 7) })],
    });
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    expect(screen.getByText("60 second integration")).toBeTruthy();
    expect(screen.getByText("Net 30")).toBeTruthy();
    expect(screen.getByText(d.models.brokered)).toBeTruthy();
    expect(screen.getByText("First third")).toBeTruthy();
    expect(screen.getByText("Nov 12")).toBeTruthy();
    expect(screen.getByText("Nov 7")).toBeTruthy();
  });

  it("shows the money card and the header money only to a viewer who sees money", async () => {
    setup();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    const card = screen.getByRole("region", { name: d.moneyHeading });
    expect(within(card).getByText("$4,000")).toBeTruthy();
    expect(within(card).getByText(d.money.marginValue("$1,000", 25))).toBeTruthy();
    expect(document.body.textContent).toContain(d.price("$4,000", "$3,000"));
    cleanup();
    setup({ seesMoney: false, deals: [deal({ price: null, payout: null })] });
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    expect(screen.queryByRole("region", { name: d.moneyHeading })).toBeNull();
    expect(document.body.textContent).not.toContain("$");
  });

  it("links to the brand and the creator, and the brand link is hidden live", async () => {
    setup();
    render(<DealRecord id="dl1" layout="page" />);
    await settle();
    await click(screen.getByRole("button", { name: d.openBrand("Codewell") }));
    expect(selectRoute(appStore().getState()).record).toEqual({ kind: "brand", id: "br1" });
    await click(screen.getByRole("button", { name: d.openCreator("Agent Lab") }));
    expect(selectRoute(appStore().getState()).record).toEqual({ kind: "creator", id: "cr1" });
    cleanup();
    setup({ source: "live" });
    render(<DealRecord id="dl1" layout="page" />);
    await settle();
    expect(screen.queryByRole("button", { name: d.openBrand("Codewell") })).toBeNull();
    expect(screen.getByRole("button", { name: d.openCreator("Agent Lab") })).toBeTruthy();
  });

  it("a saved deal note is still there when the record is reopened", async () => {
    setup();
    const first = render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    await click(tab(d.tabs.notes));
    const box = screen.getByLabelText(d.notesLabel);
    fireEvent.change(box, { target: { value: "Link in the first line" } });
    fireEvent.blur(box);
    await settle();
    first.unmount();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    await click(tab(d.tabs.notes));
    expect(screen.getByLabelText<HTMLTextAreaElement>(d.notesLabel).value).toBe(
      "Link in the first line",
    );
  });

  it("Notes save on blur through deal.notes", async () => {
    setup();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    await click(tab(d.tabs.notes));
    const box = screen.getByLabelText(d.notesLabel);
    fireEvent.change(box, { target: { value: "Brand wants the link in the first line" } });
    fireEvent.blur(box);
    await settle();
    expect(calls.find(([c]) => c === "data:write")?.[1]).toEqual({
      writes: [
        {
          kind: "deal.notes",
          id: "dl1",
          notes: "Brand wants the link in the first line",
          base: "",
        },
      ],
    });
  });
});

describe("in the peek and on the record page", () => {
  it("RecordBody says not found for a brand or a deal in live", () => {
    setup({ source: "live" });
    for (const kind of ["brand", "deal"] as const) {
      const { unmount } = render(
        <RecordBody record={{ kind, id: kind === "brand" ? "br1" : "dl1" }} layout="peek" />,
      );
      expect(screen.getByText(strings.record.notFound)).toBeTruthy();
      unmount();
    }
  });

  it("RecordBody shows the brand and the deal records", async () => {
    setup();
    render(<RecordBody record={{ kind: "brand", id: "br1" }} layout="page" />);
    await settle();
    expect(screen.getByRole("tablist", { name: b.tabsLabel })).toBeTruthy();
    cleanup();
    render(<RecordBody record={{ kind: "deal", id: "dl1" }} layout="peek" />);
    await settle();
    expect(screen.getByRole("tablist", { name: d.tabsLabel })).toBeTruthy();
  });

  it("a link in the peek opens the next record in the peek", async () => {
    setup();
    render(<DealRecord id="dl1" layout="peek" />);
    await settle();
    await click(screen.getByRole("button", { name: d.openBrand("Codewell") }));
    expect(appStore().getState().ui.peek?.record).toEqual({ kind: "brand", id: "br1" });
  });
});
