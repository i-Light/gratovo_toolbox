// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { undo } from "../lib/actions";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { aiCreator, seedReach } from "../reach/reach-fixtures";
import { strings } from "../strings";
import { ScheduledTool } from "./scheduled-tool";

const t = strings.toolbox.scheduled;
const sam = "sam@gratovo.example";
const at = (day: number, hour: number): number => new Date(2026, 9, day, hour, 0, 0).getTime();

const draftOf = (id: string) =>
  appStore()
    .getState()
    .data.reach.drafts.find((d) => d.id === id);
const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  stubReachBridge();
  resetAppStoreForTests({ screen: "toolbox", tab: "scheduled" });
});
afterEach(cleanup);

function seed(scheduled = true): void {
  seedReach(
    [aiCreator("c1", "Prompt Lab"), aiCreator("c2", "Neural Notes")],
    reachWith({
      mailboxes: [goodMailbox(sam)],
      drafts: scheduled
        ? [
            aiDraft("late", "c1", { state: "scheduled", sendAt: at(28, 9), body: "\nSecond one" }),
            aiDraft("soon", "c2", { state: "scheduled", sendAt: at(27, 9), body: "Hi Neural" }),
            aiDraft("open", "c1", { state: "ready" }),
          ]
        : [aiDraft("open", "c1")],
    }),
  );
}

describe("Toolbox > Scheduled", () => {
  it("lists scheduled drafts soonest first with the line, the time and the mailbox", () => {
    seed();
    render(<ScheduledTool />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText("Neural Notes")).toBeTruthy();
    expect(first.getByText("Hi Neural")).toBeTruthy();
    expect(first.getByText("Tue 27 Oct 09:00")).toBeTruthy();
    expect(first.getByText(t.from(sam))).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Second one")).toBeTruthy();
  });

  it("opens the creator's peek on the Emails tab", () => {
    seed();
    render(<ScheduledTool />);
    fireEvent.click(screen.getByRole("button", { name: t.openLabel("Neural Notes") }));
    expect(appStore().getState().ui.peek).toMatchObject({
      record: { kind: "creator", id: "c2" },
      tab: "emails",
    });
  });

  it("cancels a send back to ready, and Undo schedules it again", async () => {
    seed();
    render(<ScheduledTool />);
    fireEvent.click(screen.getByRole("button", { name: t.cancelLabel("Neural Notes") }));
    await settle();
    expect(draftOf("soon")?.state).toBe("ready");
    expect(draftOf("soon")?.sendAt).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const toast = appStore().getState().ui.toasts.at(-1);
    expect(toast?.msg).toBe(strings.reach.later.cancelled);
    expect(toast?.sub).toBe(strings.reach.later.cancelledSub);
    expect(toast?.actions.map((a) => a.label)).toEqual([strings.actions.undo]);
    act(() => {
      undo();
    });
    expect(draftOf("soon")?.state).toBe("scheduled");
    expect(draftOf("soon")?.sendAt).toBe(at(27, 9));
  });

  it("says so when nothing is scheduled", () => {
    seed(false);
    render(<ScheduledTool />);
    expect(screen.getByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByText(t.emptyHint)).toBeTruthy();
  });
});
