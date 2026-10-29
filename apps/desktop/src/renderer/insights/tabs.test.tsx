// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { EmailsTab } from "./emails-tab";
import { FunnelTab } from "./funnel-tab";
import { OverviewTab } from "./overview-tab";
import {
  emailsReport,
  emptyEmails,
  emptyFunnel,
  emptyOverview,
  fullAlerts,
  funnelReport,
  overviewReport,
} from "./test-reports";

const t = strings.insights;

afterEach(cleanup);

function overview(report = overviewReport) {
  const onGo = vi.fn();
  const onDrill = vi.fn();
  const onHide = vi.fn();
  render(
    <OverviewTab report={report} onGo={onGo} onDrill={onDrill} onHide={onHide} seesMoney={false} />,
  );
  return { onGo, onDrill, onHide };
}

describe("OverviewTab", () => {
  it("shows the summary, the five tiles, the alerts, the wins and the pipeline", () => {
    overview();
    expect(screen.getByLabelText(t.overview.summary.label).textContent).toContain("182 emails");
    expect(screen.getByLabelText(t.overview.summary.label).textContent).toContain("on pace");
    const tiles = screen.getByLabelText(t.overview.vitals.label);
    for (const label of [
      t.overview.vitals.emails.label,
      t.overview.vitals.replyRate.label,
      t.overview.vitals.signed.label,
      t.overview.vitals.fuel.label,
      t.overview.vitals.waiting.label,
    ]) {
      expect(within(tiles).getByText(label)).toBeTruthy();
    }
    expect(within(tiles).getByText("4.9%")).toBeTruthy();
    expect(screen.getByText("outreach3@gratovo.co is bouncing")).toBeTruthy();
    expect(screen.getByText(/3 of 61/)).toBeTruthy();
    expect(screen.getByText(t.overview.wins.edited.title)).toBeTruthy();
    expect(screen.getByRole("list", { name: t.overview.pipeline.label })).toBeTruthy();
    expect(screen.getByText("24 stuck")).toBeTruthy();
  });

  it("shows at most 6 alerts and the rest on Show all", () => {
    overview();
    expect(document.querySelectorAll("[data-ui='insights.overview.alert']")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: t.overview.attention.showAll("8") }));
    expect(document.querySelectorAll("[data-ui='insights.overview.alert']")).toHaveLength(8);
    expect(screen.getByRole("button", { name: t.overview.attention.showLess })).toBeTruthy();
  });

  it("sends an alert's own button to onGo and Hide with its key", () => {
    const { onGo, onHide } = overview();
    const first = document.querySelector("[data-ui='insights.overview.alert']");
    if (first === null) throw new Error("no alert");
    fireEvent.click(
      within(first as HTMLElement).getByText(t.overview.alerts.mailboxBounces.action),
    );
    expect(onGo).toHaveBeenCalledWith(fullAlerts[0]?.go);
    fireEvent.click(
      within(first as HTMLElement).getByRole("button", {
        name: t.overview.attention.hideLabel("outreach3@gratovo.co is bouncing"),
      }),
    );
    expect(onHide).toHaveBeenCalledWith("mailboxBounces:outreach3@gratovo.co");
  });

  it("opens the Funnel from a pipeline step and from the footer button", () => {
    const { onGo } = overview();
    fireEvent.click(screen.getByRole("button", { name: /Replied/ }));
    expect(onGo).toHaveBeenCalledWith({ kind: "insights", tab: "funnel", view: null });
    fireEvent.click(screen.getByRole("button", { name: t.overview.pipeline.open }));
    expect(onGo).toHaveBeenCalledTimes(2);
  });

  it("names the biggest drop under the pipeline", () => {
    overview();
    expect(
      screen.getByText(/the biggest drop is from Emailed to Replied: 1,106 of 1,202/),
    ).toBeTruthy();
  });

  it("opens the replies waiting from its tile", () => {
    const { onDrill } = overview();
    fireEvent.click(screen.getByRole("button", { name: t.overview.vitals.waiting.open("4") }));
    expect(onDrill).toHaveBeenCalledWith({ kind: "repliesWaiting" });
  });

  it("explains a tile with What is this?", () => {
    overview();
    const tile = document.querySelector("[data-ui='insights.overview.vital.fuel']");
    if (tile === null) throw new Error("no tile");
    fireEvent.click(
      within(tile as HTMLElement).getByRole("button", {
        name: `${t.whatIsThis} ${t.overview.vitals.fuel.label}`,
      }),
    );
    expect(within(tile as HTMLElement).getByText(t.overview.vitals.fuel.what)).toBeTruthy();
  });

  it("shows the empty state when there is nothing yet", () => {
    overview(emptyOverview);
    expect(screen.getByText(t.overview.empty.title)).toBeTruthy();
    expect(screen.queryByLabelText(t.overview.vitals.label)).toBeNull();
  });

  it("shows the numbers of the attention panel as a table", () => {
    overview();
    const panel = document.querySelector("[data-ui='insights.overview.attention']");
    if (panel === null) throw new Error("no panel");
    fireEvent.click(within(panel as HTMLElement).getByRole("button", { name: t.numbers }));
    expect(within(panel as HTMLElement).getAllByRole("row")).toHaveLength(1 + 8);
  });
});

describe("FunnelTab", () => {
  function funnel(showBrands = false, report = funnelReport) {
    const onGo = vi.fn();
    const onDrill = vi.fn();
    render(<FunnelTab report={report} onGo={onGo} onDrill={onDrill} showBrands={showBrands} />);
    return { onGo, onDrill };
  }

  it("shows the table, the exits, the days and the cohorts, with cohorts folded", () => {
    funnel();
    const table = screen.getByRole("table", { name: t.funnel.table.label });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 10);
    expect(within(table).getByText(t.funnel.table.byDesign)).toBeTruthy();
    expect(within(table).getByText(t.funnel.table.biggest)).toBeTruthy();
    expect(screen.getByText(/1,020 never answered/)).toBeTruthy();
    expect(screen.getByText(t.funnel.cohorts.show)).toBeTruthy();
    expect(screen.queryByText(t.funnel.cohorts.corner)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.funnel.cohorts.show }));
    expect(screen.getByText(t.funnel.cohorts.corner)).toBeTruthy();
  });

  it("opens a step's creators from its row, and the stuck ones from the stuck number", () => {
    const { onDrill } = funnel();
    const row = document.querySelector("[data-ui='insights.funnel.row.emailed']");
    if (row === null) throw new Error("no row");
    fireEvent.click(row);
    expect(onDrill).toHaveBeenCalledWith({ kind: "step", step: "emailed" });
    const confirmed = document.querySelector("[data-ui='insights.funnel.row.confirmed']");
    fireEvent.click(
      within(confirmed as HTMLElement).getByRole("button", {
        name: t.funnel.table.stuckOpen("24", "Address confirmed"),
      }),
    );
    expect(onDrill).toHaveBeenLastCalledWith({ kind: "stuck", step: "confirmed" });
    expect(onDrill).toHaveBeenCalledTimes(2);
  });

  it("switches to those emailed in this period", () => {
    funnel();
    fireEvent.click(screen.getByRole("button", { name: t.funnel.cohort }));
    expect(screen.getByText(t.funnel.headline.countedCohort)).toBeTruthy();
  });

  it("shows Brands only when asked, with a note that they come with deals", () => {
    funnel(false);
    expect(screen.queryByRole("button", { name: t.funnel.brands })).toBeNull();
    cleanup();
    funnel(true);
    fireEvent.click(screen.getByRole("button", { name: t.funnel.brands }));
    expect(screen.getByText(t.funnel.brandsComes)).toBeTruthy();
  });

  it("gives each exit its own list", () => {
    funnel();
    expect(document.querySelectorAll("[data-ui^='insights.funnel.exit.']")).toHaveLength(3);
  });

  it("shows the empty state from an empty report", () => {
    funnel(false, emptyFunnel);
    expect(screen.getByText(t.funnel.empty.title)).toBeTruthy();
  });
});

describe("EmailsTab", () => {
  function emails(report = emailsReport) {
    const onGo = vi.fn();
    render(<EmailsTab report={report} onGo={onGo} />);
    return { onGo };
  }

  it("shows the hero, two charts and every panel", () => {
    emails();
    expect(screen.getByText("726 emails in 30 days brought 35 replies, 4.8%.")).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /per day/ })).toHaveLength(2);
    for (const ui of ["steps", "readings", "batches", "patterns", "answer", "mailboxes"]) {
      expect(document.querySelector(`[data-ui='insights.emails.${ui}']`)).not.toBeNull();
    }
  });

  it("words the batches and names the mailbox that bounces", () => {
    emails();
    expect(
      screen.getByText("Batch #22 has a delivery problem, batch #21 a writing problem."),
    ).toBeTruthy();
    expect(screen.getAllByText(/mostly from outreach3@gratovo.co/).length).toBeGreaterThan(0);
  });

  it("marks a clear pattern and says Try this", () => {
    emails();
    expect(screen.getAllByText(t.difference.clear).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Try this:/).length).toBeGreaterThan(0);
  });

  it("splits the replies into a way forward and not now or no", () => {
    emails();
    expect(screen.getByText("62% of replies are a way forward.")).toBeTruthy();
  });

  it("opens Mailboxes from the room table", () => {
    const { onGo } = emails();
    const panel = document.querySelector("[data-ui='insights.emails.mailboxes']");
    fireEvent.click(
      within(panel as HTMLElement).getByRole("button", { name: t.emails.mailboxes.open }),
    );
    expect(onGo).toHaveBeenCalledWith({ kind: "route", screen: "reach", tab: "mailboxes" });
  });

  it("shows each mailbox's verdict, room used and the All row", () => {
    emails();
    const panel = document.querySelector("[data-ui='insights.emails.mailboxes']") as HTMLElement;
    expect(within(panel).getByText(t.emails.mailboxes.all)).toBeTruthy();
    expect(within(panel).getAllByRole("img", { name: /of room used/ })).toHaveLength(3);
    expect(within(panel).getByText(t.verdict.act)).toBeTruthy();
  });

  it("shows the empty state from an empty report", () => {
    emails(emptyEmails);
    expect(screen.getByText(t.emails.empty.title)).toBeTruthy();
  });
});
