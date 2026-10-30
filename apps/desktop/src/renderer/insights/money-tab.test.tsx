// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAL_FLOW } from "@gratovo/core";

import { adoptServerData } from "../lib/persist";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { GoalTab } from "./goal-tab";
import { InsightsScreen } from "./insights-screen";
import { MoneyTab } from "./money-tab";
import { OverviewTab } from "./overview-tab";
import { overviewReport } from "./test-reports";
import {
  emptyMoney,
  moneyAlertLines,
  moneyGoalReport,
  moneyOverview,
  moneyReport,
  names,
} from "./test-reports-money";
import { goalReport } from "./test-reports-search";
import { payDaysSentence } from "./words/money";
import { namesFrom } from "./words/names";
import { alertWords } from "./words/overview";

const t = strings.insights;
const m = t.money;

afterEach(cleanup);

function money(report = moneyReport) {
  const onGo = vi.fn();
  const onDrill = vi.fn();
  const onOpen = vi.fn();
  render(<MoneyTab report={report} names={names} onGo={onGo} onDrill={onDrill} onOpen={onOpen} />);
  return { onGo, onDrill, onOpen };
}

describe("MoneyTab", () => {
  it("shows the mockup's headings from a report", () => {
    money();
    for (const heading of [
      "October is on pace for $21,100, under the $25,000 goal.",
      "$7,300 is late. $4,200 of it is over 30 days.",
      "$1,860 is due to LLM Lab now.",
      "We keep 40% on average.",
      "Deals are getting bigger.",
      "46% comes from one brand.",
      "Cyber Sage earns most. Byte Sized AI has had no deal in 74 days.",
      `2 deals are stuck in ${DEAL_FLOW[3]?.name ?? ""}.`,
      "4 of 9 brands came back.",
    ]) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.getByText(m.lockNote)).toBeTruthy();
    expect(screen.getByText("goal $25K (net $10K at 40%)")).toBeTruthy();
    expect(screen.getByText(t.verdict.act)).toBeTruthy();
    expect(document.querySelectorAll("[data-month]")).toHaveLength(6);
    expect(document.querySelectorAll("[data-projected]")).toHaveLength(1);
  });

  it("lists the late invoices and opens the deal", () => {
    const { onOpen } = money();
    fireEvent.click(screen.getByRole("button", { name: "Open VoxNote × Cyber Sage" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "deal", id: "d1" });
    expect(screen.getByText("VoxNote × Cyber Sage · 34 days late")).toBeTruthy();
  });

  it("says how brands usually pay", () => {
    money();
    expect(
      screen.getByText(
        "Brands usually pay in: Tensorly 28 days, Draftly AI 21. VoxNote hasn’t paid at all yet.",
      ),
    ).toBeTruthy();
  });

  it("names at most four brands in the pay-in sentence, the rest as 'and N more'", () => {
    const payDays = Array.from({ length: 6 }, (_, i) => ({
      brandId: `x${String(i)}`,
      days: 20 + i,
      unpaid: false,
    }));
    const report = { ...moneyReport, owed: { ...moneyReport.owed, payDays } };
    expect(payDaysSentence(report, names)).toBe(
      "Brands usually pay in: A brand 20 days, A brand 21, A brand 22, A brand 23, and 2 more.",
    );
  });

  it("names creators and brands from the report first, then the frame", () => {
    const named = namesFrom({ brands: [], creators: [], deals: [] }, 0, {
      c9: "Nova Prompts",
      b9: "Chatwell",
    });
    expect(named.creator("c9")).toBe("Nova Prompts");
    expect(named.brand("b9")).toBe("Chatwell");
    expect(named.creator("zz")).toBe("A creator");
  });

  it("says 1 day, not 1 days", () => {
    expect(strings.insights.overview.fmt.daysLong("1")).toBe("1 day");
    expect(strings.insights.overview.fmt.daysLong("2")).toBe("2 days");
  });

  it("sends Pay to Deliver and Pitch them to Close", () => {
    const { onGo } = money();
    fireEvent.click(screen.getByRole("button", { name: m.payouts.pay("LLM Lab") }));
    expect(onGo).toHaveBeenLastCalledWith({ kind: "route", screen: "deliver", tab: "money" });
    fireEvent.click(screen.getByRole("button", { name: m.roster.pitchLabel("Byte Sized AI") }));
    expect(onGo).toHaveBeenLastCalledWith({ kind: "route", screen: "close", tab: "pitch" });
    fireEvent.click(screen.getByRole("button", { name: m.repeat.propose }));
    expect(onGo).toHaveBeenLastCalledWith({ kind: "route", screen: "deliver", tab: "board" });
  });

  it("opens drills for the numbers with lists", () => {
    const { onDrill } = money();
    fireEvent.click(screen.getByRole("button", { name: m.owed.open("2") }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "lateInvoices" });
    fireEvent.click(screen.getByRole("button", { name: m.margin.open("1") }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "underFloor" });
    fireEvent.click(screen.getByRole("button", { name: m.steps.open("2") }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "stuckDeals", step: null });
    fireEvent.click(screen.getByRole("button", { name: m.repeat.open("2") }));
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "noNextDeal" });
  });

  it("opens a creator from the roster", () => {
    const { onOpen } = money();
    const table = screen.getByRole("table", { name: m.roster.label });
    fireEvent.click(within(table).getByRole("button", { name: m.roster.open("Cyber Sage") }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "creator", id: "c1" });
    expect(within(table).getByText("124%")).toBeTruthy();
  });

  it("shows the top 10 of a long roster and every idle creator, the rest on Show all", () => {
    const base = moneyReport.roster[0];
    if (base === undefined) throw new Error("fixture has a roster");
    const roster = Array.from({ length: 14 }, (_, i) => ({
      ...base,
      creatorId: `r${String(i)}`,
      idle: i === 12,
    }));
    money({ ...moneyReport, roster });
    const rows = () => document.querySelectorAll('[data-ui="insights.money.creator"]');
    expect(rows()).toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: m.roster.showAll("14") }));
    expect(rows()).toHaveLength(14);
    fireEvent.click(screen.getByRole("button", { name: m.roster.showLess }));
    expect(rows()).toHaveLength(11);
  });

  it("names every stuck deal and the step with the most", () => {
    const [first] = moneyReport.stuckDeals;
    if (first === undefined) throw new Error("fixture has stuck deals");
    money({
      ...moneyReport,
      stuckDeals: [...moneyReport.stuckDeals, { ...first, dealId: "x", step: 8 }],
    });
    const n = String(moneyReport.stuckDeals.length + 1);
    expect(
      screen.getByText(`${n} deals are stuck, 2 of them in ${DEAL_FLOW[3]?.name ?? ""}.`),
    ).toBeTruthy();
  });

  it("shows the revenue as a table with a CSV copy", () => {
    money();
    const panel = document.querySelector("[data-ui='insights.money.revenue']") as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: t.numbers }));
    expect(within(panel).getByText("$9,800")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: t.copyCsv })).toBeTruthy();
  });

  it("has an empty state before the first paid invoice", () => {
    money(emptyMoney);
    expect(screen.getByText(m.empty.body)).toBeTruthy();
    expect(document.querySelector("[data-ui='insights.money.revenue']")).toBeNull();
  });
});

describe("the Money tab's visibility", () => {
  beforeEach(() => {
    resetAppStoreForTests({ screen: "insights", tab: "overview" });
  });

  const screenFor = (seesMoney: boolean): string[] => {
    adoptServerData((d) => {
      d.source = "example";
      d.seesMoney = seesMoney;
    });
    render(
      <InsightsScreen period="30d" onPeriod={() => undefined} onCopySummary={() => undefined} />,
    );
    return screen.getAllByRole("tab").map((x) => x.textContent);
  };

  it("is a tab for a money viewer", () => {
    expect(screenFor(true)).toContain("Money");
  });

  it("is not there at all for everyone else", () => {
    expect(screenFor(false)).toEqual(["Overview", "Funnel", "Emails", "Search", "Goal"]);
  });
});

describe("the Overview's revenue tile", () => {
  function overview(seesMoney: boolean, report = moneyOverview) {
    const onGo = vi.fn();
    render(
      <OverviewTab
        report={report}
        onGo={onGo}
        onDrill={() => undefined}
        onHide={() => undefined}
        seesMoney={seesMoney}
        showDeals
        names={names}
      />,
    );
    return { onGo };
  }

  it("takes the place of the replies tile for a money viewer", () => {
    const { onGo } = overview(true);
    const tiles = screen.getByLabelText(t.overview.vitals.label);
    expect(within(tiles).getByText("Paid by brands, October")).toBeTruthy();
    expect(within(tiles).getByText("$7,360")).toBeTruthy();
    expect(within(tiles).queryByText(t.overview.vitals.waiting.label)).toBeNull();
    fireEvent.click(within(tiles).getByRole("button", { name: t.overview.revenue.open }));
    expect(onGo).toHaveBeenCalledWith({ kind: "insights", tab: "money", view: null });
  });

  it("is left out for everyone else", () => {
    overview(false, overviewReport);
    const tiles = screen.getByLabelText(t.overview.vitals.label);
    expect(within(tiles).getByText(t.overview.vitals.waiting.label)).toBeTruthy();
    expect(within(tiles).queryByText(/Paid by brands/)).toBeNull();
  });

  it("runs the pipeline on to Paid", () => {
    overview(true);
    expect(screen.getByText("Of 162,400 channels found, 9 creators have been paid.")).toBeTruthy();
  });
});

describe("the money alerts", () => {
  it("are worded with names, numbers and a button", () => {
    const words = moneyAlertLines.map((l) => alertWords(l.alert, names));
    expect(words[0]?.title).toBe("VoxNote × Cyber Sage: the invoice is 34 days late");
    expect(words[0]?.evidence).toBe("$4,200 unpaid, past its due date (Net 30).");
    expect(words[1]?.title).toBe("Pay the creator $1,860 for Tensorly × LLM Lab");
    expect(words[2]?.title).toContain("is stuck in");
    expect(words[3]?.evidence).toBe("On pace for $21,100, against $25,000 as brand payments.");
    expect(words[4]?.title).toBe("Draftly AI brings most of your revenue");
    expect(words[5]?.title).toBe("Byte Sized AI has had no deal in 74 days");
    expect(words[6]?.evidence).toBe("Kept 22%, against your floor of 25%.");
    for (const w of words) {
      expect(w.action).not.toBe("");
      expect(w.why).not.toBe("");
    }
  });
});

describe("the Goal's money goal", () => {
  const label = new RegExp(t.goal.money.inputLabel);

  function goal(showMoney: boolean, report = moneyGoalReport()) {
    const onGoal = vi.fn();
    render(
      <GoalTab report={report} onGoal={onGoal} onGo={() => undefined} showMoney={showMoney} />,
    );
    return { onGoal };
  }

  it("shows the field and the money lines to a money viewer", () => {
    goal(true);
    expect(screen.getByText("Your goal: $10,000 net a month.")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: label })).toBeTruthy();
    const chain = screen.getByRole("table", { name: t.goal.chain.aria });
    expect(within(chain).getByText(t.goal.chain.steps.bookings)).toBeTruthy();
    expect(within(chain).getByText("$25,000")).toBeTruthy();
    expect(within(chain).getByText(/40% margin/)).toBeTruthy();
    expect(within(chain).getByText(/\$3,100 a deal/)).toBeTruthy();
    expect(within(chain).getByText(/19% win/)).toBeTruthy();
    expect(screen.getByText(t.goal.levers.dealSize)).toBeTruthy();
  });

  it("saves the money goal on Enter and clears it when emptied", () => {
    const { onGoal } = goal(true);
    const input = screen.getByRole("spinbutton", { name: label });
    fireEvent.change(input, { target: { value: "12000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGoal).toHaveBeenLastCalledWith({ revenuePerMonth: 12000 });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onGoal).toHaveBeenLastCalledWith({ revenuePerMonth: null });
  });

  it("refuses a goal outside the limits", () => {
    const { onGoal } = goal(true);
    const input = screen.getByRole("spinbutton", { name: label });
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    expect(onGoal).not.toHaveBeenCalled();
  });

  it("shows exactly the creators goal to everyone else", () => {
    goal(false, goalReport());
    expect(screen.getByText("Your goal: sign 4 creators a month.")).toBeTruthy();
    expect(document.querySelector("[data-ui='goal.revenue']")).toBeNull();
    expect(screen.queryByText(t.goal.chain.steps.bookings)).toBeNull();
  });
});

describe("a month too young for its pace (the early month)", () => {
  const last = moneyReport.months.length - 1;
  const early: typeof moneyReport = {
    ...moneyReport,
    months: moneyReport.months.map((x, i) =>
      i === last ? { ...x, paid: 3000, projected: null } : x,
    ),
    paceVerdict: "early",
  };

  it("says what is paid so far on Money, with no pace claim and no projected outline", () => {
    money(early);
    expect(screen.getByText("October so far: $3,000 paid.")).toBeTruthy();
    expect(screen.queryByText(/on pace/)).toBeNull();
    expect(document.querySelectorAll("[data-projected]")).toHaveLength(0);
  });

  it("says it is too early on the Overview tile", () => {
    const base = moneyOverview.vitals.revenue;
    if (base === null) throw new Error("the fixture has a revenue tile");
    const report = {
      ...moneyOverview,
      vitals: {
        ...moneyOverview.vitals,
        revenue: { ...base, projected: null, verdict: "early" as const },
      },
    };
    render(
      <OverviewTab
        report={report}
        onGo={() => undefined}
        onDrill={() => undefined}
        onHide={() => undefined}
        seesMoney
        showDeals
        names={names}
      />,
    );
    const tiles = screen.getByLabelText(t.overview.vitals.label);
    expect(within(tiles).getByText(t.overview.revenue.tooEarly)).toBeTruthy();
    expect(within(tiles).queryByText(/At this pace/)).toBeNull();
  });
});

describe("the revenue chart's label", () => {
  it("reads every month's payments in the image's own label", () => {
    money();
    const chart = screen.getByRole("img", { name: new RegExp(t.money.revenue.label) });
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^What brands paid, by month: /);
    expect(label).toContain("$9,800");
    expect(label.endsWith("October $18,400 so far")).toBe(true);
    // A per-bar label on a div inside an image is never read: none is left.
    expect(chart.querySelectorAll("[aria-label]")).toHaveLength(0);
  });
});

describe("an idle creator with no known days", () => {
  it("leaves the number out of the words", () => {
    const words = alertWords({ kind: "idleCreator", creatorId: "c3", days: null }, names);
    expect(words.title).toMatch(/has had no deal for a long while$/);
    expect(words.title).not.toMatch(/\d/);
  });
});

describe("the Goal without money", () => {
  it("leaves out the money lines and the money levers when money is not shown", () => {
    const withMoney = moneyGoalReport();
    expect(withMoney.levers.some((l) => l.kind === "dealSize")).toBe(true);
    render(<GoalTab report={withMoney} onGoal={() => undefined} onGo={() => undefined} />);
    const chain = screen.getByRole("table", { name: t.goal.chain.aria });
    for (const step of ["revenue", "bookings", "deals", "pitches"] as const) {
      expect(within(chain).queryByText(t.goal.chain.steps[step])).toBeNull();
    }
    expect(screen.queryByText(t.goal.levers.dealSize)).toBeNull();
    expect(screen.getByText("Your goal: sign 4 creators a month.")).toBeTruthy();
  });
});
