// @vitest-environment happy-dom
import type { OutreachDraft } from "@gratovo/core/data";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expectDraft, openDock, resetDockForTests, useDraftReadyToasts } from "../lib/dock";
import { installPersistence } from "../lib/persist";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { Toasts } from "../overlays/toasts";
import { strings } from "../strings";
import { DraftCard } from "../record/draft-card";
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
function setState(
  state: "drafting" | "ready" | "sent" | "scheduled" | "failed",
  over: Partial<OutreachDraft> = {},
): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab")],
    reachWith({
      ...appStore().getState().data.reach,
      drafts: [aiDraft("d1", "c1", { state, ...over })],
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
    expectDraft("c1", "first");
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

  it("closes when the draft is scheduled", () => {
    seed("ready");
    appStore().ui((ui) => {
      ui.dock = { draft: "d1", min: false };
    });
    render(<Host />);
    expect(dockEl()).not.toBeNull();
    act(() => {
      setState("scheduled");
    });
    expect(dockEl()).toBeNull();
    expect(appStore().getState().ui.dock).toBeNull();
  });

  it("gives no toast for a follow-up when a first email was asked for, and keeps waiting", () => {
    seed("drafting");
    expectDraft("c1", "first");
    render(<Host />);
    act(() => {
      setState("ready", { kind: "followUp", followUp: 1 });
    });
    expect(screen.queryByText(t.ready("Prompt Lab"))).toBeNull();
    act(() => {
      setState("drafting");
    });
    act(() => {
      setState("ready");
    });
    expect(screen.getByText(t.ready("Prompt Lab"))).toBeTruthy();
  });

  it("forgets an asked-for draft that failed", () => {
    seed("drafting");
    expectDraft("c1", "first");
    render(<Host />);
    act(() => {
      setState("failed");
    });
    act(() => {
      setState("ready");
    });
    expect(screen.queryByText(t.ready("Prompt Lab"))).toBeNull();
  });

  it("moves focus into the dock on open", () => {
    seed("ready");
    render(<Host />);
    act(() => {
      openDock("d1");
    });
    expect(document.activeElement).toBe(dockEl());
  });

  it("shows a line, not a second editor, in another card while the dock holds the draft", () => {
    seed("ready");
    appStore().ui((ui) => {
      ui.dock = { draft: "d1", min: true };
    });
    render(
      <>
        <Host />
        <DraftCard draftId="d1" />
      </>,
    );
    expect(screen.getByText(t.elsewhere)).toBeTruthy();
    expect(document.querySelectorAll(".draft").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: t.showIt }));
    expect(appStore().getState().ui.dock?.min).toBe(false);
    expect(dockEl()?.querySelector(".draft")).not.toBeNull();
  });
});
