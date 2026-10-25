// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiChannel } from "../lib/find-test-bridge";
import { resetFindForTests } from "../lib/find";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { stubToolboxBridge, toolboxItem } from "../lib/toolbox-test-bridge";
import { strings } from "../strings";
import { NeverTool } from "./never-tool";

const t = strings.toolbox.never;
const day = 86_400_000;

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const show = async (): Promise<void> => {
  render(<NeverTool />);
  await settle();
};
const click = async (el: HTMLElement): Promise<void> => {
  act(() => {
    fireEvent.click(el);
  });
  await settle();
};
const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await settle();
};
const toast = () => appStore().getState().ui.toasts.at(-1);
const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);
const search = async (value: string): Promise<void> => {
  fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value } });
  await settle();
  await wait(320);
};

const blocked = (id: string, name: string, over = {}) =>
  toolboxItem(id, name, null, {
    stage: "never",
    rejectReason: null,
    rejectedAt: Date.now() - 2 * day,
    neverReason: "Asked us to stop",
    ...over,
  });

beforeEach(() => {
  resetFindForTests();
  resetAppStoreForTests({ screen: "toolbox", tab: "never" });
});
afterEach(cleanup);

describe("Toolbox > Never contact", () => {
  it("says so when nobody is blocked", async () => {
    stubToolboxBridge();
    await show();
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint)).toBeTruthy();
  });

  it("lists the blocked channels with the reason, how long ago and the Never tag", async () => {
    stubToolboxBridge({
      never: [
        blocked("UC-a", "Agent Lab"),
        blocked("UC-b", "Prompt Garage", { neverReason: null }),
      ],
    });
    await show();
    const row = (name: string) => within(screen.getByText(name).closest("button") as HTMLElement);
    expect(row("Agent Lab").getByText(/Asked us to stop · 2 days ago/)).toBeTruthy();
    expect(row("Prompt Garage").getByText(new RegExp(t.noReason))).toBeTruthy();
    expect(row("Agent Lab").getByText(t.tag)).toBeTruthy();
  });

  it("opens the peek over the list from a row", async () => {
    stubToolboxBridge({ never: [blocked("UC-a", "Agent Lab"), blocked("UC-b", "Prompt Garage")] });
    await show();
    await click(screen.getByText("Prompt Garage").closest("button") as HTMLElement);
    expect(appStore().getState().ui.peek).toEqual({
      record: { kind: "creator", id: "UC-b" },
      list: ["UC-a", "UC-b"],
    });
  });

  it("pages the list with Show more", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      blocked(`UC-${String(i)}`, `Channel ${String(i)}`),
    );
    stubToolboxBridge({ never: many });
    await show();
    expect(screen.getAllByRole("button", { name: /^Allow .* again$/ })).toHaveLength(120);
    await click(screen.getByRole("button", { name: strings.toolbox.showMore }));
    expect(screen.getAllByRole("button", { name: /^Allow .* again$/ })).toHaveLength(130);
  });

  it("with more than 120 blocked, later pages keep their place and the total is not counted twice", async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      blocked(`UC-${String(i)}`, `Channel ${String(i)}`),
    );
    stubToolboxBridge({ never: many, catalog: [aiChannel("UC-lab", "Agent Lab")] });
    // The frame holds every one of them as a creator, as it does once they were acted on.
    act(() => {
      appStore().bg((data) => {
        for (const item of many) {
          data.creators.push({
            id: item.id,
            name: item.name,
            handle: item.handle,
            stage: "never",
            email: null,
            emailConfirmed: false,
            contactName: null,
            contactSource: null,
            contactConfidence: null,
            rejectReason: null,
            rejectedAt: item.rejectedAt,
            neverReason: "Asked us to stop",
            archiveDueAt: null,
          });
        }
      });
    });
    await show();
    const names = () =>
      screen
        .getAllByRole("button", { name: /^Allow .* again$/ })
        .map((b) => b.getAttribute("aria-label"));
    expect(names()).toHaveLength(120);
    await click(screen.getByRole("button", { name: strings.toolbox.showMore }));
    expect(names()).toHaveLength(130);
    expect(names()[0]).toBe(t.allowLabel("Channel 0"));
    expect(names()[129]).toBe(t.allowLabel("Channel 129"));
  });

  it("asks before allowing; Keep blocked changes nothing and Esc backs out", async () => {
    stubToolboxBridge({ never: [blocked("UC-a", "Agent Lab")] });
    await show();
    await click(screen.getByRole("button", { name: t.allowLabel("Agent Lab") }));
    expect(document.activeElement?.textContent).toBe(t.allowYes);
    await click(screen.getByRole("button", { name: t.allowKeep }));
    expect(creatorOf("UC-a")).toBeUndefined();
    expect(document.activeElement?.textContent).toBe(t.allow);
    await click(screen.getByRole("button", { name: t.allowLabel("Agent Lab") }));
    fireEvent.keyDown(screen.getByRole("button", { name: t.allowYes }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("button", { name: t.allowYes })).toBeNull();
    expect(document.activeElement?.textContent).toBe(t.allow);
  });

  it("allows again after a yes: the row leaves and focus moves to the next row", async () => {
    stubToolboxBridge({ never: [blocked("UC-a", "Agent Lab"), blocked("UC-b", "Prompt Garage")] });
    await show();
    await click(screen.getByRole("button", { name: t.allowLabel("Agent Lab") }));
    await click(screen.getByRole("button", { name: t.allowYes }));
    expect(creatorOf("UC-a")).toMatchObject({ stage: "new", neverReason: null });
    expect(screen.queryByText("Agent Lab")).toBeNull();
    expect(toast()?.msg).toBe(strings.findActions.allowed("Agent Lab"));
    expect(document.activeElement?.textContent).toContain("Prompt Garage");
  });
});

describe("Never contact > Add a channel", () => {
  const catalog = [
    aiChannel("UC-lab", "Agent Lab"),
    aiChannel("UC-gar", "Prompt Garage", { stage: "shortlisted" }),
    aiChannel("UC-no", "Agent Blocked", { stage: "never" }),
  ];

  it("keeps the button off until a channel is chosen, and searches after a short wait", async () => {
    const bridge = stubToolboxBridge({ catalog });
    await show();
    const add = screen.getByRole("button", { name: t.add });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(t.searchLabel), { target: { value: "agent" } });
    await settle();
    expect(bridge.calls.filter(([c]) => c === "find:query")).toHaveLength(0);
    await wait(320);
    const asked = bridge.calls.filter(([c]) => c === "find:query");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[1]).toMatchObject({ sort: "fit", offset: 0, limit: 8 });
    const group = within(screen.getByRole("group", { name: t.resultsLabel }));
    expect(group.getByText("Agent Lab")).toBeTruthy();
    // A channel already blocked is not offered.
    expect(group.queryByText("Agent Blocked")).toBeNull();
    expect(group.getByText(/@agentlab · New find/)).toBeTruthy();
  });

  it("blocks the chosen channel with the default reason when none is written", async () => {
    stubToolboxBridge({ catalog });
    await show();
    await search("agent");
    await click(screen.getByRole("button", { name: /Agent Lab/ }));
    expect(screen.getByRole("button", { name: /Agent Lab/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await click(screen.getByRole("button", { name: t.add }));
    expect(creatorOf("UC-lab")).toMatchObject({ stage: "never", neverReason: t.defaultReason });
    expect(toast()?.msg).toBe(strings.findActions.never("Agent Lab"));
    expect(screen.getByRole("button", { name: t.add }).hasAttribute("disabled")).toBe(true);
    // The row shows at once, before main's list has it, with the default words.
    expect(
      within(screen.getByText("Agent Lab").closest("button") as HTMLElement).getByText(
        new RegExp(t.defaultReason),
      ),
    ).toBeTruthy();
    // And a channel just blocked is not offered again.
    await search("agent");
    expect(
      within(screen.getByRole("group", { name: t.resultsLabel })).queryByText("Agent Lab"),
    ).toBeNull();
  });

  it("blocks with the reason written, trimmed", async () => {
    stubToolboxBridge({ catalog });
    await show();
    await search("garage");
    await click(screen.getByRole("button", { name: /Prompt Garage/ }));
    fireEvent.change(screen.getByLabelText(t.reasonLabel), {
      target: { value: "  Asked us to stop  " },
    });
    await click(screen.getByRole("button", { name: t.add }));
    expect(creatorOf("UC-gar")).toMatchObject({ stage: "never", neverReason: "Asked us to stop" });
    expect(screen.getByLabelText(t.reasonLabel)).toHaveProperty("value", "");
  });

  it("says when nothing matches", async () => {
    stubToolboxBridge({ catalog });
    await show();
    await search("zzz");
    expect(screen.getByText(t.noMatch)).toBeTruthy();
  });
});
