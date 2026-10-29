// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adoptServerData } from "../lib/persist";
import { resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { InsightsScreen } from "./insights-screen";
import { Panel } from "./panel";
import { DifferenceTag, VerdictDot, VerdictTag } from "./verdict";

const t = strings.insights;

function seed(source: "example" | "live", tab = "overview"): void {
  resetAppStoreForTests({ screen: "insights", tab });
  adoptServerData((d) => {
    d.source = source;
  });
}

beforeEach(() => {
  seed("example");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Insights screen", () => {
  it("shows the title, the tabs and the period switch, and moves between tabs", () => {
    const onPeriod = vi.fn();
    render(<InsightsScreen period="30d" onPeriod={onPeriod} onCopySummary={() => undefined} />);
    expect(screen.getByRole("heading", { name: t.title })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual([
      "Overview",
      "Funnel",
      "Emails",
      "Search",
      "Money",
      "Goal",
    ]);
    expect(
      screen.getByRole("button", { name: t.periods["30d"] }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: t.periods["7d"] }));
    expect(onPeriod).toHaveBeenCalledWith("7d");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Funnel" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows the money stand-in and does not throw on Copy summary", () => {
    seed("example", "money");
    const copy = vi.fn();
    render(<InsightsScreen period="7d" onPeriod={() => undefined} onCopySummary={copy} />);
    expect(screen.getByText(t.moneyComes)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.copySummary }));
    expect(copy).toHaveBeenCalledOnce();
  });
});

describe("Panel", () => {
  const numbers = { columns: ["Week", "Sent"], rows: [["1, first", 4]] };

  it("swaps the chart for a table and copies it as CSV", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    render(
      <Panel headline="Sent" counted="4 emails" numbers={numbers} dataUi="insights.test">
        <p>the chart</p>
      </Panel>,
    );
    expect(screen.getByText("the chart")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.numbers }));
    expect(screen.queryByText("the chart")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.copyCsv }));
    expect(write).toHaveBeenCalledWith('Week,Sent\r\n"1, first",4');
    fireEvent.click(screen.getByRole("button", { name: t.hideNumbers }));
    expect(screen.getByText("the chart")).toBeTruthy();
  });

  it("toggles What is this?", () => {
    render(<Panel headline="Sent" counted="4 emails" what="Emails sent." dataUi="insights.test" />);
    expect(screen.queryByText("Emails sent.")).toBeNull();
    const button = screen.getByRole("button", { name: t.whatIsThis });
    fireEvent.click(button);
    expect(screen.getByText("Emails sent.")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByText("Emails sent.")).toBeNull();
  });
});

describe("verdict tags", () => {
  it("write the word and draw an icon or dot", () => {
    const { container } = render(
      <>
        <VerdictTag verdict="good" />
        <VerdictTag verdict="act" />
        <VerdictDot verdict="watch" />
        <DifferenceTag difference="chance" />
      </>,
    );
    expect(screen.getByText(t.verdict.good)).toBeTruthy();
    expect(screen.getByText(t.verdict.act)).toBeTruthy();
    expect(screen.getByText(t.verdict.watch)).toBeTruthy();
    expect(screen.getByText(t.difference.chance)).toBeTruthy();
    expect(container.querySelectorAll("svg").length).toBe(3);
    expect(container.querySelectorAll(".dot i").length).toBe(1);
  });
});
