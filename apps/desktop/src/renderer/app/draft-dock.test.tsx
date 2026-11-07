// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectDraft, resetDockForTests, useDraftReadyToasts } from "../lib/dock";
import { installPersistence } from "../lib/persist";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { Toasts } from "../overlays/toasts";
import { strings } from "../strings";
import { DraftDock } from "./draft-dock";

const t = strings.dock;
const sam = "sam@gratovo.example";
let uninstall: () => void = () => undefined;

function Host() {
  useDraftReadyToasts();
  return (
    <>
      <DraftDock />
      <Toasts />
    </>
  );
}

function seed(state: "drafting" | "ready"): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab")],
    reachWith({ drafts: [aiDraft("d1", "c1", { state })], mailboxes: [goodMailbox(sam)] }),
  );
}
function setState(state: "ready" | "sent"): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab")],
    reachWith({
      ...appStore().getState().data.reach,
      drafts: [aiDraft("d1", "c1", { state })],
    }),
  );
}
const dockEl = (): Element | null => document.querySelector('[data-ui="frame.dock"]');

beforeEach(() => {
  resetAppStoreForTests({ screen: "reach", tab: "board" });
  resetDockForTests();
  stubReachBridge({ "find:item": { item: null } });
  uninstall = installPersistence((channel: string, input: unknown) =>
    window.gratovo.invoke(channel as never, input as never),
  );
});
afterEach(() => {
  uninstall();
  cleanup();
  vi.restoreAllMocks();
});

describe("draft dock", () => {
  it("toasts when an asked-for draft turns ready, and Open shows the card", () => {
    seed("drafting");
    expectDraft("c1");
    render(<Host />);
    expect(dockEl()).toBeNull();
    act(() => {
      setState("ready");
    });
    expect(screen.getByText(t.ready("Prompt Lab"))).toBeTruthy();
    expect(dockEl()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.open }));
    expect(dockEl()).not.toBeNull();
    expect(screen.getByRole("region", { name: t.region })).toBeTruthy();
    expect(dockEl()?.querySelector(".draft")).not.toBeNull();
  });

  it("gives no toast for a draft nobody asked for", () => {
    seed("drafting");
    render(<Host />);
    act(() => {
      setState("ready");
    });
    expect(screen.queryByText(t.ready("Prompt Lab"))).toBeNull();
    expect(dockEl()).toBeNull();
  });

  it("minimises to the header and closes when the draft is sent", () => {
    seed("ready");
    appStore().ui((ui) => {
      ui.dock = { draft: "d1", min: false };
    });
    render(<Host />);
    expect(dockEl()?.querySelector(".draft")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.minimise }));
    expect(dockEl()).not.toBeNull();
    expect(dockEl()?.querySelector(".draft")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.expand }));
    expect(dockEl()?.querySelector(".draft")).not.toBeNull();
    act(() => {
      setState("sent");
    });
    expect(dockEl()).toBeNull();
    expect(appStore().getState().ui.dock).toBeNull();
  });
});
