// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFindForTests } from "../lib/find";
import { keyStack } from "../lib/keys";
import { stubToolboxBridge, toolboxItem } from "../lib/toolbox-test-bridge";
import { appStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { ToolboxScreen } from "./toolbox-screen";

const t = strings.toolbox;
const tabs = strings.screens.toolbox.tabs;

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
async function show(): Promise<void> {
  render(<ToolboxScreen />);
  await settle();
}
const route = () => selectRoute(appStore().getState());
const press = (key: string, typing = false): boolean =>
  keyStack.dispatch(new KeyboardEvent("keydown", { key, cancelable: true }), {
    typing,
    lettersOff: false,
  });

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "toolbox", tab: "archive" });
});
afterEach(cleanup);

describe("Toolbox", () => {
  it("lists the three tools in two groups with their counts", async () => {
    stubToolboxBridge({
      archive: [toolboxItem("UC-a", "Agent Lab", Date.now() + 3 * 86_400_000)],
      counts: { archive: 4, never: 2, archived: 9, logToday: 11 },
    });
    await show();
    const nav = within(screen.getByRole("navigation", { name: t.navLabel }));
    expect(nav.getByText(t.groups.tools)).toBeTruthy();
    expect(nav.getByText(t.groups.history)).toBeTruthy();
    const archive = nav.getByRole("button", { name: new RegExp(tabs.archive) });
    expect(archive.getAttribute("aria-current")).toBe("page");
    expect(within(archive).getByText("4")).toBeTruthy();
    expect(
      within(nav.getByRole("button", { name: new RegExp(tabs.never) })).getByText("2"),
    ).toBeTruthy();
    const log = nav.getByRole("button", { name: new RegExp(tabs.log) });
    expect(within(log).getByText("11").getAttribute("data-tip")).toBe(t.countTips.log);
    // The open tool's pane: its name, long words and the tool.
    expect(screen.getByRole("heading", { name: tabs.archive, level: 2 })).toBeTruthy();
    expect(screen.getByText(t.tools.archive.long)).toBeTruthy();
  });

  it("opens a tool by its row, and J and K step through the tools", async () => {
    stubToolboxBridge();
    await show();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(tabs.log) }));
      await Promise.resolve();
    });
    expect(route()).toMatchObject({ screen: "toolbox", tab: "log" });
    await act(async () => {
      expect(press("k")).toBe(true);
      await Promise.resolve();
    });
    expect(route().tab).toBe("never");
    await act(async () => {
      press("k");
      await Promise.resolve();
    });
    expect(route().tab).toBe("archive");
    // Nothing before the first, nothing after the last.
    await act(async () => {
      press("k");
      await Promise.resolve();
    });
    expect(route().tab).toBe("archive");
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        press("j");
        await Promise.resolve();
      });
    }
    expect(route().tab).toBe("log");
  });

  it("leaves the letters alone while typing", async () => {
    stubToolboxBridge();
    await show();
    expect(press("j", true)).toBe(false);
    expect(route().tab).toBe("archive");
  });

  it("reads the counts again when the catalog is rebuilt", async () => {
    const bridge = stubToolboxBridge();
    await show();
    const before = bridge.calls.filter(([c]) => c === "toolbox:counts").length;
    await act(async () => {
      bridge.emit("find:catalog");
      await Promise.resolve();
    });
    expect(bridge.calls.filter(([c]) => c === "toolbox:counts").length).toBe(before + 1);
  });
});
