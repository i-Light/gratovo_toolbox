// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adoptServerData } from "../lib/persist";
import { stubReachBridge } from "../lib/reach-test-bridge";
import { resetAppStoreForTests } from "../lib/store";
import { aiCreator } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { CloseScreen } from "./close-screen";
import { passingKit } from "./close-fixtures";

const t = strings.closeScreen;

function seed(source: "example" | "live", tab: string): void {
  resetAppStoreForTests({ screen: "close", tab });
  adoptServerData((d) => {
    d.source = source;
    d.creators = [
      aiCreator("c3", "Tensor Talk", { stage: "kit", kit: passingKit() }),
      aiCreator("c4", "Agent Weekly", { stage: "audience", kit: passingKit() }),
    ] as typeof d.creators;
  });
}

beforeEach(() => {
  stubReachBridge({
    "find:query": { version: 1, total: 0, items: [], facets: {} },
  });
});
afterEach(cleanup);

describe("the Close screen", () => {
  it("shows only the Roster in live mode, without a tab bar", () => {
    seed("live", "roster");
    render(<CloseScreen />);
    expect(screen.getByRole("heading", { name: t.title })).toBeTruthy();
    expect(screen.getByText(t.sub)).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(document.querySelector("[data-ui='close.panel']")).toBeTruthy();
    expect(screen.getByText(t.roster.kitsTitle)).toBeTruthy();
  });

  it("sends a live tab that is not built to the stand-in screen", () => {
    seed("live", "brands");
    render(<CloseScreen />);
    expect(document.querySelector("[data-ui='close.panel']")).toBeNull();
    expect(document.querySelector("[data-ui='close.placeholder']")).toBeTruthy();
  });

  it("shows every tab on example data, with the waiting count on Roster", () => {
    seed("example", "roster");
    render(<CloseScreen />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${strings.screens.close.tabs.roster}2`,
      strings.screens.close.tabs.brands,
      strings.screens.close.tabs.match,
      strings.screens.close.tabs.pitch,
      strings.screens.close.tabs.negotiate,
      strings.screens.close.tabs.contracts,
    ]);
  });

  it("keeps the stand-in body for an unbuilt tab on example data", () => {
    seed("example", "brands");
    render(<CloseScreen />);
    expect(screen.getByText(strings.placeholder.body)).toBeTruthy();
    expect(screen.queryByText(t.roster.kitsTitle)).toBeNull();
  });
});
