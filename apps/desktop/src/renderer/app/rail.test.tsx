// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initPrefs, setPref } from "../lib/prefs";
import { stubFindBridge } from "../lib/find-test-bridge";
import { exampleData } from "../lib/example-data";
import { appStore, go, initAppStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { App } from "./app";
import { Rail } from "./rail";

/** Expanded, the account button is named by its text: the name (or "Add your name") and the role. */
const accountName = new RegExp(strings.rail.roleOnline("Owner"));

beforeEach(() => {
  stubFindBridge();
  localStorage.clear();
  initPrefs();
  resetAppStoreForTests({ screen: "today", tab: null });
});

afterEach(cleanup);

const rail = () => screen.getByRole("navigation", { name: strings.rail.label });
const item = (name: string) => within(rail()).getByRole("button", { name: new RegExp(`^${name}`) });
const crumbs = () => screen.getByRole("navigation", { name: strings.top.crumbs });

describe("the rail", () => {
  it("marks Today as the current screen", () => {
    render(<App />);
    expect(item(strings.screens.today.name).getAttribute("aria-current")).toBe("page");
    expect(item(strings.screens.find.name).getAttribute("aria-current")).toBeNull();
  });

  it("shows the counts and the planned time", () => {
    render(<App />);
    const counts: [string, string][] = [
      [strings.screens.today.name, "28"],
      [strings.screens.find.name, "15"],
      [strings.screens.reach.name, "10"],
      [strings.screens.close.name, "6"],
      [strings.screens.deliver.name, "7"],
    ];
    for (const [name, count] of counts) {
      expect(within(item(name)).getByText(count)).toBeTruthy();
    }
    expect(
      within(rail()).getByText(strings.rail.planned(strings.time.hoursMinutes(1, 30))),
    ).toBeTruthy();
  });

  it("opens Find when Find is clicked", async () => {
    render(<App />);
    await userEvent.click(item(strings.screens.find.name));
    expect(screen.getByRole("heading", { level: 1, name: strings.screens.find.name })).toBeTruthy();
    expect(within(crumbs()).getByText(strings.screens.find.name)).toBeTruthy();
    expect(within(crumbs()).getByText(strings.screens.find.tabs.search)).toBeTruthy();
  });

  it("remembers the last tab of each screen", async () => {
    render(<App />);
    act(() => {
      go("find", "triage");
    });
    act(() => {
      go("today");
    });
    await userEvent.click(item(strings.screens.find.name));
    expect(within(crumbs()).getByText(strings.screens.find.tabs.triage)).toBeTruthy();
  });

  it("asks for your name while none is set, and the account button opens a menu whose first row opens Settings > Profile", async () => {
    render(<App />);
    const account = screen.getByRole("button", { name: accountName });
    expect(within(account).getByText(strings.rail.addName)).toBeTruthy();
    expect(within(account).getByText(strings.rail.roleOnline("Owner"))).toBeTruthy();
    await userEvent.click(account);
    await userEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: new RegExp(strings.rail.addName),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: strings.screens.settings.name }),
    ).toBeTruthy();
    expect(within(crumbs()).getByText(strings.screens.settings.tabs.profile)).toBeTruthy();
  });

  it("shows the name once it is set", () => {
    render(<App />);
    act(() => {
      appStore().act("Set name", (d) => {
        d.myName = "Maya";
      });
    });
    const account = screen.getByRole("button", { name: accountName });
    expect(within(account).getByText("Maya")).toBeTruthy();
    expect(within(account).queryByText(strings.rail.addName)).toBeNull();
  });
});

describe("the collapsed rail", () => {
  it('names the account button "Your account: …" because its text is hidden', () => {
    setPref("rail", "min");
    render(<App />);
    expect(screen.getByRole("button", { name: strings.rail.account("You") })).toBeTruthy();
  });

  it("still names every screen's button, though its text is hidden", () => {
    setPref("rail", "min");
    render(<App />);
    for (const key of ["today", "find", "reach", "close", "deliver"] as const) {
      const name = strings.screens[key].name;
      expect(within(rail()).getByRole("button", { name }).getAttribute("aria-label")).toBe(name);
    }
  });
});

describe("the rail's slices", () => {
  it("re-renders for a route change but not for a change it does not show", () => {
    let renders = 0;
    render(
      <Profiler
        id="rail"
        onRender={() => {
          renders += 1;
        }}
      >
        <Rail />
      </Profiler>,
    );
    const first = renders;
    expect(first).toBeGreaterThan(0);

    act(() => {
      appStore().ui((d) => {
        d.saving = true;
      });
    });
    expect(renders).toBe(first);

    act(() => {
      go("find");
    });
    expect(renders).toBeGreaterThan(first);
  });
});

describe("the live gate", () => {
  it("lists only Find, Reach, Close, Insights, Toolbox and Settings access on live data", () => {
    initAppStore({ ...exampleData(Date.now()), source: "live" }, { screen: "find", tab: "search" });
    render(<Rail />);
    expect(within(rail()).getByRole("button", { name: /^Find/ })).toBeTruthy();
    expect(within(rail()).getByRole("button", { name: /^Reach/ })).toBeTruthy();
    expect(within(rail()).getByRole("button", { name: /^Close/ })).toBeTruthy();
    for (const name of ["Today", "Deliver", "Team"]) {
      expect(within(rail()).queryByRole("button", { name: new RegExp(`^${name}`) })).toBeNull();
    }
  });

  it("names only what is wired under Find on live data, and all of it on example data", () => {
    initAppStore({ ...exampleData(Date.now()), source: "live" }, { screen: "find", tab: "search" });
    render(<Rail />);
    expect(
      within(item(strings.screens.find.name)).getByText(strings.screens.find.subLive),
    ).toBeTruthy();
    cleanup();
    initAppStore(exampleData(Date.now()), { screen: "find", tab: "search" });
    render(<Rail />);
    expect(
      within(item(strings.screens.find.name)).getByText(strings.screens.find.sub),
    ).toBeTruthy();
  });
});
