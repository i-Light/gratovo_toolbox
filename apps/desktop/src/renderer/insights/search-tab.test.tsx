// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchView } from "@gratovo/core/insights";

import { strings } from "../strings";
import { SearchTab } from "./search-tab";
import type { SearchTabProps } from "./search-tab";
import { emptySearchReport, mistake, searchReport } from "./test-reports-search";

const t = strings.insights.search;

afterEach(cleanup);

function setup(view: SearchView, over: Partial<SearchTabProps> = {}) {
  const onRestore = vi.fn<(ids: readonly string[]) => void>();
  const props: SearchTabProps = {
    report: searchReport(),
    view,
    onView: vi.fn(),
    onGo: vi.fn(),
    onDrill: vi.fn(),
    onRestore,
    ...over,
  };
  const out = render(<SearchTab {...props} />);
  const has = (id: string): boolean => out.container.querySelector(`[data-ui="${id}"]`) !== null;
  return { ...props, onRestore, ...out, has };
}

describe("the Search tab views", () => {
  it("Live shows its own panels and no others", () => {
    const s = setup("live");
    for (const id of [
      "search.hero.live",
      "search.live.weekly",
      "search.live.backlog",
      "search.live.keywords",
      "search.live.addresses",
      "search.live.trust",
    ]) {
      expect(s.has(id)).toBe(true);
    }
    expect(s.has("search.waiting.mistakes")).toBe(false);
    expect(s.has("search.archive.weeks")).toBe(false);
    expect(screen.getByText(/2,000 live channels\./)).toBeTruthy();
    expect(screen.getByText("340 wait for your review.")).toBeTruthy();
  });

  it("To be archived shows the mistakes, the reasons and the second looks", () => {
    const s = setup("waiting");
    for (const id of [
      "search.hero.waiting",
      "search.waiting.mistakes",
      "search.waiting.reasons",
      "search.waiting.second",
    ]) {
      expect(s.has(id)).toBe(true);
    }
    expect(s.has("search.live.backlog")).toBe(false);
    expect(s.has("search.archive.search")).toBe(false);
  });

  it("Archive shows the search box, the three charts, re-finds, why and the profile", () => {
    const s = setup("archive");
    for (const id of [
      "search.hero.archive",
      "search.archive.search",
      "search.archive.weeks",
      "search.archive.refind",
      "search.archive.why",
      "search.archive.profile",
    ]) {
      expect(s.has(id)).toBe(true);
    }
    expect(s.has("search.live.keywords")).toBe(false);
    expect(screen.getByText("No person saw 94% of them.")).toBeTruthy();
    // Each chart has its own scale: three separate charts, never one.
    expect(s.container.querySelectorAll("[data-multi]").length).toBe(3);
    // The rules' labels are the app's tags, shown through the map and a readable fallback.
    expect(screen.getAllByText("Not posting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Too big audience").length).toBeGreaterThan(0);
  });

  it("Everything shows the charts, the scorecard and the profile", () => {
    const s = setup("everything");
    for (const id of [
      "search.hero.everything",
      "search.everything.weeks",
      "search.everything.keywords",
      "search.everything.profile",
    ]) {
      expect(s.has(id)).toBe(true);
    }
    expect(s.has("search.live.backlog")).toBe(false);
    expect(screen.getByText("Of 162,400 found, 1 in 81 is live.")).toBeTruthy();
  });

  it("shows not known where a group has no value", () => {
    setup("archive");
    expect(screen.getAllByText(t.profile.notKnown).length).toBeGreaterThan(0);
  });
});

describe("the view switch", () => {
  it("lists four views with their counts and questions, and switches", () => {
    const s = setup("live");
    const group = screen.getByRole("group", { name: t.viewsLabel });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(within(group).getByText("162,400")).toBeTruthy();
    expect(within(group).getByText(t.views.waiting.question)).toBeTruthy();
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(buttons[1] as HTMLElement);
    expect(s.onView).toHaveBeenCalledWith("waiting");
  });
});

describe("actions and drills", () => {
  it("a keyword row opens its channels", () => {
    const s = setup("live");
    fireEvent.click(
      screen.getByRole("button", { name: t.keywords.keywordLabel("local llm setup") }),
    );
    expect(s.onDrill).toHaveBeenCalledWith({ kind: "keyword", keyword: "local llm setup" });
  });

  it("the scorecard shows 6 rows and All N keywords shows every one", () => {
    const s = setup("live");
    const rows = (): number => s.container.querySelectorAll("tr[data-keyword]").length;
    expect(rows()).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: t.keywords.all("8") }));
    expect(rows()).toBe(8);
  });

  it("Review now goes to Review new", () => {
    const s = setup("live");
    fireEvent.click(screen.getByRole("button", { name: t.backlog.review }));
    expect(s.onGo).toHaveBeenCalledWith({ kind: "route", screen: "find", tab: "triage" });
  });

  it("Confirm 24 goes to Contacts", () => {
    const s = setup("live");
    fireEvent.click(screen.getByRole("button", { name: t.addresses.confirm("24") }));
    expect(s.onGo).toHaveBeenCalledWith({ kind: "route", screen: "find", tab: "contacts" });
  });

  it("a trust row opens its unreadable list", () => {
    const s = setup("live");
    fireEvent.click(screen.getByRole("button", { name: t.trust.open(t.trust.rows.gaveUp) }));
    expect(s.onDrill).toHaveBeenCalledWith({ kind: "unreadable", which: "gaveUp" });
  });

  it("Open all opens the mistakes drill", () => {
    const s = setup("waiting");
    fireEvent.click(screen.getByRole("button", { name: t.mistakes.openAll("37") }));
    expect(s.onDrill).toHaveBeenCalledWith({ kind: "mistakes" });
  });

  it("Bring back sends the listed ids, at most 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => mistake(i + 1));
    const report = searchReport();
    const s = setup("waiting", {
      report: {
        ...report,
        waiting: { ...report.waiting, mistakes: { total: 60, tomorrow: 9, top: many } },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: t.mistakes.bringTop("50") }));
    expect(s.onRestore).toHaveBeenCalledTimes(1);
    const ids = s.onRestore.mock.calls[0]?.[0] as readonly string[];
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe("UC-mistake-1");
  });

  it("Bring back all N names every listed channel when they all fit", () => {
    const top = Array.from({ length: 3 }, (_, i) => mistake(i + 1));
    const report = searchReport();
    const s = setup("waiting", {
      report: {
        ...report,
        waiting: { ...report.waiting, mistakes: { total: 3, tomorrow: 1, top } },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: t.mistakes.bringAll("3") }));
    expect(s.onRestore).toHaveBeenCalledWith(top.map((m) => m.id));
  });

  it("a circle in the band opens its channels", () => {
    const s = setup("waiting");
    fireEvent.click(screen.getByRole("button", { name: /^1,000 Tomorrow$/ }));
    expect(s.onDrill).toHaveBeenCalledWith({ kind: "leaving", day: 0 });
  });

  it("the archive search box routes to Toolbox › Archive", () => {
    const s = setup("archive");
    fireEvent.change(screen.getByLabelText(t.archiveSearch.label), { target: { value: "coach" } });
    fireEvent.click(screen.getByRole("button", { name: t.archiveSearch.go }));
    expect(s.onGo).toHaveBeenCalledWith({ kind: "route", screen: "toolbox", tab: "archive" });
  });
});

describe("an empty report", () => {
  it("shows an empty state, not empty cards", () => {
    const s = setup("live", { report: emptySearchReport() });
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(s.container.querySelectorAll(".ins-panel")).toHaveLength(0);
  });

  it("every view still renders when only some parts are empty", () => {
    const base = emptySearchReport();
    const report = { ...base, counts: { live: 5, waiting: 0, archive: 0, everything: 5 } };
    for (const view of ["live", "waiting", "archive", "everything"] as const) {
      const s = setup(view, { report });
      expect(s.container.querySelectorAll(".ins-panel").length).toBeGreaterThan(0);
      cleanup();
    }
  });
});
